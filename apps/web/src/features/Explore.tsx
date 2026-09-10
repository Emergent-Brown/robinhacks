import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Search, Star } from 'lucide-react';
import type { AppSnapshot, MarketEntry } from '@robinhacks/core';
import type { AppActions } from '../hooks/useApp';
import { credits, date, Empty, ExternalLink, TeamMark } from '../ui/primitives';
import { SeedDialog, TradeDialog } from './Trading';

function useSaved(uid: string) {
  const key = `robinhacks:saved:${uid}`;
  const [saved, setSaved] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) || '[]');
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      setSaved(JSON.parse(localStorage.getItem(key) || '[]'));
    } catch {
      setSaved([]);
    }
  }, [key]);
  function toggle(id: string) {
    setSaved((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      localStorage.setItem(key, JSON.stringify(next));
      return next;
    });
  }
  return { saved, toggle };
}
function seededValue(id: string, uid: string) {
  let value = 2166136261;
  for (const char of `${uid}:${id}`) {
    value ^= char.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}
export function Explore({
  data,
  actions,
  onProject,
}: {
  data: AppSnapshot;
  actions: AppActions;
  onProject: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('discover');
  const [category, setCategory] = useState('all');
  const { saved, toggle } = useSaved(actions.gateway.user?.uid || '');
  const entries = useMemo(
    () =>
      data.market.entries
        .filter(
          (entry) =>
            `${entry.team.name} ${entry.team.pitch} ${entry.team.ticker}`
              .toLowerCase()
              .includes(search.toLowerCase()) &&
            (filter !== 'saved' || saved.includes(entry.team.id)) &&
            (category === 'all' || entry.team.category === category),
        )
        .sort((a, b) =>
          sort === 'name'
            ? a.team.name.localeCompare(b.team.name)
            : seededValue(a.team.id, actions.gateway.user?.uid || '') -
              seededValue(b.team.id, actions.gateway.user?.uid || ''),
        ),
    [data.market, search, filter, sort, category, saved, actions.gateway.user?.uid],
  );
  const categories = [...new Set(data.market.entries.map((entry) => entry.team.category))]
    .filter(Boolean)
    .sort();
  return (
    <>
      <div className="page-heading explore-heading">
        <div>
          <h1>Projects</h1>
        </div>
        <span className="directory-count" role="status">
          {entries.length === data.market.entries.length
            ? `${entries.length} projects`
            : `${entries.length} of ${data.market.entries.length} projects`}
        </span>
      </div>
      <div className="directory-toolbar">
        <label className="search-field">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Search projects</span>
          <input
            type="search"
            value={search}
            placeholder="Search projects"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label className="sort-select">
          <span>Sort</span>
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="discover">Default</option>
            <option value="name">Name A–Z</option>
          </select>
        </label>
      </div>
      <div className="directory-filters">
        <div className="segmented" aria-label="Project filter">
          <button
            aria-pressed={filter === 'all'}
            className={filter === 'all' ? 'active' : ''}
            onClick={() => setFilter('all')}
          >
            All <span>({data.market.entries.length})</span>
          </button>
          <button
            aria-pressed={filter === 'saved'}
            className={filter === 'saved' ? 'active' : ''}
            onClick={() => setFilter('saved')}
          >
            Saved <span>({saved.length})</span>
          </button>
        </div>
        <label className="category-select">
          <span className="sr-only">Project category</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="all">All categories</option>
            {categories.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
      </div>
      {entries.length ? (
        <div className="project-directory">
          <table className="directory-table">
            <caption className="sr-only">
              Project directory. Indicative prices are in event credits per share.
            </caption>
            <thead>
              <tr>
                <th scope="col" className="directory-project">
                  Project
                </th>
                <th scope="col" className="directory-category">
                  Category
                </th>
                <th scope="col" className="directory-price">
                  Price / share
                </th>
                <th scope="col" className="directory-holding">
                  Your shares
                </th>
                <th scope="col" className="directory-save">
                  <span className="sr-only">Saved</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const owned =
                  data.positions.find((item) => item.issuerId === entry.team.id)?.shares || 0;
                const isOwn = entry.team.id === data.member?.teamId;
                const isSaved = saved.includes(entry.team.id);
                return (
                  <tr key={entry.team.id}>
                    <th scope="row" className="directory-project">
                      <div className="directory-project-title">
                        <button
                          className="project-name-link"
                          onClick={() => onProject(entry.team.id)}
                        >
                          {entry.team.name}
                        </button>
                        <span className="ticker">{entry.team.ticker}</span>
                        {isOwn && <span className="owned-tag">Your team</span>}
                      </div>
                      <p className="directory-pitch">
                        {entry.team.pitch || 'No project description yet.'}
                      </p>
                      <div className="directory-mobile-meta">
                        <span>{entry.team.category || 'Uncategorized'}</span>
                        {owned > 0 && <span>{owned} shares held</span>}
                      </div>
                    </th>
                    <td className="directory-category">{entry.team.category || '—'}</td>
                    <td className="directory-price">
                      {entry.pool.halted ? (
                        <span className="muted">Halted</span>
                      ) : (
                        <>
                          <span>
                            {credits(
                              entry.pool.creditReserveMinor / entry.pool.shareReserve,
                              false,
                            )}
                          </span>
                          <span className="directory-price-unit"> cr</span>
                        </>
                      )}
                    </td>
                    <td className="directory-holding">{owned}</td>
                    <td className="directory-save">
                      <button
                        className={`icon-button save-button ${isSaved ? 'saved' : ''}`}
                        onClick={() => toggle(entry.team.id)}
                        aria-label={`${isSaved ? 'Unsave' : 'Save'} ${entry.team.name}`}
                        aria-pressed={isSaved}
                      >
                        <Star
                          size={16}
                          aria-hidden="true"
                          fill={isSaved ? 'currentColor' : 'none'}
                        />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          title={
            search
              ? `No projects match “${search}”`
              : filter === 'saved'
                ? 'Your saved projects will appear here.'
                : 'No projects in this category.'
          }
        >
          Try another search or choose All projects.
        </Empty>
      )}
      <div className="page-footnote">
        <span>Indicative prices in event credits. Exact quotes appear before confirmation.</span>
        <span>Market updated {date(data.market.asOf)}</span>
      </div>
    </>
  );
}
export function ProjectDetail({
  entry,
  data,
  actions,
  onBack,
  onEdit,
}: {
  entry: MarketEntry;
  data: AppSnapshot;
  actions: AppActions;
  onBack: () => void;
  onEdit: () => void;
}) {
  const [dialog, setDialog] = useState<'seed' | 'BUY' | 'SELL' | null>(null);
  const { saved, toggle } = useSaved(actions.gateway.user?.uid || '');
  const owned = data.positions.find((position) => position.issuerId === entry.team.id)?.shares || 0;
  const own = data.member?.teamId === entry.team.id;
  const canTrade = data.member?.role === 'captain' || data.member?.role === 'trader';
  const phase = data.event?.phase;
  const expired = !!data.event?.closesAt && data.event.closesAt <= Date.now();
  const open = !data.event?.paused && !expired && !entry.pool.halted;
  const seed = phase === 'SEED_OPEN' && open;
  const trading = phase === 'TRADING_OPEN' && open;
  return (
    <>
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={17} />
        All projects
      </button>
      <div className="project-detail-heading">
        <TeamMark team={entry.team} large />
        <div>
          <span className="project-detail-meta">
            {entry.team.category} · {entry.team.ticker}
          </span>
          <h1>{entry.team.name}</h1>
          <p>{entry.team.pitch}</p>
        </div>
        <button
          className={`icon-button ${saved.includes(entry.team.id) ? 'saved' : ''}`}
          onClick={() => toggle(entry.team.id)}
          aria-label={saved.includes(entry.team.id) ? 'Unsave project' : 'Save project'}
          aria-pressed={saved.includes(entry.team.id)}
        >
          <Star
            size={18}
            aria-hidden="true"
            fill={saved.includes(entry.team.id) ? 'currentColor' : 'none'}
          />
        </button>
      </div>
      <div className="detail-columns">
        <div className="project-story">
          <div className="project-links">
            {entry.team.demoUrl ? (
              <ExternalLink href={entry.team.demoUrl}>View demo</ExternalLink>
            ) : (
              <span className="muted">Demo link not added</span>
            )}
            {entry.team.repoUrl && (
              <ExternalLink href={entry.team.repoUrl}>Source code</ExternalLink>
            )}
          </div>
          <section>
            <h2>Problem</h2>
            <p>{entry.team.problem || 'No problem statement added.'}</p>
          </section>
          <section>
            <h2>What they’re building</h2>
            <p>{entry.team.building || 'No project details added.'}</p>
          </section>
          <section>
            <h2>Latest checkpoint</h2>
            <p>{entry.team.update || 'No checkpoint update yet.'}</p>
            {entry.team.update && (
              <small className="muted">Updated {date(entry.team.updatedAt)}</small>
            )}
          </section>
        </div>
        <aside className="market-panel">
          <h2>Market</h2>
          <div className="market-price">
            {credits(entry.pool.creditReserveMinor / entry.pool.shareReserve)}
            <span> credits / share</span>
          </div>
          <p className="fine-print">Indicative price. Review an exact quote before trading.</p>
          <dl className="detail-list">
            <div>
              <dt>Seed funding raised</dt>
              <dd>{credits(entry.issuer.fundingVaultMinor, false)} cr</dd>
            </div>
            <div>
              <dt>Seed backers</dt>
              <dd>{entry.issuer.seedBackers} teams</dd>
            </div>
            <div>
              <dt>Your holding</dt>
              <dd>{owned} shares</dd>
            </div>
          </dl>
          <div className="market-actions">
            {own ? (
              <>
                <p className="fine-print">
                  This is your team’s project. Teams cannot buy their own shares.
                </p>
                <button className="button primary full" onClick={onEdit}>
                  Manage your project
                  <ArrowRight size={16} />
                </button>
              </>
            ) : !canTrade ? (
              <p className="notice-inline">Your captain and designated trader can place trades.</p>
            ) : seed ? (
              <button className="button primary full" onClick={() => setDialog('seed')}>
                {data.commitments?.shares[entry.team.id] ? 'Edit' : 'Set'} seed commitment
                <ArrowRight size={16} />
              </button>
            ) : trading ? (
              <>
                <button
                  className="button primary full"
                  disabled={owned >= 25}
                  onClick={() => setDialog('BUY')}
                >
                  Buy shares
                  <ArrowRight size={16} />
                </button>
                {owned > 0 && (
                  <button className="button secondary full" onClick={() => setDialog('SELL')}>
                    Sell shares
                  </button>
                )}
              </>
            ) : (
              <p className="notice-inline">
                {entry.pool.halted
                  ? 'Trading in this project is halted.'
                  : data.event?.paused
                    ? 'Trading is paused by the organizer.'
                    : 'Trading is currently closed.'}
              </p>
            )}
          </div>
          <details className="market-explanation">
            <summary>How share pricing works</summary>
            <p>
              Prices move as teams buy and sell from a shared liquidity pool. Your exact trade price
              appears before you confirm. Final share values are set by independent judging.
            </p>
            <p>Seed funding is locked and cannot be spent by the project team.</p>
          </details>
        </aside>
      </div>
      {dialog === 'seed' && (
        <SeedDialog entry={entry} data={data} actions={actions} onClose={() => setDialog(null)} />
      )}
      {(dialog === 'BUY' || dialog === 'SELL') && (
        <TradeDialog
          entry={entry}
          side={dialog}
          data={data}
          actions={actions}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
