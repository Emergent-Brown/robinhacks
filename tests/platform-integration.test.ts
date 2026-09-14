import { describe, expect, it } from 'vitest';
import type { Command, EventConfig, Member } from '@robinhacks/core';
import { GameService } from '../packages/application/src/game-service';
import {
  createPlatformDemoDocuments,
  DEMO_EVENT_ID,
  PLATFORM_USERS,
} from '../packages/application/src/platform-fixtures';
import { MemoryRepository } from '../packages/application/src/memory-repository';

const root = `events/${DEMO_EVENT_ID}`;
const start = 10_000_000;
const newcomer = {
  uid: 'new-attendee',
  displayName: 'Morgan Lee',
  email: 'morgan@example.test',
  emailVerified: true,
};
function fixture(preset: 'seed' | 'trading' = 'trading') {
  const repository = new MemoryRepository(createPlatformDemoDocuments(preset, start));
  let now = start;
  let number = 0;
  const service = new GameService(repository, DEMO_EVENT_ID, { now: () => now });
  const event = () => repository.dump()[root] as EventConfig;
  async function patch(path: string, values: Record<string, unknown>) {
    await repository.transaction(async (tx) =>
      tx.set(path, { ...(await tx.get<object>(path)), ...values }),
    );
  }
  async function execute(
    actor: typeof newcomer | (typeof PLATFORM_USERS)[keyof typeof PLATFORM_USERS],
    command: Record<string, unknown>,
  ) {
    return service.execute(actor, { commandId: `integration-${++number}`, ...command } as Command);
  }
  const pause = (paused: boolean) =>
    execute(PLATFORM_USERS.organizer, {
      type: 'setPause',
      paused,
      reason: 'Connection outage for the entire room',
      expectedPhaseVersion: event().phaseVersion,
    });
  const allocation = () =>
    execute(PLATFORM_USERS.captain, {
      type: 'saveAllocation',
      roundId: 'funding-2',
      amounts: { 'team-2': 60, 'team-3': 40 },
      expectedVersion: 0,
    });
  const membership = (actor = newcomer) =>
    execute(actor, {
      type: 'requestMembership',
      displayName: actor.displayName,
      teamName: 'Switchboard',
    });
  return {
    repository,
    service,
    event,
    patch,
    execute,
    pause,
    allocation,
    membership,
    setNow: (time: number) => {
      now = time;
    },
  };
}

