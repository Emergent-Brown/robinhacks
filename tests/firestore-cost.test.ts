import { afterAll, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { FirestoreRepository } from '../apps/functions/src/firestore-repository';
import {
  createPlatformDemoDocuments,
  DEMO_EVENT_ID,
  PLATFORM_USERS,
} from '../packages/application/src/platform-fixtures';
import { GameService } from '../packages/application/src/game-service';
import type { EventConfig, Member, Team, ProjectSubmission, ProjectUpdate } from '@robinhacks/core';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)(
  'Firestore read cost and projection consistency',
  () => {
    const app = initializeApp({ projectId: 'demo-robinhacks' }, 'read-cost');
    const db = getFirestore(app);
    afterAll(async () => {
      await db.terminate();
      await deleteApp(app);
    });
    it('serves 100 concurrent snapshots for 40 teams with equivalent results and at least 85% fewer document reads', async () => {
      const now = 10_000_000,
        id = 'cost-comparison',
        root = `events/${id}`,
        src = `events/${DEMO_EVENT_ID}`;
      const fixture = createPlatformDemoDocuments('judging', now);
      const event = structuredClone(fixture[src]) as EventConfig;
      event.id = id;
      const team = fixture[`${src}/teams/team-1`] as Team;
      const submission = fixture[`${src}/submissions/team-1`] as ProjectSubmission;
      const update = Object.entries(fixture).find(([p]) =>
        p.startsWith(`${src}/projectUpdates/`),
      )![1] as ProjectUpdate;
      let batch = db.batch(),
        written = 0;
      const seed = async (path: string, value: unknown) => {
        batch.set(db.doc(path), value as Record<string, unknown>);
        if (++written % 400 === 0) {
          await batch.commit();
          batch = db.batch();
        }
      };
      await seed(root, event);
      const people: Member[] = [];
      for (let i = 0; i < 40; i++) {
        const teamId = `team-${String(i).padStart(2, '0')}`;
        await seed(`${root}/teams/${teamId}`, {
          ...team,
          id: teamId,
          name: `Team ${i}`,
          captainUid: `person-${i * 4}`,
        });
        await seed(`${root}/submissions/${teamId}`, {
          ...submission,
          id: teamId,
          teamId,
          name: `Team ${i}`,
        });
        for (let round = 1; round <= 3; round++)
          await seed(`${root}/projectUpdates/${teamId}-${round}`, {
            ...update,
            id: `${teamId}-${round}`,
            teamId,
            round,
          });
        for (let j = 0; j < 4; j++) {
          const person: Member = {
            uid: `person-${i * 4 + j}`,
            displayName: `Person ${i * 4 + j}`,
            email: `p${i * 4 + j}@example.test`,
            emailVerified: true,
            role: j === 0 ? 'captain' : 'member',
            teamId,
            status: 'approved',
            version: 1,
          };
          people.push(person);
          await seed(`${root}/members/${person.uid}`, person);
        }
      }
      for (const [p, v] of Object.entries(fixture))
        if (p.startsWith(`${src}/fundingRounds/`)) await seed(p.replace(src, root), v);
      await seed(
        `${root}/members/${PLATFORM_USERS.organizer.uid}`,
        fixture[`${src}/members/${PLATFORM_USERS.organizer.uid}`],
      );
      await batch.commit();
      let before = 0,
        after = 0;
      const baseline = new FirestoreRepository(db, {
        projections: false,
        onRead: (n) => (before += n),
      });
      const optimized = new FirestoreRepository(db, { onRead: (n) => (after += n) });
      const oldService = new GameService(baseline, id, { now: () => now }),
        newService = new GameService(optimized, id, { now: () => now });
      const original = await oldService.snapshot(people[0]!.uid);
      await optimized.rebuildReadViews(id);
      after = 0;
      before = 0;
      const baselineViews = await Promise.all(
        people.slice(0, 100).map((p) => oldService.snapshot(p.uid)),
      );
      const start = performance.now();
      const newViews = await Promise.all(
        people.slice(0, 100).map((p) => newService.snapshot(p.uid)),
      );
      const elapsedMs = Math.round(performance.now() - start);
      expect(newViews).toEqual(baselineViews);
      expect(newViews[0]).toEqual(original);
      expect(after).toBeLessThan(before * 0.15);
      const report = {
        users: 100,
        teams: 40,
        baselineReads: before,
        optimizedReads: after,
        reductionPercent: Math.round((1 - after / before) * 100),
        elapsedMs,
      };
      console.log('READ_COST', JSON.stringify(report));
      if (process.env.READ_COST_REPORT)
        writeFileSync(process.env.READ_COST_REPORT, JSON.stringify(report, null, 2) + '\n');
      // Real commands update source and views together, including profile changes.
      await newService.execute(people[0]!, {
        type: 'updateProfile',
        commandId: 'cost-bio',
        bio: 'Updated after backfill',
      });
      expect(
        (await newService.snapshot(people[4]!.uid)).platform!.roster.find(
          (m) => m.uid === people[0]!.uid,
        )?.bio,
      ).toBe('Updated after backfill');
      // Immediate access revocation reads the source member document, not a projection.
      await db.doc(`${root}/members/${people[0]!.uid}`).update({ status: 'suspended' });
      expect((await newService.snapshot(people[0]!.uid)).market.entries).toHaveLength(0);
      // Audit/export paths still read authoritative source collections.
      const raw = await optimized.transaction((tx) => tx.list<Member>(`${root}/members`, 501));
      expect(raw.find((m) => m.uid === people[0]!.uid)?.status).toBe('suspended');
    }, 120000);
    it('atomically overlays insert/update/delete, cleans chunks, and falls back when pages are missing', async () => {
      const repo = new FirestoreRepository(db),
        root = 'events/projection-lifecycle',
        path = `${root}/teams`;
      await repo.transaction(async (tx) => {
        tx.set(`${path}/b`, { id: 'b', value: 1 });
        tx.set(`${path}/a`, { id: 'a', value: 2 });
      });
      expect(await repo.read((tx) => tx.list(path, 41))).toEqual([
        { id: 'a', value: 2 },
        { id: 'b', value: 1 },
      ]);
      await repo.transaction(async (tx) => {
        await tx.list(path, 41);
        tx.delete(`${path}/a`);
        tx.set(`${path}/b`, { id: 'b', value: 3 });
        tx.set(`${path}/c`, { id: 'c', value: 4 });
      });
      expect(await repo.read((tx) => tx.list(path, 1))).toEqual([{ id: 'b', value: 3 }]);
      await db.doc(`${root}/readViews/teams/chunks/0`).delete();
      expect(await repo.read((tx) => tx.list(path, 41))).toEqual([
        { id: 'b', value: 3 },
        { id: 'c', value: 4 },
      ]);
      await repo.transaction(async (tx) => {
        tx.delete(`${path}/b`);
        tx.delete(`${path}/c`);
      });
      expect(await repo.read((tx) => tx.list(path, 41))).toEqual([]);
      // Directly imported oversized collections must never become apparently complete after deletes.
      const batch = db.batch();
      for (let i = 0; i < 42; i++)
        batch.set(db.doc(`${path}/team-${String(i).padStart(2, '0')}`), { id: i });
      await batch.commit();
      await repo.transaction(async (tx) => {
        tx.delete(`${path}/team-00`);
        tx.delete(`${path}/team-01`);
      });
      const remaining = await repo.read((tx) => tx.list<{ id: number }>(path, 41));
      expect(remaining).toHaveLength(40);
      expect(remaining.some((row) => row.id === 41)).toBe(true);
    });
  },
);
