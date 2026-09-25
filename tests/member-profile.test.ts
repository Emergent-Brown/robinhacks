import { describe, expect, it } from 'vitest';
import type { Command, Member, Team } from '@robinhacks/core';
import { GameService } from '../packages/application/src/game-service';
import { parseCommand } from '../packages/application/src/command-schema';
import { MemoryRepository } from '../packages/application/src/memory-repository';
import {
  createPlatformDemoDocuments,
  DEMO_EVENT_ID,
  PLATFORM_USERS,
} from '../packages/application/src/platform-fixtures';

const root = `events/${DEMO_EVENT_ID}`;
const actor = PLATFORM_USERS.captain;
const path = `${root}/members/${actor.uid}`;
const command: Extract<Command, { type: 'updateProfile' }> = {
  type: 'updateProfile',
  commandId: 'save-my-member-bio',
  bio: '  I build accessible tools for campus.  ',
};

function fixture(preset: 'registration' | 'funding' = 'funding') {
  const repository = new MemoryRepository(createPlatformDemoDocuments(preset, 10_000_000));
  const service = new GameService(repository, DEMO_EVENT_ID, { now: () => 10_000_000 });
  return { repository, service };
}

describe('voluntary member biographies', () => {
  it('updates only the signed-in member and team copy, with replay-safe saves during funding', async () => {
    const h = fixture();
    const before = h.repository.dump();
    const previous = before[path] as Member;
    const result = await h.service.execute(actor, command);
    expect(result.message).toBe('Bio saved.');
    const after = h.repository.dump();
    const saved = after[path] as Member;
    expect(saved).toEqual({
      ...previous,
      bio: command.bio.trim(),
      version: previous.version + 1,
    });
    expect(after[`${root}/teams/${previous.teamId}/members/${actor.uid}`]).toEqual(saved);
    const changed = Object.keys(after).filter(
      (key) => JSON.stringify(after[key]) !== JSON.stringify(before[key]),
    );
    expect(changed.sort()).toEqual(
      [
        path,
        `${root}/teams/${previous.teamId}/members/${actor.uid}`,
        `${root}/commandReceipts/${actor.uid}__${command.commandId}`,
      ].sort(),
    );
    expect(await h.service.execute(actor, command)).toEqual(result);
    expect(h.repository.dump()).toEqual(after);
  });

  it('allows any approved teammate to edit their own bio', async () => {
    const h = fixture();
    const teammate = Object.entries(h.repository.dump()).find(
      ([key, value]) =>
        key.startsWith(`${root}/members/`) &&
        (value as Member).teamId === 'team-1' &&
        (value as Member).role === 'member',
    )![1] as Member;
    await h.service.execute({ uid: teammate.uid, emailVerified: true }, command);
    expect((await h.service.snapshot(teammate.uid)).member?.bio).toBe(command.bio.trim());
    expect((await h.service.snapshot(actor.uid)).member?.bio).toBeUndefined();
  });

  it.each(['pending', 'suspended'] as const)('rejects %s users without writes', async (status) => {
    const h = fixture();
    await h.repository.transaction(async (tx) => {
      const member = (await tx.get<Member>(path))!;
      tx.set(path, { ...member, status });
    });
    const before = h.repository.dump();
    await expect(h.service.execute(actor, command)).rejects.toMatchObject({
      code: 'MEMBERSHIP_REQUIRED',
    });
    expect(h.repository.dump()).toEqual(before);
  });

  it('rejects unknown members, overlong text, and attempts to choose another owner', async () => {
    const h = fixture();
    const before = h.repository.dump();
    await expect(h.service.execute({ uid: 'new-person' }, command)).rejects.toMatchObject({
      code: 'MEMBERSHIP_REQUIRED',
    });
    expect(() => parseCommand({ ...command, bio: 'a'.repeat(281) })).toThrow();
    expect(() => parseCommand({ ...command, uid: PLATFORM_USERS.organizer.uid })).toThrow();
    expect(h.repository.dump()).toEqual(before);
  });

  it('removes a bio from both stored copies and the visible roster when cleared', async () => {
    const h = fixture();
    await h.service.execute(actor, command);
    await h.service.execute(actor, { ...command, commandId: 'clear-my-member-bio', bio: ' \n ' });
    const stored = h.repository.dump()[path] as Member;
    expect(stored).not.toHaveProperty('bio');
    expect(
      h.repository.dump()[`${root}/teams/${stored.teamId}/members/${actor.uid}`],
    ).not.toHaveProperty('bio');
    expect(
      (await h.service.snapshot(actor.uid)).platform?.roster.find(
        (person) => person.uid === actor.uid,
      ),
    ).not.toHaveProperty('bio');
  });

  it('preserves the bio when an organizer changes a member role', async () => {
    const h = fixture('registration');
    const member = Object.entries(h.repository.dump()).find(
      ([key, value]) =>
        key.startsWith(`${root}/members/`) &&
        (value as Member).teamId === 'team-2' &&
        (value as Member).role === 'member',
    )![1] as Member;
    await h.service.execute({ uid: member.uid, emailVerified: true }, command);
    await h.service.execute(PLATFORM_USERS.organizer, {
      type: 'removeMember',
      commandId: 'remove-captain-for-bio',
      uid: 'demo-captain-2',
    });
    await h.service.execute(PLATFORM_USERS.organizer, {
      type: 'setMemberRole',
      commandId: 'promote-member-with-bio',
      uid: member.uid,
      role: 'captain',
      status: 'approved',
    });
    expect((await h.service.snapshot(member.uid)).member).toMatchObject({
      bio: command.bio.trim(),
      role: 'captain',
    });
  });

  it('shows only volunteered bios on approved rosters while keeping judges and public views private', async () => {
    const h = fixture();
    await h.service.execute(actor, command);
    await h.repository.transaction(async (tx) => {
      tx.set(`${root}/judgeAssignments/${PLATFORM_USERS.judge.uid}`, {
        uid: PLATFORM_USERS.judge.uid,
        projectIds: ['team-1'],
        conflictIds: [],
        version: 2,
      });
      tx.set(`${root}/members/pending-bio`, {
        uid: 'pending-bio',
        displayName: 'Not yet approved',
        teamId: 'team-1',
        role: 'member',
        status: 'pending',
        bio: 'Do not publish this bio.',
        version: 1,
      } satisfies Member);
    });
    const snapshot = await h.service.snapshot(actor.uid);
    const rosterEntry = snapshot.platform!.roster.find((person) => person.uid === actor.uid)!;
    expect(rosterEntry).toEqual({
      uid: actor.uid,
      name: snapshot.member!.displayName,
      teamId: 'team-1',
      role: 'captain',
      bio: command.bio.trim(),
    });
    expect(snapshot.platform!.roster.some((person) => person.uid === 'pending-bio')).toBe(false);
    expect(
      snapshot.platform!.roster.find((person) => person.teamId === 'team-2'),
    ).not.toHaveProperty('bio');
    const judge = await h.service.snapshot(PLATFORM_USERS.judge.uid);
    expect(judge.platform!.roster).toContainEqual(rosterEntry);
    expect(judge.platform!.roster.some((person) => person.teamId === 'team-2')).toBe(true);
    expect(judge.members).toEqual([]);
    expect(judge.platform!.allocation).toBeNull();
    expect(judge.platform!.entitlements).toEqual([]);
    expect(judge.platform!.rounds.every((round) => Object.keys(round.totals).length === 0)).toBe(
      true,
    );
    expect((await h.service.publicSnapshot()).platform!.roster).toEqual([]);
  });
});

