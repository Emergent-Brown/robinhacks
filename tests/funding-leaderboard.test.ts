import { describe, expect, it } from 'vitest';
import { fundingLeaderboard } from '../apps/web/src/platform/funding-leaderboard';

const round = {
  state: 'closed' as const,
  eligibleTeamIds: ['zero-b', 'second', 'winner-b', 'zero-a', 'winner-a'],
  totals: { 'winner-a': 100, 'winner-b': 100, second: 30, 'zero-a': 0, 'zero-b': 0, outsider: 999 },
};
const nameFor = (id: string) => id;

describe('funding leaderboard', () => {
  it('ranks eligible teams by received credits with shared places, including zero-credit ties', () => {
    const original = structuredClone(round);
    expect(
      fundingLeaderboard(round, nameFor).map(({ teamId, credits, rank }) => ({
        teamId,
        credits,
        rank,
      })),
    ).toEqual([
      { teamId: 'winner-a', credits: 100, rank: 1 },
      { teamId: 'winner-b', credits: 100, rank: 1 },
      { teamId: 'second', credits: 30, rank: 3 },
      { teamId: 'zero-a', credits: 0, rank: 4 },
      { teamId: 'zero-b', credits: 0, rank: 4 },
    ]);
    expect(round).toEqual(original);
  });
  it('does not rank open, voided, or withheld results', () => {
    expect(fundingLeaderboard({ ...round, state: 'open' }, nameFor)).toEqual([]);
    expect(fundingLeaderboard({ ...round, state: 'void' }, nameFor)).toEqual([]);
    expect(fundingLeaderboard({ ...round, totals: {} }, nameFor)).toEqual([]);
  });
  it('uses names to order tied teams without breaking the tie', () => {
    expect(
      fundingLeaderboard(round, (id) => (id === 'winner-b' ? 'Alpha' : id))
        .slice(0, 2)
        .map((row) => [row.teamId, row.rank]),
    ).toEqual([
      ['winner-b', 1],
      ['winner-a', 1],
    ]);
  });
});
