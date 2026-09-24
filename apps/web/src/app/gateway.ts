import type {
  AppSnapshot,
  Command,
  CommandResult,
  MessageRequest,
  MessagePage,
  ConversationDirectoryEntry,
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
  signIn(): Promise<void>;
  refreshIdentity?(): Promise<void>;
  messages(request: MessageRequest): Promise<MessagePage>;
  conversationDirectory(): Promise<ConversationDirectoryEntry[]>;
  signOut(): Promise<void>;
  snapshot(force?: boolean): Promise<AppSnapshot>;
  command(command: Command): Promise<CommandResult>;
  exportEvent(): Promise<Record<string, unknown>>;
  posterStats?(after?: number): Promise<PosterStatsPage>;
  switchDemoRole?(role: 'captain' | 'organizer' | 'judge' | 'member' | 'attendee'): Promise<void>;
  resetDemo?(phase?: 'registration' | 'funding' | 'judging'): Promise<void>;
}
export const newCommandId = () => crypto.randomUUID();
