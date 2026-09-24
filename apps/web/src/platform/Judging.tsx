import { useEffect, useState } from 'react';
import { isJudgingScore, JUDGING_SCORE_MAX, type JudgingEntry } from '@robinhacks/core';
import { Dialog, ExternalLink, Field } from '../ui/primitives';
import {
  Blank,
  config,
  ErrorMessage,
  Panel,
  platform,
  stamp,
  teamName,
  useCommand,
  type PageProps,
} from './shared';

export function Judging({ data, actions }: PageProps) {
  const state = platform(data);
  const uid = data.member!.uid;
  const assignment = state.assignments.find((item) => item.uid === uid);
  const sheet = state.judgingSheets.find((item) => item.uid === uid);
  const [entries, setEntries] = useState<Record<string, JudgingEntry>>(sheet?.entries || {});
  const [version, setVersion] = useState(sheet?.version || 0);
  const [dirty, setDirty] = useState(false);
  const [review, setReview] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [selected, setSelected] = useState(assignment?.projectIds[0] || '');
  const cmd = useCommand(actions);
  const rubric = config(data).funding.rubric;
  const locked = !!sheet?.submittedAt;
  const judgingOpen = data.event!.phase === 'FROZEN' && !data.event!.paused;
  useEffect(() => {
    if (cmd.pending) return;
    if ((sheet?.version || 0) === version) return;
    if (dirty) {
      setConflict(true);
    } else {
      setEntries(sheet?.entries || {});
      setVersion(sheet?.version || 0);
    }
  }, [sheet?.version, cmd.pending]);
  const projects = assignment?.projectIds || [];
  useEffect(() => {
    if (!projects.includes(selected)) setSelected(projects[0] || '');
  }, [projects.join('|'), selected]);
  function edit(projectId: string, next: Partial<JudgingEntry>) {
    setEntries((current) => ({
      ...current,
      [projectId]: {
        ...(current[projectId] || { scores: {}, note: '', conflict: false }),
        ...next,
      },
    }));
    setDirty(true);
  }
  async function save(submit: boolean) {
    const normalized = Object.fromEntries(
      Object.entries(entries).map(([id, entry]) => [
        id,
        assignment?.conflictIds.includes(id) ? { ...entry, conflict: true } : entry,
      ]),
    );
    const okay = await cmd.run({
      type: 'saveJudgingSheet',
      entries: normalized,
      expectedVersion: version,
      submit,
    });
    if (okay) {
      setVersion(version + 1);
      setDirty(false);
      setReview(false);
    }
  }
  const complete =
    projects.length > 0 &&
    projects.every(
      (id) =>
        assignment?.conflictIds.includes(id) ||
        (entries[id]?.conflict
          ? entries[id]!.note.trim().length >= 3
          : rubric.every((criterion) => isJudgingScore(entries[id]?.scores[criterion.id]))),
    );
  const submission = state.submissions.find((item) => item.teamId === selected);
  const entry = entries[selected] || { scores: {}, note: '', conflict: false };
  const assignedConflict = assignment?.conflictIds.includes(selected);
  return (
    <>
      <div className="p-page-heading">
        <h1>Judging</h1>
        <span className="p-status">
          {locked ? 'Submitted' : dirty ? 'Unsaved draft' : 'Saved draft'}
        </span>
      </div>
      <p>
        Score each criterion from 0 to {JUDGING_SCORE_MAX} using the published rubric. Funding
        activity and other judges’ scores are hidden.
      </p>
      {locked && (
        <p className="p-note">
          Submitted {stamp(sheet!.submittedAt)}. Your judging sheet is locked.
        </p>
      )}
      {!judgingOpen && !locked && (
        <p className="p-note">The organizer has not opened judging, or judging is paused.</p>
      )}
      {!projects.length ? (
        <Panel>
          <Blank>No projects assigned yet. Contact the organizer.</Blank>
        </Panel>
      ) : (
        <div className="p-judge-layout">
          <aside>
            <label className="field">
              <span>Assigned project</span>
              <select value={selected} onChange={(event) => setSelected(event.target.value)}>
                {projects.map((id) => (
                  <option key={id} value={id}>
                    {teamName(data, id)}
                    {entries[id]?.conflict || assignment?.conflictIds.includes(id)
                      ? ' · Conflict'
                      : ''}
                  </option>
                ))}
              </select>
            </label>
            <ul className="p-judge-projects">
              {projects.map((id) => (
                <li key={id}>
                  <button
                    className="p-link"
                    aria-current={id === selected ? 'page' : undefined}
                    onClick={() => setSelected(id)}
                  >
                    {teamName(data, id)}
                  </button>
                  <span>
                    {assignment?.conflictIds.includes(id) || entries[id]?.conflict
                      ? 'Conflict'
                      : rubric.every((c) => isJudgingScore(entries[id]?.scores[c.id]))
                        ? 'Scored'
                        : 'Needs scores'}
                  </span>
                </li>
              ))}
            </ul>
          </aside>
          <div>
            <Panel title={submission?.name || teamName(data, selected)}>
              {submission ? (
                <>
                  <p>{submission.pitch}</p>
                  <dl className="p-update-content">
                    <dt>Problem</dt>
                    <dd>{submission.problem}</dd>
                    <dt>Project</dt>
                    <dd>{submission.building}</dd>
                    <dt>Tech stack</dt>
                    <dd>{submission.techStack || 'Not specified'}</dd>
                    <dt>Commit</dt>
                    <dd>
                      <code className="p-break">{submission.commitSha}</code>
                    </dd>
                  </dl>
                  <div className="p-actions">
                    <ExternalLink href={submission.demoUrl}>Submitted demo</ExternalLink>
                    <ExternalLink href={submission.repoUrl}>Submitted code</ExternalLink>
                  </div>
                  <p className="muted">Submitted {stamp(submission.submittedAt)}</p>
                </>
              ) : (
                <Blank>No final submission for this project.</Blank>
              )}
            </Panel>
            <Panel title="Your assessment">
              <label className="p-check">
                <input
                  type="checkbox"
                  checked={!!assignedConflict || entry.conflict}
                  disabled={locked || !judgingOpen || !!assignedConflict}
                  onChange={(event) => edit(selected, { conflict: event.target.checked })}
                />
                <span>I have a conflict of interest and will not score this project.</span>
              </label>
              {!assignedConflict && !entry.conflict && (
                <div className="p-rubric">
                  {rubric.map((criterion) => (
                    <Field
                      key={criterion.id}
                      label={`${criterion.label} · ${criterion.weight}%`}
                      hint={`0 = weakest; ${JUDGING_SCORE_MAX} = strongest`}
                    >
                      <select
                        disabled={locked || !judgingOpen}
                        value={entry.scores[criterion.id] ?? ''}
                        onChange={(event) =>
                          edit(selected, {
                            scores:
                              event.target.value === ''
                                ? Object.fromEntries(
                                    Object.entries(entry.scores).filter(
                                      ([id]) => id !== criterion.id,
                                    ),
                                  )
                                : { ...entry.scores, [criterion.id]: Number(event.target.value) },
                          })
                        }
                      >
                        <option value="">Select score</option>
                        {Array.from({ length: JUDGING_SCORE_MAX + 1 }, (_, i) => (
                          <option key={i} value={i}>
                            {i}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ))}
                </div>
              )}
              <Field label={entry.conflict ? 'Conflict explanation (required)' : 'Judge notes'}>
                <textarea
                  rows={4}
                  maxLength={1500}
                  disabled={locked || !judgingOpen}
                  value={entry.note}
                  onChange={(event) => edit(selected, { note: event.target.value })}
                />
              </Field>
            </Panel>
          </div>
        </div>
      )}
      {conflict && (
        <p className="p-error" role="alert">
          This judging sheet changed in another session. Your draft has not overwritten it.{' '}
          <button
            className="p-link"
            onClick={() => {
              setEntries(sheet?.entries || {});
              setVersion(sheet?.version || 0);
              setDirty(false);
              setConflict(false);
            }}
          >
            Load saved sheet
          </button>
        </p>
      )}
      <ErrorMessage>{cmd.error}</ErrorMessage>
      <div className="p-actions">
        <button
          className="button secondary"
          disabled={locked || !judgingOpen || cmd.pending || conflict || !dirty}
          onClick={() => void save(false)}
        >
          Save judging draft
        </button>
        <button
          className="button primary"
          disabled={locked || !judgingOpen || !complete || cmd.pending || conflict}
          onClick={() => setReview(true)}
        >
          Review and submit scores
        </button>
      </div>
      {review && (
        <Dialog title="Submit judging sheet" onClose={() => setReview(false)} wide>
          <p>Your submitted scores will be locked. Confirm all scores and conflicts below.</p>
          <div className="p-table-wrap">
            <table className="p-table">
              <thead>
                <tr>
                  <th>Project</th>
                  {rubric.map((c) => (
                    <th key={c.id}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {projects.map((id) => (
                  <tr key={id}>
                    <td>{teamName(data, id)}</td>
                    {rubric.map((c) => (
                      <td key={c.id}>
                        {assignment?.conflictIds.includes(id) || entries[id]?.conflict
                          ? 'Conflict'
                          : (entries[id]?.scores[c.id] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ErrorMessage>{cmd.error}</ErrorMessage>
          <button className="button primary" disabled={cmd.pending} onClick={() => void save(true)}>
            Submit scores
          </button>
        </Dialog>
      )}
    </>
  );
}
