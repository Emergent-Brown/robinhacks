import { readFileSync } from 'node:fs';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { GameService } from '@robinhacks/application';
import type { EventConfig } from '@robinhacks/core';
import {
  createPlatformDemoDocuments,
  DEMO_EVENT_ID,
  PLATFORM_USERS,
} from '../packages/application/src/platform-fixtures';
import { FirestoreRepository } from '../apps/functions/src/firestore-repository';
import { FirestorePosterStore } from '../apps/functions/src/firestore-poster-store';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
  type RulesTestContext,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';

/** Private financial data is returned by authenticated callables; own membership has a status listener. */
const emulatorAddress = process.env.FIRESTORE_EMULATOR_HOST;
const eventRoot = 'events/rules-test-event';
const otherEventRoot = 'events/another-event';
let environment: RulesTestEnvironment;
const databases: Record<string, ReturnType<RulesTestContext['firestore']>> = {};
const member = (
  uid: string,
  role = 'member',
  status = 'approved',
  teamId: string | null = 'team-a',
) => ({ uid, displayName: uid, teamId, role, status, version: 1 });

const googleClaims = {
  email_verified: true,
  firebase: { sign_in_provider: 'google.com' as const },
};

const privatePaths = [
  'organizerInvites/invited@example.test',
  'removedMembers/previous-captain',
  'members/captain',
  'members/teammate',
  'members/pending',
  'accessRequests/pending',
  'teams/team-a',
  'teams/team-b',
  'wallets/team-a',
  'wallets/team-b',
  'wallets/team-a/positions/team-b',
  'wallets/team-b/positions/team-a',
  'wallets/team-a/commitments/current',
  'wallets/team-b/commitments/current',
  'wallets/team-a/notes/team-b',
  'wallets/team-b/notes/team-a',
  'wallets/team-a/receipts/trade-command',
  'pools/team-a',
  'issuers/team-a',
  'operations/seed-round',
  'operations/seed-round/units/team-a',
  'manifests/seed-round',
  'results/final-report',
  'results/final-report/teams/team-a',
  'views/seedPublication',
  'adminAudit/admin-command',
  'commandReceipts/captain__admin-command',
  'fundingRounds/funding-1',
  'roundAllocations/funding-1__team-a',
  'roundAllocations/funding-1__team-b',
  'roundEntitlements/funding-1__team-b',
  'conversations/team-a__team-b',
  'teamInboxes/team-b',
  'judgingSheets/judge',
  'communityBallots/team-a',
  'awardResults/current',
  'messageReports/report-one',
];

