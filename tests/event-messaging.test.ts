import { describe, expect, it } from 'vitest';
import type { Command, EventConfig, GeneralMessage, Member } from '@robinhacks/core';
import { GameService } from '../packages/application/src/game-service';
import { MemoryRepository } from '../packages/application/src/memory-repository';
import {
  createPlatformDemoDocuments,
  DEMO_EVENT_ID,
  PLATFORM_USERS,
} from '../packages/application/src/platform-fixtures';
import { chatRecordId } from '../packages/application/src/services/chat-records';
import { MessagingService } from '../packages/application/src/services/messaging-service';

const root = `events/${DEMO_EVENT_ID}`;
const captain = PLATFORM_USERS.captain;
const attendee = PLATFORM_USERS.attendee;
const organizer = PLATFORM_USERS.organizer;
const judge = PLATFORM_USERS.judge;
function fixture() {
  const docs = createPlatformDemoDocuments('registration', 1000000);
  for (const key of Object.keys(docs))
    if (
      /\/(messageChannels|generalReadStates|conversations|conversationDirectory|teamInboxes)\//.test(
        key,
      )
    )
      delete docs[key];
  const repository = new MemoryRepository(docs);
  let now = 1000000;
  let sequence = 0;
  const service = new GameService(repository, DEMO_EVENT_ID, { now: () => now });
  return {
    repository,
    service,
    run: (actor: { uid: string }, command: Record<string, unknown>, commandId?: string) =>
      service.execute({ ...actor, emailVerified: true }, {
        ...command,
        commandId: commandId ?? `messaging-${++sequence}`,
      } as Command),
    tick: (milliseconds = 5001) => {
      now += milliseconds;
    },
    patch: (path: string, patch: object) =>
      repository.transaction(async (tx) =>
        tx.set(path, { ...(await tx.get<object>(path)), ...patch }),
      ),
  };
}

