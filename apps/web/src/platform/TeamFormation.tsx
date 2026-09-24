import { useState } from 'react';
import { Field } from '../ui/primitives';
import { config, ErrorMessage, navigate, Panel, useCommand, type PageProps } from './shared';
import './team-formation.css';

type TeamRole = 'captain' | 'trader' | 'member';
const roles: { value: TeamRole; label: string; description: string }[] = [
  {
    value: 'captain',
    label: 'Captain',
    description: 'Manage the project, team roles, and investments. One per team.',
  },
  {
    value: 'trader',
    label: 'Designated investor',
    description: 'Manage investments and edit the project alongside the captain. One per team.',
  },
  {
    value: 'member',
    label: 'Member',
    description: 'Build with the team and view its shared investments. Multiple people can join.',
  },
];

/** Approved participants finish team selection before entering the event workspace. */
export function TeamFormation({ data, actions }: PageProps) {
  const [mode, setMode] = useState<'create' | 'join'>('join');
  const [teamId, setTeamId] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<TeamRole | ''>('');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const cmd = useCommand(actions);
  const settings = config(data);
  const open =
    !!settings.teamFormationOpen &&
    !settings.rulesLockedAt &&
    !data.event!.paused &&
    data.event!.phase === 'REGISTRATION';
  const teams = [...(data.formationTeams ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const selected = teams.find((team) => team.id === teamId);
  const available =
    mode === 'create' ? roles.map((item) => item.value) : (selected?.availableRoles ?? []);
  const duplicate = teams.some((team) => team.name.toLowerCase() === name.trim().toLowerCase());
  const ready =
    open &&
    role &&
    available.includes(role) &&
    (mode === 'create' ? name.trim().length >= 2 && !duplicate : !!selected);

  async function refresh() {
    setRefreshing(true);
    setRefreshError('');
    try {
      await actions.gateway.snapshot(true);
      await actions.refresh();
      setCheckedAt(Date.now());
    } catch (error) {
      setRefreshError(
        error instanceof Error ? error.message : 'Could not check team selection. Try again.',
      );
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="p-team-formation">
      <div className="p-page-heading">
        <div>
          <p className="p-kicker">Your access is approved</p>
          <h1>{open ? 'Choose your team' : 'Team selection'}</h1>
        </div>
        <button
          className="p-link"
          disabled={refreshing || cmd.pending}
          onClick={() => void refresh()}
        >
          {refreshing ? 'Checking…' : 'Check status'}
        </button>
      </div>
      {checkedAt && (
        <p className="muted" role="status">
          Checked at{' '}
          {new Date(checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.{' '}
          {open ? 'Team selection is open.' : 'Team selection is currently closed.'}
        </p>
      )}
      <ErrorMessage>{refreshError}</ErrorMessage>
      {!open ? (
        <Panel
          title={
            settings.rulesLockedAt
              ? 'Team selection has closed'
              : data.event!.paused
                ? 'Team selection is paused'
                : 'Waiting for team selection'
          }
        >
          <p>
            {settings.rulesLockedAt
              ? 'Contact an organizer to check your team assignment.'
              : 'You’re on the attendee list. The organizer will open team selection so everyone can create or join a team together.'}
          </p>
          <p className="muted">
            Your project, investments, and messages become available after you choose a team.
          </p>
          {settings.details.contactEmail && (
            <a href={`mailto:${settings.details.contactEmail}`}>Email the organizer</a>
          )}
        </Panel>
      ) : (
        <>
          <p>
            Join the people you’re building with, or start a team. Choose your role before
            continuing.
          </p>
          <div className="p-formation-modes" aria-label="Choose how to join a team">
            <button
              aria-pressed={mode === 'join'}
              disabled={cmd.pending}
              onClick={() => {
                setMode('join');
                setRole('');
                cmd.clearError();
              }}
            >
              Join a team <span>{teams.length} available</span>
            </button>
            <button
              aria-pressed={mode === 'create'}
              disabled={cmd.pending}
              onClick={() => {
                setMode('create');
                setRole('');
                cmd.clearError();
              }}
            >
              Create a team <span>Start with a name</span>
            </button>
          </div>
          <Panel title={mode === 'join' ? 'Join an existing team' : 'Start your team'}>
            {mode === 'join' && !teams.length ? (
              <p>No teams yet. Create one, or check again after a teammate starts yours.</p>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!ready || !role) return;
                  void cmd.run(
                    mode === 'create'
                      ? { type: 'createFormationTeam', name: name.trim(), role }
                      : { type: 'joinFormationTeam', teamId, role },
                    () => navigate('team'),
                  );
                }}
              >
                {mode === 'create' ? (
                  <Field label="Team name">
                    <input
                      required
                      minLength={2}
                      maxLength={60}
                      value={name}
                      disabled={cmd.pending}
                      onChange={(event) => setName(event.target.value)}
                      autoComplete="off"
                    />
                  </Field>
                ) : (
                  <>
                    <Field label="Team">
                      <select
                        required
                        value={teamId}
                        disabled={cmd.pending}
                        onChange={(event) => {
                          setTeamId(event.target.value);
                          setRole('');
                          cmd.clearError();
                        }}
                      >
                        <option value="" disabled>
                          Choose a team
                        </option>
                        {teams.map((team) => (
                          <option key={team.id} value={team.id}>
                            {team.name} · {team.members.length}{' '}
                            {team.members.length === 1 ? 'person' : 'people'}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {selected && (
                      <ul className="p-formation-roster" aria-label={`${selected.name} members`}>
                        {selected.members.map((member, index) => (
                          <li key={`${member.name}:${index}`}>
                            <strong>{member.name}</strong>
                            <span>{roles.find((item) => item.value === member.role)?.label}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
                {mode === 'create' && duplicate && (
                  <p className="p-error" role="alert">
                    That team already exists. Join it or choose another name.
                  </p>
                )}
                {(mode === 'create' || selected) && (
                  <fieldset className="p-formation-roles" disabled={cmd.pending}>
                    <legend>Your role</legend>
                    {roles.map((item) => (
                      <label
                        key={item.value}
                        className={!available.includes(item.value) ? 'unavailable' : undefined}
                      >
                        <input
                          type="radio"
                          name="team-role"
                          required
                          value={item.value}
                          checked={role === item.value}
                          disabled={!available.includes(item.value)}
                          onChange={() => setRole(item.value)}
                        />
                        <span>
                          <strong>
                            {item.label}
                            {!available.includes(item.value) && ' · Taken'}
                          </strong>
                          <small>{item.description}</small>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                )}
                <p className="muted">
                  Creating a team doesn’t make you its captain. Each team needs a captain before
                  funding begins. Ask an organizer if you need to change teams later.
                </p>
                <ErrorMessage>{cmd.error}</ErrorMessage>
                <button className="button primary" disabled={!ready || cmd.pending}>
                  {cmd.pending
                    ? 'Joining…'
                    : mode === 'create'
                      ? 'Create team and continue'
                      : 'Join team and continue'}
                </button>
              </form>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
