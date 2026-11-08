import {
  fundingLeaderboard,
  totalFundingLeaderboard,
  type FundingStanding,
} from './funding-leaderboard';
import {
  Blank,
  config,
  money,
  navigate,
  Panel,
  percent,
  platform,
  stamp,
  teamName,
  type PageProps,
} from './shared';

export function Results({ data, actions }: PageProps) {
  const state = platform(data);
  const settings = config(data).funding;
  const published = state.awards?.publishedAt ? state.awards : null;
  const rounds = state.rounds
    .filter((round) => round.state !== 'open')
    .sort((a, b) => a.number - b.number);
  const totals = totalFundingLeaderboard(rounds, (id) => teamName(data, id));
  const blindJudge =
    data.member?.role === 'judge' && !['FINALIZED', 'ARCHIVED'].includes(data.event!.phase);
  return (
    <>
      <div className="p-page-heading">
        <h1>Results</h1>
        <span className="muted">Completed rounds and final awards</span>
      </div>

      <Panel title="Overall funding ranking">
        <p className="muted">
          Credits received in each completed round × that round’s weight, added together. Highest
          weighted total first; equal totals share a place. Funding does not determine the judges’
          winner.
        </p>
        {blindJudge ? (
          <p className="muted">
            Funding totals stay hidden from judges until results are finalized.
          </p>
        ) : totals.length ? (
          <FundingTable rows={totals} ownTeamId={data.member?.teamId} weighted />
        ) : (
          <Blank>
            Totals appear after the organizer closes a round. Open and voided rounds are not
            included.
          </Blank>
        )}
      </Panel>
      <Panel title="Funding by round">
        <p className="muted">
          Each round is ranked separately by credits received, highest first. Equal totals share a
          place (1, 1, 3).
        </p>
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
            ) : blindJudge ? (
              <p className="muted">
                Funding totals stay hidden from judges until results are finalized.
              </p>
            ) : (
              <>
                <p className="muted">
                  Closed {stamp(round.closedAt)}. These are project totals, not individual team
                  allocations.
                </p>
                <FundingTable
                  rows={fundingLeaderboard(round, (id) => teamName(data, id))}
                  ownTeamId={data.member?.teamId}
                />
              </>
            )}
          </section>
        ))}
      </Panel>
      {published ? (
        <>
          <Panel title="Judges’ results">
            <p>
              <strong>{teamName(data, published.winnerId)}</strong> wins the judges’ grand prize.
            </p>
            {published.tiebreakReason && <p>Decision: {published.tiebreakReason}</p>}
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
        </>
      ) : (
        <Panel title="Final awards">
          <p>
            Final awards will appear after independent judging and the results review period.
            Funding totals do not determine the winner.
          </p>
        </Panel>
      )}

      <p className="muted">{settings.reservePolicy}</p>
    </>
  );
}

/** The same columns and tie ranks apply to overall and per-round funding. */
function FundingTable({
  rows,
  ownTeamId,
  weighted = false,
}: {
  rows: FundingStanding[];
  ownTeamId?: string | null;
  weighted?: boolean;
}) {
  return (
    <div className="p-table-wrap">
      <table className="p-table">
        <thead>
          <tr>
            <th scope="col">Rank</th>
            <th scope="col">Project</th>
            <th scope="col" aria-sort="descending">
              {weighted ? 'Weighted credits' : 'Total credits received'}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((entry) => (
            <tr key={entry.teamId}>
              <td>{entry.rank}</td>
              <td>
                <button className="p-link" onClick={() => navigate('projects', entry.teamId)}>
                  {entry.name}
                </button>
                {entry.teamId === ownTeamId && <span className="muted"> (your team)</span>}
              </td>
              <td>{entry.credits.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
