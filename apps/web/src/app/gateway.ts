import type {
  AppSnapshot,
  Command,
  CommandResult,
  Pool,
  TeamConversation,
  PosterStatsPage,
} from '@robinhacks/core';
export interface SessionUser {
  uid: string;
  displayName: string;
  email: string;
  emailVerified?: boolean;
}
export interface AppGateway {
  readonly mode: 'demo' | 'firebase' | 'emulator';
  readonly user: SessionUser | null;
  subscribe(listener: () => void): () => void;
  signIn(
    provider: 'google' | 'email',
    email?: string,
    password?: string,
    register?: boolean,
  ): Promise<void>;
  resetPassword?(email: string): Promise<void>;
  verifyEmail?(): Promise<void>;
  refreshIdentity?(): Promise<void>;
  conversation?(otherTeamId: string): Promise<TeamConversation | null>;
  signOut(): Promise<void>;
  snapshot(force?: boolean): Promise<AppSnapshot>;
  command(command: Command): Promise<CommandResult>;
  pool(issuerId: string): Promise<Pool>;
  exportEvent(): Promise<Record<string, unknown>>;
  posterStats?(after?: number): Promise<PosterStatsPage>;
  switchDemoRole?(role: 'captain' | 'organizer' | 'judge' | 'member'): Promise<void>;
  resetDemo?(phase?: 'seed' | 'trading' | 'judging'): Promise<void>;
}
export const newCommandId = () => crypto.randomUUID();
