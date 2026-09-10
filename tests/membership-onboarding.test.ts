import { describe, expect, it } from 'vitest';
import type { Command, EventConfig, Member, Phase, Team } from '@robinhacks/core';
import { GameService } from '@robinhacks/application';
import {
  createDemoDocuments,
  DEMO_EVENT_ID,
  DEMO_USERS,
} from '../packages/application/src/fixtures';
import { MemoryRepository, type DocumentMap } from '../packages/application/src/memory-repository';

const root = `events/${DEMO_EVENT_ID}`;
const newcomer = { uid: 'late-teammate', displayName: 'Late teammate' };
const request: Extract<Command, { type: 'requestMembership' }> = {
  type: 'requestMembership',
  commandId: 'late-team-access-request',
  displayName: newcomer.displayName,
  teamName: 'An outdated team name',
  teamId: 'team-1',
};

function fixture(phase: Phase, configure?: (documents: DocumentMap) => void) {
  const documents = createDemoDocuments('trading', 10_000_000);
  (documents[root] as EventConfig).phase = phase;
  configure?.(documents);
  const repository = new MemoryRepository(documents);
  const service = new GameService(repository, DEMO_EVENT_ID, { now: () => 10_000_000 });
  return { repository, service };
}

function finances(repository: MemoryRepository) {
  return Object.fromEntries(
    Object.entries(repository.dump()).filter(([path]) => /\/(wallets|pools|issuers)\//.test(path)),
  );
}

function expectPrivateDataHidden(snapshot: Awaited<ReturnType<GameService['snapshot']>>) {
  expect(snapshot.market.entries).toEqual([]);
  expect(snapshot.wallet).toBeNull();
  expect(snapshot.positions).toEqual([]);
  expect(snapshot.commitments).toBeNull();
  expect(snapshot.notes).toEqual([]);
  expect(snapshot.receipts).toEqual([]);
  expect(snapshot.members).toEqual([]);
  expect(snapshot.results).toBeNull();
  expect(snapshot.operation).toBeNull();
  expect(snapshot.audit).toEqual([]);
}

describe('membership onboarding and scoped team discovery', () => {
  it('returns only active team names and IDs to new and pending people, preserving private data', async () => {
    const h = fixture('REGISTRATION', (documents) => {
      (documents[`${root}/teams/team-2`] as Team).eligibility = 'withdrawn';
      (documents[`${root}/teams/team-3`] as Team).eligibility = 'disqualified';
      documents[`${root}/accessRequests/another-user`] = {
        uid: 'another-user',
        displayName: 'Someone else',
        teamName: 'Private request',
        teamId: null,
        requestedAt: 1,
        status: 'pending',
      };
    });
    const before = await h.service.snapshot(newcomer.uid);
    expect(before.event?.phase).toBe('REGISTRATION');
    expect(before.joinableTeams).toHaveLength(10);
    expect(before.joinableTeams).toContainEqual({ id: 'team-1', name: 'Mosaic' });
    expect(
      before.joinableTeams?.every((team) => Object.keys(team).sort().join(',') === 'id,name'),
    ).toBe(true);
    expect(before.joinableTeams?.some((team) => ['team-2', 'team-3'].includes(team.id))).toBe(
      false,
    );
    expect(before.requests).toEqual([]);
    expectPrivateDataHidden(before);

    await h.service.execute(newcomer, request);
    const pending = await h.service.snapshot(newcomer.uid);
    expect(pending.member?.status).toBe('pending');
    expect(pending.joinableTeams).toEqual(before.joinableTeams);
    expect(pending.requests).toHaveLength(1);
    expect(pending.requests[0]).toMatchObject({
      uid: newcomer.uid,
      teamId: 'team-1',
      teamName: 'Mosaic',
    });
    expectPrivateDataHidden(pending);
  });

  it('bounds the directory to 30 names and omits it for suspended people and nonexistent events', async () => {
    const h = fixture('REGISTRATION', (documents) => {
      const sample = documents[`${root}/teams/team-1`] as Team;
      for (let number = 13; number <= 35; number++) {
        documents[`${root}/teams/team-${number}`] = {
          ...sample,
          id: `team-${number}`,
          name: `Team ${number}`,
        };
      }
      documents[`${root}/members/suspended-user`] = {
        uid: 'suspended-user',
        displayName: 'Suspended',
        role: 'member',
        teamId: 'team-1',
        status: 'suspended',
        version: 1,
      } satisfies Member;
    });
    expect((await h.service.snapshot(newcomer.uid)).joinableTeams).toHaveLength(30);
    const suspended = await h.service.snapshot('suspended-user');
    expect(suspended.joinableTeams).toBeUndefined();
    expectPrivateDataHidden(suspended);
    expect(
      (
        await new GameService(h.repository, 'missing-event', { now: () => 10_000_000 }).snapshot(
          newcomer.uid,
        )
      ).joinableTeams,
    ).toBeUndefined();
  });

  it.each<Phase>(['SEED_OPEN', 'INTERMISSION', 'TRADING_OPEN', 'FROZEN'])(
    'queues an existing-team request in %s without approving it or changing any finances',
    async (phase) => {
      const h = fixture(phase);
      const before = finances(h.repository);
      await h.service.execute(newcomer, request);
      const pending = await h.service.snapshot(newcomer.uid);
      expect(pending.member).toMatchObject({ status: 'pending', role: 'member', teamId: null });
      expect(pending.requests[0]).toMatchObject({ teamId: 'team-1', teamName: 'Mosaic' });
      expectPrivateDataHidden(pending);
      expect(finances(h.repository)).toEqual(before);
    },
  );

  it('requires an organizer and pause to approve a late teammate, keeping the same wallet and team', async () => {
    const h = fixture('TRADING_OPEN');
    const before = finances(h.repository);
    await h.service.execute(newcomer, request);
    const approval: Command = {
      type: 'approveMembership',
      commandId: 'late-team-approve',
      uid: newcomer.uid,
      role: 'member',
      teamId: 'team-1',
    };
    await expect(h.service.execute(DEMO_USERS.captain, approval)).rejects.toMatchObject({
      code: 'ORGANIZER_REQUIRED',
    });
    await expect(h.service.execute(DEMO_USERS.organizer, approval)).rejects.toMatchObject({
      code: 'ROSTER_LOCKED',
    });
    const event = h.repository.dump()[root] as EventConfig;
    await h.service.execute(DEMO_USERS.organizer, {
      type: 'setPause',
      commandId: 'pause-for-late-access',
      paused: true,
      reason: 'Approve a late teammate.',
      expectedPhaseVersion: event.phaseVersion,
    });
    await h.service.execute(DEMO_USERS.organizer, approval);
    const approved = await h.service.snapshot(newcomer.uid);
    expect(approved.member).toMatchObject({ status: 'approved', role: 'member', teamId: 'team-1' });
    expect(approved.wallet?.teamId).toBe('team-1');
    expect(approved.members.some((member) => member.uid === newcomer.uid)).toBe(true);
    expect(finances(h.repository)).toEqual(before);
  });

  it.each<Phase>(['DRAFT', 'REGISTRATION'])(
    'still accepts a new-team request in %s',
    async (phase) => {
      const h = fixture(phase);
      const { teamId: _teamId, ...newTeamRequest } = request;
      await h.service.execute(newcomer, newTeamRequest);
      expect((await h.service.snapshot(newcomer.uid)).requests[0]).toMatchObject({
        teamId: null,
        teamName: request.teamName,
      });
    },
  );

  it.each<Phase>(['SEED_OPEN', 'INTERMISSION', 'TRADING_OPEN', 'FROZEN'])(
    'rejects a new-team request in %s without writes',
    async (phase) => {
      const h = fixture(phase);
      const before = h.repository.dump();
      const { teamId: _teamId, ...newTeamRequest } = request;
      await expect(h.service.execute(newcomer, newTeamRequest)).rejects.toMatchObject({
        code: 'REGISTRATION_CLOSED',
      });
      expect(h.repository.dump()).toEqual(before);
    },
  );

  it.each<Phase>(['SEED_SETTLING', 'FINALIZING', 'FINALIZED', 'ARCHIVED', 'CANCELLED'])(
    'rejects new access requests during %s without writes',
    async (phase) => {
      const h = fixture(phase);
      const before = h.repository.dump();
      await expect(h.service.execute(newcomer, request)).rejects.toMatchObject({
        code: 'REGISTRATION_CLOSED',
      });
      expect(h.repository.dump()).toEqual(before);
    },
  );

  it('rejects requests while an operation remains active', async () => {
    const h = fixture('INTERMISSION', (documents) => {
      (documents[root] as EventConfig).activeOperationId = 'incomplete-operation';
    });
    await expect(h.service.execute(newcomer, request)).rejects.toMatchObject({
      code: 'REGISTRATION_CLOSED',
    });
    expect(h.repository.dump()[`${root}/members/${newcomer.uid}`]).toBeUndefined();
  });

  it.each(['withdrawn', 'disqualified'] as const)(
    'rejects joining a %s team even with its known ID',
    async (eligibility) => {
      const h = fixture('TRADING_OPEN', (documents) => {
        (documents[`${root}/teams/team-1`] as Team).eligibility = eligibility;
      });
      await expect(h.service.execute(newcomer, request)).rejects.toMatchObject({
        code: 'TEAM_INACTIVE',
      });
      expect(h.repository.dump()[`${root}/members/${newcomer.uid}`]).toBeUndefined();
    },
  );

  it('retains the participant cap when approving a late request', async () => {
    const h = fixture('TRADING_OPEN', (documents) => {
      (documents[root] as EventConfig).paused = true;
      const approvedCount = Object.entries(documents).filter(
        ([path, value]) =>
          path.startsWith(`${root}/members/`) &&
          (value as Member).status === 'approved' &&
          (value as Member).role !== 'organizer',
      ).length;
      for (let number = approvedCount; number < 150; number++) {
        documents[`${root}/members/extra-member-${number}`] = {
          uid: `extra-member-${number}`,
          displayName: `Member ${number}`,
          teamId: 'team-2',
          role: 'member',
          status: 'approved',
          version: 0,
        } satisfies Member;
      }
    });
    const before = finances(h.repository);
    await h.service.execute(newcomer, request);
    await expect(
      h.service.execute(DEMO_USERS.organizer, {
        type: 'approveMembership',
        commandId: 'late-member-over-cap',
        uid: newcomer.uid,
        role: 'member',
        teamId: 'team-1',
      }),
    ).rejects.toMatchObject({ code: 'MEMBER_LIMIT' });
    expect((await h.service.snapshot(newcomer.uid)).member?.status).toBe('pending');
    expect(finances(h.repository)).toEqual(before);
  });
});
