#!/usr/bin/env node
/** Explicit, idempotent migration for an event that has not started investing. */
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Firestore } from 'firebase-admin/firestore';
import { OAuth2Client } from 'google-auth-library';
import { cliCredential } from './bootstrap-firebase.mjs';
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const projectIndex = args.indexOf('--project');
const project = projectIndex >= 0 ? args[projectIndex + 1] : '';
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
async function main() {
  assert(
    args.length === (apply ? 3 : 2) && projectIndex >= 0,
    'Usage: node --env-file=.env.operations scripts/upgrade-sealed-funding.mjs --project <configured-project> [--apply]',
  );
  const config = JSON.parse(await readFile('.firebaserc', 'utf8'));
  assert(project === config.projects?.default, 'Project must match this repository’s .firebaserc.');
  assert(
    !process.env.FIREBASE_TOKEN &&
      !process.env.FIRESTORE_EMULATOR_HOST &&
      !process.env.FIREBASE_AUTH_EMULATOR_HOST,
    'Unset token and emulator overrides.',
  );
  const { credential, identity } = await cliCredential();
  const app = initializeApp({ projectId: project, credential }, 'sealed-migration');
  const oauth = new OAuth2Client();
  oauth.refreshHandler = async () => {
    const token = await credential.getAccessToken();
    return { access_token: token.access_token, expiry_date: Date.now() + token.expires_in * 1000 };
  };
  const db = new Firestore({ projectId: project, authClient: oauth, preferRest: true });
  try {
    const owner = await getAuth(app).getUserByEmail(identity.email);
    const root = db.doc('events/robinhacks-2026');
    const bundle = await build({
      entryPoints: ['packages/core/src/platform.ts'],
      bundle: true,
      format: 'esm',
      platform: 'node',
      write: false,
    });
    const { defaultPlatformConfig } = await import(
      'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64')
    );
    const report = await db.runTransaction(async (tx) => {
      const [eventSnap, memberSnap, teamsSnap, walletsSnap, issuersSnap, roundsSnap] =
        await Promise.all([
          tx.get(root),
          tx.get(root.collection('members').doc(owner.uid)),
          tx.get(root.collection('teams')),
          tx.get(root.collection('wallets')),
          tx.get(root.collection('issuers')),
          tx.get(root.collection('fundingRounds')),
        ]);
      assert(eventSnap.exists, 'Bootstrap the initial event first.');
      const event = eventSnap.data(),
        member = memberSnap.data();
      assert(
        member?.role === 'organizer' && member.status === 'approved' && member.teamId === null,
        'The verified login must already be an approved separate organizer.',
      );
      if (event.platform?.version === 2)
        return { alreadyUpgraded: true, phase: event.phase, teams: teamsSnap.size, writes: 0 };
      assert(
        ['DRAFT', 'REGISTRATION'].includes(event.phase) &&
          !event.activeOperationId &&
          !event.publishedResultId,
        'An event that has started must be preserved; create a separately versioned event instead.',
      );
      assert(roundsSnap.empty, 'Unexpected funding rounds already exist.');
      assert(
        issuersSnap.docs.every((doc) => doc.data().fundingVaultMinor === 0),
        'Historical funding exists; no automatic conversion is allowed.',
      );
      for (const wallet of walletsSnap.docs) {
        assert(
          wallet.data().cashMinor === 1_000_000 && wallet.data().reservedSeedMinor === 0,
          'A legacy wallet has been used; no automatic conversion is allowed.',
        );
        const [positions, commitment, receipts] = await Promise.all([
          tx.get(wallet.ref.collection('positions')),
          tx.get(wallet.ref.collection('commitments').doc('current')),
          tx.get(wallet.ref.collection('receipts')),
        ]);
        assert(
          positions.empty &&
            Object.values(commitment.data()?.shares || {}).every((value) => value === 0) &&
            receipts.docs.every((doc) => doc.data().kind === 'genesis'),
          'Historical financial activity exists; no automatic conversion is allowed.',
        );
      }
      const now = Date.now();
      const upgraded = {
        ...event,
        name: 'Emergent Hacks 2026',
        venue: ['Silicon Valley', 'Hackathon'].includes(event.venue) ? '' : event.venue,
        rulesVersion: 2,
        phase: 'REGISTRATION',
        phaseVersion: event.phaseVersion + 1,
        windowId: 0,
        closesAt: null,
        paused: false,
        pauseReason: '',
        platform: defaultPlatformConfig(),
      };
      if (apply) {
        tx.set(root.collection('migrations').doc('sealed-v2'), {
          previousEvent: event,
          migratedAt: now,
          actorUid: owner.uid,
          legacyFinancialActivity: false,
        });
        tx.set(root, upgraded);
        tx.set(memberSnap.ref, {
          ...member,
          email: owner.email,
          emailVerified: owner.emailVerified === true,
        });
        tx.set(root.collection('views').doc('market'), {
          entries: teamsSnap.docs.map((doc) => ({
            team: doc.data(),
            pool: {
              issuerId: doc.id,
              shareReserve: 0,
              creditReserveMinor: 0,
              version: 0,
              halted: false,
            },
            issuer: {
              issuerId: doc.id,
              issuedShares: 0,
              primarySharesRemaining: 0,
              fundingVaultMinor: 0,
              seedBackers: 0,
              version: 0,
            },
          })),
          asOf: now,
          phaseVersion: upgraded.phaseVersion,
        });
        tx.set(root.collection('adminAudit').doc('sealed-v2-migration'), {
          id: 'sealed-v2-migration',
          actorUid: owner.uid,
          action: 'upgradeSealedFunding',
          detail:
            'Enabled three sealed funding rounds before any financial activity. Prior metadata archived; existing identities and project records retained.',
          createdAt: now,
        });
      }
      return {
        alreadyUpgraded: false,
        project,
        eventId: event.id,
        phase: event.phase,
        teams: teamsSnap.size,
        legacyFinancialActivity: false,
        mode: apply ? 'applied' : 'read-only preflight',
        writes: apply ? 5 : 0,
      };
    });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await db.terminate();
    await deleteApp(app);
  }
}
main().catch((error) => {
  console.error(
    error.message?.includes('Usage:') ||
      error.message?.includes('must') ||
      error.message?.includes('exists') ||
      error.message?.includes('Historical') ||
      error.message?.includes('event that has started')
      ? error.message
      : 'Migration stopped. Check configuration and the existing organizer login. Credential-bearing service details were withheld.',
  );
  process.exitCode = 1;
});
