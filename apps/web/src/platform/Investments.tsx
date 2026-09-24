import { useEffect, useRef, useState } from 'react';
import { EventSchedule, type RoundEntitlement } from '@robinhacks/core';
import './investments.css';
import { useClock } from '../hooks/useApp';
import { newCommandId } from '../app/gateway';
import {
  Amount,
  Blank,
  canAllocate,
  config,
  ErrorMessage,
  money,
  navigate,
  Panel,
  percent,
  platform,
  ProjectLink,
  stamp,
  teamName,
  teams,
  type PageProps,
} from './shared';

export function Investments({ data, actions }: PageProps) {
  const state = platform(data);
  const settings = config(data).funding;
  const now = useClock();
  const active = state.rounds.find((round) => round.state === 'open');
  const [selectedNumber, setSelectedNumber] = useState(
    active?.number || config(data).currentRound || 1,
  );
  const [draftStatus, setDraftStatus] = useState<AllocationStatus>('saved');
  const selected = state.rounds.find((round) => round.number === selectedNumber);
  const entitlement = state.entitlements.find((entry) => entry.roundNumber === selectedNumber);
  const selectedTitle = `Round ${selectedNumber} · ${settings.roundNames[selectedNumber - 1]}`;

  return (
    <>
      <div className="p-page-heading">
        <h1>Investments</h1>
        <button className="p-link" onClick={() => navigate('rules')}>
          Funding rules
        </button>
      </div>
      <ol className="p-investment-rounds" aria-label="Choose an investment round">
        {settings.roundNames.map((name, index) => {
          const number = index + 1;
          const round = state.rounds.find((item) => item.number === number);
          const planned = config(data).details.timing?.rounds[index];
          const status = !round
            ? 'Upcoming'
            : round.state === 'open'
              ? now >= round.closesAt
                ? 'Locked · awaiting reveal'
                : 'Open now'
              : round.state === 'void'
                ? 'Voided'
                : 'Complete';
          return (
            <li key={number}>
              <button
                className="p-investment-round"
                aria-pressed={selectedNumber === number}
                onClick={() => setSelectedNumber(number)}
              >
                <span className="p-investment-round-top">
                  <span className="p-investment-round-number">Round {number}</span>
                  <span className="p-investment-round-status">{status}</span>
                </span>
                <strong>{name}</strong>
                <span className="p-investment-round-weight">
                  {percent(settings.roundWeightsBps[index]! / 10000)} of the investor prize pool
                </span>
                {(round || planned) && (
                  <span className="p-investment-round-time">
                    {round
                      ? EventSchedule.label(
                          { startsAt: round.openedAt, closesAt: round.closesAt },
                          config(data).details.timeZone,
                        )
                      : EventSchedule.label(planned!, config(data).details.timeZone)}
                  </span>
                )}
                {round?.id === active?.id && active && draftStatus !== 'saved' && (
                  <span className="p-investment-round-draft" role="status">
                    {draftStatus === 'saving' ? 'Saving allocation…' : 'Unsaved changes'}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
      {data.member?.teamId ? (
        <>
          {/* Keep the live editor mounted: browsing another round must not discard a draft
              or interrupt autosave. Historical and upcoming views never contain inputs. */}
          {active && (
            <div hidden={selectedNumber !== active.number}>
              <AllocationSheet
                key={active.id}
                data={data}
                actions={actions}
                onStatusChange={setDraftStatus}
              />
            </div>
          )}
          {active && selectedNumber !== active.number && draftStatus === 'unsaved' && (
            <p className="p-note" role="status">
              Round {active.number} has unsaved changes.{' '}
              <button className="p-link" onClick={() => setSelectedNumber(active.number)}>
                Return to your allocation
              </button>
            </p>
          )}
          {selected?.state !== 'open' && (
            <Panel title={selectedTitle}>
              {!selected ? (
                <>
                  <p>This round has not opened yet.</p>
                  <p className="muted">
                    Your team will receive {settings.budget} fresh credits when the organizer opens
                    the round. You can make your investments then.
                  </p>
                </>
              ) : entitlement ? (
                <LockedEntitlement data={data} entitlement={entitlement} />
              ) : (
                <Blank>
                  {selected.state === 'void'
                    ? 'This round was voided. It awards no share of the investor prize pool.'
                    : 'Your team has no investments recorded for this round.'}
                </Blank>
              )}
            </Panel>
          )}
        </>
      ) : (
        <Panel title={selectedTitle}>
          <p>Investments belong to participating teams. Your staff account has no allocation.</p>
        </Panel>
      )}
    </>
  );
}

function LockedEntitlement({
  data,
  entitlement,
}: {
  data: PageProps['data'];
  entitlement: RoundEntitlement;
}) {
  const settings = config(data).funding;
  if (entitlement.voided)
    return <p>This round was voided. It awards no share of the investor prize pool.</p>;
  return (
    <>
      <p>
        If the team you invested in wins, your team receives this share of the investor prize pool.
      </p>
      <p className="muted">
        Only the judges’ grand-prize winner pays out. These investments are private to your team.
      </p>
      <p className="p-note">
        {entitlement.spent} credits invested · {entitlement.expired} expired · Allocations locked
      </p>
      {!entitlement.projects.length ? (
        <Blank>Your team did not invest any credits in this round.</Blank>
      ) : (
        <div className="p-table-wrap">
          <table className="p-table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Your credits</th>
                <th>Your share if it wins</th>
                {settings.investorPoolMinor > 0 && <th>Prize if it wins</th>}
              </tr>
            </thead>
            <tbody>
              {entitlement.projects.map((project) => {
                const fraction =
                  ((project.weightBps / 10000) * project.credits) / project.denominator;
                return (
                  <tr key={project.projectId}>
                    <td>
                      <button
                        className="p-link"
                        onClick={() => navigate('projects', project.projectId)}
                      >
                        {teamName(data, project.projectId)}
                      </button>
                    </td>
                    <td>{project.credits}</td>
                    <td>
                      {percent(fraction)}
                      <small className="p-cell-note">
                        {project.credits} ÷ {project.denominator} ×{' '}
                        {percent(project.weightBps / 10000)}
                      </small>
                    </td>
                    {settings.investorPoolMinor > 0 && (
                      <td>
                        {money(Math.floor(fraction * settings.investorPoolMinor))}
                        <small className="p-cell-note">Before final rounding</small>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

type AllocationStatus = 'saved' | 'saving' | 'unsaved';

function AllocationSheet({
  data,
  actions,
  onStatusChange,
}: PageProps & { onStatusChange: (status: AllocationStatus) => void }) {
  const state = platform(data);
  const funding = config(data).funding;
  const active = state.rounds.find((round) => round.state === 'open');
  const now = useClock();
  const saved = state.allocation;
  const [amounts, setAmounts] = useState<Record<string, number>>(saved?.amounts || {});
  const [version, setVersion] = useState(saved?.version || 0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  useEffect(() => {
    onStatusChange(saving ? 'saving' : dirty ? 'unsaved' : 'saved');
  }, [dirty, saving, onStatusChange]);
  const revision = useRef(0);
  const savingRef = useRef(false);
  const seenVersion = useRef(saved?.version || 0);
  const writable =
    !!active &&
    now < active.closesAt &&
    !data.event!.paused &&
    canAllocate(data) &&
    actions.gateway.user?.uid === data.member?.uid &&
    navigator.onLine;
  const flushOnLeave = useRef<() => void>(() => {});
  const listed = teams(data).filter(
    (t) =>
      t.id !== data.member?.teamId &&
      (active ? active.eligibleTeamIds.includes(t.id) : t.eligibility === 'active'),
  );
  const total = Object.values(amounts).reduce((sum, amount) => sum + amount, 0);
  const validation =
    total > funding.budget
      ? `Reduce your allocation by ${total - funding.budget} credits.`
      : Object.values(amounts).some(
            (amount) =>
              !Number.isInteger(amount) ||
              amount < 0 ||
              amount > funding.maxPerProject ||
              amount % funding.increment !== 0,
          )
        ? `Use increments of ${funding.increment}, up to ${funding.maxPerProject} per project.`
        : '';
  useEffect(() => {
    const incoming = saved?.version || 0;
    if (incoming === seenVersion.current || savingRef.current) return;
    seenVersion.current = incoming;
    if (dirty) {
      setConflict(true);
      setError('A teammate changed this allocation. Load their saved version before continuing.');
    } else {
      setAmounts(saved?.amounts || {});
      setVersion(incoming);
    }
  }, [saved?.version, dirty]);
  function change(id: string, value: number) {
    revision.current++;
    setAmounts((current) => ({ ...current, [id]: value }));
    setDirty(true);
    setError('');
  }
  async function save() {
    if (
      !active ||
      !writable ||
      validation ||
      savingRef.current ||
      conflict ||
      actions.gateway.user?.uid !== data.member?.uid
    )
      return;
    const started = revision.current;
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      await actions.execute({
        type: 'saveAllocation',
        commandId: newCommandId(),
        roundId: active.id,
        amounts,
        expectedVersion: version,
      });
      setVersion(version + 1);
      seenVersion.current = version + 1;
      if (revision.current === started) setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Allocation was not saved.');
      setConflict(true);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  useEffect(() => {
    if (!dirty || !writable || validation || conflict || saving) return;
    const timer = setTimeout(() => void save(), 800);
    return () => clearTimeout(timer);
  }, [amounts, dirty, writable, validation, conflict, saving]);
  flushOnLeave.current = () => {
    if (dirty && writable && !validation && !conflict) void save();
  };
  useEffect(() => () => flushOnLeave.current(), []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  async function reload() {
    await actions.refresh();
    const snapshot = await actions.gateway.snapshot(true);
    const next = snapshot.platform?.allocation;
    setAmounts(next?.amounts || {});
    setVersion(next?.version || 0);
    seenVersion.current = next?.version || 0;
    setDirty(false);
    setConflict(false);
    setError('');
  }
  if (!active)
    return (
      <Panel title="Next allocation">
        <p>
          {config(data).currentRound >= funding.roundNames.length
            ? 'All funding rounds are complete.'
            : 'The organizer will open the next funding round.'}
        </p>
        <p>Each round starts with {funding.budget} fresh credits.</p>
      </Panel>
    );
  return (
    <Panel
      title={`Round ${active.number} · ${active.name}`}
      aside={
        <span className="p-status" role="status">
          {saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved'}
        </span>
      }
    >
      <p>
        Invest by {stamp(active.closesAt, config(data).details.timeZone)}. Your captain and
        designated investor share this allocation. Individual investments stay private to your team.
      </p>
      {data.event!.paused && (
        <p className="p-note">
          Funding paused: {data.event!.pauseReason || 'The organizer is resolving an issue.'}
        </p>
      )}
      {now >= active.closesAt && (
        <p className="p-note">
          The deadline has passed. Allocations are locked while the organizer closes the round.
        </p>
      )}
      {!canAllocate(data) && (
        <p className="p-note">Only your captain and designated investor can change allocations.</p>
      )}
      <div className="p-budget">
        <strong>
          {total} / {funding.budget} credits
        </strong>
        <span>{Math.max(0, funding.budget - total)} unallocated</span>
        <meter min="0" max={funding.budget} value={total} aria-label="Round allocation used" />
      </div>
      <div className="p-table-wrap">
        <table className="p-table p-allocation">
          <thead>
            <tr>
              <th>Project</th>
              <th>Credits this round</th>
            </tr>
          </thead>
          <tbody>
            {listed.map((team) => (
              <tr key={team.id}>
                <td>
                  <ProjectLink team={team} />
                  <p>{team.pitch}</p>
                </td>
                <td>
                  <Amount
                    label={team.name}
                    value={amounts[team.id] || 0}
                    max={funding.maxPerProject}
                    step={funding.increment}
                    disabled={!writable || conflict || saving}
                    onChange={(value) => change(team.id, value)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ErrorMessage>{validation || error}</ErrorMessage>
      <div className="p-actions">
        <button
          className="button primary"
          disabled={!writable || saving || !!validation || conflict || !dirty}
          onClick={() => void save()}
        >
          Save allocation
        </button>
        {conflict && (
          <button className="button secondary" onClick={() => void reload()}>
            Load saved allocation
          </button>
        )}
        <span className="muted">Valid changes autosave. Unused credits expire at close.</span>
      </div>
    </Panel>
  );
}
