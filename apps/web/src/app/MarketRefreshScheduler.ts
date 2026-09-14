import type { AppSnapshot } from '@robinhacks/core';

/** Only a visible organizer session maintains the inexpensive public projection. */
export class MarketRefreshScheduler {
  private busy = false;
  constructor(read: () => AppSnapshot | null, refresh: () => Promise<unknown>) {
    window.setInterval(async () => {
      const state = read();
      if (
        this.busy ||
        document.visibilityState !== 'visible' ||
        state?.member?.role !== 'organizer' ||
        state.member.status !== 'approved' ||
        !!state.event?.platform ||
        state.event?.phase !== 'TRADING_OPEN' ||
        state.event.paused ||
        Date.now() - state.market.asOf < 120_000
      )
        return;
      this.busy = true;
      try {
        await refresh();
      } catch {
        /* The next interval retries; trading always uses an authoritative quote. */
      } finally {
        this.busy = false;
      }
    }, 30_000);
  }
}
