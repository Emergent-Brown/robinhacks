import { FundingAllocator, PortfolioAccounting, ResultScorer, RULES } from '@robinhacks/core';
import type {
  Command,
  Commitment,
  EventConfig,
  Issuer,
  IssuerResult,
  JournalEntry,
  Operation,
  Pool,
  Position,
  ResultsView,
  Team,
  TeamResult,
  Wallet,
} from '@robinhacks/core';
import { canonicalJson } from '../command-schema';
import { requireState } from '../errors';
import type { Transaction } from '../repository';
import type { EventPaths } from '../paths';
import { receipt, type CommandContext } from './context';

interface FrozenTeam {
  wallet: Wallet;
  positions: Position[];
  eligible: boolean;
}
interface SeedManifest {
  id: string;
  kind: 'seed';
  teamIds: string[];
  requests: Record<string, Record<string, number>>;
  allocations: Record<string, Record<string, number>>;
  reserved: Record<string, number>;
  createdAt: number;
  rulesVersion: number;
}
interface ResultManifest {
  id: string;
  kind: 'results';
  teamIds: string[];
  issuers: IssuerResult[];
  teams: Record<string, FrozenTeam>;
  createdAt: number;
  rulesVersion: number;
}
type Manifest = SeedManifest | ResultManifest;

/** Bounded, resumable jobs apply one whole team per transaction from immutable input. */
export class OperationService {
  async startSeed(context: CommandContext, command: Command): Promise<Operation> {
    const { tx, paths, event, now } = context;
    requireState(
      !event.activeOperationId,
      'OPERATION_RUNNING',
      'Finish the current operation first.',
    );
    const teams = await tx.list<Team>(paths.collection('teams'), 31);
    requireState(
      teams.length > 0 && teams.length <= RULES.maxTeams,
      'TEAM_LIMIT',
      'The event needs 1–30 teams.',
    );
    const requests: SeedManifest['requests'] = {};
    const reserved: SeedManifest['reserved'] = {};
    const active = new Set(
      teams.filter((team) => team.eligibility === 'active').map((team) => team.id),
    );
    for (const team of teams) {
      const [wallet, commitment] = await Promise.all([
        tx.get<Wallet>(paths.wallet(team.id)),
        tx.get<Commitment>(paths.commitment(team.id)),
      ]);
      requireState(wallet, 'RECONCILIATION_FAILED', 'A registered team has no wallet.');
      const shares = commitment?.shares ?? {};
      const expectedReservation = Object.values(shares).reduce(
        (sum, value) => sum + value * RULES.primaryPriceMinor,
        0,
      );
      requireState(
        wallet.reservedSeedMinor === expectedReservation && wallet.cashMinor >= expectedReservation,
        'RECONCILIATION_FAILED',
        'A funding sheet and its reserved cash disagree.',
      );
      reserved[team.id] = wallet.reservedSeedMinor;
      requests[team.id] =
        team.eligibility === 'active'
          ? Object.fromEntries(Object.entries(shares).filter(([issuerId]) => active.has(issuerId)))
          : {};
    }
    const id = `seed_${command.commandId.slice(0, 100)}`;
    const manifest: SeedManifest = {
      id,
      kind: 'seed',
      teamIds: teams.map((team) => team.id).sort(),
      requests,
      allocations: FundingAllocator.allocate(requests, [...active], event.tieSeed),
      reserved,
      createdAt: now,
      rulesVersion: event.rulesVersion,
    };
    this.boundManifest(manifest);
    requireState(
      !(await tx.get(paths.doc('manifests', id))),
      'COMMAND_CONFLICT',
      'The operation identifier is already in use.',
    );
    const operation: Operation = {
      id,
      kind: 'seed',
      completed: 0,
      total: teams.length,
      state: 'running',
    };
    tx.set(paths.doc('manifests', id), manifest);
    tx.set(paths.doc('operations', id), operation);
    tx.set(paths.root, {
      ...event,
      phase: 'SEED_SETTLING',
      closesAt: null,
      activeOperationId: id,
      phaseVersion: event.phaseVersion + 1,
    });
    return operation;
  }

