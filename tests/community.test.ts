import { describe, expect, it } from 'vitest';
import { defaultPlatformConfig } from '@robinhacks/core';
import type {
  AwardResults,
  CommunityCommand,
  EventConfig,
  FundingRound,
  JudgingEntry,
  Member,
  ProjectSubmission,
  Team,
  TeamConversation,
} from '@robinhacks/core';
import { CommunityService } from '../packages/application/src/services/community-service';
import { MessagingService } from '../packages/application/src/services/messaging-service';
import { MemoryRepository, type DocumentMap } from '../packages/application/src/memory-repository';
import { EventPaths } from '../packages/application/src/paths';
import type { CommandContext } from '../packages/application/src/services/context';

const paths = new EventPaths('community-test');
const root = paths.root;
const NOW = 1_000_000;
const actorIds = ['captain-a', 'captain-b', 'captain-c'] as const;
const teamIds = ['alpha', 'bravo', 'charlie'] as const;
const member = (uid: string, teamId: string | null, role: Member['role']): Member => ({
  uid,
  displayName: uid,
  email: `${uid}@example.test`,
  emailVerified: true,
  teamId,
  role,
  status: 'approved',
  version: 1,
});
const project = (id: string, captainUid: string): Team => ({
  id,
  captainUid,
  name: id,
  ticker: id.toUpperCase(),
  pitch: 'A useful project.',
  category: '',
  color: '#222222',
  problem: 'A clear problem.',
  building: 'A working demonstration.',
  demoUrl: `https://example.test/${id}/demo`,
  repoUrl: `https://github.com/example/${id}`,
  update: '',
  updatedAt: NOW,
  eligibility: 'active',
  version: 1,
});
const scores = (value: number) => ({
  functionality: value,
  usefulness: value,
  originality: value,
  execution: value,
});
const entries = (value: number): Record<string, JudgingEntry> =>
  Object.fromEntries(
    teamIds.map((id) => [id, { scores: scores(value), note: '', conflict: false }]),
  );

function fixture(stage: 'setup' | 'submission' | 'judging' = 'setup') {
  const config = defaultPlatformConfig();
  config.currentRound = stage === 'setup' ? 0 : stage === 'submission' ? 2 : 3;
  config.submissionsOpen = stage === 'submission';
  config.submissionClosesAt = stage === 'submission' ? NOW + 60_000 : null;
  config.funding.investorPoolMinor = 30_000;
  config.funding.builderPrizesMinor = [100_000, 50_000, 25_000];
  const event: EventConfig = {
    id: paths.eventId,
    name: 'Emergent Hacks',
    venue: '',
    phase: stage === 'judging' ? 'FROZEN' : 'INTERMISSION',
    phaseVersion: 1,
    paused: false,
    pauseReason: '',
    windowId: 0,
    closesAt: null,
    createdAt: 0,
    rulesVersion: 2,
    activeOperationId: null,
    publishedResultId: null,
    announcement: '',
    tieSeed: 'test-seed',
    platform: config,
  };
  const documents: DocumentMap = {
    [root]: event,
    [paths.member('organizer')]: member('organizer', null, 'organizer'),
    [paths.member('judge-one')]: member('judge-one', null, 'judge'),
    [paths.member('judge-two')]: member('judge-two', null, 'judge'),
    [paths.member('teammate')]: member('teammate', 'alpha', 'member'),
  };
  teamIds.forEach((id, index) => {
    const team = project(id, actorIds[index]!);
    documents[paths.team(id)] = team;
    documents[paths.member(actorIds[index]!)] = member(actorIds[index]!, id, 'captain');
    if (stage === 'judging')
      documents[paths.doc('submissions', id)] = {
        id,
        teamId: id,
        submittedAt: NOW - 1000,
        submittedBy: team.captainUid,
        name: team.name,
        pitch: team.pitch,
        problem: team.problem,
        building: team.building,
        demoUrl: team.demoUrl,
        repoUrl: team.repoUrl,
        commitSha: 'a'.repeat(40),
        techStack: 'TypeScript',
        roster: [{ uid: team.captainUid, name: team.captainUid }],
      } satisfies ProjectSubmission;
  });
  for (let number = 1; number <= config.currentRound; number++)
    documents[paths.doc('fundingRounds', `funding-${number}`)] = {
      id: `funding-${number}`,
      number,
      name: config.funding.roundNames[number - 1]!,
      state: 'closed',
      openedAt: NOW - 20_000,
      closesAt: NOW - 1000,
      closedAt: NOW - 1000,
      weightBps: config.funding.roundWeightsBps[number - 1]!,
      minimumDenominator: 200,
      eligibleTeamIds: [...teamIds],
      totals: {},
      voidReason: '',
      version: 1,
    } satisfies FundingRound;
  const repository = new MemoryRepository(documents);
  const service = new CommunityService();
  let now = NOW;
  let sequence = 0;
  const context = async (uid: string, tx: CommandContext['tx']): Promise<CommandContext> => ({
    tx,
    paths,
    event: (await tx.get<EventConfig>(root))!,
    member: (await tx.get<Member>(paths.member(uid)))!,
    actor: { uid },
    now,
    clock: { now: () => now },
    payloadKey: 'test-payload',
  });
  return {
    repository,
    service,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
    run: (
      uid: string,
      command: Omit<CommunityCommand, 'commandId'> | Record<string, unknown>,
      commandId?: string,
    ) =>
      repository.transaction(async (tx) =>
        service.execute(await context(uid, tx), {
          ...command,
          commandId: commandId ?? `command-${++sequence}`,
        } as CommunityCommand),
      ),
    snapshot: (uid: string) =>
      repository.transaction(async (tx) => service.snapshot(await context(uid, tx))),
    conversation: (uid: string, otherTeamId: string) =>
      repository.transaction(async (tx) =>
        service.readConversation(
          tx,
          paths,
          (await tx.get<Member>(paths.member(uid)))!,
          otherTeamId,
        ),
      ),
    patchEvent: (patch: Partial<EventConfig>) =>
      repository.transaction(async (tx) =>
        tx.set(root, { ...(await tx.get<EventConfig>(root))!, ...patch }),
      ),
    set: (path: string, value: unknown) =>
      repository.transaction(async (tx) => tx.set(path, value)),
    get: <T>(path: string) => repository.transaction((tx) => tx.get<T>(path)),
  };
}

