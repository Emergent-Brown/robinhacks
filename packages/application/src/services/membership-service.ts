import { RULES } from '@robinhacks/core';
import type { AccessRequest, Command, Issuer, Member, Pool, Team, Wallet } from '@robinhacks/core';
import { requireState } from '../errors';
import { Permissions } from './permissions';
import { receipt, type CommandContext } from './context';

const colors = ['#5b55e7', '#167d8d', '#d8713e', '#bf5898', '#3c8c67', '#6b72b8'];

export class MembershipService {
  async request(context: CommandContext, command: Extract<Command, { type: 'requestMembership' }>) {
    const { tx, paths, event, actor, now } = context;
    if (event.platform) {
      requireState(
        actor.emailVerified === true && !!actor.email,
        'EMAIL_VERIFICATION_REQUIRED',
        'Verify your email before requesting event access.',
      );
      requireState(
        !command.staffRole || !command.teamId,
        'INVALID_REQUEST',
        'Staff accounts cannot also request a competing team.',
      );
      requireState(
        !event.platform.rulesLockedAt || !!command.staffRole,
        'ROSTER_LOCKED',
        'Team rosters are locked after the first funding round opens. Contact an organizer.',
      );
    }
    const registrationOpen = ['DRAFT', 'REGISTRATION'].includes(event.phase);
    requireState(
      !event.activeOperationId &&
        (registrationOpen ||
          ['SEED_OPEN', 'INTERMISSION', 'TRADING_OPEN', 'FROZEN'].includes(event.phase)),
      'REGISTRATION_CLOSED',
      'Access requests are closed during settlement or after the event. Contact an organizer.',
    );
    requireState(
      registrationOpen || !!command.teamId || !!command.staffRole,
      'REGISTRATION_CLOSED',
      'New teams can be created only before funding opens. Choose an existing team.',
    );
    const [member, prior, team] = await Promise.all([
      tx.get<Member>(paths.member(actor.uid)),
      tx.get<AccessRequest>(paths.doc('accessRequests', actor.uid)),
      command.teamId ? tx.get<Team>(paths.team(command.teamId)) : Promise.resolve(null),
    ]);
    requireState(
      !member || member.status === 'pending',
      'ALREADY_REGISTERED',
      'Your account already belongs to this event.',
    );
    requireState(
      !prior || now - prior.requestedAt >= 30_000,
      'RATE_LIMITED',
      'Wait 30 seconds before changing your access request.',
    );
    if (command.teamId) {
      requireState(team, 'NOT_FOUND', 'The requested team does not exist.');
      requireState(
        team.eligibility === 'active',
        'TEAM_INACTIVE',
        'The requested team is inactive.',
      );
    }
    const request: AccessRequest = {
      uid: actor.uid,
      displayName: command.displayName,
      teamName: team?.name ?? command.teamName,
      teamId: command.teamId ?? null,
      requestedAt: now,
      status: 'pending',
      ...(command.staffRole ? { requestedRole: command.staffRole } : {}),
      ...(actor.email ? { email: actor.email, emailVerified: actor.emailVerified === true } : {}),
    };
    tx.set(paths.doc('accessRequests', actor.uid), request);
    tx.set<Member>(paths.member(actor.uid), {
      uid: actor.uid,
      displayName: command.displayName,
      teamId: null,
      role: 'member',
      status: 'pending',
      version: (member?.version ?? 0) + 1,
      ...(actor.email ? { email: actor.email, emailVerified: actor.emailVerified === true } : {}),
    });
    return { message: 'Request sent. An organizer will verify your team and approve access.' };
  }

