import { describe, expect, it } from 'vitest';
import { defaultPlatformConfig, SealedFunding } from '@robinhacks/core';
import type {
  EventConfig,
  FundingCommand,
  FundingRound,
  Member,
  ProjectUpdate,
  RoundAllocation,
  Team,
} from '@robinhacks/core';
import { FundingService } from '../packages/application/src/services/funding-service';
import { MemoryRepository, type DocumentMap } from '../packages/application/src/memory-repository';
import { EventPaths } from '../packages/application/src/paths';

const settings = defaultPlatformConfig().funding;
const ids = ['a', 'b', 'c'];
function round(number = 1, teams = ids): FundingRound {
  return {
    id: `funding-${number}`,
    number,
    name: settings.roundNames[number - 1],
    state: 'open',
    openedAt: 1_000,
    closesAt: 61_000,
    closedAt: null,
    weightBps: settings.roundWeightsBps[number - 1],
    minimumDenominator: 200,
    eligibleTeamIds: teams,
    totals: {},
    voidReason: '',
    version: 1,
  };
}
function sheet(teamId: string, amounts: Record<string, number>, number = 1): RoundAllocation {
  return {
    id: `funding-${number}__${teamId}`,
    roundId: `funding-${number}`,
    teamId,
    amounts,
    version: 1,
    updatedAt: 2_000,
    actorUid: `captain-${teamId}`,
  };
}
function close(sheets: RoundAllocation[], number = 1, teams = ids) {
  return SealedFunding.closeRound(round(number, teams), sheets, settings, 61_000);
}

