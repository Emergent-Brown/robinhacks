import { useState } from 'react';
import { ArrowRight, Check, Download, Pause, Play, RefreshCw, ShieldAlert } from 'lucide-react';
import {
  EventPolicy,
  ResultScorer,
  RULES,
  type AppSnapshot,
  type Command,
  type Phase,
  type IssuerResult,
  type Team,
} from '@robinhacks/core';
import { newCommandId } from '../app/gateway';
import type { AppActions } from '../hooks/useApp';
import { credits, date, Dialog, download, Empty, Field, TeamMark } from '../ui/primitives';

export const phaseNames: Record<Phase, string> = {
  DRAFT: 'Event setup',
  REGISTRATION: 'Registration',
  SEED_OPEN: 'Seed round',
  SEED_SETTLING: 'Seed settlement',
  INTERMISSION: 'Build time',
  TRADING_OPEN: 'Trading open',
  FROZEN: 'Judging',
  FINALIZING: 'Preparing results',
  FINALIZED: 'Final results',
  CANCELLED: 'Event cancelled',
  ARCHIVED: 'Archived',
};
const transitionLabels: Partial<Record<Phase, string>> = {
  REGISTRATION: 'Open registration',
  SEED_OPEN: 'Open seed round',
  SEED_SETTLING: 'Close seed & allocate',
  INTERMISSION: 'Close trading window',
  TRADING_OPEN: 'Open trading window',
  FROZEN: 'End trading & start judging',
  CANCELLED: 'Cancel event',
  ARCHIVED: 'Archive event',
};
export function Admin({ data, actions }: { data: AppSnapshot; actions: AppActions }) {
  const event = data.event!;
  const [tab, setTab] = useState<'event' | 'people' | 'results' | 'activity'>('event');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [transition, setTransition] = useState<Phase | null>(null);
  const [reviewVersion, setReviewVersion] = useState(event.phaseVersion);
  const [duration, setDuration] = useState('30');
  const [reason, setReason] = useState(event.pauseReason);
  const [announcement, setAnnouncement] = useState(event.announcement);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<IssuerResult[] | null>(null);
  const [publish, setPublish] = useState(false);
  const [haltTeam, setHaltTeam] = useState<Team | null>(null);
  const [eligibility, setEligibility] = useState<Team['eligibility']>('withdrawn');
  const [haltReason, setHaltReason] = useState('');
  async function perform(command: Command) {
    setWorking(true);
    setError('');
    try {
      const result = await actions.execute(command);
      actions.notify(result.message || 'Change confirmed.');
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The action could not be completed.');
      return false;
    } finally {
      setWorking(false);
    }
  }
  async function continueOperation() {
    setWorking(true);
    setError('');
    try {
      for (let i = 0; i < 40; i++) {
        await actions.execute({
          type: 'continueOperation',
          commandId: newCommandId(),
        });
        const latest = await actions.gateway.snapshot();
        if (!latest.operation || latest.operation.state !== 'running') break;
      }
      actions.notify('Operation progress saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operation paused. Continue to resume safely.');
    } finally {
      setWorking(false);
    }
  }
  async function exportEvent() {
    setWorking(true);
    try {
      download(
        `robinhacks-event-${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify(await actions.gateway.exportEvent(), null, 2),
        'application/json',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed.');
    } finally {
      setWorking(false);
    }
  }
  function previewResults() {
    try {
      const values = Object.fromEntries(
        data.market.entries.map((entry) => [
          entry.team.id,
          scores[entry.team.id] === undefined || scores[entry.team.id] === ''
            ? NaN
            : Number(scores[entry.team.id]),
        ]),
      );
      setPreview(
        ResultScorer.score(
          values,
          data.market.entries
            .filter((entry) => entry.team.eligibility === 'active')
            .map((entry) => entry.team.id),
        ),
      );
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Add all project scores before previewing.');
    }
  }
  const transitions = EventPolicy.allowedTransitions(event).filter(
    (phase) =>
      !['FINALIZING', 'FINALIZED'].includes(phase) &&
      !(event.phase === 'SEED_SETTLING' && phase === 'INTERMISSION'),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Admin</h1>
          <p>Trading windows, team access and results.</p>
        </div>
        <button className="button secondary" disabled={working} onClick={() => void exportEvent()}>
          <Download size={16} />
          Export event
        </button>
      </div>
      <div className="tab-line" role="tablist" aria-label="Administration">
        {(['event', 'people', 'results', 'activity'] as const).map((item) => (
          <button
            key={item}
            role="tab"
            className={item === tab ? 'active' : ''}
            aria-selected={item === tab}
            onClick={() => setTab(item)}
          >
            {item === 'event'
              ? 'Event controls'
              : item === 'people'
                ? 'Teams & access'
                : item === 'results'
                  ? 'Results'
                  : 'Audit log'}
            {item === 'people' &&
              data.requests.filter((request) => request.status === 'pending').length > 0 && (
                <span>
                  {data.requests.filter((request) => request.status === 'pending').length}
                </span>
              )}
          </button>
        ))}
      </div>
      {error && (
        <p className="form-error admin-error" role="alert">
          {error}
        </p>
      )}
      {tab === 'event' && (
        <>
          <section className="admin-phase">
            <div>
              <span className="eyebrow">Current phase</span>
              <h2>
                {phaseNames[event.phase]}
                {event.phase === 'TRADING_OPEN' ? ` ${event.windowId} of 3` : ''}
              </h2>
              <p>
                {event.closesAt
                  ? `Closes ${date(event.closesAt)}`
                  : 'The organizer opens the next phase manually.'}
              </p>
              <span className={`phase-pill ${event.paused ? 'paused' : ''}`}>
                <span />
                {event.paused ? 'Paused' : 'Active'}
              </span>
            </div>
            <div className="pause-controls">
              <button
                className={`button ${event.paused ? 'primary' : 'danger-soft'}`}
                disabled={working || ['FINALIZED', 'ARCHIVED', 'CANCELLED'].includes(event.phase)}
                onClick={() =>
                  void perform({
                    type: 'setPause',
                    commandId: newCommandId(),
                    paused: !event.paused,
                    reason: reason || 'Paused by the organizer.',
                    expectedPhaseVersion: event.phaseVersion,
                  })
                }
              >
                {event.paused ? <Play size={18} /> : <Pause size={18} />}
                {event.paused ? 'Resume event' : 'Pause now'}
              </button>
              <Field label="Pause message">
                <input
                  value={reason}
                  maxLength={200}
                  placeholder="Optional organizer message"
                  onChange={(event) => setReason(event.target.value)}
                />
              </Field>
            </div>
          </section>
          {data.operation && (
            <section className="operation-panel">
              <div className="section-heading">
                <h2>{data.operation.kind === 'seed' ? 'Seed allocation' : 'Result settlement'}</h2>
                <span className="status-tag">{data.operation.state}</span>
              </div>
              <progress value={data.operation.completed} max={data.operation.total || 1} />
              <p>
                {data.operation.completed} of {data.operation.total} teams processed. Progress is
                saved after each team.
              </p>
              {data.operation.state === 'running' && (
                <button
                  className="button primary"
                  disabled={working}
                  onClick={() => void continueOperation()}
                >
                  <RefreshCw size={16} className={working ? 'spin' : ''} />
                  {working ? 'Processing…' : 'Continue settlement'}
                </button>
              )}
              {data.operation.state === 'ready' && data.operation.kind === 'results' && (
                <button
                  className="button primary"
                  disabled={working}
                  onClick={() => {
                    setReviewVersion(event.phaseVersion);
                    setError('');
                    setPublish(true);
                  }}
                >
                  Review & publish results
                  <ArrowRight size={16} />
                </button>
              )}
            </section>
          )}
          <section className="content-section">
            <div className="section-heading">
              <h2>Next phase</h2>
            </div>
            <div className="phase-actions">
              {transitions.map((target) => (
                <button
                  key={target}
                  className={`button ${target === 'CANCELLED' ? 'quiet-danger' : 'secondary'}`}
                  disabled={working}
                  onClick={() => {
                    setReviewVersion(event.phaseVersion);
                    setError('');
                    setTransition(target);
                  }}
                >
                  {transitionLabels[target] || phaseNames[target]}
                  <ArrowRight size={16} />
                </button>
              ))}
            </div>
            {event.phase === 'FROZEN' && (
              <button className="button primary" onClick={() => setTab('results')}>
                Enter judging scores
                <ArrowRight size={16} />
              </button>
            )}
            {transitions.length === 0 && event.phase !== 'FROZEN' && (
              <p className="muted">
                No phase transition is available.{' '}
                {event.phase === 'FINALIZING'
                  ? 'Complete the results operation, then publish.'
                  : ''}
              </p>
            )}
          </section>
          <section className="content-section">
            <h2>Participant announcement</h2>
            <p className="muted">Appears above every participant’s current view.</p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void perform({
                  type: 'setAnnouncement',
                  commandId: newCommandId(),
                  announcement,
                });
              }}
            >
              <Field label="Announcement" hint="Leave empty to remove the current announcement.">
                <textarea
                  value={announcement}
                  rows={3}
                  maxLength={500}
                  onChange={(event) => setAnnouncement(event.target.value)}
                />
              </Field>
              <button className="button secondary" disabled={working} type="submit">
                Publish announcement
              </button>
            </form>
          </section>
        </>
      )}
      {tab === 'people' && (
        <>
          <section className="content-section">
            <div className="section-heading">
              <h2>Pending requests</h2>
              <span className="muted">Organizer approval required</span>
            </div>
            {data.requests.filter((item) => item.status === 'pending').length ? (
              data.requests
                .filter((item) => item.status === 'pending')
                .map((request) => (
                  <AccessApproval
                    key={request.uid}
                    request={request}
                    data={data}
                    disabled={working}
                    approve={(command) => perform(command)}
                  />
                ))
            ) : (
              <Empty title="No pending requests" />
            )}
          </section>
          <section className="content-section">
            <h2>Members & permissions</h2>
            <p className="fine-print">
              Teams have one captain and at most one additional trader. Changes are audited.
            </p>
            <div className="admin-members">
              {data.members.map((member) => (
                <div className="admin-member" key={member.uid}>
                  <span className="avatar">{member.displayName.slice(0, 2).toUpperCase()}</span>
                  <div>
                    <strong>{member.displayName}</strong>
                    <small>
                      {data.market.entries.find((entry) => entry.team.id === member.teamId)?.team
                        .name || 'Organizer'}
                    </small>
                  </div>
                  {member.role === 'organizer' ? (
                    <span className="role-tag">organizer</span>
                  ) : (
                    <>
                      <label>
                        <span className="sr-only">Role for {member.displayName}</span>
                        <select
                          value={member.role}
                          disabled={working}
                          onChange={(event) =>
                            void perform({
                              type: 'setMemberRole',
                              commandId: newCommandId(),
                              uid: member.uid,
                              role: event.target.value as 'captain' | 'trader' | 'member',
                              status: member.status,
                            })
                          }
                        >
                          <option value="captain">Captain</option>
                          <option value="trader">Trader</option>
                          <option value="member">Member</option>
                        </select>
                      </label>
                      <button
                        className="button small secondary"
                        disabled={working}
                        onClick={() =>
                          void perform({
                            type: 'setMemberRole',
                            commandId: newCommandId(),
                            uid: member.uid,
                            role: member.role,
                            status: member.status === 'suspended' ? 'approved' : 'suspended',
                          })
                        }
                      >
                        {member.status === 'suspended' ? 'Restore access' : 'Suspend'}
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>
          <section className="content-section">
            <h2>Project eligibility</h2>
            <p className="fine-print">
              Changing eligibility halts its market. Disqualified or withdrawn projects receive zero
              final share value.
            </p>
            {data.market.entries.map((entry) => (
              <div className="data-row" key={entry.team.id}>
                <TeamMark team={entry.team} />
                <div className="row-title">
                  {entry.team.name}
                  <small>{entry.team.eligibility}</small>
                </div>
                <button
                  className="button small secondary"
                  onClick={() => {
                    setHaltTeam(entry.team);
                    setEligibility(entry.team.eligibility === 'active' ? 'withdrawn' : 'active');
                  }}
                >
                  Manage
                </button>
              </div>
            ))}
          </section>
        </>
      )}
      {tab === 'results' && (
        <>
          <div className="standings-explainer">
            <h2>Independent judging scores</h2>
            <p>
              Enter the judges’ aggregate scores from 0 to 100. Rankings set final share values from{' '}
              {RULES.firstPlaceMinor / 100} credits for first place to {RULES.lastPlaceMinor / 100}{' '}
              for last place; tied ranks share the average value. Review before locking the scores.
            </p>
          </div>
          {event.phase === 'FROZEN' ? (
            <>
              <div className="score-grid">
                {data.market.entries
                  .filter((entry) => entry.team.eligibility === 'active')
                  .map((entry) => (
                    <label className="score-row" key={entry.team.id}>
                      <TeamMark team={entry.team} />
                      <span>{entry.team.name}</span>
                      <input
                        aria-label={`Score for ${entry.team.name}`}
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        placeholder="0–100"
                        value={scores[entry.team.id] || ''}
                        onChange={(event) =>
                          setScores((current) => ({
                            ...current,
                            [entry.team.id]: event.target.value,
                          }))
                        }
                      />
                    </label>
                  ))}
              </div>
              <button className="button primary" disabled={working} onClick={previewResults}>
                Preview final share values
                <ArrowRight size={16} />
              </button>
            </>
          ) : event.publishedResultId ? (
            <div className="notice-inline">
              <Check size={18} />
              Results are published. Participants can view the final standings.
            </div>
          ) : (
            <div className="notice-inline">
              {event.phase === 'FINALIZING'
                ? 'Scores are locked. Continue settlement in Event controls, then publish the results.'
                : 'Close all trading and start judging before entering final scores.'}
            </div>
          )}
        </>
      )}
      {tab === 'activity' && (
        <>
          {data.audit.length ? (
            <div className="audit-list">
              {[...data.audit]
                .sort((a, b) => b.createdAt - a.createdAt)
                .map((item) => (
                  <article key={item.id}>
                    <div>
                      <strong>{item.action}</strong>
                      <time>{date(item.createdAt)}</time>
                    </div>
                    <p>{item.detail}</p>
                    <small>
                      Actor{' '}
                      {data.members.find((member) => member.uid === item.actorUid)?.displayName ||
                        item.actorUid}{' '}
                      · {item.id}
                    </small>
                  </article>
                ))}
            </div>
          ) : (
            <Empty title="No organizer activity yet.">
              Phase changes, approvals, and administrative actions appear here.
            </Empty>
          )}
        </>
      )}
      {transition && (
        <Dialog
          title={transitionLabels[transition] || phaseNames[transition]}
          onClose={() => setTransition(null)}
        >
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {event.phaseVersion !== reviewVersion && (
            <p className="form-error" role="alert">
              The event phase changed. Close this review and open a new one.
            </p>
          )}
          <p>
            Move from <strong>{phaseNames[event.phase]}</strong> to{' '}
            <strong>{phaseNames[transition]}</strong>.
          </p>
          {['SEED_OPEN', 'TRADING_OPEN'].includes(transition) && (
            <Field label="Window duration in minutes">
              <input
                type="number"
                min="1"
                max="240"
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
              />
            </Field>
          )}
          <p className="notice-inline">
            {transition === 'SEED_SETTLING'
              ? 'Commitments will lock. A resumable allocation operation will distribute shares and return unused credits.'
              : transition === 'CANCELLED'
                ? 'This ends the event. Participants will no longer be able to trade. This cannot be undone.'
                : transition === 'FROZEN'
                  ? 'Trading ends permanently. Wallets and holdings freeze for judging.'
                  : transition === 'INTERMISSION'
                    ? 'Completed trades remain. New trade requests are rejected until the next window opens.'
                    : 'The updated phase will apply to every participant immediately.'}
          </p>
          <div className="dialog-actions">
            <button className="button secondary" onClick={() => setTransition(null)}>
              Go back
            </button>
            <button
              className={`button ${transition === 'CANCELLED' ? 'danger' : 'primary'}`}
              disabled={
                working ||
                event.phaseVersion !== reviewVersion ||
                (['SEED_OPEN', 'TRADING_OPEN'].includes(transition) &&
                  (!Number.isInteger(Number(duration)) ||
                    Number(duration) < 1 ||
                    Number(duration) > 240))
              }
              onClick={async () => {
                const ok = await perform({
                  type: 'transitionEvent',
                  commandId: newCommandId(),
                  target: transition,
                  expectedPhaseVersion: reviewVersion,
                  ...(['SEED_OPEN', 'TRADING_OPEN'].includes(transition)
                    ? { durationMinutes: Number(duration) }
                    : {}),
                });
                if (ok) setTransition(null);
              }}
            >
              {working ? 'Applying…' : 'Confirm change'}
            </button>
          </div>
        </Dialog>
      )}
      {preview && (
        <Dialog title="Review final share values" onClose={() => setPreview(null)} wide>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <p className="muted">
            Locking scores starts final settlement. Scores cannot be edited afterward.
          </p>
          <div className="result-preview">
            {preview.map((item) => (
              <div key={item.issuerId}>
                <span>
                  #{item.rank}{' '}
                  {data.market.entries.find((entry) => entry.team.id === item.issuerId)?.team.name}
                </span>
                <strong>{credits(item.priceMinor)} cr</strong>
              </div>
            ))}
          </div>
          <div className="dialog-actions">
            <button className="button secondary" onClick={() => setPreview(null)}>
              Edit scores
            </button>
            <button
              className="button primary"
              disabled={working}
              onClick={async () => {
                if (
                  await perform({
                    type: 'prepareResults',
                    commandId: newCommandId(),
                    scores: Object.fromEntries(preview.map((item) => [item.issuerId, item.score])),
                  })
                ) {
                  setPreview(null);
                  setTab('event');
                }
              }}
            >
              Lock scores & settle
            </button>
          </div>
        </Dialog>
      )}
      {publish && (
        <Dialog title="Publish final results?" onClose={() => setPublish(false)}>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {event.phaseVersion !== reviewVersion && (
            <p className="form-error" role="alert">
              The event phase changed. Close this review and open a new one.
            </p>
          )}
          <p>
            Settlement is ready. Publishing makes the final project and investing-team standings
            visible to everyone.
          </p>
          <p className="notice-inline">The final standings cannot be changed after publication.</p>
          <button
            className="button primary full"
            disabled={working || event.phaseVersion !== reviewVersion}
            onClick={async () => {
              if (
                await perform({
                  type: 'publishResults',
                  commandId: newCommandId(),
                  expectedPhaseVersion: reviewVersion,
                })
              )
                setPublish(false);
            }}
          >
            Publish final results
          </button>
        </Dialog>
      )}
      {haltTeam && (
        <Dialog title={`Manage ${haltTeam.name}`} onClose={() => setHaltTeam(null)}>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <Field label="Project eligibility">
            <select
              value={eligibility}
              onChange={(event) => setEligibility(event.target.value as Team['eligibility'])}
            >
              <option value="active">Active</option>
              <option value="withdrawn">Withdrawn</option>
              <option value="disqualified">Disqualified</option>
            </select>
          </Field>
          <Field label="Reason (required)">
            <textarea
              required
              value={haltReason}
              rows={3}
              maxLength={200}
              onChange={(event) => setHaltReason(event.target.value)}
            />
          </Field>
          <p className="notice-inline">
            <ShieldAlert size={18} />
            Eligibility changes affect trading and final share values. This action is audited.
          </p>
          <button
            className="button primary full"
            disabled={working || haltReason.trim().length < 3}
            onClick={async () => {
              if (
                await perform({
                  type: 'haltIssuer',
                  commandId: newCommandId(),
                  issuerId: haltTeam.id,
                  eligibility,
                  reason: haltReason,
                })
              ) {
                setHaltTeam(null);
                setHaltReason('');
              }
            }}
          >
            Confirm eligibility change
          </button>
        </Dialog>
      )}
    </>
  );
}
function AccessApproval({
  request,
  data,
  disabled,
  approve,
}: {
  request: AppSnapshot['requests'][number];
  data: AppSnapshot;
  disabled: boolean;
  approve: (command: Command) => Promise<boolean>;
}) {
  const [teamId, setTeamId] = useState(request.teamId || '');
  const [role, setRole] = useState<'captain' | 'member' | 'trader'>(
    request.teamId ? 'member' : 'captain',
  );
  return (
    <div className="approval-card">
      <div>
        <strong>{request.displayName}</strong>
        <p>
          {request.teamName} · Requested {date(request.requestedAt)}
        </p>
      </div>
      <label>
        <span className="sr-only">Team for {request.displayName}</span>
        <select
          value={teamId}
          onChange={(event) => {
            setTeamId(event.target.value);
            setRole(event.target.value ? 'member' : 'captain');
          }}
        >
          <option value="">Create “{request.teamName}”</option>
          {data.market.entries.map((entry) => (
            <option value={entry.team.id} key={entry.team.id}>
              {entry.team.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="sr-only">Role for {request.displayName}</span>
        <select value={role} onChange={(event) => setRole(event.target.value as typeof role)}>
          <option value="captain">Captain</option>
          <option value="member">Member</option>
          <option value="trader">Trader</option>
        </select>
      </label>
      <button
        className="button primary small"
        disabled={disabled}
        onClick={() =>
          void approve({
            type: 'approveMembership',
            commandId: newCommandId(),
            uid: request.uid,
            role,
            ...(teamId ? { teamId } : {}),
          })
        }
      >
        Approve
        <Check size={15} />
      </button>
    </div>
  );
}
