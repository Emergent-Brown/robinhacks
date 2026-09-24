import { useState } from 'react';
import type { Team } from '@robinhacks/core';
import { Dialog, ExternalLink, Field } from '../ui/primitives';
import { useClock } from '../hooks/useApp';
import './projects.css';
import {
  Blank,
  config,
  ErrorMessage,
  navigate,
  ownTeam,
  Panel,
  platform,
  stamp,
  useCommand,
  type PageProps,
} from './shared';

export function MyTeam({ data, actions }: PageProps) {
  const team = ownTeam(data);
  const [edit, setEdit] = useState(false);
  const [submit, setSubmit] = useState(false);
  const now = useClock();
  const cmd = useCommand(actions);
  if (!team)
    return (
      <>
        <h1>My account</h1>
        <Panel>
          <p>{actions.gateway.user?.displayName}</p>
          <p>{data.member?.role} account</p>
          <button className="button secondary" onClick={() => void actions.gateway.signOut()}>
            Sign out
          </button>
        </Panel>
      </>
    );
  const state = platform(data);
  const submission = state.submissions.find((s) => s.teamId === team.id);
  const canEdit =
    ['captain', 'trader'].includes(data.member!.role) &&
    !submission &&
    data.event!.phase !== 'SEED_OPEN' &&
    !data.event!.paused &&
    !['FINALIZING', 'FINALIZED', 'CANCELLED', 'ARCHIVED'].includes(data.event!.phase);
  const submissionOpen =
    config(data).submissionsOpen &&
    !!config(data).submissionClosesAt &&
    now < config(data).submissionClosesAt! &&
    !data.event!.paused;
  const roster = data.members.filter((member) => member.teamId === team.id);
  return (
    <>
      <div className="p-page-heading">
        <h1>My team</h1>
        <button className="p-link" onClick={() => navigate('projects', team.id)}>
          View public project
        </button>
      </div>
      <Panel
        title={team.name}
        aside={
          canEdit && (
            <button className="button secondary" onClick={() => setEdit(true)}>
              Edit project
            </button>
          )
        }
      >
        {(data.event!.phase === 'SEED_OPEN' || !!submission) && (
          <p className="muted">
            {submission
              ? 'This project is locked after final submission.'
              : 'Project details stay fixed during funding. Edit them between rounds.'}
          </p>
        )}
        <p>{team.pitch || 'Add a one-sentence pitch.'}</p>
        {team.category && <span className="p-project-sector">{team.category}</span>}
        <div className="p-actions">
          <ExternalLink href={team.demoUrl}>Demo</ExternalLink>
          <ExternalLink href={team.repoUrl}>Source code</ExternalLink>
        </div>
      </Panel>
      <Panel title="Team members">
        <p className="muted">
          The captain and one designated investor manage the shared allocation. Each person uses
          their own sign-in.
        </p>
        <ul className="p-roster p-profile-roster">
          {roster.map((member) => (
            <li key={member.uid}>
              <div className="p-person-heading">
                <strong>{member.displayName}</strong>
                {data.member?.role === 'captain' &&
                member.uid !== data.member.uid &&
                ['member', 'trader'].includes(member.role) &&
                ['DRAFT', 'REGISTRATION'].includes(data.event!.phase) ? (
                  <select
                    aria-label={`Role for ${member.displayName}`}
                    value={member.role}
                    disabled={cmd.pending}
                    onChange={(event) =>
                      void cmd.run({
                        type: 'setMemberRole',
                        uid: member.uid,
                        role: event.target.value as 'member' | 'trader',
                        status: 'approved',
                      })
                    }
                  >
                    <option value="member">Member</option>
                    <option value="trader">Designated investor</option>
                  </select>
                ) : (
                  <span>
                    {member.role === 'trader' ? 'Designated investor' : member.role} ·{' '}
                    {member.status}
                  </span>
                )}
              </div>
              {member.bio && <p className="p-person-bio">{member.bio}</p>}
            </li>
          ))}
        </ul>
        {data.member?.status === 'approved' && (
          <ProfileBioEditor key={data.member.uid} data={data} actions={actions} />
        )}
        <ErrorMessage>{cmd.error}</ErrorMessage>
      </Panel>
      <Panel title="Final submission">
        {submission ? (
          <>
            <p className="p-note">
              Submitted {stamp(submission.submittedAt)}. This version is fixed for judging.
            </p>
            <h3>{submission.name}</h3>
            <p>{submission.pitch}</p>
            <p>
              <strong>Commit</strong> <code className="p-break">{submission.commitSha}</code>
            </p>
            <p>
              <strong>Tech stack</strong> {submission.techStack || 'Not specified'}
            </p>
            <div className="p-actions">
              <ExternalLink href={submission.demoUrl}>Submitted demo</ExternalLink>
              <ExternalLink href={submission.repoUrl}>Submitted repository</ExternalLink>
            </div>
          </>
        ) : (
          <>
            <p>
              {submissionOpen
                ? `Submit before ${stamp(config(data).submissionClosesAt, config(data).details.timeZone)}.`
                : 'The organizer will open the final submission window.'}{' '}
              Your saved project, demo, repository, commit, and roster become the judging record.
            </p>
            <button
              className="button primary"
              disabled={!submissionOpen || !['captain', 'trader'].includes(data.member!.role)}
              onClick={() => setSubmit(true)}
            >
              Review final submission
            </button>
          </>
        )}
      </Panel>
      {['captain', 'trader'].includes(data.member!.role) &&
        !data.event!.paused &&
        !['FINALIZING', 'FINALIZED', 'CANCELLED', 'ARCHIVED'].includes(data.event!.phase) &&
        config(data).currentRound < 3 && <UpdateEditor data={data} actions={actions} />}
      <Panel title="Published updates">
        {!state.updates.some((u) => u.teamId === team.id) ? (
          <Blank>Publish a short update before the first round.</Blank>
        ) : (
          <ol className="p-updates">
            {state.updates
              .filter((u) => u.teamId === team.id)
              .sort((a, b) => b.createdAt - a.createdAt)
              .map((update) => (
                <li key={update.id}>
                  <h3>
                    {config(data).funding.roundNames[update.round - 1]}{' '}
                    <span className="muted">· {stamp(update.createdAt)}</span>
                  </h3>
                  <p>{update.works}</p>
                  <p>
                    <strong>Changed:</strong> {update.changed || 'None noted'}
                  </p>
                  <p>
                    <strong>Incomplete:</strong> {update.incomplete || 'None noted'}
                  </p>
                  <ExternalLink href={update.evidenceUrl}>Evidence</ExternalLink>
                </li>
              ))}
          </ol>
        )}
      </Panel>
      {edit && (
        <ProjectEditor team={team} data={data} actions={actions} close={() => setEdit(false)} />
      )}
      {submit && (
        <SubmissionReview
          team={team}
          data={data}
          actions={actions}
          close={() => setSubmit(false)}
        />
      )}
    </>
  );
}