describe('sealed funding economics', () => {
  it('uses the floor denominator for an uncrowded project and leaves its unused reserve intact', () => {
    const result = close([sheet('a', { b: 10 })]);
    expect(result.entitlements.find((entry) => entry.teamId === 'a')?.projects).toEqual([
      { projectId: 'b', credits: 10, total: 10, denominator: 200, weightBps: 4000 },
    ]);
    const payoff = SealedFunding.payoff(result.entitlements, 'b', 10_000);
    expect(payoff.investors.find((entry) => entry.teamId === 'a')).toEqual({
      teamId: 'a',
      rewardMinor: 200,
      entitlementPercent: 2,
    });
    expect(payoff.reserveMinor).toBe(9_800);
  });

  it('uses the actual total above the floor and allocates exactly the reserved round fraction', () => {
    const teams = ['winner', 'a', 'b', 'c', 'd', 'e'];
    const result = close(
      teams.slice(1).map((id) => sheet(id, { winner: 60 })),
      1,
      teams,
    );
    const payoff = SealedFunding.payoff(result.entitlements, 'winner', 10_000);
    expect(result.round.totals.winner).toBe(300);
    expect(
      payoff.investors
        .filter((entry) => entry.teamId !== 'winner')
        .every((entry) => entry.rewardMinor === 800),
    ).toBe(true);
    expect(payoff.investorPaidMinor).toBe(4_000);
    expect(payoff.reserveMinor).toBe(6_000);
  });

  it('expires unused budgets, including an absent sheet, without creating claims', () => {
    const result = close([sheet('a', { b: 60 })]);
    expect(result.entitlements.find((entry) => entry.teamId === 'a')).toMatchObject({
      spent: 60,
      expired: 40,
    });
    expect(result.entitlements.find((entry) => entry.teamId === 'b')).toMatchObject({
      spent: 0,
      expired: 100,
      projects: [],
    });
    expect(SealedFunding.payoff(result.entitlements, 'c', 5_000)).toMatchObject({
      investorPaidMinor: 0,
      reserveMinor: 5_000,
    });
  });

  it('never dilutes earlier closed entitlements when later investors arrive', () => {
    const first = close([sheet('a', { b: 60 })]);
    const frozen = structuredClone(first.entitlements);
    const second = close([sheet('a', { b: 60 }, 2), sheet('c', { b: 60 }, 2)], 2);
    const payoff = SealedFunding.payoff(
      [...first.entitlements, ...second.entitlements],
      'b',
      10_000,
    );
    expect(first.entitlements).toEqual(frozen);
    expect(payoff.investors.find((entry) => entry.teamId === 'a')?.rewardMinor).toBe(2_250);
  });

  it('sums rational claims before flooring each team reward to cents', () => {
    const entitlements = [1, 2, 3].flatMap(
      (number) => close([sheet('a', { b: 60 }, number)], number).entitlements,
    );
    const payoff = SealedFunding.payoff(entitlements, 'b', 7);
    expect(payoff.investors.find((entry) => entry.teamId === 'a')).toMatchObject({
      rewardMinor: 2,
      entitlementPercent: 30,
    });
    expect(payoff.reserveMinor).toBe(5);
  });

  it('increases an uncrowded claim proportionally with the amount invested', () => {
    const small = SealedFunding.payoff(close([sheet('a', { b: 10 })]).entitlements, 'b', 10_000);
    const large = SealedFunding.payoff(close([sheet('a', { b: 60 })]).entitlements, 'b', 10_000);
    expect(large.investorPaidMinor).toBe(small.investorPaidMinor * 6);
  });

  it('conserves the investor reserve for every winner in a full 30-team, three-round event', () => {
    const teams = Array.from({ length: 30 }, (_, i) => `team-${i}`);
    const entitlements = [1, 2, 3].flatMap(
      (number) =>
        close(
          teams.map((teamId, index) =>
            sheet(
              teamId,
              {
                [teams[(index + number) % teams.length]]: 60,
                [teams[(index + number + 1) % teams.length]]: 40,
              },
              number,
            ),
          ),
          number,
          teams,
        ).entitlements,
    );
    for (const winner of teams) {
      const payoff = SealedFunding.payoff(entitlements, winner, Number.MAX_SAFE_INTEGER);
      expect(payoff.investorPaidMinor).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
      expect(BigInt(payoff.investorPaidMinor) + BigInt(payoff.reserveMinor)).toBe(
        BigInt(Number.MAX_SAFE_INTEGER),
      );
    }
  });

  it.each([-10, 1, 65, 70, Number.NaN, Number.POSITIVE_INFINITY, 0.5])(
    'rejects invalid credit amount %s',
    (amount) => {
      expect(() => SealedFunding.validateAllocation('a', { b: amount }, ids, settings)).toThrow();
    },
  );

  it('rejects self funding, unknown projects, budget excess, duplicate entitlements, and tampered denominator terms', () => {
    for (const amounts of [{ a: 10 }, { unknown: 10 }, { b: 60, c: 60 }] as Record<
      string,
      number
    >[]) {
      expect(() => SealedFunding.validateAllocation('a', amounts, ids, settings)).toThrow();
    }
    const entitlements = close([sheet('a', { b: 60 })]).entitlements;
    expect(() => SealedFunding.payoff([...entitlements, entitlements[0]], 'b', 1_000)).toThrow();
    entitlements[0].projects[0].denominator = 1;
    expect(() => SealedFunding.payoff(entitlements, 'b', 1_000)).toThrow();
  });

  it('ignores voided rounds and does not redistribute their reserved rewards', () => {
    const entries = close([sheet('a', { b: 60 })]).entitlements.map((entry) => ({
      ...entry,
      voided: true,
    }));
    expect(SealedFunding.payoff(entries, 'b', 10_000)).toMatchObject({
      investorPaidMinor: 0,
      reserveMinor: 10_000,
    });
  });

  it('validates frozen economic settings independently of the request parser', () => {
    for (const patch of [
      { roundWeightsBps: [4000, 3500, 3000] },
      { minimumDenominator: 99 },
      { increment: 7 },
      { maxPerProject: 100 },
      { investorPoolMinor: -1 },
      { rubric: [] },
    ]) {
      expect(() => SealedFunding.validateSettings({ ...settings, ...patch })).toThrow();
    }
  });
});