  async startResults(
    context: CommandContext,
    command: Extract<Command, { type: 'prepareResults' }>,
  ): Promise<Operation> {
    const { tx, paths, event, now } = context;
    requireState(
      event.phase === 'FROZEN' && !event.activeOperationId,
      'MARKET_NOT_FROZEN',
      'Freeze trading before preparing judge results.',
    );
    const teams = await tx.list<Team>(paths.collection('teams'), 31);
    requireState(
      Object.keys(command.scores).every((id) => teams.some((team) => team.id === id)),
      'RESULT_INPUT_INVALID',
      'Scores contain an unknown project.',
    );
    const eligible = teams.filter((team) => team.eligibility === 'active').map((team) => team.id);
    const scores = Object.fromEntries(
      teams.map((team) => [team.id, team.eligibility === 'active' ? command.scores[team.id] : 0]),
    );
    const issuers = ResultScorer.score(scores as Record<string, number>, eligible);
    await this.reconcile(tx, paths);
    const frozen: Record<string, FrozenTeam> = {};
    for (const team of teams) {
      const [wallet, positions] = await Promise.all([
        tx.get<Wallet>(paths.wallet(team.id)),
        tx.list<Position>(paths.positions(team.id), 31),
      ]);
      requireState(
        wallet && wallet.reservedSeedMinor === 0,
        'RECONCILIATION_FAILED',
        'Settle all funding reservations before results.',
      );
      frozen[team.id] = { wallet, positions, eligible: team.eligibility === 'active' };
    }
    const id = `results_${command.commandId.slice(0, 100)}`;
    const manifest: ResultManifest = {
      id,
      kind: 'results',
      teamIds: teams.map((team) => team.id).sort(),
      issuers,
      teams: frozen,
      createdAt: now,
      rulesVersion: event.rulesVersion,
    };
    this.boundManifest(manifest);
    requireState(
      !(await tx.get(paths.doc('manifests', id))),
      'COMMAND_CONFLICT',
      'The result identifier is already in use.',
    );
    const operation: Operation = {
      id,
      kind: 'results',
      completed: 0,
      total: teams.length,
      state: 'running',
    };
    tx.set(paths.doc('manifests', id), manifest);
    tx.set(paths.doc('operations', id), operation);
    tx.set(paths.root, {
      ...event,
      phase: 'FINALIZING',
      closesAt: null,
      activeOperationId: id,
      phaseVersion: event.phaseVersion + 1,
    });
    return operation;
  }

