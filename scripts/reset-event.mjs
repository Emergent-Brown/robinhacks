#!/usr/bin/env node
/** Reset the configured event and its dedicated Auth project, retaining its owner. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Firestore } from 'firebase-admin/firestore';
import { OAuth2Client } from 'google-auth-library';
import { cliCredential, createInitialEvent } from './bootstrap-firebase.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const eventId = 'robinhacks-2026';
const ownerEmail = 'shulman.aj@gmail.com';
const requireThat = (condition, message) => {
  if (!condition) throw new Error(message);
};

/** Walk nested collections as well as parent-less documents; refuse unexpectedly large resets. */
async function collectDocuments(ref, documents = []) {
  const snapshot = await ref.get();
  if (snapshot.exists) documents.push({ path: ref.path, data: snapshot.data() });
  requireThat(
    documents.length <= 20_000,
    'More than 20,000 event documents found. Review scope before resetting.',
  );
  for (const collection of await ref.listCollections())
    for (const child of await collection.listDocuments()) await collectDocuments(child, documents);
  return documents;
}

async function usersIn(auth) {
  const users = [];
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
    requireThat(
      users.length <= 1000,
      'More than 1,000 Auth accounts found. Review scope before resetting.',
    );
  } while (pageToken);
  return users;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log(
      'Usage: node --env-file=.env.operations scripts/reset-event.mjs --project <configured-project-id> [--apply]\nDefault: read-only preflight. --apply backs up event data, deletes all event records and other Auth users, and rebuilds registration with the verified owner only. Deploy the maintenance-aware server before applying.',
    );
    return;
  }
  const projectIndex = args.indexOf('--project');
  const projectId = projectIndex >= 0 ? args[projectIndex + 1] : '';
  const apply = args.includes('--apply');
  requireThat(
    projectId &&
      args.every((arg, i) => arg === '--project' || arg === '--apply' || i === projectIndex + 1),
    'Supply --project and optionally --apply.',
  );
  const configuration = JSON.parse(await readFile(resolve(root, '.firebaserc'), 'utf8'));
  requireThat(
    projectId === configuration.projects?.default,
    'The explicit project must exactly match projects.default in .firebaserc.',
  );
  requireThat(
    process.env.ROBINHACKS_ORGANIZER_EMAIL?.trim().toLowerCase() === ownerEmail,
    'Set ROBINHACKS_ORGANIZER_EMAIL to the retained owner in .env.operations.',
  );
  requireThat(
    !process.env.FIRESTORE_EMULATOR_HOST &&
      !process.env.FIREBASE_AUTH_EMULATOR_HOST &&
      !process.env.FIREBASE_TOKEN,
    'Unset emulator variables and FIREBASE_TOKEN; only the verified CLI login is accepted.',
  );
  const { credential, identity } = await cliCredential();
  const app = initializeApp({ projectId, credential }, `reset-${Date.now()}`);
  const auth = getAuth(app);
  const oauth = new OAuth2Client();
  oauth.refreshHandler = async () => {
    const token = await credential.getAccessToken();
    return { access_token: token.access_token, expiry_date: Date.now() + token.expires_in * 1000 };
  };
  const db = new Firestore({ projectId, authClient: oauth, preferRest: true });
  try {
    const owner = await auth.getUserByEmail(ownerEmail);
    requireThat(
      owner.emailVerified &&
        !owner.disabled &&
        owner.providerData.some(
          (provider) => provider.providerId === 'google.com' && provider.uid === identity.sub,
        ),
      'The retained owner must be enabled, verified, and linked to this Google identity.',
    );
    const eventRef = db.doc(`events/${eventId}`);
    const initialSnapshot = await eventRef.get();
    const current = initialSnapshot.data();
    requireThat(
      current?.id === eventId && current.rulesVersion === 2 && current.platform?.version === 2,
      'The current event must use the supported sealed-round format.',
    );
    const ownerMember = (await eventRef.collection('members').doc(owner.uid).get()).data();
    requireThat(
      ownerMember?.role === 'organizer' &&
        ownerMember.status === 'approved' &&
        ownerMember.teamId === null,
      'The retained owner must already be an approved organizer.',
    );
    const eventRoots = await db.collection('events').listDocuments();
    requireThat(
      eventRoots.length === 1 && eventRoots[0].id === eventId,
      'This project has other events. Refusing to remove shared Auth users.',
    );
    const users = await usersIn(auth);
    const documents = await collectDocuments(eventRef);
    const collections = {};
    for (const { path } of documents) {
      const name = path.split('/')[2] || '(event)';
      collections[name] = (collections[name] || 0) + 1;
    }
    console.log(
      JSON.stringify(
        {
          mode: apply ? 'apply' : 'preflight',
          projectId,
          eventId,
          retainedOwner: ownerEmail,
          authAccounts: users.length,
          authAccountsToDelete: users.filter((user) => user.uid !== owner.uid).length,
          eventDocuments: documents.length,
          collections,
          preserves: [
            'Public schedule, logistics, funding configuration',
            'Global poster visit counts',
          ],
        },
        null,
        2,
      ),
    );
    if (!apply) return;

    // Every application transaction reads this root. Updating it conflicts with
    // in-flight writes; all subsequent calls fail until the final commit below.
    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(eventRef);
      requireThat(
        snapshot.updateTime?.isEqual(initialSnapshot.updateTime),
        'The event changed during preflight. Rerun to review the current state.',
      );
      tx.update(eventRef, { maintenance: true, phaseVersion: current.phaseVersion + 1 });
    });
    const lockedDocuments = await collectDocuments(eventRef);
    const backupPath = resolve(
      root,
      'backups',
      `event-reset-${new Date().toISOString().replaceAll(':', '-')}`,
    );
    await mkdir(backupPath, { recursive: true, mode: 0o700 });
    const backup = {
      format: 'event-reset-backup-v1',
      projectId,
      eventId,
      createdAt: new Date().toISOString(),
      eventBeforeReset: current,
      documents: lockedDocuments,
      accounts: users.map((user) => ({
        uid: user.uid,
        email: user.email || null,
        displayName: user.displayName || null,
        providers: user.providerData.map((provider) => provider.providerId),
      })),
    };
    await writeFile(resolve(backupPath, 'event.json'), JSON.stringify(backup, null, 2), {
      mode: 0o600,
      flag: 'wx',
    });
    console.log(
      `Backup saved to ${backupPath}. Maintenance is active until reset verification succeeds.`,
    );
    for (const collection of await eventRef.listCollections()) {
      if (collection.id !== 'members') await db.recursiveDelete(collection);
      else {
        // Keep the owner's authority present even if a later deletion fails.
        for (const memberRef of await collection.listDocuments()) {
          if (memberRef.id !== owner.uid) await db.recursiveDelete(memberRef);
          else
            for (const nested of await memberRef.listCollections())
              await db.recursiveDelete(nested);
        }
      }
    }
    // Re-list after locking to include accounts created during preflight.
    const otherUsers = (await usersIn(auth)).filter((user) => user.uid !== owner.uid);
    for (let offset = 0; offset < otherUsers.length; offset += 1000) {
      const result = await auth.deleteUsers(
        otherUsers.slice(offset, offset + 1000).map((user) => user.uid),
      );
      requireThat(
        result.failureCount === 0,
        'Some Auth accounts could not be deleted. Maintenance remains on; rerun after resolving the failure.',
      );
    }
    const fresh = await createInitialEvent();
    fresh.name = current.name;
    fresh.venue = current.venue;
    fresh.phaseVersion = current.phaseVersion + 2;
    fresh.platform.details = current.platform.details || fresh.platform.details;
    fresh.platform.funding = current.platform.funding;
    const organizer = {
      uid: owner.uid,
      displayName: owner.displayName?.slice(0, 60) || 'AJ Shulman',
      email: ownerEmail,
      emailVerified: true,
      teamId: null,
      role: 'organizer',
      status: 'approved',
      version: 0,
    };
    // Restore owner before verification so a failed reset remains resumable.
    const batch = db.batch();
    batch.set(eventRef, { ...fresh, maintenance: true });
    batch.set(eventRef.collection('members').doc(owner.uid), organizer);
    batch.set(eventRef.collection('views').doc('market'), {
      entries: [],
      asOf: Date.now(),
      phaseVersion: fresh.phaseVersion,
    });
    await batch.commit();
    const remainingUsers = await usersIn(auth);
    const remainingDocuments = await collectDocuments(eventRef);
    requireThat(
      remainingUsers.length === 1 && remainingUsers[0].uid === owner.uid,
      'An unexpected Auth account remains. Maintenance stays enabled; rerun reset.',
    );
    requireThat(
      remainingDocuments.length === 3,
      'Unexpected event data remains. Maintenance stays enabled; review the project.',
    );
    await eventRef.update({ maintenance: false });
    console.log(
      JSON.stringify(
        {
          completed: true,
          authAccounts: 1,
          members: 1,
          teams: 0,
          projects: 0,
          phase: 'REGISTRATION',
          teamFormationOpen: false,
          backupPath,
        },
        null,
        2,
      ),
    );
  } finally {
    await db.terminate();
    await deleteApp(app);
  }
}

main().catch((error) => {
  // SDK errors can include request/credential details. Print only our own errors.
  const message =
    error.constructor === Error
      ? error.message
      : `Service error (${typeof error.code === 'string' || typeof error.code === 'number' ? error.code : 'unknown'}).`;
  console.error(
    `Reset stopped: ${message} If apply had begun, leave maintenance enabled until recovery completes.`,
  );
  process.exitCode = 1;
});
