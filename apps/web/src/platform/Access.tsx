import { useEffect, useState } from 'react';
import { Field } from '../ui/primitives';
import { config, Panel, useCommand, ErrorMessage, type PageProps } from './shared';

export function Access({ data, actions }: PageProps) {
  const user = actions.gateway.user;
  const [name, setName] = useState(user?.displayName || '');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [pending, setPending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const cmd = useCommand(actions);
  const rosterLocked = !!config(data).rulesLockedAt;
  const requestsOpen = !['FINALIZING', 'FINALIZED', 'ARCHIVED', 'CANCELLED'].includes(
    data.event!.phase,
  );
  useEffect(() => {
    setName(user?.displayName || '');
  }, [user?.uid]);
  async function signIn() {
    setError('');
    setInfo('');
    setPending(true);
    try {
      await actions.gateway.signIn();
      await actions.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed. Please try again.');
    } finally {
      setPending(false);
    }
  }
  async function checkStatus() {
    setChecking(true);
    setError('');
    setInfo('');
    try {
      const latest = await actions.gateway.snapshot(true);
      await actions.refresh();
      setCheckedAt(Date.now());
      if (latest.member?.status === 'approved') setInfo('Approved. Your event access is ready.');
      else if (latest.member?.status === 'suspended')
        setInfo('Your access is suspended. Contact an organizer.');
      else if (latest.member?.status === 'pending')
        setInfo('Still waiting for organizer approval.');
      else setInfo('No access request was found for this account.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not check your status. Try again.');
    } finally {
      setChecking(false);
    }
  }
  async function checkIdentity() {
    setPending(true);
    setError('');
    try {
      await actions.gateway.refreshIdentity?.();
      await actions.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not verify your email.');
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="p-access">
      <Panel title={!user ? 'Join Emergent Hacks' : 'Event access'}>
        {!user ? (
          <>
            <p>Sign in with Google, then send your name to the organizers for approval.</p>
            <button
              className="button primary full"
              disabled={pending}
              onClick={() => void signIn()}
            >
              {pending ? 'Connecting…' : 'Continue with Google'}
            </button>
          </>
        ) : !user.emailVerified ? (
          <>
            <h3>Check your Google account</h3>
            <p>Use a Google account with a verified email to request event access.</p>
            <div className="p-actions">
              <button
                className="button secondary"
                disabled={pending}
                onClick={() => void checkIdentity()}
              >
                Check verification
              </button>
            </div>
          </>
        ) : data.member?.status === 'pending' ? (
          <div className="p-access-status">
            <span className="p-access-status-label">Request received</span>
            <h3>Waiting for organizer approval</h3>
            <p>
              Your request is in the organizer's queue. We'll use <strong>{user.email}</strong> to
              identify your account.
            </p>
            <p className="muted">
              After approval, you’ll choose a team when the organizer opens team selection.
            </p>
            <button
              className="button secondary"
              disabled={checking}
              onClick={() => void checkStatus()}
            >
              {checking ? 'Checking…' : 'Check status'}
            </button>
            {checkedAt && (
              <small className="p-access-checked">
                Checked at{' '}
                {new Date(checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </small>
            )}
            {config(data).details.contactEmail && (
              <p className="p-access-contact">
                Need help?{' '}
                <a href={`mailto:${config(data).details.contactEmail}`}>Email the organizer</a>.
              </p>
            )}
          </div>
        ) : data.member?.status === 'suspended' ? (
          <>
            <h3>Access suspended</h3>
            <p>Contact your organizer to restore access.</p>
          </>
        ) : !requestsOpen ? (
          <p>Membership requests are closed. Contact the organizer about joining.</p>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void cmd.run({
                type: 'requestMembership',
                displayName: name.trim(),
              });
            }}
          >
            <p>
              Confirm your name and email. You’ll choose a team after approval, when team selection
              opens.
            </p>
            <Field label="Your name">
              <input
                value={name}
                required
                minLength={2}
                maxLength={60}
                autoComplete="name"
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field label="Email on account">
              <input type="email" value={user.email} readOnly aria-readonly="true" />
            </Field>
            {rosterLocked && (
              <p className="p-note">
                Participant requests have closed. Contact an organizer if you need to join a team.
              </p>
            )}
            <button className="button primary full" disabled={cmd.pending || rosterLocked}>
              {cmd.pending ? 'Sending…' : 'Send access request'}
            </button>
          </form>
        )}
        <ErrorMessage>{error || cmd.error}</ErrorMessage>
        {info && (
          <p className="p-note" role="status" aria-live="polite">
            {info}
          </p>
        )}
        {user && (
          <button
            className="p-link p-signout"
            onClick={() =>
              void actions.gateway
                .signOut()
                .catch((error) =>
                  setError(
                    error instanceof Error ? error.message : 'Could not sign out. Try again.',
                  ),
                )
            }
          >
            Sign out
          </button>
        )}
      </Panel>
    </div>
  );
}
