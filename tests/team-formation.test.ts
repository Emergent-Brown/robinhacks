import { describe, expect, it } from 'vitest';
import type { Command, EventConfig, Member, Team } from '@robinhacks/core';
import { GameService } from '../packages/application/src/game-service';
import { parseCommand } from '../packages/application/src/command-schema';
import { MemoryRepository } from '../packages/application/src/memory-repository';
import {
  createPlatformDemoDocuments,
  DEMO_EVENT_ID,
  PLATFORM_USERS,
} from '../packages/application/src/platform-fixtures';

const root = `events/${DEMO_EVENT_ID}`;
const organizer = PLATFORM_USERS.organizer;
const applicant = {
  uid: 'new-person',
  displayName: 'Sam Lee',
  email: 'new-sam@example.test',
  emailVerified: true,
};
const attendee = PLATFORM_USERS.attendee;
function fixture(preset: 'registration' | 'funding' = 'registration') {
  const repository = new MemoryRepository(createPlatformDemoDocuments(preset, 10_000_000));
  let now = 10_000_000;
  const service = new GameService(repository, DEMO_EVENT_ID, { now: () => now });
  let id = 0;
  const execute = (
    actor: { uid: string; email?: string; emailVerified?: boolean; displayName?: string },
    command: Record<string, unknown>,
  ) => service.execute(actor, { commandId: `formation-command-${++id}`, ...command } as Command);
  const event = () => repository.dump()[root] as EventConfig;
  const open = () =>
    execute(organizer, {
      type: 'setTeamFormation',
      open: true,
      expectedPhaseVersion: event().phaseVersion,
    });
  const patch = (path: string, value: object) =>
    repository.transaction(async (tx) => {
      tx.set(path, { ...(await tx.get<object>(path)), ...value });
    });
  return {
    repository,
    service,
    execute,
    event,
    open,
    patch,
    setNow: (value: number) => {
      now = value;
    },
  };
}
function expectGated(snapshot: Awaited<ReturnType<GameService['snapshot']>>) {
  expect(snapshot.market.entries).toEqual([]);
  expect(snapshot.members).toEqual([]);
  expect(snapshot.requests).toHaveLength(0);
  expect(snapshot.organizerInvites).toBeUndefined();
  expect(snapshot.platform?.rounds).toEqual([]);
  expect(snapshot.platform?.roster).toEqual([]);
  expect(snapshot.platform?.conversations).toEqual([]);
  expect(snapshot.platform?.judgingSheets).toEqual([]);
  expect(snapshot.platform?.allocation).toBeNull();
}

