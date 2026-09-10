import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  ConstantProductPool,
  RULES,
  type AppSnapshot,
  type MarketEntry,
  type Pool,
  type Quote,
  type Receipt,
  type TradeCommand,
} from '@robinhacks/core';
import { newCommandId } from '../app/gateway';
import type { AppActions } from '../hooks/useApp';
import { credits, date, Dialog, Field, Loading } from '../ui/primitives';

export function ReceiptView({
  receipt,
  data,
  onClose,
}: {
  receipt: Receipt;
  data: AppSnapshot;
  onClose: () => void;
}) {
  const team = data.market.entries.find((entry) => entry.team.id === receipt.issuerId)?.team;
  return (
    <Dialog title="Trade confirmed" onClose={onClose}>
      <div className="receipt-success">
        <Check size={24} />
      </div>
      <p className="receipt-lead">
        {receipt.side === 'BUY' ? 'Bought' : 'Sold'} {receipt.shares}{' '}
        {receipt.shares === 1 ? 'share' : 'shares'} in {team?.name || receipt.issuerId}.
      </p>
      <dl className="detail-list">
        <div>
          <dt>Trade total</dt>
          <dd>{credits(receipt.totalMinor || 0)} credits</dd>
        </div>
        <div>
          <dt>Cash after trade</dt>
          <dd>{credits(receipt.cashAfterMinor || 0)} credits</dd>
        </div>
        <div>
          <dt>Confirmed</dt>
          <dd>{date(receipt.acceptedAt)}</dd>
        </div>
        <div>
          <dt>Placed by</dt>
          <dd>
            {data.members.find((member) => member.uid === receipt.actorUid)?.displayName ||
              receipt.actorUid}
          </dd>
        </div>
      </dl>
      <p className="receipt-id">Receipt {receipt.id}</p>
      <button className="button primary full" onClick={onClose}>
        Done
      </button>
    </Dialog>
  );
}
export function TradeDialog({
  entry,
  side,
  data,
  actions,
  onClose,
}: {
  entry: MarketEntry;
  side: 'BUY' | 'SELL';
  data: AppSnapshot;
  actions: AppActions;
  onClose: () => void;
}) {
  const storageKey = `robinhacks:pending:${actions.gateway.user?.uid}:${entry.team.id}`;
  const [pending, setPending] = useState<TradeCommand | null>(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [quantity, setQuantity] = useState(String(pending?.shares || 1));
  const [pool, setPool] = useState<Pool | null>(null);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const position = data.positions.find((item) => item.issuerId === entry.team.id);
  const owned = position?.shares || 0;
  const currentSide = pending?.side || side;
  async function refreshQuote() {
    setLoading(true);
    setError('');
    try {
      const latest = await actions.gateway.pool(entry.team.id);
      setPool(latest);
      await actions.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not get a current quote.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refreshQuote();
  }, [entry.team.id]);
  const quoteState = useMemo((): { quote: Quote | null; error: string } => {
    if (!pool) return { quote: null, error: '' };
    const shares = Number(quantity);
    if (!Number.isInteger(shares) || shares < 1)
      return { quote: null, error: 'Enter a whole number of shares.' };
    if (currentSide === 'BUY' && owned + shares > RULES.maxHoldingShares)
      return {
        quote: null,
        error: `You can hold up to ${RULES.maxHoldingShares} shares in one team.`,
      };
    if (currentSide === 'SELL' && shares > owned)
      return { quote: null, error: `Your team owns ${owned} ${owned === 1 ? 'share' : 'shares'}.` };
    try {
      const quote = new ConstantProductPool(pool).quote(currentSide, shares);
      if (
        currentSide === 'BUY' &&
        quote.totalMinor > (data.wallet?.cashMinor || 0) - (data.wallet?.reservedSeedMinor || 0)
      )
        return {
          quote: null,
          error: 'Your team does not have enough available credits.',
        };
      return { quote, error: '' };
    } catch (e) {
      return {
        quote: null,
        error: e instanceof Error ? e.message : 'Quote unavailable.',
      };
    }
  }, [pool, quantity, currentSide, owned, data.wallet]);
  async function submit() {
    if (!data.wallet || !data.event || (!pending && !quoteState.quote) || !pool) return;
    const command: TradeCommand = pending || {
      type: 'executeTrade',
      commandId: newCommandId(),
      issuerId: entry.team.id,
      side: currentSide,
      shares: Number(quantity),
      expectedPoolVersion: pool.version,
      expectedWalletVersion: data.wallet.version,
      expectedPhaseVersion: data.event.phaseVersion,
      ...(currentSide === 'BUY'
        ? { maxDebitMinor: quoteState.quote!.totalMinor }
        : { minCreditMinor: quoteState.quote!.totalMinor }),
    };
    setSubmitting(true);
    setError('');
    setPending(command);
    sessionStorage.setItem(storageKey, JSON.stringify(command));
    try {
      const result = await actions.execute(command);
      if (!result.receipt)
        throw new Error(
          'The server has not returned a receipt. Retry this same request to check its outcome.',
        );
      sessionStorage.removeItem(storageKey);
      setPending(null);
      setReceipt(result.receipt);
    } catch (e) {
      const message =
        e instanceof Error
          ? e.message
          : 'The outcome is not confirmed. Retry this request to check it.';
      setError(message);
      const code = typeof e === 'object' && e && 'code' in e ? String(e.code) : '';
      if (code && !/unavailable|deadline|internal|network|unknown/i.test(code)) {
        sessionStorage.removeItem(storageKey);
        setPending(null);
        setPool(null);
      }
    } finally {
      setSubmitting(false);
    }
  }
  if (receipt) return <ReceiptView receipt={receipt} data={data} onClose={onClose} />;
  const quote = quoteState.quote;
  const team = data.market.entries.find((item) => item.team.id === data.member?.teamId)?.team;
  const closed =
    !navigator.onLine ||
    !data.event ||
    data.event.phase !== 'TRADING_OPEN' ||
    data.event.paused ||
    (!!data.event.closesAt && Date.now() >= data.event.closesAt);
  return (
    <Dialog
      title={`${currentSide === 'BUY' ? 'Buy' : 'Sell'} ${entry.team.name}`}
      onClose={onClose}
    >
      <p className="muted">Team portfolio: {team?.name || 'your team'}</p>
      <Field
        label="Shares"
        hint={`${owned} held · Maximum ${RULES.maxHoldingShares} in this project`}
      >
        <input
          type="number"
          min="1"
          max={currentSide === 'BUY' ? RULES.maxHoldingShares - owned : owned}
          step="1"
          value={quantity}
          disabled={!!pending || submitting}
          onChange={(event) => setQuantity(event.target.value)}
          aria-describedby="trade-error"
        />
      </Field>
      {loading ? (
        <Loading label="Getting current quote…" />
      ) : quote ? (
        <div className="trade-quote">
          <span>{currentSide === 'BUY' ? 'Total cost' : 'Total received'}</span>
          <strong>
            {credits(quote.totalMinor)}
            <small> credits</small>
          </strong>
          <dl className="detail-list">
            <div>
              <dt>Average per share</dt>
              <dd>{credits(quote.averagePriceMinor)} credits</dd>
            </div>
            <div>
              <dt>Price impact</dt>
              <dd>{quote.impactPercent.toFixed(2)}%</dd>
            </div>
            <div>
              <dt>Trading fee</dt>
              <dd>0 credits</dd>
            </div>
          </dl>
        </div>
      ) : null}
      {(error || quoteState.error) && (
        <p className="form-error" role="alert" id="trade-error">
          {error || quoteState.error}
        </p>
      )}
      {pending && (
        <p className="notice-inline">
          Trade unconfirmed. Retry to check the receipt; the same request cannot execute twice.
        </p>
      )}
      {closed && !pending && (
        <p className="notice-inline">
          Trading is closed or paused. Refresh the event before placing a trade.
        </p>
      )}
      <p className="fine-print">
        <ShieldCheck size={15} /> You confirm this total. If the price changes, review a new quote.
      </p>
      <div className="dialog-actions">
        <button
          className="button secondary"
          onClick={() => void refreshQuote()}
          disabled={submitting || loading || !!pending}
        >
          <RefreshCw size={16} />
          Refresh quote
        </button>
        <button
          className="button primary"
          onClick={() => void submit()}
          disabled={submitting || loading || (!pending && (!quote || closed))}
        >
          {submitting
            ? 'Confirming…'
            : pending
              ? 'Retry trade'
              : `Confirm ${currentSide === 'BUY' ? 'buy' : 'sale'}`}
          <ArrowRight size={17} />
        </button>
      </div>
    </Dialog>
  );
}
export function SeedDialog({
  entry,
  data,
  actions,
  onClose,
}: {
  entry: MarketEntry;
  data: AppSnapshot;
  actions: AppActions;
  onClose: () => void;
}) {
  const existing = data.commitments?.shares || {};
  const current = existing[entry.team.id] || 0;
  const [quantity, setQuantity] = useState(String(current));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const shares = Number(quantity);
  const totalShares =
    Object.values(existing).reduce((total, value) => total + value, 0) - current + shares;
  const total = totalShares * RULES.primaryPriceMinor;
  const valid =
    Number.isInteger(shares) &&
    shares >= 0 &&
    shares <= RULES.maxSeedRequestShares &&
    total <= RULES.maxSeedCommitmentMinor &&
    total <= (data.wallet?.cashMinor || 0);
  async function save() {
    if (!data.wallet || !valid) return;
    setSaving(true);
    try {
      const next = { ...existing, [entry.team.id]: shares };
      if (shares === 0) delete next[entry.team.id];
      await actions.execute({
        type: 'setSeedCommitments',
        commandId: newCommandId(),
        shares: next,
        expectedWalletVersion: data.wallet.version,
        expectedCommitmentVersion: data.commitments?.version || 0,
      });
      actions.notify(
        shares
          ? `Requested ${shares} ${shares === 1 ? 'share' : 'shares'} in ${entry.team.name}.`
          : 'Commitment removed.',
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save commitment.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog title={`${current ? 'Edit' : 'Add'} seed commitment`} onClose={onClose}>
      <p className="muted">
        {entry.team.name} · {credits(RULES.primaryPriceMinor, false)} credits per share
      </p>
      <Field
        label="Shares requested"
        hint={`0–${RULES.maxSeedRequestShares} shares. Enter 0 to withdraw.`}
      >
        <input
          type="number"
          min="0"
          max={RULES.maxSeedRequestShares}
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
      </Field>
      <dl className="detail-list padded">
        <div>
          <dt>This commitment</dt>
          <dd>{credits(shares * RULES.primaryPriceMinor)} credits</dd>
        </div>
        <div>
          <dt>Total reserved after saving</dt>
          <dd>{credits(total)} credits</dd>
        </div>
        <div>
          <dt>Available after saving</dt>
          <dd>{credits((data.wallet?.cashMinor || 0) - total)} credits</dd>
        </div>
        <div>
          <dt>Total shares requested</dt>
          <dd>{totalShares} of 50</dd>
        </div>
      </dl>
      <p className="fine-print">
        Credits are reserved until allocation. If requests exceed available shares, allocations are
        proportional and unused credits are released. Commitments are hidden from other teams.
      </p>
      {!valid && (
        <p className="form-error">Request 0–25 shares, within your 5,000-credit seed budget.</p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="button primary full"
        disabled={!valid || saving}
        onClick={() => void save()}
      >
        {saving ? 'Saving…' : shares === 0 ? 'Remove commitment' : 'Save commitment'}
      </button>
    </Dialog>
  );
}
