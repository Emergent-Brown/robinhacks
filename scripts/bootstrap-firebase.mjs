#!/usr/bin/env node
/**
 * Bootstrap the configured production event using the existing Firebase CLI login.
 * Default: authenticated read-only preflight. Only --apply performs cloud writes.
 * No credential is printed, written to the project, or supplied on a command line.
 * Firebase CLI may refresh its own existing managed login cache.
 */
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Firestore } from 'firebase-admin/firestore';
import { OAuth2Client } from 'google-auth-library';
import { build } from 'esbuild';

const ORGANIZER_EMAIL = process.env.ROBINHACKS_ORGANIZER_EMAIL?.trim().toLowerCase() || '';
const EVENT_ID = 'robinhacks-2026';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
class BootstrapError extends Error {}
const assert = (condition, message) => {
  if (!condition) throw new BootstrapError(message);
};

function argumentsFrom(argv) {
  const result = { project: '', apply: false, help: false };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--help' || flag === '-h') result.help = true;
    else if (flag === '--apply') {
      assert(!result.apply, 'Pass --apply only once.');
      result.apply = true;
    } else if (flag === '--project') {
      assert(!result.project, 'Pass --project only once.');
      result.project = argv[++index] ?? '';
      assert(
        /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(result.project),
        'Supply a valid explicit Firebase project ID after --project.',
      );
    } else throw new BootstrapError('Unsupported argument. Use --help for the accepted options.');
  }
  return result;
}

async function packageExists(path) {
  try {
    await access(join(path, 'lib', 'auth.js'));
    const metadata = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'));
    return metadata.name === 'firebase-tools';
  } catch {
    return false;
  }
}

async function locateFirebaseTools() {
  if (process.env.FIREBASE_TOOLS_DIR) {
    const explicit = resolve(process.env.FIREBASE_TOOLS_DIR);
    assert(
      await packageExists(explicit),
      'FIREBASE_TOOLS_DIR must point to the installed firebase-tools package directory.',
    );
    return explicit;
  }
  try {
    const installed = dirname(require.resolve('firebase-tools/package.json'));
    if (await packageExists(installed)) return installed;
  } catch {
    /* Firebase CLI is commonly installed through npx. */
  }
  const cache = join(homedir(), '.npm', '_npx');
  let entries = [];
  try {
    entries = await readdir(cache, { withFileTypes: true });
  } catch {
    /* Show the concrete install command below. */
  }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(cache, entry.name, 'node_modules', 'firebase-tools');
    if (await packageExists(path)) candidates.push({ path, modified: (await stat(path)).mtimeMs });
  }
  candidates.sort((a, b) => b.modified - a.modified);
  assert(
    candidates.length > 0,
    'Install the Firebase CLI first: npx -y firebase-tools@latest --version. Then run npx -y firebase-tools@latest login if needed.',
  );
  return candidates[0].path;
}

