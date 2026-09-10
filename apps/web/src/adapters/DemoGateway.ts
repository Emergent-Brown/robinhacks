import { GameService } from '@robinhacks/application';
import { SystemClock } from '../../../../packages/application/src/repository';
import {
  MemoryRepository,
  type DocumentMap,
} from '../../../../packages/application/src/memory-repository';
import {
  createDemoDocuments,
  DEMO_EVENT_ID,
  DEMO_USERS,
} from '../../../../packages/application/src/fixtures';
import type { AppSnapshot, Command } from '@robinhacks/core';
import type { AppGateway, SessionUser } from '../app/gateway';
import { MarketRefreshScheduler } from '../app/MarketRefreshScheduler';
const STORE = 'robinhacks-demo-v1';
export class DemoGateway implements AppGateway {
  readonly mode = 'demo' as const;
  user: SessionUser | null = DEMO_USERS.captain;
  private listeners = new Set<() => void>();
  private latestSnapshot: AppSnapshot | null = null;
  private repository = new MemoryRepository(createDemoDocuments(), {
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
    this.user = DEMO_USERS.captain;
    this.emit();
  }
  async signOut() {
    this.user = null;
    this.emit();
  }
  async snapshot(): Promise<AppSnapshot> {
    if (!this.user)
      return {
        event: null,
        member: null,
        market: { entries: [], asOf: 0, phaseVersion: 0 },
        wallet: null,
        positions: [],
        commitments: null,
        notes: [],
        receipts: [],
        members: [],
        requests: [],
        operation: null,
        results: null,
        audit: [],
      };
    this.latestSnapshot = await this.service.snapshot(this.user.uid);
    return this.latestSnapshot;
  }
  async command(command: Command) {
    if (!this.user) throw new Error('Sign in to continue.');
    const result = await this.service.execute(
      { uid: this.user.uid, displayName: this.user.displayName },
      command,
    );
    this.emit();
    return result;
  }
  async pool(issuerId: string) {
    return this.service.pool(this.user?.uid ?? '', issuerId);
  }
  async exportEvent() {
    return this.service.exportEvent(this.user?.uid ?? '');
  }
  async switchDemoRole(role: keyof typeof DEMO_USERS) {
    this.user = DEMO_USERS[role];
    this.emit();
  }
  async resetDemo(phase: 'seed' | 'trading' = 'trading') {
    this.repository.replace(createDemoDocuments(phase));
    this.user = DEMO_USERS.captain;
    this.emit();
  }
}
