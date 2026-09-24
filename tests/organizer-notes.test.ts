import { describe, expect, it } from 'vitest';
import type { EventConfig } from '@robinhacks/core';
import { GameService } from '../packages/application/src/game-service';
import { MemoryRepository } from '../packages/application/src/memory-repository';
import {
  createPlatformDemoDocuments,
  DEMO_EVENT_ID,
  PLATFORM_USERS,
} from '../packages/application/src/platform-fixtures';

const root = `events/${DEMO_EVENT_ID}`;
function fixture(phase?: EventConfig['phase']) {
  const documents = createPlatformDemoDocuments('registration', 10_000);
  if (phase) (documents[root] as EventConfig).phase = phase;
  const repository = new MemoryRepository(documents);
  return { repository, service: new GameService(repository, DEMO_EVENT_ID, { now: () => 20_000 }) };
}

describe('organizer notes', () => {
  it('requires organizer access, attributes edits, handles duplicate requests and protects newer notes', async () => {
    const { service, repository } = fixture();
    const before = repository.dump()[root] as EventConfig;
    const command = {
      type: 'setAnnouncement' as const,
      commandId: 'post-organizer-note',
      announcement: 'Pitches start at 11.',
      expectedVersion: 0,
    };
    await expect(service.execute(PLATFORM_USERS.captain, command)).rejects.toThrow();
    const posted = await service.execute(PLATFORM_USERS.organizer, command);
    expect(await service.execute(PLATFORM_USERS.organizer, command)).toEqual(posted);
    expect(repository.dump()[root]).toMatchObject({
      announcement: 'Pitches start at 11.',
      announcementVersion: 1,
      announcementUpdatedAt: 20_000,
      announcementAuthor: PLATFORM_USERS.organizer.displayName,
      phaseVersion: before.phaseVersion + 1,
    });
    await expect(
      service.execute(PLATFORM_USERS.organizer, {
        ...command,
        commandId: 'stale-organizer-note',
        announcement: 'Old draft.',
      }),
    ).rejects.toThrow('Another organizer');
    await service.execute(PLATFORM_USERS.organizer, {
      ...command,
      commandId: 'remove-organizer-note',
      expectedVersion: 1,
      announcement: '',
    });
    expect(repository.dump()[root]).toMatchObject({ announcement: '', announcementVersion: 2 });
  });

  it.each(['FINALIZED', 'CANCELLED'] as const)(
    'allows organizer wrap-up notes in %s',
    async (phase) => {
      const { service, repository } = fixture(phase);
      await service.execute(PLATFORM_USERS.organizer, {
        type: 'setAnnouncement',
        commandId: `wrapup-note-${phase}`,
        announcement: 'Thank you for coming.',
        expectedVersion: 0,
      });
      expect((repository.dump()[root] as EventConfig).announcement).toBe('Thank you for coming.');
    },
  );
});