  async continue(
    context: CommandContext,
    command: Extract<Command, { type: 'continueOperation' }>,
  ): Promise<Operation> {
    const { tx, paths, event } = context;
    requireState(
      event.activeOperationId && ['SEED_SETTLING', 'FINALIZING'].includes(event.phase),
      'NO_OPERATION',
      'There is no active operation to resume.',
    );
    const [operation, manifest] = await Promise.all([
      tx.get<Operation>(paths.doc('operations', event.activeOperationId)),
      tx.get<Manifest>(paths.doc('manifests', event.activeOperationId)),
    ]);
    requireState(
      operation &&
        manifest &&
        operation.kind === manifest.kind &&
        operation.total === manifest.teamIds.length,
      'RECONCILIATION_FAILED',
      'The operation and its immutable input disagree.',
    );
    if (operation.state !== 'running') return operation;
    const markers = await tx.list<{ teamId: string }>(
      `${paths.doc('operations', operation.id)}/units`,
      31,
    );
    requireState(
      markers.length === operation.completed,
      'RECONCILIATION_FAILED',
      'The completed-unit count does not match the operation.',
    );
    const teamId = manifest.teamIds.find((id) => !markers.some((marker) => marker.teamId === id));
    if (!teamId) {
      await this.reconcile(tx, paths);
      if (manifest.kind === 'seed') {
        const complete: Operation = { ...operation, state: 'complete' };
        tx.set(paths.doc('operations', operation.id), complete);
        tx.set(paths.root, {
          ...event,
          phase: 'INTERMISSION',
          activeOperationId: null,
          phaseVersion: event.phaseVersion + 1,
        });
        tx.set(paths.doc('views', 'seedPublication'), {
          operationId: operation.id,
          publishedAt: context.now,
        });
        return complete;
      }
      const completedResults = await tx.list<TeamResult>(
        `${paths.doc('results', operation.id)}/teams`,
        31,
      );
      requireState(
        completedResults.length === manifest.teamIds.length,
        'RECONCILIATION_FAILED',
        'Some frozen portfolio reports are missing.',
      );
      for (const result of completedResults) {
        const frozen = manifest.teams[result.teamId];
        const [wallet, positions] = await Promise.all([
          tx.get<Wallet>(paths.wallet(result.teamId)),
          tx.list<Position>(paths.positions(result.teamId), 31),
        ]);
        requireState(
          frozen &&
            canonicalJson(wallet) === canonicalJson(frozen.wallet) &&
            canonicalJson([...positions].sort((a, b) => a.issuerId.localeCompare(b.issuerId))) ===
              canonicalJson(
                [...frozen.positions].sort((a, b) => a.issuerId.localeCompare(b.issuerId)),
              ),
          'RECONCILIATION_FAILED',
          'The financial state changed after the final portfolio freeze.',
        );
        requireState(
          frozen &&
            canonicalJson(result) ===
              canonicalJson(
                ResultScorer.portfolio(
                  frozen.wallet,
                  frozen.positions,
                  manifest.issuers,
                  frozen.eligible,
                ),
              ),
          'RECONCILIATION_FAILED',
          'A portfolio result differs from its frozen input.',
        );
      }
      const ranked = completedResults
        .filter((result) => result.eligible)
        .sort((a, b) => b.valueMinor - a.valueMinor || a.teamId.localeCompare(b.teamId));
      let rank = 0;
      let previous: number | undefined;
      const rankings = new Map(
        ranked.map((result, index) => {
          if (previous !== result.valueMinor) rank = index + 1;
          previous = result.valueMinor;
          return [result.teamId, rank];
        }),
      );
      const results: ResultsView = {
        id: operation.id,
        createdAt: manifest.createdAt,
        issuers: manifest.issuers,
        teams: completedResults
          .map((result) => ({ ...result, rank: rankings.get(result.teamId) ?? 0 }))
          .sort((a, b) => (a.rank || 999) - (b.rank || 999) || a.teamId.localeCompare(b.teamId)),
      };
      tx.set(paths.doc('results', operation.id), results);
      const ready: Operation = { ...operation, state: 'ready' };
      tx.set(paths.doc('operations', operation.id), ready);
      return ready;
    }
    if (manifest.kind === 'seed') await this.applySeedUnit(context, command, manifest, teamId);
    else {
      const frozen = manifest.teams[teamId];
      requireState(frozen, 'RECONCILIATION_FAILED', 'A frozen team input is missing.');
      tx.set(
        `${paths.doc('results', operation.id)}/teams/${teamId}`,
        ResultScorer.portfolio(frozen.wallet, frozen.positions, manifest.issuers, frozen.eligible),
      );
    }
    tx.set(`${paths.doc('operations', operation.id)}/units/${teamId}`, {
      teamId,
      completedAt: context.now,
    });
    const next: Operation = { ...operation, completed: operation.completed + 1 };
    tx.set(paths.doc('operations', operation.id), next);
    return next;
  }

