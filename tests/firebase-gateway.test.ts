import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FirebaseGateway } from '../apps/web/src/adapters/FirebaseGateway';

const { invoke, endSession } = vi.hoisted(() => ({
  invoke: vi.fn(),
  endSession: vi.fn(),
}));
vi.mock('firebase/functions', async (original) => ({
  ...(await original<typeof import('firebase/functions')>()),
  httpsCallable: () => invoke,
}));
vi.mock('firebase/auth', async (original) => ({
  ...(await original<typeof import('firebase/auth')>()),
  signOut: endSession,
}));

const expired = {
  code: 'functions/unauthenticated',
  details: { code: 'SIGN_IN_REQUIRED' },
  message: 'Sign in with Google again.',
};
function gateway(uid: string | null = 'old-account') {
  const auth = { currentUser: uid ? { uid } : null };
  // Exercise transport without starting browser-only SDK observers or network services.
  const transport = Object.assign(Object.create(FirebaseGateway.prototype), {
    auth,
    functions: {},
    eventId: 'test-event',
    generation: 0,
    cache: null,
    listeners: new Set(),
  }) as FirebaseGateway;
  return { auth, transport };
}

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.useRealTimers());

describe('account changes during autosave', () => {
  const command = {
    type: 'saveAllocation' as const,
    commandId: 'allocation-test',
    roundId: 'round-1',
    amounts: {},
    expectedVersion: 0,
  };
  it('never retries a previous account’s command under the new account', async () => {
    vi.useFakeTimers();
    const { auth, transport } = gateway();
    invoke.mockRejectedValue({ code: 'functions/unavailable' });
    const pending = transport.command(command);
    const assertion = expect(pending).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' });
    await vi.advanceTimersByTimeAsync(1);
    auth.currentUser = { uid: 'new-account' };
    await vi.runAllTimersAsync();
    await assertion;
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it('does not apply a late autosave response to a new account’s cache', async () => {
    const { auth, transport } = gateway();
    let resolve!: (value: unknown) => void;
    invoke.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const pending = transport.command(command);
    auth.currentUser = { uid: 'new-account' };
    const cache = { member: { teamId: 'new-team' }, platform: { allocation: null } };
    Object.assign(transport, { cache, generation: 1 });
    resolve({ data: { ok: true } });
    await pending;
    expect(await transport.snapshot()).toBe(cache);
    expect(cache.platform.allocation).toBeNull();
  });
});

describe('expired Google sessions', () => {
  it('signs out the expired identity once; subsequent failures cannot start a sign-out loop', async () => {
    const { auth, transport } = gateway();
    invoke.mockRejectedValue(expired);
    endSession.mockImplementation(async () => {
      auth.currentUser = null;
    });
    await expect(transport.posterStats()).rejects.toMatchObject({ code: 'SIGN_IN_REQUIRED' });
    expect(endSession).toHaveBeenCalledTimes(1);
    await expect(transport.posterStats()).rejects.toThrow('Sign in with Google again.');
    expect(endSession).toHaveBeenCalledTimes(1);
  });

  it('does not sign out a newly selected account when an older request fails later', async () => {
    const { auth, transport } = gateway();
    let reject!: (reason: unknown) => void;
    invoke.mockReturnValue(
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
    );
    const pending = transport.posterStats();
    auth.currentUser = { uid: 'new-account' };
    reject(expired);
    await expect(pending).rejects.toMatchObject({ code: 'SIGN_IN_REQUIRED' });
    expect(endSession).not.toHaveBeenCalled();
  });

  it('keeps a valid session for ordinary permission failures', async () => {
    const { transport } = gateway();
    invoke.mockRejectedValue({
      code: 'functions/permission-denied',
      details: { code: 'ORGANIZER_REQUIRED' },
    });
    await expect(transport.posterStats()).rejects.toMatchObject({ code: 'ORGANIZER_REQUIRED' });
    expect(endSession).not.toHaveBeenCalled();
  });
});
