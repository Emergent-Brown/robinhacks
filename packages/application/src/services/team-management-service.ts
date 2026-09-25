import { RULES } from '@robinhacks/core';
import type {
  ConversationSummary,
  FundingRound,
  JudgeAssignment,
  JudgingSheet,
  Member,
  ProjectSubmission,
  ProjectUpdate,
  Team,
  TeamManagementCommand,
} from '@robinhacks/core';
import { requireState } from '../errors';
import type { CommandContext } from './context';
import { Permissions } from './permissions';
import { PlatformPermissions } from './platform-permissions';

const normalizedName = (name: string) =>
  name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const participant = (member: Member) => !['organizer', 'judge'].includes(member.role);

/** Organizer corrections change the live workspace, never settled funding records. */
export class TeamManagementService {
  async execute(context: CommandContext, command: TeamManagementCommand) {
    this.assertEditable(context);
    if (command.type === 'adminCreateTeam') return this.create(context, command);
    if (command.type === 'adminAssignMember') return this.assign(context, command);
    if (command.type === 'adminUpdateMember') return this.updateMember(context, command);
    const team = await context.tx.get<Team>(context.paths.team(command.teamId));
    requireState(team, 'NOT_FOUND', 'This team no longer exists.');
    requireState(
      team.version === command.expectedVersion,
      'TEAM_CHANGED',
      'This team changed. Refresh before saving.',
    );
    if (command.type === 'adminUpdateTeam') return this.update(context, command, team);
    if (command.type === 'adminDeleteTeam') return this.remove(context, command, team);
    return this.correctSubmission(context, command, team);
  }

  private assertEditable({ event, member }: CommandContext) {
    Permissions.member(member);
    Permissions.organizer(member);
    requireState(
      !event.activeOperationId,
      'OPERATION_RUNNING',
      'Finish the current event operation first.',
    );
    requireState(
      !['FINALIZED', 'CANCELLED', 'ARCHIVED'].includes(event.phase) && !event.publishedResultId,
      'EVENT_READ_ONLY',
      'Published or closed events cannot be changed.',
    );
    requireState(
      event.phase !== 'FINALIZING',
      'AWARDS_PREVIEW_EXISTS',
      'Discard the award preview in Event controls before making corrections.',
    );
    requireState(
      ['DRAFT', 'REGISTRATION'].includes(event.phase) || event.paused,
      'PAUSE_REQUIRED',
      'Pause the event in Event controls before correcting teams or people.',
    );
  }

  private async create(
    context: CommandContext,
    command: Extract<TeamManagementCommand, { type: 'adminCreateTeam' }>,
  ) {
    const { tx, paths, now } = context;
    requireState(
      !context.event.platform?.rulesLockedAt &&
        ['DRAFT', 'REGISTRATION'].includes(context.event.phase),
      'ROSTER_LOCKED',
      'Create all teams before the first funding round. Existing team rosters can still be corrected while paused.',
    );
    const teams = await tx.list<Team>(paths.collection('teams'), RULES.maxTeams + 1);
    requireState(
      teams.length < RULES.maxTeams,
      'TEAM_LIMIT',
      'This event supports at most 30 teams, including withdrawn teams.',
    );
    this.assertNameAvailable(teams, command.name);
    const id = `team_${command.commandId.slice(0, 100)}`;
    requireState(
      !teams.some((team) => team.id === id),
      'TEAM_EXISTS',
      'That team identifier already exists. Start a new request.',
    );
    const team: Team = {
      id,
      name: command.name,
      ticker: `TEAM${teams.length + 1}`,
      pitch: '',
      category: '',
      color: '#195587',
      problem: '',
      building: '',
      demoUrl: '',
      repoUrl: '',
      update: '',
      updatedAt: now,
      eligibility: 'active',
      captainUid: '',
      version: 1,
    };
    tx.set(paths.team(id), team);
    this.audit(context, command, null, team);
    this.touch(context);
    return {
      message: `${team.name} created. Assign an approved captain in People before opening its next funding round.`,
    };
  }

  private async update(
    context: CommandContext,
    command: Extract<TeamManagementCommand, { type: 'adminUpdateTeam' }>,
    team: Team,
  ) {
    const { tx, paths, now } = context;
    if (command.patch.name)
      this.assertNameAvailable(
        await tx.list<Team>(paths.collection('teams'), 31),
        command.patch.name,
        team.id,
      );
    for (const [key, label] of [
      ['demoUrl', 'Demo link'],
      ['repoUrl', 'Repository link'],
    ] as const)
      if (command.patch[key]) PlatformPermissions.httpUrl(command.patch[key]!, label);
    const updated = { ...team, ...command.patch, version: team.version + 1, updatedAt: now };
    tx.set(paths.team(team.id), updated);
    this.audit(context, command, team, updated);
    this.touch(context);
    return { message: `${updated.name} updated. Any locked final submission remains separate.` };
  }

