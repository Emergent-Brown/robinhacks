import { fromBigInt, invariant, safeInteger } from './errors.js';
import { RULES } from './rules.js';
import type { IssuerResult, Position, TeamResult, Wallet } from './types.js';

/** Judge scores use at most two decimal places; resulting ranks set scoring rates only. */
export class ResultScorer {
  static score(scores: Record<string, number>, eligibleIssuerIds: string[]): IssuerResult[] {
    invariant(
      eligibleIssuerIds.length > 0,
      'NO_ELIGIBLE_ISSUERS',
      'Cancel the event if no eligible projects remain.',
    );
    invariant(
      new Set(eligibleIssuerIds).size === eligibleIssuerIds.length,
      'INVALID_RESULTS',
      'Eligible issuer IDs must be unique.',
    );
    const eligible = new Set(eligibleIssuerIds);
    const ranked = eligibleIssuerIds
      .map((issuerId) => {
        const score = scores[issuerId];
        invariant(
          typeof score === 'number' &&
            Number.isFinite(score) &&
            score >= 0 &&
            score <= 100 &&
            /^\d+(?:\.\d{1,2})?$/.test(String(score)),
          'MISSING_SCORE',
          'Every eligible project needs a score from 0 to 100 with at most two decimal places.',
        );
        // Decimal normalization is used only for score ties, never credit calculations.
        const [whole = '0', decimal = ''] = String(score).split('.');
        const scoreUnits = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
        return { issuerId, score, scoreUnits };
      })
      .sort(
        (a, b) =>
          b.scoreUnits - a.scoreUnits ||
          (a.issuerId < b.issuerId ? -1 : a.issuerId > b.issuerId ? 1 : 0),
      );
    const results: IssuerResult[] = [];
    for (let start = 0; start < ranked.length;) {
      let end = start + 1;
      while (end < ranked.length && ranked[end]!.scoreUnits === ranked[start]!.scoreUnits) end++;
      const a = BigInt(start + 1);
      const b = BigInt(end);
      let priceMinor = RULES.singleIssuerMinor as number;
      if (ranked.length > 1) {
        const denominator = 2n * BigInt(ranked.length - 1);
        const numerator =
          BigInt(RULES.firstPlaceMinor) * denominator -
          BigInt(RULES.firstPlaceMinor - RULES.lastPlaceMinor) * (a + b - 2n);
        priceMinor = fromBigInt(
          (2n * numerator + denominator) / (2n * denominator),
          'Final share value',
        );
      }
      for (let i = start; i < end; i++)
        results.push({
          issuerId: ranked[i]!.issuerId,
          score: ranked[i]!.score,
          rank: start + 1,
          priceMinor,
          eligible: true,
        });
      start = end;
    }
    // Include excluded issuers present in the input so their holdings retain explicit zero values.
    for (const issuerId of Object.keys(scores)
      .filter((id) => !eligible.has(id))
      .sort()) {
      results.push({
        issuerId,
        score: Number.isFinite(scores[issuerId]) ? scores[issuerId]! : 0,
        rank: 0,
        priceMinor: 0,
        eligible: false,
      });
    }
    return results;
  }
  score(scores: Record<string, number>, eligibleIssuerIds: string[]): IssuerResult[] {
    return ResultScorer.score(scores, eligibleIssuerIds);
  }

  static portfolio(
    wallet: Wallet,
    positions: Position[],
    issuers: IssuerResult[],
    eligible = true,
  ): TeamResult {
    safeInteger(wallet.cashMinor, 'Frozen wallet credits');
    invariant(
      wallet.reservedSeedMinor === 0,
      'UNSETTLED_FUNDING',
      'Settle all funding reservations before final scoring.',
    );
    invariant(
      new Set(positions.map((p) => p.issuerId)).size === positions.length,
      'INVALID_POSITIONS',
      'A portfolio contains duplicate project positions.',
    );
    invariant(
      new Set(issuers.map((issuer) => issuer.issuerId)).size === issuers.length,
      'INVALID_RESULTS',
      'Locked results contain duplicate project prices.',
    );
    for (const position of positions) {
      safeInteger(position.shares, 'Frozen position shares');
      invariant(
        position.shares <= RULES.maxHoldingShares,
        'HOLDING_LIMIT',
        'A frozen position exceeds the project share cap.',
      );
      invariant(
        position.issuerId !== wallet.teamId || position.shares === 0,
        'SELF_INVESTMENT',
        'A team cannot hold its own project shares.',
      );
    }
    const prices = new Map(issuers.map((issuer) => [issuer.issuerId, issuer.priceMinor]));
    const holdings = positions
      .filter((position) => position.shares > 0)
      .map((position) => {
        safeInteger(position.shares, 'Frozen position shares');
        invariant(
          prices.has(position.issuerId),
          'MISSING_RESULT',
          'A held project is missing from the locked results.',
        );
        const priceMinor = safeInteger(prices.get(position.issuerId)!, 'Final share value');
        return {
          issuerId: position.issuerId,
          shares: position.shares,
          priceMinor,
          valueMinor: fromBigInt(
            BigInt(position.shares) * BigInt(priceMinor),
            'Holding final value',
          ),
        };
      });
    const valueMinor = fromBigInt(
      holdings.reduce((sum, h) => sum + BigInt(h.valueMinor), BigInt(wallet.cashMinor)),
      'Final portfolio value',
    );
    return {
      teamId: wallet.teamId,
      cashMinor: wallet.cashMinor,
      valueMinor,
      profitMinor: valueMinor - RULES.initialWalletMinor,
      holdings,
      rank: 0,
      eligible,
    };
  }
}
