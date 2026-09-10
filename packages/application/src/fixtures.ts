import type {
  EventConfig,
  Member,
  Team,
  Wallet,
  Pool,
  Issuer,
  Position,
  Receipt,
  Note,
} from '@robinhacks/core';
import type { DocumentMap } from './memory-repository';
export const DEMO_EVENT_ID = 'robinhacks-2026';
export const DEMO_USERS = {
  captain: { uid: 'demo-captain', displayName: 'Alex Chen', email: 'alex@example.test' },
  organizer: {
    uid: 'demo-organizer',
    displayName: 'Jamie Park',
    email: 'organizer@example.test',
  },
  member: { uid: 'demo-member', displayName: 'Sam Rivera', email: 'sam@example.test' },
};
interface DemoProject {
  name: string;
  ticker: string;
  category: string;
  pitch: string;
  color: string;
  problem: string;
  building: string;
  update: string;
  captainName: string;
  teammates: readonly [string, string, string];
}

/** Fictional pilot teams. Profile content is separate from the balanced event ledger below. */
const projects: readonly DemoProject[] = [
  {
    name: 'Mosaic',
    ticker: 'MOS',
    category: 'Design tools',
    pitch: 'Turn a messy whiteboard into a plan your team can follow.',
    color: '#4768dc',
    problem:
      'A team makes a decision on a whiteboard, then loses the reasoning in screenshots and chat. The next person has to ask the same questions again.',
    building:
      'A shared canvas where sticky notes link to decisions, owners, and next steps. Teams can export the resulting plan as Markdown without moving their whole workflow.',
    update:
      'Six sticky notes can now become a linked decision and a task list. Sam fixed live edits between two browsers; next we are testing reconnects.',
    captainName: 'Alex Chen',
    teammates: ['Sam Rivera', 'Priya Nair', 'Jordan Lee'],
  },
  {
    name: 'Nimbus',
    ticker: 'NIM',
    category: 'Climate',
    pitch: 'Check the next six hours of weather, even off the grid.',
    color: '#7d92bf',
    problem:
      'Field crews lose access to forecast maps when their connection drops. A screenshot cannot tell them how old the forecast is or what changed nearby.',
    building:
      'A laptop app that downloads a regional forecast, then serves six-hour maps and station history offline. Every view shows when its data was last downloaded.',
    update:
      'Offline maps now reopen after a restart. Maya is checking the six-hour forecast against station readings; older downloads still need a clearer timestamp.',
    captainName: 'Maya Patel',
    teammates: ['Theo Brooks', 'Elena Ruiz', 'Noah Kim'],
  },
  {
    name: 'Halide',
    ticker: 'HAL',
    category: 'Developer tools',
    pitch: 'Review a Postgres migration before it breaks production.',
    color: '#292d35',
    problem:
      'Reviewing a SQL file does not show which columns disappear or whether a backfill works on existing rows. Reviewers often discover those problems after merging.',
    building:
      'A pull-request check that applies migrations to a disposable Postgres database, shows the schema diff, and flags destructive changes before a reviewer approves them.',
    update:
      'The PR check now catches a dropped column and a failing backfill. Marcus is adding a rollback example; lock-time estimates are still out of scope.',
    captainName: 'Marcus Reed',
    teammates: ['Aisha Khan', 'Ben Park', 'Lena Ortiz'],
  },
  {
    name: 'Kettle',
    ticker: 'KTL',
    category: 'Consumer',
    pitch: 'Make dinner with a few neighbors instead of cooking alone.',
    color: '#d58d4d',
    problem:
      'People want to meet nearby neighbors, but hosting a meal means juggling group chats, dietary needs, and who is buying which ingredients.',
    building:
      'A mobile page for hosting a small neighborhood dinner, reserving a seat, sharing dietary restrictions, and dividing up the grocery list.',
    update:
      'Two complete dinner sign-ups tested on phones. Hosts can set four seats and split the grocery list; we are tightening the allergy confirmation.',
    captainName: 'Sofia Martinez',
    teammates: ['Ethan Wu', 'Nia Robinson', 'Oliver Gray'],
  },
  {
    name: 'Orbit',
    ticker: 'ORB',
    category: 'Education',
    pitch: 'Find the exact step you missed in a problem set.',
    color: '#8267ba',
    problem:
      'A wrong answer does not tell a student whether they missed the algebra, the definition, or the setup. Rereading an entire chapter wastes the time they have to practice.',
    building:
      'A study map for an introductory statistics course. Short diagnostic questions identify a missed concept, then point to a worked example and another practice problem.',
    update:
      'The probability unit has eight diagnostic questions and three worked examples. Four classmates tried it; two got stuck on the same wording, which we have rewritten.',
    captainName: 'Daniel Kim',
    teammates: ['Chloe Wong', 'Ravi Shah', 'Zoe Bennett'],
  },
  {
    name: 'Sunbelt',
    ticker: 'SUN',
    category: 'Climate',
    pitch: 'Compare two solar quotes without decoding the fine print.',
    color: '#c39a29',
    problem:
      'Solar proposals use different assumptions for electricity prices, panel output, and financing. Homeowners cannot tell whether two headline savings figures are comparable.',
    building:
      'A side-by-side quote worksheet with shared assumptions for roof size, annual usage, and electricity price. Users can inspect each calculation and change one assumption at a time.',
    update:
      'Two sample proposals now compare on the same assumptions. The usage slider updates both estimates; equipment warranties are still entered by hand.',
    captainName: 'Leila Hassan',
    teammates: ['Isaac Turner', 'Emma Zhang', 'Adrian Costa'],
  },
  {
    name: 'Patch',
    ticker: 'PTCH',
    category: 'Health',
    pitch: 'Complete clinic intake once, then review it at the front desk.',
    color: '#68856e',
    problem:
      'Patients repeat the same contact and intake details across paper forms. Front-desk staff then retype those answers and chase missing fields.',
    building:
      'An accessible intake form with a patient review screen and a structured handoff for reception. The hackathon demo uses fictional records and keeps the handoff local.',
    update:
      'Keyboard-only intake and the front-desk review both work with fictional records. Tessa is testing larger text; importing into a clinic system is outside this demo.',
    captainName: 'Tessa Nguyen',
    teammates: ['Omar Ali', 'Grace Liu', 'Mateo Silva'],
  },
  {
    name: 'Relay',
    ticker: 'RLY',
    category: 'Developer tools',
    pitch: 'Follow one failed request across all of your services.',
    color: '#bc6f5e',
    problem:
      'A timeout appears in one service, but the failure started two hops earlier. Developers piece the story together from separate logs and incompatible timestamps.',
    building:
      'A trace viewer that accepts an OpenTelemetry export and draws a single request as a readable timeline. Clicking a slow hop reveals its span details and related errors.',
    update:
      'A checkout trace now connects five services and highlights a slow inventory call. Andre is fixing duplicate spans before trying a second trace export.',
    captainName: 'Andre Wilson',
    teammates: ['Sienna Chen', 'Felix Weber', 'Imani Cole'],
  },
  {
    name: 'Common',
    ticker: 'CMN',
    category: 'Community',
    pitch: 'Borrow the drill next door instead of buying another one.',
    color: '#638d96',
    problem:
      'Useful tools sit idle while neighbors buy the same equipment for a single job. Informal lending breaks down when nobody knows whether an item is available or returned.',
    building:
      'A neighborhood tool shelf with availability, pickup windows, and a clear borrowing record. Owners approve requests and borrowers confirm that an item is back.',
    update:
      'The first borrow-and-return flow works for six sample tools. Two people can no longer reserve the same pickup slot; reminder messages are not part of this build.',
    captainName: 'Julia Morales',
    teammates: ['Owen Patel', 'Aria Shah', 'Leo Campbell'],
  },
  {
    name: 'Folio',
    ticker: 'FOL',
    category: 'Design tools',
    pitch: 'Keep the source attached to every visual reference.',
    color: '#9b7186',
    problem:
      'Design references get saved as unnamed screenshots. When a team wants to revisit the original work or credit its creator, the source has disappeared.',
    building:
      'A visual reference board that saves an image, its source link, and a short note together. Collections can be searched by tag and shared as a simple review page.',
    update:
      'Pasted links now keep their source alongside the thumbnail. Ren tested a 40-image collection on mobile; a few sites still need a manual image upload.',
    captainName: 'Ren Tanaka',
    teammates: ['Avery Brooks', 'Mina Farah', 'Luca Moretti'],
  },
  {
    name: 'Current',
    ticker: 'CUR',
    category: 'Energy',
    pitch: 'See which room is still using power after everyone leaves.',
    color: '#4e8280',
    problem:
      'A building-level meter shows total consumption, but it hides the room or device that stayed on overnight. Facilities teams need a smaller place to start investigating.',
    building:
      'A room-by-room dashboard for plug-meter readings, with a CSV import for older hardware. Teams can compare occupied and empty hours and inspect the readings behind each chart.',
    update:
      'Two plug meters are feeding the dashboard, and CSV uploads use the same chart. Priya is checking timezone handling before adding an overnight comparison.',
    captainName: 'Priya Desai',
    teammates: ['Henry Tran', 'Amara Okafor', 'Kai Morgan'],
  },
  {
    name: 'Loom',
    ticker: 'LOM',
    category: 'Accessibility',
    pitch: 'Follow a group conversation with captions you can read.',
    color: '#6670a1',
    problem:
      'Captions become difficult to follow when speakers interrupt each other or the text disappears too quickly. Participants need room to read back without losing the conversation.',
    building:
      'A conversation view with persistent captions, adjustable text size, and manual speaker labels. The prototype focuses on a readable transcript before attempting automatic speaker detection.',
    update:
      'Caption history and text resizing work in a four-person test. Quinn added manual speaker labels after overlapping speech confused the first version.',
    captainName: 'Quinn Ellis',
    teammates: ['Mei Lin', 'Diego Alvarez', 'Sara Haddad'],
  },
];
export function createDemoDocuments(
  phase: 'seed' | 'trading' = 'trading',
  now = Date.now(),
): DocumentMap {
  const root = `events/${DEMO_EVENT_ID}`;
  const docs: DocumentMap = {};
  const event: EventConfig = {
    id: DEMO_EVENT_ID,
    name: 'RobinHacks 2026',
    venue: 'Silicon Valley',
    phase: phase === 'seed' ? 'SEED_OPEN' : 'TRADING_OPEN',
    phaseVersion: phase === 'seed' ? 1 : 4,
    paused: false,
    pauseReason: '',
    windowId: phase === 'seed' ? 0 : 1,
    closesAt: now + (phase === 'seed' ? 20 : 30) * 60_000,
    createdAt: now - 7_200_000,
    rulesVersion: 1,
    activeOperationId: null,
    publishedResultId: null,
    announcement: '',
    tieSeed: 'robinhacks-pilot-seed-2026',
  };
  docs[root] = event;
  if (phase === 'trading')
    docs[`${root}/views/seedPublication`] = {
      operationId: 'demo-seed',
      publishedAt: now - 3_600_000,
    };
  const teams: Team[] = projects.map((project, i) => ({
    id: `team-${i + 1}`,
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
    updatedAt: now - (i + 1) * 180_000,
    eligibility: 'active',
    captainUid: i === 0 ? 'demo-captain' : `demo-captain-${i + 1}`,
    version: 0,
  }));
  for (let i = 0; i < teams.length; i++) {
    const team = teams[i];
    docs[`${root}/teams/${team.id}`] = team;
    const member: Member = {
      uid: team.captainUid,
      displayName: projects[i].captainName,
      teamId: team.id,
      role: 'captain',
      status: 'approved',
      version: 0,
    };
    docs[`${root}/members/${member.uid}`] = member;
    docs[`${root}/teams/${team.id}/members/${member.uid}`] = member;
    for (const [index, displayName] of projects[i].teammates.entries()) {
      const uid = i === 0 && index === 0 ? 'demo-member' : `demo-member-${i + 1}-${index + 1}`;
      const teammate: Member = {
        uid,
        displayName,
        teamId: team.id,
        role: 'member',
        status: 'approved',
        version: 0,
      };
      docs[`${root}/members/${uid}`] = teammate;
      docs[`${root}/teams/${team.id}/members/${uid}`] = teammate;
    }
    const wallet: Wallet = {
      teamId: team.id,
      cashMinor: phase === 'seed' ? 1_000_000 : 850_000,
      reservedSeedMinor: 0,
      version: phase === 'seed' ? 0 : 1,
      lastTradeAt: 0,
      tradeWindowId: phase === 'seed' ? 0 : 1,
      successfulTradesInWindow: 0,
    };
    const pool: Pool = {
      issuerId: team.id,
      shareReserve: 400,
      creditReserveMinor: 4_000_000,
      version: 0,
      halted: false,
    };
    const issuer: Issuer = {
      issuerId: team.id,
      issuedShares: 500,
      primarySharesRemaining: phase === 'seed' ? 100 : 85,
      fundingVaultMinor: phase === 'seed' ? 0 : 150_000,
      seedBackers: phase === 'seed' ? 0 : 3,
      version: phase === 'seed' ? 0 : 3,
    };
    docs[`${root}/wallets/${team.id}`] = wallet;
    docs[`${root}/pools/${team.id}`] = pool;
    docs[`${root}/issuers/${team.id}`] = issuer;
    docs[`${root}/wallets/${team.id}/commitments/current`] = {
      shares: {},
      version: 0,
      updatedAt: now,
    };
    const genesis: Receipt = {
      id: `genesis-${team.id}`,
      kind: 'genesis',
      teamId: team.id,
      actorUid: 'SYSTEM',
      acceptedAt: event.createdAt,
      detail: 'Initial team allocation and exchange reserves',
      entries: [
        { account: `wallet:${team.id}`, asset: 'credits', delta: 1_000_000 },
        { account: `pool:${team.id}`, asset: 'credits', delta: 4_000_000 },
        { account: 'SYSTEM', asset: 'credits', delta: -5_000_000 },
        { account: `primary:${team.id}`, asset: team.id, delta: 100 },
        { account: `pool:${team.id}`, asset: team.id, delta: 400 },
        { account: 'SYSTEM', asset: team.id, delta: -500 },
      ],
      payloadKey: 'genesis',
      rulesVersion: 1,
      phaseVersion: 0,
    };
    docs[`${root}/wallets/${team.id}/receipts/${genesis.id}`] = genesis;
    if (phase === 'trading') {
      const entries: Receipt['entries'] = [];
      for (let offset = 1; offset <= 3; offset++) {
        const issuerId = teams[(i + offset) % teams.length].id;
        const position: Position = {
          issuerId,
          shares: 5,
          costBasisMinor: 50_000,
          realizedPnlMinor: 0,
          version: 1,
        };
        docs[`${root}/wallets/${team.id}/positions/${issuerId}`] = position;
        entries.push(
          { account: `wallet:${team.id}`, asset: 'credits', delta: -50_000 },
          { account: `funding:${issuerId}`, asset: 'credits', delta: 50_000 },
          { account: `primary:${issuerId}`, asset: issuerId, delta: -5 },
          { account: `position:${team.id}:${issuerId}`, asset: issuerId, delta: 5 },
        );
      }
      const receipt: Receipt = {
        id: `seed-${team.id}`,
        kind: 'seed',
        teamId: team.id,
        actorUid: 'SYSTEM',
        acceptedAt: now - 3_600_000,
        detail: 'Seed allocation · 15 shares across 3 projects',
        entries,
        totalMinor: 150_000,
        cashAfterMinor: 850_000,
        payloadKey: 'seed',
        rulesVersion: 1,
        phaseVersion: 3,
      };
      docs[`${root}/wallets/${team.id}/receipts/${receipt.id}`] = receipt;
    }
  }
  docs[`${root}/members/demo-organizer`] = {
    uid: 'demo-organizer',
    displayName: 'Jamie Park',
    teamId: null,
    role: 'organizer',
    status: 'approved',
    version: 0,
  } satisfies Member;
  if (phase === 'trading') {
    const notes: Note[] = [
      {
        issuerId: 'team-3',
        thesis:
          'Marcus showed a migration that drops a used column. The review catches it before merge, and the schema diff is easy to follow. A clear problem with a demo we can verify.',
        reconsider:
          'The happy path is convincing. Before adding to our five seed shares, ask them to run the failing backfill and show what a reviewer sees.',
        nextCheck: 'Checkpoint 2: failing backfill and rollback example.',
        author: 'Alex Chen',
        updatedAt: now - 9 * 60_000,
        version: 0,
      },
      {
        issuerId: 'team-2',
        thesis:
          'A useful offline demo for field crews. Our five seed shares give us a small position while Maya proves the download stays readable after a restart.',
        reconsider:
          'Cached weather can look current when it is old. Unplug the laptop and check that the forecast age is impossible to miss.',
        nextCheck: 'Checkpoint 2: offline restart and forecast timestamp.',
        author: 'Sam Rivera',
        updatedAt: now - 14 * 60_000,
        version: 0,
      },
    ];
    for (const note of notes) docs[`${root}/wallets/team-1/notes/${note.issuerId}`] = note;
  }
  docs[`${root}/views/market`] = {
    entries: teams.map((team) => ({
      team,
      pool: docs[`${root}/pools/${team.id}`],
      issuer: docs[`${root}/issuers/${team.id}`],
    })),
    asOf: now,
    phaseVersion: event.phaseVersion,
  };
  return docs;
}
