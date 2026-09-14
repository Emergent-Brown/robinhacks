import type { EventConfig, Member, Team } from '@robinhacks/core';
import { requireState } from '../errors';

export class Permissions {
  static member(member: Member | null): asserts member is Member {
    requireState(
      member?.status === 'approved',
      'MEMBERSHIP_REQUIRED',
      'An organizer must approve your event membership.',
    );
  }
  static organizer(member: Member): void {
    requireState(
      member.role === 'organizer' && member.teamId === null,
      'ORGANIZER_REQUIRED',
      'A separate organizer account is required.',
    );
  }
  static team(member: Member): string {
    requireState(
      member.teamId && !['organizer', 'judge'].includes(member.role),
      'TEAM_REQUIRED',
      'This action belongs to a competing team.',
    );
    return member.teamId;
  }
  static trader(member: Member, team: Team): void {
    this.team(member);
    requireState(
      member.role === 'captain' || member.role === 'trader',
      'TRADER_REQUIRED',
      'Only your captain or designated trader can invest.',
    );
    requireState(
      team.eligibility === 'active',
      'TEAM_INACTIVE',
      'Your team is not active in this event.',
    );
  }
  static rosterEditable(event: EventConfig): void {
    requireState(
      ['DRAFT', 'REGISTRATION'].includes(event.phase) ||
        (event.paused &&
          !event.activeOperationId &&
          ['SEED_OPEN', 'INTERMISSION', 'TRADING_OPEN', 'FROZEN'].includes(event.phase)),
      'ROSTER_LOCKED',
      'Pause the event before correcting its frozen roster.',
    );
  }
  static editable(event: EventConfig): void {
    requireState(
      !['FINALIZING', 'FINALIZED', 'ARCHIVED', 'CANCELLED'].includes(event.phase),
      'EVENT_READ_ONLY',
      'This event is read-only.',
    );
  }
}
