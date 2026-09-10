export interface Transaction {
  get<T>(path: string): Promise<T | null>;
  list<T>(collectionPath: string, limit?: number): Promise<T[]>;
  set<T>(path: string, value: T): void;
  delete(path: string): void;
}
export interface Repository {
  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
}
export interface Clock {
  now(): number;
}
export class SystemClock implements Clock {
  now() {
    return Date.now();
  }
}
