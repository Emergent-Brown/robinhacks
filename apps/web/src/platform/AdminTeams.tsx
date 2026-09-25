import { useState } from 'react';
import type { ProjectSubmission, Team, TeamProfilePatch } from '@robinhacks/core';
import { Dialog, Field } from '../ui/primitives';
import { Blank, ErrorMessage, Panel, platform, teams, useCommand, type PageProps } from './shared';
import { managementLockReason } from './admin-management';
import { SectorPicker } from './SectorPicker';
import { resolveProjectSector } from './project-discovery';
import './admin-management.css';

type TeamDialog = { kind: 'profile' | 'submission' | 'delete'; team: Team } | { kind: 'create' };
type EvidenceFields = Pick<Team, 'name' | 'pitch' | 'problem' | 'building' | 'demoUrl' | 'repoUrl'>;

export function AdminTeams({ data, actions }: PageProps) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [dialog, setDialog] = useState<TeamDialog | null>(null);
  const locked = managementLockReason(data);
  const all = teams(data).sort((a, b) => a.name.localeCompare(b.name));
  const filtered = all.filter(
    (team) =>
      (status === 'all' || team.eligibility === status) &&
      `${team.name} ${team.pitch} ${team.category}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const submissions = platform(data).submissions;
  const canCreate =
    !locked &&
    !data.event!.platform!.rulesLockedAt &&
    ['DRAFT', 'REGISTRATION'].includes(data.event!.phase);
  return (
    <>
      <Panel
        title="Teams and projects"
        aside={
          <button
            className="button primary"
            disabled={!canCreate}
            onClick={() => setDialog({ kind: 'create' })}
          >
            Create team
          </button>
        }
      >
        <p className="muted">
          Edit project details here. Assign or move participants in People. Funding records always
          stay with the team that made them.
        </p>
        {locked && <p className="p-note">{locked}</p>}
        {!!data.event!.platform!.rulesLockedAt && (
          <p className="muted">
            All competing teams were fixed when funding began. Existing teams and their people can
            be corrected while paused.
          </p>
        )}
        <div className="p-admin-toolbar">
          <Field label="Find a team">
            <input
              type="search"
              placeholder="Name, pitch, or sector"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </Field>
          <Field label="Show">
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="all">All teams</option>
              <option value="active">Active</option>
              <option value="withdrawn">Withdrawn</option>
              <option value="disqualified">Disqualified</option>
            </select>
          </Field>
        </div>
        <p className="p-admin-count">
          {filtered.length} of {all.length} teams
        </p>
        {!filtered.length && (
          <Blank>
            {all.length
              ? 'No teams match this search.'
              : 'No teams yet. Create one or open team selection in People.'}
          </Blank>
        )}
        <ul className="p-admin-team-list">
          {filtered.map((team) => {
            const roster = data.members.filter(
              (member) => member.teamId === team.id && member.status === 'approved',
            );
            const captain = roster.find((member) => member.role === 'captain');
            const submission = submissions.find((entry) => entry.teamId === team.id);
            return (
              <li key={team.id}>
                <div className="p-admin-team-summary">
                  <h3>
                    {team.name} <span className="p-admin-count">· {team.eligibility}</span>
                  </h3>
                  <p>{team.pitch || 'No pitch added yet.'}</p>
                  <p className="muted">
                    {roster.length} {roster.length === 1 ? 'person' : 'people'} ·{' '}
                    {captain ? `Captain: ${captain.displayName}` : 'Needs a captain'}
                    {team.category ? ` · ${team.category}` : ''}
                  </p>
                  {submission && <p className="p-admin-count">Final submission locked</p>}
                </div>
                <div className="p-actions">
                  <button
                    className="button secondary"
                    disabled={!!locked}
                    onClick={() => setDialog({ kind: 'profile', team })}
                  >
                    Edit project
                  </button>
                  {submission && (
                    <button
                      className="p-link"
                      disabled={!!locked || !data.event!.paused}
                      onClick={() => setDialog({ kind: 'submission', team })}
                    >
                      Correct final submission
                    </button>
                  )}
                  <button
                    className="p-link p-member-danger"
                    disabled={
                      !!locked ||
                      team.eligibility !== 'active' ||
                      platform(data).rounds.some((round) => round.state === 'open')
                    }
                    onClick={() => setDialog({ kind: 'delete', team })}
                  >
                    {data.event!.platform!.rulesLockedAt || platform(data).rounds.length
                      ? 'Withdraw'
                      : 'Delete'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        {submissions.length > 0 && !data.event!.paused && (
          <p className="muted">Pause the event to correct or reopen final submissions.</p>
        )}
        {platform(data).rounds.some((round) => round.state === 'open') && (
          <p className="muted">Close the funding round before withdrawing a team.</p>
        )}
      </Panel>
      {dialog?.kind === 'create' && (
        <CreateTeam {...{ data, actions }} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'profile' && (
        <EditTeam {...{ data, actions }} team={dialog.team} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteTeam {...{ data, actions }} team={dialog.team} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'submission' && (
        <EditSubmission
          {...{ data, actions }}
          team={dialog.team}
          submission={submissions.find((entry) => entry.teamId === dialog.team.id)!}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

function CreateTeam({ data, actions, onClose }: PageProps & { onClose: () => void }) {
  const [name, setName] = useState('');
  const cmd = useCommand(actions);
  return (
    <Dialog title="Create a team" onClose={() => !cmd.pending && onClose()}>
      <form
        className="p-admin-editor"
        onSubmit={(event) => {
          event.preventDefault();
          void cmd.run({ type: 'adminCreateTeam', name }, onClose);
        }}
      >
        <Field label="Team name">
          <input
            autoComplete="off"
            required
            minLength={2}
            maxLength={60}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <p className="muted">
          After creating the team, use People to assign its captain and teammates. All teams must be
          created before the first funding round.
        </p>
        <ErrorMessage>{cmd.error}</ErrorMessage>
        <button className="button primary" disabled={cmd.pending || !!managementLockReason(data)}>
          {cmd.pending ? 'Creating…' : 'Create team'}
        </button>
      </form>
    </Dialog>
  );
}

function EditTeam({
  data,
  actions,
  team,
  onClose,
}: PageProps & { team: Team; onClose: () => void }) {
  const [form, setForm] = useState<TeamProfilePatch>({
    name: team.name,
    ticker: team.ticker,
    pitch: team.pitch,
    category: team.category,
    color: team.color,
    problem: team.problem,
    building: team.building,
    demoUrl: team.demoUrl,
    repoUrl: team.repoUrl,
    update: team.update,
  });
  const cmd = useCommand(actions);
  const changed = teams(data).find((entry) => entry.id === team.id)?.version !== team.version;
  const locked = managementLockReason(data);
  return (
    <Dialog title={`Edit ${team.name}`} wide onClose={() => !cmd.pending && onClose()}>
      <form
        className="p-admin-editor"
        onSubmit={(event) => {
          event.preventDefault();
          void cmd.run(
            {
              type: 'adminUpdateTeam',
              teamId: team.id,
              expectedVersion: team.version,
              patch: { ...form, category: resolveProjectSector(form.category ?? '', teams(data)) },
            },
            onClose,
          );
        }}
      >
        {changed && (
          <p className="p-note">
            This team changed while you were editing. Close and reopen to load the current version.
          </p>
        )}
        {locked && <p className="p-note">{locked}</p>}
        {platform(data).submissions.some((entry) => entry.teamId === team.id) && (
          <p className="p-admin-readonly">
            These fields update the live project page. Use “Correct final submission” to change the
            evidence judges review.
          </p>
        )}
        <EvidenceEditor
          value={form as EvidenceFields}
          onChange={(key, value) => setForm({ ...form, [key]: value })}
        />
        <div className="p-admin-form-grid">
          <SectorPicker
            projects={teams(data)}
            value={form.category ?? ''}
            onChange={(category) => setForm((current) => ({ ...current, category }))}
            disabled={cmd.pending}
          />
          <Field label="Short label">
            <input
              required
              maxLength={12}
              value={form.ticker}
              onChange={(event) => setForm({ ...form, ticker: event.target.value })}
            />
          </Field>
          <Field label="Team color">
            <input
              type="color"
              value={form.color}
              onChange={(event) => setForm({ ...form, color: event.target.value })}
            />
          </Field>
        </div>
        <Field label="Profile note">
          <textarea
            rows={2}
            maxLength={500}
            value={form.update}
            onChange={(event) => setForm({ ...form, update: event.target.value })}
          />
        </Field>
        <ErrorMessage>{cmd.error}</ErrorMessage>
        <button className="button primary" disabled={cmd.pending || changed || !!locked}>
          {cmd.pending ? 'Saving…' : 'Save project'}
        </button>
      </form>
    </Dialog>
  );
}

function EvidenceEditor({
  value,
  onChange,
  complete = false,
}: {
  value: EvidenceFields;
  onChange: (key: keyof EvidenceFields, value: string) => void;
  complete?: boolean;
}) {
  return (
    <>
      <Field label="Project name">
        <input
          required
          minLength={2}
          maxLength={60}
          value={value.name}
          onChange={(event) => onChange('name', event.target.value)}
        />
      </Field>
      <Field label="One-line pitch">
        <input
          required={complete}
          maxLength={140}
          value={value.pitch}
          onChange={(event) => onChange('pitch', event.target.value)}
        />
      </Field>
      <Field label="Problem">
        <textarea
          required={complete}
          rows={3}
          maxLength={1200}
          value={value.problem}
          onChange={(event) => onChange('problem', event.target.value)}
        />
      </Field>
      <Field label="What the team built">
        <textarea
          required={complete}
          rows={3}
          maxLength={1200}
          value={value.building}
          onChange={(event) => onChange('building', event.target.value)}
        />
      </Field>
      <div className="p-admin-form-grid">
        <Field label="Demo URL">
          <input
            type="url"
            required={complete}
            maxLength={500}
            value={value.demoUrl}
            onChange={(event) => onChange('demoUrl', event.target.value)}
          />
        </Field>
        <Field label="Repository URL">
          <input
            type="url"
            required={complete}
            maxLength={500}
            value={value.repoUrl}
            onChange={(event) => onChange('repoUrl', event.target.value)}
          />
        </Field>
      </div>
    </>
  );
}

function DeleteTeam({
  data,
  actions,
  team,
  onClose,
}: PageProps & { team: Team; onClose: () => void }) {
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const cmd = useCommand(actions);
  const withdrawal = !!data.event!.platform!.rulesLockedAt || platform(data).rounds.length > 0;
  const changed = teams(data).find((entry) => entry.id === team.id)?.version !== team.version;
  return (
    <Dialog
      title={`${withdrawal ? 'Withdraw' : 'Delete'} ${team.name}`}
      onClose={() => !cmd.pending && onClose()}
    >
      <form
        className="p-admin-editor"
        onSubmit={(event) => {
          event.preventDefault();
          void cmd.run(
            { type: 'adminDeleteTeam', teamId: team.id, expectedVersion: team.version, reason },
            onClose,
          );
        }}
      >
        <p>
          {withdrawal
            ? 'Funding has started, so this team will be withdrawn rather than erased. It cannot receive new investments or compete for builder awards. Its team access, final evidence, past investments, and earned investor claims remain.'
            : 'This deletes the team and its project updates before funding starts. Its participants keep event access and return to the team-selection screen. Conversation and organizer audit history stay available.'}
        </p>
        <Field label="Reason for the event record">
          <textarea
            required
            minLength={5}
            maxLength={500}
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <Field label={`Type “${team.name}” to confirm`}>
          <input
            required
            autoComplete="off"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <ErrorMessage>{cmd.error}</ErrorMessage>
        {changed && (
          <p className="p-note">
            This team changed. Close this dialog and review the latest version first.
          </p>
        )}
        <button
          className="button primary"
          disabled={
            cmd.pending ||
            name !== team.name ||
            reason.trim().length < 5 ||
            changed ||
            !!managementLockReason(data)
          }
        >
          {cmd.pending ? 'Saving…' : withdrawal ? 'Withdraw team' : 'Delete team'}
        </button>
      </form>
    </Dialog>
  );
}

function EditSubmission({
  data,
  actions,
  team,
  submission,
  onClose,
}: PageProps & { team: Team; submission: ProjectSubmission; onClose: () => void }) {
  const [form, setForm] = useState({
    name: submission.name,
    pitch: submission.pitch,
    problem: submission.problem,
    building: submission.building,
    demoUrl: submission.demoUrl,
    repoUrl: submission.repoUrl,
    commitSha: submission.commitSha,
    techStack: submission.techStack,
  });
  const [reason, setReason] = useState('');
  const cmd = useCommand(actions);
  const changed = teams(data).find((entry) => entry.id === team.id)?.version !== team.version;
  const disabled =
    cmd.pending ||
    changed ||
    !!managementLockReason(data) ||
    !data.event!.paused ||
    reason.trim().length < 5;
  return (
    <Dialog
      title={`Correct ${team.name}’s final submission`}
      wide
      onClose={() => !cmd.pending && onClose()}
    >
      <div className="p-admin-editor">
        <p className="p-admin-readonly">
          The prior submission stays in the event record. Any judge scores for this project will be
          cleared, and those judges must review and resubmit. Funding allocations and the original
          submitted roster stay unchanged.
        </p>
        {changed && (
          <p className="p-note">The team changed. Close and reopen this dialog before saving.</p>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void cmd.run(
              {
                type: 'adminUpdateSubmission',
                teamId: team.id,
                expectedVersion: team.version,
                reason,
                patch: form,
              },
              onClose,
            );
          }}
        >
          <EvidenceEditor
            complete
            value={form}
            onChange={(key, value) => setForm({ ...form, [key]: value })}
          />
          <Field label="Full Git commit SHA">
            <input
              required
              pattern="(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})"
              value={form.commitSha}
              onChange={(event) => setForm({ ...form, commitSha: event.target.value })}
            />
          </Field>
          <Field label="Technology used">
            <input
              maxLength={300}
              value={form.techStack}
              onChange={(event) => setForm({ ...form, techStack: event.target.value })}
            />
          </Field>
          <Field label="Reason for this correction">
            <textarea
              required
              minLength={5}
              maxLength={500}
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <ErrorMessage>{cmd.error}</ErrorMessage>
          <div className="p-actions">
            <button className="button primary" disabled={disabled}>
              {cmd.pending ? 'Saving…' : 'Save corrected evidence'}
            </button>
            {data.event!.platform!.currentRound < 3 && data.event!.phase !== 'FROZEN' && (
              <button
                type="button"
                className="button secondary"
                disabled={disabled}
                onClick={() =>
                  void cmd.run(
                    {
                      type: 'adminReopenSubmission',
                      teamId: team.id,
                      expectedVersion: team.version,
                      reason,
                    },
                    onClose,
                  )
                }
              >
                Reopen for the team instead
              </button>
            )}
          </div>
          {data.event!.platform!.currentRound < 3 && (
            <p className="muted">
              Reopening removes the lock. Resume the event and open the submission window so the
              team can resubmit before round 3.
            </p>
          )}
        </form>
      </div>
    </Dialog>
  );
}