  private async updateMember(
    context: CommandContext,
    command: Extract<TeamManagementCommand, { type: 'adminUpdateMember' }>,
  ) {
    const { tx, paths } = context;
    const member = await tx.get<Member>(paths.member(command.uid));
    requireState(member, 'NOT_FOUND', 'This person no longer has event access.');
    requireState(
      member.version === command.expectedVersion,
      'MEMBER_CHANGED',
      'This person’s details changed. Refresh before saving.',
    );
    const updated = { ...member, displayName: command.displayName, version: member.version + 1 };
    if (command.bio) updated.bio = command.bio;
    else delete updated.bio;
    tx.set(paths.member(member.uid), updated);
    if (member.teamId) tx.set(`${paths.team(member.teamId)}/members/${member.uid}`, updated);
    const request = await tx.get<{ displayName: string }>(paths.doc('accessRequests', member.uid));
    if (request)
      tx.set(paths.doc('accessRequests', member.uid), {
        ...request,
        displayName: command.displayName,
      });
    this.audit(context, command, member, updated);
    this.touch(context);
    return {
      message: `${updated.displayName}’s name and bio updated. Google account details are unchanged.`,
    };
  }

  private async assign(
    context: CommandContext,
    command: Extract<TeamManagementCommand, { type: 'adminAssignMember' }>,
  ) {
    const { tx, paths, now } = context;
    const [member, members, teams] = await Promise.all([
      tx.get<Member>(paths.member(command.uid)),
      tx.list<Member>(paths.collection('members'), 501),
      tx.list<Team>(paths.collection('teams'), 31),
    ]);
    requireState(member, 'NOT_FOUND', 'This person no longer has event access.');
    requireState(
      member.version === command.expectedVersion,
      'MEMBER_CHANGED',
      'This person’s assignment changed. Refresh before saving.',
    );
    requireState(
      member.status === 'approved' && member.emailVerified === true,
      'MEMBERSHIP_REQUIRED',
      'Approve or restore this participant before assigning a team.',
    );
    requireState(
      participant(member),
      'STAFF_CANNOT_COMPETE',
      'Organizer and judge accounts must remain separate from competing teams.',
    );
    requireState(
      members.length <= 500 &&
        members.filter((entry) => entry.status === 'approved' && participant(entry)).length <= 150,
      'MEMBER_LIMIT',
      'This event supports at most 150 approved participants.',
    );
    requireState(
      command.teamId !== null || command.role === 'member',
      'TEAM_REQUIRED',
      'An unassigned participant has the member role.',
    );
    const destination = teams.find((team) => team.id === command.teamId);
    requireState(
      command.teamId === null || destination?.eligibility === 'active',
      'TEAM_INACTIVE',
      'Choose an active team.',
    );
    requireState(
      !command.teamId ||
        members.filter((entry) => entry.uid !== member.uid && entry.teamId === command.teamId)
          .length < 4,
      'TEAM_FULL',
      'Teams can have at most four people, including suspended members. Move someone out first.',
    );
    if (command.teamId && command.role !== 'member')
      requireState(
        !members.some(
          (entry) =>
            entry.uid !== member.uid &&
            entry.teamId === command.teamId &&
            entry.status === 'approved' &&
            entry.role === command.role,
        ),
        'ROLE_LIMIT',
        `This team already has a ${'captain'}. Change their role first.`,
      );
    requireState(
      member.teamId !== command.teamId || member.role !== command.role,
      'NO_CHANGE',
      'Choose a different team or role.',
    );
    if (member.teamId) {
      // Existing allocation authors remain reconcilable after a move or a role correction.
      const id = encodeURIComponent(
        JSON.stringify([member.uid, context.actor.uid, command.commandId]),
      );
      tx.set(`${paths.collection('removedMembers')}/${id}`, { ...member, removedAt: now });
      tx.delete(`${paths.team(member.teamId)}/members/${member.uid}`);
    }
    const affected = teams.filter(
      (team) => team.id === member.teamId || team.id === command.teamId,
    );
    for (const team of affected)
      tx.set(paths.team(team.id), {
        ...team,
        captainUid:
          team.id === command.teamId && command.role === 'captain'
            ? member.uid
            : team.captainUid === member.uid
              ? ''
              : team.captainUid,
        version: team.version + 1,
        updatedAt: now,
      });
    const updated: Member = {
      ...member,
      teamId: command.teamId,
      role: command.role,
      version: member.version + 1,
    };
    tx.set(paths.member(member.uid), updated);
    if (command.teamId) tx.set(`${paths.team(command.teamId)}/members/${member.uid}`, updated);
    this.audit(context, command, member, updated);
    this.touch(context);
    return {
      message: `${member.displayName} ${destination ? `assigned to ${destination.name} as ${command.role}` : 'is now waiting for a team'}. Existing investments and submitted rosters stay with their original team.`,
    };
  }

