import { RULES, SealedFunding } from '@robinhacks/core';
import type {
  CommandResult,
  FundingCommand,
  FundingRound,
  Member,
  PlatformConfig,
  PlatformSnapshot,
  ProjectSubmission,
  ProjectUpdate,
  RoundAllocation,
  RoundEntitlement,
  Team,
} from '@robinhacks/core';
import { requireState } from '../errors';
import type { CommandContext } from './context';
import { Permissions } from './permissions';

type FundingSnapshotContext = Pick<CommandContext, 'tx' | 'paths' | 'event' | 'member' | 'now'>;

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
    return Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)));
  });
}

/** Owns sealed sheets, frozen round claims, and the organizer's round lifecycle. */
export class FundingService {
  async execute(context: CommandContext, command: FundingCommand): Promise<CommandResult> {
    Permissions.member(context.member);
    const platform = this.platform(context);
    if (command.type === 'saveAllocation') return this.save(context, command, platform);
    Permissions.organizer(context.member);
    Permissions.editable(context.event);
    requireState(
      !context.event.activeOperationId,
      'OPERATION_RUNNING',
      'Finish the current operation first.',
    );
    if (command.type === 'configurePlatform') return this.configure(context, command, platform);
    requireState(
      context.event.phaseVersion === command.expectedPhaseVersion,
      'PHASE_CHANGED',
      'The event state changed. Refresh before continuing.',
    );
    if (command.type === 'openFundingRound') return this.open(context, command, platform);
    if (command.type === 'closeFundingRound') return this.close(context, command, platform);
    return this.void(context, command);
  }

  async snapshot(
    context: FundingSnapshotContext,
  ): Promise<Pick<PlatformSnapshot, 'rounds' | 'allocation' | 'entitlements'>> {
    if (context.member.status !== 'approved' || !context.event.platform)
      return { rounds: [], allocation: null, entitlements: [] };
    const { tx, paths, member, event } = context;
    const rounds = await tx.list<FundingRound>(paths.collection('fundingRounds'), 4);
    requireState(
      rounds.length <= 3,
      'RECONCILIATION_FAILED',
      'The event has too many funding rounds.',
    );
    const teamId =
      member.teamId && !['organizer', 'judge'].includes(member.role) ? member.teamId : null;
    const current = rounds.find((round) => round.number === event.platform!.currentRound);
    const allocation =
      teamId && current
        ? await tx.get<RoundAllocation>(paths.doc('roundAllocations', `${current.id}__${teamId}`))
        : null;
    const entitlements = teamId
      ? (
          await Promise.all(
            rounds
              .filter((round) => round.state !== 'open')
              .map((round) =>
                tx.get<RoundEntitlement>(paths.doc('roundEntitlements', `${round.id}__${teamId}`)),
              ),
          )
        ).filter((entry): entry is RoundEntitlement => entry !== null)
      : [];
    const blindJudge = member.role === 'judge' && !['FINALIZED', 'ARCHIVED'].includes(event.phase);
    return {
      rounds: rounds
        .sort((a, b) => a.number - b.number)
        .map((round) => ({
          ...round,
          totals: round.state === 'open' || blindJudge ? {} : round.totals,
        })),
      allocation,
      entitlements,
    };
  }

  private platform(context: FundingSnapshotContext): PlatformConfig {
    requireState(
      context.event.platform?.version === 2,
      'PLATFORM_REQUIRED',
      'This event has not been configured for sealed funding.',
    );
    return context.event.platform;
  }

  private configure(
    context: CommandContext,
    command: Extract<FundingCommand, { type: 'configurePlatform' }>,
    platform: PlatformConfig,
  ): CommandResult {
    SealedFunding.validateSettings(command.funding);
    requireState(
      platform.rulesLockedAt === null || canonical(platform.funding) === canonical(command.funding),
      'RULES_LOCKED',
      'Funding and judging rules are fixed once the first round opens.',
    );
    requireState(command.name.trim().length > 0, 'INVALID_EVENT', 'Enter an event name.');
    context.tx.set(context.paths.root, {
      ...context.event,
      name: command.name.trim(),
      venue: command.venue.trim(),
      platform: { ...platform, details: command.details, funding: command.funding },
    });
    return { message: 'Event settings saved.' };
  }

