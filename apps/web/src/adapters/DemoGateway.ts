import { GameService } from '@robinhacks/application';
import { SystemClock } from '../../../../packages/application/src/repository';
import {
  MemoryRepository,
  type DocumentMap,
} from '../../../../packages/application/src/memory-repository';
import {
  createPlatformDemoDocuments,
  DEMO_EVENT_ID,
  PLATFORM_USERS,
} from '../../../../packages/application/src/platform-fixtures';
import type { AppSnapshot, Command } from '@robinhacks/core';
import type { AppGateway, SessionUser } from '../app/gateway';
import { MarketRefreshScheduler } from '../app/MarketRefreshScheduler';
const STORE = 'emergent-hacks-demo-v2';
export class DemoGateway implements AppGateway {
  readonly mode = 'demo' as const;
  user: SessionUser | null = PLATFORM_USERS.captain;
  private listeners = new Set<() => void>();
  private latestSnapshot: AppSnapshot | null = null;
  private repository = new MemoryRepository(createPlatformDemoDocuments(), {
    load: () => {
      try {
        return JSON.parse(localStorage.getItem(STORE) ?? 'null') as DocumentMap | null;
      } catch {
        return null;
      }
    },
    save: (data) => localStorage.setItem(STORE, JSON.stringify(data)),
  });
  private service = new GameService(this.repository, DEMO_EVENT_ID, new SystemClock());
  constructor() {
    window.addEventListener('storage', (e) => {
      if (e.key === STORE) this.emit();
    });
    new MarketRefreshScheduler(
      () => (this.user ? this.latestSnapshot : null),
      () => this.command({ type: 'refreshMarket', commandId: crypto.randomUUID() }),
    );
  }
  private emit() {
    this.listeners.forEach((listener) => listener());
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  async signIn() {
    this.user = PLATFORM_USERS.captain;
    this.emit();
  }
  async signOut() {
    this.user = null;
    this.emit();
  }
  async snapshot(): Promise<AppSnapshot> {
    if (!this.user) return this.service.publicSnapshot();
    this.latestSnapshot = await this.service.snapshot(this.user.uid, this.user);
    return this.latestSnapshot;
  }
  async command(command: Command) {
    if (!this.user) throw new Error('Sign in to continue.');
    const result = await this.service.execute({ ...this.user, emailVerified: true }, command);
    this.emit();
    return result;
  }
  async verifyEmail() {
    /* Every fictional demo identity is already verified. */
  }
  async refreshIdentity() {
    this.emit();
  }
  async conversation(otherTeamId: string) {
    return this.service.conversation(this.user?.uid ?? '', otherTeamId);
  }
  async pool(issuerId: string) {
    return this.service.pool(this.user?.uid ?? '', issuerId);
  }
  async exportEvent() {
    return this.service.exportEvent(this.user?.uid ?? '');
  }
  async switchDemoRole(role: keyof typeof PLATFORM_USERS) {
    this.user = PLATFORM_USERS[role];
    this.emit();
  }
  async resetDemo(phase: 'seed' | 'trading' | 'judging' = 'trading') {
    this.repository.replace(createPlatformDemoDocuments(phase));
    this.user = PLATFORM_USERS.captain;
    this.emit();
  }
}
