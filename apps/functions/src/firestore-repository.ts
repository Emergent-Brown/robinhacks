import {
  projectionFor,
  projectionChunks,
  PROJECTED_COLLECTIONS,
  type ProjectionManifest,
  type ProjectionRow,
} from './read-projections';
import type {
  Firestore,
  Transaction as NativeTransaction,
  DocumentData,
} from 'firebase-admin/firestore';
import type { Repository, Transaction } from '@robinhacks/application';

type PendingWrite = { kind: 'set'; value: unknown } | { kind: 'delete' };

/** Adapts the small domain repository to Firestore's optimistic/pessimistic retry boundary.
 * Writes are staged until all application reads finish: Firestore forbids read-after-write.
 * Staged get/list reads expose a transaction's own changes for projection composition. */
export class FirestoreRepository implements Repository {
  constructor(
    private readonly firestore: Firestore,
    private readonly options: { projections?: boolean; onRead?: (documents: number) => void } = {},
  ) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.firestore.runTransaction(
      async (native) => {
        const adapter = new BufferedTransaction(this.firestore, native, false, this.options);
        const result = await work(adapter);
        await adapter.refreshProjections();
        adapter.flush();
        return result;
      },
      { maxAttempts: 5 },
    );
  }

  /** Idempotent deployment backfill: rebuild derived pages without changing source records. */
  rebuildReadViews(eventId: string): Promise<void> {
    if (!/^[a-zA-Z0-9_-]+$/.test(eventId)) throw new Error('Invalid event id');
    return this.firestore.runTransaction(async (native) => {
      const adapter = new BufferedTransaction(this.firestore, native, false, this.options);
      await adapter.refreshProjections(
        Object.keys(PROJECTED_COLLECTIONS).map((name) => `events/${eventId}/${name}`),
      );
      adapter.flush();
    });
  }

  /** Read-only transactions hold no locks, so a room of readers cannot starve a writer. */
  read<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.firestore.runTransaction(
      (native) => work(new BufferedTransaction(this.firestore, native, true, this.options)),
      { readOnly: true },
    );
  }
}

class BufferedTransaction implements Transaction {
  private readonly pending = new Map<string, PendingWrite>();
  private readonly cache = new Map<string, unknown | null>();
  private readonly lists = new Map<string, Promise<ProjectionRow[]>>();
  private readonly gets = new Map<string, Promise<unknown | null>>();
  constructor(
    private readonly firestore: Firestore,
    private readonly native: NativeTransaction,
    private readonly readOnly = false,
    private readonly options: { projections?: boolean; onRead?: (documents: number) => void } = {},
  ) {}

  async get<T>(path: string): Promise<T | null> {
    const staged = this.pending.get(path);
    if (staged) return staged.kind === 'delete' ? null : (structuredClone(staged.value) as T);
    if (this.cache.has(path)) return structuredClone(this.cache.get(path)) as T | null;
    let pending = this.gets.get(path);
    if (!pending) {
      pending = this.native.get(this.firestore.doc(path)).then((snapshot) => {
        this.options.onRead?.(1);
        const value = snapshot.exists ? snapshot.data()! : null;
        this.cache.set(path, value);
        return value;
      });
      this.gets.set(path, pending);
    }
    return structuredClone(await pending) as T | null;
  }

  private sourceRows(collectionPath: string, limit: number): Promise<ProjectionRow[]> {
    const key = `${collectionPath}?${limit}`;
    let pending = this.lists.get(key);
    if (!pending) {
      pending = this.native
        .get(this.firestore.collection(collectionPath).limit(limit))
        .then((result) => {
          this.options.onRead?.(Math.max(1, result.size));
          return result.docs.map((doc) => {
            const value = doc.data();
            this.cache.set(doc.ref.path, value);
            return { path: doc.ref.path, value };
          });
        });
      this.lists.set(key, pending);
    }
    return pending;
  }

  async list<T>(collectionPath: string, limit = 1000): Promise<T[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000)
      throw new Error('Repository list limit must be between 1 and 10,000.');
    const projection =
      this.readOnly && this.options.projections !== false ? projectionFor(collectionPath) : null;
    if (projection && limit <= projection.limit) {
      const manifest = await this.get<ProjectionManifest>(projection.path);
      if (manifest?.schema === 1 && manifest.count < projection.limit) {
        const chunks = await Promise.all(
          Array.from({ length: manifest.chunks }, (_, i) =>
            this.get<{ rows: ProjectionRow[] }>(`${projection.path}/chunks/${i}`),
          ),
        );
        // A missing page must fall back to authoritative data, never silently drop teams.
        if (chunks.every((chunk) => chunk !== null)) {
          const rows = chunks.flatMap((chunk) => chunk!.rows);
          if (rows.length === manifest.count)
            return structuredClone(rows.slice(0, limit).map((row) => row.value)) as T[];
        }
      }
    }
    const docs = new Map(
      (await this.sourceRows(collectionPath, limit)).map((row) => [row.path, row.value]),
    );
    const prefix = `${collectionPath}/`;
    for (const [path, staged] of this.pending) {
      if (!path.startsWith(prefix) || path.slice(prefix.length).includes('/')) continue;
      if (staged.kind === 'delete') docs.delete(path);
      else docs.set(path, staged.value);
    }
    return [...docs.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, limit)
      .map(([, value]) => structuredClone(value) as T);
  }

  async refreshProjections(collections?: string[]): Promise<void> {
    const changed = collections ?? [
      ...new Set([...this.pending.keys()].map((path) => path.slice(0, path.lastIndexOf('/')))),
    ];
    for (const collection of changed) {
      const projection = projectionFor(collection);
      if (!projection) continue;
      const source = await this.sourceRows(collection, projection.limit);
      const docs = new Map(source.map((row) => [row.path, row.value]));
      for (const [path, write] of this.pending) {
        if (path.slice(0, path.lastIndexOf('/')) !== collection) continue;
        if (write.kind === 'delete') docs.delete(path);
        else docs.set(path, write.value);
      }
      const rows = [...docs.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([path, value]) => ({ path, value }));
      const chunks = projectionChunks(rows);
      const prior = await this.get<ProjectionManifest>(projection.path);
      // A truncated source query may omit rows beyond the sentinel, even after staged deletes.
      // Preserve the overflow marker so readers use authority until a complete rebuild is possible.
      const count =
        source.length >= projection.limit ? Math.max(rows.length, projection.limit) : rows.length;
      this.set(projection.path, { schema: 1, count, chunks: chunks.length });
      chunks.forEach((page, i) => this.set(`${projection.path}/chunks/${i}`, { rows: page }));
      for (let i = chunks.length; i < (prior?.chunks ?? 0); i++)
        this.delete(`${projection.path}/chunks/${i}`);
    }
  }

  set<T>(path: string, value: T): void {
    if (this.readOnly) throw new Error('This read-only view cannot write.');
    this.pending.set(path, { kind: 'set', value: structuredClone(value) });
  }
  delete(path: string): void {
    if (this.readOnly) throw new Error('This read-only view cannot write.');
    this.pending.set(path, { kind: 'delete' });
  }

  flush(): void {
    if (this.pending.size > 450)
      throw new Error('Transaction exceeds the application’s safe write limit.');
    for (const [path, write] of this.pending) {
      const ref = this.firestore.doc(path);
      if (write.kind === 'delete') this.native.delete(ref);
      else this.native.set(ref, write.value as DocumentData);
    }
  }
}
