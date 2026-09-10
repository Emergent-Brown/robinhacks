import { fromBigInt, invariant, safeInteger } from './errors.js';
import type { Pool, Quote } from './types.js';

/** Pure pricing. Authorization, wallet limits, and atomic persistence are application responsibilities. */
export class ConstantProductPool {
  private readonly state: Readonly<Pool>;
  constructor(pool: Pool) {
    safeInteger(pool.shareReserve, 'Pool shares', 1);
    safeInteger(pool.creditReserveMinor, 'Pool credits', 1);
    safeInteger(pool.version, 'Pool version');
    this.state = Object.freeze({ ...pool });
  }

  quote(side: 'BUY' | 'SELL', shares: number): Quote {
    invariant(side === 'BUY' || side === 'SELL', 'INVALID_SIDE', 'Choose buy or sell.');
    safeInteger(shares, 'Shares', 1);
    invariant(!this.state.halted, 'ISSUER_HALTED', 'Trading is halted for this project.');
    const x = BigInt(this.state.shareReserve);
    const y = BigInt(this.state.creditReserveMinor);
    const q = BigInt(shares);
    invariant(
      side !== 'BUY' || q < x,
      'POOL_LIQUIDITY',
      'The pool cannot supply that many shares.',
    );
    const denominator = side === 'BUY' ? x - q : x + q;
    const numerator = y * q;
    const amount =
      side === 'BUY' ? (numerator + denominator - 1n) / denominator : numerator / denominator;
    invariant(amount > 0n, 'ZERO_TRADE', 'This trade is too small to receive a credit amount.');
    const totalMinor = fromBigInt(amount, 'Trade amount');
    const nextX = side === 'BUY' ? x - q : x + q;
    const nextY = side === 'BUY' ? y + amount : y - amount;
    invariant(
      nextX > 0n && nextY > 0n && nextX * nextY >= x * y,
      'POOL_INVARIANT',
      'The pool would become invalid.',
    );
    const nextPool: Pool = {
      ...this.state,
      shareReserve: fromBigInt(nextX, 'Pool shares'),
      creditReserveMinor: fromBigInt(nextY, 'Pool credits'),
      version: fromBigInt(BigInt(this.state.version) + 1n, 'Pool version'),
    };
    // Floating point values below are explicitly presentation-only.
    const averagePriceMinor = totalMinor / shares;
    const spot = this.state.creditReserveMinor / this.state.shareReserve;
    const impactPercent = Math.abs(averagePriceMinor / spot - 1) * 100;
    return { side, shares, totalMinor, averagePriceMinor, impactPercent, nextPool };
  }
}
