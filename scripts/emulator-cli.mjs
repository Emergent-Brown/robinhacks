import { spawn } from 'node:child_process';
import { emulatorEnvironment } from './emulator-environment.mjs';
const test = process.argv.includes('--test');
const args = [
  '-y',
  'firebase-tools@latest',
  test ? 'emulators:exec' : 'emulators:start',
  '--project',
  'demo-robinhacks',
  '--only',
  test ? 'firestore' : 'auth,firestore,functions',
];
if (test) args.push('npx vitest run tests/firestore.rules.test.ts');
const child = spawn('npx', args, { stdio: 'inherit', env: emulatorEnvironment() });
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
