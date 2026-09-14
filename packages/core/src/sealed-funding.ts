import { fromBigInt, invariant, safeInteger } from './errors';
import type { FundingRound, FundingSettings, RoundAllocation, RoundEntitlement } from './platform';

interface Fraction {
  numerator: bigint;
  denominator: bigint;
}

/** Reward claims are rational values. Floating point is used only for display percentages. */
function add(left: Fraction, right: Fraction): Fraction {
  const numerator = left.numerator * right.denominator + right.numerator * left.denominator;
  const denominator = left.denominator * right.denominator;
  let a = numerator;
  let b = denominator;
  while (b !== 0n) [a, b] = [b, a % b];
  return { numerator: numerator / a, denominator: denominator / a };
}

export interface FundingPayoff {
  investors: Array<{ teamId: string; rewardMinor: number; entitlementPercent: number }>;
  investorPaidMinor: number;
  reserveMinor: number;
}

/** Independent, non-diluting reward tranches; credits never become cash or tradable shares. */
export class SealedFunding {
  static validateSettings(settings: FundingSettings): void {
    const { budget, increment, maxPerProject, minimumDenominator, roundWeightsBps } = settings;
    [budget, increment, maxPerProject, minimumDenominator].forEach((value) =>
      safeInteger(value, 'Funding setting', 1),
    );
    invariant(
      budget <= 10_000 && minimumDenominator <= 1_000_000,
      'INVALID_RULES',
      'Funding limits are too large.',
    );
    invariant(
      budget % increment === 0 && maxPerProject % increment === 0 && maxPerProject < budget,
      'INVALID_RULES',
      'The budget and project limit must be multiples of the increment, with the project limit below the budget.',
    );
    invariant(
      minimumDenominator >= budget,
      'INVALID_RULES',
      'The minimum denominator must cover at least one team budget.',
    );
    invariant(
      settings.roundNames.length === 3 &&
        settings.roundNames.every((name) => name.trim().length > 0) &&
        roundWeightsBps.length === 3 &&
        roundWeightsBps.every((weight) => Number.isSafeInteger(weight) && weight > 0) &&
        roundWeightsBps.reduce((sum, weight) => sum + weight, 0) === 10_000,
      'INVALID_RULES',
      'Three named rounds must reserve exactly 100% of the investor pool.',
    );
    safeInteger(settings.investorPoolMinor, 'Investor prize pool');
    invariant(
      settings.builderPrizesMinor.length === 3,
      'INVALID_RULES',
      'Configure three builder prizes.',
    );
    settings.builderPrizesMinor.forEach((amount) => safeInteger(amount, 'Builder prize'));
    safeInteger(settings.communityPrizeMinor, 'Community prize');
    invariant(
      settings.currency === 'USD' && settings.reservePolicy.trim().length > 0,
      'INVALID_RULES',
      'Specify the currency and unused reward policy.',
    );
    invariant(
      Number.isInteger(settings.reviewMinutes) &&
        settings.reviewMinutes >= 1 &&
        settings.reviewMinutes <= 10_080,
      'INVALID_RULES',
      'Set a results review period between one minute and seven days.',
    );
    invariant(
      settings.rubric.length > 0 &&
        settings.rubric.length <= 10 &&
        new Set(settings.rubric.map((item) => item.id)).size === settings.rubric.length &&
        settings.rubric.every(
          (item) =>
            item.id.length > 0 &&
            item.label.trim().length > 0 &&
            Number.isInteger(item.weight) &&
            item.weight > 0,
        ) &&
        settings.rubric.reduce((sum, item) => sum + item.weight, 0) === 100,
      'INVALID_RULES',
      'Judging criteria must be unique and their weights must add up to 100%.',
    );
  }

