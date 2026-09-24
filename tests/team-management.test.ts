import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import type {
  Command,
  EventConfig,
  JudgingSheet,
  Member,
  ProjectSubmission,
  Team,
} from '@robinhacks/core';
import { GameService } from '../packages/application/src/game-service';
import { MemoryRepository } from '../packages/application/src/memory-repository';
import {
  createPlatformDemoDocuments,
  DEMO_EVENT_ID,
  PLATFORM_USERS,
  type DemoPreset,
} from '../packages/application/src/platform-fixtures';
import { parseCommand } from '../packages/application/src/command-schema';

const root = `events/${DEMO_EVENT_ID}`;
const NOW = 10_000_000;
const organizer = PLATFORM_USERS.organizer;
const captain = PLATFORM_USERS.captain;
const teammate = PLATFORM_USERS.member;
const attendee = PLATFORM_USERS.attendee;
function fixture(preset: DemoPreset = 'registration') {
  const repository = new MemoryRepository(createPlatformDemoDocuments(preset, NOW));
  const service = new GameService(repository, DEMO_EVENT_ID, { now: () => NOW });
  let sequence = 0;
  const execute = (command: Record<string, unknown>, actor = organizer) =>
    service.execute(actor, { commandId: `team-management-${++sequence}`, ...command } as Command);
  const get = <T>(path: string) => repository.dump()[`${root}/${path}`] as T;
  const event = () => repository.dump()[root] as EventConfig;
  const patch = (path: string, changes: object) =>
    repository.transaction(async (tx) =>
      tx.set(path, { ...(await tx.get<object>(path)), ...changes }),
    );
  const rows = (collection: string) =>
    Object.entries(repository.dump())
      .filter(
        ([path]) =>
          path.startsWith(`${root}/${collection}/`) &&
          !path.slice(`${root}/${collection}/`.length).includes('/'),
      )
      .map(([, value]) => value);
  return { repository, service, execute, get, event, patch, rows };
}

