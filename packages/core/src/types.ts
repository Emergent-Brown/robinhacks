import type { PlatformCommand, PlatformConfig, PlatformSnapshot } from './platform';
export type Phase =
  | 'DRAFT'
  | 'REGISTRATION'
  | 'SEED_OPEN'
  | 'SEED_SETTLING'
  | 'INTERMISSION'
  | 'TRADING_OPEN'
  | 'FROZEN'
  | 'FINALIZING'
  | 'FINALIZED'
  | 'CANCELLED'
  | 'ARCHIVED';
export type Role = 'organizer' | 'judge' | 'captain' | 'trader' | 'member';
export interface EventConfig {
  platform?: PlatformConfig;
  pausedAt?: number | null;
  id: string;
  name: string;
  venue: string;
  phase: Phase;
  phaseVersion: number;
  paused: boolean;
  pauseReason: string;
  windowId: number;
  closesAt: number | null;
  createdAt: number;
  rulesVersion: number;
  activeOperationId: string | null;
  publishedResultId: string | null;
  announcement: string;
  tieSeed: string;
}
export interface Member {
  email?: string;
  emailVerified?: boolean;
  uid: string;
  displayName: string;
  teamId: string | null;
  role: Role;
  status: 'approved' | 'pending' | 'suspended';
  version: number;
}
export interface Team {
  id: string;
  name: string;
  ticker: string;
  pitch: string;
  category: string;
  color: string;
  problem: string;
  building: string;
  demoUrl: string;
  repoUrl: string;
  update: string;
  updatedAt: number;
  eligibility: 'active' | 'withdrawn' | 'disqualified';
  captainUid: string;
  version: number;
}
export interface Wallet {
  teamId: string;
  cashMinor: number;
  reservedSeedMinor: number;
  version: number;
  lastTradeAt: number;
  tradeWindowId: number;
  successfulTradesInWindow: number;
}
export interface Position {
  issuerId: string;
  shares: number;
  costBasisMinor: number;
  realizedPnlMinor: number;
  version: number;
}
export interface Pool {
  issuerId: string;
  shareReserve: number;
  creditReserveMinor: number;
  version: number;
  halted: boolean;
}
export interface Issuer {
  issuerId: string;
  issuedShares: number;
  primarySharesRemaining: number;
  fundingVaultMinor: number;
  seedBackers: number;
  version: number;
}
export interface Commitment {
  shares: Record<string, number>;
  version: number;
  updatedAt: number;
}
export interface Note {
  issuerId: string;
  thesis: string;
  reconsider: string;
  nextCheck: string;
  author: string;
  updatedAt: number;
  version: number;
}
export interface JournalEntry {
  account: string;
  asset: string;
  delta: number;
}
export interface Receipt {
  id: string;
  kind: string;
  teamId: string;
  actorUid: string;
  acceptedAt: number;
  issuerId?: string;
  side?: 'BUY' | 'SELL';
  shares?: number;
  totalMinor?: number;
  cashAfterMinor?: number;
  detail: string;
  entries: JournalEntry[];
  payloadKey: string;
  rulesVersion: number;
  phaseVersion: number;
}
export interface MarketEntry {
  team: Team;
  pool: Pool;
  issuer: Issuer;
}
export interface MarketView {
  entries: MarketEntry[];
  asOf: number;
  phaseVersion: number;
}
export interface ResultHolding {
  issuerId: string;
  shares: number;
  priceMinor: number;
  valueMinor: number;
}
export interface TeamResult {
  teamId: string;
  rank: number;
  cashMinor: number;
  valueMinor: number;
  profitMinor: number;
  holdings: ResultHolding[];
  eligible: boolean;
}
export interface IssuerResult {
  issuerId: string;
  score: number;
  rank: number;
  priceMinor: number;
  eligible: boolean;
}
export interface ResultsView {
  id: string;
  createdAt: number;
  teams: TeamResult[];
  issuers: IssuerResult[];
}
export interface Operation {
  id: string;
  kind: 'seed' | 'results';
  completed: number;
  total: number;
  state: 'running' | 'ready' | 'complete';
}
export interface AccessRequest {
  requestedRole?: 'judge' | 'organizer';
  email?: string;
  emailVerified?: boolean;
  uid: string;
  displayName: string;
  teamName: string;
  teamId: string | null;
  requestedAt: number;
  status: 'pending' | 'approved' | 'rejected';
}
export interface AuditEntry {
  id: string;
  actorUid: string;
  action: string;
  detail: string;
  createdAt: number;
}
export interface AppSnapshot {
  platform?: PlatformSnapshot;
  event: EventConfig | null;
  member: Member | null;
  /** Names and IDs for access requests; never includes market or roster data. */
  joinableTeams?: Array<{ id: string; name: string }>;
  market: MarketView;
  wallet: Wallet | null;
  positions: Position[];
  commitments: Commitment | null;
  notes: Note[];
  receipts: Receipt[];
  members: Member[];
  requests: AccessRequest[];
  operation: Operation | null;
  results: ResultsView | null;
  audit: AuditEntry[];
}
export type TradeCommand = {
  type: 'executeTrade';
  commandId: string;
  issuerId: string;
  side: 'BUY' | 'SELL';
  shares: number;
  expectedPoolVersion: number;
  expectedWalletVersion: number;
  expectedPhaseVersion: number;
  maxDebitMinor?: number;
  minCreditMinor?: number;
};
export type Command =
  | PlatformCommand
  | TradeCommand
  | {
      type: 'requestMembership';
      commandId: string;
      staffRole?: 'judge' | 'organizer';
      displayName: string;
      teamName?: string;
      teamId?: string;
    }
  | {
      type: 'approveMembership';
      commandId: string;
      uid: string;
      role: 'captain' | 'member' | 'trader';
      teamId?: string;
      teamName?: string;
    }
  | { type: 'setMemberRole'; commandId: string; uid: string; role: Role; status: Member['status'] }
  | {
      type: 'updateTeam';
      commandId: string;
      expectedVersion: number;
      patch: Partial<
        Pick<
          Team,
          'name' | 'pitch' | 'category' | 'problem' | 'building' | 'demoUrl' | 'repoUrl' | 'update'
        >
      >;
    }
  | {
      type: 'setSeedCommitments';
      commandId: string;
      shares: Record<string, number>;
      expectedWalletVersion: number;
      expectedCommitmentVersion: number;
    }
  | {
      type: 'saveNote';
      commandId: string;
      issuerId: string;
      thesis: string;
      reconsider: string;
      nextCheck: string;
      expectedVersion: number;
    }
  | {
      type: 'transitionEvent';
      commandId: string;
      target: Phase;
      expectedPhaseVersion: number;
      durationMinutes?: number;
    }
  | {
      type: 'setPause';
      commandId: string;
      paused: boolean;
      reason: string;
      expectedPhaseVersion: number;
    }
  | { type: 'setAnnouncement'; commandId: string; announcement: string }
  | {
      type: 'haltIssuer';
      commandId: string;
      issuerId: string;
      eligibility: Team['eligibility'];
      reason: string;
    }
  | { type: 'continueOperation'; commandId: string }
  | { type: 'prepareResults'; commandId: string; scores: Record<string, number> }
  | { type: 'publishResults'; commandId: string; expectedPhaseVersion: number }
  | { type: 'refreshMarket'; commandId: string };
export interface CommandResult {
  receipt?: Receipt;
  message?: string;
  operation?: Operation;
}
export interface Quote {
  side: 'BUY' | 'SELL';
  shares: number;
  totalMinor: number;
  averagePriceMinor: number;
  impactPercent: number;
  nextPool: Pool;
}
