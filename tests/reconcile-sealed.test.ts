import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Command, EventConfig, Team } from '@robinhacks/core';
import { GameService } from '../packages/application/src/game-service';
import {
  createPlatformDemoDocuments,
  DEMO_EVENT_ID,
  PLATFORM_USERS,
} from '../packages/application/src/platform-fixtures';
import { MemoryRepository } from '../packages/application/src/memory-repository';
import { createDemoDocuments } from '../packages/application/src/fixtures';

// Run the actual standalone Node module: it must not depend on TS aliases or application math.
const runner = `import {reconcileSealedExport} from './scripts/reconcile-sealed-export.mjs'; let input=''; for await(const part of process.stdin) input+=part; process.stdout.write(JSON.stringify(reconcileSealedExport(JSON.parse(input))));`;
function reconcile(data: unknown): {
  valid: boolean;
  errors: string[];
  investorPaidMinor: number;
  reserveMinor: number;
} {
  return JSON.parse(
    execFileSync(process.execPath, ['--input-type=module', '-e', runner], {
      input: JSON.stringify(data),
      encoding: 'utf8',
    }),
  );
}
// Exported JSON is intentionally untyped: corruption cases exercise the import boundary.
let published: Record<string, any>;
let cancelled: Record<string, any>;

beforeAll(async () => {
  const start = 10_000_000;
  let now = start;
  let sequence = 0;
  const documents = createPlatformDemoDocuments('seed', start);
  const root = `events/${DEMO_EVENT_ID}`;
  const sourceEvent = documents[root] as EventConfig;
  sourceEvent.platform!.funding.investorPoolMinor = 10_001;
  sourceEvent.platform!.funding.builderPrizesMinor = [50_000, 20_000, 10_000];
  sourceEvent.platform!.funding.communityPrizeMinor = 5_000;
  sourceEvent.platform!.funding.reviewMinutes = 1;
  const repository = new MemoryRepository(documents);
  const service = new GameService(repository, DEMO_EVENT_ID, { now: () => now });
  const event = () => repository.dump()[root] as EventConfig;
  const teams = Object.entries(documents)
    .filter(([path]) => new RegExp(`^${root}/teams/[^/]+$`).test(path))
    .map(([, team]) => team as Team);
  const actor = (team: Team) => ({
    uid: team.captainUid,
    displayName: team.name,
    email: `${team.captainUid}@example.test`,
    emailVerified: true,
  });
  const run = (
    identity: typeof PLATFORM_USERS.organizer | ReturnType<typeof actor>,
    command: Record<string, unknown>,
  ) =>
    service.execute(identity, {
      commandId: `reconcile-command-${++sequence}`,
      ...command,
    } as Command);
  for (const number of [1, 2, 3]) {
    if (number > 1) {
      for (const team of teams)
        await run(actor(team), {
          type: 'publishUpdate',
          round: number,
          works: 'The full demonstration works.',
          changed: 'Added the reviewed feature.',
          evidenceUrl: '',
          incomplete: 'More testing remains.',
        });
    }
    if (number === 3) {
      await run(PLATFORM_USERS.organizer, {
        type: 'setSubmissionWindow',
        open: true,
        closesAt: now + 60_000,
        expectedPhaseVersion: event().phaseVersion,
      });
      for (const team of teams) {
        await run(actor(team), {
          type: 'updateTeam',
          expectedVersion: 0,
          patch: {
            demoUrl: `https://example.test/${team.id}`,
            repoUrl: `https://example.test/repository/${team.id}`,
          },
        });
        await run(actor(team), {
          type: 'submitProject',
          expectedTeamVersion: 1,
          commitSha: 'a'.repeat(40),
          techStack: 'TypeScript',
        });
      }
    }
    await run(PLATFORM_USERS.organizer, {
      type: 'openFundingRound',
      expectedPhaseVersion: event().phaseVersion,
      durationMinutes: 1,
    });
    await run(PLATFORM_USERS.captain, {
      type: 'saveAllocation',
      roundId: `funding-${number}`,
      amounts: { 'team-2': 60, 'team-3': 40 },
      expectedVersion: 0,
    });
    if (number === 1) {
      const fork = new MemoryRepository(repository.dump());
      const cancellation = new GameService(fork, DEMO_EVENT_ID, { now: () => now });
      await cancellation.execute(PLATFORM_USERS.organizer, {
        type: 'transitionEvent',
        commandId: 'cancel-for-reconciliation',
        target: 'CANCELLED',
        expectedPhaseVersion: event().phaseVersion,
      });
      cancelled = await cancellation.exportEvent(PLATFORM_USERS.organizer.uid);
    }
    now += 60_000;
    await run(PLATFORM_USERS.organizer, {
      type: 'closeFundingRound',
      roundId: `funding-${number}`,
      expectedPhaseVersion: event().phaseVersion,
    });
  }
  await run(PLATFORM_USERS.organizer, {
    type: 'beginJudging',
    expectedPhaseVersion: event().phaseVersion,
  });
  await run(PLATFORM_USERS.organizer, {
    type: 'setBallotWindow',
    open: true,
    closesAt: now + 60_000,
    expectedPhaseVersion: event().phaseVersion,
  });
  await run(PLATFORM_USERS.captain, {
    type: 'saveBallot',
    expectedVersion: 0,
    rankedProjectIds: ['team-3', 'team-2', 'team-4'],
  });
  const rubric = event().platform!.funding.rubric;
  await run(PLATFORM_USERS.judge, {
    type: 'saveJudgingSheet',
    expectedVersion: 0,
    submit: true,
    entries: Object.fromEntries(
      teams.map((team) => [
        team.id,
        {
          scores: Object.fromEntries(
            rubric.map((criterion) => [criterion.id, team.id === 'team-2' ? 5 : 3]),
          ),
          note: '',
          conflict: false,
        },
      ]),
    ),
  });
  now += 60_000;
  await run(PLATFORM_USERS.organizer, {
    type: 'prepareAwards',
    expectedPhaseVersion: event().phaseVersion,
    winnerId: 'team-2',
    tiebreakReason: '',
  });
  now += 60_000;
  await run(PLATFORM_USERS.organizer, {
    type: 'publishAwards',
    expectedPhaseVersion: event().phaseVersion,
  });
  published = await service.exportEvent(PLATFORM_USERS.organizer.uid);
});