describe('organizer team and person management', () => {
  it('requires an approved separate organizer account for every management command', async () => {
    const h = fixture();
    for (const command of [
      { type: 'adminCreateTeam', name: 'Project Atlas' },
      {
        type: 'adminUpdateTeam',
        teamId: 'team-1',
        expectedVersion: 0,
        patch: { name: 'Changed name' },
      },
      {
        type: 'adminAssignMember',
        uid: attendee.uid,
        teamId: 'team-1',
        role: 'member',
        expectedVersion: 0,
      },
      {
        type: 'adminUpdateMember',
        uid: captain.uid,
        displayName: 'Changed name',
        bio: '',
        expectedVersion: 0,
      },
      { type: 'adminDeleteTeam', teamId: 'team-1', expectedVersion: 0, reason: 'Duplicate team' },
      {
        type: 'adminReopenSubmission',
        teamId: 'team-1',
        expectedVersion: 0,
        reason: 'Wrong evidence',
      },
      {
        type: 'adminUpdateSubmission',
        teamId: 'team-1',
        expectedVersion: 0,
        reason: 'Wrong evidence',
        patch: { pitch: 'Updated evidence' },
      },
    ])
      await expect(h.execute(command, captain)).rejects.toMatchObject({
        code: 'ORGANIZER_REQUIRED',
      });
    await h.patch(`${root}/members/${organizer.uid}`, { status: 'suspended' });
    await expect(
      h.execute({ type: 'adminCreateTeam', name: 'Project Atlas' }),
    ).rejects.toMatchObject({ code: 'MEMBERSHIP_REQUIRED' });
  });

  it('creates teams before funding and rejects normalized duplicate names and later entrants', async () => {
    const h = fixture();
    await h.execute({ type: 'adminCreateTeam', name: 'Project Atlas' });
    const created = (h.rows('teams') as Team[]).find((team) => team.name === 'Project Atlas')!;
    expect(created).toMatchObject({ captainUid: '', eligibility: 'active', version: 1 });
    await expect(
      h.execute({ type: 'adminCreateTeam', name: 'ＰＲＯＪＥＣＴ  atlas' }),
    ).rejects.toMatchObject({ code: 'TEAM_EXISTS' });
    const started = fixture('funding');
    await started.patch(root, { paused: true });
    await expect(
      started.execute({ type: 'adminCreateTeam', name: 'Late entrant' }),
    ).rejects.toMatchObject({ code: 'ROSTER_LOCKED' });
  });

  it('assigns unassigned people without opening self-service formation and preserves status constraints', async () => {
    const h = fixture();
    await h.execute({
      type: 'adminAssignMember',
      uid: attendee.uid,
      teamId: 'team-1',
      role: 'trader',
      expectedVersion: 0,
    });
    expect(h.get<Member>(`members/${attendee.uid}`)).toMatchObject({
      teamId: 'team-1',
      role: 'trader',
      status: 'approved',
      version: 1,
    });
    expect(h.get<Member>(`teams/team-1/members/${attendee.uid}`)).toEqual(
      h.get(`members/${attendee.uid}`),
    );
    await expect(
      h.execute({
        type: 'adminAssignMember',
        uid: organizer.uid,
        teamId: 'team-1',
        role: 'member',
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({ code: 'STAFF_CANNOT_COMPETE' });
    await h.patch(`${root}/members/${teammate.uid}`, { status: 'suspended' });
    await expect(
      h.execute({
        type: 'adminAssignMember',
        uid: teammate.uid,
        teamId: 'team-2',
        role: 'member',
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({ code: 'MEMBERSHIP_REQUIRED' });
    await h.patch(`${root}/members/${teammate.uid}`, { status: 'pending' });
    await expect(
      h.execute({
        type: 'adminAssignMember',
        uid: teammate.uid,
        teamId: 'team-2',
        role: 'member',
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({ code: 'MEMBERSHIP_REQUIRED' });
  });

  it('serializes competing role assignments and rejects stale versions', async () => {
    const h = fixture();
    const results = await Promise.allSettled([
      h.execute({
        type: 'adminAssignMember',
        uid: attendee.uid,
        teamId: 'team-1',
        role: 'trader',
        expectedVersion: 0,
      }),
      h.execute({
        type: 'adminAssignMember',
        uid: teammate.uid,
        teamId: 'team-1',
        role: 'trader',
        expectedVersion: 0,
      }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'ROLE_LIMIT' },
    });
    await expect(
      h.execute({
        type: 'adminAssignMember',
        uid: attendee.uid,
        teamId: 'team-2',
        role: 'member',
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({ code: 'MEMBER_CHANGED' });
  });

  it('moves and changes roles while paused without changing funding records, retaining former authors', async () => {
    const h = fixture('judging');
    // Demo timestamps are illustrative; reconciliation needs rules frozen before every round.
    await h.patch(root, { platform: { ...h.event().platform, rulesLockedAt: NOW - 7_200_000 } });
    const fundingBefore = {
      rounds: h.rows('fundingRounds'),
      allocations: h.rows('roundAllocations'),
      entitlements: h.rows('roundEntitlements'),
    };
    await expect(
      h.execute({
        type: 'adminAssignMember',
        uid: captain.uid,
        teamId: 'team-2',
        role: 'member',
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({ code: 'PAUSE_REQUIRED' });
    await h.patch(root, { paused: true });
    await h.execute({
      type: 'adminAssignMember',
      uid: captain.uid,
      teamId: 'team-2',
      role: 'member',
      expectedVersion: 0,
    });
    expect(h.get<Team>('teams/team-1').captainUid).toBe('');
    expect(h.get(`teams/team-1/members/${captain.uid}`)).toBeUndefined();
    expect(h.get<Member>(`teams/team-2/members/${captain.uid}`)).toMatchObject({
      teamId: 'team-2',
      role: 'member',
    });
    expect(h.rows('removedMembers')).toEqual([
      expect.objectContaining({
        uid: captain.uid,
        teamId: 'team-1',
        role: 'captain',
        removedAt: NOW,
      }),
    ]);
    await h.execute({
      type: 'adminAssignMember',
      uid: teammate.uid,
      teamId: 'team-1',
      role: 'captain',
      expectedVersion: 0,
    });
    expect(h.get<Team>('teams/team-1').captainUid).toBe(teammate.uid);
    expect({
      rounds: h.rows('fundingRounds'),
      allocations: h.rows('roundAllocations'),
      entitlements: h.rows('roundEntitlements'),
    }).toEqual(fundingBefore);
    await h.patch(root, { phase: 'CANCELLED' });
    const exported = await h.service.exportEvent(organizer.uid);
    const runner = `import {reconcileSealedExport} from './scripts/reconcile-sealed-export.mjs'; let input=''; for await(const part of process.stdin) input+=part; process.stdout.write(JSON.stringify(reconcileSealedExport(JSON.parse(input))));`;
    const result = JSON.parse(
      execFileSync(process.execPath, ['--input-type=module', '-e', runner], {
        input: JSON.stringify(exported),
        encoding: 'utf8',
      }),
    );
    expect(result).toMatchObject({ valid: true, errors: [] });
  });

  it('permits paused demotion then transfer of filled roles but rejects occupied slots and excess attendees', async () => {
    const h = fixture('funding');
    await h.patch(root, { paused: true });
    await expect(
      h.execute({
        type: 'adminAssignMember',
        uid: teammate.uid,
        teamId: 'team-1',
        role: 'captain',
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({ code: 'ROLE_LIMIT' });
    await h.execute({
      type: 'adminAssignMember',
      uid: captain.uid,
      teamId: 'team-1',
      role: 'member',
      expectedVersion: 0,
    });
    await h.execute({
      type: 'adminAssignMember',
      uid: teammate.uid,
      teamId: 'team-1',
      role: 'captain',
      expectedVersion: 0,
    });
    expect(h.get<Team>('teams/team-1').captainUid).toBe(teammate.uid);
    const docs = h.repository.dump();
    for (let i = 0; i < 151; i++)
      docs[`${root}/members/extra-${i}`] = {
        ...h.get<Member>(`members/${attendee.uid}`),
        uid: `extra-${i}`,
      };
    h.repository.replace(docs);
    await expect(
      h.execute({
        type: 'adminAssignMember',
        uid: attendee.uid,
        teamId: 'team-1',
        role: 'member',
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({ code: 'MEMBER_LIMIT' });
  });

  it('updates names and bios without changing Google identity or access', async () => {
    const h = fixture();
    const before = h.get<Member>(`members/${teammate.uid}`);
    await h.execute({
      type: 'adminUpdateMember',
      uid: teammate.uid,
      expectedVersion: 0,
      displayName: 'Sam R.',
      bio: 'Hardware and embedded systems.',
    });
    expect(h.get<Member>(`members/${teammate.uid}`)).toEqual({
      ...before,
      displayName: 'Sam R.',
      bio: 'Hardware and embedded systems.',
      version: 1,
    });
    expect(h.get(`teams/team-1/members/${teammate.uid}`)).toEqual(h.get(`members/${teammate.uid}`));
    await expect(
      h.execute({
        type: 'adminUpdateMember',
        uid: teammate.uid,
        expectedVersion: 0,
        displayName: 'Sam R.',
        bio: '',
      }),
    ).rejects.toMatchObject({ code: 'MEMBER_CHANGED' });
    expect(() =>
      parseCommand({
        type: 'adminUpdateMember',
        commandId: 'invalid-change',
        uid: teammate.uid,
        expectedVersion: 1,
        displayName: 'Sam R.',
        bio: '',
        email: 'other@example.test',
      }),
    ).toThrow();
  });

  it('edits all profile fields independently from frozen evidence with optimistic concurrency', async () => {
    const h = fixture('judging');
    await h.patch(root, { paused: true });
    const submission = h.get<ProjectSubmission>('submissions/team-1');
    const patch = {
      name: 'Project Atlas',
      ticker: 'ATLAS',
      pitch: 'A clearer pitch.',
      category: 'Climate',
      color: '#abcdef',
      problem: 'A specific problem.',
      building: 'What we built.',
      demoUrl: 'https://example.test/demo',
      repoUrl: 'https://example.test/repo',
      update: 'Organizer correction.',
    };
    await h.execute({ type: 'adminUpdateTeam', teamId: 'team-1', expectedVersion: 0, patch });
    expect(h.get<Team>('teams/team-1')).toMatchObject({ ...patch, version: 1 });
    expect(h.get('submissions/team-1')).toEqual(submission);
    await expect(
      h.execute({
        type: 'adminUpdateTeam',
        teamId: 'team-1',
        expectedVersion: 0,
        patch: { name: 'Stale edit' },
      }),
    ).rejects.toMatchObject({ code: 'TEAM_CHANGED' });
    await expect(
      h.execute({
        type: 'adminUpdateTeam',
        teamId: 'team-1',
        expectedVersion: 1,
        patch: { repoUrl: 'https://user:password@example.test' },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_URL' });
    expect(() =>
      parseCommand({
        type: 'adminUpdateTeam',
        commandId: 'invalid-change',
        teamId: 'team-1',
        expectedVersion: 1,
        patch: { captainUid: captain.uid },
      }),
    ).toThrow();
  });

  it('deletes registration projects and relationships while preserving people, conversations and audit', async () => {
    const h = fixture();
    const docs = h.repository.dump();
    const conversation = {
      id: 'old-conversation',
      teamIds: ['team-1', 'team-2'],
      messages: [{ body: 'Original history' }],
    };
    docs[`${root}/conversations/old-conversation`] = conversation;
    docs[`${root}/conversationDirectory/old-conversation`] = {
      id: 'old-conversation',
      teamIds: ['team-1', 'team-2'],
    };
    docs[`${root}/teamInboxes/team-1`] = {
      teamId: 'team-1',
      conversations: [{ id: 'old-conversation', otherTeamId: 'team-2' }],
    };
    docs[`${root}/teamInboxes/team-2`] = {
      teamId: 'team-2',
      conversations: [
        { id: 'old-conversation', otherTeamId: 'team-1' },
        { id: 'other', otherTeamId: 'team-3' },
      ],
    };
    docs[`${root}/submissions/team-1`] = { teamId: 'team-1' };
    docs[`${root}/members/${teammate.uid}`] = {
      ...(docs[`${root}/members/${teammate.uid}`] as Member),
      status: 'suspended',
    };
    h.repository.replace(docs);
    await h.execute({
      type: 'adminDeleteTeam',
      teamId: 'team-1',
      expectedVersion: 0,
      reason: 'A duplicate registration',
    });
    expect(h.get('teams/team-1')).toBeUndefined();
    expect(h.get('submissions/team-1')).toBeUndefined();
    expect(h.get('projectUpdates/checkpoint-1-team-1')).toBeUndefined();
    expect(h.get(`teams/team-1/members/${captain.uid}`)).toBeUndefined();
    expect(h.get<Member>(`members/${captain.uid}`)).toMatchObject({
      teamId: null,
      role: 'member',
      status: 'approved',
    });
    expect(h.get<Member>(`members/${teammate.uid}`)).toMatchObject({
      teamId: null,
      role: 'member',
      status: 'suspended',
    });
    expect(h.get('conversations/old-conversation')).toEqual(conversation);
    expect(h.get('conversationDirectory/old-conversation')).toBeDefined();
    expect(h.get('teamInboxes/team-1')).toBeUndefined();
    expect(h.get('teamInboxes/team-2')).toMatchObject({
      conversations: [{ id: 'other', otherTeamId: 'team-3' }],
    });
    expect(h.get<{ projectIds: string[] }>('judgeAssignments/demo-judge').projectIds).not.toContain(
      'team-1',
    );
    expect(h.rows('teamManagementAudit')).toEqual([
      expect.objectContaining({
        action: 'adminDeleteTeam',
        after: null,
        reason: 'A duplicate registration',
      }),
    ]);
    expect((await h.service.snapshot(captain.uid, captain)).market.entries).toEqual([]);
  });

  it('serializes team deletion against a participant assignment without dangling membership', async () => {
    const h = fixture();
    const results = await Promise.allSettled([
      h.execute({
        type: 'adminDeleteTeam',
        teamId: 'team-1',
        expectedVersion: 0,
        reason: 'Duplicate team registration',
      }),
      h.execute({
        type: 'adminAssignMember',
        uid: attendee.uid,
        teamId: 'team-1',
        role: 'member',
        expectedVersion: 0,
      }),
    ]);
    expect(results[0].status).toBe('fulfilled');
    expect(results[1]).toMatchObject({ status: 'rejected', reason: { code: 'TEAM_INACTIVE' } });
    expect(h.get<Member>(`members/${attendee.uid}`).teamId).toBeNull();
  });

  it('withdraws instead of deleting after funding, and cannot bypass open-round or disqualification safeguards', async () => {
    const active = fixture('funding');
    await active.patch(root, { paused: true });
    await expect(
      active.execute({
        type: 'adminDeleteTeam',
        teamId: 'team-1',
        expectedVersion: 0,
        reason: 'The team has left',
      }),
    ).rejects.toMatchObject({ code: 'ROUND_OPEN' });
    const h = fixture('judging');
    await h.patch(root, { paused: true });
    const before = h.repository.dump();
    await h.execute({
      type: 'adminDeleteTeam',
      teamId: 'team-1',
      expectedVersion: 0,
      reason: 'The team has left',
    });
    expect(h.get<Team>('teams/team-1').eligibility).toBe('withdrawn');
    for (const [path, value] of Object.entries(before).filter(([path]) =>
      /\/(roundAllocations|roundEntitlements|fundingRounds|submissions|members)\//.test(path),
    ))
      expect(h.repository.dump()[path]).toEqual(value);
    await h.patch(`${root}/teams/team-2`, { eligibility: 'disqualified' });
    await expect(
      h.execute({
        type: 'adminDeleteTeam',
        teamId: 'team-2',
        expectedVersion: 0,
        reason: 'Try to change status',
      }),
    ).rejects.toMatchObject({ code: 'TEAM_DISQUALIFIED' });
  });

  it('refuses all management changes during published results, preview and active operations', async () => {
    const h = fixture('judging');
    for (const [changes, code] of [
      [{ phase: 'FINALIZING', paused: true }, 'AWARDS_PREVIEW_EXISTS'],
      [{ phase: 'FINALIZED', paused: true }, 'EVENT_READ_ONLY'],
      [{ phase: 'FROZEN', paused: true, activeOperationId: 'operation' }, 'OPERATION_RUNNING'],
    ] as const) {
      await h.patch(root, changes);
      await expect(
        h.execute({
          type: 'adminUpdateTeam',
          teamId: 'team-1',
          expectedVersion: 0,
          patch: { name: 'Forbidden update' },
        }),
      ).rejects.toMatchObject({ code });
    }
  });
});

describe('audited final evidence corrections', () => {
  it('archives corrected evidence, clears only the affected judging entry, and preserves economic records', async () => {
    const h = fixture('judging');
    const prior = h.get<ProjectSubmission>('submissions/team-1');
    const scores = {
      scores: { functionality: 4, usefulness: 4, originality: 3, execution: 5 },
      note: 'Before correction',
      conflict: false,
    };
    await h.patch(`${root}/judgingSheets/${PLATFORM_USERS.judge.uid}`, {
      uid: PLATFORM_USERS.judge.uid,
      entries: { 'team-1': scores, 'team-2': scores },
      version: 7,
      updatedAt: NOW - 100,
      submittedAt: NOW - 10,
    });
    const command = {
      type: 'adminUpdateSubmission',
      teamId: 'team-1',
      expectedVersion: 0,
      reason: 'The demo link was incorrect',
      patch: { demoUrl: 'https://example.test/correct-demo' },
    };
    await expect(h.execute(command)).rejects.toMatchObject({ code: 'PAUSE_REQUIRED' });
    await h.patch(root, { paused: true });
    const allocations = h.rows('roundAllocations');
    await h.execute(command);
    expect(h.get<ProjectSubmission>('submissions/team-1')).toEqual({
      ...prior,
      demoUrl: 'https://example.test/correct-demo',
    });
    expect(h.get<JudgingSheet>(`judgingSheets/${PLATFORM_USERS.judge.uid}`)).toMatchObject({
      entries: { 'team-2': scores },
      version: 8,
      submittedAt: null,
    });
    expect(
      h.get<JudgingSheet>(`judgingSheets/${PLATFORM_USERS.judge.uid}`).entries['team-1'],
    ).toBeUndefined();
    expect(h.rows('submissionCorrections')).toEqual([
      expect.objectContaining({
        before: prior,
        reason: 'The demo link was incorrect',
        judgingEntries: [
          expect.objectContaining({
            uid: PLATFORM_USERS.judge.uid,
            entry: scores,
            version: 7,
            submittedAt: NOW - 10,
          }),
        ],
      }),
    ]);
    expect(h.rows('roundAllocations')).toEqual(allocations);
    await expect(h.execute(command)).rejects.toMatchObject({ code: 'TEAM_CHANGED' });
    await expect(
      h.execute({
        type: 'adminReopenSubmission',
        teamId: 'team-1',
        expectedVersion: 1,
        reason: 'Reopen old final evidence',
      }),
    ).rejects.toMatchObject({ code: 'SUBMISSIONS_LOCKED' });
  });

  it('keeps correction archives bounded for 50 judges with full sheets', async () => {
    const h = fixture('judging');
    const docs = h.repository.dump();
    for (let i = 0; i < 50; i++)
      docs[`${root}/judgingSheets/judge-${i}`] = {
        uid: `judge-${i}`,
        entries: Object.fromEntries(
          Array.from({ length: 30 }, (_, j) => [
            `team-${j + 1}`,
            { scores: {}, conflict: false, note: 'x'.repeat(1500) },
          ]),
        ),
        version: 1,
        updatedAt: NOW - 10,
        submittedAt: NOW - 5,
      };
    h.repository.replace(docs);
    await h.patch(root, { paused: true });
    await h.execute({
      type: 'adminUpdateSubmission',
      teamId: 'team-1',
      expectedVersion: 0,
      reason: 'Fix submitted demo link',
      patch: { demoUrl: 'https://example.test/fixed' },
    });
    const archive = h.rows('submissionCorrections')[0];
    expect(Buffer.byteLength(JSON.stringify(archive))).toBeLessThan(150_000);
    expect(h.rows('judgingSheets')).toHaveLength(50);
  });

  it('reopens early submissions without silently opening the global window or changing source evidence', async () => {
    const h = fixture();
    const source = fixture('judging').get<ProjectSubmission>('submissions/team-1');
    await h.patch(`${root}/submissions/team-1`, source);
    await h.patch(root, { paused: true });
    await h.execute({
      type: 'adminReopenSubmission',
      teamId: 'team-1',
      expectedVersion: 0,
      reason: 'Let the team correct their evidence',
    });
    expect(h.get('submissions/team-1')).toBeUndefined();
    expect(h.event().platform!.submissionsOpen).toBe(false);
    expect(h.rows('submissionCorrections')).toEqual([
      expect.objectContaining({ before: source, after: null }),
    ]);
  });
});
