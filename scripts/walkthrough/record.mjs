#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { actions, helpers } from './scene-actions.mjs';
const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = resolve(root, 'output/playwright/walkthrough');
const plan = JSON.parse(await readFile(resolve(output, 'narration-plan.json'), 'utf8'));
const from = Number(process.argv[2] || 1);
const to = Number(process.argv[3] || plan.segments.length);
if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > 17 || from > to)
  throw new Error('Usage: node scripts/walkthrough/record.mjs [first 1–17] [last 1–17]');
for (const folder of ['raw', 'stills', 'scenes', 'logs'])
  await mkdir(resolve(output, folder), { recursive: true });
for (const segment of plan.segments.slice(from - 1, to)) {
  const mobile = segment.id === '12-mobile';
  const width = mobile ? 390 : 1600;
  const height = mobile ? 844 : 900;
  const source = `async page => {
    if (!/^http:\\/\\/(localhost|127\\.0\\.0\\.1):5180(?:\\/|$)/.test(page.url())) throw new Error('Recording targets only the local demo on port 5180.');
    await page.setViewportSize({ width: ${width}, height: ${height} });
    await page.waitForTimeout(${segment.id === '09-sell' ? 11000 : 400});
    ${helpers}
    await page.screencast.start({ path: ${JSON.stringify(resolve(output, 'raw', segment.id + '.webm'))}, size: { width:${width}, height:${height} } });
    const started = Date.now();
    try {
      ${actions[segment.id]}
      await wait(Math.max(1000, ${Math.ceil((segment.durationSeconds + 1.35) * 1000)} - (Date.now() - started)));
      await page.screenshot({ path: ${JSON.stringify(resolve(output, 'stills', segment.id + '.png'))} });
    } finally { await page.screencast.stop(); }
    return { scene: ${JSON.stringify(segment.id)}, recordedSeconds: (Date.now() - started) / 1000 };
  }`;
  const file = resolve(output, 'scenes', segment.id + '.js');
  await writeFile(file, source);
  console.log(`Recording ${segment.id} — ${segment.perspective}`);
  try {
    const result = await exec(
      'bash',
      [resolve(root, 'scripts/walkthrough/pwcli.sh'), 'run-code', '--filename', file],
      {
        cwd: root,
        env: { ...process.env, ROBINHACKS_CAPTURE_SESSION: 'robinhacks-film' },
        maxBuffer: 4_000_000,
        timeout: 90_000,
      },
    );
    await writeFile(resolve(output, 'logs', segment.id + '.txt'), result.stdout + result.stderr);
    if (result.stdout.includes('### Error')) throw new Error(result.stdout.slice(-2000));
    console.log(`Captured ${segment.id}`);
  } catch (error) {
    await writeFile(
      resolve(output, 'logs', segment.id + '.txt'),
      String(error.stdout || '') + String(error.stderr || '') + String(error.message),
    );
    console.error(
      `Stopped at ${segment.id}: ${String(error.stdout || error.message).slice(-2200)}`,
    );
    process.exitCode = 1;
    break;
  }
}