  private async open(
    context: CommandContext,
    command: Extract<FundingCommand, { type: 'openFundingRound' }>,
    platform: PlatformConfig,
  ): Promise<CommandResult> {
    const { tx, paths, event } = context;
    requireState(!event.paused, 'EVENT_PAUSED', 'Resume the event before opening a round.');
    requireState(
      (platform.currentRound === 0 && event.phase === 'REGISTRATION') ||
        (platform.currentRound > 0 && event.phase === 'INTERMISSION'),
      'INVALID_PHASE',
      'Open funding after registration or the previous completed round.',
    );
    const number = platform.currentRound + 1;
    requireState(number <= 3, 'ROUND_LIMIT', 'All three funding rounds have already run.');
    requireState(
      Number.isInteger(command.durationMinutes) &&
        command.durationMinutes >= 1 &&
        command.durationMinutes <= 1_440,
      'INVALID_DURATION',
      'A funding window must last between one minute and 24 hours.',
    );
    SealedFunding.validateSettings(platform.funding);
    const [teams, members, rounds, updates, submissions] = await Promise.all([
      tx.list<Team>(paths.collection('teams'), RULES.maxTeams + 1),
      tx.list<Member>(paths.collection('members'), 501),
      tx.list<FundingRound>(paths.collection('fundingRounds'), 4),
      tx.list<ProjectUpdate>(paths.collection('projectUpdates'), 301),
      number === 3
        ? tx.list<ProjectSubmission>(paths.collection('submissions'), 31)
        : Promise.resolve([]),
    ]);
    requireState(
      updates.length <= 300,
      'UPDATE_LIMIT',
      'The event exceeds its checkpoint update limit.',
    );
    requireState(
      teams.length <= RULES.maxTeams,
      'TEAM_LIMIT',
      'This event supports at most 30 teams.',
    );
    requireState(
      members.length <= 500 &&
        members.filter(
          (member) =>
            member.status === 'approved' &&
            member.teamId !== null &&
            !['organizer', 'judge'].includes(member.role),
        ).length <= 150,
      'MEMBER_LIMIT',
      'This event supports at most 150 competing participants and 500 access records.',
    );
    requireState(
      rounds.length === platform.currentRound && rounds.every((round) => round.state !== 'open'),
      'ROUND_OPEN',
      'Complete the previous round before opening another.',
    );
    requireState(
      !rounds.some((round) => round.number === number),
      'ROUND_EXISTS',
      'This funding round already exists.',
    );
    const active = teams.filter((team) => team.eligibility === 'active');
    requireState(active.length >= 2, 'TOO_FEW_TEAMS', 'At least two active teams are required.');
    requireState(
      active.every((team) =>
        members.some(
          (member) =>
            member.uid === team.captainUid &&
            member.teamId === team.id &&
            member.role === 'captain' &&
            member.status === 'approved',
        ),
      ),
      'TEAM_NOT_APPROVED',
      'Every active team needs an approved captain.',
    );
    requireState(
      active.every((team) =>
        updates.some(
          (update) =>
            update.teamId === team.id &&
            update.round === number &&
            update.works.trim() &&
            (number === 1 || update.changed.trim()) &&
            update.incomplete.trim(),
        ),
      ),
      'CHECKPOINT_REQUIRED',
      'Every active team must publish its checkpoint update before this round opens.',
    );
    requireState(
      number !== 3 ||
        active.every((team) => submissions.some((submission) => submission.teamId === team.id)),
      'SUBMISSION_REQUIRED',
      'Every active team must submit its final project before the final funding round.',
    );
    const now = context.clock.now();
    context.now = now;
    const round: FundingRound = {
      id: `funding-${number}`,
      number,
      name: platform.funding.roundNames[number - 1],
      state: 'open',
      openedAt: now,
      closesAt: now + command.durationMinutes * 60_000,
      closedAt: null,
      weightBps: platform.funding.roundWeightsBps[number - 1],
      minimumDenominator: platform.funding.minimumDenominator,
      eligibleTeamIds: active.map((team) => team.id).sort(),
      totals: {},
      voidReason: '',
      version: 1,
    };
    tx.set(paths.doc('fundingRounds', round.id), round);
    tx.set(paths.root, {
      ...event,
      phase: 'SEED_OPEN',
      phaseVersion: event.phaseVersion + 1,
      windowId: number,
      closesAt: round.closesAt,
      platform: {
        ...platform,
        currentRound: number,
        rulesLockedAt: platform.rulesLockedAt ?? now,
        ...(number === 3 ? { submissionsOpen: false, submissionClosesAt: null } : {}),
      },
    });
    return {
      message: `${round.name} is open. Each team has a new ${platform.funding.budget}-credit budget.`,
    };
  }

