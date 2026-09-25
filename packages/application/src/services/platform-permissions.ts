import type { EventConfig, Member, PlatformConfig, Team } from '@robinhacks/core';
import { requireState } from '../errors';
import { Permissions } from './permissions';
import type { CommandContext } from './context';

/** Shared guards for the sealed-round event; no legacy balance or market access. */
export class PlatformPermissions {
  static config(event: EventConfig): PlatformConfig {
    requireState(
      event.platform?.version === 2,
      'PLATFORM_REQUIRED',
      'This event does not use funding rounds.',
    );
    return event.platform;
  }

  static team(member: Member): string {
    Permissions.member(member);
    requireState(
      member.teamId && !['organizer', 'judge'].includes(member.role),
      'TEAM_REQUIRED',
      'A competing team account is required.',
    );
    return member.teamId;
  }

  static async writer(context: CommandContext): Promise<Team> {
    const teamId = this.team(context.member);
    const team = await context.tx.get<Team>(context.paths.team(teamId));
    requireState(team, 'NOT_FOUND', 'Your team does not exist.');
    requireState(team.eligibility === 'active', 'TEAM_INACTIVE', 'Your team is not active.');
    return team;
  }

  static organizer(context: CommandContext, expectedVersion?: number): PlatformConfig {
    Permissions.member(context.member);
    Permissions.organizer(context.member);
    const config = this.config(context.event);
    if (expectedVersion !== undefined)
      requireState(
        context.event.phaseVersion === expectedVersion,
        'PHASE_CHANGED',
        'The event changed. Refresh before continuing.',
      );
    return config;
  }

  static writable(context: CommandContext): PlatformConfig {
    Permissions.member(context.member);
    Permissions.editable(context.event);
    requireState(!context.event.paused, 'EVENT_PAUSED', 'The event is paused.');
    return this.config(context.event);
  }

  static deadline(open: boolean, closesAt: number | null, now: number, label: string): void {
    requireState(
      open && closesAt !== null && now < closesAt,
      'WINDOW_CLOSED',
      `${label} are closed.`,
    );
  }

  static futureDeadline(open: boolean, closesAt: number | null, now: number): void {
    requireState(
      !open ||
        (Number.isSafeInteger(closesAt) && closesAt! > now && closesAt! <= now + 7 * 86_400_000),
      'INVALID_DEADLINE',
      'Choose a closing time within the next seven days.',
    );
  }

  static httpUrl(value: string, label: string): string {
    requireState(
      value.length > 0 && value.length <= 500,
      'EVIDENCE_REQUIRED',
      `${label} is required.`,
    );
    let parsed: URL | null = null;
    try {
      parsed = new URL(value);
    } catch {
      /* Invalid URL is rejected below. */
    }
    requireState(
      parsed &&
        ['https:', 'http:'].includes(parsed.protocol) &&
        !parsed.username &&
        !parsed.password,
      'INVALID_URL',
      `Use a public HTTP or HTTPS ${label.toLowerCase()}.`,
    );
    return value;
  }
}