function fixture() {
  const paths = new EventPaths('sealed-event');
  const documents: DocumentMap = {};
  let now = 1_000;
  let sequence = 0;
  const event: EventConfig = {
    id: 'sealed-event',
    name: 'RobinHacks',
    venue: 'Brown',
    phase: 'REGISTRATION',
    phaseVersion: 0,
    paused: false,
    pauseReason: '',
    windowId: 0,
    closesAt: null,
    createdAt: now,
    rulesVersion: 2,
    activeOperationId: null,
    publishedResultId: null,
    announcement: '',
    tieSeed: 'test',
    platform: defaultPlatformConfig(),
  };
  documents[paths.root] = event;
  for (const id of ids) {
    documents[paths.team(id)] = {
      id,
      name: id.toUpperCase(),
      ticker: id.toUpperCase(),
      pitch: 'A real prototype',
      category: 'Tools',
      color: '#000000',
      problem: 'A clear problem',
      building: 'A working project',
      demoUrl: '',
      repoUrl: '',
      update: '',
      updatedAt: now,
      eligibility: 'active',
      captainUid: `captain-${id}`,
      version: 0,
    } satisfies Team;
    documents[paths.member(`captain-${id}`)] = {
      uid: `captain-${id}`,
      teamId: id,
      role: 'captain',
      status: 'approved',
      displayName: id,
      version: 0,
    } satisfies Member;
    for (let number = 1; number <= 3; number++) {
      const update: ProjectUpdate = {
        id: `${id}-${number}`,
        teamId: id,
        round: number,
        works: 'Login works',
        changed: 'Added a demo',
        evidenceUrl: '',
        incomplete: 'Mobile testing',
        createdAt: now,
        authorName: id,
      };
      documents[paths.doc('projectUpdates', update.id)] = update;
    }
  }
  for (const [uid, role, teamId] of [
    ['organizer', 'organizer', null],
    ['judge', 'judge', null],
    ['viewer', 'member', 'a'],
  ] as const) {
    documents[paths.member(uid)] = {
      uid,
      teamId,
      role,
      status: 'approved',
      displayName: uid,
      version: 0,
    } satisfies Member;
  }
  const repository = new MemoryRepository(documents);
  const service = new FundingService();
  async function command(
    uid: string,
    action: Omit<FundingCommand, 'commandId'> | Record<string, unknown>,
  ) {
    return repository.transaction(async (tx) => {
      const event = (await tx.get<EventConfig>(paths.root))!;
      const member = (await tx.get<Member>(paths.member(uid)))!;
      return service.execute(
        {
          tx,
          paths,
          event,
          member,
          actor: { uid },
          now,
          clock: { now: () => now },
          payloadKey: '',
        },
        { ...action, commandId: `command-${++sequence}` } as FundingCommand,
      );
    });
  }
  async function snapshot(uid: string) {
    return repository.transaction(async (tx) =>
      service.snapshot({
        tx,
        paths,
        event: (await tx.get<EventConfig>(paths.root))!,
        member: (await tx.get<Member>(paths.member(uid)))!,
        now,
      }),
    );
  }
  async function change(path: string, patch: Record<string, unknown>) {
    return repository.transaction(async (tx) =>
      tx.set(path, { ...(await tx.get<object>(path)), ...patch }),
    );
  }
  const currentEvent = () => repository.dump()[paths.root] as EventConfig;
  const open = () =>
    command('organizer', {
      type: 'openFundingRound',
      expectedPhaseVersion: currentEvent().phaseVersion,
      durationMinutes: 1,
    });
  const finish = () =>
    command('organizer', {
      type: 'closeFundingRound',
      roundId: `funding-${currentEvent().platform!.currentRound}`,
      expectedPhaseVersion: currentEvent().phaseVersion,
    });
  const save = (amounts: Record<string, number>, expectedVersion = 0, uid = 'captain-a') =>
    command(uid, {
      type: 'saveAllocation',
      roundId: `funding-${currentEvent().platform!.currentRound}`,
      amounts,
      expectedVersion,
    });
  return {
    paths,
    repository,
    service,
    command,
    snapshot,
    change,
    currentEvent,
    open,
    finish,
    save,
    setNow: (value: number) => {
      now = value;
    },
  };
}

