import { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import type { AppSnapshot } from '@robinhacks/core';
import { credits, Empty, TeamMark } from '../ui/primitives';
export function Standings({
  data,
  onProject,
}: {
  data: AppSnapshot;
  onProject: (id: string) => void;
}) {
  const publishedResults = data.event?.publishedResultId ? data.results : null;
  const [tab, setTab] = useState<'funding' | 'investors' | 'projects'>('funding');
  const funding = [...data.market.entries].sort(
    (a, b) =>
      b.issuer.fundingVaultMinor - a.issuer.fundingVaultMinor ||
      a.team.name.localeCompare(b.team.name),
  );
  const rows =
    tab === 'funding'
      ? funding.map((entry, index) => ({
          team: entry.team,
          rank:
            index === 0
              ? 1
              : funding[index - 1].issuer.fundingVaultMinor === entry.issuer.fundingVaultMinor
                ? funding.findIndex(
                    (item) => item.issuer.fundingVaultMinor === entry.issuer.fundingVaultMinor,
                  ) + 1
                : index + 1,
          value: `${credits(entry.issuer.fundingVaultMinor, false)} cr`,
          detail: `${entry.issuer.seedBackers} seed backers`,
          eligible: entry.team.eligibility === 'active',
        }))
      : tab === 'investors'
        ? (publishedResults?.teams || []).map((result) => ({
            team: data.market.entries.find((item) => item.team.id === result.teamId)!.team,
            rank: result.rank,
            value: `${credits(result.valueMinor)} cr`,
            detail: `${result.profitMinor >= 0 ? '+' : ''}${credits(result.profitMinor)} credits`,
            eligible: result.eligible,
          }))
        : (publishedResults?.issuers || []).map((result) => ({
            team: data.market.entries.find((item) => item.team.id === result.issuerId)!.team,
            rank: result.rank,
            value: `${result.score} / 100`,
            detail: `${credits(result.priceMinor)} cr final share value`,
            eligible: result.eligible,
          }));
  const hasFunding = funding.some((entry) => entry.issuer.fundingVaultMinor > 0);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Standings</h1>
        </div>
        {publishedResults && <span className="phase-pill">Final results published</span>}
      </div>
      <div className="tab-line" role="tablist" aria-label="Standings category">
        {(['funding', 'investors', 'projects'] as const).map((item) => (
          <button
            key={item}
            role="tab"
            className={item === tab ? 'active' : ''}
            aria-selected={item === tab}
            onClick={() => setTab(item)}
          >
            {item === 'funding'
              ? 'Seed fundraising'
              : item === 'investors'
                ? 'Investing teams'
                : 'Judged projects'}
          </button>
        ))}
      </div>
      <div className="standings-explainer">
        <h2>
          {tab === 'funding'
            ? 'Credits raised'
            : tab === 'investors'
              ? 'Final portfolio value'
              : 'Judging scores'}
        </h2>
        <p>
          {tab === 'funding'
            ? 'Credits raised in the seed round. Secondary trades do not add to these totals.'
            : tab === 'investors'
              ? 'Cash plus shares valued at the final prices determined by judging.'
              : 'Judges’ scores and the final value assigned to each project’s shares.'}
        </p>
      </div>
      {(tab === 'funding' ? !hasFunding : !publishedResults) ? (
        <Empty
          title={tab === 'funding' ? 'No seed funding results' : 'Final results not published'}
        >
          {tab === 'funding'
            ? 'Commitments stay private until allocation is complete.'
            : 'The organizer will publish these standings after judging and settlement.'}
        </Empty>
      ) : (
        <div className="standings-list">
          {rows
            .filter((row) => row.team)
            .map((row) => (
              <button
                className="standing-row"
                key={row.team.id}
                onClick={() => onProject(row.team.id)}
              >
                <span className={`rank ${row.rank === 1 ? 'first' : ''}`}>
                  {row.eligible ? String(row.rank).padStart(2, '0') : '—'}
                </span>
                <TeamMark team={row.team} />
                <span className="standing-team">
                  <strong>{row.team.name}</strong>
                  <small>
                    {row.team.category}
                    {!row.eligible ? ' · Ineligible' : ''}
                  </small>
                </span>
                <span className="standing-value">
                  <strong>{row.value}</strong>
                  <small>{row.detail}</small>
                </span>
                <ArrowUpRight size={18} />
              </button>
            ))}
        </div>
      )}
    </>
  );
}
