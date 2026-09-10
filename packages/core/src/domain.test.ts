import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  ConstantProductPool,
  Credits,
  DomainError,
  EventPolicy,
  FundingAllocator,
  PortfolioAccounting,
  ResultScorer,
  RULES,
  ShareQuantity,
} from './index.js';
import type { EventConfig, Pool, Wallet } from './types.js';
import { sha256 } from './sha256.js';

const pool = (shares = 400, cash = 4_000_000): Pool => ({
  issuerId: 'issuer',
  shareReserve: shares,
  creditReserveMinor: cash,
  version: 0,
  halted: false,
});
const event = (patch: Partial<EventConfig> = {}): EventConfig => ({
  id: 'event',
  name: 'Event',
  venue: '',
  phase: 'TRADING_OPEN',
  phaseVersion: 1,
  paused: false,
  pauseReason: '',
  windowId: 1,
  closesAt: 100_000,
  createdAt: 0,
  rulesVersion: 1,
  activeOperationId: null,
  publishedResultId: null,
  announcement: '',
  tieSeed: 'public',
  ...patch,
});
const wallet = (patch: Partial<Wallet> = {}): Wallet => ({
  teamId: 'team',
  cashMinor: RULES.initialWalletMinor,
  reservedSeedMinor: 0,
  version: 1,
  lastTradeAt: 0,
  tradeWindowId: 1,
  successfulTradesInWindow: 0,
  ...patch,
});

