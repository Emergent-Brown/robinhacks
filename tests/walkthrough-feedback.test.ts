import { describe, expect, it } from 'vitest';
import type { Command, EventConfig, Member } from '@robinhacks/core';
import { GameService } from '../packages/application/src/game-service';
import { MemoryRepository } from '../packages/application/src/memory-repository';
import {
  createPlatformDemoDocuments,
  DEMO_EVENT_ID,
  PLATFORM_USERS,
} from '../packages/application/src/platform-fixtures';
import { ReadQueue } from '../apps/web/src/app/read-queue';
const root = `events/${DEMO_EVENT_ID}`;
function fixture() {
  const repository = new MemoryRepository(createPlatformDemoDocuments('registration', 10_000_000));
  const service = new GameService(repository, DEMO_EVENT_ID, { now: () => 10_000_000 });
  const event = () => repository.dump()[root] as EventConfig;
  let sequence = 0;
  const run = (
    actor: { uid: string; email?: string; emailVerified?: boolean },
    command: Record<string, unknown>,
  ) => service.execute(actor, { ...command, commandId: `walkthrough-${++sequence}` } as Command);
  return { repository, service, event, run };
}
const applicant = (index: number) => ({
  uid: `signup-${index}`,
  email: `signup-${index}@example.test`,
  emailVerified: true,
});

