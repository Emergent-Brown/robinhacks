/** Coalesce identical reads and space requests across rapid navigation. No response cache. */
export class ReadQueue {
  private pending = new Map<string, Promise<unknown>>();
  private tail: Promise<unknown> = Promise.resolve();
  private nextAt = 0;
  constructor(
    private readonly spacingMs = 1500,
    private readonly now = () => Date.now(),
    private readonly sleep = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ) {}
  run<T>(key: string, read: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key);
    if (existing) return existing as Promise<T>;
    const result = this.tail
      .catch(() => undefined)
      .then(async () => {
        const delay = this.nextAt - this.now();
        if (delay > 0) await this.sleep(delay);
        this.nextAt = this.now() + this.spacingMs;
        try {
          return await read();
        } catch (error) {
          const failure = error as { code?: string; retryAfterMs?: number };
          if (['RATE_LIMITED', 'functions/resource-exhausted'].includes(failure.code || ''))
            this.nextAt =
              this.now() + Math.min(60000, Math.max(3000, failure.retryAfterMs || 60000));
          throw error;
        }
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, result);
    this.tail = result;
    return result;
  }
}
