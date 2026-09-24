import { emptyPlatformSnapshot } from '@robinhacks/core';
import type {
  AccessRequest,
  AppSnapshot,
  AuditEntry,
  Command,
  CommandResult,
  EventConfig,
  MarketView,
  Member,
  Team,
  FundingCommand,
  CommunityCommand,
  FundingRound,
  OrganizerInvite,
  MessageRequest,
} from '@robinhacks/core';
import { fundingCommandTypes, platformCommandTypes } from './platform-schema';
import { FundingService } from './services/funding-service';
import { CommunityService } from './services/community-service';
import { canonicalJson, identifier, parseCommand } from './command-schema';
import { requireState } from './errors';
import { EventPaths } from './paths';
import type { Clock, Repository, Transaction } from './repository';
import { type CommandContext } from './services/context';
import { MembershipService } from './services/membership-service';
import { Permissions } from './services/permissions';
import { ProfileService } from './services/profile-service';
import { TeamFormationService } from './services/team-formation-service';
import { OrganizerAccessService } from './services/organizer-access-service';
import { TeamManagementService } from './services/team-management-service';

interface AcceptedCommand {
  payloadKey: string;
  actorUid: string;
  acceptedAt: number;
  result: CommandResult;
}
export interface Actor {
  uid: string;
  displayName?: string;
  email?: string;
  emailVerified?: boolean;
}
const emptyMarket = (): MarketView => ({ entries: [], asOf: 0, phaseVersion: 0 });
const emptySnapshot = (event: EventConfig | null, member: Member | null): AppSnapshot => ({
  event,
  member,
  market: emptyMarket(),
  members: [],
  requests: [],
  audit: [],
});

/** Application facade: authorization, transaction boundaries and orchestration only.
 * Domain arithmetic and persistence details remain independently replaceable. */
export class GameService {
  private readonly paths: EventPaths;
  private readonly membership = new MembershipService();
  private readonly profiles = new ProfileService();
  private readonly formation = new TeamFormationService();
  private readonly organizers = new OrganizerAccessService();
  private readonly teamManagement = new TeamManagementService();
  private readonly funding = new FundingService();
  private readonly community = new CommunityService();

  constructor(
    private readonly repository: Repository,
    eventId: string,
    private readonly clock: Clock,
  ) {
    this.paths = new EventPaths(eventId);
  }

