import { spawnSync } from 'node:child_process';
for (const [cmd, args] of [
  ['npx', ['vitest', 'run', 'tests/firestore.rules.test.ts']],
  ['node', ['scripts/seed-emulator.mjs', '--seed']],
  ['node', ['scripts/smoke-platform.mjs']],
]) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
