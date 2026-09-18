import { invariant } from './errors';
import type { EventDetails, EventTiming, PlannedWindow, ScheduleWindow } from './platform';

export const DEFAULT_EVENT_VENUE = 'Nelson Center for Entrepreneurship';
const window = (start: string, end: string): PlannedWindow => ({
  startsAt: Date.parse(start),
  closesAt: Date.parse(end),
});

/** Planned windows are editable metadata. Actual opened windows keep their own deadlines. */
export class EventSchedule {
  static validate(timing: EventTiming): void {
    invariant(timing.rounds.length === 3, 'INVALID_SCHEDULE', 'Plan exactly three funding rounds.');
    for (const [index, item] of [...timing.rounds, timing.submissions, timing.ballot].entries()) {
      const limit = index === 4 ? 240 : 1440;
      invariant(
        Number.isSafeInteger(item.startsAt) &&
          Number.isSafeInteger(item.closesAt) &&
          item.startsAt > 0 &&
          item.closesAt <= 253402300799999 &&
          item.closesAt - item.startsAt >= 60_000 &&
          item.closesAt - item.startsAt <= limit * 60_000,
        'INVALID_SCHEDULE',
        `Each window must last 1–${limit} minutes, with its end after its start.`,
      );
    }
    invariant(
      timing.rounds.every((item, i) => i === 0 || item.startsAt >= timing.rounds[i - 1].closesAt),
      'INVALID_SCHEDULE',
      'Funding rounds must be in order and cannot overlap.',
    );
    invariant(
      timing.submissions.closesAt <= timing.rounds[2].startsAt,
      'INVALID_SCHEDULE',
      'Final submissions must close before the last funding round.',
    );
    invariant(
      timing.ballot.startsAt >= timing.rounds[2].closesAt,
      'INVALID_SCHEDULE',
      'Community voting must start after the last funding round closes.',
    );
  }

  static resolve(
    timing: EventTiming | undefined,
    key: ScheduleWindow | undefined,
  ): PlannedWindow | undefined {
    if (!timing || !key) return undefined;
    return key === 'submissions' || key === 'ballot'
      ? timing[key]
      : timing.rounds[Number(key.slice(-1)) - 1];
  }

  static minutes(window: PlannedWindow): number {
    return Math.ceil((window.closesAt - window.startsAt) / 60_000);
  }

  static label(window: PlannedWindow, timeZone: string): string {
    const date = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    const time = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });
    const first = date.format(window.startsAt),
      last = date.format(window.closesAt);
    return `${first}, ${time.format(window.startsAt)} – ${first === last ? '' : last + ', '}${time.format(window.closesAt)}`;
  }

  /** datetime-local fields use the event zone, independently of the organizer's device zone. */
  static inputValue(timestamp: number, timeZone: string): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(timestamp);
    const part = (type: string) => parts.find((item) => item.type === type)!.value;
    return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
  }

  static parseInput(value: string, timeZone: string): number {
    invariant(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value),
      'INVALID_TIME',
      'Enter a complete date and time.',
    );
    const civil = Date.parse(value + ':00Z');
    let instant = civil;
    for (let attempt = 0; attempt < 3; attempt++) {
      const displayed = Date.parse(this.inputValue(instant, timeZone) + ':00Z');
      instant += civil - displayed;
    }
    invariant(
      this.inputValue(instant, timeZone) === value,
      'INVALID_TIME',
      'That local time does not exist. Choose another time.',
    );
    return instant;
  }
}

export function defaultEventDetails(): EventDetails {
  return {
    theme: 'Silicon Valley',
    about: 'Build a project, share your progress, and back the teams you believe in.',
    dateLabel: 'September 26–27, 2026',
    timeZone: 'America/New_York',
    eligibility: '',
    registrationUrl: '',
    contactEmail: '',
    timing: {
      rounds: [
        window('2026-09-26T11:00:00-04:00', '2026-09-26T11:30:00-04:00'),
        window('2026-09-26T21:00:00-04:00', '2026-09-26T21:30:00-04:00'),
        window('2026-09-27T12:00:00-04:00', '2026-09-27T12:30:00-04:00'),
      ],
      submissions: window('2026-09-27T10:00:00-04:00', '2026-09-27T10:45:00-04:00'),
      ballot: window('2026-09-27T12:30:00-04:00', '2026-09-27T12:45:00-04:00'),
    },
    schedule: [
      { time: 'Sat · 10 a.m.', title: 'Welcome & team forming', description: '' },
      {
        time: '',
        window: 'round1',
        title: 'First investments',
        description: 'Back the initial pitches.',
      },
      {
        time: 'Sat · 11:30 a.m.–9 p.m.',
        title: 'Building',
        description: 'Work on your project and meet other teams.',
      },
      { time: 'Sat · noon', title: 'Lunch', description: '' },
      {
        time: 'Sat · 6 p.m.',
        title: 'Funding reveal',
        description: 'See the first-round funding totals.',
      },
      { time: 'Sat · 7 p.m.', title: 'Dinner', description: '' },
      {
        time: '',
        window: 'round2',
        title: 'Second investments',
        description: 'Back the working prototypes.',
      },
      { time: 'Sat · 9:30 p.m.–Sun · 10:45 a.m.', title: 'Building continues', description: '' },
      { time: 'Sun · midnight', title: 'Ice cream social', description: '' },
      { time: 'Sun · 8 a.m.', title: 'Breakfast', description: '' },
      {
        time: '',
        window: 'submissions',
        title: 'Final submissions',
        description: 'Submit your project before pitches.',
      },
      { time: 'Sun · 11 a.m.–noon', title: 'Pitches', description: 'Show what you built.' },
      {
        time: '',
        window: 'round3',
        title: 'Final investments',
        description: 'Make your final picks after the demos.',
      },
      { time: '', window: 'ballot', title: 'Community vote', description: '' },
      { time: 'Sun · 1:15 p.m.', title: 'Winners announced', description: '' },
      { time: 'Sun · 2 p.m.', title: 'Closing ceremony', description: '' },
    ],
  };
}