describe('independent exported sealed-ledger reconciliation', () => {
  it('reconciles a real application export across three rounds, judging, distinct community results, and exact cents', () => {
    const report = reconcile(published);
    expect(report).toMatchObject({
      valid: true,
      errors: [],
      investorPaidMinor: 3_000,
      reserveMinor: 7_001,
    });
    expect(published.awardResults[0].winnerId).toBe('team-2');
    expect(published.awardResults[0].communityWinnerId).toBe('team-3');
  });

  it('accepts a formally cancelled, unrevealed round without creating payout claims', () => {
    expect(reconcile(cancelled)).toMatchObject({ valid: true, errors: [], publishedAwards: false });
  });

  it('preserves closed-round void history and verifies a zero investor prize pool', () => {
    const voided = structuredClone(published);
    voided.event.phase = 'CANCELLED';
    voided.event.publishedResultId = null;
    voided.awardResults = [];
    voided.fundingRounds[0].state = 'void';
    voided.fundingRounds[0].voidReason = 'The full round was voided after an outage.';
    for (const entitlement of voided.roundEntitlements)
      if (entitlement.roundNumber === 1) entitlement.voided = true;
    expect(reconcile(voided).valid).toBe(true);
    const zero = structuredClone(published);
    zero.event.platform.funding.investorPoolMinor = 0;
    for (const awards of zero.awardResults) {
      awards.settings.investorPoolMinor = 0;
      awards.investorPaidMinor = 0;
      awards.reserveMinor = 0;
      for (const investor of awards.investors) investor.rewardMinor = 0;
    }
    expect(reconcile(zero)).toMatchObject({ valid: true, investorPaidMinor: 0, reserveMinor: 0 });
  });

  it.each<[string, (data: Record<string, any>) => void]>([
    ['duplicate allocation', (data) => data.roundAllocations.push(data.roundAllocations[0])],
    ['missing entitlement', (data) => data.roundEntitlements.pop()],
    [
      'orphan allocation',
      (data) =>
        data.roundAllocations.push({
          ...data.roundAllocations[0],
          id: 'funding-9__team-1',
          roundId: 'funding-9',
        }),
    ],
    [
      'self funding',
      (data) => {
        data.roundAllocations[0].amounts['team-1'] = 10;
      },
    ],
    [
      'wrong increment',
      (data) => {
        data.roundAllocations[0].amounts['team-2'] = 5;
      },
    ],
    [
      'project cap exceeded',
      (data) => {
        data.roundAllocations[0].amounts['team-2'] = 70;
      },
    ],
    [
      'budget exceeded',
      (data) => {
        data.roundAllocations[0].amounts['team-3'] = 60;
      },
    ],
    [
      'deadline violated',
      (data) => {
        data.roundAllocations[0].updatedAt = data.fundingRounds[0].closesAt;
      },
    ],
    [
      'incorrect actor',
      (data) => {
        data.roundAllocations[0].actorUid = 'demo-judge';
      },
    ],
    [
      'closed total changed',
      (data) => {
        data.fundingRounds[0].totals['team-2'] += 10;
      },
    ],
    [
      'round tranche changed',
      (data) => {
        data.fundingRounds[0].weightBps = 5000;
      },
    ],
    [
      'denominator diluted',
      (data) => {
        data.roundEntitlements.find(
          (entry: any) => entry.projects.length,
        ).projects[0].denominator += 100;
      },
    ],
    [
      'expired budget changed',
      (data) => {
        data.roundEntitlements[0].expired += 10;
      },
    ],
    [
      'selective void',
      (data) => {
        data.roundEntitlements[0].voided = true;
      },
    ],
    [
      'duplicate project claim',
      (data) => {
        const row = data.roundEntitlements.find((entry: any) => entry.projects.length);
        row.projects.push(row.projects[0]);
      },
    ],
    [
      'missing publication',
      (data) => {
        data.awardResults = [];
      },
    ],
    [
      'conflicting publication copies',
      (data) => {
        data.awardResults[0].reserveMinor += 1;
      },
    ],
    [
      'too many publication copies',
      (data) => {
        data.awardResults.push(data.awardResults[0]);
      },
    ],
    [
      'open round disclosed',
      (data) => {
        data.fundingRounds[2].state = 'open';
      },
    ],
    [
      'ineligible winner',
      (data) => {
        data.teams.find((team: any) => team.id === 'team-2').eligibility = 'disqualified';
      },
    ],
    [
      'missing final submission',
      (data) => {
        data.submissions = data.submissions.filter(
          (submission: any) => submission.teamId !== 'team-2',
        );
      },
    ],
    [
      'judging score exceeds the published 0–5 scale',
      (data) => {
        data.judgingSheets[0].entries['team-2'].scores.functionality = 6;
      },
    ],
    [
      'judging score changed',
      (data) => {
        data.judgingSheets[0].entries['team-2'].scores.functionality = 0;
      },
    ],
    [
      'investor reward off by a cent',
      (data) => {
        for (const result of data.awardResults) result.investors[0].rewardMinor += 1;
      },
    ],
    [
      'reserve off by a cent',
      (data) => {
        for (const result of data.awardResults) result.reserveMinor += 1;
      },
    ],
    [
      'builder prize mixed with investor rewards',
      (data) => {
        for (const result of data.awardResults)
          result.projects[0].builderPrizeMinor += result.investorPaidMinor;
      },
    ],
    [
      'community tally changed',
      (data) => {
        for (const result of data.awardResults) result.community[0].points += 1;
      },
    ],
    [
      'frozen result settings changed',
      (data) => {
        for (const result of data.awardResults) result.settings.minimumDenominator = 300;
      },
    ],
    [
      'results review skipped',
      (data) => {
        for (const result of data.awardResults) result.publishedAt = result.createdAt;
      },
    ],
  ])('rejects %s without printing private records', (_label, corrupt) => {
    const data = structuredClone(published);
    corrupt(data);
    const report = reconcile(data);
    expect(report.valid).toBe(false);
    expect(report.errors.length).toBeGreaterThan(0);
    expect(report.errors.every((error) => /^[A-Z0-9_]+$/.test(error))).toBe(true);
  });

  it('handles the documented CLI and returns a failing exit status for corrupted records', () => {
    const directory = mkdtempSync(join(tmpdir(), 'robinhacks-reconcile-'));
    try {
      const file = join(directory, 'event.json');
      writeFileSync(file, JSON.stringify(published));
      const success = spawnSync(process.execPath, ['scripts/reconcile-export.mjs', file], {
        encoding: 'utf8',
      });
      expect(success.status).toBe(0);
      expect(success.stdout).toContain('PASS sealed funding reconciliation');
      const invalid = structuredClone(published);
      invalid.roundEntitlements.pop();
      writeFileSync(file, JSON.stringify(invalid));
      const failure = spawnSync(process.execPath, ['scripts/reconcile-export.mjs', file], {
        encoding: 'utf8',
      });
      expect(failure.status).toBe(1);
      expect(failure.stdout).toContain('FAIL sealed funding reconciliation');
      expect(failure.stdout).not.toContain('example.test');
      expect(failure.stdout).not.toContain('team-1');
      const canary = 'private-export-canary-9284@example.test';
      writeFileSync(file, `{"email":"${canary}", malformed}`);
      const malformed = spawnSync(process.execPath, ['scripts/reconcile-export.mjs', file], {
        encoding: 'utf8',
      });
      expect(malformed.status).toBe(1);
      expect(malformed.stderr).toContain('Unable to read a valid JSON export');
      expect(malformed.stdout + malformed.stderr).not.toContain(canary);
      writeFileSync(file, JSON.stringify(createDemoDocuments('seed', 10_000_000)));
      const legacy = spawnSync(process.execPath, ['scripts/reconcile-export.mjs', file], {
        encoding: 'utf8',
      });
      expect(legacy.status).toBe(0);
      expect(JSON.parse(legacy.stdout).valid).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