describe('walkthrough feedback regression and load', () => {
  it('auto-approves only new verified participants and keeps judge requests pending', async () => {
    const h = fixture();
    await h.run(applicant(0), { type: 'requestMembership', displayName: 'Already waiting' });
    await h.run(PLATFORM_USERS.organizer, {
      type: 'setSignupPolicy',
      autoApprove: true,
      expectedPhaseVersion: h.event().phaseVersion,
    });
    await h.run(applicant(1), { type: 'requestMembership', displayName: 'New participant' });
    await h.run(applicant(2), {
      type: 'requestMembership',
      displayName: 'New judge',
      staffRole: 'judge',
    });
    expect((await h.service.snapshot(applicant(0).uid)).member?.status).toBe('pending');
    expect((await h.service.snapshot(applicant(1).uid)).member).toMatchObject({
      status: 'approved',
      role: 'member',
      teamId: null,
    });
    expect((await h.service.snapshot(applicant(2).uid)).member?.status).toBe('pending');
    await expect(
      h.run(
        { ...applicant(3), emailVerified: false },
        { type: 'requestMembership', displayName: 'Unverified' },
      ),
    ).rejects.toMatchObject({ code: 'EMAIL_VERIFICATION_REQUIRED' });
  });
  it('serializes 110 simultaneous signup attempts without exceeding 150 approved participants', async () => {
    const h = fixture();
    await h.run(PLATFORM_USERS.organizer, {
      type: 'setSignupPolicy',
      autoApprove: true,
      expectedPhaseVersion: h.event().phaseVersion,
    });
    const results = await Promise.allSettled(
      Array.from({ length: 110 }, (_, i) =>
        h.run(applicant(i), { type: 'requestMembership', displayName: `Participant ${i}` }),
      ),
    );
    const members = Object.entries(h.repository.dump())
      .filter(([path]) => new RegExp(`^${root}/members/[^/]+$`).test(path))
      .map(([, value]) => value as Member);
    expect(
      members.filter((m) => m.status === 'approved' && !['organizer', 'judge'].includes(m.role)),
    ).toHaveLength(150);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(101); // 49 existing participants
    expect(
      results
        .filter((r) => r.status === 'rejected')
        .every((r) => r.status === 'rejected' && r.reason.code === 'MEMBER_LIMIT'),
    ).toBe(true);
  });
  it('allows only three joins after a captain creates a team, including concurrent claims', async () => {
    const h = fixture();
    await h.run(PLATFORM_USERS.organizer, {
      type: 'setSignupPolicy',
      autoApprove: true,
      expectedPhaseVersion: h.event().phaseVersion,
    });
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        h.run(applicant(i), { type: 'requestMembership', displayName: `Participant ${i}` }),
      ),
    );
    await h.run(PLATFORM_USERS.organizer, {
      type: 'setTeamFormation',
      open: true,
      expectedPhaseVersion: h.event().phaseVersion,
    });
    await h.run(applicant(0), {
      type: 'createFormationTeam',
      name: 'Four Builders',
      role: 'captain',
    });
    const teamId = (await h.service.snapshot(applicant(0).uid)).member!.teamId!;
    const joins = await Promise.allSettled(
      Array.from({ length: 7 }, (_, i) =>
        h.run(applicant(i + 1), { type: 'joinFormationTeam', teamId, role: 'member' }),
      ),
    );
    expect(joins.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    const rejected = joins.findIndex((r) => r.status === 'rejected') + 1;
    await expect(
      h.run(PLATFORM_USERS.organizer, {
        type: 'adminAssignMember',
        uid: applicant(rejected).uid,
        teamId,
        role: 'member',
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'TEAM_FULL' });
    const directory = await h.service.snapshot(applicant(rejected).uid);
    expect(directory.formationTeams?.find((t) => t.id === teamId)?.availableRoles).toEqual([]);
  });
  it('allows members to edit projects but refuses their investments', async () => {
    const h = fixture();
    await h.run(PLATFORM_USERS.member, {
      type: 'updateTeam',
      expectedVersion: 0,
      patch: { pitch: 'A project updated by the team.' },
    });
    await h.run(PLATFORM_USERS.organizer, {
      type: 'openFundingRound',
      durationMinutes: 30,
      expectedPhaseVersion: h.event().phaseVersion,
    });
    await expect(
      h.run(PLATFORM_USERS.member, {
        type: 'saveAllocation',
        roundId: 'funding-1',
        expectedVersion: 0,
        amounts: { 'team-2': 10 },
      }),
    ).rejects.toMatchObject({ code: 'TRADER_REQUIRED' });
  });
  it('rejects repeated pitch order IDs and participant changes; persists organizer ordering', async () => {
    const h = fixture();
    await expect(
      h.run(PLATFORM_USERS.member, {
        type: 'setPitchOrder',
        projectIds: ['team-2', 'team-1'],
        expectedPhaseVersion: h.event().phaseVersion,
      }),
    ).rejects.toMatchObject({ code: 'ORGANIZER_REQUIRED' });
    await expect(
      h.run(PLATFORM_USERS.organizer, {
        type: 'setPitchOrder',
        projectIds: ['team-1', 'team-1'],
        expectedPhaseVersion: h.event().phaseVersion,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ORDER' });
    await h.run(PLATFORM_USERS.organizer, {
      type: 'setPitchOrder',
      projectIds: ['team-2', 'team-1'],
      expectedPhaseVersion: h.event().phaseVersion,
    });
    expect(h.event().platform!.pitchOrder).toEqual(['team-2', 'team-1']);
  });
});

describe('message read burst protection', () => {
  it('coalesces 150 simultaneous reads of one page into one server request', async () => {
    let count = 0;
    const queue = new ReadQueue(0);
    const read = async () => {
      count++;
      return { messages: ['hello'] };
    };
    const pages = await Promise.all(
      Array.from({ length: 150 }, () => queue.run('person:general', read)),
    );
    expect(count).toBe(1);
    expect(pages).toHaveLength(150);
  });
  it('paces navigation and honors the server cooldown after a 429', async () => {
    let now = 0;
    const queue = new ReadQueue(
      1500,
      () => now,
      async (ms) => {
        now += ms;
      },
    );
    await expect(
      queue.run('first', async () => {
        throw { code: 'RATE_LIMITED', retryAfterMs: 45000 };
      }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await queue.run('second', async () => expect(now).toBe(45000));
    await queue.run('third', async () => expect(now).toBe(46500));
  });
  it('does not coalesce different signed-in users or different history pages', async () => {
    let count = 0;
    const queue = new ReadQueue(0);
    await Promise.all(
      ['one:general', 'two:general', 'one:general:40'].map((key) =>
        queue.run(key, async () => count++),
      ),
    );
    expect(count).toBe(3);
  });
});