  private async remove(
    context: CommandContext,
    command: Extract<TeamManagementCommand, { type: 'adminDeleteTeam' }>,
    team: Team,
  ) {
    const { tx, paths, event, now } = context;
    const rounds = await tx.list<FundingRound>(paths.collection('fundingRounds'), 4);
    const hasFunding = !!event.platform?.rulesLockedAt || rounds.length > 0;
    if (hasFunding || !['DRAFT', 'REGISTRATION'].includes(event.phase)) {
      requireState(
        !rounds.some((round) => round.state === 'open'),
        'ROUND_OPEN',
        'Close the current funding round before withdrawing a team.',
      );
      requireState(
        team.eligibility !== 'disqualified',
        'TEAM_DISQUALIFIED',
        'This team is disqualified. Withdrawal cannot restore its investor prize eligibility.',
      );
      const updated = {
        ...team,
        eligibility: 'withdrawn' as const,
        version: team.version + 1,
        updatedAt: now,
      };
      tx.set(paths.team(team.id), updated);
      this.audit(context, command, team, updated);
      this.touch(context);
      return {
        message: `${team.name} withdrawn. Its roster, funding history, final evidence, and earned investor claims are preserved. Reason: ${command.reason}`,
      };
    }
    await this.deleteRegistrationTeam(context, team);
    this.audit(context, command, team, null);
    this.touch(context);
    return {
      message: `${team.name} deleted. Its people are now unassigned; their event access is unchanged. Reason: ${command.reason}`,
    };
  }

  /** Clean both sides of a registration-only relationship in the same transaction. */
  private async deleteRegistrationTeam({ tx, paths }: CommandContext, team: Team) {
    const [members, mirrors, updates, inboxes, assignments, sheets, allocations, entitlements] =
      await Promise.all([
        tx.list<Member>(paths.collection('members'), 501),
        tx.list<Member>(`${paths.team(team.id)}/members`, 501),
        tx.list<ProjectUpdate>(paths.collection('projectUpdates'), 301),
        tx.list<{ teamId: string; conversations: ConversationSummary[] }>(
          paths.collection('teamInboxes'),
          31,
        ),
        tx.list<JudgeAssignment>(paths.collection('judgeAssignments'), 51),
        tx.list<JudgingSheet>(paths.collection('judgingSheets'), 51),
        tx.list(paths.collection('roundAllocations'), 1),
        tx.list(paths.collection('roundEntitlements'), 1),
      ]);
    requireState(
      !allocations.length && !entitlements.length,
      'FUNDING_HISTORY_EXISTS',
      'This event has funding history. Restore its event state before removing teams.',
    );
    requireState(
      members.length <= 500 &&
        mirrors.length <= 500 &&
        updates.length <= 300 &&
        inboxes.length <= 30 &&
        assignments.length <= 50 &&
        sheets.length <= 50,
      'CLEANUP_LIMIT',
      'This event exceeds its record limits. Contact the site administrator.',
    );
    requireState(
      !sheets.some((sheet) => sheet.entries[team.id] && sheet.submittedAt !== null),
      'JUDGING_HISTORY_EXISTS',
      'This team has submitted judging history and cannot be permanently deleted.',
    );
    const roster = members.filter((member) => member.teamId === team.id);
    const ownedUpdates = updates.filter((update) => update.teamId === team.id);
    requireState(
      roster.length +
        mirrors.length +
        ownedUpdates.length +
        inboxes.length +
        assignments.length +
        sheets.length <
        440,
      'CLEANUP_LIMIT',
      'Too many linked records for one safe deletion. Remove unused records before trying again.',
    );
    for (const member of roster)
      tx.set(paths.member(member.uid), {
        ...member,
        teamId: null,
        role: 'member',
        version: member.version + 1,
      });
    for (const member of mirrors) tx.delete(`${paths.team(team.id)}/members/${member.uid}`);
    for (const update of ownedUpdates) tx.delete(paths.doc('projectUpdates', update.id));
    for (const inbox of inboxes)
      if (inbox.teamId === team.id) tx.delete(paths.doc('teamInboxes', team.id));
      else if (inbox.conversations.some((entry) => entry.otherTeamId === team.id))
        tx.set(paths.doc('teamInboxes', inbox.teamId), {
          ...inbox,
          conversations: inbox.conversations.filter((entry) => entry.otherTeamId !== team.id),
        });
    for (const assignment of assignments)
      if (assignment.projectIds.includes(team.id))
        tx.set(paths.doc('judgeAssignments', assignment.uid), {
          ...assignment,
          projectIds: assignment.projectIds.filter((id) => id !== team.id),
          conflictIds: assignment.conflictIds.filter((id) => id !== team.id),
          version: assignment.version + 1,
        });
    for (const sheet of sheets)
      if (sheet.entries[team.id])
        tx.set(paths.doc('judgingSheets', sheet.uid), {
          ...sheet,
          entries: Object.fromEntries(
            Object.entries(sheet.entries).filter(([id]) => id !== team.id),
          ),
          version: sheet.version + 1,
        });
    tx.delete(paths.doc('submissions', team.id));
    tx.delete(paths.doc('communityBallots', team.id));
    tx.delete(paths.team(team.id));
    // Conversations, safety reports and audit records remain available to organizers.
  }