  static validateAllocation(
    teamId: string,
    amounts: Record<string, number>,
    eligibleTeamIds: string[],
    settings: FundingSettings,
  ): Record<string, number> {
    this.validateSettings(settings);
    invariant(
      eligibleTeamIds.includes(teamId),
      'TEAM_INACTIVE',
      'Your team is not eligible for this round.',
    );
    invariant(
      Object.keys(amounts).length <= 30,
      'TEAM_LIMIT',
      'An allocation has too many projects.',
    );
    const clean: Array<[string, number]> = [];
    let spent = 0;
    for (const [projectId, amount] of Object.entries(amounts).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      safeInteger(amount, 'Allocation');
      invariant(
        projectId !== teamId,
        'SELF_INVESTMENT',
        'You can allocate credits only to other teams.',
      );
      invariant(
        eligibleTeamIds.includes(projectId),
        'TEAM_INACTIVE',
        'A selected project is not eligible for this round.',
      );
      invariant(
        amount % settings.increment === 0,
        'INVALID_INCREMENT',
        `Allocate credits in increments of ${settings.increment}.`,
      );
      invariant(
        amount <= settings.maxPerProject,
        'PROJECT_LIMIT',
        `Allocate at most ${settings.maxPerProject} credits to one project.`,
      );
      spent += amount;
      if (amount > 0) clean.push([projectId, amount]);
    }
    invariant(
      spent <= settings.budget,
      'BUDGET_EXCEEDED',
      'This allocation exceeds your round budget.',
    );
    return Object.fromEntries(clean);
  }

  static closeRound(
    round: FundingRound,
    allocations: RoundAllocation[],
    settings: FundingSettings,
    now: number,
  ): { round: FundingRound; entitlements: RoundEntitlement[] } {
    this.validateSettings(settings);
    invariant(round.state === 'open', 'ROUND_CLOSED', 'This round has already closed.');
    invariant(
      now >= round.closesAt,
      'ROUND_NOT_DUE',
      'Every team has until the published deadline to allocate.',
    );
    invariant(
      Number.isInteger(round.number) &&
        round.number >= 1 &&
        round.number <= 3 &&
        round.weightBps === settings.roundWeightsBps[round.number - 1] &&
        round.minimumDenominator === settings.minimumDenominator,
      'RECONCILIATION_FAILED',
      'The round does not match its frozen funding rules.',
    );
    invariant(
      round.eligibleTeamIds.length >= 2 &&
        round.eligibleTeamIds.length <= 30 &&
        new Set(round.eligibleTeamIds).size === round.eligibleTeamIds.length,
      'RECONCILIATION_FAILED',
      'The frozen round roster is invalid.',
    );
    const sheets = new Map<string, Record<string, number>>();
    const totals = Object.fromEntries(round.eligibleTeamIds.map((id) => [id, 0]));
    for (const allocation of allocations) {
      invariant(
        allocation.roundId === round.id &&
          allocation.id === `${round.id}__${allocation.teamId}` &&
          !sheets.has(allocation.teamId),
        'RECONCILIATION_FAILED',
        'A funding sheet has an inconsistent identity.',
      );
      const amounts = this.validateAllocation(
        allocation.teamId,
        allocation.amounts,
        round.eligibleTeamIds,
        settings,
      );
      sheets.set(allocation.teamId, amounts);
      for (const [projectId, amount] of Object.entries(amounts)) totals[projectId] += amount;
    }
    const entitlements = round.eligibleTeamIds.map((teamId): RoundEntitlement => {
      const amounts = sheets.get(teamId) ?? {};
      const spent = Object.values(amounts).reduce((sum, amount) => sum + amount, 0);
      return {
        id: `${round.id}__${teamId}`,
        roundId: round.id,
        roundNumber: round.number,
        teamId,
        awardedAt: now,
        spent,
        expired: settings.budget - spent,
        voided: false,
        projects: Object.entries(amounts).map(([projectId, credits]) => ({
          projectId,
          credits,
          total: totals[projectId],
          denominator: Math.max(round.minimumDenominator, totals[projectId]),
          weightBps: round.weightBps,
        })),
      };
    });
    return {
      round: { ...round, state: 'closed', totals, closedAt: now, version: round.version + 1 },
      entitlements,
    };
  }

