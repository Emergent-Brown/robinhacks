import { describe, expect, it } from 'vitest';
import { ConstantProductPool, RULES } from '@robinhacks/core';
import type { Command, EventConfig, Member, Pool, TradeCommand, Wallet } from '@robinhacks/core';
import { GameService } from '@robinhacks/application';
import {
  createDemoDocuments,
  DEMO_EVENT_ID,
  DEMO_USERS,
} from '../packages/application/src/fixtures';
import { MemoryRepository, type DocumentMap } from '../packages/application/src/memory-repository';
import type { Repository } from '../packages/application/src/repository';

const root = `events/${DEMO_EVENT_ID}`;
const captain = DEMO_USERS.captain;
const organizer = DEMO_USERS.organizer;
const teamWallet = `${root}/wallets/team-1`;

function harness(
  phase: 'seed' | 'trading' = 'trading',
  transform?: (documents: DocumentMap) => void,
) {
  let now = 10_000_000;
  const documents = createDemoDocuments(phase, now);
  transform?.(documents);
  const repository = new MemoryRepository(documents);
  const service = new GameService(repository, DEMO_EVENT_ID, { now: () => now });
  const event = () => repository.dump()[root] as EventConfig;
  const buy = (commandId: string, issuerId = 'team-2', shares = 3): TradeCommand => {
    const state = repository.dump();
    const pool = state[`${root}/pools/${issuerId}`] as Pool;
    const wallet = state[teamWallet] as Wallet;
    const quote = new ConstantProductPool(pool).quote('BUY', shares);
    return {
      type: 'executeTrade',
      commandId,
      issuerId,
      side: 'BUY',
      shares,
      expectedPoolVersion: pool.version,
      expectedWalletVersion: wallet.version,
      expectedPhaseVersion: event().phaseVersion,
      maxDebitMinor: quote.totalMinor,
    };
  };
  return {
    service,
    repository,
    event,
    buy,
    advance: (ms: number) => {
      now += ms;
    },
    setNow: (value: number) => {
      now = value;
    },
  };
}