describe('v2 integration isolation and privacy', () => {
  it.each([
    {
      type: 'executeTrade',
      issuerId: 'team-2',
      side: 'BUY',
      shares: 1,
      expectedPoolVersion: 0,
      expectedWalletVersion: 0,
      expectedPhaseVersion: 4,
      maxDebitMinor: 10000,
    },
    {
      type: 'setSeedCommitments',
      shares: { 'team-2': 1 },
      expectedWalletVersion: 0,
      expectedCommitmentVersion: 0,
    },
    { type: 'prepareResults', scores: { 'team-1': 10 } },
    { type: 'publishResults', expectedPhaseVersion: 4 },
    { type: 'continueOperation' },
  ])('rejects legacy $type commands even for the organizer', async (command) => {
    const h = fixture();
    await expect(h.execute(PLATFORM_USERS.organizer, command)).rejects.toMatchObject({
      code: 'SEALED_ROUNDS_ONLY',
    });
  });

  it('does not expose a tradable pool through the legacy endpoint', async () => {
    const h = fixture();
    for (const actor of [PLATFORM_USERS.captain, PLATFORM_USERS.organizer, PLATFORM_USERS.judge]) {
      await expect(h.service.pool(actor.uid, 'team-2')).rejects.toMatchObject({
        code: 'SEALED_ROUNDS_ONLY',
      });
    }
  });

  it('returns only public event configuration without any participant or funding record', async () => {
    const h = fixture();
    await h.allocation();
    const snapshot = await h.service.publicSnapshot();
    expect(snapshot.event).toMatchObject({
      name: 'Emergent Hacks 2026',
      tieSeed: '',
      activeOperationId: null,
    });
    expect(snapshot.member).toBeNull();
    expect(snapshot.market.entries).toEqual([]);
    expect(snapshot.wallet).toBeNull();
    for (const key of ['members', 'requests', 'positions', 'notes', 'receipts', 'audit'] as const)
      expect(snapshot[key]).toEqual([]);
    expect(snapshot.platform).toMatchObject({
      rounds: [],
      allocation: null,
      entitlements: [],
      updates: [],
      submissions: [],
      roster: [],
      conversations: [],
      reports: [],
      assignments: [],
      judgingSheets: [],
      ballot: null,
      awards: null,
    });
  });

  it('does not reveal allocations or community totals to a judge, including after round close', async () => {
    const h = fixture();
    await h.allocation();
    await h.patch(`${root}/communityBallots/team-1`, {
      teamId: 'team-1',
      rankedProjectIds: ['team-2'],
      version: 1,
      updatedAt: start,
    });
    for (const phase of ['open', 'closed']) {
      if (phase === 'closed') {
        h.setNow(start + 20 * 60_000);
        await h.execute(PLATFORM_USERS.organizer, {
          type: 'closeFundingRound',
          roundId: 'funding-2',
          expectedPhaseVersion: h.event().phaseVersion,
        });
      }
      const snapshot = await h.service.snapshot(PLATFORM_USERS.judge.uid);
      expect(
        snapshot.platform?.rounds.every((round) => Object.keys(round.totals).length === 0),
      ).toBe(true);
      expect(snapshot.platform).toMatchObject({
        allocation: null,
        entitlements: [],
        ballot: null,
        awards: null,
      });
      expect(snapshot.wallet).toBeNull();
      expect(snapshot.members).toEqual([]);
      expect(snapshot.notes).toEqual([]);
      expect(snapshot.audit).toEqual([]);
    }
  });

  it('blocks paused exports while funding is sealed and allows only formally cancelled or published exports', async () => {
    const h = fixture();
    await h.allocation();
    await h.pause(true);
    await expect(h.service.exportEvent(PLATFORM_USERS.organizer.uid)).rejects.toMatchObject({
      code: 'ROUND_SEALED',
    });
    await expect(h.service.exportEvent(PLATFORM_USERS.judge.uid)).rejects.toMatchObject({
      code: 'ORGANIZER_REQUIRED',
    });
    await h.execute(PLATFORM_USERS.organizer, {
      type: 'transitionEvent',
      target: 'CANCELLED',
      expectedPhaseVersion: h.event().phaseVersion,
    });
    const exported = await h.service.exportEvent(PLATFORM_USERS.organizer.uid);
    expect(exported.schemaVersion).toBe(2);
    expect(
      (exported.fundingRounds as Array<{ state: string }>).some((round) => round.state === 'open'),
    ).toBe(false);
    expect(
      (exported.roundAllocations as Array<{ teamId: string }>).some(
        (sheet) => sheet.teamId === 'team-1',
      ),
    ).toBe(true);
    await expect(h.allocation()).rejects.toMatchObject({ code: 'ROUND_CLOSED' });
  });

  it('keeps complete private exports unavailable between rounds', async () => {
    const h = fixture();
    h.setNow(start + 20 * 60_000);
    await h.execute(PLATFORM_USERS.organizer, {
      type: 'closeFundingRound',
      roundId: 'funding-2',
      expectedPhaseVersion: h.event().phaseVersion,
    });
    await expect(h.service.exportEvent(PLATFORM_USERS.organizer.uid)).rejects.toMatchObject({
      code: 'EXPORT_AFTER_RESULTS',
    });
  });

  it('prevents staff from writing investments or messages, even if an inconsistent record has a team ID', async () => {
    const h = fixture();
    for (const actor of [PLATFORM_USERS.organizer, PLATFORM_USERS.judge]) {
      await h.patch(`${root}/members/${actor.uid}`, { teamId: 'team-1' });
      await expect(
        h.execute(actor, {
          type: 'saveAllocation',
          roundId: 'funding-2',
          amounts: { 'team-2': 60 },
          expectedVersion: 0,
        }),
      ).rejects.toMatchObject({ code: 'TEAM_REQUIRED' });
      await expect(
        h.execute(actor, { type: 'sendMessage', toTeamId: 'team-2', body: 'Show us your demo.' }),
      ).rejects.toMatchObject({ code: 'TEAM_REQUIRED' });
    }
  });

  it('keeps command retries idempotent while rejecting the same identifier with different amounts', async () => {
    const h = fixture();
    const command: Command = {
      type: 'saveAllocation',
      commandId: 'repeat-allocation',
      roundId: 'funding-2',
      amounts: { 'team-2': 60 },
      expectedVersion: 0,
    };
    const first = await h.service.execute(PLATFORM_USERS.captain, command);
    expect(await h.service.execute(PLATFORM_USERS.captain, command)).toEqual(first);
    expect(
      (await h.service.snapshot(PLATFORM_USERS.captain.uid)).platform?.allocation?.version,
    ).toBe(1);
    await expect(
      h.service.execute(PLATFORM_USERS.captain, { ...command, amounts: { 'team-3': 60 } }),
    ).rejects.toMatchObject({ code: 'COMMAND_CONFLICT' });
    await h.patch(`${root}/members/${PLATFORM_USERS.captain.uid}`, { status: 'suspended' });
    await expect(h.service.execute(PLATFORM_USERS.captain, command)).rejects.toMatchObject({
      code: 'MEMBERSHIP_REQUIRED',
    });
  });
});