  async publish(context: CommandContext, command: Extract<Command, { type: 'publishResults' }>) {
    const { tx, paths, event } = context;
    requireState(
      event.phaseVersion === command.expectedPhaseVersion,
      'EVENT_CHANGED',
      'The event changed. Refresh before publishing.',
    );
    requireState(
      event.phase === 'FINALIZING' && event.activeOperationId,
      'RESULTS_NOT_READY',
      'Prepare and complete the result operation first.',
    );
    const [operation, results] = await Promise.all([
      tx.get<Operation>(paths.doc('operations', event.activeOperationId)),
      tx.get<ResultsView>(paths.doc('results', event.activeOperationId)),
    ]);
    requireState(
      operation?.kind === 'results' &&
        operation.state === 'ready' &&
        operation.completed === operation.total &&
        results,
      'RESULTS_NOT_READY',
      'Complete and reconcile every portfolio before publishing.',
    );
    tx.set(paths.root, {
      ...event,
      phase: 'FINALIZED',
      publishedResultId: operation.id,
      activeOperationId: null,
      phaseVersion: event.phaseVersion + 1,
      paused: false,
      pauseReason: '',
    });
    tx.set(paths.doc('operations', operation.id), { ...operation, state: 'complete' });
    return { message: 'Final project and investing results are published.' };
  }

  async reconcile(tx: Transaction, paths: EventPaths): Promise<void> {
    const [teams, wallets, pools, issuers] = await Promise.all([
      tx.list<Team>(paths.collection('teams'), 31),
      tx.list<Wallet>(paths.collection('wallets'), 31),
      tx.list<Pool>(paths.collection('pools'), 31),
      tx.list<Issuer>(paths.collection('issuers'), 31),
    ]);
    requireState(
      teams.length <= RULES.maxTeams &&
        wallets.length === teams.length &&
        pools.length === teams.length &&
        issuers.length === teams.length,
      'RECONCILIATION_FAILED',
      'The team, wallet, pool and issuer counts must match.',
    );
    let credits = 0n;
    const shares = new Map<string, bigint>();
    for (const wallet of wallets) {
      requireState(
        Number.isSafeInteger(wallet.cashMinor) &&
          wallet.cashMinor >= 0 &&
          wallet.reservedSeedMinor === 0,
        'RECONCILIATION_FAILED',
        'A wallet has invalid cash or unsettled funding.',
      );
      credits += BigInt(wallet.cashMinor);
      const positions = await tx.list<Position>(paths.positions(wallet.teamId), 31);
      for (const position of positions) {
        requireState(
          position.issuerId !== wallet.teamId &&
            teams.some((team) => team.id === position.issuerId) &&
            Number.isSafeInteger(position.shares) &&
            position.shares >= 0 &&
            position.shares <= RULES.maxHoldingShares &&
            Number.isSafeInteger(position.costBasisMinor) &&
            position.costBasisMinor >= 0,
          'RECONCILIATION_FAILED',
          'A share position violates the event rules.',
        );
        shares.set(
          position.issuerId,
          (shares.get(position.issuerId) ?? 0n) + BigInt(position.shares),
        );
      }
    }
    for (const team of teams) {
      const pool = pools.find((value) => value.issuerId === team.id);
      const issuer = issuers.find((value) => value.issuerId === team.id);
      requireState(
        pool &&
          issuer &&
          Number.isSafeInteger(pool.creditReserveMinor) &&
          pool.creditReserveMinor > 0 &&
          Number.isSafeInteger(pool.shareReserve) &&
          pool.shareReserve > 0 &&
          Number.isSafeInteger(issuer.primarySharesRemaining) &&
          issuer.primarySharesRemaining >= 0 &&
          issuer.primarySharesRemaining <= RULES.primaryShares &&
          issuer.issuedShares === RULES.issuedShares,
        'RECONCILIATION_FAILED',
        'A pool or primary inventory is invalid.',
      );
      requireState(
        issuer.fundingVaultMinor ===
          (RULES.primaryShares - issuer.primarySharesRemaining) * RULES.primaryPriceMinor,
        'RECONCILIATION_FAILED',
        'Funding vault cash does not match shares allocated.',
      );
      requireState(
        BigInt(pool.shareReserve + issuer.primarySharesRemaining) + (shares.get(team.id) ?? 0n) ===
          BigInt(RULES.issuedShares),
        'RECONCILIATION_FAILED',
        'The issued shares do not reconcile.',
      );
      credits += BigInt(pool.creditReserveMinor) + BigInt(issuer.fundingVaultMinor);
    }
    requireState(
      credits ===
        BigInt(teams.length) * BigInt(RULES.initialWalletMinor + RULES.openingPoolCashMinor),
      'RECONCILIATION_FAILED',
      'Cash no longer matches the event’s initial credit issuance.',
    );
  }