function financialState(repository: MemoryRepository): DocumentMap {
  return Object.fromEntries(
    Object.entries(repository.dump()).filter(([path]) => /\/(wallets|pools|issuers)\//.test(path)),
  );
}

function errorCode(error: unknown): string | undefined {
  return (error as { code?: string }).code;
}

async function rejectedCode(work: Promise<unknown>, expected: string): Promise<void> {
  try {
    await work;
  } catch (error) {
    expect(errorCode(error)).toBe(expected);
    return;
  }
  throw new Error(`Expected ${expected}`);
}

describe('authoritative command integration', () => {
  it('replays an accepted command exactly once and rejects altered content under the same ID', async () => {
    const h = harness();
    const command = h.buy('trade-replay-0001');
    const result = await h.service.execute(captain, command);
    const acceptedState = financialState(h.repository);
    expect(await h.service.execute(captain, command)).toEqual(result);
    expect(financialState(h.repository)).toEqual(acceptedState);
    await rejectedCode(
      h.service.execute(captain, { ...command, shares: command.shares + 1 }),
      'COMMAND_CONFLICT',
    );
    expect(financialState(h.repository)).toEqual(acceptedState);
    expect((h.repository.dump()[teamWallet] as Wallet).successfulTradesInWindow).toBe(1);
    const totals = new Map<string, number>();
    for (const entry of result.receipt!.entries)
      totals.set(entry.asset, (totals.get(entry.asset) ?? 0) + entry.delta);
    expect([...totals.values()]).toEqual([0, 0]);
  });

  it('serializes two authorized traders spending the same wallet', async () => {
    const h = harness('trading', (docs) => {
      docs[`${root}/members/demo-trader`] = {
        uid: 'demo-trader',
        displayName: 'Second trader',
        teamId: 'team-1',
        role: 'trader',
        status: 'approved',
        version: 1,
      } satisfies Member;
    });
    const outcomes = await Promise.allSettled([
      h.service.execute(captain, h.buy('trade-race-0001', 'team-2')),
      h.service.execute({ uid: 'demo-trader' }, h.buy('trade-race-0002', 'team-3')),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find(
      (outcome) => outcome.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(errorCode(rejected.reason)).toBe('WALLET_CHANGED');
    expect((h.repository.dump()[teamWallet] as Wallet).successfulTradesInWindow).toBe(1);
  });

  it.each([
    'member',
    'unknown',
    'self',
    'stale-pool',
    'stale-wallet',
    'stale-phase',
    'price-bound',
    'deadline',
    'paused',
    'cooldown',
    'quota',
    'holding-cap',
  ] as const)('rejects %s without financial mutation', async (scenario) => {
    const h = harness('trading', (docs) => {
      if (scenario === 'paused') (docs[root] as EventConfig).paused = true;
      if (scenario === 'cooldown') (docs[teamWallet] as Wallet).lastTradeAt = 9_999_999;
      if (scenario === 'quota') (docs[teamWallet] as Wallet).successfulTradesInWindow = 15;
    });
    let command = h.buy(`trade-invalid-${scenario}`);
    let actor: { uid: string } = captain;
    let expected = '';
    switch (scenario) {
      case 'member':
        actor = DEMO_USERS.member;
        expected = 'TRADER_REQUIRED';
        break;
      case 'unknown':
        actor = { uid: 'unregistered-user' };
        expected = 'MEMBERSHIP_REQUIRED';
        break;
      case 'self':
        command = h.buy('trade-invalid-self', 'team-1');
        expected = 'SELF_INVESTMENT';
        break;
      case 'stale-pool':
        command.expectedPoolVersion++;
        expected = 'STALE_QUOTE';
        break;
      case 'stale-wallet':
        command.expectedWalletVersion++;
        expected = 'WALLET_CHANGED';
        break;
      case 'stale-phase':
        command.expectedPhaseVersion++;
        expected = 'STALE_QUOTE';
        break;
      case 'price-bound':
        command.maxDebitMinor = 1;
        expected = 'STALE_QUOTE';
        break;
      case 'deadline':
        h.setNow(h.event().closesAt!);
        expected = 'WINDOW_EXPIRED';
        break;
      case 'paused':
        expected = 'EVENT_PAUSED';
        break;
      case 'cooldown':
        expected = 'TRADE_COOLDOWN';
        break;
      case 'quota':
        expected = 'TRADE_LIMIT';
        break;
      case 'holding-cap':
        command = h.buy('trade-invalid-cap', 'team-2', 25);
        expected = 'HOLDING_LIMIT';
        break;
    }
    const before = financialState(h.repository);
    await rejectedCode(h.service.execute(actor, command), expected);
    expect(financialState(h.repository)).toEqual(before);
  });

  it('resamples server time when authoritative data reads cross the deadline', async () => {
    let now = 10_000_000;
    const documents = createDemoDocuments('trading', now);
    const event = documents[root] as EventConfig;
    event.closesAt = now + 5;
    const repository = new MemoryRepository(documents);
    const delayed: Repository = {
      transaction: (work) =>
        repository.transaction((tx) =>
          work({
            ...tx,
            get: async <T>(path: string) => {
              const result = await tx.get<T>(path);
              if (path === `${root}/pools/team-2`) now = event.closesAt!;
              return result;
            },
          }),
        ),
    };
    const service = new GameService(delayed, DEMO_EVENT_ID, { now: () => now });
    const pool = documents[`${root}/pools/team-2`] as Pool;
    const command: TradeCommand = {
      type: 'executeTrade',
      commandId: 'deadline-during-read',
      issuerId: 'team-2',
      side: 'BUY',
      shares: 1,
      expectedPoolVersion: pool.version,
      expectedWalletVersion: 1,
      expectedPhaseVersion: event.phaseVersion,
      maxDebitMinor: new ConstantProductPool(pool).quote('BUY', 1).totalMinor,
    };
    const before = financialState(repository);
    await rejectedCode(service.execute(captain, command), 'WINDOW_EXPIRED');
    expect(financialState(repository)).toEqual(before);
  });

  it('publishes approved teammates into the captain roster and keeps trader designation synchronized', async () => {
    const h = harness('seed', (docs) => {
      (docs[root] as EventConfig).phase = 'REGISTRATION';
    });
    const newcomer = { uid: 'new-teammate', displayName: 'New teammate' };
    await h.service.execute(newcomer, {
      type: 'requestMembership',
      commandId: 'request-teammate-0001',
      displayName: 'New teammate',
      teamName: 'Mosaic',
      teamId: 'team-1',
    });
    await h.service.execute(organizer, {
      type: 'approveMembership',
      commandId: 'approve-teammate-0001',
      uid: newcomer.uid,
      role: 'member',
      teamId: 'team-1',
    });
    expect(
      (await h.service.snapshot(captain.uid)).members.some(
        (member) => member.uid === newcomer.uid && member.role === 'member',
      ),
    ).toBe(true);
    await h.service.execute(captain, {
      type: 'setMemberRole',
      commandId: 'designate-trader-0001',
      uid: newcomer.uid,
      role: 'trader',
      status: 'approved',
    });
    expect(
      (await h.service.snapshot(captain.uid)).members.some(
        (member) => member.uid === newcomer.uid && member.role === 'trader',
      ),
    ).toBe(true);
    expect((await h.service.snapshot(newcomer.uid)).member?.role).toBe('trader');
  });

  it('keeps teammate notes private and derives the portfolio from authenticated membership', async () => {
    const h = harness();
    await h.service.execute(captain, {
      type: 'saveNote',
      commandId: 'note-private-0001',
      issuerId: 'team-2',
      thesis: 'Private investment reasoning',
      reconsider: '',
      nextCheck: '',
      expectedVersion: 0,
    });
    const own = await h.service.snapshot(captain.uid);
    const other = await h.service.snapshot('demo-captain-2');
    expect(own.wallet?.teamId).toBe('team-1');
    expect(own.notes.some((note) => note.thesis === 'Private investment reasoning')).toBe(true);
    expect(other.wallet?.teamId).toBe('team-2');
    expect(other.notes.some((note) => note.thesis === 'Private investment reasoning')).toBe(false);
    expect(other.receipts.every((receipt) => receipt.teamId === 'team-2')).toBe(true);
  });
});

describe('recoverable event operations', () => {
  it('resumes a sealed funding manifest, charges each team once, and reveals only complete allocations', async () => {
    const h = harness('seed');
    for (let i = 1; i <= 5; i++) {
      await h.service.execute(
        { uid: i === 1 ? captain.uid : `demo-captain-${i}` },
        {
          type: 'setSeedCommitments',
          commandId: `seed-commit-${i}-0001`,
          shares: { 'team-12': 25 },
          expectedWalletVersion: 0,
          expectedCommitmentVersion: 0,
        },
      );
    }
    const before = await h.service.snapshot('demo-captain-6');
    expect(
      before.market.entries.find((entry) => entry.team.id === 'team-12')?.issuer.fundingVaultMinor,
    ).toBe(0);
    await h.service.execute(organizer, {
      type: 'transitionEvent',
      commandId: 'seed-close-0001',
      target: 'SEED_SETTLING',
      expectedPhaseVersion: h.event().phaseVersion,
    });
    expect(h.event().phase).toBe('SEED_SETTLING');
    const unit: Command = { type: 'continueOperation', commandId: 'seed-resume-0001' };
    const first = await h.service.execute(organizer, unit);
    const applied = financialState(h.repository);
    expect(await h.service.execute(organizer, unit)).toEqual(first);
    expect(financialState(h.repository)).toEqual(applied);
    const partial = await h.service.snapshot('demo-captain-6');
    expect(
      partial.market.entries.find((entry) => entry.team.id === 'team-12')?.issuer.fundingVaultMinor,
    ).toBe(0);
    // Reconstruct the service to model a worker/browser restart against persisted storage.
    const resumed = new GameService(h.repository, DEMO_EVENT_ID, { now: () => 10_000_000 });
    for (let i = 2; i <= 20 && h.event().phase === 'SEED_SETTLING'; i++) {
      await resumed.execute(organizer, {
        type: 'continueOperation',
        commandId: `seed-resume-${String(i).padStart(4, '0')}`,
      });
    }
    expect(h.event().phase).toBe('INTERMISSION');
    for (let i = 1; i <= 12; i++) {
      const wallet = h.repository.dump()[`${root}/wallets/team-${i}`] as Wallet;
      expect(wallet.reservedSeedMinor).toBe(0);
      expect(wallet.cashMinor).toBe(i <= 5 ? 800_000 : RULES.initialWalletMinor);
    }
    const completed = await resumed.snapshot(captain.uid);
    expect(completed.positions.find((position) => position.issuerId === 'team-12')?.shares).toBe(
      20,
    );
    expect(
      completed.market.entries.find((entry) => entry.team.id === 'team-12')?.issuer
        .fundingVaultMinor,
    ).toBe(1_000_000);
    expect(
      completed.market.entries.find((entry) => entry.team.id === 'team-12')?.issuer.seedBackers,
    ).toBe(5);
  });

  it('releases an issuer’s unallocated funding commitments when the organizer halts it', async () => {
    const h = harness('seed');
    await h.service.execute(captain, {
      type: 'setSeedCommitments',
      commandId: 'commit-before-halt-0001',
      shares: { 'team-2': 10, 'team-3': 15 },
      expectedWalletVersion: 0,
      expectedCommitmentVersion: 0,
    });
    await h.service.execute(organizer, {
      type: 'setPause',
      commandId: 'pause-before-halt-0001',
      paused: true,
      reason: 'Project withdrew before allocation',
      expectedPhaseVersion: h.event().phaseVersion,
    });
    await h.service.execute(organizer, {
      type: 'haltIssuer',
      commandId: 'halt-project-0001',
      issuerId: 'team-2',
      eligibility: 'withdrawn',
      reason: 'Team withdrew before allocation',
    });
    const snapshot = await h.service.snapshot(captain.uid);
    expect(snapshot.wallet?.cashMinor).toBe(RULES.initialWalletMinor);
    expect(snapshot.wallet?.reservedSeedMinor).toBe(150_000);
    expect(snapshot.commitments?.shares).toEqual({ 'team-3': 15 });
    expect(snapshot.market.entries.find((entry) => entry.team.id === 'team-2')?.pool.halted).toBe(
      true,
    );
  });

  it('freezes holdings, resumes immutable final reports and publishes rankings without changing money', async () => {
    const h = harness();
    await h.service.execute(organizer, {
      type: 'transitionEvent',
      commandId: 'close-trading-0001',
      target: 'INTERMISSION',
      expectedPhaseVersion: h.event().phaseVersion,
    });
    await h.service.execute(organizer, {
      type: 'transitionEvent',
      commandId: 'freeze-final-0001',
      target: 'FROZEN',
      expectedPhaseVersion: h.event().phaseVersion,
    });
    const frozen = financialState(h.repository);
    const scores = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [`team-${i + 1}`, 100 - Math.floor(i / 2)]),
    );
    await h.service.execute(organizer, {
      type: 'prepareResults',
      commandId: 'prepare-final-0001',
      scores,
    });
    expect(h.event().phase).toBe('FINALIZING');
    expect((await h.service.snapshot(captain.uid)).results).toBeNull();
    await rejectedCode(
      h.service.execute(organizer, {
        type: 'publishResults',
        commandId: 'early-publish-0001',
        expectedPhaseVersion: h.event().phaseVersion,
      }),
      'RESULTS_NOT_READY',
    );
    for (let i = 1; i <= 13; i++) {
      const command: Command = {
        type: 'continueOperation',
        commandId: `final-resume-${String(i).padStart(4, '0')}`,
      };
      const accepted = await h.service.execute(organizer, command);
      expect(await h.service.execute(organizer, command)).toEqual(accepted);
    }
    expect(financialState(h.repository)).toEqual(frozen);
    expect((await h.service.snapshot(captain.uid)).results).toBeNull();
    await h.service.execute(organizer, {
      type: 'publishResults',
      commandId: 'publish-final-0001',
      expectedPhaseVersion: h.event().phaseVersion,
    });
    const final = await h.service.snapshot(captain.uid);
    expect(final.event?.phase).toBe('FINALIZED');
    expect(final.results?.teams).toHaveLength(12);
    expect(final.results?.issuers).toHaveLength(12);
    expect(financialState(h.repository)).toEqual(frozen);
    expect(final.results?.issuers.slice(0, 2).map((issuer) => issuer.rank)).toEqual([1, 1]);
    await rejectedCode(
      h.service.execute(organizer, {
        type: 'transitionEvent',
        commandId: 'forbidden-reopen-0001',
        target: 'TRADING_OPEN',
        expectedPhaseVersion: h.event().phaseVersion,
      }),
      'INVALID_TRANSITION',
    );
  });
});
