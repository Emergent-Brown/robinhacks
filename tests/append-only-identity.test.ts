import { describe, expect, it } from 'vitest';
import type { Command, Member, ProjectUpdate } from '@robinhacks/core';
import { GameService } from '../packages/application/src/game-service';
import {
  createPlatformDemoDocuments,
  DEMO_EVENT_ID,
  PLATFORM_USERS,
} from '../packages/application/src/platform-fixtures';
import { MemoryRepository } from '../packages/application/src/memory-repository';

const root = `events/${DEMO_EVENT_ID}`;
function fixture() {
  const repository = new MemoryRepository(createPlatformDemoDocuments('seed', 10_000_000));
  const service = new GameService(repository, DEMO_EVENT_ID, { now: () => 10_000_000 });
  const second = {
    uid: 'demo-captain-2',
    displayName: 'Maya Patel',
    email: 'maya@example.test',
    emailVerified: true,
  };
  const secondTeammate = {
    uid: 'demo-member-2-1',
    displayName: 'Theo Brooks',
    email: 'theo@example.test',
    emailVerified: true,
  };
  const update: Command = {
    type: 'publishUpdate',
    commandId: 'public-checkpoint-id',
    round: 1,
    works: 'The verified prototype works.',
    changed: '',
    evidenceUrl: '',
    incomplete: 'More testing remains.',
  };
  const message: Command = {
    type: 'sendMessage',
    commandId: 'shared-message-id',
    toTeamId: 'team-2',
    body: 'Can we see your prototype?',
  };
  return { repository, service, second, secondTeammate, update, message };
}

describe('actor-scoped receipts cannot overwrite append-only records', () => {
  it('prevents a captain from reusing another team’s public checkpoint ID', async () => {
    const h = fixture();
    await h.service.execute(PLATFORM_USERS.captain, h.update);
    const original = h.repository.dump()[
      `${root}/projectUpdates/${h.update.commandId}`
    ] as ProjectUpdate;
    await expect(
      h.service.execute(h.second, { ...h.update, works: 'Replace the other team’s evidence.' }),
    ).rejects.toMatchObject({ code: 'COMMAND_CONFLICT' });
    expect(h.repository.dump()[`${root}/projectUpdates/${h.update.commandId}`]).toEqual(original);
    expect(original.teamId).toBe('team-1');
    expect(
      h.repository.dump()[`${root}/commandReceipts/${h.second.uid}__${h.update.commandId}`],
    ).toBeUndefined();
    const ownReplay = await h.service.execute(PLATFORM_USERS.captain, h.update);
    expect(ownReplay.receipt?.id).toBe(h.update.commandId);
  });

  it('resolves simultaneous cross-team ID collisions atomically without replacing accepted evidence', async () => {
    const h = fixture();
    const results = await Promise.allSettled([
      h.service.execute(PLATFORM_USERS.captain, h.update),
      h.service.execute(h.second, h.update),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'COMMAND_CONFLICT' },
    });
    expect(h.repository.dump()[`${root}/projectUpdates/${h.update.commandId}`]).toMatchObject({
      teamId: 'team-1',
    });
  });

  it('keeps message identifiers unique within a shared conversation when the other team replies', async () => {
    const h = fixture();
    await h.service.execute(PLATFORM_USERS.captain, h.message);
    await expect(
      h.service.execute(h.second, {
        ...h.message,
        toTeamId: 'team-1',
        body: 'A reply with a conflicting ID.',
      }),
    ).rejects.toMatchObject({ code: 'COMMAND_CONFLICT' });
    const conversation = await h.service.conversation(h.second.uid, 'team-1');
    expect(conversation?.messages).toHaveLength(1);
    expect(conversation?.messages[0]).toMatchObject({
      id: h.message.commandId,
      fromTeamId: 'team-1',
      body: 'Can we see your prototype?',
    });
    await h.service.execute(PLATFORM_USERS.captain, h.message);
    expect((await h.service.conversation(h.second.uid, 'team-1'))?.messages).toHaveLength(1);
    await h.service.execute(h.second, {
      ...h.message,
      commandId: 'unique-reply-message',
      toTeamId: 'team-1',
      body: 'Yes, visit our table.',
    });
    expect((await h.service.conversation(h.second.uid, 'team-1'))?.messages).toHaveLength(2);
  });

  it('does not let a second reporter replace the first reporter’s audit record', async () => {
    const h = fixture();
    expect((h.repository.dump()[`${root}/members/${h.secondTeammate.uid}`] as Member).teamId).toBe(
      'team-2',
    );
    await h.service.execute(PLATFORM_USERS.captain, h.message);
    const report: Command = {
      type: 'reportMessage',
      commandId: 'shared-report-identifier',
      otherTeamId: 'team-1',
      messageId: h.message.commandId,
      reason: 'Please review this message.',
    };
    await h.service.execute(h.second, report);
    const original = h.repository.dump()[`${root}/messageReports/${report.commandId}`];
    await expect(
      h.service.execute(h.secondTeammate, {
        ...report,
        reason: 'Replace the reporter and the reason.',
      }),
    ).rejects.toMatchObject({ code: 'COMMAND_CONFLICT' });
    expect(h.repository.dump()[`${root}/messageReports/${report.commandId}`]).toEqual(original);
    await h.service.execute(h.second, report);
    expect(
      Object.keys(h.repository.dump()).filter((path) => path.startsWith(`${root}/messageReports/`)),
    ).toHaveLength(1);
  });
});
