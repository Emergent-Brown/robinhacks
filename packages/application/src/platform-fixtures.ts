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
import { demoProjects } from './demo-projects';
import { addDemoMessages } from './demo-messages';
import type { DocumentMap } from './memory-repository';
export const DEMO_EVENT_ID = 'robinhacks-2026';
export const PLATFORM_USERS = {
  captain: {
    uid: 'demo-captain',
    displayName: 'Alex Chen',
    email: 'alex@example.test',
    emailVerified: true,
  },
  organizer: {
    uid: 'demo-organizer',
    displayName: 'Jamie Park',
    email: 'organizer@example.test',
    emailVerified: true,
  },
  member: {
    uid: 'demo-member',
    displayName: 'Sam Rivera',
    email: 'sam@example.test',
    emailVerified: true,
  },
  judge: {
    uid: 'demo-judge',
    displayName: 'Taylor Brooks',
    email: 'judge@example.test',
    emailVerified: true,
  },
  attendee: {
    uid: 'demo-attendee',
    displayName: 'Casey Morgan',
    email: 'casey@example.test',
    emailVerified: true,
  },
};
export type DemoPreset = 'registration' | 'funding' | 'judging';
/** A clearly fictional v2 fixture. No legacy wallets, pools or positions are carried over. */
export function createPlatformDemoDocuments(
  preset: DemoPreset = 'funding',
  now = Date.now(),
): DocumentMap {
  const root = `events/${DEMO_EVENT_ID}`;
  const docs: DocumentMap = {};
  const teams: Team[] = demoProjects.map((project, index) => ({
    id: `team-${index + 1}`,
    name: project.name,
    ticker: project.ticker,
    category: project.category,
    pitch: project.pitch,
    color: project.color,
    problem: project.problem,
    building: project.building,
    demoUrl: '',
    repoUrl: '',
    update: project.update,
    updatedAt: now - (index + 1) * 180_000,
    eligibility: 'active',
    captainUid: index === 0 ? PLATFORM_USERS.captain.uid : `demo-captain-${index + 1}`,
    version: 0,
  }));
  function addMember(member: Member) {
    docs[`${root}/members/${member.uid}`] = member;
    if (member.teamId) docs[`${root}/teams/${member.teamId}/members/${member.uid}`] = member;
  }
  teams.forEach((team, index) => {
    docs[`${root}/teams/${team.id}`] = team;
    addMember({
      uid: team.captainUid,
      displayName: demoProjects[index]!.captainName,
      email: index === 0 ? PLATFORM_USERS.captain.email : `${team.captainUid}@example.test`,
      emailVerified: true,
      teamId: team.id,
      role: 'captain',
      status: 'approved',
      version: 0,
    });
    demoProjects[index]!.teammates.forEach((displayName, teammateIndex) => {
      const uid =
        index === 0 && teammateIndex === 0
          ? PLATFORM_USERS.member.uid
          : `demo-member-${index + 1}-${teammateIndex + 1}`;
      addMember({
        uid,
        displayName,
        email:
          uid === PLATFORM_USERS.member.uid ? PLATFORM_USERS.member.email : `${uid}@example.test`,
        emailVerified: true,
        teamId: team.id,
        role: 'member',
        status: 'approved',
        version: 0,
      });
    });
  });
  for (const role of ['organizer', 'judge', 'attendee'] as const) {
    const user = PLATFORM_USERS[role];
    addMember({
      ...user,
      teamId: null,
      role: role === 'attendee' ? 'member' : role,
      status: 'approved',
      version: 0,
    });
  }
  const config = defaultPlatformConfig();
  config.details.about =
    'A sample event with 12 fictional teams. Build, share progress, and allocate credits across three sealed rounds.';
  const open = preset !== 'registration';
  const event: EventConfig = {
    id: DEMO_EVENT_ID,
    paused: false,
    pauseReason: '',
    createdAt: now - 7_200_000,
    activeOperationId: null,
    publishedResultId: null,
    announcement: '',
    tieSeed: 'emergent-hacks-demo-2026',
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
    entries: teams.map((team) => ({ team })),
    asOf: now,
    phaseVersion: event.phaseVersion,
  };
  addDemoMessages(docs, root, teams, now, preset !== 'registration');
  return docs;
}
