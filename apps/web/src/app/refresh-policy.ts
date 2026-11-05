import type { AppSnapshot, EventConfig } from '@robinhacks/core';

/** When an open client should refetch. The room shares these numbers, so they set peak load. */
export const REFRESH = Object.freeze({
  /** A phase change (round opens, note posted) reaches everyone within this spread. */
  phaseSpreadMs: 2500,
  /** Team selection and organizer screens follow signups and joins at this pace. */
  rosterGapMs: 20_000,
  /** Other teams' profile edits can wait; the Refresh button shows them sooner. */
  teamsGapMs: 120_000,
  teamsSpreadMs: 30_000,
  /** Returning to a tab reuses data this recent, and listeners catch any phase change. */
  freshForMs: 120_000,
  retries: 3,
  retryBaseMs: 1000,
  retryMaxMs: 10_000,
});

export type EventChange = 'none' | 'phase' | 'roster';

export function classifyEventChange(
  previous: Pick<EventConfig, 'phaseVersion' | 'rosterVersion'> | null | undefined,
  next: Pick<EventConfig, 'phaseVersion' | 'rosterVersion'>,
): EventChange {
  if (next.phaseVersion !== previous?.phaseVersion) return 'phase';
  return (next.rosterVersion ?? 0) === (previous?.rosterVersion ?? 0) ? 'none' : 'roster';
}

/** True when a listener saw a newer phase than the snapshot that was just loaded. */
export function missedPhaseChange(
  loaded: Pick<EventConfig, 'phaseVersion'> | null | undefined,
  latest: Pick<EventConfig, 'phaseVersion'> | null | undefined,
): boolean {
  return !!loaded && !!latest && latest.phaseVersion > loaded.phaseVersion;
}

/** Only people choosing a team, and organizers, act on the live roster. */
export function followsRoster(snapshot: AppSnapshot | null): boolean {
  const member = snapshot?.member;
  if (member?.status !== 'approved') return false;
  if (member.role === 'organizer') return true;
  return (
    !member.teamId &&
    member.role !== 'judge' &&
    snapshot?.event?.platform?.teamFormationOpen === true
  );
}

interface SchedulerClock {
  now(): number;
  random(): number;
  setTimer(run: () => void, ms: number): unknown;
  clearTimer(timer: unknown): void;
}
const systemClock: SchedulerClock = {
  now: () => Date.now(),
  random: () => Math.random(),
  setTimer: (run, ms) => setTimeout(run, ms),
  clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

/** Keeps at most one reload waiting, so bursts of changes collapse into a single fetch. */
export class ReloadScheduler {
  private timer: unknown = null;
  private dueAt = 0;
  private lastLoadAt = 0;
  constructor(
    private readonly reload: () => void,
    private readonly clock: SchedulerClock = systemClock,
  ) {}
  /** A change everyone needs promptly; random spread stops the room arriving at once. */
  soon(spreadMs: number = REFRESH.phaseSpreadMs) {
    this.schedule(this.clock.now() + this.clock.random() * spreadMs);
  }
  /** A change that can wait, limited to one reload per gap. */
  atMostEvery(gapMs: number, spreadMs = 0) {
    const earliest = Math.max(this.clock.now(), this.lastLoadAt + gapMs);
    this.schedule(earliest + this.clock.random() * spreadMs);
  }
  /** Any load satisfies what is waiting; changes arriving after this schedule a new one. */
  loading() {
    this.lastLoadAt = this.clock.now();
    this.cancel();
  }
  /** Returns true if a reload was waiting. */
  cancel(): boolean {
    if (this.timer === null) return false;
    this.clock.clearTimer(this.timer);
    this.timer = null;
    return true;
  }
  private schedule(at: number) {
    if (this.timer !== null) {
      if (at >= this.dueAt) return;
      this.clock.clearTimer(this.timer);
    }
    this.dueAt = at;
    this.timer = this.clock.setTimer(
      () => {
        this.timer = null;
        this.reload();
      },
      Math.max(0, at - this.clock.now()),
    );
  }
}

const transientReads = new Set([
  'functions/unavailable',
  'functions/deadline-exceeded',
  'functions/internal',
  'functions/aborted',
  'functions/resource-exhausted',
  'RATE_LIMITED',
  'RETRYABLE_CONTENTION',
  'INTERNAL_ERROR',
]);
/** Commands repeat only with their original ID; receipts make that safe. Rate limits stand. */
const transientCommands = new Set([
  'functions/unavailable',
  'functions/deadline-exceeded',
  'functions/aborted',
  'RETRYABLE_CONTENTION',
]);
interface Failure {
  code?: string;
  retryAfterMs?: number;
}
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(
  kind: 'read' | 'command',
  work: () => Promise<T>,
  sleep: (ms: number) => Promise<void> = wait,
  random: () => number = Math.random,
): Promise<T> {
  const transient = kind === 'read' ? transientReads : transientCommands;
  for (let attempt = 0; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      const failure = error as Failure;
      if (attempt >= REFRESH.retries || !transient.has(failure.code ?? '')) throw error;
      const backoff = REFRESH.retryBaseMs * 2 ** attempt * (1 + random());
      await sleep(Math.min(REFRESH.retryMaxMs, Math.max(backoff, failure.retryAfterMs ?? 0)));
    }
  }
}