  private async correctSubmission(
    context: CommandContext,
    command: Extract<
      TeamManagementCommand,
      { type: 'adminReopenSubmission' | 'adminUpdateSubmission' }
    >,
    team: Team,
  ) {
    const { tx, paths, now, event } = context;
    requireState(event.paused, 'PAUSE_REQUIRED', 'Pause the event before changing final evidence.');
    const [submission, sheets] = await Promise.all([
      tx.get<ProjectSubmission>(paths.doc('submissions', team.id)),
      tx.list<JudgingSheet>(paths.collection('judgingSheets'), 51),
    ]);
    requireState(submission, 'NOT_FOUND', 'This team has no locked final submission.');
    requireState(
      sheets.length <= 50,
      'JUDGE_LIMIT',
      'This event exceeds its judging record limit.',
    );
    requireState(
      command.type !== 'adminReopenSubmission' ||
        (event.platform!.currentRound < 3 && event.phase !== 'FROZEN'),
      'SUBMISSIONS_LOCKED',
      'After the final funding round starts, correct the saved evidence instead of reopening it.',
    );
    const affectedSheets = sheets.filter((sheet) => !!sheet.entries[team.id]);
    const updated =
      command.type === 'adminUpdateSubmission'
        ? {
            ...submission,
            ...command.patch,
            ...(command.patch.commitSha
              ? { commitSha: command.patch.commitSha.toLowerCase() }
              : {}),
          }
        : null;
    if (updated) {
      PlatformPermissions.httpUrl(updated.repoUrl, 'Repository link');
      PlatformPermissions.httpUrl(updated.demoUrl, 'Demo link');
      tx.set(paths.doc('submissions', team.id), updated);
    } else tx.delete(paths.doc('submissions', team.id));
    const id = encodeURIComponent(JSON.stringify([context.actor.uid, command.commandId]));
    tx.set(`${paths.collection('submissionCorrections')}/${id}`, {
      teamId: team.id,
      actorUid: context.actor.uid,
      correctedAt: now,
      reason: command.reason,
      before: submission,
      after: updated,
      judgingEntries: affectedSheets.map((sheet) => ({
        uid: sheet.uid,
        entry: sheet.entries[team.id],
        version: sheet.version,
        updatedAt: sheet.updatedAt,
        submittedAt: sheet.submittedAt,
      })),
    });
    for (const sheet of affectedSheets)
      tx.set(paths.doc('judgingSheets', sheet.uid), {
        ...sheet,
        entries: Object.fromEntries(Object.entries(sheet.entries).filter(([id]) => id !== team.id)),
        submittedAt: null,
        updatedAt: now,
        version: sheet.version + 1,
      });
    tx.set(paths.team(team.id), { ...team, version: team.version + 1, updatedAt: now });
    this.touch(context);
    return {
      message: `${team.name}’s submission ${updated ? 'corrected' : 'reopened'}. Prior evidence is archived${affectedSheets.length ? `; ${affectedSheets.length} judge sheet(s) now need review` : ''}. Reason: ${command.reason}`,
    };
  }

  private assertNameAvailable(teams: Team[], name: string, exceptId?: string) {
    requireState(
      !teams.some(
        (team) => team.id !== exceptId && normalizedName(team.name) === normalizedName(name),
      ),
      'TEAM_EXISTS',
      'A team with that name already exists.',
    );
  }

  private touch({ tx, paths, event }: CommandContext) {
    tx.set(paths.root, { ...event, phaseVersion: event.phaseVersion + 1 });
  }

  private audit(
    context: CommandContext,
    command: TeamManagementCommand,
    before: unknown,
    after: unknown,
  ) {
    const id = encodeURIComponent(JSON.stringify([context.actor.uid, command.commandId]));
    context.tx.set(`${context.paths.collection('teamManagementAudit')}/${id}`, {
      action: command.type,
      actorUid: context.actor.uid,
      createdAt: context.now,
      before,
      after,
      ...('reason' in command ? { reason: command.reason } : {}),
    });
  }
}
