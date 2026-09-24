import { defaultEventDetails } from './event-schedule';

/** Version-two event contracts. Credits are sealed allocations, never tradable money. */
export interface PlannedWindow {
  startsAt: number;
  closesAt: number;
}
export interface EventTiming {
  rounds: PlannedWindow[];
  submissions: PlannedWindow;
  ballot: PlannedWindow;
}
export type ScheduleWindow = 'round1' | 'round2' | 'round3' | 'submissions' | 'ballot';
export interface EventDetails {
  theme: string;
  about: string;
  dateLabel: string;
  timeZone: string;
  eligibility: string;
  registrationUrl: string;
  contactEmail: string;
  /** Public attendee information; optional for older events. */
  logistics?: {
    gettingThere: string;
    meals: string;
    overnight: string;
    bring: string;
  };
  organization?: { about: string; url: string };
  schedule: Array<{ time: string; title: string; description: string; window?: ScheduleWindow }>;
  /** Optional for events created before scheduled windows were introduced. */
  timing?: EventTiming;
}
export interface FundingSettings {
  budget: number;
  increment: number;
  maxPerProject: number;
  minimumDenominator: number;
  roundNames: string[];
  roundWeightsBps: number[];
  investorPoolMinor: number;
  builderPrizesMinor: number[];
  communityPrizeMinor: number;
  currency: 'USD';
  reservePolicy: string;
  reviewMinutes: number;
  rubric: Array<{ id: string; label: string; weight: number }>;
}
export interface PlatformConfig {
  teamFormationOpen?: boolean;
  version: 2;
  details: EventDetails;
  funding: FundingSettings;
  rulesLockedAt: number | null;
  currentRound: number;
  submissionsOpen: boolean;
  submissionClosesAt: number | null;
  ballotOpen: boolean;
  ballotClosesAt: number | null;
}
export interface FundingRound {
  id: string;
  number: number;
  name: string;
  state: 'open' | 'closed' | 'void';
  openedAt: number;
  closesAt: number;
  closedAt: number | null;
  weightBps: number;
  minimumDenominator: number;
  eligibleTeamIds: string[];
  totals: Record<string, number>;
  voidReason: string;
  version: number;
}
export interface RoundAllocation {
  id: string;
  roundId: string;
  teamId: string;
  amounts: Record<string, number>;
  version: number;
  updatedAt: number;
  actorUid: string;
}
export interface RoundEntitlement {
  id: string;
  roundId: string;
  roundNumber: number;
  teamId: string;
  awardedAt: number;
  spent: number;
  expired: number;
  voided: boolean;
  projects: Array<{
    projectId: string;
    credits: number;
    total: number;
    denominator: number;
    weightBps: number;
  }>;
}
export interface ProjectUpdate {
  id: string;
  teamId: string;
  round: number;
  works: string;
  changed: string;
  evidenceUrl: string;
  incomplete: string;
  createdAt: number;
  authorName: string;
}
export interface ProjectSubmission {
  id: string;
  teamId: string;
  submittedAt: number;
  submittedBy: string;
  name: string;
  pitch: string;
  problem: string;
  building: string;
  demoUrl: string;
  repoUrl: string;
  commitSha: string;
  techStack: string;
  roster: Array<{ uid: string; name: string }>;
}
export interface TeamMessage {
  id: string;
  fromTeamId: string;
  authorName: string;
  body: string;
  createdAt: number;
}
export interface ConversationSummary {
  id: string;
  otherTeamId: string;
  lastMessage: string;
  updatedAt: number;
  unread: boolean;
  blocked: boolean;
}
export interface TeamConversation {
  id: string;
  teamIds: string[];
  messages: TeamMessage[];
  blockedBy: string[];
  readAt: Record<string, number>;
  version: number;
}
export interface MessageReport {
  id: string;
  conversationId: string;
  messageId: string;
  reporterUid: string;
  reason: string;
  body: string;
  createdAt: number;
}
export interface JudgeAssignment {
  uid: string;
  projectIds: string[];
  conflictIds: string[];
  version: number;
}
export interface JudgingEntry {
  scores: Record<string, number>;
  note: string;
  conflict: boolean;
}
export interface JudgingSheet {
  uid: string;
  entries: Record<string, JudgingEntry>;
  version: number;
  updatedAt: number;
  submittedAt: number | null;
}
export interface CommunityBallot {
  teamId: string;
  rankedProjectIds: string[];
  version: number;
  updatedAt: number;
}
export interface AwardResults {
  id: string;
  createdAt: number;
  publishAfter: number;
  publishedAt: number | null;
  winnerId: string;
  tiebreakReason: string;
  projects: Array<{
    teamId: string;
    score: number;
    judgeCount: number;
    rank: number;
    builderPrizeMinor: number;
  }>;
  investors: Array<{ teamId: string; rewardMinor: number; entitlementPercent: number }>;
  community: Array<{ teamId: string; points: number; firstChoices: number; rank: number }>;
  communityWinnerId: string | null;
  investorPaidMinor: number;
  reserveMinor: number;
  settings: FundingSettings;
}
export interface PlatformSnapshot {
  rounds: FundingRound[];
  allocation: RoundAllocation | null;
  entitlements: RoundEntitlement[];
  updates: ProjectUpdate[];
  submissions: ProjectSubmission[];
  roster: Array<{ uid: string; name: string; teamId: string; role: string; bio?: string }>;
  conversations: ConversationSummary[];
  reports: MessageReport[];
  assignments: JudgeAssignment[];
  judgingSheets: JudgingSheet[];
  ballot: CommunityBallot | null;
  awards: AwardResults | null;
}
type WithId<T> = T & { commandId: string };
export type FundingCommand = WithId<
  | {
      type: 'configurePlatform';
      details: EventDetails;
      funding: FundingSettings;
      name: string;
      venue: string;
    }
  | {
      type: 'openFundingRound';
      expectedPhaseVersion: number;
      durationMinutes: number;
      closesAt?: number;
    }
  | {
      type: 'saveAllocation';
      roundId: string;
      amounts: Record<string, number>;
      expectedVersion: number;
    }
  | { type: 'closeFundingRound'; roundId: string; expectedPhaseVersion: number }
  | { type: 'voidFundingRound'; roundId: string; reason: string; expectedPhaseVersion: number }
