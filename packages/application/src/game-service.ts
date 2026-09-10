import { EventPolicy, RULES } from '@robinhacks/core';
import type {
  AccessRequest,
  AppSnapshot,
  AuditEntry,
  Command,
  CommandResult,
  Commitment,
  EventConfig,
  MarketView,
  Member,
  Note,
  Operation,
  Pool,
  Position,
  Receipt,
  ResultsView,
  Team,
  Wallet,
} from '@robinhacks/core';
import { canonicalJson, identifier, parseCommand } from './command-schema';
import { requireState } from './errors';
import { EventPaths } from './paths';
import type { Clock, Repository, Transaction } from './repository';
import { receipt, type CommandContext } from './services/context';
import { MarketService } from './services/market-service';
import { MembershipService } from './services/membership-service';
import { OperationService } from './services/operation-service';
import { Permissions } from './services/permissions';

interface AcceptedCommand {
  payloadKey: string;
  actorUid: string;
  acceptedAt: number;
  result: CommandResult;
}
export interface Actor {
  uid: string;
  displayName?: string;
}
const emptyMarket = (): MarketView => ({ entries: [], asOf: 0, phaseVersion: 0 });
const emptySnapshot = (event: EventConfig | null, member: Member | null): AppSnapshot => ({
  event,
  member,
  market: emptyMarket(),
  wallet: null,
  positions: [],
  commitments: null,
  notes: [],
  receipts: [],
  members: [],
  requests: [],
  operation: null,
  results: null,
  audit: [],
});

/** Application facade: authorization, transaction boundaries and orchestration only.
 * Domain arithmetic and persistence details remain independently replaceable. */
