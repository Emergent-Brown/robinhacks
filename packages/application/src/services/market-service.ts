import { ConstantProductPool, EventPolicy, PortfolioAccounting, RULES } from '@robinhacks/core';
import type {
  Command,
  Commitment,
  Issuer,
  MarketView,
  Note,
  Pool,
  Position,
  Team,
  Wallet,
} from '@robinhacks/core';
import type { Transaction } from '../repository';
import type { EventPaths } from '../paths';
import { requireState } from '../errors';
import { Permissions } from './permissions';
import { receipt, type CommandContext } from './context';

export class MarketService {
  async trade(context: CommandContext, command: Extract<Command, { type: 'executeTrade' }>) {
    const { tx, paths, member, event } = context;
    const teamId = Permissions.team(member);
    const [team, issuerTeam, wallet, pool, savedPosition] = await Promise.all([
      tx.get<Team>(paths.team(teamId)),
      tx.get<Team>(paths.team(command.issuerId)),
      tx.get<Wallet>(paths.wallet(teamId)),
      tx.get<Pool>(paths.pool(command.issuerId)),
      tx.get<Position>(paths.position(teamId, command.issuerId)),
    ]);
    requireState(
      team && issuerTeam && wallet && pool,
      'NOT_FOUND',
      'The team or exchange could not be found.',
    );
    Permissions.trader(member, team);
    const now = context.clock.now();
    context.now = now;
    EventPolicy.assertFinancialAction(event, 'trade', now);
    requireState(
      event.phaseVersion === command.expectedPhaseVersion,
      'STALE_QUOTE',
      'The market state changed. Review a fresh quote.',
    );
    requireState(
      teamId !== command.issuerId,
      'SELF_INVESTMENT',
      'You can invest only in other teams.',
    );
    requireState(
      issuerTeam.eligibility === 'active' && !pool.halted,
      'ISSUER_HALTED',
      'Trading in this project is halted.',
    );
    requireState(
      pool.version === command.expectedPoolVersion,
      'STALE_QUOTE',
      'The pool changed. Review a fresh quote.',
    );
    requireState(
      wallet.version === command.expectedWalletVersion,
      'WALLET_CHANGED',
      'Your shared wallet changed. Refresh before trading.',
    );
    EventPolicy.assertTradeAllowance(wallet, event, now);
    const position = savedPosition ?? {
      issuerId: command.issuerId,
      shares: 0,
      costBasisMinor: 0,
      realizedPnlMinor: 0,
      version: 0,
    };
    requireState(
      command.side === 'BUY'
        ? command.minCreditMinor === undefined && command.maxDebitMinor !== undefined
        : command.maxDebitMinor === undefined && command.minCreditMinor !== undefined,
      'INVALID_PRICE_BOUND',
      'Include the appropriate reviewed buy or sell price bound.',
    );
    requireState(
      command.side !== 'BUY' || position.shares + command.shares <= RULES.maxHoldingShares,
      'HOLDING_LIMIT',
      'A team can hold at most 25 shares in one project.',
    );
    requireState(
      command.side !== 'SELL' || position.shares >= command.shares,
      'INSUFFICIENT_SHARES',
      'Your team does not hold enough shares.',
    );
    const quote = new ConstantProductPool(pool).quote(command.side, command.shares);
    const buy = command.side === 'BUY';
    requireState(
      !buy || quote.totalMinor <= command.maxDebitMinor!,
      'STALE_QUOTE',
      'The cost exceeds the amount you reviewed.',
    );
    requireState(
      buy || quote.totalMinor >= command.minCreditMinor!,
      'STALE_QUOTE',
      'The proceeds are below the amount you reviewed.',
    );
    requireState(
      !buy || wallet.cashMinor - wallet.reservedSeedMinor >= quote.totalMinor,
      'INSUFFICIENT_CREDITS',
      'Your team does not have enough available credits.',
    );
    const cashDelta = (buy ? -1 : 1) * quote.totalMinor;
    const shareDelta = (buy ? 1 : -1) * command.shares;
    const nextWallet: Wallet = {
      ...wallet,
      cashMinor: wallet.cashMinor + cashDelta,
      version: wallet.version + 1,
      lastTradeAt: now,
      tradeWindowId: event.windowId,
      successfulTradesInWindow:
        (wallet.tradeWindowId === event.windowId ? wallet.successfulTradesInWindow : 0) + 1,
    };
    const nextPosition = buy
      ? PortfolioAccounting.buy(position, command.shares, quote.totalMinor)
      : PortfolioAccounting.sell(position, command.shares, quote.totalMinor);
    const accepted = receipt(
      context,
      command,
      `${buy ? 'Bought' : 'Sold'} ${command.shares} ${issuerTeam.ticker} shares.`,
      {
        issuerId: command.issuerId,
        side: command.side,
        shares: command.shares,
        totalMinor: quote.totalMinor,
        cashAfterMinor: nextWallet.cashMinor,
        entries: [
          { account: `wallet:${teamId}`, asset: 'credits', delta: cashDelta },
          { account: `pool:${command.issuerId}`, asset: 'credits', delta: -cashDelta },
          { account: `position:${teamId}`, asset: `shares:${command.issuerId}`, delta: shareDelta },
          {
            account: `pool:${command.issuerId}`,
            asset: `shares:${command.issuerId}`,
            delta: -shareDelta,
          },
        ],
      },
    );
    // These are deliberately the only four authoritative writes for a secondary fill.
    tx.set(paths.wallet(teamId), nextWallet);
    tx.set(paths.position(teamId, command.issuerId), nextPosition);
    tx.set(paths.pool(command.issuerId), quote.nextPool);
    tx.set(paths.receipt(teamId, command.commandId), accepted);
    return { receipt: accepted };
  }