describe('approval before organizer-controlled team formation', () => {
  it('accepts only name plus verified identity, and approval leaves a person unassigned', async () => {
    const h = fixture();
    const beforeTeams = Object.keys(h.repository.dump()).filter((path) =>
      path.startsWith(`${root}/teams/`),
    );
    await h.execute(applicant, { type: 'requestMembership', displayName: applicant.displayName });
    const pending = await h.service.snapshot(applicant.uid, applicant);
    expect(pending.member).toMatchObject({
      status: 'pending',
      teamId: null,
      role: 'member',
      email: applicant.email,
    });
    expect(pending.formationTeams).toBeUndefined();
    expect(pending).not.toHaveProperty('joinableTeams');
    await h.execute(organizer, { type: 'approveMembership', uid: applicant.uid });
    const approved = await h.service.snapshot(applicant.uid, applicant);
    expect(approved.member).toMatchObject({ status: 'approved', teamId: null, role: 'member' });
    expectGated(approved);
    expect(approved.formationTeams?.length).toBe(12);
    expect(
      Object.keys(h.repository.dump()).filter((path) => path.startsWith(`${root}/teams/`)),
    ).toEqual(beforeTeams);
    expect(
      approved.formationTeams?.[0].members.every(
        (person) => Object.keys(person).sort().join(',') === 'name,role',
      ),
    ).toBe(true);
    for (const extra of [
      { teamName: 'Smuggled team' },
      { teamId: 'team-1' },
      { staffRole: 'organizer' },
    ])
      expect(() =>
        parseCommand({
          type: 'requestMembership',
          commandId: 'invalid-signup-extra',
          displayName: 'Sam',
          ...extra,
        }),
      ).toThrow();
    expect(() =>
      parseCommand({
        type: 'approveMembership',
        commandId: 'invalid-approval-extra',
        uid: applicant.uid,
        teamId: 'team-1',
      }),
    ).toThrow();
  });

  it('gates unassigned approved users and refuses all formation until organizers open it', async () => {
    const h = fixture();
    expect(h.event().platform?.teamFormationOpen).toBe(false);
    expectGated(await h.service.snapshot(attendee.uid, attendee));
    await expect(
      h.execute(attendee, { type: 'createFormationTeam', name: 'New team', role: 'member' }),
    ).rejects.toMatchObject({ code: 'FORMATION_CLOSED' });
    await expect(
      h.execute(attendee, { type: 'saveBallot', rankedProjectIds: ['team-1'], expectedVersion: 0 }),
    ).rejects.toMatchObject({ code: 'TEAM_FORMATION_REQUIRED' });
    await expect(
      h.execute(attendee, {
        type: 'setTeamFormation',
        open: true,
        expectedPhaseVersion: h.event().phaseVersion,
      }),
    ).rejects.toMatchObject({ code: 'TEAM_FORMATION_REQUIRED' });
    await h.open();
    await expect(
      h.execute(organizer, { type: 'createFormationTeam', name: 'Staff team', role: 'captain' }),
    ).rejects.toMatchObject({ code: 'TEAM_ALREADY_ASSIGNED' });
    await expect(
      h.execute(
        { uid: 'missing-member', emailVerified: true },
        { type: 'joinFormationTeam', teamId: 'team-1', role: 'member' },
      ),
    ).rejects.toMatchObject({ code: 'MEMBERSHIP_REQUIRED' });
  });

  it.each(['captain', 'trader', 'member'] as const)(
    'lets a creator choose %s and opens the app only after joining',
    async (role) => {
      const h = fixture();
      await h.open();
      await h.execute(attendee, { type: 'createFormationTeam', name: 'Prism Assembly', role });
      const snapshot = await h.service.snapshot(attendee.uid, attendee);
      expect(snapshot.member).toMatchObject({ role, status: 'approved' });
      expect(snapshot.member?.teamId).toBeTruthy();
      const team = h.repository.dump()[`${root}/teams/${snapshot.member!.teamId}`] as Team;
      expect(team.captainUid).toBe(role === 'captain' ? attendee.uid : '');
      expect(snapshot.market.entries).toHaveLength(13);
      expect(snapshot.formationTeams).toBeUndefined();
      await expect(
        h.execute(attendee, { type: 'joinFormationTeam', teamId: 'team-1', role: 'member' }),
      ).rejects.toMatchObject({ code: 'TEAM_ALREADY_ASSIGNED' });
    },
  );

  it.each(['captain', 'trader'] as const)(
    'serializes competing claims for the %s slot and permits multiple ordinary members',
    async (exclusiveRole) => {
      const h = fixture();
      await h.open();
      await h.execute(attendee, {
        type: 'createFormationTeam',
        name: 'Prism Assembly',
        role: 'member',
      });
      const teamId = (await h.service.snapshot(attendee.uid)).member!.teamId!;
      const people = ['first', 'second', 'third', 'fourth'];
      for (const uid of people)
        await h.patch(`${root}/members/${uid}`, {
          uid,
          displayName: uid,
          email: `${uid}@example.test`,
          emailVerified: true,
          teamId: null,
          role: 'member',
          status: 'approved',
          version: 1,
        });
      const outcomes = await Promise.allSettled(
        people
          .slice(0, 2)
          .map((uid) =>
            h.execute(
              { uid, emailVerified: true },
              { type: 'joinFormationTeam', teamId, role: exclusiveRole },
            ),
          ),
      );
      expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);
      for (const uid of people.slice(2))
        await h.execute(
          { uid, emailVerified: true },
          { type: 'joinFormationTeam', teamId, role: 'member' },
        );
      const roster = Object.entries(h.repository.dump())
        .filter(
          ([path, row]) => path.startsWith(`${root}/members/`) && (row as Member).teamId === teamId,
        )
        .map(([, row]) => row as Member);
      expect(roster.filter((row) => row.role === exclusiveRole)).toHaveLength(1);
      expect(roster.filter((row) => row.role === 'member')).toHaveLength(3);
    },
  );

  it('rejects duplicate normalized names and competing joins after a close', async () => {
    const h = fixture();
    await h.open();
    await h.execute(attendee, {
      type: 'createFormationTeam',
      name: 'Orbit Builders',
      role: 'trader',
    });
    await h.patch(`${root}/members/${applicant.uid}`, {
      ...applicant,
      teamId: null,
      role: 'member',
      status: 'approved',
      version: 1,
    });
    await expect(
      h.execute(applicant, {
        type: 'createFormationTeam',
        name: 'orbit  builders',
        role: 'captain',
      }),
    ).rejects.toMatchObject({ code: 'TEAM_EXISTS' });
    await h.execute(organizer, {
      type: 'setTeamFormation',
      open: false,
      expectedPhaseVersion: h.event().phaseVersion,
    });
    await expect(
      h.execute(applicant, { type: 'joinFormationTeam', teamId: 'team-1', role: 'member' }),
    ).rejects.toMatchObject({ code: 'FORMATION_CLOSED' });
  });

  it('requires formation closed before funding and still requires every team to have a captain', async () => {
    const h = fixture();
    await h.open();
    await expect(
      h.execute(organizer, {
        type: 'openFundingRound',
        durationMinutes: 30,
        expectedPhaseVersion: h.event().phaseVersion,
      }),
    ).rejects.toMatchObject({ code: 'FORMATION_OPEN' });
    await h.execute(attendee, {
      type: 'createFormationTeam',
      name: 'No captain yet',
      role: 'member',
    });
    await h.execute(organizer, {
      type: 'setTeamFormation',
      open: false,
      expectedPhaseVersion: h.event().phaseVersion,
    });
    await expect(
      h.execute(organizer, {
        type: 'openFundingRound',
        durationMinutes: 30,
        expectedPhaseVersion: h.event().phaseVersion,
      }),
    ).rejects.toMatchObject({ code: 'TEAM_NOT_APPROVED' });
  });

  it('keeps the 30-team cap and 150-participant cap independent', async () => {
    const h = fixture();
    await h.open();
    const sample = h.repository.dump()[`${root}/teams/team-1`] as Team;
    for (let number = 13; number <= 30; number++)
      await h.patch(`${root}/teams/team-${number}`, {
        ...sample,
        id: `team-${number}`,
        name: `Additional team ${number}`,
      });
    await expect(
      h.execute(attendee, {
        type: 'createFormationTeam',
        name: 'Over team limit',
        role: 'captain',
      }),
    ).rejects.toMatchObject({ code: 'TEAM_LIMIT' });
    await h.execute(applicant, { type: 'requestMembership', displayName: applicant.displayName });
    const current = Object.entries(h.repository.dump()).filter(
      ([path, value]) =>
        path.startsWith(`${root}/members/`) &&
        (value as Member).status === 'approved' &&
        !['organizer', 'judge'].includes((value as Member).role),
    ).length;
    for (let number = current; number < 150; number++)
      await h.patch(`${root}/members/extra-${number}`, {
        uid: `extra-${number}`,
        displayName: 'Attendee',
        email: `extra-${number}@example.test`,
        emailVerified: true,
        status: 'approved',
        teamId: null,
        role: 'member',
        version: 1,
      });
    await expect(
      h.execute(organizer, { type: 'approveMembership', uid: applicant.uid }),
    ).rejects.toMatchObject({ code: 'MEMBER_LIMIT' });
    expect((await h.service.snapshot(applicant.uid)).member?.status).toBe('pending');
  });

  it('serializes a join against an organizer closing formation and makes retries idempotent', async () => {
    const h = fixture();
    await h.open();
    const closeVersion = h.event().phaseVersion;
    const outcomes = await Promise.allSettled([
      h.execute(organizer, {
        type: 'setTeamFormation',
        open: false,
        expectedPhaseVersion: closeVersion,
      }),
      h.execute(attendee, { type: 'joinFormationTeam', teamId: 'team-1', role: 'member' }),
    ]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await h.service.snapshot(attendee.uid)).member?.teamId).toBeNull();
    await h.open();
    const command = {
      type: 'joinFormationTeam',
      commandId: 'same-join-command',
      teamId: 'team-1',
      role: 'member',
    };
    await h.execute(attendee, command);
    const before = h.repository.dump();
    await h.execute(attendee, command);
    expect(h.repository.dump()).toEqual(before);
  });

  it('can suspend and restore an approved participant who has not chosen a team', async () => {
    const h = fixture();
    for (const status of ['suspended', 'approved'])
      await h.execute(organizer, {
        type: 'setMemberRole',
        uid: attendee.uid,
        role: 'member',
        status,
      });
    const restored = await h.service.snapshot(attendee.uid, attendee);
    expect(restored.member).toMatchObject({ status: 'approved', teamId: null, role: 'member' });
    expectGated(restored);
  });

  it('refuses signup approvals, formation and create/join once funding locks the roster', async () => {
    const h = fixture('funding');
    await expect(
      h.execute(applicant, { type: 'requestMembership', displayName: 'Sam' }),
    ).rejects.toMatchObject({ code: 'REGISTRATION_CLOSED' });
    await expect(
      h.execute(organizer, { type: 'approveMembership', uid: applicant.uid }),
    ).rejects.toMatchObject({ code: 'ROSTER_LOCKED' });
    await expect(h.open()).rejects.toMatchObject({ code: 'FORMATION_UNAVAILABLE' });
    await expect(
      h.execute(attendee, { type: 'createFormationTeam', name: 'Too late', role: 'captain' }),
    ).rejects.toMatchObject({ code: 'FORMATION_UNAVAILABLE' });
  });
});