describe('v2 verified identity and frozen rosters', () => {
  it('requires verified claims for access requests and never trusts client-supplied identity fields', async () => {
    const h = fixture('seed');
    await expect(h.membership({ ...newcomer, emailVerified: false })).rejects.toMatchObject({
      code: 'EMAIL_VERIFICATION_REQUIRED',
    });
    await h.membership();
    expect(h.repository.dump()[`${root}/accessRequests/${newcomer.uid}`]).toMatchObject({
      email: newcomer.email,
      emailVerified: true,
      status: 'pending',
    });
    await expect(
      h.execute(PLATFORM_USERS.captain, {
        type: 'requestMembership',
        displayName: 'Fake',
        teamName: 'Fake',
        emailVerified: true,
      }),
    ).rejects.toThrow();
  });

  it('blocks approval when verified identity is absent and creates no legacy financial documents for a new team', async () => {
    const h = fixture('seed');
    await h.membership();
    await h.patch(`${root}/members/${newcomer.uid}`, { emailVerified: false });
    const approval = { type: 'approveMembership', uid: newcomer.uid, role: 'captain' };
    await expect(h.execute(PLATFORM_USERS.organizer, approval)).rejects.toMatchObject({
      code: 'EMAIL_VERIFICATION_REQUIRED',
    });
    await h.patch(`${root}/members/${newcomer.uid}`, { emailVerified: true });
    await h.execute(PLATFORM_USERS.organizer, approval);
    const member = h.repository.dump()[`${root}/members/${newcomer.uid}`] as Member;
    expect(member).toMatchObject({ status: 'approved', role: 'captain', emailVerified: true });
    expect(h.repository.dump()[`${root}/teams/${member.teamId}`]).toBeDefined();
    expect(
      Object.keys(h.repository.dump()).some((path) => /\/(wallets|pools|issuers)\//.test(path)),
    ).toBe(false);
  });

  it('approves staff on separate accounts and resolves the pending request', async () => {
    const h = fixture('seed');
    await h.execute(newcomer, {
      type: 'requestMembership',
      displayName: newcomer.displayName,
      teamName: 'Judge',
      staffRole: 'judge',
    });
    await h.execute(PLATFORM_USERS.organizer, {
      type: 'setMemberRole',
      uid: newcomer.uid,
      role: 'judge',
      status: 'approved',
    });
    expect(h.repository.dump()[`${root}/members/${newcomer.uid}`]).toMatchObject({
      teamId: null,
      role: 'judge',
      status: 'approved',
    });
    expect(h.repository.dump()[`${root}/accessRequests/${newcomer.uid}`]).toMatchObject({
      status: 'approved',
    });
  });

  it('locks team access and reassignment after funding begins, even while paused', async () => {
    const h = fixture();
    await expect(
      h.execute(newcomer, {
        type: 'requestMembership',
        displayName: newcomer.displayName,
        teamName: 'Mosaic',
        teamId: 'team-1',
      }),
    ).rejects.toMatchObject({ code: 'ROSTER_LOCKED' });
    await h.pause(true);
    await expect(
      h.execute(PLATFORM_USERS.organizer, {
        type: 'setMemberRole',
        uid: PLATFORM_USERS.member.uid,
        role: 'trader',
        status: 'approved',
      }),
    ).rejects.toMatchObject({ code: 'ROSTER_LOCKED' });
    await expect(
      h.execute(PLATFORM_USERS.organizer, {
        type: 'approveMembership',
        uid: newcomer.uid,
        role: 'member',
        teamId: 'team-1',
      }),
    ).rejects.toMatchObject({ code: 'ROSTER_LOCKED' });
  });

  it('locks project profiles during a round and permanently after final submission', async () => {
    const h = fixture();
    const command = {
      type: 'updateTeam',
      expectedVersion: 0,
      patch: { pitch: 'A different pitch' },
    };
    await expect(h.execute(PLATFORM_USERS.captain, command)).rejects.toMatchObject({
      code: 'ROUND_OPEN',
    });
    h.setNow(start + 20 * 60_000);
    await h.execute(PLATFORM_USERS.organizer, {
      type: 'closeFundingRound',
      roundId: 'funding-2',
      expectedPhaseVersion: h.event().phaseVersion,
    });
    await h.execute(PLATFORM_USERS.captain, command);
    await h.patch(`${root}/submissions/team-1`, { teamId: 'team-1' });
    await expect(
      h.execute(PLATFORM_USERS.captain, { ...command, expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: 'SUBMISSION_LOCKED' });
  });

  it('requires the authenticated identity to match the requested private snapshot', async () => {
    const h = fixture();
    await expect(
      h.service.snapshot(PLATFORM_USERS.organizer.uid, PLATFORM_USERS.captain),
    ).rejects.toMatchObject({ code: 'IDENTITY_MISMATCH' });
  });
});

describe('fair pause and server deadlines', () => {
  it('extends all active deadlines by the same outage duration and keeps event and round deadlines equal', async () => {
    const h = fixture();
    const original = h.event().closesAt!;
    await h.patch(root, {
      platform: {
        ...h.event().platform!,
        submissionsOpen: true,
        submissionClosesAt: original + 10_000,
        ballotOpen: true,
        ballotClosesAt: original + 20_000,
      },
    });
    h.setNow(start + 10_000);
    await h.pause(true);
    h.setNow(start + 310_000);
    await h.pause(false);
    expect(h.event().closesAt).toBe(original + 300_000);
    expect(h.event().platform).toMatchObject({
      submissionClosesAt: original + 310_000,
      ballotClosesAt: original + 320_000,
    });
    expect(h.repository.dump()[`${root}/fundingRounds/funding-2`]).toMatchObject({
      closesAt: original + 300_000,
    });
    await h.allocation();
  });

  it('does not revive an already expired deadline by pausing after it passed', async () => {
    const h = fixture();
    const original = h.event().closesAt!;
    h.setNow(original + 1);
    await h.pause(true);
    h.setNow(original + 100_001);
    await h.pause(false);
    expect(h.event().closesAt).toBe(original);
    expect(h.repository.dump()[`${root}/fundingRounds/funding-2`]).toMatchObject({
      closesAt: original,
    });
    await expect(h.allocation()).rejects.toMatchObject({ code: 'ROUND_CLOSED' });
  });
});
