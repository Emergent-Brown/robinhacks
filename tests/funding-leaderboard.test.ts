import { describe, expect, it } from 'vitest';
import {
  fundingLeaderboard,
  totalFundingLeaderboard,
} from '../apps/web/src/platform/funding-leaderboard';

const round = {
  weightBps: 10000,
  state: 'closed' as const,
  eligibleTeamIds: ['zero-b', 'second', 'winner-b', 'zero-a', 'winner-a'],
  totals: { 'winner-a': 100, 'winner-b': 100, second: 30, 'zero-a': 0, 'zero-b': 0, outsider: 999 },
};
const nameFor = (id: string) => id;

describe('funding leaderboard', () => {
  it('ranks weighted credits across rounds, including teams that joined later', () => {
    const rounds: Parameters<typeof totalFundingLeaderboard>[0] = [
      {
        state: 'closed' as const,
        weightBps: 4000,
        eligibleTeamIds: ['alpha', 'beta', 'zero'],
        totals: { alpha: 100, beta: 60, zero: 0, outsider: 999 },
      },
      {
        state: 'closed' as const,
        weightBps: 3500,
        eligibleTeamIds: ['alpha', 'beta', 'late', 'zero'],
        totals: { alpha: 10, beta: 80, late: 110, zero: 0 },
      },
    ];
    const original = structuredClone(rounds);
    expect(
      totalFundingLeaderboard(rounds, nameFor).map(({ teamId, credits, rank }) => ({
        teamId,
        credits,
        rank,
      })),
    ).toEqual([
      { teamId: 'beta', credits: 52, rank: 1 },
      { teamId: 'alpha', credits: 43.5, rank: 2 },
      { teamId: 'late', credits: 38.5, rank: 3 },
      { teamId: 'zero', credits: 0, rank: 4 },
    ]);
    expect(fundingLeaderboard(rounds[0], nameFor)[0].teamId).toBe('alpha');
    expect(fundingLeaderboard(rounds[1], nameFor)[0].teamId).toBe('late');
    expect(rounds).toEqual(original);
  });
  it('lets weights change the winner while retaining raw per-round rankings', () => {
    const early = {
      ...round,
      weightBps: 4000,
      eligibleTeamIds: ['a', 'b'],
      totals: { a: 100, b: 0 },
    };
    const later = { ...early, weightBps: 3500, totals: { a: 0, b: 110 } };
    expect(
      totalFundingLeaderboard([early, later], nameFor).map((row) => [
        row.teamId,
        row.credits,
        row.rank,
      ]),
    ).toEqual([
      ['a', 40, 1],
      ['b', 38.5, 2],
    ]);
    expect(fundingLeaderboard(later, nameFor)[0].credits).toBe(110);
  });
  it('preserves exact weighted ties instead of accumulating floating-point errors', () => {
    const early = {
      ...round,
      weightBps: 3333,
      eligibleTeamIds: ['a', 'b'],
      totals: { a: 3, b: 1 },
    };
    const later = { ...early, totals: { a: 0, b: 2 } };
    expect(
      totalFundingLeaderboard([early, later], nameFor).map((row) => [row.credits, row.rank]),
    ).toEqual([
      [0.9999, 1],
      [0.9999, 1],
    ]);
  });
  it('excludes open, voided and withheld rounds from cumulative totals', () => {
    expect(
      totalFundingLeaderboard(
        [round, { ...round, state: 'open' }, { ...round, state: 'void' }, { ...round, totals: {} }],
        nameFor,
      ),
    ).toEqual(fundingLeaderboard(round, nameFor));
    expect(totalFundingLeaderboard([], nameFor)).toEqual([]);
    expect(totalFundingLeaderboard([{ ...round, totals: {} }], nameFor)).toEqual([]);
  });
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
