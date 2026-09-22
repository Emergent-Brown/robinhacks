import { useEffect, useState } from 'react';
import { EventSchedule } from '@robinhacks/core';
import { Field, ExternalLink } from '../ui/primitives';
import { config, navigate, Panel, useCommand, ErrorMessage, type PageProps } from './shared';

export function Homepage({ data, onJoin }: PageProps & { onJoin: () => void }) {
  const details = config(data).details;
  return (
    <>
      <div className="p-page-heading">
        <div>
          <p className="p-kicker">{details.theme}</p>
          <h1>{data.event!.name}</h1>
        </div>
        <div className="p-actions">
          <button className="p-link" onClick={() => navigate('rules')}>
            Event rules
          </button>
          <button className="button primary" onClick={onJoin}>
            Join the event
          </button>
        </div>
      </div>
      <div className="p-home-columns">
        <Panel title="About the event">
          <p className="p-prose">{details.about}</p>
          <dl className="p-facts">
            <dt>When</dt>
            <dd>{details.dateLabel || 'Date to be announced'}</dd>
            <dt>Where</dt>
            <dd>{data.event!.venue || 'Venue to be announced'}</dd>
          </dl>
          {details.registrationUrl && (
            <ExternalLink href={details.registrationUrl}>Event registration</ExternalLink>
          )}
          {details.contactEmail && (
            <p>
              Questions? <a href={`mailto:${details.contactEmail}`}>{details.contactEmail}</a>
            </p>
          )}
        </Panel>
        <Panel title="During the hackathon">
          <ol className="p-steps">
            <li>
              <strong>Build a project.</strong> Keep a public page with the problem, demo, and team.
            </li>
            <li>
              <strong>Meet the other teams.</strong> Read their updates, visit demos, and ask
              questions.
            </li>
            <li>
              <strong>Invest in three rounds.</strong> Allocate a fresh credit budget privately
              before each deadline.
            </li>
            <li>
              <strong>Finish and submit.</strong> Judges evaluate the work independently of funding.
            </li>
          </ol>
        </Panel>
      </div>
      <Panel title="Schedule">
        {details.schedule.length ? (
          <ol className="p-schedule">
            {details.schedule.map((item, i) => {
              const planned = EventSchedule.resolve(details.timing, item.window);
              return (
                <li key={i}>
                  <time>
                    {planned ? EventSchedule.label(planned, details.timeZone) : item.time}
                  </time>
                  <div>
                    <strong>{item.title}</strong>
                    {item.description && <p>{item.description}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p>The organizer will publish the schedule here.</p>
        )}
        <p className="muted">
          All times are{' '}
          {details.timeZone === 'America/New_York'
            ? 'Eastern'
            : details.timeZone.replaceAll('_', ' ')}
          . Schedule subject to change.
        </p>
      </Panel>
    </>
  );
}

export function Access({ data, actions }: PageProps) {
  const user = actions.gateway.user;
  const [name, setName] = useState(user?.displayName || '');
  const [kind, setKind] = useState<'team' | 'judge' | 'organizer'>('team');
  const [legacyMode, setLegacyMode] = useState<'signin' | 'reset'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
      await actions.gateway.signIn('google');
      await actions.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed. Please try again.');
    } finally {
      setPending(false);
    }
  }
  async function signInEmail() {
    setError('');
    setInfo('');
    setPending(true);
    try {
      if (legacyMode === 'reset') {
        await actions.gateway.resetPassword?.(email.trim());
        setInfo('If this account exists, a reset link is on its way.');
      } else {
        await actions.gateway.signIn('email', email.trim(), password);
        await actions.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign in. Try again.');
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
  async function identity(refresh = false) {
    setPending(true);
    setError('');
    try {
      if (refresh) {
        await actions.gateway.refreshIdentity?.();
        await actions.refresh();
      } else {
        await actions.gateway.verifyEmail?.();
        setInfo('Verification email sent. Open the link, then check verification below.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not verify your email.');
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="p-access">
      <Panel
        title={!user ? 'Join Emergent Hacks' : 'Event access'}
      >
        {!user ? (
          <>
            <p>Sign in with Google, then send your name to the organizers for approval.</p>
            <button className="button primary full" disabled={pending} onClick={() => void signIn()}>
              {pending ? 'Connecting…' : 'Continue with Google'}
            </button>
            <details className="p-access-legacy">
              <summary>Already have an email account?</summary>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void signInEmail();
                }}
              >
                <Field label="Email">
                  <input
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </Field>
                {legacyMode === 'signin' && (
                  <Field label="Password">
                    <input
                      type="password"
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  </Field>
                )}
                <button className="button secondary full" disabled={pending}>
                  {legacyMode === 'reset' ? 'Send reset link' : 'Sign in with email'}
                </button>
                {actions.gateway.resetPassword && (
                  <button
                    className="p-link"
                    type="button"
                    onClick={() => {
                      setLegacyMode(legacyMode === 'signin' ? 'reset' : 'signin');
                      setError('');
                      setInfo('');
                    }}
                  >
                    {legacyMode === 'signin' ? 'Forgot password?' : 'Back to sign in'}
                  </button>
                )}
              </form>
            </details>
          </>
        ) : !user.emailVerified ? (
          <>
            <h3>Verify your email</h3>
            <p>
              Verify {user.email} before requesting event access. Your organizer checks identities
              to keep one investing account per team.
            </p>
            <div className="p-actions">
              <button className="button primary" disabled={pending} onClick={() => void identity()}>
                Send verification email
              </button>
              <button
                className="button secondary"
                disabled={pending}
                onClick={() => void identity(true)}
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
            <p className="muted">Once approved, sign in with this account to enter the event.</p>
            <button className="button secondary" disabled={checking} onClick={() => void checkStatus()}>
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
                <a href={`mailto:${config(data).details.contactEmail}`}>
                  Email the organizer
                </a>
                .
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
                ...(kind !== 'team' ? { staffRole: kind } : {}),
              });
            }}
          >
            <p>Tell the organizers what name to use. Your email is already verified.</p>
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
            <details className="p-access-staff">
              <summary>{kind === 'team' ? 'Joining as a judge or organizer?' : 'Requesting staff access'}</summary>
              <Field label="Access requested">
                <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
                  <option value="team">Participant</option>
                  <option value="judge">Judge</option>
                  <option value="organizer">Organizer</option>
                </select>
              </Field>
              <p className="muted">Staff roles require separate organizer approval.</p>
            </details>
            {rosterLocked && kind === 'team' && (
              <p className="p-note">
                Participant requests have closed. Contact an organizer if you need to join a team.
              </p>
            )}
            <button
              className="button primary full"
              disabled={cmd.pending || (kind === 'team' && rosterLocked)}
            >
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
          <button className="p-link p-signout" onClick={() => void actions.gateway.signOut()}>
            Sign out
          </button>
        )}
      </Panel>
    </div>
  );
}
