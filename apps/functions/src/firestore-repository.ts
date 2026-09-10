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
  constructor(private readonly firestore: Firestore) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.firestore.runTransaction(
      async (native) => {
        const adapter = new BufferedTransaction(this.firestore, native);
        const result = await work(adapter);
        adapter.flush();
        return result;
      },
      { maxAttempts: 5 },
    );
  }
}

class BufferedTransaction implements Transaction {
  private readonly pending = new Map<string, PendingWrite>();
  private readonly cache = new Map<string, unknown | null>();
  constructor(
    private readonly firestore: Firestore,
    private readonly native: NativeTransaction,
  ) {}

  async get<T>(path: string): Promise<T | null> {
    const staged = this.pending.get(path);
    if (staged) return staged.kind === 'delete' ? null : (structuredClone(staged.value) as T);
    if (this.cache.has(path)) return structuredClone(this.cache.get(path)) as T | null;
    const snapshot = await this.native.get(this.firestore.doc(path));
    const value = snapshot.exists ? snapshot.data()! : null;
    this.cache.set(path, value);
    return structuredClone(value) as T | null;
  }

  async list<T>(collectionPath: string, limit = 1000): Promise<T[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000)
      throw new Error('Repository list limit must be between 1 and 10,000.');
    const result = await this.native.get(this.firestore.collection(collectionPath).limit(limit));
    const docs = new Map<string, unknown>(
      result.docs.map((doc) => {
        const data = doc.data();
        this.cache.set(doc.ref.path, data);
        return [doc.ref.path, data];
      }),
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

  set<T>(path: string, value: T): void {
    this.pending.set(path, { kind: 'set', value: structuredClone(value) });
  }
  delete(path: string): void {
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
