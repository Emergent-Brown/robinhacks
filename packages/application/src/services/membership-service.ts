import type { AccessRequest, Command, Member, Team } from '@robinhacks/core';
import { requireState } from '../errors';
import { Permissions } from './permissions';
import type { CommandContext } from './context';
import { organizerInvitePath } from './organizer-access-service';

/** Signup collects identity; team choice is a separate organizer-controlled stage. */
export class MembershipService {
  async request(context: CommandContext, command: Extract<Command, { type: 'requestMembership' }>) {
    const { tx, paths, event, actor, now } = context;
    requireState(
      actor.emailVerified === true && !!actor.email,
      'EMAIL_VERIFICATION_REQUIRED',
      'Sign in with a verified Google account before requesting access.',
    );
    requireState(event.platform, 'PLATFORM_REQUIRED', 'This event needs funding-round settings.');
    requireState(
      !event.activeOperationId &&
        (['DRAFT', 'REGISTRATION'].includes(event.phase) ||
          (!!command.staffRole && ['SEED_OPEN', 'INTERMISSION', 'FROZEN'].includes(event.phase))),
      'REGISTRATION_CLOSED',
      'Participant signup is closed. Contact an organizer.',
    );
    requireState(
      !event.platform.rulesLockedAt || !!command.staffRole,
      'ROSTER_LOCKED',
      'Participant signup is closed after funding starts.',
    );
    const [member, prior, members] = await Promise.all([
      tx.get<Member>(paths.member(actor.uid)),
      tx.get<AccessRequest>(paths.doc('accessRequests', actor.uid)),
      tx.list<Member>(paths.collection('members'), 501),
    ]);
    requireState(
      !member || member.status === 'pending',
      'ALREADY_REGISTERED',
      'Your account already belongs to this event.',
    );
    requireState(
      member || members.length < 500,
      'MEMBER_LIMIT',
      'This event has reached its access-request limit.',
    );
    requireState(
      !prior || now - prior.requestedAt >= 30_000,
      'RATE_LIMITED',
      'Wait 30 seconds before changing your access request.',
    );
    const automatic = event.platform.autoApproveParticipants === true && !command.staffRole;
    requireState(
      !automatic ||
        members.filter(
          (entry) => entry.status === 'approved' && !['organizer', 'judge'].includes(entry.role),
        ).length < 150,
      'MEMBER_LIMIT',
      'This event is limited to 150 approved participants.',
    );
    const status = automatic ? ('approved' as const) : ('pending' as const);
    const request: AccessRequest = {
      uid: actor.uid,
      displayName: command.displayName,
      requestedAt: now,
      status,
      ...(command.staffRole ? { requestedRole: command.staffRole } : {}),
      email: actor.email,
      emailVerified: true,
    };
    tx.set(paths.doc('accessRequests', actor.uid), request);
    tx.set<Member>(paths.member(actor.uid), {
      uid: actor.uid,
      displayName: command.displayName,
      teamId: null,
      role: 'member',
      status,
      version: (member?.version ?? 0) + 1,
      email: actor.email,
      emailVerified: true,
    });
    tx.set(paths.root, { ...event, phaseVersion: event.phaseVersion + 1 });
    return {
      message: automatic
        ? 'You’re approved. Choose a team when formation opens.'
        : 'Request sent. An organizer will review your name and verified email.',
    };
  }

  async approve(context: CommandContext, command: Extract<Command, { type: 'approveMembership' }>) {
    const { tx, paths, event, member } = context;
    Permissions.organizer(member);
    requireState(
      event.platform &&
        ['DRAFT', 'REGISTRATION'].includes(event.phase) &&
        !event.platform.rulesLockedAt,
      'ROSTER_LOCKED',
      'Approve participants before funding begins.',
    );
    const [request, currentMember, members] = await Promise.all([
      tx.get<AccessRequest>(paths.doc('accessRequests', command.uid)),
      tx.get<Member>(paths.member(command.uid)),
      tx.list<Member>(paths.collection('members'), 501),
    ]);
    requireState(
      request?.status === 'pending' && currentMember?.status === 'pending',
      'REQUEST_NOT_PENDING',
      'This access request is no longer pending.',
    );
    requireState(
      currentMember.emailVerified === true && !!currentMember.email && !request.requestedRole,
      'EMAIL_VERIFICATION_REQUIRED',
      'Verify this attendee identity and use staff approval for judge requests.',
    );
    requireState(
      currentMember.teamId === null && currentMember.role === 'member',
      'STAFF_CANNOT_COMPETE',
      'This account is already assigned to a team or staff role.',
    );
    requireState(
      members.filter(
        (entry) => entry.status === 'approved' && !['organizer', 'judge'].includes(entry.role),
      ).length < 150,
      'MEMBER_LIMIT',
      'This event is limited to 150 approved participants.',
    );
    tx.set(paths.member(command.uid), {
      ...currentMember,
      status: 'approved',
      version: currentMember.version + 1,
    });
    tx.set(paths.doc('accessRequests', command.uid), { ...request, status: 'approved' });
    tx.set(paths.root, { ...event, phaseVersion: event.phaseVersion + 1 });
    return {
      message: `${request.displayName} approved. They can choose a team when team formation opens.`,
    };
  }