describe('organizer invitations and access removal', () => {
  it('claims only an exact normalized verified email and exposes invitations only to organizers', async () => {
    const h = fixture();
    await h.execute(organizer, { type: 'addOrganizerEmail', email: '  New-Sam@Example.Test  ' });
    expect(
      (await h.service.snapshot(applicant.uid, { ...applicant, emailVerified: false })).member,
    ).toBeNull();
    expect(
      (
        await h.service.snapshot('wrong-email', {
          ...applicant,
          uid: 'wrong-email',
          email: 'new-sam+alias@example.test',
        })
      ).member,
    ).toBeNull();
    const claimed = await h.service.snapshot(applicant.uid, applicant);
    expect(claimed.member).toMatchObject({
      role: 'organizer',
      teamId: null,
      status: 'approved',
      email: applicant.email,
    });
    expect(claimed.organizerInvites).toEqual([{ email: applicant.email, createdAt: 10_000_000 }]);
    expect(claimed.event!.phaseVersion).toBe(h.event().phaseVersion);
    expect((await h.service.snapshot(attendee.uid, attendee)).organizerInvites).toBeUndefined();
    expect((await h.service.publicSnapshot()).organizerInvites).toBeUndefined();
  });

  it('rejects staff-team conflicts and organizer self-removal', async () => {
    const h = fixture();
    const captain = h.repository.dump()[`${root}/members/${PLATFORM_USERS.captain.uid}`] as Member;
    await expect(
      h.execute(organizer, { type: 'addOrganizerEmail', email: captain.email }),
    ).rejects.toMatchObject({ code: 'STAFF_CANNOT_COMPETE' });
    await expect(
      h.execute(organizer, { type: 'removeMember', uid: organizer.uid }),
    ).rejects.toMatchObject({ code: 'SELF_REMOVAL' });
    const owner = h.repository.dump()[`${root}/members/${organizer.uid}`] as Member;
    await expect(
      h.execute(organizer, { type: 'removeOrganizerEmail', email: owner.email }),
    ).rejects.toMatchObject({ code: 'SELF_REMOVAL' });
    await expect(
      h.execute(attendee, { type: 'addOrganizerEmail', email: applicant.email }),
    ).rejects.toMatchObject({ code: 'TEAM_FORMATION_REQUIRED' });
  });

  it('removes invitation and claimed membership together so refresh cannot reclaim access', async () => {
    const h = fixture();
    await h.execute(organizer, { type: 'addOrganizerEmail', email: applicant.email });
    await h.service.snapshot(applicant.uid, applicant);
    await h.execute(organizer, { type: 'removeOrganizerEmail', email: applicant.email });
    expect((await h.service.snapshot(applicant.uid, applicant)).member).toBeNull();
    expect((await h.service.snapshot(organizer.uid, organizer)).organizerInvites).toEqual([]);
  });

  it('removes pending requests, clears captain linkage, and preserves submitted/financial records', async () => {
    const h = fixture('funding');
    const captain = PLATFORM_USERS.captain;
    await expect(
      h.execute(organizer, { type: 'removeMember', uid: captain.uid }),
    ).rejects.toMatchObject({ code: 'ROSTER_LOCKED' });
    await h.patch(root, { paused: true });
    const before = h.repository.dump();
    await h.execute(organizer, { type: 'removeMember', uid: captain.uid });
    const after = h.repository.dump();
    expect(after[`${root}/members/${captain.uid}`]).toBeUndefined();
    expect(
      Object.entries(after)
        .filter(([path]) => path.startsWith(`${root}/removedMembers/`))
        .map(([, value]) => value),
    ).toEqual([
      expect.objectContaining({
        uid: captain.uid,
        teamId: 'team-1',
        role: 'captain',
        removedAt: 10_000_000,
      }),
    ]);
    expect(after[`${root}/teams/team-1/members/${captain.uid}`]).toBeUndefined();
    expect(after[`${root}/teams/team-1`]).toMatchObject({ captainUid: '' });
    for (const [path, value] of Object.entries(before).filter(([path]) =>
      /\/(fundingRounds|roundAllocations|roundEntitlements|submissions|judgingSheets)\//.test(path),
    ))
      expect(after[path]).toEqual(value);
    expect((await h.service.snapshot(captain.uid, captain)).member).toBeNull();
    const registration = fixture();
    await registration.execute(applicant, { type: 'requestMembership', displayName: 'Sam' });
    await registration.execute(organizer, { type: 'removeMember', uid: applicant.uid });
    expect(
      registration.repository.dump()[`${root}/accessRequests/${applicant.uid}`],
    ).toBeUndefined();
  });

  it('preserves competing history when a removed captain returns as staff and is removed again', async () => {
    const h = fixture('funding');
    const captain = PLATFORM_USERS.captain;
    const identity = h.repository.dump()[`${root}/members/${captain.uid}`] as Member;
    await h.patch(root, { paused: true });
    await h.execute(organizer, { type: 'removeMember', uid: captain.uid });
    await h.execute(organizer, { type: 'addOrganizerEmail', email: identity.email });
    const actor = { ...captain, email: identity.email, emailVerified: true };
    expect((await h.service.snapshot(captain.uid, actor)).member?.role).toBe('organizer');
    h.setNow(10_000_100);
    const removal = {
      type: 'removeOrganizerEmail' as const,
      email: identity.email!,
      commandId: 'repeat-staff-removal',
    };
    await h.service.execute(organizer, removal);
    await h.service.execute(organizer, removal);
    const history = Object.entries(h.repository.dump())
      .filter(([path]) => path.startsWith(`${root}/removedMembers/`))
      .map(([, value]) => value);
    expect(history).toHaveLength(2);
    expect(history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          uid: captain.uid,
          teamId: 'team-1',
          role: 'captain',
          removedAt: 10_000_000,
        }),
        expect.objectContaining({
          uid: captain.uid,
          teamId: null,
          role: 'organizer',
          removedAt: 10_000_100,
        }),
      ]),
    );
    expect((await h.service.snapshot(captain.uid, actor)).member).toBeNull();
    expect((await h.service.snapshot(organizer.uid, organizer)).members).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ uid: captain.uid })]),
    );
  });

  it('blocks snapshots, invite claims and all writes during reset maintenance', async () => {
    const h = fixture();
    await h.execute(organizer, { type: 'addOrganizerEmail', email: applicant.email });
    await h.patch(root, { maintenance: true });
    const before = h.repository.dump();
    await expect(h.service.snapshot(applicant.uid, applicant)).rejects.toMatchObject({
      code: 'MAINTENANCE',
    });
    await expect(
      h.execute(organizer, { type: 'removeMember', uid: attendee.uid }),
    ).rejects.toMatchObject({ code: 'MAINTENANCE' });
    expect(h.repository.dump()).toEqual(before);
    expect((await h.service.publicSnapshot()).event?.maintenance).toBe(true);
  });
});

