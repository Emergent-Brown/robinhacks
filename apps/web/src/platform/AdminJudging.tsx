import { useState } from 'react';
import { Field } from '../ui/primitives';
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

export function AdminJudging({ data, actions }: PageProps) {
  const judges = data.members.filter(
    (member) => member.role === 'judge' && member.status === 'approved',
  );
  const [uid, setUid] = useState(judges[0]?.uid || '');
  const state = platform(data);
  const assignment = state.assignments.find((item) => item.uid === uid);
  return (
    <>
      <Panel title="Judge assignments">
        <p>
          Assign submitted projects to independent judges. Every eligible project needs completed,
          non-conflicted judging before results can be prepared.
        </p>
        {!judges.length ? (
          <Blank>Approve a verified judge account in Access first.</Blank>
        ) : (
          <>
            <Field label="Judge">
              <select value={uid} onChange={(event) => setUid(event.target.value)}>
                {judges.map((judge) => (
                  <option key={judge.uid} value={judge.uid}>
                    {judge.displayName} · {judge.email}
                  </option>
                ))}
              </select>
            </Field>
            <AssignmentEditor
              key={`${uid}:${assignment?.version || 0}`}
              data={data}
              actions={actions}
              uid={uid}
            />
          </>
        )}
      </Panel>
      <Panel title="Submitted judging sheets">
        {!state.judgingSheets.length && (
          <Blank>Judging sheets will appear when judges save or submit.</Blank>
        )}
        {state.judgingSheets.map((sheet) => (
          <section key={sheet.uid} className="p-entitlement">
            <h3>
              {data.members.find((member) => member.uid === sheet.uid)?.displayName || 'Judge'} ·{' '}
              {sheet.submittedAt ? 'Submitted' : 'Draft'}
            </h3>
            <p className="muted">
              Updated {stamp(sheet.updatedAt)}. Drafts are excluded from results.
            </p>
            <div className="p-table-wrap">
              <table className="p-table">
                <thead>
                  <tr>
                    <th>Project</th>
                    {config(data).funding.rubric.map((criterion) => (
                      <th key={criterion.id}>{criterion.label}</th>
                    ))}
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(sheet.entries).map(([id, entry]) => (
                    <tr key={id}>
                      <td>{teamName(data, id)}</td>
                      {config(data).funding.rubric.map((criterion) => (
                        <td key={criterion.id}>
                          {entry.conflict ? 'Conflict' : (entry.scores[criterion.id] ?? '—')}
                        </td>
                      ))}
                      <td>{entry.note || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </Panel>
    </>
  );
}
function AssignmentEditor({ data, actions, uid }: PageProps & { uid: string }) {
  const state = platform(data);
  const assignment = state.assignments.find((item) => item.uid === uid);
  const [projectIds, setProjectIds] = useState(assignment?.projectIds || []);
  const [conflictIds, setConflictIds] = useState(assignment?.conflictIds || []);
  const cmd = useCommand(actions);
  const submitted = state.submissions;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void cmd.run({
          type: 'assignJudge',
          uid,
          projectIds,
          conflictIds,
          expectedVersion: assignment?.version || 0,
        });
      }}
    >
      <div className="p-actions">
        <button
          type="button"
          className="p-link"
          onClick={() => setProjectIds(submitted.map((project) => project.teamId))}
        >
          Assign all submitted projects
        </button>
        <button
          type="button"
          className="p-link"
          onClick={() => {
            setProjectIds([]);
            setConflictIds([]);
          }}
        >
          Clear selection
        </button>
      </div>
      <div className="p-table-wrap">
        <table className="p-table">
          <thead>
            <tr>
              <th>Project</th>
              <th>Assigned</th>
              <th>Known conflict</th>
            </tr>
          </thead>
          <tbody>
            {submitted.map((project) => (
              <tr key={project.teamId}>
                <td>{project.name}</td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Assign ${project.name}`}
                    checked={projectIds.includes(project.teamId)}
                    onChange={(event) => {
                      setProjectIds(
                        event.target.checked
                          ? [...projectIds, project.teamId]
                          : projectIds.filter((id) => id !== project.teamId),
                      );
                      if (!event.target.checked)
                        setConflictIds(conflictIds.filter((id) => id !== project.teamId));
                    }}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Conflict for ${project.name}`}
                    disabled={!projectIds.includes(project.teamId)}
                    checked={conflictIds.includes(project.teamId)}
                    onChange={(event) =>
                      setConflictIds(
                        event.target.checked
                          ? [...conflictIds, project.teamId]
                          : conflictIds.filter((id) => id !== project.teamId),
                      )
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!submitted.length && <Blank>Projects must submit before they can be assigned.</Blank>}
      <ErrorMessage>{cmd.error}</ErrorMessage>
      <button className="button primary" disabled={cmd.pending || !uid}>
        Save assignments
      </button>
    </form>
  );
}