  async role(context: CommandContext, command: Extract<Command, { type: 'setMemberRole' }>) {
    const { tx, paths, event, member } = context;
    const [target, members] = await Promise.all([
      tx.get<Member>(paths.member(command.uid)),
      tx.list<Member>(paths.collection('members'), 501),
    ]);
    requireState(target, 'NOT_FOUND', 'This member does not exist.');
    const recoveringRole = this.canRecoverRole(context, target, members, command);
    if (!recoveringRole) Permissions.rosterEditable(event);
    if (event.platform) {
      if (command.status === 'approved')
        requireState(
          target.emailVerified === true,
          'EMAIL_VERIFICATION_REQUIRED',
          'This account must verify its email before approval.',
        );
      requireState(
        !event.platform.rulesLockedAt ||
          target.teamId === null ||
          command.status === 'suspended' ||
          recoveringRole,
        'ROSTER_LOCKED',
        'Competing team assignments and roles are locked after funding starts.',
      );
      requireState(
        !event.platform.rulesLockedAt ||
          !target.teamId ||
          command.role === target.role ||
          recoveringRole,
        'ROSTER_LOCKED',
        'A suspension cannot change a frozen team role.',
      );
    }
    if (member.role !== 'organizer') {
      requireState(
        member.role === 'captain' &&
          target.teamId === member.teamId &&
          target.uid !== member.uid &&
          ['member', 'trader'].includes(command.role) &&
          command.status === 'approved' &&
          target.status === 'approved' &&
          ['DRAFT', 'REGISTRATION'].includes(event.phase),
        'ORGANIZER_REQUIRED',
        'Only the captain can designate a teammate before funding; later changes require an organizer.',
      );
    } else Permissions.organizer(member);
    requireState(
      command.role !== 'organizer' || target.role === 'organizer',
      'ORGANIZER_INVITE_REQUIRED',
      'Add organizer access using their verified email address.',
    );
    if (
      target.uid === member.uid &&
      (command.status !== 'approved' || command.role !== target.role)
    )
      requireState(false, 'SELF_REMOVAL', 'Another organizer must change your access.');
    if (command.role === 'organizer' || command.role === 'judge')
      requireState(
        target.teamId === null && member.role === 'organizer',
        'ORGANIZER_CANNOT_COMPETE',
        'Organizer identities must be separate from competing team identities.',
      );
    if (command.role === 'judge' && command.status === 'approved')
      requireState(
        members.filter(
          (entry) =>
            entry.uid !== target.uid &&
            entry.status === 'approved' &&
            entry.role === 'judge' &&
            entry.teamId === null,
        ).length < 50,
        'JUDGE_LIMIT',
        'This event supports at most 50 approved judges. Suspend another judge before approving one more.',
      );
    if (
      target.role === 'organizer' &&
      (command.role !== 'organizer' || command.status !== 'approved')
    )
      requireState(
        members.some(
          (candidate) =>
            candidate.uid !== target.uid &&
            candidate.role === 'organizer' &&
            candidate.status === 'approved',
        ),
        'LAST_ORGANIZER',
        'Keep at least one approved organizer.',
      );
    requireState(
      ['organizer', 'judge'].includes(command.role) ||
        (command.role === 'member' && target.role === 'member' && target.status !== 'pending') ||
        target.teamId !== null ||
        command.status !== 'approved',
      'TEAM_REQUIRED',
      'Approve a pending participant using their access request.',
    );
    if (
      command.status === 'approved' &&
      target.status !== 'approved' &&
      !['organizer', 'judge'].includes(command.role)
    )
      requireState(
        members.filter(
          (entry) => entry.status === 'approved' && !['organizer', 'judge'].includes(entry.role),
        ).length < 150,
        'MEMBER_LIMIT',
        'This event is limited to 150 approved participants.',
      );
    if (target.teamId && command.status === 'approved')
      this.assertRoleAvailable(members, target.teamId, target.uid, command.role);
    if (target.teamId && (target.role === 'captain' || command.role === 'captain')) {
      const team = await tx.get<Team>(paths.team(target.teamId));
      requireState(team, 'NOT_FOUND', 'The member’s team does not exist.');
      tx.set(paths.team(team.id), {
        ...team,
        captainUid:
          command.role === 'captain' && command.status === 'approved'
            ? target.uid
            : team.captainUid === target.uid
              ? ''
              : team.captainUid,
        version: team.version + 1,
      });
    }
    const updated = {
      ...target,
      role: command.role,
      status: command.status,
      version: target.version + 1,
    };
    if (
      target.role === 'organizer' &&
      target.email &&
      (command.role !== 'organizer' || command.status !== 'approved')
    )
      tx.delete(organizerInvitePath(paths, target.email));
    tx.set(paths.member(target.uid), updated);
    if (target.teamId) tx.set(`${paths.team(target.teamId)}/members/${target.uid}`, updated);
    const request = await tx.get<AccessRequest>(paths.doc('accessRequests', target.uid));
    if (request?.status === 'pending' && command.status === 'suspended')
      tx.set(paths.doc('accessRequests', target.uid), { ...request, status: 'rejected' });
    if (
      request?.status === 'pending' &&
      command.status === 'approved' &&
      ['organizer', 'judge'].includes(command.role)
    )
      tx.set(paths.doc('accessRequests', target.uid), { ...request, status: 'approved' });
    tx.set(paths.root, { ...event, phaseVersion: event.phaseVersion + 1 });
    return { message: 'Event membership updated.' };
  }