describe('organizer recovery of vacant team roles', () => {
  it.each(['member', 'trader'] as const)(
    'replaces a removed captain with an existing %s and permits the next funding round',
    async (priorRole) => {
      const h = fixture();
      const replacement = PLATFORM_USERS.member;
      if (priorRole === 'trader')
        await h.execute(organizer, {
          type: 'setMemberRole',
          uid: replacement.uid,
          role: 'trader',
          status: 'approved',
        });
      await h.execute(organizer, {
        type: 'openFundingRound',
        durationMinutes: 30,
        expectedPhaseVersion: h.event().phaseVersion,
      });
      await h.execute(organizer, {
        type: 'setPause',
        paused: true,
        reason: 'Replace the departed captain',
        expectedPhaseVersion: h.event().phaseVersion,
      });
      await h.execute(organizer, { type: 'removeMember', uid: PLATFORM_USERS.captain.uid });
      await h.execute(organizer, {
        type: 'setMemberRole',
        uid: replacement.uid,
        role: 'captain',
        status: 'approved',
      });
      const promoted = await h.service.snapshot(replacement.uid, replacement);
      expect(promoted.member).toMatchObject({
        teamId: 'team-1',
        role: 'captain',
        status: 'approved',
      });
      expect(h.repository.dump()[`${root}/teams/team-1`]).toMatchObject({
        captainUid: replacement.uid,
      });
      await h.execute(organizer, {
        type: 'setPause',
        paused: false,
        reason: '',
        expectedPhaseVersion: h.event().phaseVersion,
      });
      await h.execute(replacement, {
        type: 'saveAllocation',
        roundId: 'funding-1',
        amounts: { 'team-2': 60 },
        expectedVersion: 0,
      });
      h.setNow(11_800_000);
      await h.execute(organizer, {
        type: 'closeFundingRound',
        roundId: 'funding-1',
        expectedPhaseVersion: h.event().phaseVersion,
      });
      const closed = h.repository.dump()[`${root}/fundingRounds/funding-1`];
      const teams = Object.entries(h.repository.dump())
        .filter(([path]) => /^events\/[^/]+\/teams\/[^/]+$/.test(path))
        .map(([, value]) => value as Team);
      for (const team of teams)
        await h.execute(
          { uid: team.captainUid, emailVerified: true },
          {
            type: 'publishUpdate',
            round: 2,
            works: 'Working prototype',
            changed: 'Added the main interaction',
            incomplete: 'Testing remains',
            evidenceUrl: '',
          },
        );
      await h.execute(organizer, {
        type: 'openFundingRound',
        durationMinutes: 30,
        expectedPhaseVersion: h.event().phaseVersion,
      });
      expect(h.event().platform?.currentRound).toBe(2);
      expect(h.repository.dump()[`${root}/fundingRounds/funding-1`]).toEqual(closed);
    },
  );

  it('requires pause, forbids occupied-role swaps and demotions, and closes recovery after finalization', async () => {
    const h = fixture('funding');
    const command = {
      type: 'setMemberRole',
      uid: PLATFORM_USERS.member.uid,
      role: 'trader',
      status: 'approved',
    };
    await expect(h.execute(organizer, command)).rejects.toMatchObject({ code: 'ROSTER_LOCKED' });
    await h.patch(root, { paused: true });
    await h.execute(organizer, command);
    await expect(h.execute(organizer, { ...command, role: 'member' })).rejects.toMatchObject({
      code: 'ROSTER_LOCKED',
    });
    await expect(h.execute(organizer, { ...command, role: 'captain' })).rejects.toMatchObject({
      code: 'ROSTER_LOCKED',
    });
    await expect(
      h.execute(PLATFORM_USERS.captain, { ...command, role: 'member' }),
    ).rejects.toMatchObject({ code: 'ROSTER_LOCKED' });
    await h.execute(organizer, {
      type: 'setMemberRole',
      uid: PLATFORM_USERS.captain.uid,
      role: 'captain',
      status: 'suspended',
    });
    await h.patch(root, { phase: 'FINALIZED' });
    await expect(h.execute(organizer, { ...command, role: 'captain' })).rejects.toMatchObject({
      code: 'ROSTER_LOCKED',
    });
    expect(
      (h.repository.dump()[`${root}/members/${PLATFORM_USERS.member.uid}`] as Member).role,
    ).toBe('trader');
  });
});
