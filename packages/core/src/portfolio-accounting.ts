import { fromBigInt, invariant, safeInteger } from './errors.js';
import { RULES } from './rules.js';
import type { Position, Wallet } from './types.js';

/** Position history uses exact average cost; every method returns a new value. */
export class PortfolioAccounting {
  static empty(issuerId: string): Position {
    return { issuerId, shares: 0, costBasisMinor: 0, realizedPnlMinor: 0, version: 0 };
  }
  static validate(position: Position): void {
    safeInteger(position.shares, 'Position shares');
    safeInteger(position.costBasisMinor, 'Cost basis');
    safeInteger(position.version, 'Position version');
    invariant(
      Number.isSafeInteger(position.realizedPnlMinor),
      'INVALID_AMOUNT',
      'Realized return must be a safe whole number.',
    );
    invariant(
      position.shares !== 0 || position.costBasisMinor === 0,
      'INVALID_POSITION',
      'An empty position must have zero acquisition cost.',
    );
  }
  static availableCash(wallet: Wallet): number {
    safeInteger(wallet.cashMinor, 'Wallet credits');
    safeInteger(wallet.reservedSeedMinor, 'Reserved credits');
    invariant(
      wallet.reservedSeedMinor <= wallet.cashMinor,
      'INVALID_WALLET',
      'Reserved credits exceed wallet credits.',
    );
    return wallet.cashMinor - wallet.reservedSeedMinor;
  }
  static buy(position: Position, shares: number, debitMinor: number): Position {
    this.validate(position);
    safeInteger(shares, 'Shares', 1);
    safeInteger(debitMinor, 'Purchase debit', 1);
    const totalShares = fromBigInt(BigInt(position.shares) + BigInt(shares), 'Position shares');
    invariant(
      totalShares <= RULES.maxHoldingShares,
      'HOLDING_LIMIT',
      `A team can hold at most ${RULES.maxHoldingShares} shares in a project.`,
    );
    return {
      ...position,
      shares: totalShares,
      costBasisMinor: fromBigInt(
        BigInt(position.costBasisMinor) + BigInt(debitMinor),
        'Cost basis',
      ),
      version: fromBigInt(BigInt(position.version) + 1n, 'Position version'),
    };
  }
  static sell(position: Position, shares: number, proceedsMinor: number): Position {
    this.validate(position);
    safeInteger(shares, 'Shares', 1);
    safeInteger(proceedsMinor, 'Sale proceeds', 1);
    invariant(
      shares <= position.shares,
      'INSUFFICIENT_SHARES',
      'You cannot sell more shares than your team holds.',
    );
    const removedBasis =
      shares === position.shares
        ? BigInt(position.costBasisMinor)
        : (BigInt(position.costBasisMinor) * BigInt(shares)) / BigInt(position.shares);
    return {
      ...position,
      shares: position.shares - shares,
      costBasisMinor: fromBigInt(BigInt(position.costBasisMinor) - removedBasis, 'Cost basis'),
      realizedPnlMinor: fromBigInt(
        BigInt(position.realizedPnlMinor) + BigInt(proceedsMinor) - removedBasis,
        'Realized return',
        true,
      ),
      version: fromBigInt(BigInt(position.version) + 1n, 'Position version'),
    };
  }
}