export class GameService {
  private readonly paths: EventPaths;
  private readonly market = new MarketService();
  private readonly membership = new MembershipService();
  private readonly operations = new OperationService();

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
        event.rulesVersion === RULES.version,
        'RULES_MISMATCH',
        'This deployment does not support the event’s frozen rules version.',
      );
      if (command.type !== 'requestMembership') Permissions.member(member);
      if (prior) {
        this.assertReplay(prior.payloadKey, payloadKey);
        return prior.result;
      }
      if (member?.teamId) {
        const accepted = await tx.get<Receipt>(
          this.paths.receipt(member.teamId, command.commandId),
        );
        if (accepted) {
          this.assertReplay(accepted.payloadKey, payloadKey);
          return { receipt: accepted };
        }
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
      switch (command.type) {
        case 'executeTrade':
          return this.market.trade(context, command);
        case 'requestMembership':
          result = await this.membership.request(context, command);
          break;
        case 'approveMembership':
          result = await this.membership.approve(context, command);
          break;
        case 'setMemberRole':
          result = await this.membership.role(context, command);
          break;
        case 'updateTeam':
          result = await this.membership.profile(context, command);
          break;
        case 'setSeedCommitments':
          result = await this.market.commitments(context, command);
          break;
        case 'saveNote':
          result = await this.market.note(context, command);
          break;
        case 'transitionEvent':
          result = await this.transition(context, command);
          break;
        case 'setPause':
          result = await this.pause(context, command);
          break;
        case 'setAnnouncement': {
          Permissions.organizer(context.member);
          Permissions.editable(event);
          tx.set(this.paths.root, { ...event, announcement: command.announcement });
          result = { message: 'Event announcement updated.' };
          break;
        }
        case 'haltIssuer':
          result = await this.halt(context, command);
          break;
        case 'continueOperation': {
          Permissions.organizer(context.member);
          result = { operation: await this.operations.continue(context, command) };
          break;
        }
        case 'prepareResults': {
          Permissions.organizer(context.member);
          result = { operation: await this.operations.startResults(context, command) };
          break;
        }
        case 'publishResults':
          Permissions.organizer(context.member);
          result = await this.operations.publish(context, command);
          break;
        case 'refreshMarket': {
          Permissions.organizer(context.member);
          const view = await tx.get<MarketView>(this.paths.doc('views', 'market'));
          if (view && now - view.asOf < 120_000 && view.phaseVersion === event.phaseVersion)
            return { message: 'Market snapshot is current.' };
          await this.refreshProjection(tx, now);
          // Projection refresh is naturally idempotent in this single transaction.
          return { message: 'Market snapshot refreshed.' };
        }
      }
      if (
        [
          'approveMembership',
          'setMemberRole',
          'updateTeam',
          'transitionEvent',
          'haltIssuer',
          'publishResults',
          'setPause',
        ].includes(command.type) ||
        (command.type === 'continueOperation' && result.operation?.state === 'complete')
      )
        await this.refreshProjection(tx, now);
      tx.set(`${this.paths.collection('commandReceipts')}/${actor.uid}__${command.commandId}`, {
        actorUid: actor.uid,
        payloadKey,
        acceptedAt: now,
        result,
      });
      if (
        context.member.role === 'organizer' ||
        ['updateTeam', 'setMemberRole'].includes(command.type)
      ) {
        const audit: AuditEntry = {
          id: `${actor.uid}__${command.commandId}`,
          actorUid: actor.uid,
          action: command.type,
          detail: result.message ?? `${command.type} ${result.operation?.id ?? ''}`.trim(),
          createdAt: now,
        };
        if (command.type === 'haltIssuer' || command.type === 'setPause')
          audit.detail += ` Reason: ${command.reason}`;
        tx.set(`${this.paths.collection('adminAudit')}/${audit.id}`, audit);
      }
      return result;
    });
  }

  async snapshot(uid: string): Promise<AppSnapshot> {
    identifier.parse(uid);
    return this.repository.transaction(async (tx) => {
      const [event, member] = await Promise.all([
        tx.get<EventConfig>(this.paths.root),
        tx.get<Member>(this.paths.member(uid)),
      ]);
      const snapshot = emptySnapshot(event, member);
      if (!event || !member || member.status !== 'approved') {
        if (event) {
          const request = await tx.get<AccessRequest>(this.paths.doc('accessRequests', uid));
          if (request) snapshot.requests = [request];
          if (!member || member.status === 'pending') {
            const teams = await tx.list<Team>(this.paths.collection('teams'), RULES.maxTeams + 1);
            snapshot.joinableTeams = teams
              .filter((team) => team.eligibility === 'active')
              .slice(0, RULES.maxTeams)
              .map(({ id, name }) => ({ id, name }))
              .sort(
                (left, right) =>
                  left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
              );
          }
        }
        return snapshot;
      }
      snapshot.market =
        (await tx.get<MarketView>(this.paths.doc('views', 'market'))) ?? emptyMarket();
      if (event.activeOperationId)
        snapshot.operation = await tx.get<Operation>(
          this.paths.doc('operations', event.activeOperationId),
        );
      const resultId =
        event.publishedResultId ??
        (member.role === 'organizer' && snapshot.operation?.kind === 'results'
          ? event.activeOperationId
          : null);
      if (resultId)
        snapshot.results = await tx.get<ResultsView>(this.paths.doc('results', resultId));
      if (member.teamId && member.role !== 'organizer') {
        [
          snapshot.wallet,
          snapshot.positions,
          snapshot.commitments,
          snapshot.notes,
          snapshot.receipts,
          snapshot.members,
        ] = await Promise.all([
          tx.get<Wallet>(this.paths.wallet(member.teamId)),
          tx.list<Position>(this.paths.positions(member.teamId), 31),
          tx.get<Commitment>(this.paths.commitment(member.teamId)),
          tx.list<Note>(this.paths.notes(member.teamId), 31),
          tx.list<Receipt>(this.paths.receipts(member.teamId), 200),
          tx.list<Member>(`${this.paths.team(member.teamId)}/members`, 151),
        ]);
        snapshot.receipts.sort((a, b) => b.acceptedAt - a.acceptedAt);
        if (!snapshot.members.some((entry) => entry.uid === member.uid))
          snapshot.members.push(member);
      }
      if (member.role === 'organizer') {
        Permissions.organizer(member);
        [snapshot.members, snapshot.requests, snapshot.audit] = await Promise.all([
          tx.list<Member>(this.paths.collection('members'), 501),
          tx.list<AccessRequest>(this.paths.collection('accessRequests'), 501),
          tx.list<AuditEntry>(this.paths.collection('adminAudit'), 1000),
        ]);
        snapshot.requests = snapshot.requests
          .filter((request) => request.status === 'pending')
          .sort((a, b) => a.requestedAt - b.requestedAt);
        snapshot.audit.sort((a, b) => b.createdAt - a.createdAt);
        snapshot.audit = snapshot.audit.slice(0, 100);
      }
      return snapshot;
    });
  }

  async pool(uid: string, issuerId: string): Promise<Pool> {
    identifier.parse(uid);
    identifier.parse(issuerId);
    return this.repository.transaction(async (tx) => {
      Permissions.member(await tx.get<Member>(this.paths.member(uid)));
      const pool = await tx.get<Pool>(this.paths.pool(issuerId));
      requireState(pool, 'NOT_FOUND', 'This exchange does not exist.');
      return pool;
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
        schemaVersion: 1,
        exportedAt: this.clock.now(),
        event,
      };
      for (const name of [
        'teams',
        'members',
        'wallets',
        'pools',
        'issuers',
        'operations',
        'manifests',
        'results',
        'adminAudit',
        'accessRequests',
        'commandReceipts',
      ])
        data[name] = await tx.list(this.paths.collection(name), 10000);
      const teams = data.teams as Team[];
      const privateTeams: Record<string, unknown> = {};
      for (const team of teams) {
        const [positions, commitments, notes, receipts] = await Promise.all([
          tx.list(this.paths.positions(team.id), 31),
          tx.get(this.paths.commitment(team.id)),
          tx.list(this.paths.notes(team.id), 31),
          tx.list(this.paths.receipts(team.id), 200),
        ]);
        privateTeams[team.id] = { positions, commitments, notes, receipts };
      }
      data.teamRecords = privateTeams;
      const operations = data.operations as Operation[];
      data.operationUnits = Object.fromEntries(
        await Promise.all(
          operations.map(async (operation) => [
            operation.id,
            await tx.list(`${this.paths.doc('operations', operation.id)}/units`, 31),
          ]),
        ),
      );
      const auditId = `export_${uid.slice(0, 60)}_${this.clock.now()}`;
      tx.set(this.paths.doc('adminAudit', auditId), {
        id: auditId,
        actorUid: uid,
        action: 'exportEvent',
        detail: 'Organizer exported the complete event ledger and private team records.',
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
    EventPolicy.assertTransition(event, command.target);
    requireState(
      !['FINALIZING', 'FINALIZED'].includes(command.target),
      'USE_RESULTS_WORKFLOW',
      'Prepare and publish results using the results workflow.',
    );
    if (command.target === 'SEED_SETTLING')
      return { operation: await this.operations.startSeed(context, command) };
    requireState(
      event.phase !== 'SEED_SETTLING' || command.target === 'CANCELLED',
      'OPERATION_INCOMPLETE',
      'Resume settlement until every team is applied and reconciled.',
    );
    if (command.target === 'SEED_OPEN') {
      const [teams, members] = await Promise.all([
        tx.list<Team>(this.paths.collection('teams'), 31),
        tx.list<Member>(this.paths.collection('members'), 501),
      ]);
      requireState(
        teams.filter((team) => team.eligibility === 'active').length >= 2,
        'MORE_TEAMS_REQUIRED',
        'Approve at least two active teams before opening funding.',
      );
      requireState(
        teams
          .filter((team) => team.eligibility === 'active')
          .every((team) =>
            members.some(
              (candidate) =>
                candidate.uid === team.captainUid &&
                candidate.teamId === team.id &&
                candidate.role === 'captain' &&
                candidate.status === 'approved',
            ),
          ),
        'CAPTAIN_REQUIRED',
        'Every active team needs an approved captain.',
      );
    }
    if (command.target === 'TRADING_OPEN' || command.target === 'FROZEN')
      await this.operations.reconcile(tx, this.paths);
    const open = command.target === 'SEED_OPEN' || command.target === 'TRADING_OPEN';
    const minutes =
      command.durationMinutes ??
      (command.target === 'SEED_OPEN' ? RULES.seedDurationMinutes : RULES.tradingDurationMinutes);
    tx.set(this.paths.root, {
      ...event,
      phase: command.target,
      phaseVersion: event.phaseVersion + 1,
      closesAt: open ? now + minutes * 60_000 : null,
      windowId: event.windowId + (command.target === 'TRADING_OPEN' ? 1 : 0),
      activeOperationId: command.target === 'CANCELLED' ? null : event.activeOperationId,
      paused: command.target === 'CANCELLED' ? false : event.paused,
      pauseReason: command.target === 'CANCELLED' ? '' : event.pauseReason,
    });
    return {
      message:
        command.target === 'CANCELLED'
          ? 'Event cancelled. Existing history is preserved and no winners will be published.'
          : `Event moved to ${command.target.toLowerCase().replaceAll('_', ' ')}.`,
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
    tx.set(paths.root, {
      ...event,
      paused: command.paused,
      pauseReason: command.paused ? command.reason : '',
      phaseVersion: event.phaseVersion + 1,
    });
    return {
      message: command.paused
        ? 'Event paused. Existing deadlines stay in place.'
        : 'Event resumed. Existing deadlines stay in place.',
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
    const [team, pool] = await Promise.all([
      tx.get<Team>(paths.team(command.issuerId)),
      tx.get<Pool>(paths.pool(command.issuerId)),
    ]);
    requireState(team && pool, 'NOT_FOUND', 'The project exchange does not exist.');
    if (event.phase === 'SEED_OPEN' && command.eligibility !== 'active') {
      const wallets = await tx.list<Wallet>(paths.collection('wallets'), 31);
      for (const wallet of wallets) {
        const commitment = await tx.get<Commitment>(paths.commitment(wallet.teamId));
        if (!commitment) continue;
        const shares =
          wallet.teamId === team.id
            ? {}
            : Object.fromEntries(
                Object.entries(commitment.shares).filter(([issuerId]) => issuerId !== team.id),
              );
        const reservedSeedMinor = Object.values(shares).reduce(
          (sum, quantity) => sum + quantity * RULES.primaryPriceMinor,
          0,
        );
        if (reservedSeedMinor === wallet.reservedSeedMinor) continue;
        requireState(
          reservedSeedMinor <= wallet.reservedSeedMinor,
          'RECONCILIATION_FAILED',
          'The existing funding reservation does not reconcile.',
        );
        tx.set(paths.wallet(wallet.teamId), {
          ...wallet,
          reservedSeedMinor,
          version: wallet.version + 1,
        });
        tx.set(paths.commitment(wallet.teamId), {
          ...commitment,
          shares,
          version: commitment.version + 1,
          updatedAt: context.now,
        });
        const receiptId = `halt_${command.commandId.slice(0, 100)}`;
        requireState(
          !(await tx.get(paths.receipt(wallet.teamId, receiptId))),
          'COMMAND_CONFLICT',
          'This reservation-release identifier has already been used.',
        );
        tx.set(
          paths.receipt(wallet.teamId, receiptId),
          receipt(
            context,
            command,
            `Released ${((wallet.reservedSeedMinor - reservedSeedMinor) / 100).toFixed(2)} reserved credits after ${team.name} became ${command.eligibility}.`,
            {
              id: receiptId,
              kind: 'seedReservationReleased',
              teamId: wallet.teamId,
              cashAfterMinor: wallet.cashMinor,
            },
          ),
        );
      }
    }
    tx.set(paths.team(team.id), {
      ...team,
      eligibility: command.eligibility,
      version: team.version + 1,
    });
    tx.set(paths.pool(team.id), {
      ...pool,
      halted: command.eligibility !== 'active',
      version: pool.version + 1,
    });
    tx.set(paths.root, { ...event, phaseVersion: event.phaseVersion + 1 });
    return { message: `${team.name} is ${command.eligibility}.` };
  }

  private async refreshProjection(tx: Transaction, now: number) {
    const [event, seedPublication] = await Promise.all([
      tx.get<EventConfig>(this.paths.root),
      tx.get(this.paths.doc('views', 'seedPublication')),
    ]);
    requireState(event, 'EVENT_NOT_FOUND', 'This event does not exist.');
    await this.market.projection(tx, this.paths, event.phaseVersion, now, Boolean(seedPublication));
  }

  private assertReplay(previous: string, current: string) {
    requireState(
      previous === current,
      'COMMAND_CONFLICT',
      'This request identifier was already used with different content.',
    );
  }
}
