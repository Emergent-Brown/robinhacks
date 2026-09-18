import { describe, expect, it } from 'vitest';
import { defaultEventDetails, EventSchedule } from '@robinhacks/core';

describe('event schedule', () => {
  it('fits three windows, final submissions, voting and a 30-minute review before Sunday awards', () => {
    const timing = defaultEventDetails().timing!;
    EventSchedule.validate(timing);
    expect(timing.rounds.map(EventSchedule.minutes)).toEqual([30, 30, 30]);
    expect(EventSchedule.inputValue(timing.rounds[1].closesAt, 'America/New_York')).toBe(
      '2026-09-26T21:30',
    );
    expect(timing.submissions.closesAt).toBeLessThan(Date.parse('2026-09-27T11:00:00-04:00'));
    expect(timing.ballot.closesAt + 30 * 60_000).toBe(Date.parse('2026-09-27T13:15:00-04:00'));
  });

  it('uses the event zone rather than the browser zone across UTC midnight', () => {
    expect(EventSchedule.parseInput('2026-09-26T21:00', 'America/New_York')).toBe(
      Date.parse('2026-09-27T01:00:00Z'),
    );
    expect(
      EventSchedule.inputValue(Date.parse('2026-09-27T01:00:00Z'), 'America/Los_Angeles'),
    ).toBe('2026-09-26T18:00');
    expect(EventSchedule.label(defaultEventDetails().timing!.rounds[1], 'America/New_York')).toBe(
      'Sat, Sep 26, 9:00 PM – 9:30 PM',
    );
    expect(() => EventSchedule.parseInput('2027-03-14T02:30', 'America/New_York')).toThrow(
      'does not exist',
    );
  });

  it('rejects overlapping rounds and voting or submissions that conflict with the final round', () => {
    const timing = defaultEventDetails().timing!;
    timing.rounds[1].startsAt = timing.rounds[0].closesAt - 60_000;
    expect(() => EventSchedule.validate(timing)).toThrow('overlap');
    const lateSubmission = defaultEventDetails().timing!;
    lateSubmission.submissions.closesAt = lateSubmission.rounds[2].startsAt + 60_000;
    expect(() => EventSchedule.validate(lateSubmission)).toThrow('submissions');
    const earlyBallot = defaultEventDetails().timing!;
    earlyBallot.ballot.startsAt = earlyBallot.rounds[2].closesAt - 60_000;
    expect(() => EventSchedule.validate(earlyBallot)).toThrow('Community voting');
  });

  it('links public times to editable windows and accepts legacy unlinked schedules', () => {
    const details = defaultEventDetails();
    const item = details.schedule.find((row) => row.window === 'round2')!;
    details.timing!.rounds[1].closesAt += 15 * 60_000;
    expect(EventSchedule.resolve(details.timing, item.window)?.closesAt).toBe(
      details.timing!.rounds[1].closesAt,
    );
    expect(EventSchedule.resolve(undefined, undefined)).toBeUndefined();
    expect(defaultEventDetails().timing!.rounds[1].closesAt).not.toBe(
      details.timing!.rounds[1].closesAt,
    );
  });
});
