import { describe, expect, it, vi } from 'vitest';
import { CommandLane } from '../apps/functions/src/command-lane';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('CommandLane', () => {
  it('runs shared commands one at a time, in arrival order', async () => {
    const lane = new CommandLane();
    const first = deferred<string>();
    const started: string[] = [];
    const a = lane.run('joinFormationTeam', () => {
      started.push('a');
      return first.promise;
    });
    const b = lane.run('approveMembership', async () => {
      started.push('b');
      return 'b';
    });
    await tick();
    expect(started).toEqual(['a']);
    first.resolve('a');
    await expect(Promise.all([a, b])).resolves.toEqual(['a', 'b']);
    expect(started).toEqual(['a', 'b']);
  });

  it('keeps going after a rejected command, and reports it to its caller', async () => {
    const lane = new CommandLane();
    const failed = lane.run('joinFormationTeam', async () => {
      throw new Error('TEAM_FULL');
    });
    const next = lane.run('joinFormationTeam', async () => 'joined');
    await expect(failed).rejects.toThrow('TEAM_FULL');
    await expect(next).resolves.toBe('joined');
  });

  it('lets independent commands pass a busy queue', async () => {
    const lane = new CommandLane();
    const held = deferred();
    void lane.run('joinFormationTeam', () => held.promise);
    const work = vi.fn(async () => 'saved');
    for (const type of ['saveAllocation', 'saveBallot', 'readGeneral'])
      await expect(lane.run(type, work)).resolves.toBe('saved');
    expect(work).toHaveBeenCalledTimes(3);
    held.resolve();
  });

  it('stops waiting for a stuck command', async () => {
    const lane = new CommandLane(5);
    void lane.run('joinFormationTeam', () => new Promise(() => undefined));
    await expect(lane.run('joinFormationTeam', async () => 'next')).resolves.toBe('next');
  });
  it('does not release an entire backlog when the first command times out', async () => {
    vi.useFakeTimers();
    try {
      const lane = new CommandLane(100);
      const starts: number[] = [];
      const work = (n: number) => () => {
        starts.push(n);
        return new Promise<void>((resolve) => setTimeout(resolve, 150));
      };
      const requests = [0, 1, 2].map((n) => lane.run('joinFormationTeam', work(n)));
      await vi.advanceTimersByTimeAsync(101);
      expect(starts).toEqual([0, 1]);
      await vi.advanceTimersByTimeAsync(100);
      expect(starts).toEqual([0, 1, 2]);
      await vi.runAllTimersAsync();
      await Promise.all(requests);
    } finally {
      vi.useRealTimers();
    }
  });
});
