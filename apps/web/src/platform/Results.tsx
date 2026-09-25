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