describe('pinned event chat', () => {
  it('admits approved unassigned participants and staff without exposing project or funding data', async () => {
    const h = fixture();
    await h.run(organizer, {
      type: 'sendGeneralMessage',
      body: 'Welcome. Team selection opens after the introduction.',
    });
    await h.run(attendee, {
      type: 'sendGeneralMessage',
      body: 'Where can I find a hardware team?',
    });
    const page = await h.service.messages(judge.uid, { kind: 'general' });
    expect(page.messages.map((message) => message.authorUid)).toEqual([
      organizer.uid,
      attendee.uid,
    ]);
    expect(page.messages[0]).toMatchObject({
      authorRole: 'organizer',
      fromTeamId: null,
      sequence: 1,
    });
    const snapshot = await h.service.snapshot(attendee.uid);
    expect(snapshot.market.entries).toEqual([]);
    expect(snapshot.platform?.rounds).toEqual([]);
    expect(snapshot.platform?.general.latestSequence).toBe(2);
    expect(snapshot.platform?.conversations).toEqual([]);
    expect((await h.service.publicSnapshot()).platform?.general.latestSequence).toBe(0);
  });

  it('rejects pending, removed, and suspended users at both read and write boundaries', async () => {
    const h = fixture();
    for (const status of ['pending', 'suspended'] as const) {
      await h.patch(`${root}/members/${attendee.uid}`, { status });
      await expect(h.service.messages(attendee.uid, { kind: 'general' })).rejects.toMatchObject({
        code: 'MEMBERSHIP_REQUIRED',
      });
      await expect(
        h.run(attendee, { type: 'sendGeneralMessage', body: 'No access.' }),
      ).rejects.toMatchObject({ code: 'MEMBERSHIP_REQUIRED' });
    }
    await h.repository.transaction(async (tx) => tx.delete(`${root}/members/${attendee.uid}`));
    await expect(h.service.messages(attendee.uid, { kind: 'general' })).rejects.toMatchObject({
      code: 'MEMBERSHIP_REQUIRED',
    });
  });

  it('uses bounded, non-overlapping history pages and rejects invalid cursors', async () => {
    const h = fixture();
    for (let index = 1; index <= 85; index++) {
      await h.run(organizer, { type: 'sendGeneralMessage', body: `Update ${index}.` });
      h.tick();
    }
    const newest = await h.service.messages(attendee.uid, { kind: 'general' });
    const middle = await h.service.messages(attendee.uid, {
      kind: 'general',
      before: newest.nextBefore!,
    });
    const oldest = await h.service.messages(attendee.uid, {
      kind: 'general',
      before: middle.nextBefore!,
    });
    expect([newest.messages.length, middle.messages.length, oldest.messages.length]).toEqual([
      40, 40, 5,
    ]);
    expect(oldest.nextBefore).toBeNull();
    const all = [...oldest.messages, ...middle.messages, ...newest.messages] as GeneralMessage[];
    expect(all.map((message) => message.sequence)).toEqual(
      Array.from({ length: 85 }, (_, index) => index + 1),
    );
    expect(
      Object.keys(h.repository.dump()).filter((key) =>
        key.includes('/messageChannels/general/pages/'),
      ),
    ).toHaveLength(3);
    await expect(
      h.service.messages(attendee.uid, { kind: 'general', before: -1 }),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  });

  it('serializes competing sends, rejects duplicate payloads, and never moves read cursors backward', async () => {
    const h = fixture();
    const body = 'Our prototype runs offline.';
    await Promise.all([
      h.run(organizer, { type: 'sendGeneralMessage', body }, 'organizer-first'),
      h.run(attendee, { type: 'sendGeneralMessage', body: 'Good morning.' }, 'attendee-first'),
    ]);
    await h.run(organizer, { type: 'sendGeneralMessage', body }, 'organizer-first');
    await expect(
      h.run(organizer, { type: 'sendGeneralMessage', body: 'Changed.' }, 'organizer-first'),
    ).rejects.toMatchObject({ code: 'COMMAND_CONFLICT' });
    await expect(
      h.run(attendee, { type: 'sendGeneralMessage', body: 'Too fast.' }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect((await h.service.messages(captain.uid, { kind: 'general' })).latestSequence).toBe(2);
    expect((await h.service.snapshot(captain.uid)).platform?.general.unread).toBe(true);
    await h.run(captain, { type: 'readGeneral', throughSequence: 2 });
    await h.run(captain, { type: 'readGeneral', throughSequence: 1 });
    expect((await h.service.snapshot(captain.uid)).platform?.general.unread).toBe(false);
    await expect(h.run(captain, { type: 'readGeneral', throughSequence: 3 })).rejects.toMatchObject(
      { code: 'INVALID_CURSOR' },
    );
    expect((await h.service.snapshot(organizer.uid)).platform?.general.unread).toBe(true);
  });

  it('keeps messages from different actors distinct when they choose the same command ID', async () => {
    const h = fixture();
    await Promise.all([
      h.run(organizer, { type: 'sendGeneralMessage', body: 'Organizer post.' }, 'same-command-id'),
      h.run(
        attendee,
        { type: 'sendGeneralMessage', body: 'Participant reply.' },
        'same-command-id',
      ),
    ]);
    const page = await h.service.messages(captain.uid, { kind: 'general' });
    expect(page.messages).toHaveLength(2);
    expect(new Set(page.messages.map((message) => message.id)).size).toBe(2);
  });

  it('keeps organizer wrap-up posts available after publication, but stops participant posting', async () => {
    const h = fixture();
    await h.patch(root, { phase: 'FINALIZED' } satisfies Partial<EventConfig>);
    await h.run(organizer, {
      type: 'sendGeneralMessage',
      body: 'Thanks for building with us. Please collect your hardware.',
    });
    await expect(
      h.run(captain, { type: 'sendGeneralMessage', body: 'Another.' }),
    ).rejects.toMatchObject({ code: 'EVENT_READ_ONLY' });
    expect((await h.service.messages(attendee.uid, { kind: 'general' })).messages).toHaveLength(1);
  });
});

describe('organizer conversation review and moderation', () => {
  it('lists only metadata and allows organizer review without impersonating either team', async () => {
    const h = fixture();
    await h.run(captain, {
      type: 'sendMessage',
      toTeamId: 'team-2',
      body: 'Could we try your demo after lunch?',
    });
    const directory = await h.service.conversationDirectory(organizer.uid);
    expect(directory).toHaveLength(1);
    expect(directory[0]?.participantUids).toContain(captain.uid);
    expect(directory[0]?.participantUids).toContain(PLATFORM_USERS.member.uid);
    expect(directory[0]).not.toHaveProperty('messages');
    const id = directory[0]!.id;
    const reviewed = await h.service.messages(organizer.uid, { kind: 'review', id });
    expect(reviewed.messages[0]).toMatchObject({
      authorUid: captain.uid,
      authorName: captain.displayName,
    });
    expect((await h.service.snapshot(organizer.uid)).platform?.allocation).toBeNull();
    expect((await h.service.snapshot(organizer.uid)).platform?.conversations).toEqual([]);
    for (const actor of [captain, judge, attendee]) {
      await expect(h.service.conversationDirectory(actor.uid)).rejects.toMatchObject({
        code: 'ORGANIZER_REQUIRED',
      });
      await expect(h.service.messages(actor.uid, { kind: 'review', id })).rejects.toMatchObject({
        code: 'ORGANIZER_REQUIRED',
      });
    }
    await expect(
      h.run(organizer, { type: 'sendMessage', toTeamId: 'team-2', body: 'Pretend to be a team.' }),
    ).rejects.toMatchObject({ code: 'TEAM_REQUIRED' });
  });

  it('keeps authored history discoverable after a person moves teams', async () => {
    const h = fixture();
    await h.run(captain, {
      type: 'sendMessage',
      toTeamId: 'team-2',
      body: 'A question before moving teams.',
    });
    await h.patch(`${root}/members/${captain.uid}`, {
      teamId: 'team-3',
      role: 'member',
    } satisfies Partial<Member>);
    const entry = (await h.service.conversationDirectory(organizer.uid))[0]!;
    expect(entry.participantUids).toContain(captain.uid);
    expect(entry.participantNames[captain.uid]).toBe(captain.displayName);
    expect(
      (await h.service.messages(captain.uid, { kind: 'team', id: 'team-2' })).messages,
    ).toEqual([]);
  });

  it('removes general and team messages with visible tombstones and private original records', async () => {
    const h = fixture();
    await h.run(
      captain,
      { type: 'sendGeneralMessage', body: 'Remove this general message.' },
      'general-original',
    );
    await h.run(
      captain,
      { type: 'sendMessage', toTeamId: 'team-2', body: 'Remove this team message.' },
      'team-original',
    );
    const conversationId = MessagingService.conversationId('team-1', 'team-2');
    await expect(
      h.run(captain, {
        type: 'removeChatMessage',
        kind: 'team',
        id: conversationId,
        messageId: chatRecordId(captain.uid, 'team-original'),
        reason: 'Trying to hide it.',
      }),
    ).rejects.toMatchObject({ code: 'ORGANIZER_REQUIRED' });
    await expect(
      h.run(organizer, {
        type: 'removeChatMessage',
        kind: 'general',
        id: 'general',
        messageId: chatRecordId(captain.uid, 'general-original'),
        sequence: 2,
        reason: 'Incorrect sequence.',
      }),
    ).rejects.toMatchObject({ code: 'MESSAGE_NOT_FOUND' });
    await h.run(
      organizer,
      {
        type: 'removeChatMessage',
        kind: 'general',
        id: 'general',
        messageId: chatRecordId(captain.uid, 'general-original'),
        sequence: 1,
        reason: 'Off-topic promotion.',
      },
      'remove-general',
    );
    await h.run(
      organizer,
      {
        type: 'removeChatMessage',
        kind: 'team',
        id: conversationId,
        messageId: chatRecordId(captain.uid, 'team-original'),
        reason: 'Personal information.',
      },
      'remove-team',
    );
    const general = (await h.service.messages(attendee.uid, { kind: 'general' })).messages[0]!;
    expect((await h.service.messages(attendee.uid, { kind: 'general' })).moderationVersion).toBe(1);
    expect((await h.service.snapshot(attendee.uid)).platform?.general.moderationVersion).toBe(1);
    expect(general).toMatchObject({
      body: 'Message removed by an organizer.',
      authorUid: captain.uid,
      removalReason: 'Off-topic promotion.',
    });
    const reviewed = (
      await h.service.messages(organizer.uid, { kind: 'review', id: conversationId })
    ).messages[0]!;
    expect(reviewed).toMatchObject({
      body: 'Message removed by an organizer.',
      authorUid: captain.uid,
    });
    expect(
      h.repository.dump()[
        `${root}/moderatedMessages/${chatRecordId(organizer.uid, 'remove-team')}`
      ],
    ).toMatchObject({ original: { body: 'Remove this team message.' }, removedBy: organizer.uid });
    expect((await h.service.conversationDirectory(organizer.uid))[0]?.lastMessage).toBe(
      'Message removed by an organizer.',
    );
    expect((await h.service.snapshot(captain.uid)).audit).toEqual([]);
    expect(
      (await h.service.snapshot(organizer.uid)).audit.some(
        (entry) => entry.action === 'removeChatMessage',
      ),
    ).toBe(true);
  });

  it('blocks all new messaging reads and mutations during event maintenance', async () => {
    const h = fixture();
    await h.patch(root, { maintenance: true });
    await expect(h.service.messages(organizer.uid, { kind: 'general' })).rejects.toMatchObject({
      code: 'MAINTENANCE',
    });
    await expect(h.service.conversationDirectory(organizer.uid)).rejects.toMatchObject({
      code: 'MAINTENANCE',
    });
    await expect(
      h.run(organizer, { type: 'sendGeneralMessage', body: 'Blocked.' }),
    ).rejects.toMatchObject({ code: 'MAINTENANCE' });
  });
});
