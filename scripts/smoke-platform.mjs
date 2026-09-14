#!/usr/bin/env node
/** Real Auth/Functions/Firestore transport checks; refuses non-local emulator hosts. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const local = (name, fallback) => {
  const value = process.env[name] || fallback;
  assert.match(value, /^(localhost|127\.0\.0\.1):\d+$/, `${name} must target a local emulator.`);
  return value;
};
const authHost = local('FIREBASE_AUTH_EMULATOR_HOST', '127.0.0.1:9099');
const firestoreHost = local('FIRESTORE_EMULATOR_HOST', '127.0.0.1:8080');
const functionsHost = local('FUNCTIONS_EMULATOR_HOST', '127.0.0.1:5001');
process.env.FIRESTORE_EMULATOR_HOST = firestoreHost;
process.env.FIREBASE_AUTH_EMULATOR_HOST = authHost;
const eventId = 'robinhacks-2026';
const prefix = `http://${functionsHost}/demo-robinhacks/us-west1`;
let checks = 0;
function pass(label) {
  checks++;
  console.log(`PASS ${label}`);
}
async function auth(email, signup = false) {
  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:${signup ? 'signUp' : 'signInWithPassword'}?key=demo-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'hackathon-demo-2026', returnSecureToken: true }),
    },
  );
  const data = await response.json();
  assert.equal(typeof data.idToken, 'string', 'Local Auth failed. Seed the local fixture first.');
  return data.idToken;
}
async function call(name, data = {}, token) {
  const response = await fetch(`${prefix}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ data: { eventId, ...data } }),
  });
  return response.json();
}
async function success(name, data, token) {
  const response = await call(name, data, token);
  assert.ok(!response.error, response.error?.message || 'Callable failed');
  return response.result;
}
async function denied(name, data, token, code) {
  const response = await call(name, data, token);
  assert.equal(response.error?.details?.code, code);
}
const command = (type, rest = {}) => ({ type, commandId: randomUUID(), ...rest });
async function main() {
  const pub = await success('gamePublic', {});
  assert.equal(pub.event?.platform?.version, 2);
  assert.deepEqual(pub.market.entries, []);
  assert.deepEqual(pub.members, []);
  pass('Unauthenticated homepage contains only public event metadata');
  await denied(
    'gameCommand',
    { command: command('openFundingRound', { durationMinutes: 1, expectedPhaseVersion: 1 }) },
    undefined,
    'SIGN_IN_REQUIRED',
  );
  pass('Anonymous mutations rejected');
  const [captain, member, organizer, judge] = await Promise.all(
    ['alex@example.test', 'sam@example.test', 'organizer@example.test', 'judge@example.test'].map(
      (email) => auth(email),
    ),
  );
  const initial = await success('gameSnapshot', {}, organizer);
  assert.equal(
    initial.event.phase,
    'REGISTRATION',
    'Seed the registration preset with node scripts/seed-emulator.mjs --seed',
  );
  await success(
    'gameCommand',
    {
      command: command('openFundingRound', {
        durationMinutes: 1,
        expectedPhaseVersion: initial.event.phaseVersion,
      }),
    },
    organizer,
  );
  const invest = command('saveAllocation', {
    roundId: 'funding-1',
    expectedVersion: 0,
    amounts: { 'team-2': 60, 'team-3': 40 },
  });
  const accepted = await success('gameCommand', { command: invest }, captain);
  assert.deepEqual(await success('gameCommand', { command: invest }, captain), accepted);
  await denied(
    'gameCommand',
    { command: { ...invest, amounts: { 'team-2': 50 } } },
    captain,
    'COMMAND_CONFLICT',
  );
  pass('Verified captain allocation is idempotent and payload-bound');
  await denied(
    'gameCommand',
    { command: { ...invest, commandId: randomUUID() } },
    member,
    'TRADER_REQUIRED',
  );
  await denied(
    'gameCommand',
    { command: { ...invest, commandId: randomUUID() } },
    judge,
    'TEAM_REQUIRED',
  );
  pass('Member and judge cannot allocate');
  const [staff, blind] = await Promise.all([
    success('gameSnapshot', {}, organizer),
    success('gameSnapshot', {}, judge),
  ]);
  assert.deepEqual(staff.platform.rounds[0].totals, {});
  assert.equal(staff.platform.allocation, null);
  assert.deepEqual(blind.platform.entitlements, []);
  pass('Open round stays sealed from staff and judges');
  await denied(
    'gameCommand',
    {
      command: command('closeFundingRound', {
        roundId: 'funding-1',
        expectedPhaseVersion: staff.event.phaseVersion,
      }),
    },
    organizer,
    'ROUND_NOT_DUE',
  );
  pass('Early funding closure rejected at the server');
  const unverified = await auth(`unverified-${Date.now()}@example.test`, true);
  await denied(
    'gameCommand',
    {
      command: command('requestMembership', {
        displayName: 'Unverified attendee',
        teamName: 'Mosaic',
        teamId: 'team-1',
      }),
    },
    unverified,
    'EMAIL_VERIFICATION_REQUIRED',
  );
  pass('Real unverified Auth token cannot request membership');
  await success(
    'gameCommand',
    {
      command: command('sendMessage', {
        toTeamId: 'team-2',
        body: 'Can we review your offline demo together?',
      }),
    },
    captain,
  );
  const conversation = await success('gameConversation', { otherTeamId: 'team-2' }, member);
  assert.equal(conversation.messages.at(-1).body, 'Can we review your offline demo together?');
  await denied('gameConversation', { otherTeamId: 'team-2' }, judge, 'TEAM_REQUIRED');
  pass('Team conversation is shared with teammates and hidden from judges');
  // Advance only this local fixture's deadline; no production project can be reached.
  const app = initializeApp({ projectId: 'demo-robinhacks' }, 'sealed-smoke');
  try {
    const db = getFirestore(app),
      root = db.doc(`events/${eventId}`);
    await db.runTransaction(async (tx) => {
      const [event, round] = await Promise.all([
        tx.get(root),
        tx.get(root.collection('fundingRounds').doc('funding-1')),
      ]);
      tx.set(root, { ...event.data(), closesAt: Date.now() - 1000 });
      tx.set(round.ref, { ...round.data(), closesAt: Date.now() - 1000 });
    });
    await success(
      'gameCommand',
      {
        command: command('closeFundingRound', {
          roundId: 'funding-1',
          expectedPhaseVersion: staff.event.phaseVersion,
        }),
      },
      organizer,
    );
    const [closed, closedJudge] = await Promise.all([
      success('gameSnapshot', {}, captain),
      success('gameSnapshot', {}, judge),
    ]);
    assert.equal(closed.platform.entitlements[0].spent, 100);
    assert.equal(closed.platform.rounds[0].totals['team-2'], 60);
    assert.deepEqual(closedJudge.platform.rounds[0].totals, {});
    pass('Atomic close reveals totals and locks claims while judges remain blind');
  } finally {
    await deleteApp(app);
  }
  console.log(`${checks} local transport checks passed. No production data or email was touched.`);
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
