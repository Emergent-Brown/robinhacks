import { describe, expect, it } from 'vitest';
import {
  ConstantProductPool,
  FundingAllocator,
  PortfolioAccounting,
  ResultScorer,
  RULES,
} from './index.js';
import type { Pool, Position, Wallet } from './types.js';

/** An end-to-end economic simulation independent of storage and transaction implementation. */
describe('whole-event financial conservation', () => {
  it.each([10, 20, 30])('preserves cash, shares and score immutability for %s teams', (count) => {
    const ids = Array.from({ length: count }, (_, i) => `team-${i}`);
    const wallets: Record<string, Wallet> = {};
    const pools: Record<string, Pool> = {};
    const positions: Record<string, Record<string, Position>> = {};
    const vaults: Record<string, number> = {};
    const primary: Record<string, number> = {};
    for (const id of ids) {
      wallets[id] = {
        teamId: id,
        cashMinor: RULES.initialWalletMinor,
        reservedSeedMinor: RULES.maxSeedCommitmentMinor,
        version: 0,
        lastTradeAt: 0,
        tradeWindowId: 0,
        successfulTradesInWindow: 0,
      };
      pools[id] = {
        issuerId: id,
        creditReserveMinor: RULES.openingPoolCashMinor,
        shareReserve: RULES.openingPoolShares,
        version: 0,
        halted: false,
      };
      positions[id] = {};
      vaults[id] = 0;
      primary[id] = RULES.primaryShares;
    }
    // Concentrated requests deliberately oversubscribe the first project in every run.
    const requests = Object.fromEntries(
      ids.map((id, i) => [id, { [ids[i === 0 ? 1 : 0]!]: 25, [ids[(i + 2) % count]!]: 25 }]),
    );
    const allocations = FundingAllocator.allocate(requests, ids, 'published-event-seed');
    for (const [teamId, allocation] of Object.entries(allocations)) {
      for (const [issuerId, shares] of Object.entries(allocation)) {
        const debit = shares * RULES.primaryPriceMinor;
        wallets[teamId]!.cashMinor -= debit;
        positions[teamId]![issuerId] = PortfolioAccounting.buy(
          PortfolioAccounting.empty(issuerId),
          shares,
          debit,
        );
        vaults[issuerId]! += debit;
        primary[issuerId]! -= shares;
      }
      wallets[teamId]!.reservedSeedMinor = 0;
    }
    const initialCash =
      BigInt(count) * BigInt(RULES.initialWalletMinor + RULES.openingPoolCashMinor);
    const verifyBalances = (): void => {
      let cash = 0n;
      for (const id of ids) {
        const wallet = wallets[id]!;
        const pool = pools[id]!;
        cash += BigInt(wallet.cashMinor) + BigInt(pool.creditReserveMinor) + BigInt(vaults[id]!);
        expect(wallet.cashMinor).toBeGreaterThanOrEqual(0);
        expect(wallet.reservedSeedMinor).toBe(0);
        let shares = primary[id]! + pool.shareReserve;
        for (const holderId of ids) {
          const held = positions[holderId]![id]?.shares ?? 0;
          expect(held).toBeGreaterThanOrEqual(0);
          expect(held).toBeLessThanOrEqual(25);
          if (holderId === id) expect(held).toBe(0);
          shares += held;
        }
        expect(shares).toBe(RULES.issuedShares);
        expect(vaults[id]).toBe((RULES.primaryShares - primary[id]!) * RULES.primaryPriceMinor);
      }
      expect(cash).toBe(initialCash);
    };
    verifyBalances();
    // Three windows, at most fifteen accepted trades per team per window.
    for (let window = 1; window <= RULES.maxTradingWindows; window++) {
      for (let action = 0; action < RULES.tradesPerWindow; action++) {
        for (let investor = 0; investor < ids.length; investor++) {
          const id = ids[investor]!;
          const issuerId = ids[(investor + 1 + (action % (count - 1))) % count]!;
          const position = positions[id]![issuerId] ?? PortfolioAccounting.empty(issuerId);
          const side = position.shares > 0 && action % 3 === 2 ? 'SELL' : 'BUY';
          const quantity =
            side === 'SELL' ? Math.min(position.shares, 4) : Math.min(25 - position.shares, 3);
          if (quantity === 0) continue;
          const quote = new ConstantProductPool(pools[issuerId]!).quote(side, quantity);
          if (side === 'BUY' && quote.totalMinor > wallets[id]!.cashMinor) continue;
          positions[id]![issuerId] =
            side === 'BUY'
              ? PortfolioAccounting.buy(position, quantity, quote.totalMinor)
              : PortfolioAccounting.sell(position, quantity, quote.totalMinor);
          wallets[id]!.cashMinor += (side === 'BUY' ? -1 : 1) * quote.totalMinor;
          pools[issuerId] = quote.nextPool;
        }
      }
      verifyBalances();
    }
    const frozen = JSON.stringify({ wallets, pools, positions, vaults, primary });
    const issuerResults = ResultScorer.score(
      Object.fromEntries(ids.map((id, i) => [id, 100 - Math.floor(i / 2)])),
      ids,
    );
    const finalResults = ids.map((id) =>
      ResultScorer.portfolio(wallets[id]!, Object.values(positions[id]!), issuerResults),
    );
    expect(finalResults.every((result) => Number.isSafeInteger(result.valueMinor))).toBe(true);
    expect(JSON.stringify({ wallets, pools, positions, vaults, primary })).toBe(frozen);
    verifyBalances();
  });
});
