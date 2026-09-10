import { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Download, FileText, Pencil, Wallet } from 'lucide-react';
import {
  ConstantProductPool,
  type AppSnapshot,
  type MarketEntry,
  type Note,
  type Receipt,
} from '@robinhacks/core';
import type { AppActions } from '../hooks/useApp';
import { newCommandId } from '../app/gateway';
import { credits, csv, date, Dialog, download, Empty, Field, TeamMark } from '../ui/primitives';
import { ReceiptView, SeedDialog } from './Trading';

export function Portfolio({
  data,
  actions,
  onProject,
}: {
  data: AppSnapshot;
  actions: AppActions;
  onProject: (id: string) => void;
}) {
  const publishedResults = data.event?.publishedResultId ? data.results : null;
  const [tab, setTab] = useState<'holdings' | 'notes' | 'activity'>('holdings');
  const [seed, setSeed] = useState<MarketEntry | null>(null);
  const [note, setNote] = useState<MarketEntry | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const wallet = data.wallet;
  const own = data.market.entries.find((entry) => entry.team.id === data.member?.teamId)?.team;
  const canTrade = ['captain', 'trader'].includes(data.member?.role || '');
  const positions = data.positions.filter((item) => item.shares > 0);
  const commitments = Object.entries(data.commitments?.shares || {}).filter(
    ([, shares]) => shares > 0,
  );
  const liquidation = positions.reduce((total, position) => {
    const entry = data.market.entries.find((item) => item.team.id === position.issuerId);
    if (!entry) return total;
    try {
      return (
        total +
        new ConstantProductPool({ ...entry.pool, halted: false }).quote('SELL', position.shares)
          .totalMinor
      );
    } catch {
      return total;
    }
  }, 0);
  function exportPortfolio() {
    download(
      `robinhacks-${own?.name || 'portfolio'}.csv`,
      csv([
        ['Team', own?.name || ''],
        ['Cash credits', (wallet?.cashMinor || 0) / 100],
        ['Reserved credits', (wallet?.reservedSeedMinor || 0) / 100],
        [],
        ['Project', 'Shares', 'Cost basis credits', 'Realized P/L credits'],
        ...data.positions.map((position) => [
          data.market.entries.find((entry) => entry.team.id === position.issuerId)?.team.name ||
            position.issuerId,
          position.shares,
          position.costBasisMinor / 100,
          position.realizedPnlMinor / 100,
        ]),
        [],
        ['Project', 'Thesis', 'Reconsider when', 'Next check'],
        ...data.notes.map((item) => [
          data.market.entries.find((entry) => entry.team.id === item.issuerId)?.team.name ||
            item.issuerId,
          item.thesis,
          item.reconsider,
          item.nextCheck,
        ]),
      ]),
    );
  }
  if (!wallet)
    return (
      <>
        <div className="page-heading">
          <div>
            <h1>Portfolio</h1>
          </div>
        </div>
        <Empty title="No team portfolio">
          Organizer accounts do not hold shares. Export event data from Admin.
        </Empty>
      </>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Portfolio</h1>
          <p>{own?.name || 'Your team'}’s shared cash, shares, and notes.</p>
        </div>
        <button className="button secondary" onClick={exportPortfolio}>
          <Download size={17} />
          Export CSV
        </button>
      </div>
      <div className="wallet-overview">
        <div className="available-balance">
          <span>
            <Wallet size={17} />
            Available credits
          </span>
          <strong>{credits(wallet.cashMinor - wallet.reservedSeedMinor)}</strong>
        </div>
        <div className="wallet-secondary">
          <div>
            <span>Reserved for seed</span>
            <strong>
              {credits(wallet.reservedSeedMinor)}
              <small> cr</small>
            </strong>
          </div>
          <div>
            <span>
              {publishedResults ? 'Final portfolio value' : 'Estimated liquidation value'}
            </span>
            <strong>
              {credits(
                publishedResults?.teams.find((item) => item.teamId === wallet.teamId)?.valueMinor ??
                  wallet.cashMinor + liquidation,
              )}
              <small> cr</small>
            </strong>
          </div>
        </div>
      </div>
      <p className="fine-print portfolio-caption">
        {publishedResults
          ? 'Final values use independent judging and frozen holdings.'
          : `Liquidation estimate uses the market snapshot from ${date(data.market.asOf)}. Actual proceeds may change.`}
      </p>
      {['SEED_OPEN', 'SEED_SETTLING'].includes(data.event?.phase || '') && (
        <section className="content-section">
          <div className="section-heading">
            <h2>Seed commitments</h2>
            <span className="muted">
              {commitments.reduce((total, [, value]) => total + value, 0)} / 50 shares requested
            </span>
          </div>
          {commitments.length ? (
            <div className="data-list">
              {commitments.map(([id, shares]) => {
                const entry = data.market.entries.find((item) => item.team.id === id);
                if (!entry) return null;
                return (
                  <div className="data-row" key={id}>
                    <TeamMark team={entry.team} />
                    <button className="row-title" onClick={() => onProject(id)}>
                      {entry.team.name}
                      <small>{shares} shares requested</small>
                    </button>
                    <strong>{credits(shares * 10000, false)} cr</strong>
                    {data.event?.phase === 'SEED_OPEN' && canTrade && (
                      <button
                        className="icon-button"
                        aria-label={`Edit ${entry.team.name} commitment`}
                        onClick={() => setSeed(entry)}
                      >
                        <Pencil size={17} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty title="No seed commitments">
              Choose a project to reserve credits. Edit or withdraw before the round closes.
            </Empty>
          )}
        </section>
      )}
      <div className="tab-line" role="tablist" aria-label="Portfolio views">
        {(['holdings', 'notes', 'activity'] as const).map((item) => (
          <button
            key={item}
            role="tab"
            aria-selected={tab === item}
            className={tab === item ? 'active' : ''}
            onClick={() => setTab(item)}
          >
            {item === 'holdings' ? 'Holdings' : item === 'notes' ? 'Investment notes' : 'Activity'}
            {item === 'holdings' && <span>{positions.length}</span>}
          </button>
        ))}
      </div>
      {tab === 'holdings' &&
        (positions.length ? (
          <div className="holdings-table">
            <div className="table-heading">
              <span>PROJECT</span>
              <span>SHARES</span>
              <span>COST BASIS</span>
              <span>EST. SALE VALUE</span>
            </div>
            {positions.map((position) => {
              const entry = data.market.entries.find((item) => item.team.id === position.issuerId);
              if (!entry) return null;
              let value = 0;
              try {
                value = new ConstantProductPool({
                  ...entry.pool,
                  halted: false,
                }).quote('SELL', position.shares).totalMinor;
              } catch {
                /* unavailable pool is shown as zero */
              }
              return (
                <button
                  className="holding-row"
                  key={position.issuerId}
                  onClick={() => onProject(position.issuerId)}
                >
                  <span className="holding-project">
                    <TeamMark team={entry.team} />
                    <span>
                      <strong>{entry.team.name}</strong>
                      <small>{entry.team.ticker}</small>
                    </span>
                  </span>
                  <span>
                    <small className="mobile-label">Shares</small>
                    {position.shares}
                  </span>
                  <span>
                    <small className="mobile-label">Cost basis</small>
                    {credits(position.costBasisMinor)}
                    <small> cr</small>
                  </span>
                  <span>
                    <small className="mobile-label">Est. sale</small>
                    {credits(value)}
                    <small> cr</small>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <Empty title="No shares held">
            Buy shares during an open trading window or request them in the seed round.
          </Empty>
        ))}
      {tab === 'notes' && (
        <section className="content-section">
          <div className="section-heading">
            <p className="muted">Notes are shared privately with your team.</p>
            <label className="compact-select">
              <span className="sr-only">Add a project note</span>
              <select
                value=""
                onChange={(event) =>
                  setNote(
                    data.market.entries.find((item) => item.team.id === event.target.value) || null,
                  )
                }
              >
                <option value="">Add a note…</option>
                {data.market.entries
                  .filter((item) => item.team.id !== data.member?.teamId)
                  .map((item) => (
                    <option value={item.team.id} key={item.team.id}>
                      {item.team.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          {data.notes.length ? (
            <div className="notes-grid">
              {data.notes.map((item) => {
                const entry = data.market.entries.find((entry) => entry.team.id === item.issuerId);
                if (!entry) return null;
                return (
                  <button className="note-card" key={item.issuerId} onClick={() => setNote(entry)}>
                    <span className="note-title">
                      <TeamMark team={entry.team} />
                      <strong>{entry.team.name}</strong>
                      <Pencil size={16} />
                    </span>
                    <p>{item.thesis || 'No investment reason added.'}</p>
                    {item.reconsider && <p className="muted">Reconsider: {item.reconsider}</p>}
                    <small>Updated {date(item.updatedAt)}</small>
                  </button>
                );
              })}
            </div>
          ) : (
            <Empty title="No investment notes">Select a project to add a note for your team.</Empty>
          )}
        </section>
      )}
      {tab === 'activity' &&
        (data.receipts.length ? (
          <div className="activity-list">
            {[...data.receipts]
              .sort((a, b) => b.acceptedAt - a.acceptedAt)
              .map((item) => (
                <div className="activity-row" key={item.id}>
                  <span className={`activity-icon ${item.side === 'SELL' ? 'positive' : ''}`}>
                    {item.side === 'BUY' ? (
                      <ArrowUpRight size={19} />
                    ) : item.side === 'SELL' ? (
                      <ArrowDownLeft size={19} />
                    ) : (
                      <FileText size={19} />
                    )}
                  </span>
                  <div>
                    <strong>{item.detail}</strong>
                    <span>{date(item.acceptedAt)}</span>
                  </div>
                  {item.side ? (
                    <button className="text-link" onClick={() => setReceipt(item)}>
                      Receipt
                      <ArrowUpRight size={15} />
                    </button>
                  ) : (
                    <span className="muted">Confirmed</span>
                  )}
                </div>
              ))}
          </div>
        ) : (
          <Empty title="No activity">Confirmed seed allocations and trades will appear here.</Empty>
        ))}
      {seed && (
        <SeedDialog entry={seed} data={data} actions={actions} onClose={() => setSeed(null)} />
      )}
      {note && (
        <NoteDialog
          entry={note}
          existing={data.notes.find((item) => item.issuerId === note.team.id)}
          actions={actions}
          onClose={() => setNote(null)}
        />
      )}
      {receipt && <ReceiptView receipt={receipt} data={data} onClose={() => setReceipt(null)} />}
    </>
  );
}
function NoteDialog({
  entry,
  existing,
  actions,
  onClose,
}: {
  entry: MarketEntry;
  existing?: Note;
  actions: AppActions;
  onClose: () => void;
}) {
  const [thesis, setThesis] = useState(existing?.thesis || '');
  const [reconsider, setReconsider] = useState(existing?.reconsider || '');
  const [nextCheck, setNextCheck] = useState(existing?.nextCheck || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      await actions.execute({
        type: 'saveNote',
        commandId: newCommandId(),
        issuerId: entry.team.id,
        thesis,
        reconsider,
        nextCheck,
        expectedVersion: existing?.version || 0,
      });
      actions.notify('Team note saved.');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save note.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog title={`Note · ${entry.team.name}`} onClose={onClose}>
      <p className="muted">Shared privately with your team.</p>
      <Field label="Reason to invest">
        <textarea
          value={thesis}
          onChange={(event) => setThesis(event.target.value)}
          maxLength={1000}
          rows={4}
        />
      </Field>
      <Field label="Reconsider if">
        <textarea
          value={reconsider}
          onChange={(event) => setReconsider(event.target.value)}
          maxLength={1000}
          rows={3}
        />
      </Field>
      <Field label="Next review">
        <input
          value={nextCheck}
          onChange={(event) => setNextCheck(event.target.value)}
          maxLength={160}
          placeholder="e.g. After the 6 PM demo"
        />
      </Field>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="button primary full" disabled={saving} onClick={() => void save()}>
        {saving ? 'Saving…' : 'Save team note'}
      </button>
    </Dialog>
  );
}