  async execute(actor: Actor, input: Command): Promise<CommandResult> {
    identifier.parse(actor.uid);
    const command = parseCommand(input);
    const payloadKey = canonicalJson({ actorUid: actor.uid, command });
    return this.repository.transaction(async (tx) => {
      // The clock is sampled inside every transaction callback, including retries.
      const now = this.clock.now();
      const [event, member, prior] = await Promise.all([
        tx.get<EventConfig>(this.paths.root),
        tx.get<Member>(this.paths.member(actor.uid)),
        tx.get<AcceptedCommand>(
          `${this.paths.collection('commandReceipts')}/${actor.uid}__${command.commandId}`,
        ),
      ]);
      requireState(event, 'EVENT_NOT_FOUND', 'This event has not been configured yet.');
      requireState(
        !event.maintenance,
        'MAINTENANCE',
        'Event setup is in progress. Please try again shortly.',
      );
      requireState(
        event.rulesVersion === 2 && event.platform?.version === 2,
        'RULES_MISMATCH',
        'This deployment does not support the event’s frozen rules version.',
      );
      if (command.type !== 'requestMembership') Permissions.member(member);
      requireState(
        actor.emailVerified !== false,
        'EMAIL_VERIFICATION_REQUIRED',
        'Use a verified Google account before making changes.',
      );
      if (
        member?.status === 'approved' &&
        member.teamId === null &&
        !['organizer', 'judge'].includes(member.role)
      )
        requireState(
          [
            'createFormationTeam',
            'joinFormationTeam',
            'updateProfile',
            'sendGeneralMessage',
            'readGeneral',
          ].includes(command.type),
          'TEAM_FORMATION_REQUIRED',
          'Choose your team and role before entering the event.',
        );
      if (prior) {
        this.assertReplay(prior.payloadKey, payloadKey);
        return prior.result;
      }
      const context: CommandContext = {
        tx,
        paths: this.paths,
        event,
        member: member ?? {
          uid: actor.uid,
          displayName: actor.displayName ?? '',
          teamId: null,
          role: 'member',
          status: 'pending',
          version: 0,
        },
        actor,
        now,
        clock: this.clock,
        payloadKey,
      };
      let result: CommandResult;
      if (platformCommandTypes.has(command.type)) {
        result = fundingCommandTypes.has(command.type)
          ? await this.funding.execute(context, command as FundingCommand)
          : await this.community.execute(context, command as CommunityCommand);
      } else
        switch (command.type) {
          case 'requestMembership':
            result = await this.membership.request(context, command);
            break;
          case 'approveMembership':
            result = await this.membership.approve(context, command);
            break;
          case 'setTeamFormation':
          case 'createFormationTeam':
          case 'joinFormationTeam':
            result = await this.formation.execute(context, command);
            break;
          case 'addOrganizerEmail':
          case 'removeOrganizerEmail':
          case 'removeMember':
            result = await this.organizers.execute(context, command);
            break;
          case 'adminCreateTeam':
          case 'adminUpdateTeam':
          case 'adminAssignMember':
          case 'adminDeleteTeam':
          case 'adminReopenSubmission':
          case 'adminUpdateSubmission':
          case 'adminUpdateMember':
            result = await this.teamManagement.execute(context, command);
            break;
          case 'setMemberRole':
            result = await this.membership.role(context, command);
            break;
          case 'updateTeam':
            result = await this.membership.profile(context, command);
            break;
          case 'updateProfile':
            result = this.profiles.update(context, command);
            break;
          case 'transitionEvent':
            result = await this.transition(context, command);
            break;
          case 'setPause':
            result = await this.pause(context, command);
            break;
          case 'setAnnouncement': {
            Permissions.organizer(context.member);
            requireState(
              command.expectedVersion === (event.announcementVersion ?? 0),
              'NOTE_CHANGED',
              'Another organizer updated this note. Load the current note before saving.',
            );
            tx.set(this.paths.root, {
              ...event,
              announcement: command.announcement,
              announcementVersion: (event.announcementVersion ?? 0) + 1,
              announcementUpdatedAt: now,
              announcementAuthor: context.member.displayName,
              phaseVersion: event.phaseVersion + 1,
            });
            result = {
              message: command.announcement ? 'Organizer note posted.' : 'Organizer note removed.',
            };
            break;
          }
          case 'haltIssuer':
            result = await this.halt(context, command);
            break;
          default:
            throw new Error('Unsupported command.');
        }
      if (
        ![
          'sendMessage',
          'sendGeneralMessage',
          'readGeneral',
          'removeChatMessage',
          'readConversation',
          'blockConversation',
          'reportMessage',
          'saveJudgingSheet',
          'saveAllocation',
          'saveBallot',
          'updateProfile',
        ].includes(command.type)
      )
        await this.refreshProjection(tx, now);
      tx.set(`${this.paths.collection('commandReceipts')}/${actor.uid}__${command.commandId}`, {
        actorUid: actor.uid,
        payloadKey,
        acceptedAt: now,
        result,
      });
      if (
        (context.member.role === 'organizer' &&
          !['readGeneral', 'readConversation'].includes(command.type)) ||
        ['updateTeam', 'setMemberRole', 'publishUpdate', 'submitProject'].includes(command.type)
      ) {
        const audit: AuditEntry = {
          id: `${actor.uid}__${command.commandId}`,
          actorUid: actor.uid,
          action: command.type,
          detail: result.message ?? command.type,
          createdAt: now,
        };
        if (command.type === 'haltIssuer' || command.type === 'setPause')
          audit.detail += ` Reason: ${command.reason}`;
        tx.set(`${this.paths.collection('adminAudit')}/${audit.id}`, audit);
      }
      return result;
    });
  }