export async function cliCredential() {
  const packageDir = await locateFirebaseTools();
  // Do not enable the CLI's debug/file logger: credential-related internals may log responses.
  const { logger } = require(join(packageDir, 'lib', 'logger.js'));
  logger.silent = true;
  const auth = require(join(packageDir, 'lib', 'auth.js'));
  assert(
    typeof auth.getGlobalDefaultAccount === 'function' && typeof auth.getAccessToken === 'function',
    'This Firebase CLI version changed its login API. Install firebase-tools@15.29.0 or update this adapter.',
  );
  const account = auth.getGlobalDefaultAccount();
  assert(
    account?.user?.email?.toLowerCase() === ORGANIZER_EMAIL,
    `The default Firebase CLI login must be ${ORGANIZER_EMAIL}. Select it with: npx -y firebase-tools@latest login:use ${ORGANIZER_EMAIL}`,
  );
  assert(
    account.tokens?.refresh_token || account.tokens?.access_token,
    'The Firebase CLI login has no usable session. Run: npx -y firebase-tools@latest login --reauth',
  );
  // Always ask the CLI for this exact scope set before using its cached token.
  // Another CLI command may have down-scoped the shared cache (for example,
  // billing reads need cloud-platform but do not preserve OIDC email claims).
  // These scopes are already part of Firebase CLI's normal interactive login.
  // Profile scope is not needed: verified email + OIDC subject prove identity.
  const requiredScopes = [
    'email',
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/cloudplatformprojects.readonly',
    'https://www.googleapis.com/auth/firebase',
    'https://www.googleapis.com/auth/cloud-platform',
  ];
  let cached = null;
  const credential = {
    async getAccessToken() {
      if (
        !cached?.access_token ||
        !Number.isFinite(cached.expires_at) ||
        cached.expires_at < Date.now() + 60_000
      ) {
        assert(
          account.tokens.refresh_token,
          'The Firebase CLI login expired. Run: npx -y firebase-tools@latest login --reauth',
        );
        cached = await auth.getAccessToken(account.tokens.refresh_token, [...requiredScopes]);
      }
      assert(
        typeof cached.access_token === 'string' && cached.access_token.length > 0,
        'Firebase CLI could not refresh its login. Run: npx -y firebase-tools@latest login --reauth',
      );
      return {
        access_token: cached.access_token,
        expires_in: Math.max(
          1,
          Math.floor(((cached.expires_at ?? Date.now() + 3_600_000) - Date.now()) / 1000),
        ),
      };
    },
  };
  const token = await credential.getAccessToken();
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${token.access_token}` },
    signal: AbortSignal.timeout(20_000),
  });
  assert(
    response.ok,
    'Could not verify the Google identity behind the Firebase CLI login. Run: npx -y firebase-tools@latest login --reauth',
  );
  const identity = await response.json();
  assert(
    identity.email?.toLowerCase() === ORGANIZER_EMAIL &&
      identity.email_verified === true &&
      typeof identity.sub === 'string' &&
      /^\d{5,100}$/.test(identity.sub),
    'The live Google identity must match the verified organizer email. No records were changed.',
  );
  return {
    credential,
    identity,
    cliVersion: JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8')).version,
  };
}

function verifyExistingUser(user, googleSubject) {
  if (!user) return;
  assert(
    user.email?.toLowerCase() === ORGANIZER_EMAIL && user.emailVerified && !user.disabled,
    'The existing organizer Auth user must be enabled and email-verified. Sign in with the organizer Google account first; this script will not take over an unverified user.',
  );
  const linked = user.providerData.find((provider) => provider.providerId === 'google.com');
  const recoverable =
    user.uid === `organizer_google_${googleSubject}` &&
    user.providerData.length === 0 &&
    !user.passwordHash &&
    !user.phoneNumber;
  assert(
    linked?.uid === googleSubject || recoverable,
    'The existing Auth account is not linked to the verified organizer Google identity. Sign in with that Google account first, then rerun. No permissions were granted.',
  );
}

export function verifyExistingEvent(event, member, market, uid) {
  assert(
    event.id === EVENT_ID && event.rulesVersion === 2 && event.platform?.version === 2,
    'An incompatible event already exists at this ID. This script never overwrites an existing event.',
  );
  assert(
    member?.uid === uid &&
      member.teamId === null &&
      member.role === 'organizer' &&
      member.status === 'approved',
    'The event already exists without this approved organizer. Bootstrap will not change an existing event’s permissions; use an existing organizer account.',
  );
  assert(
    Array.isArray(market?.entries),
    'The existing event is missing its market projection. Bootstrap will not overwrite or repair a running event.',
  );
}

/** New events use the same event plan and funding rules as the app. */
export async function createInitialEvent(now = Date.now()) {
  const bundle = await build({
    entryPoints: [join(ROOT, 'packages/core/src/index.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const { defaultPlatformConfig, DEFAULT_EVENT_VENUE } = await import(
    'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64')
  );
  return {
    id: EVENT_ID,
    name: 'Emergent Hacks 2026',
    venue: DEFAULT_EVENT_VENUE,
    phase: 'REGISTRATION',
    phaseVersion: 0,
    paused: false,
    pauseReason: '',
    windowId: 0,
    closesAt: null,
    createdAt: now,
    rulesVersion: 2,
    activeOperationId: null,
    publishedResultId: null,
    announcement: '',
    tieSeed: randomUUID(),
    platform: defaultPlatformConfig(),
  };
}

async function main() {
  const args = argumentsFrom(process.argv.slice(2));
  if (args.help) {
    console.log(
      'Usage: node --env-file=.env.operations scripts/bootstrap-firebase.mjs --project <configured-project-id> [--apply]\n\nThe default is an authenticated read-only preflight. --apply creates the initial event and organizer if absent.\nOnly the project in .firebaserc and the verified Google login matching ROBINHACKS_ORGANIZER_EMAIL are accepted.\nOptional FIREBASE_TOOLS_DIR points to an installed firebase-tools package directory.',
    );
    return;
  }
  assert(
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ORGANIZER_EMAIL) && !ORGANIZER_EMAIL.endsWith('@example.com'),
    'Set ROBINHACKS_ORGANIZER_EMAIL to the intended organizer in the ignored .env.operations file and load it with node --env-file=.env.operations.',
  );
  assert(
    args.project,
    'An explicit project is required: node scripts/bootstrap-firebase.mjs --project <project-id>',
  );
  const config = JSON.parse(await readFile(join(ROOT, '.firebaserc'), 'utf8'));
  assert(
    config.projects?.default === args.project,
    'The explicit --project must exactly match projects.default in this repository’s .firebaserc.',
  );
  assert(
    !process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST,
    'Unset emulator host variables before bootstrapping the configured cloud project. Use npm run seed for the local emulator.',
  );
  assert(
    !process.env.FIREBASE_TOKEN,
    'Unset FIREBASE_TOKEN. This script uses only the verified existing Firebase CLI user login.',
  );
  const { credential, identity, cliVersion } = await cliCredential();
  const app = initializeApp({ projectId: args.project, credential }, `bootstrap-${Date.now()}`);
  const auth = getAuth(app);
  // Admin getFirestore() accepts only ADC/certificates. Its exported Firestore
  // constructor supports the same verified CLI session through an OAuth client.
  const oauth = new OAuth2Client();
  oauth.refreshHandler = async () => {
    const token = await credential.getAccessToken();
    return { access_token: token.access_token, expiry_date: Date.now() + token.expires_in * 1000 };
  };
  const db = new Firestore({ projectId: args.project, authClient: oauth, preferRest: true });
  try {
    let user = null;
    try {
      user = await auth.getUserByEmail(ORGANIZER_EMAIL);
    } catch (error) {
      if (error.code !== 'auth/user-not-found') throw error;
    }
    verifyExistingUser(user, identity.sub);
    const uid = user?.uid ?? `organizer_google_${identity.sub}`;
    const eventRef = db.doc(`events/${EVENT_ID}`);
    const memberRef = eventRef.collection('members').doc(uid);
    const marketRef = eventRef.collection('views').doc('market');
    const [eventSnap, memberSnap, marketSnap] = await db.getAll(eventRef, memberRef, marketRef);
    if (eventSnap.exists)
      verifyExistingEvent(eventSnap.data(), memberSnap.data(), marketSnap.data(), uid);
    else
      assert(
        !memberSnap.exists && !marketSnap.exists,
        'Orphaned event records already exist. Bootstrap will not overwrite them.',
      );
    const needsGoogleLink = !user?.providerData.some(
      (provider) => provider.providerId === 'google.com' && provider.uid === identity.sub,
    );
    const summary = {
      mode: args.apply ? 'apply' : 'dry-run',
      project: args.project,
      eventId: EVENT_ID,
      organizerEmail: ORGANIZER_EMAIL,
      verifiedCliVersion: cliVersion,
      authentication: user
        ? needsGoogleLink
          ? 'Link verified Google provider to the previously bootstrapped passwordless Auth identity'
          : 'Reuse existing verified Google identity'
        : 'Create verified organizer Auth identity and link Google provider',
      firestore: eventSnap.exists
        ? 'Existing event and organizer match; no event writes'
        : 'Create sealed-round REGISTRATION event with unconfigured prizes, empty project projection and separate organizer membership atomically',
      expectedWrites: {
        auth: eventSnap.exists ? 0 : user ? (needsGoogleLink ? 1 : 0) : 2,
        firestore: eventSnap.exists ? 0 : 3,
      },
      credentials: 'Existing Firebase CLI session only; no credential files created by this script',
    };
    console.log(JSON.stringify(summary, null, 2));
    if (!args.apply) {
      console.log(
        `\nTo apply this plan: node --env-file=.env.operations scripts/bootstrap-firebase.mjs --project ${args.project} --apply`,
      );
      return;
    }
    if (eventSnap.exists) {
      console.log(
        '\nAlready initialized. Existing event, portfolio data and membership remain unchanged.',
      );
      return;
    }
    const event = await createInitialEvent();
    if (!user) {
      try {
        user = await auth.createUser({
          uid,
          email: ORGANIZER_EMAIL,
          emailVerified: true,
          displayName:
            typeof identity.name === 'string' && identity.name.trim()
              ? identity.name.trim().slice(0, 60)
              : 'Organizer',
        });
      } catch (error) {
        if (error.code !== 'auth/email-already-exists' && error.code !== 'auth/uid-already-exists')
          throw error;
        user = await auth.getUserByEmail(ORGANIZER_EMAIL);
        verifyExistingUser(user, identity.sub);
        assert(
          user.uid === uid,
          'The Auth identity changed during bootstrap. No event was created; rerun the read-only preflight.',
        );
      }
    }
    if (
      !user.providerData.some(
        (provider) => provider.providerId === 'google.com' && provider.uid === identity.sub,
      )
    ) {
      user = await auth.updateUser(uid, {
        providerToLink: {
          providerId: 'google.com',
          uid: identity.sub,
          email: ORGANIZER_EMAIL,
          displayName: user.displayName ?? 'Organizer',
        },
      });
    }
    verifyExistingUser(user, identity.sub);
    const now = event.createdAt;
    const organizer = {
      uid,
      displayName: user.displayName?.slice(0, 60) || 'Organizer',
      email: user.email,
      emailVerified: user.emailVerified === true,
      teamId: null,
      role: 'organizer',
      status: 'approved',
      version: 0,
    };
    const created = await db.runTransaction(async (tx) => {
      const [currentEvent, currentMember, currentMarket] = await tx.getAll(
        eventRef,
        memberRef,
        marketRef,
      );
      if (currentEvent.exists) {
        verifyExistingEvent(currentEvent.data(), currentMember.data(), currentMarket.data(), uid);
        return false;
      }
      assert(
        !currentMember.exists && !currentMarket.exists,
        'Event records changed after preflight. No records were overwritten.',
      );
      for (const collection of ['teams', 'wallets', 'members']) {
        const orphaned = await tx.get(eventRef.collection(collection).limit(1));
        assert(
          orphaned.empty,
          'Orphaned event data exists. Bootstrap will not attach a new event or administrator to it.',
        );
      }
      tx.create(eventRef, event);
      tx.create(memberRef, organizer);
      tx.create(marketRef, { entries: [], asOf: now, phaseVersion: 0 });
      return true;
    });
    console.log(
      created
        ? '\nCreated the REGISTRATION event and separate organizer membership. Sign in to the app with the verified organizer Google account.'
        : '\nA concurrent bootstrap already created the matching event. No event records were overwritten.',
    );
  } finally {
    await db.terminate();
    await deleteApp(app);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    if (error instanceof BootstrapError) console.error(`Bootstrap stopped: ${error.message}`);
    else {
      const code =
        typeof error?.code === 'string' && /^[a-zA-Z0-9_/-]{1,80}$/.test(error.code)
          ? error.code
          : typeof error?.code === 'number'
            ? String(error.code)
            : 'unknown';
      console.error(
        `Bootstrap stopped (service code: ${code}). Confirm Firebase Authentication and Firestore Standard are initialized in the configured project, and reauthenticate with: npx -y firebase-tools@latest login --reauth. Credentials and service response bodies have been withheld.`,
      );
    }
    process.exitCode = 1;
  });
