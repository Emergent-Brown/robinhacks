#!/usr/bin/env node
/** Build a local recording fixture through the same validated commands as the app. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUTPUT = join(ROOT, 'output/playwright/walkthrough');
const bundle = await build({
  stdin: {
    contents: `
      export { createDemoDocuments, DEMO_EVENT_ID, DEMO_USERS } from './packages/application/src/fixtures.ts';
      export { GameService } from './packages/application/src/game-service.ts';
      export { MemoryRepository } from './packages/application/src/memory-repository.ts';
      export { RULES, FundingAllocator } from './packages/core/src/index.ts';
    `,
    loader: 'ts',
    sourcefile: 'walkthrough-scenario.ts',
    resolveDir: ROOT,
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const {
  createDemoDocuments,
  DEMO_EVENT_ID,
  DEMO_USERS,
  GameService,
  MemoryRepository,
  RULES,
  FundingAllocator,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);

const now = Date.now();
const eventRoot = `events/${DEMO_EVENT_ID}`;
const initial = createDemoDocuments('seed', now);
Object.assign(initial[eventRoot], {
  name: 'Foundry Weekend 2026',
  venue: 'San Francisco',
  createdAt: now - 2 * 60 * 60_000,
  closesAt: now + 60 * 60_000,
});
const repository = new MemoryRepository(initial);
const service = new GameService(repository, DEMO_EVENT_ID, { now: () => now });
const teamIds = Array.from({ length: 12 }, (_, index) => `team-${index + 1}`);

// Mosaic is left untouched so the recording can create its first investments through the UI.
for (let index = 1; index < teamIds.length; index++) {
  const targets = [1, 3, 5].map((offset) => teamIds[(index + offset) % teamIds.length]);
  const quantities = [10 + (index % 4), 8 + (index % 3), 10 + (index % 4)];
  // The base pattern gives Orbit 29; one extra share keeps every commitment at 30–40.
  quantities[2] += Math.max(0, 30 - quantities.reduce((total, quantity) => total + quantity, 0));
  const shares = Object.fromEntries(
    targets.map((issuerId, target) => [issuerId, quantities[target]]),
  );
  await service.execute(
    { uid: `demo-captain-${index + 1}` },
    {
      type: 'setSeedCommitments',
      commandId: `walkthrough-seed-team-${index + 1}`,
      shares,
      expectedWalletVersion: 0,
      expectedCommitmentVersion: 0,
    },
  );
}
const documents = repository.dump();
const positions = Object.keys(documents).filter((path) => path.includes('/positions/'));
const notes = Object.keys(documents).filter((path) => path.includes('/notes/'));
assert.equal(positions.length, 0, 'The seed scenario must not start with any holdings.');
assert.equal(notes.length, 0, 'The recording must create its own investment notes.');

let cashTotal = 0n;
let totalReservedMinor = 0;
const requests = {};
for (const [index, teamId] of teamIds.entries()) {
  const wallet = documents[`${eventRoot}/wallets/${teamId}`];
  const pool = documents[`${eventRoot}/pools/${teamId}`];
  const issuer = documents[`${eventRoot}/issuers/${teamId}`];
  const commitment = documents[`${eventRoot}/wallets/${teamId}/commitments/current`];
  requests[teamId] = commitment.shares;
  const quantity = Object.values(commitment.shares).reduce((total, value) => total + value, 0);
  assert.equal(wallet.cashMinor, RULES.initialWalletMinor);
  assert.equal(wallet.reservedSeedMinor, quantity * RULES.primaryPriceMinor);
  assert(wallet.reservedSeedMinor <= RULES.maxSeedCommitmentMinor);
  assert.equal(commitment.shares[teamId] ?? 0, 0);
  assert(
    Object.values(commitment.shares).every(
      (value) => Number.isInteger(value) && value > 0 && value <= RULES.maxSeedRequestShares,
    ),
  );
  if (index === 0) {
    assert.deepEqual(commitment.shares, {});
    assert.equal(wallet.reservedSeedMinor, 0);
    assert.equal(wallet.version, 0);
  } else {
    assert.equal(Object.keys(commitment.shares).length, 3);
    assert(quantity >= 30 && quantity <= 40);
  }
  assert.equal(issuer.primarySharesRemaining + pool.shareReserve, RULES.issuedShares);
  assert.equal(issuer.fundingVaultMinor, 0);
  cashTotal +=
    BigInt(wallet.cashMinor) + BigInt(pool.creditReserveMinor) + BigInt(issuer.fundingVaultMinor);
  totalReservedMinor += wallet.reservedSeedMinor;
}
assert.equal(
  cashTotal,
  BigInt(teamIds.length) * BigInt(RULES.initialWalletMinor + RULES.openingPoolCashMinor),
);
const mosaic = await service.snapshot(DEMO_USERS.captain.uid);
assert.equal(mosaic.wallet.cashMinor, 1_000_000);
assert.equal(mosaic.wallet.reservedSeedMinor, 0);
assert.deepEqual(mosaic.commitments.shares, {});
assert.equal(mosaic.positions.length, 0);
assert.equal(mosaic.notes.length, 0);
assert(
  mosaic.market.entries.every(
    (entry) => entry.issuer.fundingVaultMinor === 0 && entry.issuer.seedBackers === 0,
  ),
);

// Forecast only; do not settle the saved scenario. The recording closes funding through the UI.
const allocations = FundingAllocator.allocate(requests, teamIds, documents[eventRoot].tieSeed);
const fundingPreview = teamIds.map((issuerId) => {
  const shares = Object.values(allocations).reduce(
    (total, allocation) => total + (allocation[issuerId] || 0),
    0,
  );
  return {
    team: documents[`${eventRoot}/teams/${issuerId}`].name,
    shares,
    credits: (shares * RULES.primaryPriceMinor) / 100,
  };
});
assert(
  new Set(fundingPreview.map((row) => row.credits)).size > 3,
  'The funding outcomes should show varied support.',
);

await mkdir(OUTPUT, { recursive: true });
const scenarioPath = join(OUTPUT, 'scenario-seed.json');
const installerPath = join(OUTPUT, 'installer-seed.js');
await writeFile(scenarioPath, `${JSON.stringify(documents, null, 2)}\n`);
const serialized = JSON.stringify(documents);
const installer = `async (page) => {
  const target = await page.evaluate(() => ({ protocol: location.protocol, hostname: location.hostname, port: location.port }));
  if (target.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(target.hostname) || target.port !== '5180') throw new Error('Install this recording scenario only at http://localhost:5180 or http://127.0.0.1:5180.');
  await page.evaluate((documents) => {
    localStorage.setItem('robinhacks-demo-v1', documents);
    sessionStorage.clear();
    location.hash = '/explore';
  }, ${JSON.stringify(serialized)});
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Projects', exact: true }).waitFor({ state: 'visible' });
  return { scenario: 'Foundry Weekend 2026', phase: 'SEED_OPEN', perspective: 'Alex Chen · Mosaic', cashCredits: 10000, holdings: 0, ownCommitments: 0 };
}
`;
await writeFile(installerPath, installer);
console.log(
  JSON.stringify(
    {
      scenarioPath,
      installerPath,
      teams: teamIds.length,
      committedTeams: teamIds.length - 1,
      phase: 'SEED_OPEN',
      closesAt: new Date(documents[eventRoot].closesAt).toISOString(),
      mosaicCashCredits: 10000,
      mosaicHoldings: 0,
      totalReservedCredits: totalReservedMinor / 100,
      conservation: 'Verified exact cash and share supply; reservations are included in cash.',
      fundingPreview,
    },
    null,
    2,
  ),
);