function ProjectEditor({ team, actions, close }: PageProps & { team: Team; close: () => void }) {
  const [form, setForm] = useState({
    name: team.name,
    category: team.category,
    pitch: team.pitch,
    problem: team.problem,
    building: team.building,
    demoUrl: team.demoUrl,
    repoUrl: team.repoUrl,
  });
  const cmd = useCommand(actions);
  return (
    <Dialog title="Edit project" onClose={close} wide>
      <form
        className="p-form p-project-editor"
        onSubmit={(event) => {
          event.preventDefault();
          void cmd.run({ type: 'updateTeam', expectedVersion: team.version, patch: form }, close);
        }}
      >
        <Field label="Project name">
          <input
            required
            minLength={2}
            maxLength={60}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <Field label="One-sentence pitch" hint="90 characters maximum">
          <input
            required
            maxLength={90}
            value={form.pitch}
            onChange={(e) => setForm({ ...form, pitch: e.target.value })}
          />
        </Field>
        <Field
          label="Sector (optional)"
          hint="For example: health, climate, education, or developer tools."
        >
          <input
            maxLength={40}
            value={form.category}
            onChange={(event) => setForm({ ...form, category: event.target.value })}
          />
        </Field>
        <Field label="Problem">
          <textarea
            required
            maxLength={300}
            rows={3}
            value={form.problem}
            onChange={(e) => setForm({ ...form, problem: e.target.value })}
          />
        </Field>
        <Field label="What you’re building">
          <textarea
            required
            maxLength={600}
            rows={4}
            value={form.building}
            onChange={(e) => setForm({ ...form, building: e.target.value })}
          />
        </Field>
        <Field label="Demo URL">
          <input
            type="url"
            maxLength={500}
            value={form.demoUrl}
            onChange={(e) => setForm({ ...form, demoUrl: e.target.value })}
          />
        </Field>
        <Field label="Repository URL">
          <input
            type="url"
            maxLength={500}
            value={form.repoUrl}
            onChange={(e) => setForm({ ...form, repoUrl: e.target.value })}
          />
        </Field>
        <ErrorMessage>{cmd.error}</ErrorMessage>
        <div className="p-actions">
          <button className="button primary" disabled={cmd.pending}>
            Save project
          </button>
          <button className="button secondary" type="button" onClick={close}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}
function ProfileBioEditor({ data, actions }: PageProps) {
  const [editing, setEditing] = useState(false);
  const [bio, setBio] = useState(data.member?.bio ?? '');
  const cmd = useCommand(actions);
  if (!editing)
    return (
      <div className="p-bio-editor">
        <button
          className="p-link"
          onClick={() => {
            setBio(data.member?.bio ?? '');
            setEditing(true);
          }}
        >
          {data.member?.bio ? 'Edit your bio' : 'Add a short bio'}
        </button>
        <p className="muted">Optional. Your bio appears next to your name on the project page.</p>
      </div>
    );
  return (
    <form
      className="p-bio-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void cmd.run({ type: 'updateProfile', bio }, () => setEditing(false));
      }}
    >
      <Field
        label="Your bio (optional)"
        hint="Share what you like building or what you’re working on. Visible on your team’s project page."
      >
        <textarea
          rows={3}
          maxLength={280}
          value={bio}
          onChange={(event) => setBio(event.target.value)}
        />
      </Field>
      <p className="p-bio-count">{bio.length}/280 characters</p>
      <ErrorMessage>{cmd.error}</ErrorMessage>
      <div className="p-actions">
        <button className="button primary" disabled={cmd.pending}>
          {cmd.pending ? 'Saving…' : 'Save bio'}
        </button>
        <button
          className="button secondary"
          type="button"
          disabled={cmd.pending}
          onClick={() => setEditing(false)}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
function UpdateEditor({ data, actions }: PageProps) {
  const [round, setRound] = useState(Math.min(3, Math.max(1, config(data).currentRound + 1)));
  const [form, setForm] = useState({ works: '', changed: '', evidenceUrl: '', incomplete: '' });
  const [confirm, setConfirm] = useState(false);
  const cmd = useCommand(actions);
  return (
    <Panel title="Publish a checkpoint update">
      <p className="muted">
        Updates remain public and cannot be edited. Publish a correction as a new update if needed.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setConfirm(true);
        }}
      >
        <Field label="Checkpoint">
          <select value={round} onChange={(event) => setRound(Number(event.target.value))}>
            {config(data).funding.roundNames.map((name, index) => (
              <option
                key={name}
                value={index + 1}
                disabled={index + 1 <= config(data).currentRound}
              >
                {name}
              </option>
            ))}
          </select>
        </Field>
        <div className="p-form-grid">
          <Field label="What works now">
            <textarea
              required
              rows={3}
              maxLength={600}
              value={form.works}
              onChange={(e) => setForm({ ...form, works: e.target.value })}
            />
          </Field>
          <Field label="What changed">
            <textarea
              required
              rows={3}
              maxLength={600}
              value={form.changed}
              onChange={(e) => setForm({ ...form, changed: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Demo or evidence URL">
          <input
            type="url"
            required
            maxLength={500}
            value={form.evidenceUrl}
            onChange={(e) => setForm({ ...form, evidenceUrl: e.target.value })}
          />
        </Field>
        <Field label="What is still incomplete">
          <textarea
            required
            rows={2}
            maxLength={600}
            value={form.incomplete}
            onChange={(e) => setForm({ ...form, incomplete: e.target.value })}
          />
        </Field>
        <button className="button primary">Review update</button>
      </form>
      {confirm && (
        <Dialog title="Publish this update?" onClose={() => setConfirm(false)}>
          <div className="p-prose">
            <h3>{config(data).funding.roundNames[round - 1]}</h3>
            <p>
              <strong>Works:</strong> {form.works}
            </p>
            <p>
              <strong>Changed:</strong> {form.changed}
            </p>
            <p>
              <strong>Incomplete:</strong> {form.incomplete}
            </p>
            <ExternalLink href={form.evidenceUrl}>Evidence</ExternalLink>
          </div>
          <p>This will be visible to all approved participants. It cannot be edited or removed.</p>
          <ErrorMessage>{cmd.error}</ErrorMessage>
          <button
            className="button primary"
            disabled={cmd.pending}
            onClick={() =>
              void cmd.run({ type: 'publishUpdate', round, ...form }, () => {
                setConfirm(false);
                setForm({ works: '', changed: '', evidenceUrl: '', incomplete: '' });
              })
            }
          >
            Publish update
          </button>
        </Dialog>
      )}
    </Panel>
  );
}
function SubmissionReview({
  data,
  actions,
  team,
  close,
}: PageProps & { team: Team; close: () => void }) {
  const [commit, setCommit] = useState('');
  const [stack, setStack] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const cmd = useCommand(actions);
  const missing = !team.pitch || !team.problem || !team.building || !team.demoUrl || !team.repoUrl;
  return (
    <Dialog title="Final submission" onClose={close} wide>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void cmd.run(
            {
              type: 'submitProject',
              expectedTeamVersion: team.version,
              commitSha: commit.trim(),
              techStack: stack,
            },
            close,
          );
        }}
      >
        <h2>{team.name}</h2>
        <p>{team.pitch}</p>
        <dl className="p-update-content">
          <dt>Problem</dt>
          <dd>{team.problem}</dd>
          <dt>Project</dt>
          <dd>{team.building}</dd>
          <dt>Team</dt>
          <dd>
            {data.members
              .filter((m) => m.teamId === team.id && m.status === 'approved')
              .map((m) => m.displayName)
              .join(', ')}
          </dd>
        </dl>
        <div className="p-actions">
          <ExternalLink href={team.demoUrl}>Demo</ExternalLink>
          <ExternalLink href={team.repoUrl}>Repository</ExternalLink>
        </div>
        {missing && (
          <ErrorMessage>
            Add the pitch, problem, project description, demo, and repository before submitting.
          </ErrorMessage>
        )}
        <Field label="Full Git commit hash" hint="40 characters for SHA-1 or 64 for SHA-256">
          <input
            required
            pattern="([0-9a-fA-F]{40}|[0-9a-fA-F]{64})"
            maxLength={64}
            value={commit}
            onChange={(event) => setCommit(event.target.value)}
          />
        </Field>
        <Field label="Tech stack (optional)">
          <input maxLength={300} value={stack} onChange={(event) => setStack(event.target.value)} />
        </Field>
        <label className="p-check">
          <input
            type="checkbox"
            required
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <span>
            I checked the links and commit. This submission becomes the fixed judging record.
          </span>
        </label>
        <ErrorMessage>{cmd.error}</ErrorMessage>
        <button className="button primary" disabled={!confirmed || missing || cmd.pending}>
          Submit project
        </button>
      </form>
    </Dialog>
  );
}
