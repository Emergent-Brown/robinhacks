#!/usr/bin/env node
/** Real Auth/Functions/Firestore transport checks; refuses non-local emulator hosts. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
const local = (name, fallback) => {
  const value = process.env[name] || fallback;
  assert.match(value, /^(localhost|127\.0\.0\.1):\d+$/, `${name} must target a local emulator.`);
  return value;
};
const authHost = local('FIREBASE_AUTH_EMULATOR_HOST', '127.0.0.1:9099');
const firestoreHost = local('FIRESTORE_EMULATOR_HOST', '127.0.0.1:8080');
async function findFunctionsHost() {
  if (process.env.FUNCTIONS_EMULATOR_HOST) return local('FUNCTIONS_EMULATOR_HOST');
  if (process.env.FIREBASE_FUNCTIONS_EMULATOR_ORIGIN) {
    const origin = new URL(process.env.FIREBASE_FUNCTIONS_EMULATOR_ORIGIN);
    assert.equal(origin.protocol, 'http:');
    assert.match(origin.host, /^(localhost|127\.0\.0\.1):\d+$/);
    return origin.host;
  }
  if (process.env.FIREBASE_EMULATOR_HUB) {
    const hub = local('FIREBASE_EMULATOR_HUB');
    const response = await fetch(`http://${hub}/emulators`);
    assert.ok(response.ok, 'Unable to discover local Firebase emulators.');
    const emulators = await response.json();
    assert.ok(emulators.functions, 'The Functions emulator must be running.');
    const host = `${emulators.functions.host}:${emulators.functions.port}`;
    assert.match(host, /^(localhost|127\.0\.0\.1):\d+$/);
    return host;
  }
  return '127.0.0.1:5001';
}
const functionsHost = await findFunctionsHost();
process.env.FIRESTORE_EMULATOR_HOST = firestoreHost;
process.env.FIREBASE_AUTH_EMULATOR_HOST = authHost;
const eventId = 'robinhacks-2026';
const prefix = `http://${functionsHost}/demo-robinhacks/us-west1`;
let checks = 0;
function pass(label) {
  checks++;
  console.log(`PASS ${label}`);
}
// The Auth emulator accepts mock IdP JSON. This helper can only reach localhost.
// https://firebase.google.com/docs/emulator-suite/connect_auth#non-interactive_testing
async function auth(uid, email, emailVerified = true, providerId = 'google.com') {
  const idToken = JSON.stringify({ sub: uid, email, email_verified: emailVerified });
  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        postBody: new URLSearchParams({ id_token: idToken, providerId }).toString(),
        requestUri: 'http://localhost',
        returnSecureToken: true,
      }),
    },
  );
  const data = await response.json();
  assert.equal(
    typeof data.idToken,
    'string',
    'Local Google Auth failed. Seed the local fixture first.',
  );
  const claims = JSON.parse(Buffer.from(data.idToken.split('.')[1], 'base64url').toString());
  assert.equal(claims.firebase.sign_in_provider, providerId);
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
const actorUid = (token) =>
  JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub;
async function change(type, details, token) {
  return success('gameCommand', { command: command(type, details) }, token);
}
async function phaseVersion(organizer) {
  return (await success('gameSnapshot', {}, organizer)).event.phaseVersion;
}
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
  const [captain, member, organizer, judge] = await Promise.all([
    auth('demo-captain', 'alex@example.test'),
    auth('demo-member', 'sam@example.test'),
    auth('demo-organizer', 'organizer@example.test'),
    auth('demo-judge', 'judge@example.test'),
  ]);
  const initial = await success('gameSnapshot', {}, organizer);
  assert.equal(
    initial.event.phase,
    'REGISTRATION',
    'Seed the registration preset with node scripts/seed-emulator.mjs --registration',
  );
  const [newCaptain, newMember, newOrganizer] = await Promise.all([
    auth('smoke-builder', 'smoke-builder@example.test'),
    auth('smoke-teammate', 'smoke-teammate@example.test'),
    auth('smoke-organizer', 'smoke-organizer@example.test'),
  ]);
  await change('requestMembership', { displayName: 'Smoke Builder' }, newCaptain);
  let applicant = await success('gameSnapshot', {}, newCaptain);
  assert.equal(applicant.member.status, 'pending');
  assert.deepEqual(applicant.market.entries, []);
  assert.equal(applicant.requests[0].email, 'smoke-builder@example.test');
  await change('approveMembership', { uid: actorUid(newCaptain) }, organizer);
  applicant = await success('gameSnapshot', {}, newCaptain);
  assert.equal(applicant.member.status, 'approved');
  assert.equal(applicant.member.teamId, null);
  assert.deepEqual(applicant.market.entries, []);
  await denied(
    'gameCommand',
    { command: command('createFormationTeam', { name: 'Smoke Lab', role: 'captain' }) },
    newCaptain,
    'FORMATION_CLOSED',
  );
  pass('Google signup exposes only name/email approval, then waits for organizer-opened formation');

  await change(
    'setTeamFormation',
    { open: true, expectedPhaseVersion: await phaseVersion(organizer) },
    organizer,
  );
  await change('createFormationTeam', { name: 'Smoke Lab', role: 'captain' }, newCaptain);
  const newTeam = (await success('gameSnapshot', {}, newCaptain)).member.teamId;
  assert.ok(newTeam);
  await change('requestMembership', { displayName: 'Smoke Teammate' }, newMember);
  await change('approveMembership', { uid: actorUid(newMember) }, organizer);
  await denied(
    'gameCommand',
    { command: command('joinFormationTeam', { teamId: newTeam, role: 'captain' }) },
    newMember,
    'ROLE_LIMIT',
  );
  await change('joinFormationTeam', { teamId: newTeam, role: 'member' }, newMember);
  assert.equal((await success('gameSnapshot', {}, newMember)).member.teamId, newTeam);
  await change(
    'publishUpdate',
    {
      round: 1,
      works: 'A working offline prototype.',
      changed: 'Initial demonstration.',
      evidenceUrl: '',
      incomplete: 'More testing remains.',
    },
    newCaptain,
  );
  pass('Participants create or join a team; an occupied captain role cannot be claimed twice');

  await change('removeMember', { uid: actorUid(newMember) }, organizer);
  const removed = await success('gameSnapshot', {}, newMember);
  assert.equal(removed.member, null);
  assert.deepEqual(removed.market.entries, []);
  await denied(
    'gameCommand',
    { command: command('updateProfile', { bio: 'Should be blocked.' }) },
    newMember,
    'MEMBERSHIP_REQUIRED',
  );
  pass('Removing access hides team data immediately and blocks further changes');

  await change('addOrganizerEmail', { email: 'smoke-organizer@example.test' }, organizer);
  const invited = await success('gameSnapshot', {}, newOrganizer);
  assert.equal(invited.member.role, 'organizer');
  assert.equal(invited.member.teamId, null);
  assert.equal(invited.member.status, 'approved');
  await change('removeOrganizerEmail', { email: 'smoke-organizer@example.test' }, organizer);
  assert.equal((await success('gameSnapshot', {}, newOrganizer)).member, null);
  pass('Only the invited verified Google email claims organizer access; removal revokes it');

  await change(
    'setTeamFormation',
    { open: false, expectedPhaseVersion: await phaseVersion(organizer) },
    organizer,
  );
  await success(
    'gameCommand',
    {
      command: command('openFundingRound', {
        durationMinutes: 1,
        expectedPhaseVersion: await phaseVersion(organizer),
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
  const unverified = await auth('unverified-attendee', 'unverified@example.test', false);
  await denied(
    'gameCommand',
    {
      command: command('requestMembership', {
        displayName: 'Unverified attendee',
      }),
    },
    unverified,
    'GOOGLE_SIGN_IN_REQUIRED',
  );
  pass('Real unverified Auth token cannot request membership');
  const nonGoogle = await auth(
    'other-provider-attendee',
    'other-provider@example.test',
    true,
    'apple.com',
  );
  await denied('gameSnapshot', {}, nonGoogle, 'GOOGLE_SIGN_IN_REQUIRED');
  pass('Non-Google identities cannot read authenticated event data');

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
    const deletedAccount = await auth('deleted-google-attendee', 'deleted-google@example.test');
    await success('gameSnapshot', {}, deletedAccount);
    await getAuth(app).deleteUser(actorUid(deletedAccount));
    await denied('gameSnapshot', {}, deletedAccount, 'SIGN_IN_REQUIRED');
    pass(
      'Deleting an Auth identity immediately rejects its previously issued Google session token',
    );
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