  static payoff(
    entitlements: RoundEntitlement[],
    winnerId: string,
    investorPoolMinor: number,
  ): FundingPayoff {
    safeInteger(investorPoolMinor, 'Investor prize pool');
    invariant(entitlements.length <= 90, 'TEAM_LIMIT', 'Too many round entitlements.');
    const claims = new Map<string, Fraction>();
    const seen = new Set<string>();
    const roundTerms = new Map<
      number,
      { id: string; weight: number; total: number; denominator: number; credits: number }
    >();
    for (const entitlement of entitlements) {
      if (!claims.has(entitlement.teamId))
        claims.set(entitlement.teamId, { numerator: 0n, denominator: 1n });
      if (entitlement.voided) continue;
      const identity = `${entitlement.roundNumber}__${entitlement.teamId}`;
      invariant(
        !seen.has(identity),
        'RECONCILIATION_FAILED',
        'A team has duplicate round entitlements.',
      );
      seen.add(identity);
      invariant(
        Number.isInteger(entitlement.roundNumber) &&
          entitlement.roundNumber >= 1 &&
          entitlement.roundNumber <= 3,
        'RECONCILIATION_FAILED',
        'An entitlement has an invalid round.',
      );
      const projects = entitlement.projects.filter((project) => project.projectId === winnerId);
      invariant(
        projects.length <= 1,
        'RECONCILIATION_FAILED',
        'An entitlement repeats the winning project.',
      );
      if (!projects.length) continue;
      const project = projects[0];
      [project.credits, project.total, project.denominator, project.weightBps].forEach((value) =>
        safeInteger(value, 'Reward term', 1),
      );
      invariant(
        entitlement.teamId !== winnerId &&
          project.credits <= project.total &&
          project.total <= project.denominator &&
          project.weightBps <= 10_000,
        'RECONCILIATION_FAILED',
        'A reward claim is inconsistent with its allocation.',
      );
      const terms = roundTerms.get(entitlement.roundNumber);
      if (terms) {
        invariant(
          terms.id === entitlement.roundId &&
            terms.weight === project.weightBps &&
            terms.total === project.total &&
            terms.denominator === project.denominator,
          'RECONCILIATION_FAILED',
          'Round reward terms do not agree.',
        );
        terms.credits += project.credits;
      } else {
        roundTerms.set(entitlement.roundNumber, {
          id: entitlement.roundId,
          weight: project.weightBps,
          total: project.total,
          denominator: project.denominator,
          credits: project.credits,
        });
      }
      const sum = add(claims.get(entitlement.teamId)!, {
        numerator: BigInt(project.weightBps) * BigInt(project.credits),
        denominator: 10_000n * BigInt(project.denominator),
      });
      claims.set(entitlement.teamId, sum);
    }
    invariant(
      [...roundTerms.values()].reduce((sum, term) => sum + term.weight, 0) <= 10_000 &&
        [...roundTerms.values()].every((term) => term.credits <= term.total),
      'RECONCILIATION_FAILED',
      'The total claims exceed the available reward tranches.',
    );
    const investors = [...claims]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([teamId, claim]) => ({
        teamId,
        rewardMinor: fromBigInt(
          (BigInt(investorPoolMinor) * claim.numerator) / claim.denominator,
          'Investor reward',
        ),
        entitlementPercent: (Number(claim.numerator) * 100) / Number(claim.denominator),
      }));
    const total = investors.reduce((sum, investor) => sum + BigInt(investor.rewardMinor), 0n);
    invariant(
      total <= BigInt(investorPoolMinor),
      'RECONCILIATION_FAILED',
      'Investor rewards exceed the reserved pool.',
    );
    return {
      investors,
      investorPaidMinor: Number(total),
      reserveMinor: investorPoolMinor - Number(total),
    };
  }
}
