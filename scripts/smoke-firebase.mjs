import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';

/** Transport-level checks against emulator-only users. This script never contacts a remote project. */
const projectId = process.env.SMOKE_PROJECT_ID || 'demo-robinhacks';
assert.equal(projectId, 'demo-robinhacks', 'Smoke tests are restricted to demo-robinhacks.');
const eventId = 'robinhacks-2026';
function localhost(value, fallback) {
  const address = value || fallback;
  assert.match(
    address,
    /^(127\.0\.0\.1|localhost):\d+$/,
    'Emulator hosts must be localhost with an explicit port.',
  );
  const url = new URL(`http://${address}`);
  assert(Number(url.port) > 0 && Number(url.port) <= 65535, 'Invalid local emulator port.');
  return url.origin;
}
const authOrigin = localhost(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099');
const functionOrigin = localhost(process.env.FUNCTIONS_EMULATOR_HOST, '127.0.0.1:5001');
const functionBase = `${functionOrigin}/${projectId}/us-west1`;
const password = 'hackathon-demo-2026';
const checks = [];
const check = (name, details = undefined) => {
  checks.push(name);
  console.log(`PASS ${name}${details ? ` (${details})` : ''}`);
};

async function request(url, body, token) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Local emulator returned a non-JSON response with status ${response.status}.`);
  }
  return { status: response.status, data };
}
async function signIn(email) {
  const response = await request(
    `${authOrigin}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key`,
    { email, password, returnSecureToken: true },
  );
  assert.equal(
    response.status,
    200,
    'Emulator sign-in failed. Start npm run emulators and run npm run seed.',
  );
  assert.equal(typeof response.data.idToken, 'string', 'Auth emulator did not return an ID token.');
  return response.data.idToken;
}
async function callable(name, payload = {}, token) {
  return request(`${functionBase}/${name}`, { data: { eventId, ...payload } }, token);
}
async function success(name, payload = {}, token) {
  const response = await callable(name, payload, token);
  assert.equal(
    response.status,
    200,
    `${name} failed: ${JSON.stringify(response.data.error ?? response.data)}`,
  );
  assert(!response.data.error, `${name} returned an unexpected callable error.`);
  return response.data.result;
}
async function denied(name, payload, token, code) {
  const response = await callable(name, payload, token);
  assert(response.status >= 400, `${name} unexpectedly accepted a forbidden request.`);
  assert.equal(
    response.data.error?.details?.code,
    code,
    `Unexpected ${name} authorization outcome.`,
  );
}

try {
  await denied('gameSnapshot', {}, undefined, 'SIGN_IN_REQUIRED');
  check('Unauthenticated callable requests are denied');
  const [captainToken, organizerToken, memberToken] = await Promise.all([
    signIn('alex@example.test'),
    signIn('organizer@example.test'),
    signIn('sam@example.test'),
  ]);
  check('Auth emulator signs in captain, organizer, and member');
  let snapshot = await success('gameSnapshot', {}, captainToken);
  assert.equal(snapshot.member?.role, 'captain');
  assert.equal(snapshot.wallet?.teamId, 'team-1');
  assert.equal(snapshot.event?.id, eventId);
  assert.equal(
    snapshot.event.phase,
    'TRADING_OPEN',
    'Run npm run seed to restore the trading fixture before this smoke test.',
  );
  assert.equal(
    snapshot.event.paused,
    false,
    'Resume or reseed the local event before this smoke test.',
  );
  assert(snapshot.market.entries.length >= 10, 'The seeded local market is missing.');
  assert(
    snapshot.event.closesAt > Date.now(),
    'The local trading window expired. Run npm run seed.',
  );
  check('Authenticated snapshot contains the correct team wallet and market');

  const cooldown = Math.max(0, snapshot.wallet.lastTradeAt + 10_000 - Date.now());
  if (cooldown > 0) await setTimeout(cooldown + 20);
  snapshot = await success('gameSnapshot', {}, captainToken);
  const issuer = snapshot.market.entries.find(
    (entry) =>
      entry.team.id !== snapshot.member.teamId &&
      entry.team.eligibility === 'active' &&
      !entry.pool.halted &&
      (snapshot.positions.find((position) => position.issuerId === entry.team.id)?.shares ?? 0) <
        25,
  );
  assert(issuer, 'No tradable outside project remains in this fixture. Run npm run seed.');
  const pool = await success('gamePool', { issuerId: issuer.team.id }, captainToken);
  const shares = 1;
  const denominator = BigInt(pool.shareReserve - shares);
  const totalMinor = Number(
    (BigInt(pool.creditReserveMinor) * BigInt(shares) + denominator - 1n) / denominator,
  );
  const command = {
    type: 'executeTrade',
    commandId: randomUUID(),
    issuerId: issuer.team.id,
    side: 'BUY',
    shares,
    expectedPoolVersion: pool.version,
    expectedWalletVersion: snapshot.wallet.version,
    expectedPhaseVersion: snapshot.event.phaseVersion,
    maxDebitMinor: totalMinor,
  };
  await denied(
    'gameCommand',
    { command: { ...command, commandId: randomUUID() } },
    memberToken,
    'TRADER_REQUIRED',
  );
  await denied('gameExport', {}, captainToken, 'ORGANIZER_REQUIRED');
  check('Members cannot trade; participants cannot export private event data');

  const beforeShares =
    snapshot.positions.find((position) => position.issuerId === issuer.team.id)?.shares ?? 0;
  const accepted = await success('gameCommand', { command }, captainToken);
  assert.equal(accepted.receipt?.totalMinor, totalMinor);
  assert.equal(accepted.receipt?.shares, 1);
  const replay = await success('gameCommand', { command }, captainToken);
  assert.deepEqual(
    replay,
    accepted,
    'Retrying the same command must return the identical receipt.',
  );
  await denied(
    'gameCommand',
    { command: { ...command, shares: 2 } },
    captainToken,
    'COMMAND_CONFLICT',
  );
  const after = await success('gameSnapshot', {}, captainToken);
  assert.equal(after.wallet.cashMinor, snapshot.wallet.cashMinor - totalMinor);
  assert.equal(after.wallet.version, snapshot.wallet.version + 1);
  assert.equal(after.wallet.successfulTradesInWindow, snapshot.wallet.successfulTradesInWindow + 1);
  assert.equal(
    after.positions.find((position) => position.issuerId === issuer.team.id)?.shares,
    beforeShares + 1,
  );
  const afterPool = await success('gamePool', { issuerId: issuer.team.id }, captainToken);
  assert.equal(afterPool.shareReserve, pool.shareReserve - 1);
  assert.equal(afterPool.creditReserveMinor, pool.creditReserveMinor + totalMinor);
  check('Callable quote/trade conserves credits and shares');
  check('Duplicate commands execute once; changed payloads with the same ID are rejected');

  await success(
    'gameCommand',
    {
      command: {
        type: 'setPause',
        commandId: randomUUID(),
        paused: true,
        reason: 'Local transport smoke test export',
        expectedPhaseVersion: after.event.phaseVersion,
      },
    },
    organizerToken,
  );
  let exportPath;
  try {
    const exported = await success('gameExport', {}, organizerToken);
    assert.equal(exported.event.id, eventId);
    assert.equal(exported.event.paused, true);
    assert(
      exported.teamRecords?.['team-1']?.receipts?.some(
        (receipt) => receipt.id === command.commandId,
      ),
      'Organizer export omitted the accepted trade.',
    );
    const outputDirectory = await mkdtemp(join(tmpdir(), 'robinhacks-smoke-'));
    exportPath = join(outputDirectory, 'event-export.json');
    await writeFile(exportPath, `${JSON.stringify(exported, null, 2)}\n`, { mode: 0o600 });
    const reconciled = spawnSync(process.execPath, ['scripts/reconcile-export.mjs', exportPath], {
      encoding: 'utf8',
      cwd: process.cwd(),
    });
    assert.equal(
      reconciled.status,
      0,
      `Export reconciliation failed: ${reconciled.stdout}\n${reconciled.stderr}`,
    );
    const report = JSON.parse(reconciled.stdout);
    assert.equal(report.valid, true);
    assert.equal(report.wallets, snapshot.market.entries.length);
    check(
      'Organizer export passes the actual ledger reconciliation script',
      `${report.wallets} wallets`,
    );
  } finally {
    const paused = await success('gameSnapshot', {}, organizerToken);
    if (paused.event?.paused)
      await success(
        'gameCommand',
        {
          command: {
            type: 'setPause',
            commandId: randomUUID(),
            paused: false,
            reason: '',
            expectedPhaseVersion: paused.event.phaseVersion,
          },
        },
        organizerToken,
      );
  }
  console.log(
    JSON.stringify(
      {
        success: true,
        projectId,
        eventId,
        checks: checks.length,
        exportPath,
        note: 'Emulators remain running; event resumed with one accepted test purchase.',
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
