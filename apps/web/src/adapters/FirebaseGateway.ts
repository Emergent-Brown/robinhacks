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
  TeamConversation,
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
      this.memberStop?.();
      this.stopMarket();
      this.invalidate();
      this.user = user
        ? {
            uid: user.uid,
            displayName: user.displayName || user.email?.split('@')[0] || 'Participant',
            email: user.email || '',
            emailVerified: user.emailVerified,
          }
        : null;
      if (user)
        this.memberStop = onSnapshot(
          doc(this.db, `events/${this.eventId}/members/${user.uid}`),
          () => {
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
      this.emit();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.stopMarket();
      else if (this.user) {
        this.invalidate();
        this.emit();
      }
    });
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
          if (!snapshot.exists() || !this.cache) return;
          const next = snapshot.data() as EventConfig;
          const previous = this.cache.event;
          if (next.phaseVersion !== previous?.phaseVersion) {
            this.invalidate();
          } else this.cache = { ...this.cache, event: next };
          this.emit();
        },
        () => undefined,
      ),
      ...(!this.cache.member.teamId && this.cache.member.role !== 'organizer'
        ? []
        : [
            onSnapshot(
              doc(this.db, `events/${this.eventId}/views/market`),
              (snapshot) => {
                if (snapshot.exists() && this.cache) {
                  this.invalidate();
                  this.emit();
                }
              },
              () => undefined,
            ),
          ]),
    ];
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
            this.invalidate();
            this.emit();
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
      const e = error as { message?: string; code?: string; details?: { code?: string } };
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
      Object.assign(result, { code: e.details?.code || e.code });
      throw result;
    }
  }
  async snapshot(force = false): Promise<AppSnapshot> {
    if (this.cache && !force) return this.cache;
    if (this.pendingSnapshot) return this.pendingSnapshot;
    const generation = this.generation;
    const request = this.call<AppSnapshot>(this.user ? 'gameSnapshot' : 'gamePublic', {})
      .then((snapshot) => {
        if (generation === this.generation) {
          this.cache = snapshot;
          this.watchMarket();
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
    try {
      return await this.call<CommandResult>('gameCommand', { command });
    } finally {
      this.invalidate();
      this.emit();
    }
  }
  async exportEvent(): Promise<Record<string, unknown>> {
    return this.call('gameExport', {});
  }
  async posterStats(after = 0): Promise<PosterStatsPage> {
    return this.call('posterStats', { after });
  }
  async conversation(otherTeamId: string): Promise<TeamConversation | null> {
    return this.call('gameConversation', { otherTeamId });
  }
}