  private async save(
    context: CommandContext,
    command: Extract<FundingCommand, { type: 'saveAllocation' }>,
    platform: PlatformConfig,
  ): Promise<CommandResult> {
    const { tx, paths, member, event } = context;
    const teamId = Permissions.team(member);
    const id = `${command.roundId}__${teamId}`;
    const [team, round, allocation, teams] = await Promise.all([
      tx.get<Team>(paths.team(teamId)),
      tx.get<FundingRound>(paths.doc('fundingRounds', command.roundId)),
      tx.get<RoundAllocation>(paths.doc('roundAllocations', id)),
      tx.list<Team>(paths.collection('teams'), 31),
    ]);
    requireState(team && round, 'NOT_FOUND', 'The team or funding round was not found.');
    Permissions.trader(member, team);
    requireState(
      event.phase === 'SEED_OPEN' &&
        !event.activeOperationId &&
        round.state === 'open' &&
        round.number === platform.currentRound,
      'ROUND_CLOSED',
      'This funding round is closed.',
    );
    requireState(
      !event.paused,
      'EVENT_PAUSED',
      'Funding is paused. Your saved allocation is unchanged.',
    );
    const now = context.clock.now();
    context.now = now;
    requireState(
      now < round.closesAt && event.closesAt !== null && now < event.closesAt,
      'ROUND_CLOSED',
      'The funding deadline has passed.',
    );
    requireState(
      (allocation?.version ?? 0) === command.expectedVersion,
      'ALLOCATION_CHANGED',
      'A teammate changed this allocation. Reload before saving.',
    );
    const amounts = SealedFunding.validateAllocation(
      teamId,
      command.amounts,
      round.eligibleTeamIds,
      platform.funding,
    );
    requireState(
      Object.keys(amounts).every((projectId) =>
        teams.some((project) => project.id === projectId && project.eligibility === 'active'),
      ),
      'TEAM_INACTIVE',
      'One of these projects is no longer eligible for new allocations.',
    );
    tx.set<RoundAllocation>(paths.doc('roundAllocations', id), {
      id,
      roundId: round.id,
      teamId,
      amounts,
      version: (allocation?.version ?? 0) + 1,
      updatedAt: now,
      actorUid: member.uid,
    });
    return { message: 'Allocation saved. Amounts stay private until the round closes.' };
  }

  private async close(
    context: CommandContext,
    command: Extract<FundingCommand, { type: 'closeFundingRound' }>,
    platform: PlatformConfig,
  ): Promise<CommandResult> {
    const { tx, paths, event } = context;
    requireState(
      event.phase === 'SEED_OPEN' && !event.paused,
      'INVALID_PHASE',
      'Resume the active round before closing it at the deadline.',
    );
    const round = await tx.get<FundingRound>(paths.doc('fundingRounds', command.roundId));
    requireState(
      round && round.number === platform.currentRound && round.state === 'open',
      'ROUND_CLOSED',
      'This round is not open.',
    );
    const [sheets, previous] = await Promise.all([
      Promise.all(
        round.eligibleTeamIds.map((teamId) =>
          tx.get<RoundAllocation>(paths.doc('roundAllocations', `${round.id}__${teamId}`)),
        ),
      ),
      Promise.all(
        round.eligibleTeamIds.map((teamId) =>
          tx.get<RoundEntitlement>(paths.doc('roundEntitlements', `${round.id}__${teamId}`)),
        ),
      ),
    ]);
    requireState(
      previous.every((entry) => entry === null),
      'RECONCILIATION_FAILED',
      'This round already has immutable reward claims.',
    );
    const now = context.clock.now();
    context.now = now;
    const closed = SealedFunding.closeRound(
      round,
      sheets.filter((sheet): sheet is RoundAllocation => sheet !== null),
      platform.funding,
      now,
    );
    for (const entitlement of closed.entitlements)
      tx.set(paths.doc('roundEntitlements', entitlement.id), entitlement);
    tx.set(paths.doc('fundingRounds', round.id), closed.round);
    tx.set(paths.root, {
      ...event,
      phase: 'INTERMISSION',
      phaseVersion: event.phaseVersion + 1,
      closesAt: null,
    });
    return {
      message: `${round.name} closed. Funding totals and your fixed reward claims are available.`,
    };
  }

  private async void(
    context: CommandContext,
    command: Extract<FundingCommand, { type: 'voidFundingRound' }>,
  ): Promise<CommandResult> {
    const { tx, paths, event } = context;
    requireState(
      ['INTERMISSION', 'FROZEN'].includes(event.phase),
      'INVALID_PHASE',
      'Void a completed round between funding windows or before judging.',
    );
    requireState(
      command.reason.trim().length >= 10,
      'REASON_REQUIRED',
      'Explain why the whole round is being voided.',
    );
    const round = await tx.get<FundingRound>(paths.doc('fundingRounds', command.roundId));
    requireState(
      round?.state === 'closed',
      'ROUND_CLOSED',
      'Only a completed, non-void round can be voided.',
    );
    const entitlements = await Promise.all(
      round.eligibleTeamIds.map((teamId) =>
        tx.get<RoundEntitlement>(paths.doc('roundEntitlements', `${round.id}__${teamId}`)),
      ),
    );
    requireState(
      entitlements.every((entry) => entry !== null),
      'RECONCILIATION_FAILED',
      'The round has missing reward claims.',
    );
    for (const entitlement of entitlements)
      tx.set(paths.doc('roundEntitlements', entitlement!.id), { ...entitlement!, voided: true });
    tx.set(paths.doc('fundingRounds', round.id), {
      ...round,
      state: 'void',
      voidReason: command.reason.trim(),
      version: round.version + 1,
    });
    tx.set(paths.root, { ...event, phaseVersion: event.phaseVersion + 1 });
    return {
      message:
        'The entire round is void. Its reward reserve remains unallocated; it cannot be reopened.',
    };
  }
}