  async profile(context: CommandContext, command: Extract<Command, { type: 'updateTeam' }>) {
    const { tx, paths, event, member, now } = context;
    Permissions.editable(event);
    const teamId = Permissions.team(member);
    const team = await tx.get<Team>(paths.team(teamId));
    requireState(team, 'NOT_FOUND', 'Your team does not exist.');
    if (event.platform) {
      requireState(
        member.role === 'captain' || member.role === 'member',
        'CAPTAIN_REQUIRED',
        'Team members can edit their project.',
      );
      requireState(
        !(await tx.get(paths.doc('submissions', teamId))),
        'SUBMISSION_LOCKED',
        'Your final submission is locked.',
      );
      requireState(
        event.phase !== 'SEED_OPEN',
        'ROUND_OPEN',
        'Project profiles stay fixed during a funding round. Publish changes between rounds.',
      );
      requireState(
        !('update' in command.patch),
        'USE_CHECKPOINT_UPDATE',
        'Use the timestamped checkpoint update form to share progress.',
      );
    }
    requireState(
      team.version === command.expectedVersion,
      'TEAM_CHANGED',
      'A teammate updated the profile. Refresh before saving.',
    );
    tx.set(paths.team(teamId), {
      ...team,
      ...command.patch,
      version: team.version + 1,
      updatedAt: now,
    });
    return { message: 'Team profile updated.' };
  }

  /** Recover an existing team's vacant role without reopening its frozen roster. */
  private canRecoverRole(
    { event, member }: CommandContext,
    target: Member,
    members: Member[],
    command: Extract<Command, { type: 'setMemberRole' }>,
  ): boolean {
    const promotion =
      (command.role === 'captain' && ['member', 'trader'].includes(target.role)) ||
      (command.role === 'trader' && target.role === 'member');
    return (
      !!event.platform?.rulesLockedAt &&
      event.paused &&
      !event.activeOperationId &&
      ['SEED_OPEN', 'INTERMISSION', 'FROZEN', 'FINALIZING'].includes(event.phase) &&
      member.role === 'organizer' &&
      member.teamId === null &&
      target.status === 'approved' &&
      target.teamId !== null &&
      command.status === 'approved' &&
      promotion &&
      !members.some(
        (entry) =>
          entry.teamId === target.teamId &&
          entry.role === command.role &&
          entry.status === 'approved',
      )
    );
  }

  private assertRoleAvailable(
    members: Member[],
    teamId: string,
    uid: string,
    role: Member['role'],
  ) {
    if (role === 'captain' || role === 'trader')
      requireState(
        !members.some(
          (candidate) =>
            candidate.teamId === teamId &&
            candidate.uid !== uid &&
            candidate.status === 'approved' &&
            candidate.role === role,
        ),
        'ROLE_LIMIT',
        `A team can have only one ${role}.`,
      );
  }
}