  async approve(context: CommandContext, command: Extract<Command, { type: 'approveMembership' }>) {
    const { tx, paths, event, member, now } = context;
    Permissions.organizer(member);
    Permissions.rosterEditable(event);
    if (event.platform)
      requireState(
        !event.platform.rulesLockedAt,
        'ROSTER_LOCKED',
        'Competing rosters are locked once funding begins.',
      );
    const [request, currentMember, teams, members] = await Promise.all([
      tx.get<AccessRequest>(paths.doc('accessRequests', command.uid)),
      tx.get<Member>(paths.member(command.uid)),
      tx.list<Team>(paths.collection('teams'), 31),
      tx.list<Member>(paths.collection('members'), 501),
    ]);
    requireState(
      request?.status === 'pending' && currentMember?.status === 'pending',
      'REQUEST_NOT_PENDING',
      'This access request is no longer pending.',
    );
    if (event.platform)
      requireState(
        currentMember.emailVerified === true && !request.requestedRole,
        'EMAIL_VERIFICATION_REQUIRED',
        'Verify this attendee identity and use staff approval for staff requests.',
      );
    requireState(
      command.uid !== member.uid,
      'ORGANIZER_CANNOT_COMPETE',
      'Organizer accounts cannot join a competing team.',
    );
    requireState(
      members.filter(
        (candidate) => candidate.status === 'approved' && candidate.role !== 'organizer',
      ).length < 150,
      'MEMBER_LIMIT',
      'This event is limited to 150 approved participants.',
    );
    const teamId = command.teamId ?? request.teamId ?? `team_${command.commandId.slice(0, 100)}`;
    const existing = teams.find((team) => team.id === teamId);
    if (!existing) {
      requireState(
        !command.teamId && !request.teamId,
        'NOT_FOUND',
        'The selected team does not exist.',
      );
      requireState(
        ['DRAFT', 'REGISTRATION'].includes(event.phase),
        'ROSTER_LOCKED',
        'New teams can be created only before funding opens.',
      );
      requireState(
        teams.length < RULES.maxTeams,
        'TEAM_LIMIT',
        'This event is limited to 30 teams.',
      );
      requireState(
        command.role === 'captain',
        'CAPTAIN_REQUIRED',
        'The first approved person on a new team must be its captain.',
      );
      requireState(
        !teams.some((team) => team.name.toLowerCase() === request.teamName.toLowerCase()),
        'TEAM_EXISTS',
        'A team with this name exists. Approve the request into that team.',
      );
      const team: Team = {
        id: teamId,
        name: request.teamName,
        ticker: `${
          request.teamName
            .replace(/[^A-Za-z]/g, '')
            .slice(0, 4)
            .toUpperCase() || 'TEAM'
        }${teams.length + 1}`,
        pitch: '',
        category: 'Other',
        color: colors[teams.length % colors.length]!,
        problem: '',
        building: '',
        demoUrl: '',
        repoUrl: '',
        update: '',
        updatedAt: now,
        eligibility: 'active',
        captainUid: command.uid,
        version: 0,
      };
      const wallet: Wallet = {
        teamId,
        cashMinor: RULES.initialWalletMinor,
        reservedSeedMinor: 0,
        version: 0,
        lastTradeAt: 0,
        tradeWindowId: 0,
        successfulTradesInWindow: 0,
      };
      const pool: Pool = {
        issuerId: teamId,
        shareReserve: RULES.openingPoolShares,
        creditReserveMinor: RULES.openingPoolCashMinor,
        version: 0,
        halted: false,
      };
      const issuer: Issuer = {
        issuerId: teamId,
        issuedShares: RULES.issuedShares,
        primarySharesRemaining: RULES.primaryShares,
        fundingVaultMinor: 0,
        seedBackers: 0,
        version: 0,
      };
      tx.set(paths.team(teamId), team);
      if (!event.platform) {
        tx.set(paths.wallet(teamId), wallet);
        tx.set(paths.pool(teamId), pool);
        tx.set(paths.issuer(teamId), issuer);
        tx.set(
          paths.receipt(teamId, `genesis_${teamId}`),
          receipt(context, command, 'Initial virtual credits and project shares issued.', {
            id: `genesis_${teamId}`,
            kind: 'genesis',
            teamId,
            entries: [
              { account: `wallet:${teamId}`, asset: 'credits', delta: RULES.initialWalletMinor },
              { account: `pool:${teamId}`, asset: 'credits', delta: RULES.openingPoolCashMinor },
              {
                account: 'system:genesis',
                asset: 'credits',
                delta: -(RULES.initialWalletMinor + RULES.openingPoolCashMinor),
              },
              {
                account: `primary:${teamId}`,
                asset: `shares:${teamId}`,
                delta: RULES.primaryShares,
              },
              {
                account: `pool:${teamId}`,
                asset: `shares:${teamId}`,
                delta: RULES.openingPoolShares,
              },
              { account: 'system:genesis', asset: `shares:${teamId}`, delta: -RULES.issuedShares },
            ],
          }),
        );
      }
    } else {
      requireState(
        existing.eligibility === 'active',
        'TEAM_INACTIVE',
        'The selected team is inactive.',
      );
      this.assertRoleAvailable(members, teamId, command.uid, command.role);
      if (command.role === 'captain')
        tx.set(paths.team(teamId), {
          ...existing,
          captainUid: command.uid,
          version: existing.version + 1,
        });
    }
    const approved: Member = {
      uid: command.uid,
      displayName: request.displayName,
      teamId,
      role: command.role,
      status: 'approved',
      version: currentMember.version + 1,
      ...(currentMember.email
        ? { email: currentMember.email, emailVerified: currentMember.emailVerified === true }
        : {}),
    };
    tx.set(paths.member(command.uid), approved);
    tx.set(`${paths.team(teamId)}/members/${command.uid}`, approved);
    tx.set(paths.doc('accessRequests', command.uid), { ...request, teamId, status: 'approved' });
    // Serialize all roster mutations against the common event document.
    tx.set(paths.root, { ...event, phaseVersion: event.phaseVersion + 1 });
    return {
      message: `${request.displayName} approved${existing ? ` for ${existing.name}` : `. ${request.teamName} is ready`}.`,
    };
  }

  async role(context: CommandContext, command: Extract<Command, { type: 'setMemberRole' }>) {
    const { tx, paths, event, member } = context;
    Permissions.rosterEditable(event);
    const [target, members] = await Promise.all([
      tx.get<Member>(paths.member(command.uid)),
      tx.list<Member>(paths.collection('members'), 501),
    ]);
    requireState(target, 'NOT_FOUND', 'This member does not exist.');
    if (event.platform) {
      if (command.status === 'approved')
        requireState(
          target.emailVerified === true,
          'EMAIL_VERIFICATION_REQUIRED',
          'This account must verify its email before approval.',
        );
      requireState(
        !event.platform.rulesLockedAt || target.teamId === null || command.status === 'suspended',
        'ROSTER_LOCKED',
        'Competing team assignments and roles are locked after funding starts.',
      );
      requireState(
        !event.platform.rulesLockedAt || !target.teamId || command.role === target.role,
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
    if (command.role === 'organizer' || command.role === 'judge')
      requireState(
        target.teamId === null && member.role === 'organizer',
        'ORGANIZER_CANNOT_COMPETE',
        'Organizer identities must be separate from competing team identities.',
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
        target.teamId !== null ||
        command.status !== 'approved',
      'TEAM_REQUIRED',
      'Approve a pending person into a team using their request.',
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
        member.role === 'captain' || member.role === 'trader',
        'CAPTAIN_REQUIRED',
        'Your captain or designated investor can edit the project.',
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
        !('category' in command.patch) && !('update' in command.patch),
        'USE_CHECKPOINT_UPDATE',
        'Use the timestamped checkpoint update form. Categories are not used.',
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
