import { useState } from 'react';
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
  const [mode, setMode] = useState<'signin' | 'register' | 'reset'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState(user?.displayName || '');
  const [teamId, setTeamId] = useState('');
  const [teamName, setTeamName] = useState('');
  const [kind, setKind] = useState<'team' | 'judge' | 'organizer'>('team');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [pending, setPending] = useState(false);
  const cmd = useCommand(actions);
  const registration = ['DRAFT', 'REGISTRATION'].includes(data.event!.phase);
  const rosterLocked = !!config(data).rulesLockedAt;
  const requestsOpen = !['FINALIZING', 'FINALIZED', 'ARCHIVED', 'CANCELLED'].includes(
    data.event!.phase,
  );
  async function auth(provider: 'google' | 'email') {
    setError('');
    setInfo('');
    setPending(true);
    try {
      if (mode === 'reset') {
        await actions.gateway.resetPassword?.(email.trim());
        setInfo('If an account uses this email, a reset link is on its way.');
      } else {
        await actions.gateway.signIn(provider, email.trim(), password, mode === 'register');
        await actions.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed. Please try again.');
    } finally {
      setPending(false);
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
        title={
          !user
            ? mode === 'register'
              ? 'Create account'
              : mode === 'reset'
                ? 'Reset password'
                : 'Sign in'
            : 'Event access'
        }
      >
        {!user ? (
          <>
            {mode !== 'reset' && (
              <button
                className="button secondary full"
                disabled={pending}
                onClick={() => void auth('google')}
              >
                Continue with Google
              </button>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void auth('email');
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
              {mode !== 'reset' && (
                <Field label="Password">
                  <input
                    type="password"
                    autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                    minLength={8}
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </Field>
              )}
              <button className="button primary full" disabled={pending}>
                {pending
                  ? 'Please wait…'
                  : mode === 'register'
                    ? 'Create account'
                    : mode === 'reset'
                      ? 'Send reset link'
                      : 'Sign in'}
              </button>
            </form>
            <div className="p-actions">
              <button
                className="p-link"
                onClick={() => {
                  setMode(mode === 'signin' ? 'register' : 'signin');
                  setError('');
                  setInfo('');
                }}
              >
                {mode === 'signin' ? 'Create an account' : 'Back to sign in'}
              </button>
              {mode === 'signin' && actions.gateway.resetPassword && (
                <button className="p-link" onClick={() => setMode('reset')}>
                  Forgot password?
                </button>
              )}
            </div>
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
          <>
            <h3>Waiting for approval</h3>
            <p>Your request is with the organizer.</p>
            <button className="button secondary" onClick={() => void actions.refresh()}>
              Check approval status
            </button>
          </>
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
                displayName: name,
                teamName:
                  kind === 'team' ? teamName : `${kind === 'judge' ? 'Judge' : 'Organizer'} access`,
                ...(kind === 'team' && teamId ? { teamId } : {}),
                ...(kind !== 'team' ? { staffRole: kind } : {}),
              });
            }}
          >
            <p>Requests are approved by the organizer. Signing in does not grant staff access.</p>
            <Field label="Your name">
              <input
                value={name}
                required
                minLength={2}
                maxLength={60}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field label="Joining as">
              <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
                <option value="team" disabled={rosterLocked}>
                  Team participant
                </option>
                <option value="judge">Judge</option>
                <option value="organizer">Organizer</option>
              </select>
            </Field>
            {kind === 'team' && rosterLocked && (
              <p className="p-note">
                Team rosters locked when the first funding round opened. New participant requests
                are closed. Staff can still request judge or organizer access.
              </p>
            )}
            {kind === 'team' && !rosterLocked && (
              <>
                <Field label="Team">
                  <select
                    value={teamId}
                    required={!registration}
                    onChange={(event) => {
                      setTeamId(event.target.value);
                      setTeamName(
                        data.joinableTeams?.find((t) => t.id === event.target.value)?.name || '',
                      );
                    }}
                  >
                    <option value="" disabled={!registration}>
                      {registration ? 'Request a new team' : 'Select your team'}
                    </option>
                    {data.joinableTeams?.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                </Field>
                {!teamId && registration && (
                  <Field label="New team name">
                    <input
                      required
                      minLength={2}
                      maxLength={60}
                      value={teamName}
                      onChange={(event) => setTeamName(event.target.value)}
                    />
                  </Field>
                )}
              </>
            )}
            <button
              className="button primary full"
              disabled={cmd.pending || (kind === 'team' && rosterLocked)}
            >
              Request access
            </button>
          </form>
        )}
        <ErrorMessage>{error || cmd.error}</ErrorMessage>
        {info && (
          <p className="p-note" role="status">
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
