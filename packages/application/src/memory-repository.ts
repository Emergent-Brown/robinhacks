import type { Repository, Transaction } from './repository';
export type DocumentMap = Record<string, unknown>;
export interface Persistence {
  load(): DocumentMap | null;
  save(documents: DocumentMap): void;
}
/** Serializable in-memory unit of work. Browser locks also serialize demo tabs. */
export class MemoryRepository implements Repository {
  private documents: DocumentMap;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    initial: DocumentMap = {},
    private readonly persistence?: Persistence,
  ) {
    this.documents = structuredClone(persistence?.load() ?? initial);
  }
  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.unitOfWork(work, true);
  }
  read<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.unitOfWork(work, false);
  }
  private async unitOfWork<T>(
    work: (tx: Transaction) => Promise<T>,
    writable: boolean,
  ): Promise<T> {
    const run = async () => {
      const execute = async () => {
        const draft = structuredClone(this.persistence?.load() ?? this.documents);
        const tx: Transaction = {
          get: async <V>(path: string) => structuredClone((draft[path] ?? null) as V | null),
          list: async <V>(path: string, limit = 1000) =>
            Object.entries(draft)
              .filter(
                ([key]) => key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/'),
              )
              .slice(0, limit)
              .map(([, value]) => structuredClone(value as V)),
          set: <V>(path: string, value: V) => {
            if (!writable) throw new Error('This read-only view cannot write.');
            draft[path] = structuredClone(value);
          },
          delete: (path: string) => {
            if (!writable) throw new Error('This read-only view cannot write.');
            delete draft[path];
          },
        };
        const result = await work(tx);
        if (!writable) return result;
        this.persistence?.save(draft);
        this.documents = draft;
        return result;
      };
      if (typeof navigator !== 'undefined' && navigator.locks)
        return navigator.locks.request('robinhacks-demo', execute);
      return execute();
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }
  replace(documents: DocumentMap): void {
    this.documents = structuredClone(documents);
    this.persistence?.save(this.documents);
  }
  dump(): DocumentMap {
    return structuredClone(this.documents);
  }
}
