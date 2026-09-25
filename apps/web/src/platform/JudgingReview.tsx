import { useState } from 'react';
import { Field } from '../ui/primitives';
import {
  config,
  ErrorMessage,
  Panel,
  platform,
  teams,
  ProjectLink,
  teamName,
  useCommand,
  type PageProps,
} from './shared';

/** Scores stay private until every assigned judge has finished independent scoring. */
export function JudgingReview({ data, actions }: PageProps) {
  const state = platform(data);
  const cmd = useCommand(actions);
  const [winnerId, setWinnerId] = useState('');
  const [reason, setReason] = useState('');
  const funding = config(data).funding;
  const weight = funding.rubric.reduce((sum, c) => sum + c.weight, 0);
  const ranking = state.submissions
    .filter((s) => teams(data).some((t) => t.id === s.teamId && t.eligibility === 'active'))
    .map((project) => {
      const entries = state.judgingSheets
        .filter((s) => state.deliberationJudgeIds?.includes(s.uid))
        .flatMap((sheet) => {
          const assignment = state.assignments.find((a) => a.uid === sheet.uid);
          const entry = sheet.entries[project.teamId];
          return sheet.submittedAt &&
            assignment?.projectIds.includes(project.teamId) &&
            !assignment.conflictIds.includes(project.teamId) &&
            entry &&
            !entry.conflict
            ? [{ ...entry, uid: sheet.uid }]
            : [];
        });
      const score =
        entries.reduce(
          (sum, e) =>
            sum + funding.rubric.reduce((n, c) => n + (e.scores[c.id] ?? 0) * c.weight, 0),
          0,
        ) / (entries.length * weight || 1);
      return { ...project, entries, score };
    })
    .sort((a, b) => b.score - a.score || a.teamId.localeCompare(b.teamId));
  return (
    <Panel title="Judge deliberation">
      {!state.deliberationReady ? (
        <p>
          Once every assigned judge submits and every project has a non-conflicted score, the ranked
          projects and submitted notes appear here for all judges.
        </p>
      ) : (
        <>
          <p>
            Review the scores together, then submit your agreed winner. The organizer reviews the
            decision before publishing. Scores guide deliberation; the judges make the final choice.
          </p>
          <ol className="p-deliberation-list">
            {ranking.map((p) => (
              <li key={p.teamId}>
                <ProjectLink team={teams(data).find((t) => t.id === p.teamId)!} />{' '}
                <strong>{p.score.toFixed(2)} / 5</strong>{' '}
                <span className="muted">
                  ({p.entries.length} {p.entries.length === 1 ? 'judge' : 'judges'})
                </span>
                <details>
                  <summary>Scores and notes</summary>
                  {p.entries.map((e) => (
                    <div key={e.uid} className="p-note">
                      <p>
                        {funding.rubric.map((c) => `${c.label}: ${e.scores[c.id]}`).join(' · ')}
                      </p>
                      <p>{e.note || 'No notes.'}</p>
                    </div>
                  ))}
                </details>
              </li>
            ))}
          </ol>
          {state.judgeDecision && (
            <p className="p-note">
              <strong>Submitted: {teamName(data, state.judgeDecision.winnerId)}</strong>
              <br />
              {state.judgeDecision.reason}
              <br />
              {data.event?.phase === 'FROZEN'
                ? 'Awaiting organizer approval.'
                : data.event?.phase === 'FINALIZING'
                  ? 'Organizer approved; results are under review.'
                  : 'Approved decision.'}
            </p>
          )}
          {data.member?.role === 'judge' && data.event?.phase === 'FROZEN' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void cmd.run({
                  type: 'submitJudgeDecision',
                  winnerId,
                  reason,
                  expectedPhaseVersion: data.event!.phaseVersion,
                });
              }}
            >
              <Field label="Agreed grand-prize winner">
                <select required value={winnerId} onChange={(e) => setWinnerId(e.target.value)}>
                  <option value="">Choose the winner</option>
                  {ranking.map((p) => (
                    <option value={p.teamId} key={p.teamId}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Decision summary"
                hint="Summarize the judges’ discussion. This explanation is included in the final results."
              >
                <textarea
                  required
                  minLength={10}
                  maxLength={1000}
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
              <ErrorMessage>{cmd.error}</ErrorMessage>
              <button
                className="button primary"
                disabled={
                  cmd.pending || data.event.paused || !winnerId || reason.trim().length < 10
                }
              >
                {state.judgeDecision
                  ? 'Replace decision for organizer review'
                  : 'Submit winner for organizer review'}
              </button>
            </form>
          )}
        </>
      )}
    </Panel>
  );
}

export function PitchOrderEditor({ data, actions }: PageProps) {
  const available = teams(data).filter((t) => t.eligibility === 'active') ?? [];
  const saved = config(data).pitchOrder ?? [];
  const initial = [
    ...saved.filter((id) => available.some((t) => t.id === id)),
    ...available.map((t) => t.id).filter((id) => !saved.includes(id)),
  ];
  const [order, setOrder] = useState(initial);
  const cmd = useCommand(actions);
  const move = (index: number, offset: number) =>
    setOrder((previous) => {
      const next = [...previous];
      [next[index], next[index + offset]] = [next[index + offset]!, next[index]!];
      return next;
    });
  return (
    <Panel title="Pitch order">
      <p>Judges browse assigned projects in this order. New teams appear at the end.</p>
      <ol className="p-pitch-order">
        {order.map((id, i) => (
          <li key={id}>
            <span>{teamName(data, id)}</span>
            <div className="p-actions">
              <button
                className="button secondary"
                disabled={!i || cmd.pending}
                aria-label={`Move ${teamName(data, id)} earlier`}
                onClick={() => move(i, -1)}
              >
                ↑
              </button>
              <button
                className="button secondary"
                disabled={i === order.length - 1 || cmd.pending}
                aria-label={`Move ${teamName(data, id)} later`}
                onClick={() => move(i, 1)}
              >
                ↓
              </button>
            </div>
          </li>
        ))}
      </ol>
      <ErrorMessage>{cmd.error}</ErrorMessage>
      <button
        className="button primary"
        disabled={cmd.pending || data.event?.paused || !order.length}
        onClick={() =>
          void cmd.run({
            type: 'setPitchOrder',
            projectIds: order,
            expectedPhaseVersion: data.event!.phaseVersion,
          })
        }
      >
        Save pitch order
      </button>
    </Panel>
  );
}