describe('project sectors', () => {
  it('keeps demo sectors and lets a captain change their sector before funding', async () => {
    const h = fixture('registration');
    const teamPath = `${root}/teams/team-1`;
    const previous = h.repository.dump()[teamPath] as Team;
    expect(previous.category).not.toBe('');
    await h.service.execute(actor, {
      type: 'updateTeam',
      commandId: 'set-project-sector',
      expectedVersion: previous.version,
      patch: { category: 'Education' },
    });
    expect(h.repository.dump()[teamPath]).toMatchObject({
      category: 'Education',
      version: previous.version + 1,
    });
    await expect(
      h.service.execute(actor, {
        type: 'updateTeam',
        commandId: 'reject-legacy-progress-update',
        expectedVersion: previous.version + 1,
        patch: { update: 'This must use the checkpoint form.' },
      }),
    ).rejects.toMatchObject({ code: 'USE_CHECKPOINT_UPDATE' });
  });

  it('keeps sector edits frozen during an open funding round', async () => {
    const h = fixture();
    const team = h.repository.dump()[`${root}/teams/team-1`] as Team;
    await expect(
      h.service.execute(actor, {
        type: 'updateTeam',
        commandId: 'sector-during-funding',
        expectedVersion: team.version,
        patch: { category: 'Education' },
      }),
    ).rejects.toMatchObject({ code: 'ROUND_OPEN' });
  });
});