// The standard unit run excludes this suite. It always requires an explicitly configured emulator.
describe.skipIf(!emulatorAddress)('Firestore client authorization', () => {
  it('increments poster visits atomically, paginates numerically, and denies all direct client access', async () => {
    const app = initializeApp({ projectId: 'demo-robinhacks' }, 'poster-integration');
    try {
      const db = getFirestore(app);
      const store = new FirestorePosterStore(db);
      await Promise.all(Array.from({ length: 20 }, () => store.recordVisit(2)));
      const counter = (await db.doc('posterVisits/2').get()).data()!;
      expect(counter.visits).toBe(20);
      expect(counter.lastVisitedAt.toMillis()).toBeGreaterThan(0);
      const batch = db.batch();
      for (let number = 3; number <= 103; number++) {
        batch.set(db.doc(`posterVisits/${number}`), { ...counter, number, visits: 1 });
      }
      await batch.commit();
      const first = await store.list(0);
      expect(first.items).toHaveLength(100);
      expect(first.items[0].number).toBe(2);
      expect(first.nextCursor).toBe(101);
      const last = await store.list(first.nextCursor!);
      expect(last.items.map((item) => item.number)).toEqual([102, 103]);
      expect(last.nextCursor).toBeNull();
      for (const client of [
        environment.unauthenticatedContext().firestore(),
        ...Object.values(databases),
      ]) {
        const ref = doc(client, 'posterVisits/2');
        await assertFails(getDoc(ref));
        await assertFails(getDocs(collection(client, 'posterVisits')));
        await assertFails(setDoc(doc(client, 'posterVisits/1'), { visits: 999 }));
        await assertFails(updateDoc(ref, { visits: 999 }));
        await assertFails(deleteDoc(ref));
      }
    } finally {
      await deleteApp(app);
    }
  });
  beforeAll(async () => {
    const address = new URL(`http://${emulatorAddress}`);
    environment = await initializeTestEnvironment({
      projectId: 'demo-robinhacks',
      firestore: {
        host: address.hostname,
        port: Number(address.port),
        rules: readFileSync(new URL('../firebase/firestore.rules', import.meta.url), 'utf8'),
      },
    });
    await environment.clearFirestore();
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      const batch = writeBatch(db);
      batch.set(doc(db, eventRoot), {
        id: 'rules-test-event',
        name: 'Rules test',
        phase: 'REGISTRATION',
        phaseVersion: 1,
      });
      batch.set(doc(db, `${eventRoot}/views/market`), { entries: [], phaseVersion: 1 });
      for (const path of privatePaths)
        batch.set(doc(db, `${eventRoot}/${path}`), { sensitive: true, cashMinor: 1_000_000 });
      batch.set(doc(db, `${eventRoot}/members/captain`), member('captain', 'captain'));
      batch.set(doc(db, `${eventRoot}/members/teammate`), member('teammate'));
      batch.set(
        doc(db, `${eventRoot}/members/other-team`),
        member('other-team', 'captain', 'approved', 'team-b'),
      );
      batch.set(
        doc(db, `${eventRoot}/members/organizer`),
        member('organizer', 'organizer', 'approved', null),
      );
      batch.set(doc(db, `${eventRoot}/members/judge`), member('judge', 'judge', 'approved', null));
      batch.set(
        doc(db, `${eventRoot}/members/unassigned`),
        member('unassigned', 'member', 'approved', null),
      );
      batch.set(doc(db, `${eventRoot}/teamInboxes/team-a`), { conversations: [] });
      batch.set(
        doc(db, `${eventRoot}/members/pending`),
        member('pending', 'member', 'pending', null),
      );
      batch.set(
        doc(db, `${eventRoot}/members/suspended`),
        member('suspended', 'captain', 'suspended'),
      );
      batch.set(
        doc(db, `${otherEventRoot}/members/foreign-member`),
        member('foreign-member', 'organizer', 'approved', null),
      );
      batch.set(doc(db, otherEventRoot), { id: 'another-event', phase: 'REGISTRATION' });
      batch.set(doc(db, `${otherEventRoot}/views/market`), { entries: [] });
      await batch.commit();
    });
    for (const uid of [
      'captain',
      'teammate',
      'other-team',
      'organizer',
      'judge',
      'pending',
      'suspended',
      'outsider',
      'foreign-member',
      'unassigned',
    ]) {
      databases[uid] = environment.authenticatedContext(uid, googleClaims).firestore();
    }
    databases.password = environment
      .authenticatedContext('captain', {
        ...googleClaims,
        firebase: { sign_in_provider: 'password' },
      })
      .firestore();
    databases.unverified = environment
      .authenticatedContext('captain', { ...googleClaims, email_verified: false })
      .firestore();
    databases.anonymous = environment.unauthenticatedContext().firestore();
    databases['forged-claims'] = environment
      .authenticatedContext('outsider', {
        ...googleClaims,
        role: 'organizer',
        admin: true,
        teamId: 'team-a',
      })
      .firestore();
  }, 30_000);

  afterAll(async () => {
    if (environment) await environment.cleanup();
  });

  it('keeps the funding projection hidden from judge identities', async () => {
    await assertSucceeds(getDoc(doc(databases.judge!, eventRoot)));
    await assertFails(getDoc(doc(databases.judge!, `${eventRoot}/views/market`)));
    for (const path of [
      'roundAllocations/funding-1__team-a',
      'fundingRounds/funding-1',
      'communityBallots/team-a',
      'judgingSheets/judge',
      'awardResults/current',
    ])
      await assertFails(getDoc(doc(databases.judge!, `${eventRoot}/${path}`)));
  });

  it('allows only approved members of a team to read its inbox listener', async () => {
    for (const uid of ['captain', 'teammate'])
      await assertSucceeds(getDoc(doc(databases[uid]!, `${eventRoot}/teamInboxes/team-a`)));
    for (const uid of [
      'anonymous',
      'organizer',
      'judge',
      'other-team',
      'suspended',
      'pending',
      'forged-claims',
    ])
      await assertFails(getDoc(doc(databases[uid]!, `${eventRoot}/teamInboxes/team-a`)));
    await assertFails(
      setDoc(doc(databases.captain!, `${eventRoot}/teamInboxes/team-a`), { conversations: [] }),
    );
    await assertFails(getDocs(collection(databases.captain!, `${eventRoot}/teamInboxes`)));
  });

  it.each(['captain', 'teammate', 'other-team', 'organizer'])(
    'lets approved %s read the event and public-safe market projection',
    async (uid) => {
      const db = databases[uid]!;
      expect((await assertSucceeds(getDoc(doc(db, eventRoot)))).exists()).toBe(true);
      expect((await assertSucceeds(getDoc(doc(db, `${eventRoot}/views/market`)))).exists()).toBe(
        true,
      );
    },
  );

  it.each([
    'anonymous',
    'outsider',
    'pending',
    'suspended',
    'foreign-member',
    'forged-claims',
    'password',
    'unverified',
  ])('denies %s event and market access', async (uid) => {
    const db = databases[uid]!;
    await assertFails(getDoc(doc(db, eventRoot)));
    await assertFails(getDoc(doc(db, `${eventRoot}/views/market`)));
  });

  it('does not carry membership across event boundaries', async () => {
    await assertFails(getDoc(doc(databases.captain!, otherEventRoot)));
    await assertFails(getDoc(doc(databases.organizer!, `${otherEventRoot}/views/market`)));
    await assertSucceeds(getDoc(doc(databases['foreign-member']!, otherEventRoot)));
  });

  it.each(['captain', 'teammate', 'organizer', 'pending', 'suspended'])(
    'lets %s read only their own membership for status notifications',
    async (uid) => {
      const db = databases[uid]!;
      expect(
        (await assertSucceeds(getDoc(doc(db, `${eventRoot}/members/${uid}`)))).data()?.uid,
      ).toBe(uid);
      await assertFails(
        getDoc(doc(db, `${eventRoot}/members/${uid === 'captain' ? 'teammate' : 'captain'}`)),
      );
    },
  );

  it('lets an authenticated newcomer observe their absent membership without granting event access', async () => {
    const snapshot = await assertSucceeds(
      getDoc(doc(databases.outsider!, `${eventRoot}/members/outsider`)),
    );
    expect(snapshot.exists()).toBe(false);
    await assertFails(getDoc(doc(databases.anonymous!, `${eventRoot}/members/captain`)));
  });

  it.each(privatePaths)(
    'prevents direct access to private or other-member data at %s',
    async (path) => {
      const viewer = path === 'members/captain' ? databases.teammate! : databases.captain!;
      await assertFails(getDoc(doc(viewer, `${eventRoot}/${path}`)));
      await assertFails(getDoc(doc(databases.organizer!, `${eventRoot}/${path}`)));
    },
  );

  it.each([
    'members',
    'wallets',
    'pools',
    'issuers',
    'views',
    'results',
    'manifests',
    'adminAudit',
    'commandReceipts',
    'wallets/team-a/positions',
    'wallets/team-a/notes',
    'wallets/team-a/receipts',
  ])('denies direct enumeration of %s', async (path) => {
    await assertFails(getDocs(collection(databases.captain!, `${eventRoot}/${path}`)));
    await assertFails(getDocs(collection(databases.organizer!, `${eventRoot}/${path}`)));
  });

  it.each(['', 'views/market', ...privatePaths])(
    'denies participant and organizer writes to %s',
    async (path) => {
      const fullPath = path ? `${eventRoot}/${path}` : eventRoot;
      for (const uid of ['captain', 'organizer']) {
        const ref = doc(databases[uid]!, fullPath);
        await assertFails(
          setDoc(
            ref,
            { cashMinor: 9_999_999, status: 'approved', role: 'organizer' },
            { merge: true },
          ),
        );
        await assertFails(updateDoc(ref, { cashMinor: 9_999_999 }));
        await assertFails(deleteDoc(ref));
      }
    },
  );

  it('blocks self-enrollment, role promotion and fake command receipts', async () => {
    await assertFails(
      setDoc(
        doc(databases.outsider!, `${eventRoot}/members/outsider`),
        member('outsider', 'organizer', 'approved', null),
      ),
    );
    await assertFails(
      updateDoc(doc(databases.pending!, `${eventRoot}/members/pending`), {
        status: 'approved',
        role: 'captain',
        teamId: 'team-a',
      }),
    );
    await assertFails(
      setDoc(doc(databases.captain!, `${eventRoot}/wallets/team-a/receipts/forged-trade`), {
        acceptedAt: Date.now(),
        totalMinor: 0,
      }),
    );
    await assertFails(
      setDoc(doc(databases.anonymous!, 'events/forged-event'), { phase: 'FINALIZED' }),
    );
  });

  it('isolates unassigned participants, reserves formation roles atomically, and revokes removed users', async () => {
    await assertSucceeds(getDoc(doc(databases.unassigned!, eventRoot)));
    await assertFails(getDoc(doc(databases.unassigned!, `${eventRoot}/views/market`)));
    await assertFails(getDoc(doc(databases.unassigned!, `${eventRoot}/teamInboxes/team-a`)));
    const adminApp = initializeApp({ projectId: 'demo-robinhacks' }, 'formation-adapter');
    try {
      const admin = getFirestore(adminApp);
      const id = 'formation-adapter';
      const root = `events/${id}`;
      const now = Date.now();
      const fixtures = createPlatformDemoDocuments('registration', now);
      const originalRoot = `events/${DEMO_EVENT_ID}`;
      const event = fixtures[originalRoot] as EventConfig;
      event.id = id;
      const batch = admin.batch();
      for (const [path, value] of Object.entries(fixtures))
        batch.set(admin.doc(path.replace(originalRoot, root)), value as Record<string, unknown>);
      await batch.commit();
      const service = new GameService(new FirestoreRepository(admin), id, { now: () => now });
      const newcomers = ['one', 'two', 'three'].map((name) => ({
        uid: `formation-${name}`,
        displayName: `Attendee ${name}`,
        email: `${name}@example.test`,
        emailVerified: true,
      }));
      for (const newcomer of newcomers) {
        await service.execute(newcomer, {
          type: 'requestMembership',
          commandId: `request-${newcomer.uid}`,
          displayName: newcomer.displayName,
        });
        await service.execute(PLATFORM_USERS.organizer, {
          type: 'approveMembership',
          commandId: `approve-${newcomer.uid}`,
          uid: newcomer.uid,
        });
      }
      const before = await service.snapshot(newcomers[0]!.uid);
      expect(before.member?.teamId).toBeNull();
      expect(before.market.entries).toEqual([]);
      await service.execute(PLATFORM_USERS.organizer, {
        type: 'setTeamFormation',
        commandId: 'formation-open-0001',
        open: true,
        expectedPhaseVersion: before.event!.phaseVersion,
      });
      await service.execute(newcomers[0]!, {
        type: 'createFormationTeam',
        commandId: 'formation-create-0001',
        name: 'Emulator Works',
        role: 'captain',
      });
      const created = await service.snapshot(newcomers[0]!.uid);
      const teamId = created.member!.teamId!;
      const claims = await Promise.allSettled(
        newcomers.slice(1).map((actor) =>
          service.execute(actor, {
            type: 'joinFormationTeam',
            commandId: `join-${actor.uid}`,
            teamId,
            role: 'trader',
          }),
        ),
      );
      expect(claims.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const roster = await admin.collection(`${root}/members`).where('teamId', '==', teamId).get();
      expect(roster.docs.filter((doc) => doc.data().role === 'trader')).toHaveLength(1);
      const client = environment.authenticatedContext(newcomers[0]!.uid, googleClaims).firestore();
      await assertSucceeds(getDoc(doc(client, root)));
      await service.execute(PLATFORM_USERS.organizer, {
        type: 'removeMember',
        commandId: 'formation-remove-0001',
        uid: newcomers[0]!.uid,
      });
      await assertFails(getDoc(doc(client, root)));
      await assertFails(getDoc(doc(client, `${root}/views/market`)));
      expect((await service.snapshot(newcomers[0]!.uid)).member).toBeNull();
      await admin.doc(root).update({ maintenance: true });
      const organizerClient = environment
        .authenticatedContext(PLATFORM_USERS.organizer.uid, googleClaims)
        .firestore();
      await assertFails(getDoc(doc(organizerClient, root)));
      await expect(service.snapshot(PLATFORM_USERS.organizer.uid)).rejects.toThrow();
    } finally {
      await deleteApp(adminApp);
    }
  }, 60_000);

  it('atomically closes a sealed round with the real Firestore repository and private snapshots', async () => {
    let now = Date.now();
    const id = 'sealed-adapter-event';
    const adminApp = initializeApp({ projectId: 'demo-robinhacks' }, 'sealed-adapter');
    const db = getFirestore(adminApp);
    try {
      const batch = db.batch();
      for (const [path, value] of Object.entries(
        createPlatformDemoDocuments('registration', now),
      )) {
        const target = path.replace(`events/${DEMO_EVENT_ID}`, `events/${id}`);
        batch.set(
          db.doc(target),
          target === `events/${id}`
            ? { ...(value as EventConfig), id }
            : (value as Record<string, unknown>),
        );
      }
      await batch.commit();
      const service = new GameService(new FirestoreRepository(db), id, { now: () => now });
      const initial = await service.snapshot(PLATFORM_USERS.organizer.uid);
      await service.execute(PLATFORM_USERS.organizer, {
        type: 'openFundingRound',
        commandId: 'sealed-open-round-1',
        expectedPhaseVersion: initial.event!.phaseVersion,
        durationMinutes: 1,
      });
      const command = {
        type: 'saveAllocation' as const,
        commandId: 'sealed-allocation-one',
        roundId: 'funding-1',
        expectedVersion: 0,
        amounts: { 'team-2': 60, 'team-3': 40 },
      };
      const accepted = await service.execute(PLATFORM_USERS.captain, command);
      expect(await service.execute(PLATFORM_USERS.captain, command)).toEqual(accepted);
      expect(
        (await service.snapshot(PLATFORM_USERS.organizer.uid)).platform?.rounds[0].totals,
      ).toEqual({});
      expect((await service.snapshot(PLATFORM_USERS.judge.uid)).platform?.allocation).toBeNull();
      const competing = await Promise.allSettled([
        service.execute(PLATFORM_USERS.captain, {
          ...command,
          commandId: 'sealed-concurrent-one',
          expectedVersion: 1,
          amounts: { 'team-2': 50, 'team-3': 50 },
        }),
        service.execute(PLATFORM_USERS.captain, {
          ...command,
          commandId: 'sealed-concurrent-two',
          expectedVersion: 1,
          amounts: { 'team-2': 40, 'team-3': 60 },
        }),
      ]);
      expect(competing.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      now += 61_000;
      const before = await service.snapshot(PLATFORM_USERS.organizer.uid);
      await service.execute(PLATFORM_USERS.organizer, {
        type: 'closeFundingRound',
        commandId: 'sealed-close-round-1',
        roundId: 'funding-1',
        expectedPhaseVersion: before.event!.phaseVersion,
      });
      const closed = await service.snapshot(PLATFORM_USERS.captain.uid);
      expect(closed.event?.phase).toBe('INTERMISSION');
      expect(closed.platform?.entitlements[0].spent).toBe(100);
      expect(
        Object.values(closed.platform!.rounds[0].totals).reduce((sum, value) => sum + value, 0),
      ).toBe(100);
      expect((await service.snapshot(PLATFORM_USERS.judge.uid)).platform?.rounds[0].totals).toEqual(
        {},
      );
      expect((await db.collection(`events/${id}/wallets`).get()).empty).toBe(true);
    } finally {
      await deleteApp(adminApp);
    }
  }, 60_000);

  it('rejects a batch that tries to transfer credits between wallets', async () => {
    const batch = writeBatch(databases.captain!);
    batch.update(doc(databases.captain!, `${eventRoot}/wallets/team-a`), { cashMinor: 2_000_000 });
    batch.update(doc(databases.captain!, `${eventRoot}/wallets/team-b`), { cashMinor: 0 });
    await assertFails(batch.commit());
    await environment.withSecurityRulesDisabled(async (context) => {
      expect(
        (await getDoc(doc(context.firestore(), `${eventRoot}/wallets/team-a`))).data()?.cashMinor,
      ).toBe(1_000_000);
      expect(
        (await getDoc(doc(context.firestore(), `${eventRoot}/wallets/team-b`))).data()?.cashMinor,
      ).toBe(1_000_000);
    });
  });
});
