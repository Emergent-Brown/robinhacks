import { spawn } from 'node:child_process';
import { emulatorEnvironment } from './emulator-environment.mjs';
import { setTimeout } from 'node:timers/promises';
const requestedPort = process.env.WEB_PORT || '5173';
if (
  !/^\d+$/.test(requestedPort) ||
  !Number.isInteger(Number(requestedPort)) ||
  Number(requestedPort) < 1024 ||
  Number(requestedPort) > 65535
)
  throw new Error('WEB_PORT must be an integer between 1024 and 65535.');
const webPort = String(Number(requestedPort));
const run = (command, args, options = {}) => spawn(command, args, { stdio: 'inherit', ...options });
const built = run('npm', ['run', 'build:functions']);
if (await new Promise((resolve) => built.once('exit', resolve))) process.exit(1);
const emulator = run(
  'npx',
  [
    '-y',
    'firebase-tools@latest',
    'emulators:start',
    '--project',
    'demo-robinhacks',
    '--only',
    'auth,firestore,functions',
  ],
  { env: emulatorEnvironment() },
);
let web;
const stop = () => {
  web?.kill('SIGTERM');
  emulator.kill('SIGTERM');
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
let ready = false;
for (let i = 0; i < 90; i++) {
  if (emulator.exitCode !== null) process.exit(1);
  try {
    const response = await fetch('http://127.0.0.1:9099/');
    if (response.ok) {
      ready = true;
      break;
    }
  } catch {}
  await setTimeout(1000);
}
if (!ready) {
  console.error('Emulators did not become ready. Check the output above.');
  stop();
  process.exit(1);
}
await setTimeout(2500);
const seed = run('npm', ['run', 'seed']);
if (await new Promise((resolve) => seed.once('exit', resolve))) {
  stop();
  process.exit(1);
}
web = run('npm', ['run', 'dev', '--workspace', '@robinhacks/web', '--', '--port', webPort], {
  env: { ...process.env, VITE_APP_MODE: 'emulator' },
});
web.once('exit', stop);