  private async applySeedUnit(
    context: CommandContext,
    command: Command,
    manifest: SeedManifest,
    teamId: string,
  ) {
    const { tx, paths } = context;
    const wallet = await tx.get<Wallet>(paths.wallet(teamId));
    requireState(
      wallet && wallet.reservedSeedMinor === manifest.reserved[teamId],
      'RECONCILIATION_FAILED',
      'A wallet differs from its frozen funding reservation.',
    );
    const allocations = manifest.allocations[teamId] ?? {};
    const debit = Object.values(allocations).reduce(
      (sum, shares) => sum + shares * RULES.primaryPriceMinor,
      0,
    );
    requireState(
      debit <= wallet.reservedSeedMinor && debit <= wallet.cashMinor,
      'RECONCILIATION_FAILED',
      'A funding allocation exceeds its reserved credits.',
    );
    const receiptId = `${manifest.id}_${teamId}`.slice(0, 128);
    requireState(
      !(await tx.get(paths.receipt(teamId, receiptId))),
      'RECONCILIATION_FAILED',
      'A settlement receipt exists without its completed-unit marker.',
    );
    const entries: JournalEntry[] = [];
    for (const [issuerId, shares] of Object.entries(allocations)) {
      if (!shares) continue;
      const [issuer, oldPosition] = await Promise.all([
        tx.get<Issuer>(paths.issuer(issuerId)),
        tx.get<Position>(paths.position(teamId, issuerId)),
      ]);
      requireState(
        issuer && issuer.primarySharesRemaining >= shares,
        'RECONCILIATION_FAILED',
        'The primary inventory cannot fulfill its frozen allocation.',
      );
      const position = oldPosition ?? {
        issuerId,
        shares: 0,
        costBasisMinor: 0,
        realizedPnlMinor: 0,
        version: 0,
      };
      requireState(
        position.shares + shares <= RULES.maxHoldingShares,
        'RECONCILIATION_FAILED',
        'The allocation exceeds the holding limit.',
      );
      const amount = shares * RULES.primaryPriceMinor;
      tx.set(paths.position(teamId, issuerId), PortfolioAccounting.buy(position, shares, amount));
      tx.set(paths.issuer(issuerId), {
        ...issuer,
        primarySharesRemaining: issuer.primarySharesRemaining - shares,
        fundingVaultMinor: issuer.fundingVaultMinor + amount,
        seedBackers: issuer.seedBackers + 1,
        version: issuer.version + 1,
      });
      entries.push(
        { account: `wallet:${teamId}`, asset: 'credits', delta: -amount },
        { account: `vault:${issuerId}`, asset: 'credits', delta: amount },
        { account: `primary:${issuerId}`, asset: `shares:${issuerId}`, delta: -shares },
        { account: `position:${teamId}`, asset: `shares:${issuerId}`, delta: shares },
      );
    }
    tx.set(paths.wallet(teamId), {
      ...wallet,
      cashMinor: wallet.cashMinor - debit,
      reservedSeedMinor: 0,
      version: wallet.version + 1,
    });
    tx.set(
      paths.receipt(teamId, receiptId),
      receipt(
        context,
        command,
        'Sealed funding allocation completed; unused reservations released.',
        {
          id: receiptId,
          kind: 'seedSettlement',
          teamId,
          totalMinor: debit,
          cashAfterMinor: wallet.cashMinor - debit,
          entries,
          payloadKey: canonicalJson({ manifestId: manifest.id, teamId, allocations }),
        },
      ),
    );
  }

  private boundManifest(manifest: Manifest) {
    requireState(
      new TextEncoder().encode(canonicalJson(manifest)).length <= 200 * 1024,
      'MANIFEST_TOO_LARGE',
      'The immutable event input exceeds the safe document-size limit.',
    );
  }
}
