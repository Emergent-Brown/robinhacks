import { readFileSync } from 'node:fs';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { GameService } from '@robinhacks/application';
import type { EventConfig } from '@robinhacks/core';
import {
  createPlatformDemoDocuments,
  PLATFORM_USERS,
} from '../packages/application/src/platform-fixtures';
import { FirestoreRepository } from '../apps/functions/src/firestore-repository';
import {
  createDemoDocuments,
  DEMO_EVENT_ID,
  DEMO_USERS,
} from '../packages/application/src/fixtures';
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

const privatePaths = [
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
        phase: 'SEED_OPEN',
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
    ]) {
      databases[uid] = environment.authenticatedContext(uid).firestore();
    }
    databases.anonymous = environment.unauthenticatedContext().firestore();
    databases['forged-claims'] = environment
      .authenticatedContext('outsider', { role: 'organizer', admin: true, teamId: 'team-a' })
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

  it.each(['anonymous', 'outsider', 'pending', 'suspended', 'foreign-member', 'forged-claims'])(
    'denies %s event and market access',
    async (uid) => {
      const db = databases[uid]!;
      await assertFails(getDoc(doc(db, eventRoot)));
      await assertFails(getDoc(doc(db, `${eventRoot}/views/market`)));
    },
  );

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

  it('uses real buffered Firestore transactions for team approval and resumable funding', async () => {
    const adminApp = initializeApp({ projectId: 'demo-robinhacks' }, 'rules-adapter-integration');
    try {
      const admin = getFirestore(adminApp);
      const id = 'adapter-integration';
      const adapterRoot = `events/${id}`;
      const originalRoot = `events/${DEMO_EVENT_ID}`;
      const now = 10_000_000;
      const fixtures = createDemoDocuments('seed', now);
      const event = fixtures[originalRoot] as EventConfig;
      event.id = id;
      event.phase = 'REGISTRATION';
      const seed = admin.batch();
      for (const [path, value] of Object.entries(fixtures))
        seed.set(
          admin.doc(path.replace(originalRoot, adapterRoot)),
          value as Record<string, unknown>,
        );
      await seed.commit();
      const service = new GameService(new FirestoreRepository(admin), id, { now: () => now });
      const newcomer = { uid: 'adapter-new-captain', displayName: 'Emulator captain' };
      await service.execute(newcomer, {
        type: 'requestMembership',
        commandId: 'adapter-request-0001',
        displayName: newcomer.displayName,
        teamName: 'Emulator Works',
      });
      await service.execute(DEMO_USERS.organizer, {
        type: 'approveMembership',
        commandId: 'adapter-approve-0001',
        uid: newcomer.uid,
        role: 'captain',
      });
      const approved = await service.snapshot(newcomer.uid);
      expect(approved.wallet?.cashMinor).toBe(1_000_000);
      expect(approved.market.entries).toHaveLength(13);
      expect(approved.market.entries.some((entry) => entry.team.name === 'Emulator Works')).toBe(
        true,
      );
      expect(approved.members.some((member) => member.uid === newcomer.uid)).toBe(true);
      await service.execute(DEMO_USERS.organizer, {
        type: 'transitionEvent',
        commandId: 'adapter-open-seed-0001',
        target: 'SEED_OPEN',
        expectedPhaseVersion: approved.event!.phaseVersion,
      });
      await service.execute(newcomer, {
        type: 'setSeedCommitments',
        commandId: 'adapter-commit-seed-0001',
        shares: { 'team-2': 12 },
        expectedWalletVersion: 0,
        expectedCommitmentVersion: 0,
      });
      const opened = await service.snapshot(DEMO_USERS.organizer.uid);
      await service.execute(DEMO_USERS.organizer, {
        type: 'transitionEvent',
        commandId: 'adapter-close-seed-0001',
        target: 'SEED_SETTLING',
        expectedPhaseVersion: opened.event!.phaseVersion,
      });
      for (let i = 0; i < 14; i++) {
        const command = {
          type: 'continueOperation' as const,
          commandId: `adapter-continue-${String(i).padStart(4, '0')}`,
        };
        const first = await service.execute(DEMO_USERS.organizer, command);
        if (i === 0) expect(await service.execute(DEMO_USERS.organizer, command)).toEqual(first);
      }
      const settled = await service.snapshot(newcomer.uid);
      expect(settled.event?.phase).toBe('INTERMISSION');
      expect(settled.wallet?.cashMinor).toBe(880_000);
      expect(settled.wallet?.reservedSeedMinor).toBe(0);
      expect(settled.positions.find((position) => position.issuerId === 'team-2')?.shares).toBe(12);
      expect(
        settled.market.entries.find((entry) => entry.team.id === 'team-2')?.issuer
          .fundingVaultMinor,
      ).toBe(120_000);
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
      for (const [path, value] of Object.entries(createPlatformDemoDocuments('seed', now))) {
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