describe('append-only checkpoints and final project evidence', () => {
  const update = {
    type: 'publishUpdate',
    round: 1,
    works: 'The prototype works.',
    changed: 'Added offline mode.',
    evidenceUrl: 'https://example.test/demo',
    incomplete: 'Mobile polish.',
  };
  it('archives separate updates with author and server timestamp', async () => {
    const h = fixture();
    await h.run('captain-a', update);
    h.advance(1000);
    await h.run('captain-a', { ...update, changed: 'Added export.' });
    const snapshot = await h.snapshot('captain-b');
    expect(snapshot.updates).toHaveLength(2);
    expect(snapshot.updates[0]).toMatchObject({
      teamId: 'alpha',
      changed: 'Added export.',
      createdAt: NOW + 1000,
      authorName: 'captain-a',
    });
    expect(snapshot.updates[1]?.changed).toBe('Added offline mode.');
  });
  it('rejects member updates, elapsed checkpoints, empty fields and unsafe links', async () => {
    const h = fixture();
    await expect(h.run('teammate', update)).rejects.toMatchObject({ code: 'TRADER_REQUIRED' });
    await expect(h.run('captain-a', { ...update, works: '' })).rejects.toMatchObject({
      code: 'INVALID_UPDATE',
    });
    await expect(
      h.run('captain-a', { ...update, evidenceUrl: 'javascript:alert(1)' }),
    ).rejects.toMatchObject({ code: 'INVALID_URL' });
    const later = fixture('submission');
    await expect(later.run('captain-a', update)).rejects.toMatchObject({ code: 'UPDATE_LOCKED' });
    await expect(later.run('captain-a', { ...update, round: 2 })).rejects.toMatchObject({
      code: 'UPDATE_LOCKED',
    });
    await expect(later.run('captain-a', { ...update, round: 3 })).resolves.toBeDefined();
  });
  it('freezes a complete source commit, profile, evidence and roster without private email', async () => {
    const h = fixture('submission');
    await h.run('captain-a', {
      type: 'submitProject',
      expectedTeamVersion: 1,
      commitSha: 'A'.repeat(40),
      techStack: 'TypeScript',
    });
    const submitted = await h.get<ProjectSubmission>(paths.doc('submissions', 'alpha'));
    expect(submitted).toMatchObject({
      commitSha: 'a'.repeat(40),
      submittedAt: NOW,
      pitch: 'A useful project.',
      repoUrl: 'https://github.com/example/alpha',
    });
    expect(submitted?.roster).toEqual([
      { uid: 'captain-a', name: 'captain-a' },
      { uid: 'teammate', name: 'teammate' },
    ]);
    await expect(
      h.run('captain-a', {
        type: 'submitProject',
        expectedTeamVersion: 1,
        commitSha: 'b'.repeat(40),
        techStack: '',
      }),
    ).rejects.toMatchObject({ code: 'ALREADY_SUBMITTED' });
    await h.set(paths.team('alpha'), { ...project('alpha', 'captain-a'), pitch: 'Changed later.' });
    expect((await h.get<ProjectSubmission>(paths.doc('submissions', 'alpha')))?.pitch).toBe(
      'A useful project.',
    );
  });
  it('requires full commit IDs, current profile versions and strict server deadlines', async () => {
    const h = fixture('submission');
    const submission = {
      type: 'submitProject',
      expectedTeamVersion: 1,
      commitSha: '123abcd',
      techStack: '',
    };
    await expect(h.run('captain-a', submission)).rejects.toMatchObject({ code: 'COMMIT_REQUIRED' });
    await expect(
      h.run('captain-a', { ...submission, expectedTeamVersion: 0, commitSha: 'b'.repeat(64) }),
    ).rejects.toMatchObject({ code: 'TEAM_CHANGED' });
    await expect(
      h.run('captain-a', { ...submission, commitSha: 'b'.repeat(64) }),
    ).resolves.toBeDefined();
    h.advance(60_000);
    await expect(
      h.run('captain-b', { ...submission, commitSha: 'a'.repeat(40) }),
    ).rejects.toMatchObject({ code: 'WINDOW_CLOSED' });
  });
  it('refuses missing final evidence and does not reopen submissions after final funding', async () => {
    const h = fixture('submission');
    await h.set(paths.team('alpha'), { ...project('alpha', 'captain-a'), demoUrl: '' });
    await expect(
      h.run('captain-a', {
        type: 'submitProject',
        expectedTeamVersion: 1,
        commitSha: 'a'.repeat(40),
        techStack: '',
      }),
    ).rejects.toMatchObject({ code: 'EVIDENCE_REQUIRED' });
    const later = fixture('judging');
    await expect(
      later.run('organizer', {
        type: 'setSubmissionWindow',
        open: true,
        closesAt: NOW + 60000,
        expectedPhaseVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'SUBMISSIONS_LOCKED' });
  });
});

describe('private shared team conversations', () => {
  it('lets teammates share conversations and read state without leaking to other teams or judges', async () => {
    const h = fixture();
    await h.run('teammate', {
      type: 'sendMessage',
      toTeamId: 'bravo',
      body: 'Can we see your demo?',
    });
    expect((await h.snapshot('captain-a')).conversations[0]?.unread).toBe(false);
    expect((await h.snapshot('captain-b')).conversations[0]?.unread).toBe(true);
    expect((await h.snapshot('captain-c')).conversations).toEqual([]);
    expect((await h.snapshot('judge-one')).conversations).toEqual([]);
    expect((await h.conversation('captain-a', 'bravo'))?.messages[0]).toMatchObject({
      authorName: 'teammate',
      fromTeamId: 'alpha',
    });
    expect(await h.conversation('captain-c', 'bravo')).toBeNull();
    await h.run('captain-b', { type: 'readConversation', otherTeamId: 'alpha' });
    expect((await h.snapshot('captain-b')).conversations[0]?.unread).toBe(false);
    await expect(h.conversation('judge-one', 'alpha')).rejects.toMatchObject({
      code: 'TEAM_REQUIRED',
    });
  });
  it('rate limits the entire sending team across conversations', async () => {
    const h = fixture();
    await h.run('captain-a', { type: 'sendMessage', toTeamId: 'bravo', body: 'Hello.' });
    await expect(
      h.run('teammate', { type: 'sendMessage', toTeamId: 'charlie', body: 'Another.' }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    h.advance(5000);
    await expect(
      h.run('teammate', { type: 'sendMessage', toTeamId: 'charlie', body: 'Another.' }),
    ).resolves.toBeDefined();
  });
  it('keeps blocks under each team’s control and reports only the selected message to organizers', async () => {
    const h = fixture();
    await h.run('captain-a', {
      type: 'sendMessage',
      toTeamId: 'bravo',
      body: 'A reportable message.',
    });
    const messageId = (await h.conversation('captain-b', 'alpha'))!.messages[0]!.id;
    await h.run('captain-b', {
      type: 'reportMessage',
      otherTeamId: 'alpha',
      messageId,
      reason: 'Misleading claim.',
    });
    expect((await h.snapshot('organizer')).reports[0]).toMatchObject({
      body: 'A reportable message.',
      reason: 'Misleading claim.',
    });
    expect((await h.snapshot('captain-a')).reports).toEqual([]);
    expect((await h.snapshot('organizer')).conversations).toEqual([]);
    await h.run('captain-b', { type: 'blockConversation', otherTeamId: 'alpha', blocked: true });
    await h.run('captain-a', { type: 'blockConversation', otherTeamId: 'bravo', blocked: false });
    h.advance(5000);
    await expect(
      h.run('captain-a', { type: 'sendMessage', toTeamId: 'bravo', body: 'Blocked.' }),
    ).rejects.toMatchObject({ code: 'CONVERSATION_BLOCKED' });
    await h.run('captain-b', { type: 'blockConversation', otherTeamId: 'alpha', blocked: false });
    await expect(
      h.run('captain-a', { type: 'sendMessage', toTeamId: 'bravo', body: 'Allowed.' }),
    ).resolves.toBeDefined();
  });
  it('prevents guessed message reports, own-team DMs, staff DMs and forged conversation membership', async () => {
    const h = fixture();
    await expect(
      h.run('captain-a', { type: 'sendMessage', toTeamId: 'alpha', body: 'Self.' }),
    ).rejects.toMatchObject({ code: 'OWN_TEAM' });
    await expect(
      h.run('organizer', { type: 'sendMessage', toTeamId: 'alpha', body: 'Staff.' }),
    ).rejects.toMatchObject({ code: 'TEAM_REQUIRED' });
    await expect(
      h.run('captain-a', {
        type: 'reportMessage',
        otherTeamId: 'bravo',
        messageId: 'missing',
        reason: 'False claim.',
      }),
    ).rejects.toMatchObject({ code: 'MESSAGE_NOT_FOUND' });
    const id = MessagingService.conversationId('alpha', 'bravo');
    await h.set(paths.doc('conversations', id), {
      id,
      teamIds: ['bravo', 'charlie'],
      messages: [],
      blockedBy: [],
      readAt: {},
      version: 1,
    });
    await expect(h.conversation('captain-a', 'bravo')).rejects.toMatchObject({
      code: 'CONVERSATION_FORBIDDEN',
    });
  });
  it('bounds message content and conversation size while preserving existing history', async () => {
    const h = fixture();
    await expect(
      h.run('captain-a', { type: 'sendMessage', toTeamId: 'bravo', body: 'x'.repeat(1001) }),
    ).rejects.toMatchObject({ code: 'INVALID_MESSAGE' });
    const id = MessagingService.conversationId('alpha', 'bravo');
    const conversation: TeamConversation = {
      id,
      teamIds: ['alpha', 'bravo'],
      blockedBy: [],
      readAt: {},
      version: 250,
      messages: Array.from({ length: 250 }, (_, index) => ({
        id: `old-${index}`,
        fromTeamId: 'alpha',
        authorName: 'captain-a',
        body: 'Message',
        createdAt: index,
      })),
    };
    await h.set(paths.doc('conversations', id), conversation);
    await expect(
      h.run('captain-a', { type: 'sendMessage', toTeamId: 'bravo', body: 'One too many.' }),
    ).rejects.toMatchObject({ code: 'CONVERSATION_FULL' });
    expect((await h.conversation('captain-a', 'bravo'))?.messages).toHaveLength(250);
  });
});

async function assignAll(h: ReturnType<typeof fixture>, uid = 'judge-one') {
  await h.run('organizer', {
    type: 'assignJudge',
    uid,
    projectIds: [...teamIds],
    conflictIds: [],
    expectedVersion: 0,
  });
}

describe('independent judging and durable score sheets', () => {
  it('admits the fiftieth judge assignment, rejects a fifty-first and permits existing assignment edits', async () => {
    const h = fixture('judging');
    for (let index = 0; index < 49; index++) {
      const uid = `existing-judge-${index}`;
      await h.set(paths.doc('judgeAssignments', uid), {
        uid,
        projectIds: ['alpha'],
        conflictIds: [],
        version: 1,
      });
    }
    await h.run('organizer', {
      type: 'assignJudge',
      uid: 'judge-one',
      projectIds: ['alpha'],
      conflictIds: [],
      expectedVersion: 0,
    });
    expect((await h.snapshot('organizer')).assignments).toHaveLength(50);
    await expect(
      h.run('organizer', {
        type: 'assignJudge',
        uid: 'judge-two',
        projectIds: ['bravo'],
        conflictIds: [],
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({ code: 'JUDGE_LIMIT' });
    await h.run('organizer', {
      type: 'assignJudge',
      uid: 'judge-one',
      projectIds: ['alpha', 'bravo'],
      conflictIds: [],
      expectedVersion: 1,
    });
    expect((await h.snapshot('judge-one')).assignments[0]?.projectIds).toEqual(['alpha', 'bravo']);
  });

  it('preserves a 1,500-character judge note and rejects larger notes without overwriting the draft', async () => {
    const h = fixture('judging');
    await assignAll(h);
    const draft = entries(7);
    draft.alpha.note = '界'.repeat(1500);
    await h.run('judge-one', {
      type: 'saveJudgingSheet',
      entries: draft,
      expectedVersion: 0,
      submit: false,
    });
    expect((await h.snapshot('judge-one')).judgingSheets[0]?.entries.alpha?.note).toBe(
      draft.alpha.note,
    );
    draft.alpha.note += '界';
    await expect(
      h.run('judge-one', {
        type: 'saveJudgingSheet',
        entries: draft,
        expectedVersion: 1,
        submit: false,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SCORES' });
    expect((await h.snapshot('judge-one')).judgingSheets[0]?.version).toBe(1);
  });

  it('restricts judges to assigned immutable submissions, own drafts, and public roster names', async () => {
    const h = fixture('judging');
    await h.run('organizer', {
      type: 'assignJudge',
      uid: 'judge-one',
      projectIds: ['alpha'],
      conflictIds: [],
      expectedVersion: 0,
    });
    await assignAll(h, 'judge-two');
    await h.run('judge-two', {
      type: 'saveJudgingSheet',
      entries: entries(5),
      expectedVersion: 0,
      submit: false,
    });
    const snapshot = await h.snapshot('judge-one');
    expect(snapshot.submissions.map((submission) => submission.teamId)).toEqual(['alpha']);
    expect(snapshot.assignments.map((assignment) => assignment.uid)).toEqual(['judge-one']);
    expect(snapshot.judgingSheets).toEqual([]);
    expect(snapshot.ballot).toBeNull();
    expect(snapshot.awards).toBeNull();
    expect(
      snapshot.roster.every(
        (person) => person.teamId === 'alpha' && !Object.hasOwn(person, 'email'),
      ),
    ).toBe(true);
  });
  it('saves partial drafts and rejects stale concurrent changes and premature final submission', async () => {
    const h = fixture('judging');
    await assignAll(h);
    const draft = { alpha: { scores: { functionality: 7 }, note: 'Working.', conflict: false } };
    await h.run('judge-one', {
      type: 'saveJudgingSheet',
      entries: draft,
      expectedVersion: 0,
      submit: false,
    });
    expect((await h.snapshot('judge-one')).judgingSheets[0]?.entries).toEqual(draft);
    await expect(
      h.run('judge-one', {
        type: 'saveJudgingSheet',
        entries: entries(8),
        expectedVersion: 0,
        submit: false,
      }),
    ).rejects.toMatchObject({ code: 'SHEET_CHANGED' });
    await expect(
      h.run('judge-one', {
        type: 'saveJudgingSheet',
        entries: draft,
        expectedVersion: 1,
        submit: true,
      }),
    ).rejects.toMatchObject({ code: 'SCORES_INCOMPLETE' });
    const attempts = await Promise.allSettled([
      h.run('judge-one', {
        type: 'saveJudgingSheet',
        entries: entries(7),
        expectedVersion: 1,
        submit: false,
      }),
      h.run('judge-one', {
        type: 'saveJudgingSheet',
        entries: entries(8),
        expectedVersion: 1,
        submit: false,
      }),
    ]);
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
  });
  it('blocks participant scoring, arbitrary rubric keys, out-of-range scores and editing submitted sheets', async () => {
    const h = fixture('judging');
    await assignAll(h);
    await expect(
      h.run('captain-a', {
        type: 'saveJudgingSheet',
        entries: entries(7),
        expectedVersion: 0,
        submit: false,
      }),
    ).rejects.toMatchObject({ code: 'JUDGE_REQUIRED' });
    await expect(
      h.run('judge-one', {
        type: 'saveJudgingSheet',
        entries: entries(11),
        expectedVersion: 0,
        submit: false,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SCORES' });
    await expect(
      h.run('judge-one', {
        type: 'saveJudgingSheet',
        entries: { alpha: { scores: { invented: 8 }, note: '', conflict: false } },
        expectedVersion: 0,
        submit: false,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SCORES' });
    await h.run('judge-one', {
      type: 'saveJudgingSheet',
      entries: entries(7),
      expectedVersion: 0,
      submit: true,
    });
    await expect(
      h.run('judge-one', {
        type: 'saveJudgingSheet',
        entries: entries(8),
        expectedVersion: 1,
        submit: false,
      }),
    ).rejects.toMatchObject({ code: 'SHEET_LOCKED' });
    await expect(
      h.run('organizer', {
        type: 'assignJudge',
        uid: 'judge-one',
        projectIds: ['alpha'],
        conflictIds: [],
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'SHEET_LOCKED' });
  });
  it('requires separate judge identities and refuses scoring an unassigned project', async () => {
    const h = fixture('judging');
    await expect(
      h.run('organizer', {
        type: 'assignJudge',
        uid: 'captain-a',
        projectIds: ['bravo'],
        conflictIds: [],
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({ code: 'JUDGE_REQUIRED' });
    await h.run('organizer', {
      type: 'assignJudge',
      uid: 'judge-one',
      projectIds: ['alpha'],
      conflictIds: [],
      expectedVersion: 0,
    });
    await expect(
      h.run('judge-one', {
        type: 'saveJudgingSheet',
        entries: entries(8),
        expectedVersion: 0,
        submit: false,
      }),
    ).rejects.toMatchObject({ code: 'UNASSIGNED_PROJECT' });
  });
  it('excludes declared conflicts and requires another judge to cover the affected project', async () => {
    const h = fixture('judging');
    await assignAll(h);
    const conflicted = entries(7);
    conflicted.alpha = { scores: {}, note: 'Mentored this team.', conflict: true };
    await h.run('judge-one', {
      type: 'saveJudgingSheet',
      entries: conflicted,
      expectedVersion: 0,
      submit: true,
    });
    await expect(
      h.run('organizer', {
        type: 'prepareAwards',
        winnerId: 'bravo',
        tiebreakReason: 'Published criterion applied.',
        expectedPhaseVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_UNJUDGED' });
    await h.run('organizer', {
      type: 'assignJudge',
      uid: 'judge-two',
      projectIds: ['alpha'],
      conflictIds: [],
      expectedVersion: 0,
    });
    await h.run('judge-two', {
      type: 'saveJudgingSheet',
      entries: { alpha: { scores: scores(9), note: '', conflict: false } },
      expectedVersion: 0,
      submit: true,
    });
    await expect(
      h.run('organizer', {
        type: 'prepareAwards',
        winnerId: 'alpha',
        tiebreakReason: '',
        expectedPhaseVersion: 1,
      }),
    ).resolves.toBeDefined();
  });
});

describe('community ballots and reviewed awards', () => {
  it('keeps current ballots private even from organizers and enforces one team version', async () => {
    const h = fixture('judging');
    await h.run('organizer', {
      type: 'setBallotWindow',
      open: true,
      closesAt: NOW + 60_000,
      expectedPhaseVersion: 1,
    });
    await h.run('captain-a', {
      type: 'saveBallot',
      rankedProjectIds: ['bravo', 'charlie'],
      expectedVersion: 0,
    });
    expect((await h.snapshot('captain-a')).ballot?.version).toBe(1);
    expect((await h.snapshot('teammate')).ballot?.rankedProjectIds).toEqual(['bravo', 'charlie']);
    expect((await h.snapshot('captain-b')).ballot).toBeNull();
    expect((await h.snapshot('organizer')).ballot).toBeNull();
    expect((await h.snapshot('judge-one')).ballot).toBeNull();
    await expect(
      h.run('captain-a', {
        type: 'saveBallot',
        rankedProjectIds: ['charlie', 'bravo'],
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({ code: 'BALLOT_CHANGED' });
    await expect(
      h.run('captain-a', {
        type: 'saveBallot',
        rankedProjectIds: ['alpha', 'bravo'],
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BALLOT' });
    await expect(
      h.run('captain-a', {
        type: 'saveBallot',
        rankedProjectIds: ['bravo', 'bravo'],
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BALLOT' });
    h.advance(60_000);
    await expect(
      h.run('captain-a', {
        type: 'saveBallot',
        rankedProjectIds: ['charlie', 'bravo'],
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'WINDOW_CLOSED' });
  });
  it('supports a single ranked choice when only one other submitted project is eligible', async () => {
    const h = fixture('judging');
    await h.set(paths.team('charlie'), {
      ...project('charlie', 'captain-c'),
      eligibility: 'withdrawn',
    });
    await h.run('organizer', {
      type: 'setBallotWindow',
      open: true,
      closesAt: NOW + 60_000,
      expectedPhaseVersion: 1,
    });
    await expect(
      h.run('captain-a', { type: 'saveBallot', rankedProjectIds: ['bravo'], expectedVersion: 0 }),
    ).resolves.toBeDefined();
  });
  it('refuses awards until all assigned judges submit and selects only a highest-scoring winner', async () => {
    const h = fixture('judging');
    await assignAll(h);
    await assignAll(h, 'judge-two');
    const sheet = entries(5);
    sheet.alpha.scores = scores(9);
    await h.run('judge-one', {
      type: 'saveJudgingSheet',
      entries: sheet,
      expectedVersion: 0,
      submit: true,
    });
    const prepare = {
      type: 'prepareAwards',
      winnerId: 'alpha',
      tiebreakReason: '',
      expectedPhaseVersion: 1,
    };
    await expect(h.run('organizer', prepare)).rejects.toMatchObject({ code: 'JUDGING_INCOMPLETE' });
    await h.run('judge-two', {
      type: 'saveJudgingSheet',
      entries: sheet,
      expectedVersion: 0,
      submit: true,
    });
    await expect(h.run('organizer', { ...prepare, winnerId: 'bravo' })).rejects.toMatchObject({
      code: 'INVALID_WINNER',
    });
    await h.run('organizer', prepare);
    expect((await h.snapshot('organizer')).awards?.winnerId).toBe('alpha');
    expect((await h.snapshot('judge-one')).awards).toBeNull();
    expect((await h.snapshot('captain-a')).awards).toBeNull();
  });
  it('requires an explicit reason for a judging tie and preserves unused investor reserves', async () => {
    const h = fixture('judging');
    await assignAll(h);
    await h.run('judge-one', {
      type: 'saveJudgingSheet',
      entries: entries(8),
      expectedVersion: 0,
      submit: true,
    });
    const prepare = {
      type: 'prepareAwards',
      winnerId: 'bravo',
      tiebreakReason: '',
      expectedPhaseVersion: 1,
    };
    await expect(h.run('organizer', prepare)).rejects.toMatchObject({ code: 'TIEBREAK_REQUIRED' });
    await h.run('organizer', {
      ...prepare,
      tiebreakReason: 'Higher technical execution after the live tie review.',
    });
    const result = (await h.snapshot('organizer')).awards!;
    expect(result.projects[0]).toMatchObject({ teamId: 'bravo', builderPrizeMinor: 100000 });
    expect(result.investorPaidMinor).toBe(0);
    expect(result.reserveMinor).toBe(30000);
    expect(result.communityWinnerId).toBeNull();
  });
  it('settles only the grand-prize pool using immutable round fractions and a separate ballot', async () => {
    const h = fixture('judging');
    await assignAll(h);
    const sheet = entries(5);
    sheet.alpha.scores = scores(9);
    await h.run('judge-one', {
      type: 'saveJudgingSheet',
      entries: sheet,
      expectedVersion: 0,
      submit: true,
    });
    await h.set(paths.doc('roundEntitlements', 'bravo-round1'), {
      id: 'bravo-round1',
      roundId: 'funding-1',
      roundNumber: 1,
      teamId: 'bravo',
      awardedAt: NOW - 1000,
      spent: 60,
      expired: 40,
      voided: false,
      projects: [
        { projectId: 'alpha', credits: 60, total: 400, denominator: 400, weightBps: 4000 },
      ],
    });
    await h.set(paths.doc('roundEntitlements', 'charlie-round1'), {
      id: 'charlie-round1',
      roundId: 'funding-1',
      roundNumber: 1,
      teamId: 'charlie',
      awardedAt: NOW - 1000,
      spent: 60,
      expired: 40,
      voided: true,
      projects: [
        { projectId: 'alpha', credits: 60, total: 400, denominator: 400, weightBps: 4000 },
      ],
    });
    await h.set(paths.doc('communityBallots', 'alpha'), {
      teamId: 'alpha',
      rankedProjectIds: ['charlie', 'bravo'],
      version: 1,
      updatedAt: NOW,
    });
    await h.run('organizer', {
      type: 'prepareAwards',
      winnerId: 'alpha',
      tiebreakReason: '',
      expectedPhaseVersion: 1,
    });
    const result = (await h.snapshot('organizer')).awards!;
    expect(result.investors.find((investor) => investor.teamId === 'bravo')).toMatchObject({
      rewardMinor: 1800,
      entitlementPercent: 6,
    });
    expect(result.investorPaidMinor).toBe(1800);
    expect(result.reserveMinor).toBe(28200);
    expect(result.communityWinnerId).toBe('charlie');
    expect(result.winnerId).toBe('alpha');
  });
  it('requires the review delay, keeps the result immutable and detects changed eligibility', async () => {
    const h = fixture('judging');
    await assignAll(h);
    const sheet = entries(5);
    sheet.alpha.scores = scores(9);
    await h.run('judge-one', {
      type: 'saveJudgingSheet',
      entries: sheet,
      expectedVersion: 0,
      submit: true,
    });
    await h.run('organizer', {
      type: 'prepareAwards',
      winnerId: 'alpha',
      tiebreakReason: '',
      expectedPhaseVersion: 1,
    });
    await expect(
      h.run('organizer', { type: 'publishAwards', expectedPhaseVersion: 2 }),
    ).rejects.toMatchObject({ code: 'REVIEW_PENDING' });
    h.advance(30 * 60000);
    await h.set(paths.team('charlie'), {
      ...project('charlie', 'captain-c'),
      eligibility: 'disqualified',
    });
    await expect(
      h.run('organizer', { type: 'publishAwards', expectedPhaseVersion: 2 }),
    ).rejects.toMatchObject({ code: 'ELIGIBILITY_CHANGED' });
    await h.set(paths.team('charlie'), project('charlie', 'captain-c'));
    await h.run('organizer', { type: 'publishAwards', expectedPhaseVersion: 2 });
    expect((await h.snapshot('captain-a')).awards?.publishedAt).toBe(NOW + 30 * 60000);
    await expect(
      h.run('organizer', {
        type: 'discardAwards',
        expectedPhaseVersion: 3,
        reason: 'Trying to remove published awards.',
      }),
    ).rejects.toMatchObject({ code: 'AWARDS_LOCKED' });
  });
  it('discards only an unpublished preview and retains the archived review evidence', async () => {
    const h = fixture('judging');
    await assignAll(h);
    const sheet = entries(5);
    sheet.alpha.scores = scores(9);
    await h.run('judge-one', {
      type: 'saveJudgingSheet',
      entries: sheet,
      expectedVersion: 0,
      submit: true,
    });
    await h.run('organizer', {
      type: 'prepareAwards',
      winnerId: 'alpha',
      tiebreakReason: '',
      expectedPhaseVersion: 1,
    });
    const preview = (await h.snapshot('organizer')).awards!;
    await h.run('organizer', {
      type: 'discardAwards',
      expectedPhaseVersion: 2,
      reason: 'Check the eligibility decision again.',
    });
    expect((await h.snapshot('organizer')).awards).toBeNull();
    expect(await h.get<AwardResults>(paths.doc('awardResults', preview.id))).toEqual(preview);
    expect((await h.get<EventConfig>(root))?.phase).toBe('FROZEN');
  });
  it('prevents another organizer from overwriting an archived preview using the same command identifier', async () => {
    const h = fixture('judging');
    await assignAll(h);
    const sheet = entries(5);
    sheet.alpha.scores = scores(9);
    await h.run('judge-one', {
      type: 'saveJudgingSheet',
      entries: sheet,
      expectedVersion: 0,
      submit: true,
    });
    await h.run(
      'organizer',
      { type: 'prepareAwards', winnerId: 'alpha', tiebreakReason: '', expectedPhaseVersion: 1 },
      'shared-preview-id',
    );
    const archived = await h.get<AwardResults>(paths.doc('awardResults', 'shared-preview-id'));
    await h.run('organizer', {
      type: 'discardAwards',
      reason: 'A second organizer will check the preview.',
      expectedPhaseVersion: 2,
    });
    await h.set(paths.member('organizer-two'), member('organizer-two', null, 'organizer'));
    await expect(
      h.run(
        'organizer-two',
        { type: 'prepareAwards', winnerId: 'alpha', tiebreakReason: '', expectedPhaseVersion: 3 },
        'shared-preview-id',
      ),
    ).rejects.toMatchObject({ code: 'COMMAND_CONFLICT' });
    expect(await h.get<AwardResults>(paths.doc('awardResults', 'shared-preview-id'))).toEqual(
      archived,
    );
    expect((await h.snapshot('organizer')).awards).toBeNull();
    await expect(
      h.run(
        'organizer-two',
        { type: 'prepareAwards', winnerId: 'alpha', tiebreakReason: '', expectedPhaseVersion: 3 },
        'current',
      ),
    ).rejects.toMatchObject({ code: 'COMMAND_CONFLICT' });
  });
});
