/** Commands that write only their own team's or person's records. They cannot deadlock. */
const INDEPENDENT = new Set(['saveAllocation', 'saveBallot', 'readGeneral', 'updateProfile']);
const MAX_HOLD_MS = 20_000;

/**
 * Runs shared-state commands one at a time. Those commands read a document and then write it,
 * so two that overlap each hold a read lock the other's write needs, and both stall until
 * Firestore aborts one. Queueing them here avoids that. Reads don't pass through this lane:
 * they use lock-free views. gameCommand runs on one instance so this queue sees every command.
 */
export class CommandLane {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly maxHoldMs = MAX_HOLD_MS) {}

  run<T>(commandType: string, work: () => Promise<T>): Promise<T> {
    if (INDEPENDENT.has(commandType)) return work();
    const result = this.tail.then(work);
    // A stuck transaction fails on its own later; it must not stall the room meanwhile.
    let timer: ReturnType<typeof setTimeout>;
    const released = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, this.maxHoldMs);
      timer.unref?.();
    });
    this.tail = Promise.race([result.catch(() => undefined), released]).finally(() =>
      clearTimeout(timer),
    );
    return result;
  }
}
