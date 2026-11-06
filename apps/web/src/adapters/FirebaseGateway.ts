import { ReadQueue } from '../app/read-queue';
import {
  classifyEventChange,
  followsRoster,
  missedPhaseChange,
  REFRESH,
  ReloadScheduler,
  withRetry,
} from '../app/refresh-policy';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  reload,
  signOut,
  onAuthStateChanged,
  connectAuthEmulator,
  type Auth,
} from 'firebase/auth';
import {
  getFunctions,
  httpsCallable,
  connectFunctionsEmulator,
  type Functions,
} from 'firebase/functions';
import {
  getFirestore,
  doc,
  onSnapshot,
  connectFirestoreEmulator,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import type {
  AppSnapshot,
  Command,
  CommandResult,
  EventConfig,
  MessageRequest,
  MessagePage,
  ConversationDirectoryEntry,
  PosterStatsPage,
} from '@robinhacks/core';
import type { AppGateway, SessionUser } from '../app/gateway';
/** Firebase transport and public read cache. Contains no economic authority. */
export class FirebaseGateway implements AppGateway {
  readonly mode: 'firebase' | 'emulator';
  user: SessionUser | null = null;
  private auth: Auth;
  private functions: Functions;
  private db: Firestore;
  private eventId = import.meta.env.VITE_EVENT_ID || 'robinhacks-2026';
  private listeners = new Set<() => void>();
  private memberStop: Unsubscribe | undefined;
  private marketStops: Unsubscribe[] = [];
  private cache: AppSnapshot | null = null;
  private pendingSnapshot: Promise<AppSnapshot> | null = null;
  private generation = 0;
  private messageReads = new ReadQueue();
  /** The newest event a listener delivered, kept even while a reload is in flight. */
  private latestEvent: EventConfig | null = null;
  private loadedAt = 0;
  private staleWhileHidden = false;
  private reloads = new ReloadScheduler(() => this.reloadNow());
  constructor(mode: 'firebase' | 'emulator') {
    this.mode = mode;
    const emulator = mode === 'emulator';
    const projectId = emulator ? 'demo-robinhacks' : import.meta.env.VITE_FIREBASE_PROJECT_ID;
    if (!projectId || (!emulator && !import.meta.env.VITE_FIREBASE_API_KEY))
      throw new Error(
        'Firebase is not configured. Copy apps/web/.env.example to apps/web/.env.local and add your Firebase web configuration.',
      );
    const app = initializeApp({
      apiKey: emulator ? 'demo-api-key' : import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: emulator
        ? 'demo-robinhacks.firebaseapp.com'
        : import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId,
      appId: emulator ? 'demo-app' : import.meta.env.VITE_FIREBASE_APP_ID,
    });
    this.auth = getAuth(app);
    this.db = getFirestore(app);
    this.functions = getFunctions(app, import.meta.env.VITE_FIREBASE_REGION || 'us-west1');
    if (emulator) {
      connectAuthEmulator(this.auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      connectFirestoreEmulator(this.db, '127.0.0.1', 8080);
      connectFunctionsEmulator(this.functions, '127.0.0.1', 5001);
    } else if (import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY)
      initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(
          import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY,
        ),
        isTokenAutoRefreshEnabled: true,
      });
    onAuthStateChanged(this.auth, (user) => {
      this.reloads.cancel();
      this.latestEvent = null;
      this.loadedAt = 0;
      this.staleWhileHidden = false;
      this.memberStop?.();
      this.stopMarket();
      this.invalidate();
      this.user = user
        ? {
            uid: user.uid,
            displayName: user.displayName || user.email?.split('@')[0] || 'Participant',
            email: user.email || '',
            emailVerified: user.emailVerified,
            ...(user.photoURL ? { photoURL: user.photoURL } : {}),
          }
        : null;
      if (user) {
        let initial = true;
        this.memberStop = onSnapshot(
          doc(this.db, `events/${this.eventId}/members/${user.uid}`),
          () => {
            // Sign-in already loads a snapshot; only later changes need another.
            if (initial) {
              initial = false;
              return;
            }
            this.stopMarket();
            this.invalidate();
            this.emit();
          },
          () => {
            this.stopMarket();
            this.invalidate();
            this.emit();
          },
        );
      }
      this.emit();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.stopMarket();
        // A waiting reload can't run hidden, so remember to do it on return.
        if (this.reloads.cancel()) this.staleWhileHidden = true;
      } else if (this.user) {
        const fresh =
          !this.staleWhileHidden && !!this.cache && Date.now() - this.loadedAt < REFRESH.freshForMs;
        this.staleWhileHidden = false;
        if (fresh) this.watchMarket();
        else this.reloadNow();
      }
    });
  }
  private reloadNow() {
    this.invalidate();
    this.emit();
  }
  /** Applies a root document change. A phase change waits for a spread-out reload. */
  private applyEvent(next: EventConfig) {
    if (!this.cache) return;
    const change = classifyEventChange(this.cache.event, next);
    if (
      change === 'phase' ||
      (change === 'judging' && ['judge', 'organizer'].includes(this.cache.member?.role ?? ''))
    )
      return this.reloads.soon();
    this.cache = { ...this.cache, event: next };
    if (change === 'none') return this.emit();
    if (followsRoster(this.cache)) this.reloads.atMostEvery(REFRESH.rosterGapMs);
  }
  private invalidate() {
    this.cache = null;
    this.generation++;
    this.pendingSnapshot = null;
  }
  private stopMarket() {
    this.marketStops.forEach((stop) => stop());
    this.marketStops = [];
  }
  private watchMarket() {
    if (
      this.marketStops.length ||
      this.cache?.member?.status !== 'approved' ||
      document.visibilityState === 'hidden'
    )
      return;
    this.marketStops = [
      onSnapshot(
        doc(this.db, `events/${this.eventId}`),
        (snapshot) => {
          if (!snapshot.exists()) return;
          const next = snapshot.data() as EventConfig;
          this.latestEvent = next;
          this.applyEvent(next);
        },
        () => undefined,
      ),
    ];
    if (this.cache.member.teamId || this.cache.member.role === 'organizer') {
      let initial = true;
      this.marketStops.push(
        onSnapshot(
          doc(this.db, `events/${this.eventId}/views/market`),
          () => {
            // The first delivery only repeats what the snapshot just returned.
            if (initial) {
              initial = false;
              return;
            }
            this.reloads.atMostEvery(REFRESH.teamsGapMs, REFRESH.teamsSpreadMs);
          },
          () => undefined,
        ),
      );
    }
    this.marketStops.push(
      onSnapshot(
        doc(this.db, `events/${this.eventId}/messageChannels/general`),
        (snapshot) => {
          if (!snapshot.exists() || !this.cache?.platform) return;
          const next = snapshot.data() as {
            latestSequence: number;
            lastMessage: string;
            updatedAt: number;
            lastAuthorUid?: string;
            moderationVersion?: number;
          };
          const previous = this.cache.platform.general;
          if (
            next.latestSequence === previous.latestSequence &&
            next.updatedAt === previous.updatedAt &&
            (next.moderationVersion ?? 0) === previous.moderationVersion
          )
            return;
          this.cache = {
            ...this.cache,
            platform: {
              ...this.cache.platform,
              general: {
                moderationVersion: next.moderationVersion ?? 0,
                latestSequence: next.latestSequence,
                lastMessage: next.lastMessage,
                updatedAt: next.updatedAt,
                unread:
                  next.latestSequence > previous.latestSequence
                    ? next.lastAuthorUid !== this.user?.uid
                    : previous.unread,
              },
            },
          };
          this.emit();
        },
        () => undefined,
      ),
    );
    if (this.cache?.member?.teamId) {
      const teamId = this.cache.member.teamId;
      let initial = true;
      this.marketStops.push(
        onSnapshot(
          doc(this.db, `events/${this.eventId}/teamInboxes/${teamId}`),
          () => {
            if (initial) {
              initial = false;
              return;
            }
            this.reloads.soon();
          },
          () => undefined,
        ),
      );
    }
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
    try {
      await signInWithPopup(this.auth, new GoogleAuthProvider());
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
      const message =
        code === 'auth/popup-blocked'
          ? 'Allow pop-ups for this site, then try signing in again.'
          : code === 'auth/network-request-failed'
            ? 'Couldn’t reach Google. Check your connection, or open emergenthacks.com in your usual browser and try again.'
            : 'Couldn’t sign in with Google. Please try again.';
      throw Object.assign(new Error(message), { code });
    }
  }
  async signOut() {
    await signOut(this.auth);
  }
  async refreshIdentity() {
    const user = this.auth.currentUser;
    if (!user) return;
    await reload(user);
    await user.getIdToken(true);
    this.user = {
      uid: user.uid,
      displayName: user.displayName || user.email?.split('@')[0] || 'Participant',
      email: user.email || '',
      emailVerified: user.emailVerified,
    };
    this.invalidate();
    this.emit();
  }
  private async call<T>(name: string, data: Record<string, unknown>): Promise<T> {
    const owner = this.auth.currentUser?.uid;
    try {
      const result = await httpsCallable<Record<string, unknown>, T>(
        this.functions,
        name,
      )({ eventId: this.eventId, ...data });
      return result.data;
    } catch (error) {
      const e = error as {
        message?: string;
        code?: string;
        details?: { code?: string; retryAfterMs?: number };
      };
      const expired =
        ['SIGN_IN_REQUIRED', 'GOOGLE_SIGN_IN_REQUIRED'].includes(e.details?.code ?? '') ||
        [
          'functions/unauthenticated',
          'auth/user-token-expired',
          'auth/user-disabled',
          'auth/user-not-found',
          'auth/invalid-user-token',
        ].includes(e.code ?? '');
      // The auth observer clears private caches and reloads the public homepage.
      // Ignore a late failure from an old identity if another account signed in meanwhile.
      if (expired && owner && this.auth.currentUser?.uid === owner) await signOut(this.auth);
      const result = new Error(
        e.message || 'Unable to reach the event server. Your request has not been confirmed.',
      );
      Object.assign(result, {
        code: e.details?.code || e.code,
        retryAfterMs: e.details?.retryAfterMs,
      });
      throw result;
    }
  }
  async snapshot(force = false): Promise<AppSnapshot> {
    if (this.cache && !force) return this.cache;
    if (this.pendingSnapshot) return this.pendingSnapshot;
    const generation = this.generation;
    const owner = this.auth.currentUser?.uid;
    this.reloads.loading();
    const request = withRetry('read', () => {
      this.requireIdentity(owner);
      return this.call<AppSnapshot>(owner ? 'gameSnapshot' : 'gamePublic', {});
    })
      .then((snapshot) => {
        if (generation === this.generation) {
          this.cache = snapshot;
          this.loadedAt = Date.now();
          this.watchMarket();
          // Listeners stay quiet during a load, so catch a phase that changed meanwhile.
          if (
            missedPhaseChange(snapshot.event, this.latestEvent) ||
            (this.latestEvent &&
              snapshot.event &&
              (this.latestEvent.judgingRevision ?? 0) > (snapshot.event.judgingRevision ?? 0) &&
              ['judge', 'organizer'].includes(snapshot.member?.role ?? ''))
          )
            this.reloads.soon();
        }
        return snapshot;
      })
      .finally(() => {
        if (generation === this.generation) this.pendingSnapshot = null;
      });
    this.pendingSnapshot = request;
    return request;
  }
  async command(command: Command): Promise<CommandResult> {
    const owner = this.auth.currentUser?.uid;
    const generation = this.generation;
    const current = () => owner === this.auth.currentUser?.uid && generation === this.generation;
    try {
      const result = await withRetry('command', () => {
        this.requireIdentity(owner);
        return this.call<CommandResult>('gameCommand', { command });
      });
      if (current() && command.type === 'saveAllocation') this.rememberAllocation(command);
      if (current() && command.type === 'readGeneral' && this.cache?.platform) {
        const general = this.cache.platform.general;
        this.cache = {
          ...this.cache,
          platform: {
            ...this.cache.platform,
            general: {
              ...general,
              unread: general.latestSequence > command.throughSequence,
            },
          },
        };
      }
      return result;
    } catch (error) {
      // A failed allocation may mean another tab advanced its version. Fetch authority again.
      if (current() && command.type === 'saveAllocation') this.invalidate();
      throw error;
    } finally {
      if (owner === this.auth.currentUser?.uid) {
        if (!['sendGeneralMessage', 'readGeneral', 'saveAllocation'].includes(command.type))
          this.invalidate();
        this.emit();
      }
    }
  }
  /** Never replay a request using a different account after waiting through a retry. */
  private requireIdentity(owner: string | undefined) {
    if (owner !== this.auth.currentUser?.uid)
      throw Object.assign(new Error('Account changed. Please try again.'), {
        code: 'ACCOUNT_CHANGED',
      });
  }
  /** Autosaves update the local copy, because a full reload per keystroke burst adds up. */
  private rememberAllocation(command: Extract<Command, { type: 'saveAllocation' }>) {
    const teamId = this.cache?.member?.teamId;
    if (!this.cache?.platform || !teamId) return;
    this.cache = {
      ...this.cache,
      platform: {
        ...this.cache.platform,
        allocation: {
          id: `${command.roundId}__${teamId}`,
          roundId: command.roundId,
          teamId,
          amounts: command.amounts,
          version: command.expectedVersion + 1,
          updatedAt: Date.now(),
          actorUid: this.user?.uid ?? '',
        },
      },
    };
  }
  async exportEvent(): Promise<Record<string, unknown>> {
    return this.call('gameExport', {});
  }
  async posterStats(after = 0): Promise<PosterStatsPage> {
    return this.call('posterStats', { after });
  }
  async messages(request: MessageRequest): Promise<MessagePage> {
    const uid = this.auth.currentUser?.uid;
    return this.messageReads.run(`${uid}:${JSON.stringify(request)}`, () => {
      if (this.auth.currentUser?.uid !== uid)
        throw new Error('Account changed. Reopen the conversation.');
      return this.call('gameMessages', { request });
    });
  }
  async conversationDirectory(): Promise<ConversationDirectoryEntry[]> {
    return this.call('gameConversationDirectory', {});
  }
}