>;
export type CommunityCommand = WithId<
  | {
      type: 'publishUpdate';
      round: number;
      works: string;
      changed: string;
      evidenceUrl: string;
      incomplete: string;
    }
  | {
      type: 'setSubmissionWindow';
      open: boolean;
      closesAt: number | null;
      expectedPhaseVersion: number;
    }
  | { type: 'submitProject'; expectedTeamVersion: number; commitSha: string; techStack: string }
  | { type: 'sendMessage'; toTeamId: string; body: string }
  | { type: 'readConversation'; otherTeamId: string }
  | { type: 'blockConversation'; otherTeamId: string; blocked: boolean }
  | { type: 'reportMessage'; otherTeamId: string; messageId: string; reason: string }
  | {
      type: 'assignJudge';
      uid: string;
      projectIds: string[];
      conflictIds: string[];
      expectedVersion: number;
    }
  | {
      type: 'saveJudgingSheet';
      entries: Record<string, JudgingEntry>;
      expectedVersion: number;
      submit: boolean;
    }
  | {
      type: 'setBallotWindow';
      open: boolean;
      closesAt: number | null;
      expectedPhaseVersion: number;
    }
  | { type: 'saveBallot'; rankedProjectIds: string[]; expectedVersion: number }
  | { type: 'beginJudging'; expectedPhaseVersion: number }
  | {
      type: 'prepareAwards';
      winnerId: string;
      tiebreakReason: string;
      expectedPhaseVersion: number;
    }
  | { type: 'discardAwards'; reason: string; expectedPhaseVersion: number }
  | { type: 'publishAwards'; expectedPhaseVersion: number }
>;
export type PlatformCommand = FundingCommand | CommunityCommand;
export const defaultPlatformConfig = (): PlatformConfig => ({
  version: 2,
  teamFormationOpen: false,
  details: defaultEventDetails(),
  funding: {
    budget: 100,
    increment: 10,
    maxPerProject: 60,
    minimumDenominator: 200,
    roundNames: ['Initial pitch', 'Working prototype', 'Final demo'],
    roundWeightsBps: [4000, 3500, 2500],
    investorPoolMinor: 0,
    builderPrizesMinor: [0, 0, 0],
    communityPrizeMinor: 0,
    currency: 'USD',
    reservePolicy: 'Unallocated investor rewards remain with the organizers for a future event.',
    reviewMinutes: 30,
    rubric: [
      { id: 'functionality', label: 'Functionality', weight: 35 },
      { id: 'usefulness', label: 'Usefulness', weight: 30 },
      { id: 'originality', label: 'Originality', weight: 20 },
      { id: 'execution', label: 'Technical execution', weight: 15 },
    ],
  },
  rulesLockedAt: null,
  currentRound: 0,
  submissionsOpen: false,
  submissionClosesAt: null,
  ballotOpen: false,
  ballotClosesAt: null,
});
export const emptyPlatformSnapshot = (): PlatformSnapshot => ({
  rounds: [],
  allocation: null,
  entitlements: [],
  updates: [],
  submissions: [],
  roster: [],
  conversations: [],
  reports: [],
  assignments: [],
  judgingSheets: [],
  ballot: null,
  awards: null,
});
