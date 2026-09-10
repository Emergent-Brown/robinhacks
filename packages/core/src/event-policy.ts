import { invariant, safeInteger } from './errors.js';
import { RULES } from './rules.js';
import type { EventConfig, Phase, Wallet } from './types.js';

const transitions: Record<Phase, readonly Phase[]> = {
  DRAFT: ['REGISTRATION', 'CANCELLED'],
  REGISTRATION: ['SEED_OPEN', 'CANCELLED'],
  SEED_OPEN: ['SEED_SETTLING', 'CANCELLED'],
  SEED_SETTLING: ['INTERMISSION', 'CANCELLED'],
  INTERMISSION: ['TRADING_OPEN', 'FROZEN', 'CANCELLED'],
  TRADING_OPEN: ['INTERMISSION', 'CANCELLED'],
  FROZEN: ['FINALIZING', 'CANCELLED'],
  FINALIZING: ['FINALIZED', 'CANCELLED'],
  FINALIZED: ['ARCHIVED'],
  CANCELLED: ['ARCHIVED'],
  ARCHIVED: [],
};

/** State-machine gates have no clock dependency; every transaction passes freshly acquired server time. */
export class EventPolicy {
  static assertFinancialAction(event: EventConfig, action: 'seed' | 'trade', now: number): void {
    invariant(
      action === 'seed' || action === 'trade',
      'INVALID_ACTION',
      'Unknown financial action.',
    );
    safeInteger(now, 'Server time');
    invariant(
      !event.paused,
      'EVENT_PAUSED',
      event.pauseReason || 'The organizer has paused the event.',
    );
    const requiredPhase = action === 'seed' ? 'SEED_OPEN' : 'TRADING_OPEN';
    invariant(
      event.phase === requiredPhase,
      'MARKET_CLOSED',
      action === 'seed' ? 'Funding is closed.' : 'Trading is closed.',
    );
    invariant(
      event.closesAt !== null && Number.isSafeInteger(event.closesAt) && now < event.closesAt,
      'WINDOW_EXPIRED',
      'This window has ended.',
    );
  }
  static assertTransition(event: EventConfig, target: Phase): void {
    invariant(
      transitions[event.phase]?.includes(target),
      'INVALID_TRANSITION',
      `Cannot move from ${event.phase} to ${target}.`,
    );
    if (target === 'TRADING_OPEN') {
      invariant(
        event.windowId < RULES.maxTradingWindows,
        'WINDOW_LIMIT',
        'All configured trading windows have been used.',
      );
    }
    if (target === 'SEED_OPEN' || target === 'TRADING_OPEN') {
      invariant(!event.paused, 'EVENT_PAUSED', 'Resume the event before opening a new window.');
    }
  }
  static assertTradeAllowance(wallet: Wallet, event: EventConfig, now: number): void {
    this.assertFinancialAction(event, 'trade', now);
    safeInteger(wallet.successfulTradesInWindow, 'Accepted trade count');
    safeInteger(wallet.lastTradeAt, 'Last trade time');
    const count = wallet.tradeWindowId === event.windowId ? wallet.successfulTradesInWindow : 0;
    invariant(
      count < RULES.tradesPerWindow,
      'TRADE_LIMIT',
      `Your team has used its ${RULES.tradesPerWindow} trades for this window.`,
    );
    invariant(
      wallet.lastTradeAt === 0 || now - wallet.lastTradeAt >= RULES.tradeCooldownMs,
      'TRADE_COOLDOWN',
      'Wait 10 seconds between accepted trades.',
    );
  }
  static allowedTransitions(event: EventConfig): readonly Phase[] {
    return transitions[event.phase].filter(
      (target) => target !== 'TRADING_OPEN' || event.windowId < RULES.maxTradingWindows,
    );
  }
}
