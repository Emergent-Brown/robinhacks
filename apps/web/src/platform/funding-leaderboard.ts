import type { FundingRound } from '@robinhacks/core';

export interface FundingStanding {
  teamId: string;
  name: string;
  credits: number;
  rank: number;
}

type RoundTotals = Pick<FundingRound, 'state' | 'eligibleTeamIds' | 'totals'>;

/** Rank integer credit × basis-point totals before converting to weighted credits. */
export function totalFundingLeaderboard(
  rounds: (RoundTotals & Pick<FundingRound, 'weightBps'>)[],
  nameFor: (teamId: string) => string,
): FundingStanding[] {
  const totals = new Map<string, number>();
  for (const round of rounds) {
    for (const row of fundingLeaderboard(round, nameFor)) {
      totals.set(row.teamId, (totals.get(row.teamId) ?? 0) + row.credits * round.weightBps);
    }
  }
  return fundingLeaderboard(
    { state: 'closed', eligibleTeamIds: [...totals.keys()], totals: Object.fromEntries(totals) },
    nameFor,
  ).map((row) => ({ ...row, credits: row.credits / 10000 }));
}

/** Competition ranks: equal totals share a place (1, 1, 3). Names only order ties. */
export function fundingLeaderboard(
  round: RoundTotals,
  nameFor: (teamId: string) => string,
): FundingStanding[] {
  // An empty totals map can mean the server withheld results from a blind judge.
  if (round.state !== 'closed' || Object.keys(round.totals).length === 0) return [];
  const rows = round.eligibleTeamIds
    .map((teamId) => ({
      teamId,
      name: nameFor(teamId),
      credits: round.totals[teamId] ?? 0,
      rank: 0,
    }))
    .sort(
      (a, b) =>
        b.credits - a.credits || a.name.localeCompare(b.name) || a.teamId.localeCompare(b.teamId),
    );
  for (const [index, row] of rows.entries()) {
    row.rank =
      index > 0 && row.credits === rows[index - 1].credits ? rows[index - 1].rank : index + 1;
  }
  return rows;
}