  async commitments(
    context: CommandContext,
    command: Extract<Command, { type: 'setSeedCommitments' }>,
  ) {
    const { tx, paths, event, member } = context;
    const teamId = Permissions.team(member);
    const [team, wallet, current, teams] = await Promise.all([
      tx.get<Team>(paths.team(teamId)),
      tx.get<Wallet>(paths.wallet(teamId)),
      tx.get<Commitment>(paths.commitment(teamId)),
      tx.list<Team>(paths.collection('teams'), RULES.maxTeams + 1),
    ]);
    requireState(team && wallet, 'NOT_FOUND', 'Your team wallet could not be found.');
    Permissions.trader(member, team);
    const now = context.clock.now();
    context.now = now;
    EventPolicy.assertFinancialAction(event, 'seed', now);
    requireState(
      wallet.version === command.expectedWalletVersion,
      'WALLET_CHANGED',
      'Your shared wallet changed. Refresh the funding sheet.',
    );
    requireState(
      (current?.version ?? 0) === command.expectedCommitmentVersion,
      'COMMITMENT_CHANGED',
      'A teammate changed this funding sheet.',
    );
    const shares: Record<string, number> = {};
    for (const [issuerId, quantity] of Object.entries(command.shares)) {
      if (quantity === 0) continue;
      requireState(issuerId !== teamId, 'SELF_INVESTMENT', 'You can fund only other teams.');
      requireState(
        teams.some((issuer) => issuer.id === issuerId && issuer.eligibility === 'active'),
        'ISSUER_HALTED',
        'One of these projects is not accepting funding.',
      );
      shares[issuerId] = quantity;
    }
    const reservedSeedMinor = Object.values(shares).reduce(
      (sum, quantity) => sum + quantity * RULES.primaryPriceMinor,
      0,
    );
    requireState(
      reservedSeedMinor <= RULES.maxSeedCommitmentMinor,
      'SEED_LIMIT',
      'You can reserve at most 5,000 credits in the funding round.',
    );
    requireState(
      reservedSeedMinor <= wallet.cashMinor,
      'INSUFFICIENT_CREDITS',
      'Your team does not have enough credits for this sheet.',
    );
    tx.set(paths.wallet(teamId), { ...wallet, reservedSeedMinor, version: wallet.version + 1 });
    tx.set(paths.commitment(teamId), {
      shares,
      version: (current?.version ?? 0) + 1,
      updatedAt: now,
    });
    return {
      message: 'Funding sheet saved. Your commitments stay private until allocation completes.',
    };
  }

  async note(context: CommandContext, command: Extract<Command, { type: 'saveNote' }>) {
    const { tx, paths, member, event, now } = context;
    Permissions.editable(event);
    const teamId = Permissions.team(member);
    const [issuer, current] = await Promise.all([
      tx.get<Team>(paths.team(command.issuerId)),
      tx.get<Note>(paths.note(teamId, command.issuerId)),
    ]);
    requireState(issuer, 'NOT_FOUND', 'That project does not exist.');
    requireState(
      (current?.version ?? 0) === command.expectedVersion,
      'NOTE_CHANGED',
      'A teammate edited this note. Refresh it before saving.',
    );
    tx.set<Note>(paths.note(teamId, command.issuerId), {
      issuerId: command.issuerId,
      thesis: command.thesis,
      reconsider: command.reconsider,
      nextCheck: command.nextCheck,
      author: member.displayName,
      updatedAt: now,
      version: (current?.version ?? 0) + 1,
    });
    return { message: 'Team note saved.' };
  }

  async projection(
    tx: Transaction,
    paths: EventPaths,
    phaseVersion: number,
    now: number,
    revealSeed: boolean,
  ): Promise<MarketView> {
    const [teams, pools, issuers] = await Promise.all([
      tx.list<Team>(paths.collection('teams'), 31),
      tx.list<Pool>(paths.collection('pools'), 31),
      tx.list<Issuer>(paths.collection('issuers'), 31),
    ]);
    requireState(
      teams.length <= RULES.maxTeams,
      'TEAM_LIMIT',
      'The event exceeds its configured team cap.',
    );
    const entries = teams
      .map((team) => {
        const pool = pools.find((candidate) => candidate.issuerId === team.id);
        const issuer = issuers.find((candidate) => candidate.issuerId === team.id);
        requireState(
          pool && issuer,
          'RECONCILIATION_FAILED',
          'A project is missing its exchange or share inventory.',
        );
        return {
          team,
          pool,
          issuer: revealSeed
            ? issuer
            : {
                ...issuer,
                fundingVaultMinor: 0,
                seedBackers: 0,
                primarySharesRemaining: RULES.primaryShares,
                version: 0,
              },
        };
      })
      .sort((a, b) => a.team.name.localeCompare(b.team.name));
    const projection = { entries, phaseVersion, asOf: now };
    tx.set(paths.doc('views', 'market'), projection);
    return projection;
  }
}
