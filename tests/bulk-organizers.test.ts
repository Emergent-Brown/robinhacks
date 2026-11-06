import { describe, expect, it } from 'vitest';
import type { Command, EventConfig, Member, Team } from '@robinhacks/core';
import { GameService, parseCommand } from '@robinhacks/application';
import { MemoryRepository } from '../packages/application/src/memory-repository';
import {
  createPlatformDemoDocuments,
  DEMO_EVENT_ID,
  PLATFORM_USERS,
} from '../packages/application/src/platform-fixtures';

const root = `events/${DEMO_EVENT_ID}`;
const owner = PLATFORM_USERS.organizer;
function fixture(preset: 'registration' | 'funding' = 'registration') {
  const repository = new MemoryRepository(createPlatformDemoDocuments(preset, 10_000_000));
  const service = new GameService(repository, DEMO_EVENT_ID, { now: () => 10_000_000 });
  const get = <T>(path: string) => repository.dump()[`${root}/${path}`] as T;
  const grant = (emails: string[], commandId = 'bulk-organizers-test') =>
    service.execute(owner, {
      type: 'addOrganizerEmails',
      commandId,
      emails,
    });
  return { repository, service, get, grant };
}

describe('bulk organizer access', () => {
  it('promotes verified team members immediately, clears the captain seat and approval request, and invites new emails', async () => {
    const h = fixture();
    const captain = h.get<Member>(`members/${PLATFORM_USERS.captain.uid}`);
    await h.repository.transaction(async (tx) => {
      tx.set(`${root}/accessRequests/${captain.uid}`, { uid: captain.uid, status: 'approved' });
    });
    const result = await h.grant([captain.email!, 'FUTURE@example.test', 'future@example.test']);
    expect(result.message).toContain('2 emails');
    expect(h.get<Member>(`members/${captain.uid}`)).toMatchObject({
      role: 'organizer',
      status: 'approved',
      teamId: null,
    });
    expect(h.get<Team>(`teams/${captain.teamId}`)?.captainUid).toBe('');
    expect(h.get(`teams/${captain.teamId}/members/${captain.uid}`)).toBeUndefined();
    expect(h.get(`accessRequests/${captain.uid}`)).toBeUndefined();
    const data = await h.service.snapshot(owner.uid);
    expect(data.organizerInvites).toHaveLength(2);
    expect(data.platform!.roster.some((person) => person.uid === captain.uid)).toBe(false);
    const version = h.get<Member>(`members/${captain.uid}`).version;
    await h.grant([captain.email!, 'FUTURE@example.test', 'future@example.test']);
    expect(h.get<Member>(`members/${captain.uid}`).version).toBe(version);
  });

  it('invites staff during funding but atomically rejects moving a competing member unless paused', async () => {
    const h = fixture('funding');
    await h.grant(['helper@example.test']);
    const captain = h.get<Member>(`members/${PLATFORM_USERS.captain.uid}`);
    const before = h.repository.dump();
    await expect(
      h.grant(['new@example.test', captain.email!], 'blocked-team-staff'),
    ).rejects.toMatchObject({ code: 'ROSTER_LOCKED' });
    expect(h.repository.dump()).toEqual(before);
    await h.repository.transaction(async (tx) => {
      const event = await tx.get<EventConfig>(root);
      tx.set(root, { ...event!, paused: true });
    });
    await h.grant([captain.email!], 'paused-team-staff');
    expect(h.get<Member>(`members/${captain.uid}`).role).toBe('organizer');
  });

  it('does not trust an unverified email and requires an organizer', async () => {
    const h = fixture();
    const person = h.get<Member>(`members/${PLATFORM_USERS.attendee.uid}`);
    await h.repository.transaction(async (tx) => {
      tx.set(`${root}/members/${person.uid}`, { ...person, emailVerified: false });
    });
    await h.grant([person.email!]);
    expect(h.get<Member>(`members/${person.uid}`).role).toBe(person.role);
    await expect(
      h.service.execute(PLATFORM_USERS.captain, {
        type: 'addOrganizerEmails',
        commandId: 'not-an-organizer',
        emails: ['helper@example.test'],
      }),
    ).rejects.toBeDefined();
    const unverified = await h.service.snapshot('new-account', {
      uid: 'new-account',
      email: person.email!,
      emailVerified: false,
    });
    expect(unverified.member).toBeNull();
  });

  it('requires a pause to promote a judge mid-event and preserves finalized judging identities', async () => {
    const h = fixture('funding');
    const judge = h.get<Member>(`members/${PLATFORM_USERS.judge.uid}`);
    await expect(h.grant([judge.email!], 'judge-unpaused')).rejects.toMatchObject({
      code: 'ROSTER_LOCKED',
    });
    await h.repository.transaction(async (tx) => {
      const event = await tx.get<EventConfig>(root);
      tx.set(root, { ...event!, paused: true });
    });
    await h.grant([judge.email!], 'judge-paused');
    expect(h.get<Member>(`members/${judge.uid}`).role).toBe('organizer');

    const finalized = fixture('funding');
    await finalized.repository.transaction(async (tx) => {
      const event = await tx.get<EventConfig>(root);
      tx.set(root, { ...event!, phase: 'FINALIZED', paused: true });
    });
    const before = finalized.repository.dump();
    await expect(finalized.grant([judge.email!], 'judge-finalized')).rejects.toMatchObject({
      code: 'ROSTER_LOCKED',
    });
    expect(finalized.repository.dump()).toEqual(before);
    // Additional staff access is still available without changing any judging evidence.
    await finalized.grant(['new-helper@example.test'], 'new-finalized-helper');
  });

  it('does not bypass the frozen judge boundary through a later verified-email invite claim', async () => {
    const h = fixture('funding');
    const judge = h.get<Member>(`members/${PLATFORM_USERS.judge.uid}`);
    await h.repository.transaction(async (tx) => {
      const event = await tx.get<EventConfig>(root);
      tx.set(root, { ...event!, phase: 'FINALIZED' });
      tx.set(`${root}/organizerInvites/${encodeURIComponent(judge.email!)}`, {
        email: judge.email!,
        createdAt: 10_000_000,
      });
    });
    await expect(
      h.service.snapshot(judge.uid, { uid: judge.uid, email: judge.email!, emailVerified: true }),
    ).rejects.toMatchObject({ code: 'ROSTER_LOCKED' });
    expect(h.get<Member>(`members/${judge.uid}`).role).toBe('judge');
  });

  it('validates the whole input before granting any access', () => {
    const input = { type: 'addOrganizerEmails', commandId: 'parse-organizers' };
    expect(parseCommand({ ...input, emails: ['  HELPER@EXAMPLE.TEST  '] })).toMatchObject({
      emails: ['helper@example.test'],
    });
    for (const emails of [
      [],
      ['valid@example.test', 'invalid'],
      Array.from({ length: 51 }, (_, i) => `p${i}@example.test`),
    ])
      expect(() => parseCommand({ ...input, emails } as Command)).toThrow();
  });
});
