import { readFile } from 'node:fs/promises';
const path = process.argv[2];
if (!path) {
  console.error('Usage: npm run reconcile -- /absolute/path/to/event-export.json');
  process.exit(1);
}
const data = JSON.parse(await readFile(path, 'utf8'));
// Supports the canonical document-map export and a documents wrapper.
let documents = data.documents || data;
if (data.teamRecords && data.event) {
  const root = `events/${data.event.id}`;
  documents = { [root]: data.event };
  for (const name of ['wallets', 'pools', 'issuers', 'teams'])
    for (const item of data[name] || [])
      documents[`${root}/${name}/${item.teamId || item.issuerId || item.id}`] = item;
  for (const [teamId, records] of Object.entries(data.teamRecords)) {
    for (const position of records.positions || [])
      documents[`${root}/wallets/${teamId}/positions/${position.issuerId}`] = position;
    for (const receipt of records.receipts || [])
      documents[`${root}/wallets/${teamId}/receipts/${receipt.id}`] = receipt;
  }
}
const rows = Object.entries(documents);
if (!rows.some(([path]) => path.includes('/wallets/')))
  throw new Error('Expected an event document-map export.');
const wallets = rows.filter(([p]) => /\/wallets\/[^/]+$/.test(p)).map(([, v]) => v);
const issuers = rows.filter(([p]) => /\/issuers\/[^/]+$/.test(p)).map(([, v]) => v);
const pools = rows.filter(([p]) => /\/pools\/[^/]+$/.test(p)).map(([, v]) => v);
const positions = rows.filter(([p]) => /\/positions\/[^/]+$/.test(p)).map(([, v]) => v);
const errors = [];
for (const wallet of wallets)
  if (
    wallet.cashMinor < 0 ||
    wallet.reservedSeedMinor < 0 ||
    wallet.reservedSeedMinor > wallet.cashMinor
  )
    errors.push(`Invalid wallet ${wallet.teamId}`);
for (const issuer of issuers) {
  const pool = pools.find((p) => p.issuerId === issuer.issuerId);
  const held = positions
    .filter((p) => p.issuerId === issuer.issuerId)
    .reduce((n, p) => n + p.shares, 0);
  if (!pool || held + pool.shareReserve + issuer.primarySharesRemaining !== issuer.issuedShares)
    errors.push(`Supply mismatch ${issuer.issuerId}`);
}
const credits =
  wallets.reduce((s, w) => s + w.cashMinor, 0) +
  pools.reduce((s, p) => s + p.creditReserveMinor, 0) +
  issuers.reduce((s, i) => s + i.fundingVaultMinor, 0);
const expected = wallets.length * 1_000_000 + pools.length * 4_000_000;
if (credits !== expected) errors.push(`Credit total ${credits} differs from genesis ${expected}`);
for (const [path, receipt] of rows.filter(([p]) => p.includes('/receipts/'))) {
  const assets = {};
  for (const entry of receipt.entries || [])
    assets[entry.asset] = (assets[entry.asset] || 0) + entry.delta;
  for (const [asset, amount] of Object.entries(assets))
    if (amount !== 0) errors.push(`Unbalanced ${asset} in ${path}`);
}
console.log(
  JSON.stringify(
    {
      valid: errors.length === 0,
      wallets: wallets.length,
      issuers: issuers.length,
      creditsMinor: credits,
      errors,
    },
    null,
    2,
  ),
);
process.exitCode = errors.length ? 1 : 0;
