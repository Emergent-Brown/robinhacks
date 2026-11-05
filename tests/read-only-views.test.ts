import { describe, expect, it } from 'vitest';
import { GameService } from '../packages/application/src/game-service';
import { MemoryRepository } from '../packages/application/src/memory-repository';
import type { Repository, Transaction } from '../packages/application/src/repository';
import {
  createPlatformDemoDocuments,
  DEMO_EVENT_ID,
  PLATFORM_USERS,
} from '../packages/application/src/platform-fixtures';

function fixture() {
  const memory = new MemoryRepository(createPlatformDemoDocuments('funding', 10_000_000));
  let writes = 0;
  const repository: Repository = {
    transaction<T>(work: (tx: Transaction) => Promise<T>) {
      writes++;
      return memory.transaction(work);
    },
    read: (work) => memory.read(work),
  };
  const service = new GameService(repository, DEMO_EVENT_ID, { now: () => 10_000_000 });
  return { memory, service, writes: () => writes };
}

describe('read-only views', () => {
  it('rejects writes and leaves stored data alone', async () => {
    const { memory } = fixture();
    const before = memory.dump();
    await expect(
      memory.read(async (tx) => {
        tx.set('anything/at-all', { value: 1 });
      }),
    ).rejects.toThrow('read-only');
    expect(memory.dump()).toEqual(before);
  });

  it('loads an ordinary snapshot, public data and messages without a write transaction', async () => {
    const { service, writes } = fixture();
    const actor = PLATFORM_USERS.captain;
    const snapshot = await service.snapshot(actor.uid, actor);
    expect(snapshot.member?.uid).toBe(actor.uid);
    await service.publicSnapshot();
    await service.messages(actor.uid, { kind: 'general' });
    expect(writes()).toBe(0);
  });

  it('still records a changed Google email, using one short write', async () => {
    const { memory, service, writes } = fixture();
    const actor = { ...PLATFORM_USERS.captain, email: 'renamed@example.test' };
    const snapshot = await service.snapshot(actor.uid, actor);
    expect(writes()).toBe(1);
    expect(snapshot.member?.email).toBe('renamed@example.test');
    const stored = memory.dump()[`events/${DEMO_EVENT_ID}/members/${actor.uid}`];
    expect(stored).toMatchObject({ email: 'renamed@example.test', teamId: expect.any(String) });
    await service.snapshot(actor.uid, actor);
    expect(writes()).toBe(1);
  });
});
