import { useState } from 'react';
import { ArrowRight, Check, LogOut, Users } from 'lucide-react';
import type { AppSnapshot, Team as TeamModel } from '@robinhacks/core';
import type { AppActions } from '../hooks/useApp';
import { newCommandId } from '../app/gateway';
import { Dialog, Empty, Field, TeamMark } from '../ui/primitives';

export function Team({ data, actions }: { data: AppSnapshot; actions: AppActions }) {
  const team = data.market.entries.find((entry) => entry.team.id === data.member?.teamId)?.team;
  const [editing, setEditing] = useState(false);
  const [roleError, setRoleError] = useState('');
  if (!team)
    return (
      <>
        <div className="page-heading">
          <div>
            <h1>Account</h1>
          </div>
        </div>
        <div className="settings-panel">
          <Users size={26} />
          <h2>{actions.gateway.user?.displayName || 'Organizer'}</h2>
          <p className="muted">Organizer account. Manage the event from Admin.</p>
          <button className="button secondary" onClick={() => void actions.gateway.signOut()}>
            <LogOut size={17} />
            Sign out
          </button>
        </div>
      </>
    );
  const editable = !['FINALIZING', 'FINALIZED', 'ARCHIVED', 'CANCELLED'].includes(
    data.event?.phase || '',
  );
  const canDesignateTrader =
    data.member?.role === 'captain' && ['DRAFT', 'REGISTRATION'].includes(data.event?.phase || '');
  async function assignRole(uid: string, role: 'member' | 'trader') {
    try {
      await actions.execute({
        type: 'setMemberRole',
        commandId: newCommandId(),
        uid,
        role,
        status: 'approved',
      });
      setRoleError('');
      actions.notify('Trading permissions updated.');
    } catch (e) {
      setRoleError(e instanceof Error ? e.message : 'Could not change permissions.');
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>My team</h1>
        </div>
      </div>
      {roleError && (
        <p className="form-error" role="alert">
          {roleError}
        </p>
      )}
      <div className="team-profile-summary">
        <TeamMark team={team} large />
        <div>
          <span className="ticker">
            {team.ticker} · {team.category}
          </span>
          <h2>{team.name}</h2>
          <p>{team.pitch}</p>
        </div>
        {editable && (
          <button className="button primary" onClick={() => setEditing(true)}>
            Edit project
            <ArrowRight size={16} />
          </button>
        )}
      </div>
      <div className="team-page-grid">
        <section>
          <div className="section-heading">
            <h2>Team members</h2>
            <span className="muted">
              {data.members.filter((item) => item.teamId === team.id).length} people
            </span>
          </div>
          <p className="fine-print">
            Only the captain and designated trader can place orders.{' '}
            {canDesignateTrader
              ? 'You can designate one trader below.'
              : 'Ask an organizer to update trading permissions.'}
          </p>
          <div className="roster">
            {data.members
              .filter((item) => item.teamId === team.id)
              .map((member) => (
                <div className="roster-row" key={member.uid}>
                  <span className="avatar">{member.displayName.slice(0, 2).toUpperCase()}</span>
                  <div>
                    <strong>
                      {member.displayName}
                      {member.uid === data.member?.uid && <small> (you)</small>}
                    </strong>
                    <small>{member.status}</small>
                  </div>
                  {canDesignateTrader &&
                  member.uid !== data.member?.uid &&
                  member.status === 'approved' &&
                  ['member', 'trader'].includes(member.role) ? (
                    <label className="compact-select">
                      <span className="sr-only">Role for {member.displayName}</span>
                      <select
                        value={member.role}
                        disabled={actions.busy}
                        onChange={(event) =>
                          void assignRole(member.uid, event.target.value as 'member' | 'trader')
                        }
                      >
                        <option value="member">Member</option>
                        <option value="trader">Trader</option>
                      </select>
                    </label>
                  ) : (
                    <span className={`role-tag ${member.role}`}>{member.role}</span>
                  )}
                </div>
              ))}
          </div>
        </section>
        <aside className="team-checklist">
          <h3>Project details</h3>
          {[
            ['Pitch', team.pitch],
            ['Problem', team.problem],
            ['What you’re building', team.building],
            ['Demo link', team.demoUrl],
            ['Latest update', team.update],
          ].map(([label, value]) => (
            <div key={label}>
              <span className={`check-circle ${value ? 'complete' : ''}`}>
                {value && <Check size={12} />}
              </span>
              <span>{label}</span>
              <small>{value ? 'Added' : 'Not added'}</small>
            </div>
          ))}
        </aside>
      </div>
      <section className="content-section">
        <div className="section-heading">
          <h2>Latest update</h2>
        </div>
        {team.update ? (
          <p className="project-update">{team.update}</p>
        ) : (
          <Empty title="No project update">
            Edit your project to share progress with the other teams.
          </Empty>
        )}
      </section>
      {editing && <TeamEditor team={team} actions={actions} onClose={() => setEditing(false)} />}
    </>
  );
}
function TeamEditor({
  team,
  actions,
  onClose,
}: {
  team: TeamModel;
  actions: AppActions;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    name: team.name,
    pitch: team.pitch,
    category: team.category,
    problem: team.problem,
    building: team.building,
    demoUrl: team.demoUrl,
    repoUrl: team.repoUrl,
    update: team.update,
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  function field(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }
  async function save() {
    setSaving(true);
    try {
      await actions.execute({
        type: 'updateTeam',
        commandId: newCommandId(),
        expectedVersion: team.version,
        patch: form,
      });
      actions.notify('Project updated.');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update project.');
      setPreview(false);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog title={preview ? 'Review project update' : 'Edit project'} onClose={onClose} wide>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (preview) void save();
          else setPreview(true);
        }}
      >
        {preview ? (
          <div className="project-preview">
            <span className="muted">{form.category}</span>
            <h2>{form.name}</h2>
            <p>{form.pitch}</p>
            <h3>Problem</h3>
            <p>{form.problem || 'Not added'}</p>
            <h3>What we’re building</h3>
            <p>{form.building || 'Not added'}</p>
            <h3>Latest update</h3>
            <p>{form.update || 'Not added'}</p>
          </div>
        ) : (
          <>
            <div className="form-grid">
              <Field label="Team name">
                <input
                  value={form.name}
                  required
                  minLength={2}
                  maxLength={60}
                  onChange={(event) => field('name', event.target.value)}
                />
              </Field>
              <Field label="Category">
                <input
                  value={form.category}
                  maxLength={40}
                  onChange={(event) => field('category', event.target.value)}
                />
              </Field>
            </div>
            <Field label="Pitch" hint={`${form.pitch.length}/90 characters`}>
              <input
                value={form.pitch}
                required
                maxLength={90}
                onChange={(event) => field('pitch', event.target.value)}
              />
            </Field>
            <Field label="Problem">
              <textarea
                value={form.problem}
                maxLength={300}
                rows={3}
                onChange={(event) => field('problem', event.target.value)}
              />
            </Field>
            <Field label="What we’re building">
              <textarea
                value={form.building}
                maxLength={600}
                rows={4}
                onChange={(event) => field('building', event.target.value)}
              />
            </Field>
            <div className="form-grid">
              <Field label="Demo link">
                <input
                  type="url"
                  value={form.demoUrl}
                  pattern="https?://.*"
                  placeholder="https://"
                  maxLength={500}
                  onChange={(event) => field('demoUrl', event.target.value)}
                />
              </Field>
              <Field label="Source code link">
                <input
                  type="url"
                  value={form.repoUrl}
                  pattern="https?://.*"
                  placeholder="https://"
                  maxLength={500}
                  onChange={(event) => field('repoUrl', event.target.value)}
                />
              </Field>
            </div>
            <Field label="Latest update">
              <textarea
                value={form.update}
                maxLength={500}
                rows={3}
                onChange={(event) => field('update', event.target.value)}
              />
            </Field>
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          {preview && (
            <button type="button" className="button secondary" onClick={() => setPreview(false)}>
              Keep editing
            </button>
          )}
          <button className="button primary" disabled={saving} type="submit">
            {saving ? 'Publishing…' : preview ? 'Publish project update' : 'Review changes'}
            <ArrowRight size={17} />
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function AccessScreen({ actions, data }: { actions: AppActions; data: AppSnapshot | null }) {
  const user = actions.gateway.user;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [register, setRegister] = useState(false);
  const [reset, setReset] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [name, setName] = useState(user?.displayName || '');
  const [teamName, setTeamName] = useState('');
  const [teamId, setTeamId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [requested, setRequested] = useState(false);
  const joinableTeams =
    data?.joinableTeams ??
    data?.market.entries.map(({ team }) => ({ id: team.id, name: team.name })) ??
    [];
  const registrationOpen = ['DRAFT', 'REGISTRATION'].includes(data?.event?.phase || '');
  const requestOpen =
    !data?.event?.activeOperationId &&
    (registrationOpen ||
      ['SEED_OPEN', 'INTERMISSION', 'TRADING_OPEN', 'FROZEN'].includes(data?.event?.phase || ''));
  async function auth(provider: 'google' | 'email') {
    setError('');
    setBusy(true);
    try {
      await actions.gateway.signIn(provider, email, password, register);
      await actions.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }
  async function request() {
    setError('');
    setBusy(true);
    try {
      await actions.execute({
        type: 'requestMembership',
        commandId: newCommandId(),
        displayName: name || user?.displayName || '',
        teamName,
        ...(teamId ? { teamId } : {}),
      });
      setRequested(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not request access.');
    } finally {
      setBusy(false);
    }
  }
  async function resetPassword() {
    if (!actions.gateway.resetPassword) return;
    setError('');
    setResetSent(false);
    setBusy(true);
    try {
      await actions.gateway.resetPassword(email.trim());
      setResetSent(true);
    } catch (e) {
      const code = typeof e === 'object' && e && 'code' in e ? String(e.code) : '';
      setError(
        code === 'auth/invalid-email'
          ? 'Enter a valid email address.'
          : code === 'auth/too-many-requests'
            ? 'Too many requests. Try again later.'
            : 'Could not send a reset link. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }
  const pending = data?.member?.status === 'pending' || requested;
  return (
    <div className="access-layout">
      <div className="access-intro">
        <h1>{data?.event?.name || 'RobinHacks'}</h1>
        <p>Buy and sell shares in other hackathon teams using event credits.</p>
        <div className="access-rules">
          <span>
            <Check size={16} />
            10,000 starting credits per team
          </span>
          <span>
            <Check size={16} />
            No real money
          </span>
          <span>
            <Check size={16} />
            Judges determine final share values
          </span>
        </div>
      </div>
      <div className="access-form">
        {!user ? (
          <>
            <h2>{reset ? 'Reset password' : register ? 'Create account' : 'Sign in'}</h2>
            <p className="muted">
              {reset
                ? 'Enter your account email to request a reset link.'
                : 'Sign in, then request access to your team.'}
            </p>
            {!reset && (
              <>
                <button
                  className="button secondary full"
                  disabled={busy}
                  onClick={() => void auth('google')}
                >
                  <span className="google-mark">G</span>Continue with Google
                </button>
                <div className="divider-word">
                  <span>or use email</span>
                </div>
              </>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (reset) void resetPassword();
                else void auth('email');
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
              {!reset && (
                <Field label="Password">
                  <input
                    type="password"
                    autoComplete={register ? 'new-password' : 'current-password'}
                    minLength={8}
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </Field>
              )}
              <button className="button primary full" disabled={busy}>
                {busy
                  ? reset
                    ? 'Sending…'
                    : register
                      ? 'Creating account…'
                      : 'Signing in…'
                  : reset
                    ? 'Send reset link'
                    : register
                      ? 'Create account'
                      : 'Sign in'}
                <ArrowRight size={16} />
              </button>
            </form>
            {resetSent && (
              <p className="notice-inline" role="status">
                If an account uses this email, a password reset link is on its way.
              </p>
            )}
            {!register && !reset && actions.gateway.resetPassword && (
              <button
                className="text-link auth-toggle"
                disabled={busy}
                onClick={() => {
                  setReset(true);
                  setError('');
                  setResetSent(false);
                }}
              >
                Forgot password?
              </button>
            )}
            <button
              className="text-link auth-toggle"
              disabled={busy}
              onClick={() => {
                setRegister(reset ? false : !register);
                setReset(false);
                setResetSent(false);
                setError('');
              }}
            >
              {reset
                ? 'Back to sign in'
                : register
                  ? 'Already have an account? Sign in'
                  : 'Create an account'}
            </button>
          </>
        ) : pending ? (
          <>
            <span className="pending-icon">
              <Users size={29} />
            </span>
            <h2>Waiting for approval</h2>
            <p className="muted">
              Your request is with the organizer. You can open your team portfolio after approval.
            </p>
            <button className="button primary full" onClick={() => void actions.refresh()}>
              Check approval status
            </button>
            <button
              className="text-link auth-toggle"
              onClick={() => void actions.gateway.signOut()}
            >
              Sign out
            </button>
          </>
        ) : data?.member?.status === 'suspended' ? (
          <>
            <h2>Access suspended</h2>
            <p className="muted">Contact your organizer to restore your event access.</p>
            <button className="button secondary" onClick={() => void actions.gateway.signOut()}>
              Sign out
            </button>
          </>
        ) : !requestOpen || (!registrationOpen && !joinableTeams.length) ? (
          <>
            <h2>{requestOpen ? 'No teams available' : 'Membership requests closed'}</h2>
            <p className="muted">Contact the organizer about joining this event.</p>
            <button className="button secondary" onClick={() => void actions.refresh()}>
              Refresh event
            </button>
            <button
              className="text-link auth-toggle"
              onClick={() => void actions.gateway.signOut()}
            >
              Sign out
            </button>
          </>
        ) : (
          <>
            <h2>Join a team</h2>
            <p className="muted">
              {registrationOpen
                ? 'Join an existing team or request a new one. The organizer approves all requests.'
                : 'New teams are closed. You can request to join an existing team.'}
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void request();
              }}
            >
              <Field label="Your name">
                <input
                  required
                  minLength={2}
                  maxLength={60}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
              {!!joinableTeams.length && (
                <Field label="Team">
                  <select
                    value={teamId}
                    required={!registrationOpen}
                    onChange={(event) => {
                      const id = event.target.value;
                      setTeamId(id);
                      setTeamName(joinableTeams.find((team) => team.id === id)?.name || '');
                    }}
                  >
                    <option value="" disabled={!registrationOpen}>
                      {registrationOpen ? 'Request a new team' : 'Select your team'}
                    </option>
                    {joinableTeams.map((team) => (
                      <option value={team.id} key={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {!teamId && registrationOpen && (
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
              <button className="button primary full" disabled={busy}>
                {busy ? 'Requesting…' : 'Request access'}
                <ArrowRight size={16} />
              </button>
            </form>
            <button
              className="text-link auth-toggle"
              onClick={() => void actions.gateway.signOut()}
            >
              Sign out
            </button>
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
