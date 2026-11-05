import { describe, expect, it, vi } from 'vitest';
import type { AppSnapshot, Member } from '@robinhacks/core';
import {
  classifyEventChange,
  followsRoster,
  missedPhaseChange,
  REFRESH,
  ReloadScheduler,
  withRetry,
} from '../apps/web/src/app/refresh-policy';

function harness(random = 0.5) {
  let now = 1_000_000;
  const timers = new Map<number, { at: number; run: () => void }>();
  let id = 0;
  const reload = vi.fn();
  const scheduler = new ReloadScheduler(reload, {
    now: () => now,
    random: () => random,
    setTimer: (run, ms) => {
      timers.set(++id, { at: now + ms, run });
      return id;
    },
    clearTimer: (timer) => timers.delete(timer as number),
  });
  const advance = (ms: number) => {
    now += ms;
    for (const [key, timer] of [...timers])
      if (timer.at <= now) {
        timers.delete(key);
        timer.run();
      }
  };
  return { scheduler, reload, advance, waiting: () => timers.size };
}
const person = (member: Partial<Member>, teamFormationOpen = true) =>
  ({
    member: { status: 'approved', role: 'member', teamId: null, ...member },
    event: { platform: { teamFormationOpen } },
  }) as AppSnapshot;

describe('deciding what a change means', () => {
  it('separates phase changes, roster changes and everything else', () => {
    const base = { phaseVersion: 5, rosterVersion: 2 };
    expect(classifyEventChange(base, { phaseVersion: 6, rosterVersion: 2 })).toBe('phase');
    expect(classifyEventChange(base, { phaseVersion: 5, rosterVersion: 3 })).toBe('roster');
    expect(classifyEventChange(base, base)).toBe('none');
    expect(classifyEventChange({ phaseVersion: 5 }, { phaseVersion: 5 })).toBe('none');
    expect(classifyEventChange(null, base)).toBe('phase');
  });

  it('notices a phase that changed while a load was in flight', () => {
    expect(missedPhaseChange({ phaseVersion: 5 }, { phaseVersion: 6 })).toBe(true);
    expect(missedPhaseChange({ phaseVersion: 6 }, { phaseVersion: 5 })).toBe(false);
    expect(missedPhaseChange({ phaseVersion: 5 }, null)).toBe(false);
  });

  it('sends roster updates only to people choosing a team and organizers', () => {
    expect(followsRoster(person({}))).toBe(true);
    expect(followsRoster(person({}, false))).toBe(false);
    expect(followsRoster(person({ teamId: 'team-1' }))).toBe(false);
    expect(followsRoster(person({ role: 'judge' }))).toBe(false);
    expect(followsRoster(person({ status: 'pending' }))).toBe(false);
    expect(followsRoster(person({ role: 'organizer' }, false))).toBe(true);
  });
});

describe('ReloadScheduler', () => {
  it('collapses a burst of changes into one reload inside the spread', () => {
    const { scheduler, reload, advance, waiting } = harness();
    for (let i = 0; i < 20; i++) scheduler.soon();
    expect(waiting()).toBe(1);
    advance(REFRESH.phaseSpreadMs);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('lets an urgent change overtake one that was happy to wait', () => {
    const { scheduler, reload, advance } = harness();
    scheduler.loading();
    scheduler.atMostEvery(REFRESH.teamsGapMs);
    scheduler.soon();
    advance(REFRESH.phaseSpreadMs);
    expect(reload).toHaveBeenCalledTimes(1);
    advance(REFRESH.teamsGapMs);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('limits slow changes to one reload per gap', () => {
    const { scheduler, reload, advance } = harness(0);
    scheduler.loading();
    scheduler.atMostEvery(REFRESH.rosterGapMs);
    advance(REFRESH.rosterGapMs - 1);
    expect(reload).not.toHaveBeenCalled();
    advance(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('drops a waiting reload once a load starts, and reports cancelling it', () => {
    const { scheduler, reload, advance } = harness();
    scheduler.soon();
    scheduler.loading();
    advance(60_000);
    expect(reload).not.toHaveBeenCalled();
    expect(scheduler.cancel()).toBe(false);
    scheduler.soon();
    expect(scheduler.cancel()).toBe(true);
  });
});

describe('withRetry', () => {
  const failing = (code: string, retryAfterMs?: number) =>
    Object.assign(new Error(code), { code, retryAfterMs });

  it('retries a read through a brief failure', async () => {
    const work = vi
      .fn()
      .mockRejectedValueOnce(failing('functions/unavailable'))
      .mockResolvedValue(1);
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(withRetry('read', work, sleep, () => 0)).resolves.toBe(1);
    expect(work).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(REFRESH.retryBaseMs);
  });

  it('gives up after its retries and surfaces the original error', async () => {
    const error = failing('functions/unavailable');
    const work = vi.fn().mockRejectedValue(error);
    await expect(withRetry('read', work, async () => undefined)).rejects.toBe(error);
    expect(work).toHaveBeenCalledTimes(REFRESH.retries + 1);
  });

  it('honours a server wait, within the cap', async () => {
    const work = vi
      .fn()
      .mockRejectedValueOnce(failing('RATE_LIMITED', 45_000))
      .mockResolvedValue(1);
    const sleep = vi.fn().mockResolvedValue(undefined);
    await withRetry('read', work, sleep, () => 0);
    expect(sleep).toHaveBeenCalledWith(REFRESH.retryMaxMs);
  });

  it('never retries a rule rejection or a rate-limited command', async () => {
    for (const code of ['ROUND_CLOSED', 'ALLOCATION_CHANGED', 'RATE_LIMITED']) {
      const work = vi.fn().mockRejectedValue(failing(code));
      await expect(withRetry('command', work, async () => undefined)).rejects.toThrow(code);
      expect(work).toHaveBeenCalledTimes(1);
    }
  });

  it('retries contention on a command', async () => {
    const work = vi
      .fn()
      .mockRejectedValueOnce(failing('RETRYABLE_CONTENTION'))
      .mockResolvedValue({ message: 'ok' });
    await withRetry('command', work, async () => undefined);
    expect(work).toHaveBeenCalledTimes(2);
  });
});
