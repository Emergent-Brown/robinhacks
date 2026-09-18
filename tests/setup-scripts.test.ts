import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { defaultPlatformConfig } from '@robinhacks/core';

const safeEnvironment = {
  ...process.env,
  ROBINHACKS_ORGANIZER_EMAIL: 'operator@example.test',
  FIREBASE_TOKEN: '',
  FIRESTORE_EMULATOR_HOST: '',
  FIREBASE_AUTH_EMULATOR_HOST: '',
  FIREBASE_TOOLS_DIR: '/nonexistent-cli-guard-test',
};
const runner = `
import {createInitialEvent, verifyExistingEvent} from './scripts/bootstrap-firebase.mjs';
let text = ''; for await (const part of process.stdin) text += part;
const input = JSON.parse(text);
if (input.mode === 'create') process.stdout.write(JSON.stringify(await createInitialEvent(123456)));
else {
  const results = input.events.map(event => {
    const before = JSON.stringify(event);
    try {
      verifyExistingEvent(event, input.member, {entries: []}, 'organizer');
      return {accepted: true, unchanged: before === JSON.stringify(event)};
    } catch (error) { return {accepted: false, unchanged: before === JSON.stringify(event), message: error.message}; }
  });
  process.stdout.write(JSON.stringify(results));
}`;
function localFunction(input: unknown) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', runner], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: safeEnvironment,
    timeout: 20_000,
  });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}

describe('safe bootstrap and migration entry points', () => {
  it('creates the event schedule and unfunded prize defaults without any cloud identity or credential lookup', () => {
    const event = localFunction({ mode: 'create' });
    expect(event).toMatchObject({
      id: 'robinhacks-2026',
      name: 'Emergent Hacks 2026',
      venue: 'Nelson Center for Entrepreneurship',
      phase: 'REGISTRATION',
      rulesVersion: 2,
      createdAt: 123456,
    });
    expect(event.platform).toEqual(defaultPlatformConfig());
    expect(event.platform.funding).toMatchObject({
      budget: 100,
      increment: 10,
      maxPerProject: 60,
      minimumDenominator: 200,
      roundWeightsBps: [4000, 3500, 2500],
      investorPoolMinor: 0,
      builderPrizesMinor: [0, 0, 0],
      communityPrizeMinor: 0,
    });
    expect(event.platform.details.dateLabel).toBe('September 26–27, 2026');
  });

  it('recognizes existing v1 and v2 events without modifying either or accepting contradictory versions', () => {
    const results = localFunction({
      mode: 'verify',
      member: { uid: 'organizer', role: 'organizer', teamId: null, status: 'approved' },
      events: [
        { id: 'robinhacks-2026', rulesVersion: 1, phase: 'FINALIZED' },
        {
          id: 'robinhacks-2026',
          rulesVersion: 2,
          phase: 'FINALIZED',
          platform: defaultPlatformConfig(),
        },
        { id: 'robinhacks-2026', rulesVersion: 2 },
        { id: 'robinhacks-2026', rulesVersion: 1, platform: defaultPlatformConfig() },
        { id: 'another-event', rulesVersion: 2, platform: defaultPlatformConfig() },
        { id: 'robinhacks-2026', rulesVersion: 3 },
      ],
    });
    expect(results.map((result: { accepted: boolean }) => result.accepted)).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(results.every((result: { unchanged: boolean }) => result.unchanged)).toBe(true);
  });

  it('does not let compatibility checks attach another organizer or a competing identity', () => {
    for (const member of [
      { uid: 'someone-else', role: 'organizer', teamId: null, status: 'approved' },
      { uid: 'organizer', role: 'captain', teamId: 'team', status: 'approved' },
      { uid: 'organizer', role: 'organizer', teamId: null, status: 'pending' },
    ]) {
      const results = localFunction({
        mode: 'verify',
        member,
        events: [{ id: 'robinhacks-2026', rulesVersion: 2, platform: defaultPlatformConfig() }],
      });
      expect(results[0]).toMatchObject({ accepted: false, unchanged: true });
      expect(results[0].message).toContain('without this approved organizer');
    }
  });

  it('rejects a mismatched cloud project before attempting any CLI login or network operation', () => {
    for (const file of ['bootstrap-firebase.mjs', 'upgrade-sealed-funding.mjs']) {
      const result = spawnSync(
        process.execPath,
        [`scripts/${file}`, '--project', 'unrelated-project-123'],
        { encoding: 'utf8', env: safeEnvironment, timeout: 10_000 },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/must exactly match|must match/);
      expect(result.stderr).not.toContain('nonexistent-cli-guard-test');
    }
  });

  it('requires a real configured organizer identity and explicit migration arguments before credential lookup', () => {
    const bootstrap = spawnSync(
      process.execPath,
      ['scripts/bootstrap-firebase.mjs', '--project', 'robinhacks-2026-ajs'],
      {
        encoding: 'utf8',
        env: { ...safeEnvironment, ROBINHACKS_ORGANIZER_EMAIL: '' },
        timeout: 10_000,
      },
    );
    expect(bootstrap.status).toBe(1);
    expect(bootstrap.stderr).toContain('Set ROBINHACKS_ORGANIZER_EMAIL');
    const migration = spawnSync(process.execPath, ['scripts/upgrade-sealed-funding.mjs'], {
      encoding: 'utf8',
      env: safeEnvironment,
      timeout: 10_000,
    });
    expect(migration.status).toBe(1);
    expect(migration.stderr).toContain('Usage:');
  });
});
