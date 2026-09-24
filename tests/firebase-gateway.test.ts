import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  }) as FirebaseGateway;
  return { auth, transport };
}

beforeEach(() => vi.resetAllMocks());

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
