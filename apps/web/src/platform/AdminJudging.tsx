import { useState } from 'react';
import { PitchOrderEditor } from './JudgingReview';
import { Field } from '../ui/primitives';
import {
  Blank,
  config,
  ErrorMessage,
  Panel,
  platform,
  stamp,
  teamName,
  teams,
  useCommand,
  type PageProps,
} from './shared';

export function AdminJudging({ data, actions }: PageProps) {
  const judges = data.members.filter(
    (member) => member.role === 'judge' && member.status === 'approved' && member.teamId === null,
  );
  const [uid, setUid] = useState(judges[0]?.uid || '');
  const state = platform(data);
  const selectedUid = judges.some((judge) => judge.uid === uid) ? uid : judges[0]?.uid || '';
  const assignment = state.assignments.find((item) => item.uid === selectedUid);
  const mode = config(data).judgingMode ?? 'all';
  return (
    <>
      <JudgingModeEditor key={mode} data={data} actions={actions} />
      <PitchOrderEditor
        key={`${teams(data)
          .map((t) => t.id)
          .join(',')}:${config(data).pitchOrder?.join(',')}`}
        data={data}
        actions={actions}
      />
      <Panel title="Judge assignments">
        <p>
          {mode === 'all'
            ? 'Every approved judge scores all eligible submitted projects. Record any conflicts of interest below.'
            : 'Choose the projects each judge will score, and record any conflicts of interest.'}{' '}
          Every eligible project needs at least one non-conflicted score.
        </p>
        {!judges.length ? (
          <Blank>Approve a verified judge account in Access first.</Blank>
        ) : (
          <>
            <Field label="Judge">
              <select value={selectedUid} onChange={(event) => setUid(event.target.value)}>
                {judges.map((judge) => (
                  <option key={judge.uid} value={judge.uid}>
                    {judge.displayName} · {judge.email}
                  </option>
                ))}
              </select>
            </Field>
            <AssignmentEditor
              key={`${mode}:${selectedUid}:${assignment?.version || 0}:${assignment?.projectIds.join(',')}`}
              data={data}
              actions={actions}
              uid={selectedUid}
            />
          </>
        )}
      </Panel>
      <Panel title="Judging sheets">
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

function judgingReadOnly(data: PageProps['data']) {
  return (
    data.event!.paused ||
    ['FINALIZING', 'FINALIZED', 'ARCHIVED', 'CANCELLED'].includes(data.event!.phase)
  );
}

function JudgingModeEditor({ data, actions }: PageProps) {
  const saved = config(data).judgingMode ?? 'all';
  const [mode, setMode] = useState(saved);
  const cmd = useCommand(actions);
  const submitted = platform(data).judgingSheets.some((sheet) => sheet.submittedAt != null);
  const disabled = cmd.pending || submitted || judgingReadOnly(data);
  return (
    <Panel title="Judging mode">
      <p>
        Use all projects when judges watch every pitch. Use assigned projects when judges split the
        field between them.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void cmd.run({
            type: 'setJudgingMode',
            mode,
            expectedPhaseVersion: data.event!.phaseVersion,
          });
        }}
      >
        <Field label="Projects each judge scores">
          <select
            value={mode}
            disabled={disabled}
            onChange={(event) => setMode(event.target.value as 'all' | 'assigned')}
          >
            <option value="all">All projects</option>
            <option value="assigned">Assigned projects</option>
          </select>
        </Field>
        {submitted && (
          <p className="muted">The mode is locked once a judge submits their scores.</p>
        )}
        <ErrorMessage>{cmd.error}</ErrorMessage>
        <button className="button primary" disabled={disabled || mode === saved}>
          Save judging mode
        </button>
      </form>
    </Panel>
  );
}

function AssignmentEditor({ data, actions, uid }: PageProps & { uid: string }) {
  const state = platform(data);
  const assignment = state.assignments.find((item) => item.uid === uid);
  const [projectIds, setProjectIds] = useState(assignment?.projectIds || []);
  const [conflictIds, setConflictIds] = useState(assignment?.conflictIds || []);
  const cmd = useCommand(actions);
  const allProjects = (config(data).judgingMode ?? 'all') === 'all';
  const submitted = state.submissions.filter((submission) =>
    teams(data).some((team) => team.id === submission.teamId && team.eligibility === 'active'),
  );
  const sheetLocked = state.judgingSheets.some(
    (sheet) => sheet.uid === uid && sheet.submittedAt != null,
  );
  const disabled = cmd.pending || sheetLocked || judgingReadOnly(data);
  const selectedIds = allProjects ? submitted.map((project) => project.teamId) : projectIds;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void cmd.run({
          type: 'assignJudge',
          uid,
          projectIds: selectedIds,
          conflictIds: conflictIds.filter((id) => selectedIds.includes(id)),
          expectedVersion: assignment?.version || 0,
        });
      }}
    >
      {allProjects ? (
        <p className="muted">
          {submitted.length} {submitted.length === 1 ? 'project' : 'projects'} assigned
          automatically. New eligible submissions are included automatically.
        </p>
      ) : (
        <div className="p-actions">
          <button
            type="button"
            className="p-link"
            disabled={disabled}
            onClick={() => setProjectIds(submitted.map((project) => project.teamId))}
          >
            Assign all submitted projects
          </button>
          <button
            type="button"
            className="p-link"
            disabled={disabled}
            onClick={() => {
              setProjectIds([]);
              setConflictIds([]);
            }}
          >
            Clear selection
          </button>
        </div>
      )}
      <div className="p-table-wrap">
        <table className="p-table">
          <thead>
            <tr>
              <th>Project</th>
              {!allProjects && <th>Assigned</th>}
              <th>Known conflict</th>
            </tr>
          </thead>
          <tbody>
            {submitted.map((project) => (
              <tr key={project.teamId}>
                <td>{project.name}</td>
                {!allProjects && (
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Assign ${project.name}`}
                      disabled={disabled}
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
                )}
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Conflict for ${project.name}`}
                    disabled={disabled || !selectedIds.includes(project.teamId)}
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
      {sheetLocked && (
        <p className="muted">This judge has submitted; their assignments are locked.</p>
      )}
      <ErrorMessage>{cmd.error}</ErrorMessage>
      <button className="button primary" disabled={disabled || !uid || !submitted.length}>
        {allProjects ? 'Save conflicts' : 'Save assignments'}
      </button>
    </form>
  );
}
