#!/usr/bin/env node
/**
 * Read-only infrastructure verification of the initial production event.
 * Checks the existing owner Auth identity, Firestore configuration, and unauthenticated denial.
 * Does not sign in to the web app, create users, or call any authenticated game endpoint.
 * Credentials stay in memory; Firebase CLI may refresh its own managed login cache.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { cliCredential } from './bootstrap-firebase.mjs';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Firestore } from 'firebase-admin/firestore';
import { OAuth2Client } from 'google-auth-library';

const PROJECT = 'robinhacks-2026-ajs';
const EVENT = 'robinhacks-2026';
const OWNER = process.env.ROBINHACKS_ORGANIZER_EMAIL?.trim().toLowerCase() || '';
const REGION = 'us-west1';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
class VerificationError extends Error {}
function assert(condition, message) {
  if (!condition) throw new VerificationError(message);
}
const checks = [];
let verificationStage = 'configuration';
function pass(name) {
  checks.push(name);
  console.log(`PASS ${name}`);
}

async function main() {
  assert(
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(OWNER) && !OWNER.endsWith('@example.com'),
    'Set ROBINHACKS_ORGANIZER_EMAIL in the ignored .env.operations file and load it with node --env-file=.env.operations.',
  );
  assert(
    process.argv.length === 2,
    'Usage: node scripts/verify-firebase.mjs. This verifier targets only the configured production project.',
  );
  assert(
    !process.env.FIREBASE_TOKEN &&
      !process.env.FIRESTORE_EMULATOR_HOST &&
      !process.env.FIREBASE_AUTH_EMULATOR_HOST,
    'Unset Firebase token and emulator overrides before production verification.',
  );
  const config = JSON.parse(await readFile(join(ROOT, '.firebaserc'), 'utf8'));
  assert(
    config.projects?.default === PROJECT,
    `The repository default project must be ${PROJECT}.`,
  );
  const environment = Object.fromEntries(
    (await readFile(join(ROOT, 'apps/web/.env.production'), 'utf8'))
      .split(/\r?\n/)
      .filter((line) => /^[A-Z0-9_]+=/.test(line))
      .map((line) => {
        const index = line.indexOf('=');
        return [
          line.slice(0, index),
          line
            .slice(index + 1)
            .trim()
            .replace(/^(['"])(.*)\1$/, '$2'),
        ];
      }),
  );
  assert(
    environment.VITE_FIREBASE_PROJECT_ID === PROJECT &&
      environment.VITE_EVENT_ID === EVENT &&
      environment.VITE_FIREBASE_REGION === REGION,
    'Production web configuration does not match the verifier’s project, event, and region.',
  );
  assert(
    environment.VITE_FIREBASE_AUTH_DOMAIN === `${PROJECT}.firebaseapp.com`,
    'Production Auth domain does not match the configured project.',
  );
  assert(
    /^AIza[A-Za-z0-9_-]+$/.test(environment.VITE_FIREBASE_API_KEY || ''),
    'A public Firebase web API key is required in apps/web/.env.production.',
  );
  verificationStage = 'deployed unauthenticated callable';
  const base = `https://${REGION}-${PROJECT}.cloudfunctions.net`;
  // No authentication and no command are supplied: transport must reject before any application mutation.
  const deniedResponse = await fetch(`${base}/gameCommand`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { eventId: EVENT } }),
    signal: AbortSignal.timeout(60_000),
  });
  assert(
    deniedResponse.headers.get('content-type')?.includes('application/json'),
    `Production gameCommand returned a non-JSON response (HTTP ${deniedResponse.status}).`,
  );
  const deniedBody = await deniedResponse.json();
  assert(
    deniedResponse.status === 401 && deniedBody.error?.details?.code === 'SIGN_IN_REQUIRED',
    'An unauthenticated production command did not receive the required sign-in denial.',
  );
  pass('Production gameCommand rejects unauthenticated requests');
  verificationStage = 'verified CLI identity';
  const { credential, identity } = await cliCredential();
  const subject = identity.sub;
  verificationStage = 'runtime service account IAM';
  const runtimeServiceAccount = '594324444355-compute@developer.gserviceaccount.com';
  const iamToken = await credential.getAccessToken();
  const iamResponse = await fetch(
    `https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}:getIamPolicy`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${iamToken.access_token}`,
      },
      body: JSON.stringify({ options: { requestedPolicyVersion: 3 } }),
      signal: AbortSignal.timeout(20_000),
    },
  );
  assert(iamResponse.ok, `Could not read project IAM policy (HTTP ${iamResponse.status}).`);
  const iamPolicy = await iamResponse.json();
  const runtimeRoles = (iamPolicy.bindings || [])
    .filter(
      (binding) =>
        !binding.condition && binding.members?.includes(`serviceAccount:${runtimeServiceAccount}`),
    )
    .map((binding) => binding.role)
    .sort();
  const runtimeFirestoreRoleConfigured = runtimeRoles.some((role) =>
    [
      'roles/datastore.user',
      'roles/datastore.owner',
      'roles/editor',
      'roles/owner',
      'roles/firebase.admin',
      'roles/firebase.sdkAdminServiceAgent',
    ].includes(role),
  );
  if (runtimeFirestoreRoleConfigured)
    pass('Runtime service account has a directly assigned Firestore data-access role');
  else
    console.log(
      'CHECK Runtime service account has no directly assigned standard Firestore data-access role. Review project IAM before live use.',
    );

  const app = initializeApp({ projectId: PROJECT, credential }, `verify-${Date.now()}`);
  const oauth = new OAuth2Client();
  oauth.refreshHandler = async () => {
    const token = await credential.getAccessToken();
    return { access_token: token.access_token, expiry_date: Date.now() + token.expires_in * 1000 };
  };
  const db = new Firestore({ projectId: PROJECT, authClient: oauth, preferRest: true });
  try {
    verificationStage = 'existing organizer Auth identity';
    const owner = await getAuth(app).getUserByEmail(OWNER);
    assert(
      !owner.disabled &&
        owner.emailVerified &&
        owner.providerData.some(
          (provider) => provider.providerId === 'google.com' && provider.uid === subject,
        ),
      'Bootstrap and link the existing verified owner before running this verifier. No new users are created here.',
    );
    pass('Existing owner Auth identity matches the verified Google CLI login');

    verificationStage = 'initial Firestore event';
    const eventRef = db.doc(`events/${EVENT}`);
    const [eventDocument, memberDocument, marketDocument] = await db.getAll(
      eventRef,
      eventRef.collection('members').doc(owner.uid),
      eventRef.collection('views').doc('market'),
    );
    const [teams, rounds, submissions, members, requests, accounts] = await Promise.all([
      eventRef.collection('teams').limit(1).get(),
      eventRef.collection('fundingRounds').limit(1).get(),
      eventRef.collection('submissions').limit(1).get(),
      eventRef.collection('members').get(),
      eventRef.collection('accessRequests').limit(1).get(),
      getAuth(app).listUsers(1000),
    ]);
    assert(
      accounts.users.length === 1 && !accounts.pageToken && accounts.users[0].uid === owner.uid,
      'Unexpected Auth accounts remain in the initial project.',
    );
    assert(
      members.size === 1 && requests.empty,
      'Expected only the owner membership and no pending access requests.',
    );
    const event = eventDocument.data();
    const member = memberDocument.data();
    const market = marketDocument.data();
    assert(
      eventDocument.exists &&
        event?.id === EVENT &&
        event.phase === 'REGISTRATION' &&
        event.rulesVersion === 2 &&
        event.platform?.version === 2 &&
        event.platform.currentRound === 0 &&
        event.platform.teamFormationOpen === false &&
        event.maintenance !== true,
      'The production event is not in its initial supported REGISTRATION phase. This initial-state verifier did not change it.',
    );
    assert(
      memberDocument.exists &&
        member?.uid === owner.uid &&
        member.role === 'organizer' &&
        member.status === 'approved' &&
        member.teamId === null,
      'The owner does not have the expected separate approved organizer membership.',
    );
    assert(
      marketDocument.exists &&
        Array.isArray(market?.entries) &&
        market.entries.length === 0 &&
        teams.empty &&
        rounds.empty &&
        submissions.empty,
      'The production event has teams, rounds, or submissions, or its project projection is missing. This initial-state verifier did not change it.',
    );
    pass(
      'Firestore contains sealed-round REGISTRATION, approved organizer, and only the owner and zero teams, rounds, or submissions',
    );
    const publicResponse = await fetch(
      `https://${REGION}-${PROJECT}.cloudfunctions.net/gamePublic`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { eventId: EVENT } }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    const publicBody = await publicResponse.json();
    assert(
      publicResponse.ok &&
        publicBody.result?.event?.platform?.version === 2 &&
        publicBody.result.member === null &&
        publicBody.result.market?.entries?.length === 0 &&
        publicBody.result.members?.length === 0,
      'The public homepage endpoint did not return isolated sealed-round event metadata.',
    );
    pass('Deployed gamePublic serves event metadata without private membership or funding records');
    console.log(
      JSON.stringify(
        {
          success: runtimeFirestoreRoleConfigured,
          verification: 'Initial production infrastructure only',
          project: PROJECT,
          eventId: EVENT,
          phase: event.phase,
          teams: 0,
          checks: checks.length,
          applicationWrites: 0,
          authenticatedCallableVerified: false,
          runtimeServiceAccount,
          runtimeRoles,
          runtimeFirestoreRoleConfigured,
          manualCheck: `Open https://${PROJECT}.web.app, sign in through the configured organizer Google account, and confirm the organizer controls and empty registration roster.`,
          credentials:
            'Credentials remained in memory and were not printed or persisted by this verifier.',
        },
        null,
        2,
      ),
    );
    if (!runtimeFirestoreRoleConfigured) process.exitCode = 1;
  } finally {
    await db.terminate();
    await deleteApp(app);
  }
}
main().catch((error) => {
  if (error instanceof VerificationError) console.error(`Verification stopped: ${error.message}`);
  else {
    const serviceError = error?.cause || error;
    const code =
      typeof serviceError?.code === 'string' && /^[A-Za-z0-9_/-]{1,80}$/.test(serviceError.code)
        ? serviceError.code
        : 'unknown';
    console.error(
      `Verification stopped during ${verificationStage} (service code: ${code}). Check the CLI login, production configuration, and deployed Functions. Credential-bearing error details were withheld.`,
    );
  }
  process.exitCode = 1;
});
