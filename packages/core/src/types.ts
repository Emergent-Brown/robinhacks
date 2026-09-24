import type { PlatformCommand, PlatformConfig, PlatformSnapshot } from './platform';
export type Phase =
  | 'DRAFT'
  | 'REGISTRATION'
  | 'SEED_OPEN'
  | 'INTERMISSION'
  | 'FROZEN'
  | 'FINALIZING'
  | 'FINALIZED'
  | 'CANCELLED'
  | 'ARCHIVED';
export type Role = 'organizer' | 'judge' | 'captain' | 'trader' | 'member';
export interface EventConfig {
  maintenance?: boolean;
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
  /** Optional, self-authored plain text shared with the approved team roster. */
  bio?: string;
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
export interface Receipt {
  id: string;
  kind: string;
  teamId: string;
  actorUid: string;
  acceptedAt: number;
  detail: string;
  payloadKey: string;
  rulesVersion: number;
  phaseVersion: number;
}
export interface MarketEntry {
  team: Team;
}
export interface MarketView {
  entries: MarketEntry[];
  asOf: number;
  phaseVersion: number;
}
export interface AccessRequest {
  requestedRole?: 'judge';
  email?: string;
  emailVerified?: boolean;
  uid: string;
  displayName: string;
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
export type FormationRole = 'captain' | 'trader' | 'member';
export interface FormationTeam {
  id: string;
  name: string;
  members: Array<{ name: string; role: FormationRole }>;
  availableRoles: FormationRole[];
}
export interface OrganizerInvite {
  email: string;
  createdAt: number;
}
export interface AppSnapshot {
  formationTeams?: FormationTeam[];
  organizerInvites?: OrganizerInvite[];
  platform?: PlatformSnapshot;
  event: EventConfig | null;
  member: Member | null;
  market: MarketView;
  members: Member[];
  requests: AccessRequest[];
  audit: AuditEntry[];
}
export type Command =
  | PlatformCommand
  | {
      type: 'requestMembership';
      commandId: string;
      staffRole?: 'judge';
      displayName: string;
    }
  | {
      type: 'approveMembership';
      commandId: string;
      uid: string;
    }
  | { type: 'setMemberRole'; commandId: string; uid: string; role: Role; status: Member['status'] }
  | { type: 'updateProfile'; commandId: string; bio: string }
  | { type: 'setTeamFormation'; commandId: string; open: boolean; expectedPhaseVersion: number }
  | { type: 'createFormationTeam'; commandId: string; name: string; role: FormationRole }
  | { type: 'joinFormationTeam'; commandId: string; teamId: string; role: FormationRole }
  | { type: 'removeMember'; commandId: string; uid: string }
  | { type: 'addOrganizerEmail'; commandId: string; email: string }
  | { type: 'removeOrganizerEmail'; commandId: string; email: string }
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
      type: 'transitionEvent';
      commandId: string;
      target: 'CANCELLED';
      expectedPhaseVersion: number;
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
    };
export interface CommandResult {
  receipt?: Receipt;
  message?: string;
}
