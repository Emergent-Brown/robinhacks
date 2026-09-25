import { afterAll, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { EventConfig, Member, Team } from '@robinhacks/core';
import { GameService } from '../packages/application/src/game-service';
import {
  createPlatformDemoDocuments,
  DEMO_EVENT_ID,
  PLATFORM_USERS,
} from '../packages/application/src/platform-fixtures';
import { FirestoreRepository } from '../apps/functions/src/firestore-repository';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)(
  'event-size Firestore workload (emulator only)',
  () => {
    const app = initializeApp({ projectId: 'demo-robinhacks' }, 'walkthrough-stress');
    const db = getFirestore(app);
    afterAll(async () => {
      await db.terminate();
      await deleteApp(app);
    });
    it('serves 150 simultaneous message readers across 30 four-person teams and preserves concurrent sends', async () => {
      const eventId = 'walkthrough-stress';
      const root = `events/${eventId}`;
      const fixtures = createPlatformDemoDocuments('registration', Date.now());
      const event = structuredClone(fixtures[`events/${DEMO_EVENT_ID}`]) as EventConfig;
      event.id = eventId;
      const teamTemplate = fixtures[`events/${DEMO_EVENT_ID}/teams/team-1`] as Team;
      const batch = db.batch();
      batch.set(db.doc(root), event);
      const people: Member[] = [];
      for (let i = 0; i < 150; i++) {
        const teamId = i < 120 ? `stress-team-${Math.floor(i / 4)}` : null;
        const person: Member = {
          uid: `stress-person-${i}`,
          displayName: `Participant ${i}`,
          email: `stress-${i}@example.test`,
          emailVerified: true,
          role: i < 120 && i % 4 === 0 ? 'captain' : 'member',
          teamId,
          status: 'approved',
          version: 1,
        };
        people.push(person);
        batch.set(db.doc(`${root}/members/${person.uid}`), person);
        if (teamId) batch.set(db.doc(`${root}/teams/${teamId}/members/${person.uid}`), person);
        if (person.role === 'captain')
          batch.set(db.doc(`${root}/teams/${teamId}`), {
            ...teamTemplate,
            id: teamId,
            name: `Team ${Math.floor(i / 4)}`,
            captainUid: person.uid,
          });
      }
      const organizer = {
        ...PLATFORM_USERS.organizer,
        teamId: null,
        role: 'organizer',
        status: 'approved',
        version: 1,
      };
      batch.set(db.doc(`${root}/members/${organizer.uid}`), organizer);
      await batch.commit();
      const service = new GameService(new FirestoreRepository(db), eventId, {
        now: () => Date.now(),
      });
      await service.execute(PLATFORM_USERS.organizer, {
        type: 'sendGeneralMessage',
        commandId: 'stress-opening-message',
        body: 'Local emulator stress test.',
      });
      const elapsed: number[] = [];
      const pages = await Promise.all(
        people.map(async (person) => {
          const start = performance.now();
          const result = await service.messages(person.uid, { kind: 'general' });
          elapsed.push(performance.now() - start);
          return result;
        }),
      );
      expect(pages).toHaveLength(150);
      expect(pages.every((p) => p.messages.length === 1)).toBe(true);
      // Distinct senders hit the same channel summary and page, exercising transaction contention.
      const sends = await Promise.allSettled(
        people
          .slice(0, 12)
          .map((person) =>
            service.execute(person, {
              type: 'sendGeneralMessage',
              commandId: `stress-send-${person.uid}`,
              body: `Test message ${person.uid}`,
            }),
          ),
      );
      expect(sends.filter((s) => s.status === 'fulfilled')).toHaveLength(12);
      const final = await service.messages(people[0]!.uid, { kind: 'general' });
      expect(final.messages).toHaveLength(13);
      expect(new Set(final.messages.map((m) => m.id)).size).toBe(13);
      elapsed.sort((a, b) => a - b);
      console.log(
        JSON.stringify({
          scenario: '150 readers / 30 teams / 12 concurrent sends',
          readers: pages.length,
          p50Ms: Math.round(elapsed[74]!),
          p95Ms: Math.round(elapsed[142]!),
          p99Ms: Math.round(elapsed[148]!),
          messages: final.messages.length,
        }),
      );
    }, 120000);
  },
);
