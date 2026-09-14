import { useState } from 'react';
import { Field } from '../ui/primitives';
import { useClock } from '../hooks/useApp';
import {
  Blank,
  canAllocate,
  config,
  ErrorMessage,
  money,
  navigate,
  Panel,
  percent,
  platform,
  stamp,
  teamName,
  teams,
  useCommand,
  type PageProps,
} from './shared';

export function Results({ data, actions }: PageProps) {
  const state = platform(data);
  const settings = config(data).funding;
  const published = state.awards?.publishedAt ? state.awards : null;
  const rounds = state.rounds.filter((round) => round.state !== 'open');
  return (
    <>
      <div className="p-page-heading">
        <h1>Results</h1>
        <span className="muted">Completed rounds and final awards</span>
      </div>
      {published ? (
        <>
          <Panel title="Judges’ results">
            <p>
              <strong>{teamName(data, published.winnerId)}</strong> wins the judges’ grand prize.
            </p>
            {published.tiebreakReason && <p>Tiebreak: {published.tiebreakReason}</p>}
            <div className="p-table-wrap">
              <table className="p-table">
                <thead>
                  <tr>
                    <th>Place</th>
                    <th>Project</th>
                    <th>Judge score</th>
                    {published.settings.builderPrizesMinor.some((amount) => amount > 0) && (
                      <th>Builder prize</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {published.projects.map((project) => (
                    <tr key={project.teamId}>
                      <td>{project.rank}</td>
                      <td>
                        <button
                          className="p-link"
                          onClick={() => navigate('projects', project.teamId)}
                        >
                          {teamName(data, project.teamId)}
                        </button>
                      </td>
                      <td>{project.score.toFixed(2)}</td>
                      {published.settings.builderPrizesMinor.some((amount) => amount > 0) && (
                        <td>{money(project.builderPrizeMinor)}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel title="Investor results">
            <p>Rewards are based on locked entitlements in {teamName(data, published.winnerId)}.</p>
            <div className="p-table-wrap">
              <table className="p-table">
                <thead>
                  <tr>
                    <th>Team</th>
                    <th>Winning entitlement</th>
                    {published.settings.investorPoolMinor > 0 && <th>Reward</th>}
                  </tr>
                </thead>
                <tbody>
                  {published.investors.map((investor) => (
                    <tr key={investor.teamId}>
                      <td>{teamName(data, investor.teamId)}</td>
                      <td>
                        {investor.entitlementPercent.toLocaleString(undefined, {
                          maximumFractionDigits: 3,
                        })}
                        %
                      </td>
                      {published.settings.investorPoolMinor > 0 && (
                        <td>{money(investor.rewardMinor)}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {published.settings.investorPoolMinor > 0 ? (
              <p className="muted">
                Total rewards: {money(published.investorPaidMinor)}. Reserve:{' '}
                {money(published.reserveMinor)}. {published.settings.reservePolicy}
              </p>
            ) : (
              <p className="muted">No cash investor prize was configured.</p>
            )}
          </Panel>
          {published.communityWinnerId && (
            <Panel title="Community award">
              <h3>{teamName(data, published.communityWinnerId)}</h3>
              <p>
                Selected by private team ballots for demos and communication.
                {published.settings.communityPrizeMinor > 0
                  ? ` Prize: ${money(published.settings.communityPrizeMinor)}.`
                  : ''}
              </p>
            </Panel>
          )}
        </>
      ) : (
        <Panel title="Final awards">
          <p>
            Final awards will appear after independent judging and the results review period.
            Funding totals do not determine the winner.
          </p>
        </Panel>
      )}
      {data.member?.teamId && <CommunityBallot data={data} actions={actions} />}
      <Panel title="Completed funding rounds">
        {!rounds.length && (
          <Blank>
            Current-round totals are private. Results appear after the organizer closes a round.
          </Blank>
        )}
        {rounds.map((round) => (
          <section className="p-entitlement" key={round.id}>
            <div className="p-section-heading">
              <h3>
                {round.number}. {round.name}
              </h3>
              <span>{percent(round.weightBps / 10000)} reward weight</span>
            </div>
            {round.state === 'void' ? (
              <p className="p-note">
                Voided: {round.voidReason}. This round awards no entitlement.
              </p>
            ) : (
              <>
                <p className="muted">
                  Closed {stamp(round.closedAt)}. These are project totals, not individual team
                  allocations.
                </p>
                <div className="p-table-wrap">
                  <table className="p-table">
                    <thead>
                      <tr>
                        <th>Project</th>
                        <th>Credits received</th>
                      </tr>
                    </thead>
                    <tbody>
                      {round.eligibleTeamIds.map((id) => (
                        <tr key={id}>
                          <td>
                            <button className="p-link" onClick={() => navigate('projects', id)}>
                              {teamName(data, id)}
                            </button>
                          </td>
                          <td>{round.totals[id] || 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        ))}
      </Panel>
      <p className="muted">{settings.reservePolicy}</p>
    </>
  );
}
function CommunityBallot({ data, actions }: PageProps) {
  const ballot = platform(data).ballot;
  const [ranked, setRanked] = useState<string[]>(ballot?.rankedProjectIds || ['', '', '']);
  const [version, setVersion] = useState(ballot?.version || 0);
  const [saved, setSaved] = useState(!!ballot);
  const cmd = useCommand(actions);
  const now = useClock();
  const open =
    config(data).ballotOpen &&
    !!config(data).ballotClosesAt &&
    now < config(data).ballotClosesAt! &&
    !data.event!.paused;
  const available = teams(data).filter(
    (t) =>
      t.id !== data.member?.teamId &&
      t.eligibility === 'active' &&
      platform(data).submissions.some((s) => s.teamId === t.id),
  );
  const count = Math.min(3, available.length);
  const complete =
    ranked.slice(0, count).every(Boolean) && new Set(ranked.slice(0, count)).size === count;
  return (
    <Panel title="Community ballot">
      <p>
        Rank {count || 3} other teams for the quality of their demo and communication. One private
        ballot per team; your own project is excluded. This vote does not affect investor rewards.
      </p>
      {open ? (
        <p className="muted">
          Editable until {stamp(config(data).ballotClosesAt, config(data).details.timeZone)}.
        </p>
      ) : (
        <p className="p-note">
          The ballot is {ballot ? 'closed; your saved choices are shown below' : 'not open'}.
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void cmd.run(
            {
              type: 'saveBallot',
              rankedProjectIds: ranked.slice(0, count),
              expectedVersion: version,
            },
            () => {
              setVersion(version + 1);
              setSaved(true);
            },
          );
        }}
      >
        <div className="p-form-grid">
          {Array.from({ length: count }, (_, index) => (
            <Field
              label={`${index + 1}${index === 0 ? 'st' : index === 1 ? 'nd' : 'rd'} choice`}
              key={index}
            >
              <select
                required
                disabled={!open || !canAllocate(data) || cmd.pending}
                value={ranked[index] || ''}
                onChange={(event) => {
                  const next = [...ranked];
                  next[index] = event.target.value;
                  setRanked(next);
                  setSaved(false);
                }}
              >
                <option value="">Choose a team</option>
                {available.map((team) => (
                  <option
                    key={team.id}
                    value={team.id}
                    disabled={ranked.some((id, i) => i !== index && id === team.id)}
                  >
                    {team.name}
                  </option>
                ))}
              </select>
            </Field>
          ))}
        </div>
        <ErrorMessage>{cmd.error}</ErrorMessage>
        <div className="p-actions">
          <button
            className="button primary"
            disabled={!open || !canAllocate(data) || !complete || !count || cmd.pending}
          >
            Save ballot
          </button>
          {saved && <span role="status">Ballot saved.</span>}
        </div>
      </form>
    </Panel>
  );
}