function expectCode(action: () => unknown, code: string): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}`);
}

describe('immutable credit and share values', () => {
  it('parses credits without binary rounding and rejects precision loss', () => {
    expect(Credits.parse('0.29').minor).toBe(29);
    expect(Credits.parse('100.1').minor).toBe(10010);
    expect(Credits.parse('999').minor).toBe(99900);
    expect(() => Credits.parse('1.001')).toThrow();
    expect(() => new Credits(0.5)).toThrow();
    expect(() => new Credits(Infinity)).toThrow();
    expect(() => ShareQuantity.positive(0)).toThrow();
  });
  it('rejects overflow and overspending before returning a value', () => {
    const balance = new Credits(Number.MAX_SAFE_INTEGER);
    expect(() => balance.add(new Credits(1))).toThrow();
    expect(() => balance.multiply(new ShareQuantity(2))).toThrow();
    expect(() => new Credits(2).subtract(new Credits(3))).toThrow();
    expect(balance.minor).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('constant-product pricing', () => {
  it('matches documented quotes with an exact one-cent round-trip loss', () => {
    const initial = pool();
    const buy = new ConstantProductPool(initial).quote('BUY', 10);
    const sell = new ConstantProductPool(buy.nextPool).quote('SELL', 10);
    expect(buy.totalMinor).toBe(102565);
    expect(sell.totalMinor).toBe(102564);
    expect(sell.nextPool).toMatchObject({ shareReserve: 400, creditReserveMinor: 4_000_001 });
    expect(initial).toEqual(pool());
    expect(new ConstantProductPool(pool()).quote('BUY', 25).totalMinor).toBe(266667);
  });
  it('preserves reserves and never creates round-trip profit across varied depths', () => {
    for (let i = 1; i <= 200; i++) {
      const initial = pool(31 + i * 13, 100 + i * 973);
      const quantity = (i % 25) + 1;
      const buy = new ConstantProductPool(initial).quote('BUY', quantity);
      const sell = new ConstantProductPool(buy.nextPool).quote('SELL', quantity);
      expect(sell.totalMinor).toBeLessThanOrEqual(buy.totalMinor);
      expect(
        BigInt(buy.nextPool.shareReserve) * BigInt(buy.nextPool.creditReserveMinor),
      ).toBeGreaterThanOrEqual(BigInt(initial.shareReserve) * BigInt(initial.creditReserveMinor));
      expect(
        BigInt(sell.nextPool.shareReserve) * BigInt(sell.nextPool.creditReserveMinor),
      ).toBeGreaterThanOrEqual(
        BigInt(buy.nextPool.shareReserve) * BigInt(buy.nextPool.creditReserveMinor),
      );
      expect(sell.nextPool.shareReserve).toBe(initial.shareReserve);
      expect(sell.nextPool.creditReserveMinor - initial.creditReserveMinor).toBe(
        buy.totalMinor - sell.totalMinor,
      );
    }
  });
  it('uses exact multiplication beyond the safe-integer intermediate range', () => {
    const state = pool(1_000_000, 8_000_000_000_000);
    const result = new ConstantProductPool(state).quote('BUY', 700_000);
    expect(result.totalMinor).toBe(Number((8_000_000_000_000n * 700_000n + 299_999n) / 300_000n));
  });
  it.each([0, -1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid quantity %s',
    (quantity) => {
      expect(() => new ConstantProductPool(pool()).quote('BUY', quantity)).toThrow();
    },
  );
  it('rejects depleted, halted and zero-value orders', () => {
    expectCode(() => new ConstantProductPool(pool()).quote('BUY', 400), 'POOL_LIQUIDITY');
    expectCode(
      () => new ConstantProductPool({ ...pool(), halted: true }).quote('BUY', 1),
      'ISSUER_HALTED',
    );
    expectCode(() => new ConstantProductPool(pool(400, 1)).quote('SELL', 1), 'ZERO_TRADE');
  });
});

describe('sealed funding allocation', () => {
  it('implements standard SHA-256 including multiple blocks and Unicode', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256('a'.repeat(100))).toBe(
      '2816597888e4a0d3a36b82b83316ab32680eb8f00f8cd3b904d681246d285a0e',
    );
    for (const input of [
      '🚀:équipe:東京',
      'a'.repeat(55),
      'b'.repeat(56),
      'c'.repeat(63),
      'd'.repeat(64),
      'e'.repeat(65),
    ]) {
      expect(sha256(input)).toBe(createHash('sha256').update(input).digest('hex'));
    }
  });
  it('allocates undersubscribed requests and omits excluded projects', () => {
    expect(
      FundingAllocator.allocate(
        { a: { issuer: 12, withdrawn: 10 }, b: { issuer: 0 } },
        ['issuer'],
        'seed',
      ),
    ).toEqual({ a: { issuer: 12 }, b: {} });
  });
  it('allocates five 25-share requests to twenty each', () => {
    const requests = Object.fromEntries(
      ['a', 'b', 'c', 'd', 'e'].map((id) => [id, { issuer: 25 }]),
    );
    const allocation = FundingAllocator.allocate(requests, ['issuer'], 'seed');
    expect(Object.values(allocation).map((v) => v.issuer)).toEqual([20, 20, 20, 20, 20]);
  });
  it('breaks equal remainders with the published hash, independent of input order', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f'];
    const requests = Object.fromEntries(names.map((id) => [id, { issuer: 25 }]));
    const allocation = FundingAllocator.allocate(requests, ['issuer'], 'public');
    const reverse = FundingAllocator.allocate(
      Object.fromEntries(Object.entries(requests).reverse()),
      ['issuer'],
      'public',
    );
    expect(allocation).toEqual(reverse);
    const hashes = names
      .map((id) => ({ id, digest: sha256(`public:issuer:${id}`) }))
      .sort((a, b) => (a.digest < b.digest ? -1 : 1));
    for (const [i, item] of hashes.entries())
      expect(allocation[item.id]!.issuer).toBe(i < 4 ? 17 : 16);
  });
  it('conserves inventory and never exceeds requests across 10–30 teams', () => {
    for (let count = 10; count <= 30; count++) {
      const requests = Object.fromEntries(
        Array.from({ length: count }, (_, i) => [`t${i}`, { issuer: (i * 17 + count) % 26 }]),
      );
      const allocated = FundingAllocator.allocate(requests, ['issuer'], 'event');
      let total = 0;
      for (const [team, values] of Object.entries(allocated)) {
        expect(values.issuer ?? 0).toBeLessThanOrEqual(requests[team]!.issuer);
        total += values.issuer ?? 0;
      }
      expect(total).toBe(
        Math.min(
          100,
          Object.values(requests).reduce((sum, v) => sum + v.issuer, 0),
        ),
      );
    }
  });
  it('rejects self-funding, invalid amounts, excess commitments and duplicate issuers', () => {
    expectCode(() => FundingAllocator.allocate({ a: { a: 1 } }, ['a'], 's'), 'SELF_INVESTMENT');
    expect(() => FundingAllocator.allocate({ a: { b: 1.5 } }, ['b'], 's')).toThrow();
    expectCode(
      () => FundingAllocator.allocate({ a: { b: 25, c: 25, d: 1 } }, ['b', 'c', 'd'], 's'),
      'FUNDING_LIMIT',
    );
    expectCode(() => FundingAllocator.allocate({}, ['b', 'b'], 's'), 'INVALID_ISSUERS');
  });
});

describe('average acquisition cost', () => {
  it('retains remainder basis until the full exit and preserves realized returns', () => {
    const initial = PortfolioAccounting.buy(PortfolioAccounting.empty('issuer'), 3, 1001);
    const partial = PortfolioAccounting.sell(initial, 1, 400);
    expect(partial).toMatchObject({ shares: 2, costBasisMinor: 668, realizedPnlMinor: 67 });
    const closed = PortfolioAccounting.sell(partial, 2, 700);
    expect(closed).toMatchObject({ shares: 0, costBasisMinor: 0, realizedPnlMinor: 99 });
    expect(initial).toMatchObject({ shares: 3, costBasisMinor: 1001, realizedPnlMinor: 0 });
    const reopened = PortfolioAccounting.buy(closed, 1, 500);
    expect(reopened.realizedPnlMinor).toBe(99);
  });
  it('enforces holding and share bounds, and treats reservations as part of cash', () => {
    expectCode(
      () => PortfolioAccounting.buy(PortfolioAccounting.empty('issuer'), 26, 260000),
      'HOLDING_LIMIT',
    );
    expectCode(
      () => PortfolioAccounting.sell(PortfolioAccounting.empty('issuer'), 1, 100),
      'INSUFFICIENT_SHARES',
    );
    expect(
      PortfolioAccounting.availableCash(wallet({ cashMinor: 1000, reservedSeedMinor: 250 })),
    ).toBe(750);
    expectCode(
      () => PortfolioAccounting.availableCash(wallet({ cashMinor: 1000, reservedSeedMinor: 1001 })),
      'INVALID_WALLET',
    );
  });
});

describe('judged result scoring', () => {
  it.each([2, 3, 10, 30])('scores %s issuers with exact endpoints', (n) => {
    const ids = Array.from({ length: n }, (_, i) => `i${i}`);
    const scores = Object.fromEntries(ids.map((id, i) => [id, 100 - i]));
    const result = ResultScorer.score(scores, ids);
    expect(result[0]!.priceMinor).toBe(17500);
    expect(result[n - 1]!.priceMinor).toBe(2500);
    expect(result.map((v) => v.rank)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
  });
  it('scores a sole issuer and all ties at 100 credits', () => {
    expect(ResultScorer.score({ a: 99 }, ['a'])[0]!.priceMinor).toBe(10000);
    expect(
      ResultScorer.score({ a: 88, b: 88, c: 88 }, ['a', 'b', 'c']).map((i) => [
        i.rank,
        i.priceMinor,
      ]),
    ).toEqual([
      [1, 10000],
      [1, 10000],
      [1, 10000],
    ]);
  });
  it('uses the average occupied rank for ties and zero for exclusions', () => {
    const scored = ResultScorer.score({ a: 98.5, b: 98.5, c: 80, excluded: 100 }, ['a', 'b', 'c']);
    expect(scored.map((i) => [i.rank, i.priceMinor, i.eligible])).toEqual([
      [1, 13750, true],
      [1, 13750, true],
      [3, 2500, true],
      [0, 0, false],
    ]);
  });
  it('rounds half up once after the tied-rank calculation', () => {
    const ids = Array.from({ length: 17 }, (_, i) => `i${i}`);
    const result = ResultScorer.score(Object.fromEntries(ids.map((id, i) => [id, 100 - i])), ids);
    expect(result[1]!.priceMinor).toBe(16563);
  });
  it('rejects missing/invalid scores and zero eligible issuers', () => {
    expectCode(() => ResultScorer.score({ a: 90 }, ['a', 'b']), 'MISSING_SCORE');
    expectCode(() => ResultScorer.score({ a: 90.333 }, ['a']), 'MISSING_SCORE');
    expectCode(() => ResultScorer.score({ a: NaN }, ['a']), 'MISSING_SCORE');
    expectCode(() => ResultScorer.score({}, []), 'NO_ELIGIBLE_ISSUERS');
  });
  it('calculates frozen portfolio value without altering financial balances or basis', () => {
    const frozen = wallet({ cashMinor: 600000 });
    const positions = [
      PortfolioAccounting.buy(PortfolioAccounting.empty('a'), 20, 200000),
      PortfolioAccounting.buy(PortfolioAccounting.empty('b'), 10, 100000),
    ];
    const before = JSON.stringify({ frozen, positions });
    const results = ResultScorer.score({ a: 100, b: 90, c: 80 }, ['a', 'b', 'c']);
    expect(ResultScorer.portfolio(frozen, positions, results)).toMatchObject({
      cashMinor: 600000,
      valueMinor: 1050000,
      profitMinor: 50000,
    });
    expect(JSON.stringify({ frozen, positions })).toBe(before);
    expectCode(
      () => ResultScorer.portfolio(wallet({ reservedSeedMinor: 1 }), [], results),
      'UNSETTLED_FUNDING',
    );
    expectCode(
      () => ResultScorer.portfolio(frozen, [{ ...positions[0]!, shares: -1 }], results),
      'INVALID_AMOUNT',
    );
  });
});

describe('phase and server-time boundaries', () => {
  it('uses an exclusive deadline and checks time on every attempted callback', () => {
    EventPolicy.assertFinancialAction(event(), 'trade', 99999);
    expectCode(() => EventPolicy.assertFinancialAction(event(), 'trade', 100000), 'WINDOW_EXPIRED');
    expectCode(
      () => EventPolicy.assertFinancialAction(event({ phase: 'INTERMISSION' }), 'trade', 99999),
      'MARKET_CLOSED',
    );
    expectCode(
      () => EventPolicy.assertFinancialAction(event({ paused: true }), 'trade', 99999),
      'EVENT_PAUSED',
    );
  });
  it('preserves quota across pause/resume and only resets it for a new window', () => {
    const used = wallet({ successfulTradesInWindow: 15 });
    expectCode(() => EventPolicy.assertTradeAllowance(used, event(), 20000), 'TRADE_LIMIT');
    EventPolicy.assertTradeAllowance(used, event({ windowId: 2 }), 20000);
    expectCode(
      () => EventPolicy.assertTradeAllowance(wallet({ lastTradeAt: 10001 }), event(), 20000),
      'TRADE_COOLDOWN',
    );
    EventPolicy.assertTradeAllowance(wallet({ lastTradeAt: 10000 }), event(), 20000);
  });
  it('cannot reopen funding or trading after permanent freeze', () => {
    expectCode(
      () => EventPolicy.assertTransition(event({ phase: 'SEED_SETTLING' }), 'SEED_OPEN'),
      'INVALID_TRANSITION',
    );
    expectCode(
      () => EventPolicy.assertTransition(event({ phase: 'FROZEN' }), 'TRADING_OPEN'),
      'INVALID_TRANSITION',
    );
    expectCode(
      () =>
        EventPolicy.assertTransition(event({ phase: 'INTERMISSION', windowId: 3 }), 'TRADING_OPEN'),
      'WINDOW_LIMIT',
    );
    EventPolicy.assertTransition(event({ phase: 'FROZEN' }), 'FINALIZING');
  });
});
