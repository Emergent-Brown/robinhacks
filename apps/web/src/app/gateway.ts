import type { AppSnapshot, Command, CommandResult, Pool } from '@robinhacks/core';
export interface SessionUser {
  uid: string;
  displayName: string;
  email: string;
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
  signOut(): Promise<void>;
  snapshot(force?: boolean): Promise<AppSnapshot>;
  command(command: Command): Promise<CommandResult>;
  pool(issuerId: string): Promise<Pool>;
  exportEvent(): Promise<Record<string, unknown>>;
  switchDemoRole?(role: 'captain' | 'organizer' | 'member'): Promise<void>;
  resetDemo?(phase?: 'seed' | 'trading'): Promise<void>;
}
export const newCommandId = () => crypto.randomUUID();