  async snapshot(uid: string, identity?: Actor): Promise<AppSnapshot> {
    identifier.parse(uid);
    requireState(
      !identity || identity.uid === uid,
      'IDENTITY_MISMATCH',
      'The signed-in identity does not match.',
    );
    return this.repository.transaction(async (tx) => {
      let [event, member] = await Promise.all([
        tx.get<EventConfig>(this.paths.root),
        tx.get<Member>(this.paths.member(uid)),
      ]);
      if (event) {
        requireState(
          !event.maintenance,
          'MAINTENANCE',
          'Event setup is in progress. Please try again shortly.',
        );
        requireState(
          event.rulesVersion === 2 && event.platform?.version === 2,
          'RULES_MISMATCH',
          'This event needs the current funding-round format.',
        );
        if (identity) {
          member = await this.organizers.claim(
            tx,
            this.paths,
            event,
            member,
            identity,
            this.clock.now(),
          );
          event = (await tx.get<EventConfig>(this.paths.root))!;
        }
      }
      const snapshot = emptySnapshot(event, member);
      if (event?.platform) snapshot.platform = emptyPlatformSnapshot();
      if (
        member &&
        identity?.email &&
        (member.email !== identity.email || member.emailVerified !== identity.emailVerified)
      ) {
        member.email = identity.email;
        member.emailVerified = identity.emailVerified === true;
        tx.set(this.paths.member(uid), member);
      }
      if (!event || !member || member.status !== 'approved') {
        if (event) {
          const request = await tx.get<AccessRequest>(this.paths.doc('accessRequests', uid));
          if (request) snapshot.requests = [request];
        }
        return snapshot;
      }
      if (member.teamId === null && !['organizer', 'judge'].includes(member.role)) {
        snapshot.formationTeams = await this.formation.directory(tx, this.paths);
        snapshot.platform!.general = await this.community.generalSummary(tx, this.paths, member);
        return snapshot;
      }
      if (['organizer', 'judge'].includes(member.role))
        requireState(
          member.teamId === null,
          'STAFF_CANNOT_COMPETE',
          'Judges and organizers must use separate staff identities.',
        );
      const now = this.clock.now();
      const context = { tx, paths: this.paths, event, member, now };
      const teams = await tx.list<Team>(this.paths.collection('teams'), 31);
      snapshot.market = {
        entries: teams.map((team) => ({ team })),
        asOf: now,
        phaseVersion: event.phaseVersion,
      };
      snapshot.platform = {
        ...emptyPlatformSnapshot(),
        ...(await this.funding.snapshot(context)),
        ...(await this.community.snapshot(context)),
      };
      const members = await tx.list<Member>(this.paths.collection('members'), 501);
      if (member.role === 'organizer') {
        snapshot.members = members;
        snapshot.organizerInvites = (
          await tx.list<OrganizerInvite>(this.paths.collection('organizerInvites'), 501)
        )
          .map(({ email, createdAt }) => ({ email, createdAt }))
          .sort((a, b) => a.email.localeCompare(b.email));
        snapshot.requests = (
          await tx.list<AccessRequest>(this.paths.collection('accessRequests'), 501)
        ).filter((request) => request.status === 'pending');
        snapshot.audit = (await tx.list<AuditEntry>(this.paths.collection('adminAudit'), 1000))
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, 100);
      } else {
        snapshot.members = members
          .filter((entry) => entry.teamId && entry.teamId === member.teamId)
          .map(({ email, emailVerified, ...safe }) => safe);
      }
      return snapshot;
    });
  }

  async publicSnapshot(): Promise<AppSnapshot> {
    return this.repository.transaction(async (tx) => {
      const event = await tx.get<EventConfig>(this.paths.root);
      const snapshot = emptySnapshot(
        event ? { ...event, tieSeed: '', activeOperationId: null } : null,
        null,
      );
      if (event?.platform) snapshot.platform = emptyPlatformSnapshot();
      return snapshot;
    });
  }

  async messages(uid: string, request: MessageRequest) {
    identifier.parse(uid);
    requireState(
      ['general', 'team', 'review'].includes(request.kind),
      'INVALID_CHANNEL',
      'Choose a channel.',
    );
    if (request.kind !== 'general') identifier.parse(request.id);
    requireState(
      request.before === undefined ||
        (Number.isSafeInteger(request.before) && request.before >= 1 && request.before <= 100001),
      'INVALID_CURSOR',
      'Refresh the conversation before loading more messages.',
    );
    return this.repository.transaction(async (tx) => {
      const [member, event] = await Promise.all([
        tx.get<Member>(this.paths.member(uid)),
        tx.get<EventConfig>(this.paths.root),
      ]);
      Permissions.member(member);
      requireState(
        event?.platform && !event.maintenance,
        'MAINTENANCE',
        'Event setup is in progress. Please try again shortly.',
      );
      return this.community.messages(tx, this.paths, member, request);
    });
  }

  async conversationDirectory(uid: string) {
    identifier.parse(uid);
    return this.repository.transaction(async (tx) => {
      const [member, event] = await Promise.all([
        tx.get<Member>(this.paths.member(uid)),
        tx.get<EventConfig>(this.paths.root),
      ]);
      Permissions.member(member);
      requireState(
        event?.platform && !event.maintenance,
        'MAINTENANCE',
        'Event setup is in progress. Please try again shortly.',
      );
      return this.community.conversationDirectory(tx, this.paths, member);
    });
  }

  async exportEvent(uid: string): Promise<Record<string, unknown>> {
    identifier.parse(uid);
    return this.repository.transaction(async (tx) => {
      const member = await tx.get<Member>(this.paths.member(uid));
      Permissions.member(member);
      Permissions.organizer(member);
      const event = await tx.get<EventConfig>(this.paths.root);
      requireState(event, 'EVENT_NOT_FOUND', 'This event does not exist.');
      requireState(
        !event.maintenance,
        'MAINTENANCE',
        'Event setup is in progress. Please try again shortly.',
      );
      requireState(
        event.rulesVersion === 2 && event.platform?.version === 2,
        'RULES_MISMATCH',
        'This event needs the current funding-round format.',
      );
      requireState(
        event.paused ||
          [
            'DRAFT',
            'REGISTRATION',
            'FROZEN',
            'FINALIZED',
            'CANCELLED',
            'ARCHIVED',
            'INTERMISSION',
          ].includes(event.phase),
        'EXPORT_REQUIRES_PAUSE',
        'Pause the event to export a stable audit snapshot.',
      );
      const data: Record<string, unknown> = {
        schemaVersion: 2,
        exportedAt: this.clock.now(),
        event,
      };
      const rounds = await tx.list<FundingRound>(this.paths.collection('fundingRounds'), 4);
      requireState(
        !rounds.some((round) => round.state === 'open'),
        'ROUND_SEALED',
        'Close the sealed round before exporting allocations. Pausing does not reveal them.',
      );
      requireState(
        ['FINALIZED', 'CANCELLED', 'ARCHIVED'].includes(event.phase),
        'EXPORT_AFTER_RESULTS',
        'Export the complete private event record only after publication or cancellation.',
      );
      for (const name of [
        'teams',
        'members',
        'fundingRounds',
        'roundAllocations',
        'roundEntitlements',
        'projectUpdates',
        'submissions',
        'judgeAssignments',
        'judgingSheets',
        'communityBallots',
        'awardResults',
        'adminAudit',
        'accessRequests',
      ])
        data[name] = await tx.list(this.paths.collection(name), 1000);
      for (const name of ['removedMembers', 'submissionCorrections', 'teamManagementAudit']) {
        const records = await tx.list(this.paths.collection(name), 1001);
        requireState(
          records.length <= 1000,
          'EXPORT_HISTORY_LIMIT',
          `This event has more than 1,000 ${name} records. Export requires support to preserve the complete history.`,
        );
        data[name] = records;
      }
      const exportId = `export_${uid.slice(0, 60)}_${this.clock.now()}`;
      tx.set(this.paths.doc('adminAudit', exportId), {
        id: exportId,
        actorUid: uid,
        action: 'exportEvent',
        detail:
          'Exported the sealed funding record and final judging records after publication or cancellation.',
        createdAt: this.clock.now(),
      });
      return data;
    });
  }

  private async transition(
    context: CommandContext,
    command: Extract<Command, { type: 'transitionEvent' }>,
  ): Promise<CommandResult> {
    const { tx, event, member, now } = context;
    Permissions.organizer(member);
    requireState(
      event.phaseVersion === command.expectedPhaseVersion,
      'EVENT_CHANGED',
      'The event changed. Refresh its controls.',
    );
    requireState(
      command.target === 'CANCELLED' &&
        !['FINALIZED', 'ARCHIVED', 'CANCELLED'].includes(event.phase),
      'USE_FUNDING_WORKFLOW',
      'Use the funding and judging controls for this event.',
    );
    const rounds = await tx.list<FundingRound>(context.paths.collection('fundingRounds'), 4);
    for (const round of rounds)
      if (round.state === 'open')
        tx.set(context.paths.doc('fundingRounds', round.id), {
          ...round,
          state: 'void',
          totals: {},
          voidReason: 'Event cancelled',
          version: round.version + 1,
        });
    tx.set(context.paths.root, {
      ...event,
      phase: 'CANCELLED',
      phaseVersion: event.phaseVersion + 1,
      closesAt: null,
      paused: false,
      pauseReason: '',
      platform: { ...event.platform, submissionsOpen: false, ballotOpen: false },
    });
    return {
      message: 'Event cancelled. History is preserved; investor rewards will not be paid.',
    };
  }

  private async pause(context: CommandContext, command: Extract<Command, { type: 'setPause' }>) {
    const { tx, paths, member, event } = context;
    Permissions.organizer(member);
    Permissions.editable(event);
    requireState(
      event.phaseVersion === command.expectedPhaseVersion,
      'EVENT_CHANGED',
      'The event changed. Refresh its controls.',
    );
    requireState(
      !command.paused || command.reason.trim().length >= 3,
      'REASON_REQUIRED',
      'Give a short reason for the pause.',
    );
    requireState(
      command.paused !== event.paused,
      'PAUSE_UNCHANGED',
      'The pause state already matches.',
    );
    const pausedAt = event.pausedAt ?? context.now;
    const extension = command.paused ? 0 : Math.max(0, context.now - pausedAt);
    const extend = (deadline: number | null) =>
      deadline && deadline > pausedAt ? deadline + extension : deadline;
    const rounds = await tx.list<FundingRound>(paths.collection('fundingRounds'), 4);
    for (const round of rounds)
      if (round.state === 'open' && !command.paused && round.closesAt > pausedAt)
        tx.set(paths.doc('fundingRounds', round.id), {
          ...round,
          closesAt: round.closesAt + extension,
          version: round.version + 1,
        });
    tx.set(paths.root, {
      ...event,
      paused: command.paused,
      pausedAt: command.paused ? context.now : null,
      pauseReason: command.paused ? command.reason : '',
      phaseVersion: event.phaseVersion + 1,
      closesAt: extend(event.closesAt),
      platform: {
        ...event.platform,
        submissionClosesAt: extend(event.platform!.submissionClosesAt),
        ballotClosesAt: extend(event.platform!.ballotClosesAt),
      },
    });
    return {
      message: command.paused
        ? 'Event paused. Remaining submission time is preserved for everyone.'
        : 'Event resumed. Active deadlines were extended equally.',
    };
  }

  private async halt(context: CommandContext, command: Extract<Command, { type: 'haltIssuer' }>) {
    const { tx, paths, event, member } = context;
    Permissions.organizer(member);
    Permissions.editable(event);
    requireState(
      !event.activeOperationId,
      'OPERATION_RUNNING',
      'Finish the current immutable operation before changing eligibility.',
    );
    requireState(
      event.paused || ['DRAFT', 'REGISTRATION', 'FROZEN', 'INTERMISSION'].includes(event.phase),
      'PAUSE_REQUIRED',
      'Pause the event before changing project eligibility.',
    );
    const team = await tx.get<Team>(paths.team(command.issuerId));
    requireState(team, 'NOT_FOUND', 'The project does not exist.');
    const rounds = await tx.list<FundingRound>(paths.collection('fundingRounds'), 4);
    requireState(
      !rounds.some((round) => round.state === 'open'),
      'ROUND_OPEN',
      'Close or formally void the open round before changing project eligibility.',
    );
    requireState(
      !event.platform!.rulesLockedAt ||
        command.eligibility !== 'active' ||
        team.eligibility === 'active',
      'ROSTER_LOCKED',
      'A withdrawn project cannot re-enter after funding begins.',
    );
    tx.set(paths.team(team.id), {
      ...team,
      eligibility: command.eligibility,
      version: team.version + 1,
    });
    tx.set(paths.root, { ...event, phaseVersion: event.phaseVersion + 1 });
    return {
      message: `${team.name} is ${command.eligibility}. Existing investments are preserved without refunds.`,
    };
  }

  private async refreshProjection(tx: Transaction, now: number) {
    const event = await tx.get<EventConfig>(this.paths.root);
    requireState(event, 'EVENT_NOT_FOUND', 'This event does not exist.');
    const teams = await tx.list<Team>(this.paths.collection('teams'), 31);
    tx.set(this.paths.doc('views', 'market'), {
      entries: teams.map((team) => ({ team })),
      asOf: now,
      phaseVersion: event.phaseVersion,
    });
  }

  private assertReplay(previous: string, current: string) {
    requireState(
      previous === current,
      'COMMAND_CONFLICT',
      'This request identifier was already used with different content.',
    );
  }
}
