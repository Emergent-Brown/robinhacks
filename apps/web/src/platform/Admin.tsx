import { useState } from 'react';
import { Dialog, Field } from '../ui/primitives';
import { useClock } from '../hooks/useApp';
import { WindowOpener } from './WindowOpener';
import { AdminSettings } from './AdminSettings';
import { AdminMembers } from './AdminMembers';
import { AdminTeams } from './AdminTeams';
import { OrganizerNoteEditor } from './OrganizerNote';
import { AdminJudging } from './AdminJudging';
import { AdminPosters } from './AdminPosters';
import {
  Blank,
  config,
  ErrorMessage,
  money,
  navigate,
  Panel,
  platform,
  stamp,
  teamName,
  useCommand,
  type CommandInput,
  type PageProps,
} from './shared';

type Tab = 'operations' | 'access' | 'teams' | 'judging' | 'settings' | 'reports' | 'posters';
export function Admin({ data, actions }: PageProps) {
  const [tab, setTab] = useState<Tab>('operations');
  const [exportError, setExportError] = useState('');
  async function download() {
    try {
      const exported = await actions.gateway.exportEvent();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `emergenthacks-${data.event!.id}-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Export failed.');
    }
  }
  return (
    <>
      <div className="p-page-heading">
        <h1>Admin</h1>
        <div className="p-actions">
          <button className="p-link" onClick={() => navigate('messages')}>
            Review conversations
          </button>
          <button className="p-link" onClick={() => void download()}>
            Export event record
          </button>
        </div>
      </div>
      <nav className="p-tabs" aria-label="Admin sections">
        {(
          ['operations', 'access', 'teams', 'judging', 'settings', 'reports', 'posters'] as const
        ).map((item) => (
          <button
            key={item}
            aria-current={tab === item ? 'page' : undefined}
            onClick={() => setTab(item)}
          >
            {item === 'operations'
              ? 'Event controls'
              : item === 'access'
                ? 'People'
                : item === 'teams'
                  ? 'Teams'
                  : item === 'judging'
                    ? 'Judging'
                    : item === 'settings'
                      ? 'Settings'
                      : item === 'posters'
                        ? 'Posters'
                        : 'Reports'}
          </button>
        ))}
      </nav>
      <ErrorMessage>{exportError}</ErrorMessage>
      {tab === 'operations' ? (
        <Operations data={data} actions={actions} />
      ) : tab === 'access' ? (
        <AdminMembers data={data} actions={actions} />
      ) : tab === 'teams' ? (
        <AdminTeams data={data} actions={actions} />
      ) : tab === 'judging' ? (
        <AdminJudging data={data} actions={actions} />
      ) : tab === 'settings' ? (
        <AdminSettings data={data} actions={actions} />
      ) : tab === 'posters' ? (
        <AdminPosters data={data} actions={actions} />
      ) : (
        <>
          <Panel title="Reported messages">
            {!platform(data).reports.length ? (
              <Blank>No messages have been reported.</Blank>
            ) : (
              platform(data).reports.map((report) => (
                <article className="p-entitlement" key={report.id}>
                  <p>
                    <strong>{stamp(report.createdAt)}</strong> · Reporter:{' '}
                    {data.members.find((member) => member.uid === report.reporterUid)
                      ?.displayName || 'Participant'}
                  </p>
                  <blockquote>{report.body}</blockquote>
                  <p>
                    <strong>Reason:</strong> {report.reason}
                  </p>
                </article>
              ))
            )}
          </Panel>
          <Panel title="Audit log">
            <div className="p-table-wrap">
              <table className="p-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Action</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {data.audit.map((item) => (
                    <tr key={item.id}>
                      <td>{stamp(item.createdAt)}</td>
                      <td>{item.action}</td>
                      <td>{item.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </>
  );
}

function Operations({ data, actions }: PageProps) {
  const event = data.event!;
  const state = platform(data);
  const settings = config(data);
  const active = state.rounds.find((round) => round.state === 'open');
  const now = useClock();
  const [pauseReason, setPauseReason] = useState('');
  const [voidReason, setVoidReason] = useState('');
  const [winnerId, setWinnerId] = useState('');
  const [tiebreak, setTiebreak] = useState('');
  const [discardReason, setDiscardReason] = useState('');
  const [confirm, setConfirm] = useState<{
    title: string;
    copy: string;
    command: CommandInput;
  } | null>(null);
  const cmd = useCommand(actions);
  const terminal = ['FINALIZED', 'CANCELLED', 'ARCHIVED'].includes(event.phase);
  const awards = state.awards;
  const phaseVersion = { expectedPhaseVersion: event.phaseVersion };
  function review(title: string, copy: string, command: CommandInput) {
    setConfirm({ title, copy, command });
  }
  return (
    <>
      <OrganizerNoteEditor data={data} actions={actions} />
      <Panel title="Event status">
        <dl className="p-facts">
          <dt>Phase</dt>
          <dd>
            {['TRADING_OPEN', 'SEED_OPEN'].includes(event.phase)
              ? 'Funding open'
              : event.phase === 'FROZEN'
                ? 'Judging'
                : event.phase === 'FINALIZING'
                  ? 'Results review'
                  : event.phase.toLowerCase().replaceAll('_', ' ')}
          </dd>
          <dt>Round</dt>
          <dd>
            {settings.currentRound} of {settings.funding.roundNames.length}
          </dd>
          <dt>Pause</dt>
          <dd>{event.paused ? event.pauseReason : 'Not paused'}</dd>
        </dl>
        <form
          className="p-inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            review(
              event.paused ? 'Resume event' : 'Pause event',
              event.paused
                ? 'Resume activity and extend affected live deadlines by the paused duration?'
                : 'Pause allocations and other event changes for everyone? Remaining time will be preserved.',
              { type: 'setPause', paused: !event.paused, reason: pauseReason, ...phaseVersion },
            );
          }}
        >
          {!event.paused && (
            <Field label="Pause reason">
              <input
                required
                minLength={5}
                maxLength={300}
                value={pauseReason}
                onChange={(e) => setPauseReason(e.target.value)}
              />
            </Field>
          )}
          <button className="button secondary" disabled={terminal || cmd.pending}>
            {event.paused ? 'Resume event' : 'Pause event'}
          </button>
        </form>
      </Panel>
      <Panel title="Funding rounds">
        {active ? (
          <>
            <p>
              <strong>{active.name}</strong> · deadline{' '}
              {stamp(active.closesAt, settings.details.timeZone)}
            </p>
            <p>
              Close locks allocations and reveals project totals. A closed round cannot be reopened.
            </p>
            <button
              className="button primary"
              disabled={cmd.pending || event.paused || now < active.closesAt}
              onClick={() =>
                review('Close funding round', 'Lock this round and reveal project totals?', {
                  type: 'closeFundingRound',
                  roundId: active.id,
                  ...phaseVersion,
                })
              }
            >
              {now < active.closesAt ? 'Available at the deadline' : 'Close round'}
            </button>
          </>
        ) : (
          <>
            <p>
              {settings.currentRound >= settings.funding.roundNames.length
                ? 'All three funding rounds have been opened.'
                : `Next: ${settings.funding.roundNames[settings.currentRound]}. Publish project updates before opening.`}
            </p>
            {settings.teamFormationOpen && (
              <p className="p-note">
                Team selection is open. Close it in Admin → People before opening funding.
              </p>
            )}
            <WindowOpener
              key={settings.currentRound}
              plan={settings.details.timing?.rounds[settings.currentRound]}
              zone={settings.details.timeZone}
              now={now}
              label="Open next round"
              fallbackMinutes={30}
              maxMinutes={1440}
              disabled={
                terminal ||
                event.paused ||
                !!settings.teamFormationOpen ||
                settings.currentRound >= settings.funding.roundNames.length ||
                cmd.pending
              }
              onOpen={(window) =>
                review(
                  'Open funding round',
                  `Open ${settings.funding.roundNames[settings.currentRound]} until ${stamp(window.closesAt, settings.details.timeZone)}? ${settings.currentRound === 0 ? 'This locks the roster, funding settings, and judging rubric.' : ''}`,
                  { type: 'openFundingRound', ...window, ...phaseVersion },
                )
              }
            />
          </>
        )}
        {state.rounds.some((round) => round.state === 'closed') && (
          <details className="p-danger">
            <summary>Void a round after a technical incident</summary>
            <p>
              A voided round awards no entitlements and cannot be replayed. This is for an
              event-wide technical failure.
            </p>
            <Field label="Reason">
              <textarea
                minLength={10}
                maxLength={500}
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
              />
            </Field>
            <div className="p-actions">
              {state.rounds
                .filter((round) => round.state === 'closed')
                .map((round) => (
                  <button
                    className="button secondary"
                    key={round.id}
                    disabled={terminal || voidReason.trim().length < 10 || cmd.pending}
                    onClick={() =>
                      review(
                        `Void ${round.name}`,
                        `Permanently void this round and its entitlements? Reason: ${voidReason}`,
                        {
                          type: 'voidFundingRound',
                          roundId: round.id,
                          reason: voidReason,
                          ...phaseVersion,
                        },
                      )
                    }
                  >
                    Void round {round.number}
                  </button>
                ))}
            </div>
          </details>
        )}
      </Panel>
      <div className="p-two-column">
        <Panel title="Final submissions">
          <p>
            {settings.submissionsOpen
              ? `Open until ${stamp(settings.submissionClosesAt, settings.details.timeZone)}`
              : 'Closed'}{' '}
            · {state.submissions.length} submitted projects
          </p>
          {settings.submissionsOpen ? (
            <button
              className="button secondary"
              disabled={terminal || event.paused || cmd.pending}
              onClick={() =>
                review('Close submissions', 'Close the final submission window for all teams?', {
                  type: 'setSubmissionWindow',
                  open: false,
                  closesAt: null,
                  ...phaseVersion,
                })
              }
            >
              Close submissions
            </button>
          ) : (
            <WindowOpener
              plan={settings.details.timing?.submissions}
              zone={settings.details.timeZone}
              now={now}
              label="Open submissions"
              fallbackMinutes={60}
              maxMinutes={1440}
              disabled={
                terminal ||
                event.paused ||
                cmd.pending ||
                settings.currentRound >= 3 ||
                event.phase === 'FROZEN'
              }
              onOpen={({ closesAt }) =>
                review(
                  'Open submissions',
                  `Accept final submissions until ${stamp(closesAt, settings.details.timeZone)}?`,
                  { type: 'setSubmissionWindow', open: true, closesAt, ...phaseVersion },
                )
              }
            />
          )}
        </Panel>
        <Panel title="Community ballot">
          <p>
            {settings.ballotOpen
              ? `Open until ${stamp(settings.ballotClosesAt, settings.details.timeZone)}`
              : 'Closed'}
            . Ballot results stay private until awards.
          </p>
          {settings.ballotOpen ? (
            <button
              className="button secondary"
              disabled={terminal || event.paused || cmd.pending}
              onClick={() =>
                review('Close ballots', 'Lock all community ballots?', {
                  type: 'setBallotWindow',
                  open: false,
                  closesAt: null,
                  ...phaseVersion,
                })
              }
            >
              Close ballots
            </button>
          ) : (
            <WindowOpener
              plan={settings.details.timing?.ballot}
              zone={settings.details.timeZone}
              now={now}
              label="Open ballots"
              fallbackMinutes={20}
              maxMinutes={240}
              disabled={terminal || event.paused || cmd.pending || event.phase !== 'FROZEN'}
              onOpen={({ closesAt }) =>
                review(
                  'Open ballots',
                  `Accept private team ballots until ${stamp(closesAt, settings.details.timeZone)}?`,
                  { type: 'setBallotWindow', open: true, closesAt, ...phaseVersion },
                )
              }
            />
          )}
        </Panel>
      </div>
      <Panel title="Judging and awards">
        <p>
          Finish funding and close submissions before judging starts. Assign judges in the Judging
          tab. Every eligible submission needs a completed, non-conflicted score.
        </p>
        <button
          className="button secondary"
          disabled={
            terminal ||
            event.paused ||
            cmd.pending ||
            !!active ||
            settings.currentRound !== 3 ||
            event.phase !== 'INTERMISSION'
          }
          onClick={() =>
            review('Begin judging', 'Freeze the final submissions and begin independent judging?', {
              type: 'beginJudging',
              ...phaseVersion,
            })
          }
        >
          Begin judging
        </button>
        {!awards && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              review(
                'Prepare award review',
                'Calculate results from submitted judging sheets and frozen funding entitlements? Nothing will be published yet.',
                { type: 'prepareAwards', winnerId, tiebreakReason: tiebreak, ...phaseVersion },
              );
            }}
          >
            <Field label="Tiebreak winner (only if top scores tie)">
              <select value={winnerId} onChange={(e) => setWinnerId(e.target.value)}>
                <option value="">Use the highest judge score</option>
                {state.submissions.map((project) => (
                  <option value={project.teamId} key={project.teamId}>
                    {project.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Tiebreak explanation">
              <textarea
                maxLength={1000}
                value={tiebreak}
                onChange={(e) => setTiebreak(e.target.value)}
              />
            </Field>
            <button
              className="button primary"
              disabled={event.phase !== 'FROZEN' || event.paused || cmd.pending}
            >
              Prepare awards
            </button>
          </form>
        )}
        {awards && (
          <>
            <div className="p-note">
              <strong>{awards.publishedAt ? 'Published awards' : 'Private award review'}</strong>
              <p>
                Winner: {teamName(data, awards.winnerId)}.{' '}
                {awards.tiebreakReason && `Tiebreak: ${awards.tiebreakReason}`}
              </p>
              <p>Earliest publication: {stamp(awards.publishAfter, settings.details.timeZone)}.</p>
            </div>
            <div className="p-table-wrap">
              <table className="p-table">
                <thead>
                  <tr>
                    <th>Place</th>
                    <th>Project</th>
                    <th>Score</th>
                    <th>Judges</th>
                    <th>Builder prize</th>
                  </tr>
                </thead>
                <tbody>
                  {awards.projects.map((project) => (
                    <tr key={project.teamId}>
                      <td>{project.rank}</td>
                      <td>{teamName(data, project.teamId)}</td>
                      <td>{project.score.toFixed(2)}</td>
                      <td>{project.judgeCount}</td>
                      <td>{money(project.builderPrizeMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              Investor payouts: {money(awards.investorPaidMinor)} · Reserve:{' '}
              {money(awards.reserveMinor)}.
            </p>
            <p>
              Community winner:{' '}
              {awards.communityWinnerId ? teamName(data, awards.communityWinnerId) : 'None'}.
            </p>
            {!awards.publishedAt && (
              <>
                <button
                  className="button primary"
                  disabled={now < awards.publishAfter || event.paused || cmd.pending}
                  onClick={() =>
                    review(
                      'Publish final awards',
                      'Publish these reviewed results to every participant? Published awards are final.',
                      { type: 'publishAwards', ...phaseVersion },
                    )
                  }
                >
                  {now < awards.publishAfter
                    ? `Review period · ${Math.ceil((awards.publishAfter - now) / 60000)} min remaining`
                    : 'Publish awards'}
                </button>
                <details className="p-danger">
                  <summary>Discard this review</summary>
                  <Field label="Reason for discarding">
                    <textarea
                      minLength={10}
                      maxLength={1000}
                      value={discardReason}
                      onChange={(e) => setDiscardReason(e.target.value)}
                    />
                  </Field>
                  <button
                    className="button secondary"
                    disabled={discardReason.trim().length < 10 || cmd.pending}
                    onClick={() =>
                      review(
                        'Discard award review',
                        `Return to judging without publishing these results? Reason: ${discardReason}`,
                        { type: 'discardAwards', reason: discardReason, ...phaseVersion },
                      )
                    }
                  >
                    Discard review
                  </button>
                </details>
              </>
            )}
          </>
        )}
      </Panel>
      <details className="p-danger">
        <summary>Cancel event</summary>
        <p>Stops all participation and cancels the event without publishing awards.</p>
        <button
          className="button secondary"
          disabled={terminal || cmd.pending}
          onClick={() =>
            review(
              'Cancel this event',
              'Cancel this event for everyone? This cannot be undone through the app.',
              { type: 'transitionEvent', target: 'CANCELLED', ...phaseVersion },
            )
          }
        >
          Cancel event
        </button>
      </details>
      <ErrorMessage>{cmd.error}</ErrorMessage>
      {confirm && (
        <Dialog title={confirm.title} onClose={() => setConfirm(null)}>
          <p>{confirm.copy}</p>
          <ErrorMessage>{cmd.error}</ErrorMessage>
          <div className="p-actions">
            <button
              className="button primary"
              disabled={cmd.pending}
              onClick={() => void cmd.run(confirm.command, () => setConfirm(null))}
            >
              Confirm
            </button>
            <button className="button secondary" onClick={() => setConfirm(null)}>
              Keep current state
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
