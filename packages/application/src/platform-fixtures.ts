import { DEFAULT_EVENT_VENUE, defaultPlatformConfig, SealedFunding } from '@robinhacks/core';
import type {
  EventConfig,
  FundingRound,
  Member,
  ProjectUpdate,
  RoundAllocation,
  ProjectSubmission,
  Team,
} from '@robinhacks/core';
import { createDemoDocuments, DEMO_EVENT_ID, DEMO_USERS } from './fixtures';
import type { DocumentMap } from './memory-repository';
export { DEMO_EVENT_ID };
export const PLATFORM_USERS = {
  ...(Object.fromEntries(
    Object.entries(DEMO_USERS).map(([role, user]) => [role, { ...user, emailVerified: true }]),
  ) as {
    [K in keyof typeof DEMO_USERS]: (typeof DEMO_USERS)[K] & { emailVerified: boolean };
  }),
  judge: {
    uid: 'demo-judge',
    displayName: 'Taylor Brooks',
    email: 'judge@example.test',
    emailVerified: true,
  },
};
/** A clearly fictional v2 fixture. No legacy wallets, pools or positions are carried over. */
export function createPlatformDemoDocuments(
  preset: 'seed' | 'trading' | 'judging' = 'trading',
  now = Date.now(),
): DocumentMap {
  const source = createDemoDocuments('seed', now);
  const root = `events/${DEMO_EVENT_ID}`;
  const docs: DocumentMap = {};
  for (const [path, value] of Object.entries(source))
    if (path.includes('/teams/') || path.includes('/members/')) docs[path] = structuredClone(value);
  const teams = Object.entries(docs)
    .filter(([path]) => new RegExp(`^${root}/teams/[^/]+$`).test(path))
    .map(([, team]) => team as Team);
  for (const [path, value] of Object.entries(docs))
    if (path.includes('/members/')) {
      const member = value as Member;
      docs[path] = { ...member, email: `${member.uid}@example.test`, emailVerified: true };
    }
  const config = defaultPlatformConfig();
  config.details.about =
    'A sample event with 12 fictional teams. Build, share progress, and allocate credits across three sealed rounds.';
  const open = preset !== 'seed';
  const event: EventConfig = {
    ...(source[root] as EventConfig),
    name: 'Emergent Hacks 2026',
    venue: DEFAULT_EVENT_VENUE,
    rulesVersion: 2,
    phase: open ? 'SEED_OPEN' : 'REGISTRATION',
    phaseVersion: open ? 4 : 1,
    windowId: open ? 2 : 0,
    closesAt: open ? now + 20 * 60000 : null,
    platform: {
      ...config,
      currentRound: open ? 2 : 0,
      rulesLockedAt: open ? now - 60 * 60000 : null,
    },
  };
  docs[root] = event;
  docs[`${root}/members/demo-judge`] = {
    uid: 'demo-judge',
    displayName: 'Taylor Brooks',
    email: 'judge@example.test',
    emailVerified: true,
    teamId: null,
    role: 'judge',
    status: 'approved',
    version: 0,
  } satisfies Member;
  docs[`${root}/judgeAssignments/demo-judge`] = {
    uid: 'demo-judge',
    projectIds: teams.map((team) => team.id),
    conflictIds: [],
    version: 1,
  };
  for (const team of teams) {
    docs[`${root}/teams/${team.id}`] = team;
    for (let round = 1; round <= (open ? 2 : 1); round++) {
      const update: ProjectUpdate = {
        id: `checkpoint-${round}-${team.id}`,
        teamId: team.id,
        round,
        works: team.building.slice(0, 580),
        changed: round === 1 ? 'Initial pitch.' : team.update,
        evidenceUrl: '',
        incomplete: 'This is a working prototype. More testing and polish remain.',
        authorName: team.captainUid,
        createdAt: now - (3 - round) * 30 * 60000,
      };
      docs[`${root}/projectUpdates/${update.id}`] = update;
    }
  }
  if (open) {
    const seed: FundingRound = {
      id: 'funding-1',
      number: 1,
      name: config.funding.roundNames[0],
      state: 'open',
      openedAt: now - 60 * 60000,
      closesAt: now - 40 * 60000,
      closedAt: null,
      weightBps: 4000,
      minimumDenominator: 200,
      eligibleTeamIds: teams.map((team) => team.id),
      totals: {},
      voidReason: '',
      version: 1,
    };
    const allocations: RoundAllocation[] = teams.map((team, index) => ({
      id: `funding-1__${team.id}`,
      roundId: seed.id,
      teamId: team.id,
      amounts: {
        [teams[(index + 1) % teams.length].id]: 60,
        [teams[(index + 2) % teams.length].id]: 30,
        [teams[(index + 3) % teams.length].id]: 10,
      },
      version: 1,
      updatedAt: now - 50 * 60000,
      actorUid: team.captainUid,
    }));
    const closed = SealedFunding.closeRound(seed, allocations, config.funding, now - 40 * 60000);
    docs[`${root}/fundingRounds/funding-1`] = closed.round;
    for (const allocation of allocations)
      docs[`${root}/roundAllocations/${allocation.id}`] = allocation;
    for (const entitlement of closed.entitlements)
      docs[`${root}/roundEntitlements/${entitlement.id}`] = entitlement;
    docs[`${root}/fundingRounds/funding-2`] = {
      ...seed,
      id: 'funding-2',
      number: 2,
      name: config.funding.roundNames[1],
      openedAt: now,
      closesAt: event.closesAt,
      weightBps: 3500,
      version: 1,
    };
  }
  if (preset === 'judging') {
    for (let number = 2; number <= 3; number++) {
      const round: FundingRound = {
        id: `funding-${number}`,
        number,
        name: config.funding.roundNames[number - 1],
        state: 'open',
        openedAt: now - (5 - number) * 30 * 60000,
        closesAt: now - (4 - number) * 30 * 60000,
        closedAt: null,
        weightBps: config.funding.roundWeightsBps[number - 1],
        minimumDenominator: 200,
        eligibleTeamIds: teams.map((team) => team.id),
        totals: {},
        voidReason: '',
        version: 1,
      };
      const allocations: RoundAllocation[] = teams.map((team, index) => ({
        id: `${round.id}__${team.id}`,
        roundId: round.id,
        teamId: team.id,
        amounts: {
          [teams[(index + number) % teams.length].id]: 60,
          [teams[(index + number + 1) % teams.length].id]: 40,
        },
        version: 1,
        updatedAt: round.openedAt + 60000,
        actorUid: team.captainUid,
      }));
      const closed = SealedFunding.closeRound(round, allocations, config.funding, round.closesAt);
      docs[`${root}/fundingRounds/${round.id}`] = closed.round;
      for (const row of allocations) docs[`${root}/roundAllocations/${row.id}`] = row;
      for (const row of closed.entitlements) docs[`${root}/roundEntitlements/${row.id}`] = row;
    }
    for (const team of teams) {
      const update: ProjectUpdate = {
        id: `checkpoint-3-${team.id}`,
        teamId: team.id,
        round: 3,
        works: team.building.slice(0, 580),
        changed: team.update,
        evidenceUrl: '',
        incomplete: 'Sample prototype: final testing and polish remain.',
        authorName: team.captainUid,
        createdAt: now - 75 * 60000,
      };
      docs[`${root}/projectUpdates/${update.id}`] = update;
      docs[`${root}/submissions/${team.id}`] = {
        id: team.id,
        teamId: team.id,
        submittedAt: now - 65 * 60000,
        submittedBy: team.captainUid,
        name: team.name,
        pitch: team.pitch,
        problem: team.problem,
        building: team.building,
        demoUrl: 'https://example.com',
        repoUrl: 'https://github.com/Emergent-Brown/robinhacks',
        commitSha: 'df5295778b9236795c808ed13d6a245c9cc6c4e1',
        techStack: 'Fictional demo submission',
        roster: Object.values(docs)
          .filter(
            (entry): entry is Member =>
              !!entry &&
              typeof entry === 'object' &&
              'uid' in entry &&
              'role' in entry &&
              'teamId' in entry &&
              (entry as Member).teamId === team.id,
          )
          .filter(
            (member, index, list) => list.findIndex((other) => other.uid === member.uid) === index,
          )
          .map((member) => ({ uid: member.uid, name: member.displayName })),
      } satisfies ProjectSubmission;
    }
    event.phase = 'FROZEN';
    event.phaseVersion = 8;
    event.windowId = 3;
    event.closesAt = null;
    event.platform!.currentRound = 3;
  }
  docs[`${root}/views/market`] = {
    entries: teams.map((team) => ({
      team,
      pool: {
        issuerId: team.id,
        shareReserve: 0,
        creditReserveMinor: 0,
        version: 0,
        halted: false,
      },
      issuer: {
        issuerId: team.id,
        issuedShares: 0,
        primarySharesRemaining: 0,
        fundingVaultMinor: 0,
        seedBackers: 0,
        version: 0,
      },
    })),
    asOf: now,
    phaseVersion: event.phaseVersion,
  };
  return docs;
}