describe('sealed funding application boundaries', () => {
  it('keeps open totals and every other team allocation private, including from organizers and judges', async () => {
    const h = fixture();
    await h.open();
    await h.save({ b: 60 });
    expect((await h.snapshot('captain-a')).allocation?.amounts).toEqual({ b: 60 });
    expect((await h.snapshot('viewer')).allocation?.amounts).toEqual({ b: 60 });
    for (const uid of ['captain-b', 'organizer', 'judge']) {
      expect(await h.snapshot(uid)).toMatchObject({
        allocation: null,
        entitlements: [],
        rounds: [{ totals: {} }],
      });
    }
    h.setNow(61_000);
    expect((await h.snapshot('organizer')).rounds[0].totals).toEqual({});
    await h.finish();
    expect((await h.snapshot('organizer')).rounds[0].totals).toEqual({ a: 0, b: 60, c: 0 });
    expect((await h.snapshot('organizer')).entitlements).toEqual([]);
    expect((await h.snapshot('judge')).rounds[0].totals).toEqual({});
    expect((await h.snapshot('captain-a')).entitlements).toHaveLength(1);
    expect((await h.snapshot('captain-b')).entitlements[0].projects).toEqual([]);
  });

  it('enforces the server deadline, stops writes while paused, and prevents an early organizer reveal', async () => {
    const h = fixture();
    await h.open();
    await expect(h.finish()).rejects.toMatchObject({ code: 'ROUND_NOT_DUE' });
    await h.change(h.paths.root, { paused: true });
    await expect(h.save({ b: 60 })).rejects.toMatchObject({ code: 'EVENT_PAUSED' });
    h.setNow(61_000);
    await expect(h.finish()).rejects.toMatchObject({ code: 'INVALID_PHASE' });
    await h.change(h.paths.root, { paused: false });
    await expect(h.save({ b: 60 })).rejects.toMatchObject({ code: 'ROUND_CLOSED' });
    await h.finish();
    await expect(h.save({ b: 60 })).rejects.toMatchObject({ code: 'ROUND_CLOSED' });
  });

  it('serializes two teammate edits with one accepted version and no lost update', async () => {
    const h = fixture();
    await h.open();
    const results = await Promise.allSettled([h.save({ b: 60 }), h.save({ c: 40 })]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'ALLOCATION_CHANGED' },
    });
    expect((await h.snapshot('captain-a')).allocation).toMatchObject({
      version: 1,
      amounts: { b: 60 },
    });
  });

  it('requires a captain, an organizer for round controls, and the reviewed phase version', async () => {
    const h = fixture();
    await expect(
      h.command('captain-a', {
        type: 'openFundingRound',
        expectedPhaseVersion: 0,
        durationMinutes: 1,
      }),
    ).rejects.toMatchObject({ code: 'ORGANIZER_REQUIRED' });
    await h.open();
    await expect(h.save({ b: 60 }, 0, 'viewer')).rejects.toMatchObject({ code: 'TRADER_REQUIRED' });
    await expect(
      h.command('organizer', {
        type: 'closeFundingRound',
        roundId: 'funding-1',
        expectedPhaseVersion: 0,
      }),
    ).rejects.toMatchObject({ code: 'PHASE_CHANGED' });
  });

  it('requires checkpoint updates from every active team before opening', async () => {
    const h = fixture();
    await h.repository.transaction(async (tx) => tx.delete(h.paths.doc('projectUpdates', 'c-1')));
    await expect(h.open()).rejects.toMatchObject({ code: 'CHECKPOINT_REQUIRED' });
    expect(h.currentEvent().phase).toBe('REGISTRATION');
  });

  it('requires an approved captain for every competing team and at least two active teams', async () => {
    const h = fixture();
    await h.change(h.paths.member('captain-c'), { status: 'pending' });
    await expect(h.open()).rejects.toMatchObject({ code: 'TEAM_NOT_APPROVED' });
    await h.change(h.paths.team('c'), { eligibility: 'withdrawn' });
    await h.change(h.paths.team('b'), { eligibility: 'withdrawn' });
    await expect(h.open()).rejects.toMatchObject({ code: 'TOO_FEW_TEAMS' });
  });

  it('does not count pending applicants or staff against the 150 competing participant limit', async () => {
    const h = fixture();
    await h.repository.transaction(async (tx) => {
      for (let index = 0; index < 160; index++) {
        const uid = `pending-${index}`;
        tx.set<Member>(h.paths.member(uid), {
          uid,
          teamId: null,
          role: 'member',
          status: 'pending',
          displayName: uid,
          version: 0,
        });
      }
    });
    await h.open();
    expect(h.currentEvent().phase).toBe('SEED_OPEN');
  });

  it('allows schedule edits after rules lock without changing the running round or its deadline', async () => {
    const h = fixture();
    await h.open();
    const config = h.currentEvent().platform!;
    const originalDeadline = h.currentEvent().closesAt;
    const timing = structuredClone(config.details.timing!);
    timing.rounds[1].closesAt += 15 * 60_000;
    const command = {
      type: 'configurePlatform',
      details: { ...config.details, about: 'Doors open at nine.', timing },
      funding: config.funding,
      name: 'RobinHacks',
      venue: 'Providence',
    };
    await h.command('organizer', command);
    expect(h.currentEvent().venue).toBe('Providence');
    expect(h.currentEvent().platform!.details.timing).toEqual(timing);
    expect(h.currentEvent().closesAt).toBe(originalDeadline);
    await expect(
      h.command('organizer', {
        ...command,
        funding: {
          ...config.funding,
          investorPoolMinor: 10_000,
          builderPrizesMinor: [10_000, 0, 0],
        },
      }),
    ).rejects.toMatchObject({ code: 'RULES_LOCKED' });
  });

  it('keeps an explicit planned deadline when a funding round opens late', async () => {
    const h = fixture();
    h.setNow(120_000);
    await h.command('organizer', {
      type: 'openFundingRound',
      expectedPhaseVersion: h.currentEvent().phaseVersion,
      durationMinutes: 10,
      closesAt: 300_000,
    });
    expect(h.currentEvent().closesAt).toBe(300_000);
    expect(
      (h.repository.dump()[h.paths.doc('fundingRounds', 'funding-1')] as FundingRound).closesAt,
    ).toBe(300_000);
  });

  it.each([120_000, 119_999, 120_000 + 1440 * 60_000 + 1])(
    'rejects an expired or overly distant explicit deadline: %i',
    async (closesAt) => {
      const h = fixture();
      h.setNow(120_000);
      await expect(
        h.command('organizer', {
          type: 'openFundingRound',
          expectedPhaseVersion: h.currentEvent().phaseVersion,
          durationMinutes: 10,
          closesAt,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_DEADLINE' });
      expect(h.currentEvent().platform!.currentRound).toBe(0);
    },
  );

  it('atomically refuses corrupted saved allocations without publishing any totals or entitlements', async () => {
    const h = fixture();
    await h.open();
    await h.save({ b: 60 });
    await h.change(h.paths.doc('roundAllocations', 'funding-1__a'), { amounts: { b: 60, c: 60 } });
    h.setNow(61_000);
    await expect(h.finish()).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
    expect(
      Object.keys(h.repository.dump()).some((key) => key.includes('/roundEntitlements/')),
    ).toBe(false);
    expect(h.currentEvent().phase).toBe('SEED_OPEN');
    expect((await h.snapshot('organizer')).rounds[0].totals).toEqual({});
  });

  it('voids the entire revealed round with its claims intact and cannot reopen or selectively refund it', async () => {
    const h = fixture();
    await h.open();
    await h.save({ b: 60 });
    h.setNow(61_000);
    await h.finish();
    const before = (await h.snapshot('captain-a')).entitlements[0];
    await h.command('organizer', {
      type: 'voidFundingRound',
      roundId: 'funding-1',
      expectedPhaseVersion: h.currentEvent().phaseVersion,
      reason: 'All participants lost access during this round.',
    });
    const after = await h.snapshot('captain-a');
    expect(after.entitlements[0]).toEqual({ ...before, voided: true });
    expect(after.rounds[0]).toMatchObject({ state: 'void', totals: { a: 0, b: 60, c: 0 } });
    await h.open();
    expect(h.currentEvent().platform?.currentRound).toBe(2);
    expect((await h.snapshot('captain-a')).allocation).toBeNull();
    await expect(
      h.command('captain-a', {
        type: 'saveAllocation',
        roundId: 'funding-1',
        amounts: { c: 60 },
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'ROUND_CLOSED' });
  });

  it('requires final submissions for round three and never creates a fourth round', async () => {
    const h = fixture();
    await h.open();
    h.setNow(61_000);
    await h.finish();
    await h.open();
    h.setNow(121_000);
    await h.finish();
    await expect(h.open()).rejects.toMatchObject({ code: 'SUBMISSION_REQUIRED' });
    await h.repository.transaction(async (tx) => {
      for (const id of ids) tx.set(h.paths.doc('submissions', id), { teamId: id });
    });
    await h.open();
    h.setNow(181_000);
    await h.finish();
    await expect(h.open()).rejects.toMatchObject({ code: 'ROUND_LIMIT' });
    expect((await h.snapshot('captain-a')).entitlements).toHaveLength(3);
  });
});
