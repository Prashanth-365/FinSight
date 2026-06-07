import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSetting } from '@/db/database.js';
import { useProfile } from '@/context/ProfileContext.jsx';
import { Card, CardBody, CardHeader, CardTitle, CardSubtitle } from '@/components/ui/Card.jsx';
import { Modal, ConfirmDialog } from '@/components/ui/Modal.jsx';
import { Field, Label } from '@/components/ui/Input.jsx';
import { Select } from '@/components/ui/Select.jsx';
import { EmptyState } from '@/components/ui/Empty.jsx';
import { useToast } from '@/components/ui/Toast.jsx';
import {
  TrendingUp, TrendingDown, Plus, RefreshCw, Trash2, Edit3, Coins, ChevronLeft, Calendar
} from 'lucide-react';
import { formatINR, formatINRShort, formatPercent } from '@/lib/currency.js';
import { cn, fmtDate } from '@/lib/utils.js';
import { useBackHandler } from '@/context/NavContext.jsx';
import { fetchMfNav, fetchCryptoPriceINR, fetchStockPriceINR, fdProjection } from '@/lib/pricing.js';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

const PLATFORMS = [
  { key: 'MF', label: 'Mutual Funds', icon: '📊', color: '#3b82f6' },
  { key: 'Stock', label: 'Stocks', icon: '📈', color: '#10b981' },
  { key: 'Gold', label: 'Gold', icon: '🥇', color: '#eab308' },
  { key: 'FD', label: 'Fixed Deposit', icon: '🏦', color: '#06b6d4' },
  { key: 'PPF', label: 'PPF', icon: '🛡️', color: '#a855f7' },
  { key: 'EPF', label: 'EPF', icon: '💼', color: '#f97316' },
  { key: 'Crypto', label: 'Crypto', icon: '🪙', color: '#f59e0b' },
  { key: 'Chit', label: 'Chit Fund', icon: '🤝', color: '#ec4899' },
  { key: 'Other', label: 'Other', icon: '✨', color: '#94a3b8' }
];

// Platforms we can fetch a live value for.
const REFRESHABLE = ['MF', 'Stock', 'Crypto', 'FD', 'PPF', 'EPF'];

// Fetch the latest value for a holding → a number (new currentValue) or null if
// no live price is available. Never throws.
async function refreshHoldingValue(holding, apiKey) {
  try {
    const units = Number(holding.units ?? 0);
    if (holding.platform === 'MF') {
      const nav = await fetchMfNav(holding.identifier);
      return nav == null ? null : (units > 0 ? nav * units : nav);
    }
    if (holding.platform === 'Crypto') {
      const p = await fetchCryptoPriceINR(holding.identifier);
      return p == null ? null : (units > 0 ? p * units : p);
    }
    if (holding.platform === 'Stock') {
      const p = await fetchStockPriceINR(holding.identifier, apiKey);
      return p == null ? null : (units > 0 ? p * units : p);
    }
    if (['FD', 'PPF', 'EPF'].includes(holding.platform)) {
      const rate = holding.notes?.match(/(\d+(?:\.\d+)?)\s*%/)?.[1];
      return fdProjection({
        principal: holding.investedAmount,
        ratePct: rate ? Number(rate) : 7,
        startDate: holding.startDate
      });
    }
  } catch {
    /* fall through to null */
  }
  return null;
}

export default function Investments() {
  const { isMasterView, activeProfileId } = useProfile();
  const investments = useLiveQuery(() => db.investments.toArray(), [], []);

  const filtered = useMemo(() => {
    if (isMasterView) return investments;
    return investments.filter((i) => i.profileId === activeProfileId);
  }, [investments, isMasterView, activeProfileId]);

  const { success, error } = useToast();
  const [platform, setPlatform] = useState(null);
  const [holdingId, setHoldingId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [busyAll, setBusyAll] = useState(false);

  // Derive the open holding from the live list so refreshes/edits show instantly.
  const holding = useMemo(
    () => (holdingId != null ? investments.find((i) => i.id === holdingId) ?? null : null),
    [investments, holdingId]
  );

  // Android back: holding view → platform list → grid. (Modals self-register and
  // close before these, since they're pushed onto the stack later.)
  useBackHandler(!!holding, () => setHoldingId(null));
  useBackHandler(!holding && !!platform, () => setPlatform(null));

  if (holding) {
    return <HoldingDetail holding={holding} onBack={() => setHoldingId(null)} onEdit={() => { setEditing(holding); setHoldingId(null); }} />;
  }

  if (platform) {
    const list = filtered.filter((i) => i.platform === platform.key);
    const canRefresh = REFRESHABLE.includes(platform.key);
    const refreshAll = async () => {
      setBusyAll(true);
      const apiKey = await getSetting('alphavantage.key', '');
      let ok = 0, fail = 0;
      for (const inv of list) {
        const v = await refreshHoldingValue(inv, apiKey);
        if (v != null) { await db.investments.update(inv.id, { currentValue: v }); ok++; }
        else fail++;
      }
      setBusyAll(false);
      if (ok) success(`Refreshed ${ok}${fail ? `, ${fail} need a manual update` : ''}`);
      else error('Could not fetch live prices — check the IDs or update manually.');
    };
    return (
      <div className="space-y-3 animate-fade-in">
        <div className="flex items-center gap-2">
          <button onClick={() => setPlatform(null)} className="fs-btn-ghost"><ChevronLeft className="w-4 h-4" /> Back</button>
          <h1 className="text-lg font-semibold">{platform.icon} {platform.label}</h1>
          <div className="ml-auto flex gap-2">
            {canRefresh && list.length > 0 && (
              <button onClick={refreshAll} disabled={busyAll} className="fs-btn-secondary">
                <RefreshCw className={cn('w-4 h-4', busyAll && 'animate-spin')} /> {busyAll ? 'Refreshing…' : 'Refresh all'}
              </button>
            )}
            <button onClick={() => setAdding(true)} className="fs-btn-primary"><Plus className="w-4 h-4" /> Add</button>
          </div>
        </div>
        {list.length === 0 ? (
          <Card><div className="p-2">
            <EmptyState
              icon={Coins}
              title="No holdings yet"
              hint={`Add your first ${platform.label} holding.`}
              action={<button className="fs-btn-primary" onClick={() => setAdding(true)}>Add holding</button>}
            />
          </div></Card>
        ) : (
          <ul className="space-y-2">
            {list.map((inv) => <HoldingRow key={inv.id} inv={inv} onClick={() => setHoldingId(inv.id)} />)}
          </ul>
        )}
        <InvestmentForm
          open={adding || !!editing}
          onClose={() => { setAdding(false); setEditing(null); }}
          platform={platform.key}
          editing={editing}
        />
      </div>
    );
  }

  // platform grid
  const byPlatform = Object.fromEntries(PLATFORMS.map((p) => [p.key, []]));
  for (const inv of filtered) {
    if (byPlatform[inv.platform]) byPlatform[inv.platform].push(inv);
  }

  const totalInvested = filtered.reduce((s, i) => s + Number(i.investedAmount ?? 0), 0);
  const totalCurrent = filtered.reduce((s, i) => s + Number(i.currentValue ?? i.investedAmount ?? 0), 0);
  const pnl = totalCurrent - totalInvested;
  const pnlPct = totalInvested > 0 ? (pnl / totalInvested) * 100 : 0;

  return (
    <div className="space-y-4 animate-fade-in">
      <Card>
        <CardBody className="grid grid-cols-3 gap-3">
          <Stat label="Invested" value={formatINRShort(totalInvested)} />
          <Stat label="Current" value={formatINRShort(totalCurrent)} />
          <Stat
            label="P&L"
            value={
              <span className={pnl >= 0 ? 'text-success' : 'text-danger'}>
                {pnl >= 0 ? '+' : ''}{formatINRShort(pnl)}
              </span>
            }
            sub={
              <span className={cn('inline-flex items-center gap-0.5', pnl >= 0 ? 'text-success' : 'text-danger')}>
                {pnl >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {formatPercent(pnlPct, 2)}
              </span>
            }
          />
        </CardBody>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {PLATFORMS.map((p) => {
          const items = byPlatform[p.key];
          const inv = items.reduce((s, i) => s + Number(i.investedAmount ?? 0), 0);
          const cur = items.reduce((s, i) => s + Number(i.currentValue ?? i.investedAmount ?? 0), 0);
          return (
            <button
              key={p.key}
              onClick={() => setPlatform(p)}
              className="fs-card p-4 text-left hover:border-primary/60 transition-colors"
              style={{ borderLeft: `3px solid ${p.color}` }}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xl">{p.icon}</span>
                <span className="text-sm font-semibold">{p.label}</span>
              </div>
              <p className="text-xs text-muted-fg">{items.length} holding{items.length !== 1 ? 's' : ''}</p>
              <p className="text-base font-semibold mt-1.5">{formatINRShort(cur)}</p>
              {inv > 0 && (
                <p className={cn('text-xs mt-0.5', cur >= inv ? 'text-success' : 'text-danger')}>
                  {cur >= inv ? '+' : ''}{formatINRShort(cur - inv)} ({formatPercent(inv > 0 ? ((cur - inv) / inv) * 100 : 0)})
                </p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div>
      <p className="text-[11px] text-muted-fg">{label}</p>
      <p className="text-sm font-semibold mt-0.5">{value}</p>
      {sub && <p className="text-[11px] mt-0.5">{sub}</p>}
    </div>
  );
}

function HoldingRow({ inv, onClick }) {
  const cur = Number(inv.currentValue ?? inv.investedAmount ?? 0);
  const invested = Number(inv.investedAmount ?? 0);
  const pnl = cur - invested;
  const pct = invested > 0 ? (pnl / invested) * 100 : 0;
  return (
    <li>
      <button onClick={onClick} className="w-full fs-card p-3.5 text-left flex items-center gap-3 hover:border-primary/60 transition-colors">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">{inv.name}</p>
          <p className="text-xs text-muted-fg truncate">
            {inv.identifier && `${inv.identifier} · `}
            Invested {formatINRShort(invested)}
          </p>
        </div>
        <div className="text-right">
          <p className="font-semibold text-sm">{formatINRShort(cur)}</p>
          <p className={cn('text-xs', pnl >= 0 ? 'text-success' : 'text-danger')}>
            {pnl >= 0 ? '+' : ''}{formatINRShort(pnl)} ({formatPercent(pct)})
          </p>
        </div>
      </button>
    </li>
  );
}

function HoldingDetail({ holding, onBack, onEdit }) {
  const { error, success } = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [recordPayment, setRecordPayment] = useState(false);
  const [editPrice, setEditPrice] = useState(false);
  const [priceDraft, setPriceDraft] = useState('');

  const chit = useLiveQuery(
    () => holding.platform === 'Chit' ? db.chitFunds.where({ investmentId: holding.id }).first() : null,
    [holding.id]
  );

  // Orders = transactions linked to this holding (each investment txn is an order).
  const orders = useLiveQuery(
    () => db.transactions.where('investmentId').equals(holding.id).toArray(),
    [holding.id], []
  );
  const sortedOrders = useMemo(
    () => [...(orders ?? [])].sort((a, b) => (b.dateTime ?? 0) - (a.dateTime ?? 0)),
    [orders]
  );

  const refresh = async () => {
    setBusy(true);
    try {
      const apiKey = await getSetting('alphavantage.key', '');
      const v = await refreshHoldingValue(holding, apiKey);
      if (v != null) {
        await db.investments.update(holding.id, { currentValue: v });
        success('Refreshed');
      } else {
        error('Could not fetch a live price — check the ID, or set the price manually below.');
      }
    } catch (e) {
      error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    await db.investments.delete(holding.id);
    if (chit) await db.chitFunds.delete(chit.id);
    success('Holding deleted');
    onBack();
  };

  const invested = Number(holding.investedAmount ?? 0);
  const cur = Number(holding.currentValue ?? invested);
  const pnl = cur - invested;
  const pct = invested > 0 ? (pnl / invested) * 100 : 0;

  const units = Number(holding.units ?? 0);
  const unitPrice = units > 0 ? cur / units : null;
  const savePrice = async () => {
    const p = Number(priceDraft);
    if (!isFinite(p) || p < 0) { error('Enter a valid price'); return; }
    await db.investments.update(holding.id, { currentValue: p * units });
    setEditPrice(false);
    success('Price updated');
  };

  // simple value-over-time chart: invested vs current at startDate vs today.
  const chartData = useMemo(() => {
    if (holding.platform === 'Chit' && chit?.installments?.length) {
      let paid = 0;
      return chit.installments
        .filter((i) => i.paid)
        .map((i) => {
          paid += Number(i.amount ?? chit.monthlyAmt ?? 0);
          return { date: fmtDate(i.date), value: paid };
        });
    }
    const data = [];
    if (holding.startDate) data.push({ date: fmtDate(holding.startDate), value: invested });
    data.push({ date: 'Now', value: cur });
    return data;
  }, [holding, chit, invested, cur]);

  return (
    <div className="space-y-3 animate-fade-in">
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="fs-btn-ghost"><ChevronLeft className="w-4 h-4" /> Back</button>
        <h1 className="text-lg font-semibold flex-1 truncate">{holding.name}</h1>
        <button onClick={onEdit} className="fs-btn-ghost"><Edit3 className="w-4 h-4" /></button>
        <button onClick={() => setConfirmDelete(true)} className="fs-btn-ghost text-danger"><Trash2 className="w-4 h-4" /></button>
      </div>

      <Card>
        <CardBody className="grid grid-cols-2 gap-4">
          <Stat label="Invested" value={formatINR(invested, { hidePaise: true })} />
          <Stat label="Current" value={formatINR(cur, { hidePaise: true })} />
          <Stat label="P&L" value={
            <span className={pnl >= 0 ? 'text-success' : 'text-danger'}>
              {pnl >= 0 ? '+' : ''}{formatINR(pnl, { hidePaise: true })}
            </span>
          } />
          <Stat label="Return" value={
            <span className={pnl >= 0 ? 'text-success' : 'text-danger'}>{formatPercent(pct)}</span>
          } />
          {holding.startDate && <Stat label="Started" value={fmtDate(holding.startDate)} />}
          {holding.maturityDate && <Stat label="Matures" value={fmtDate(holding.maturityDate)} />}
        </CardBody>
        {units > 0 && (
          <div className="px-4 pb-2 flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-fg">Price / NAV per unit</span>
            {editPrice ? (
              <span className="flex items-center gap-1.5">
                <input
                  inputMode="decimal"
                  autoFocus
                  className="fs-input w-28 py-1 text-right"
                  value={priceDraft}
                  onChange={(e) => setPriceDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') savePrice(); if (e.key === 'Escape') setEditPrice(false); }}
                />
                <button className="fs-btn-secondary text-xs px-2 py-1" onClick={savePrice}>Save</button>
                <button className="fs-btn-ghost text-xs px-2 py-1" onClick={() => setEditPrice(false)}>Cancel</button>
              </span>
            ) : (
              <button
                className="font-semibold tabular-nums inline-flex items-center gap-1.5 hover:text-primary"
                onClick={() => { setPriceDraft(unitPrice != null ? String(Number(unitPrice.toFixed(4))) : ''); setEditPrice(true); }}
                title="Tap to edit — updates current value as price × units"
              >
                {unitPrice != null ? formatINR(unitPrice) : '—'} <Edit3 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
        <div className="px-4 pb-4 flex gap-2">
          <button onClick={refresh} disabled={busy} className="fs-btn-secondary">
            <RefreshCw className={cn('w-4 h-4', busy && 'animate-spin')} /> Refresh value
          </button>
        </div>
      </Card>

      {chartData.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Value over time</CardTitle>
            <CardSubtitle>Estimated</CardSubtitle>
          </CardHeader>
          <CardBody>
            <div className="h-56">
              <ResponsiveContainer>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="rgb(var(--muted-fg))" />
                  <YAxis tick={{ fontSize: 11 }} stroke="rgb(var(--muted-fg))" tickFormatter={(v) => formatINRShort(v)} />
                  <Tooltip
                    contentStyle={{ background: 'rgb(var(--surface))', border: '1px solid rgb(var(--border))', borderRadius: 12 }}
                    formatter={(v) => formatINR(v, { hidePaise: true })}
                  />
                  <Line type="monotone" dataKey="value" stroke="rgb(var(--primary))" strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>
      )}

      {sortedOrders.length > 0 && (
        <Card>
          <div className="px-4 py-2 border-b border-border">
            <span className="text-xs font-semibold text-muted-fg uppercase tracking-wider">
              Orders ({sortedOrders.length})
            </span>
          </div>
          <ul className="divide-y divide-border">
            {sortedOrders.map((o) => (
              <li key={o.id} className="flex items-center justify-between px-4 py-2.5 text-sm gap-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    <span className={o.txnType === 'credit' ? 'text-danger' : 'text-success'}>
                      {o.txnType === 'credit' ? 'Sell' : 'Buy'}
                    </span>
                    {o.units ? (
                      <span className="text-muted-fg">
                        {' · '}{Number(o.units).toLocaleString('en-IN', { maximumFractionDigits: 4 })} units
                      </span>
                    ) : null}
                  </p>
                  <p className="text-[11px] text-muted-fg">
                    {fmtDate(o.dateTime)}{o.unitPrice ? ` · @ ${formatINR(o.unitPrice, { hidePaise: true })}` : ''}
                  </p>
                </div>
                <p className="font-semibold tabular-nums shrink-0">{formatINR(o.amount, { hidePaise: true })}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {holding.platform === 'Chit' && chit && (
        <ChitDetail chit={chit} onRecord={() => setRecordPayment(true)} />
      )}

      {holding.notes && (
        <Card>
          <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
          <CardBody>
            <p className="text-sm whitespace-pre-wrap">{holding.notes}</p>
          </CardBody>
        </Card>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={del}
        title="Delete this holding?"
        message="This cannot be undone."
        danger
        confirmText="Delete"
      />

      <ChitPaymentModal
        open={recordPayment}
        chit={chit}
        onClose={() => setRecordPayment(false)}
      />
    </div>
  );
}

function ChitDetail({ chit, onRecord }) {
  const paidCount = chit.installments.filter((i) => i.paid).length;
  const paidAmount = chit.installments.filter((i) => i.paid).reduce((s, i) => s + Number(i.amount ?? chit.monthlyAmt ?? 0), 0);
  const expected = Number(chit.expectedPayout ?? 0);

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <div>
          <CardTitle>Chit fund details</CardTitle>
          <CardSubtitle>{paidCount} of {chit.durationMonths} installments paid</CardSubtitle>
        </div>
        <button className="fs-btn-secondary" onClick={onRecord}>
          <Calendar className="w-4 h-4" /> Record
        </button>
      </CardHeader>
      <CardBody>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <Stat label="Monthly" value={formatINR(chit.monthlyAmt, { hidePaise: true })} />
          <Stat label="Paid so far" value={formatINR(paidAmount, { hidePaise: true })} />
          <Stat label="Members" value={chit.totalMembers} />
          <Stat label="Expected payout" value={expected ? formatINR(expected, { hidePaise: true }) : '—'} />
          {chit.myBidMonth && <Stat label="Bid month" value={`Month ${chit.myBidMonth}`} />}
          {chit.bidAmt && <Stat label="Bid amount" value={formatINR(chit.bidAmt, { hidePaise: true })} />}
        </div>
        <div>
          <Label>Installments</Label>
          <div className="grid grid-cols-6 gap-1.5">
            {chit.installments.map((i, idx) => (
              <div
                key={idx}
                className={cn(
                  'aspect-square rounded-lg text-[10px] flex flex-col items-center justify-center',
                  i.paid ? 'bg-success/15 text-success border border-success/30' : 'bg-muted text-muted-fg border border-border'
                )}
                title={fmtDate(i.date)}
              >
                <div className="font-semibold">M{i.month}</div>
                <div>{i.paid ? '✓' : '—'}</div>
              </div>
            ))}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function ChitPaymentModal({ open, chit, onClose }) {
  const { success } = useToast();
  const [month, setMonth] = useState('');
  useEffect(() => { if (open) setMonth(''); }, [open]);
  if (!chit) return null;
  const submit = async () => {
    const m = Number(month);
    if (!m) return;
    const updated = chit.installments.map((i) =>
      i.month === m ? { ...i, paid: true, date: Date.now(), amount: chit.monthlyAmt } : i
    );
    await db.chitFunds.update(chit.id, { installments: updated });
    success(`Marked month ${m} as paid`);
    onClose?.();
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record installment"
      footer={
        <>
          <button className="fs-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="fs-btn-primary" onClick={submit}>Mark paid</button>
        </>
      }
    >
      <Field label="Installment month">
        <Select
          value={month}
          onChange={setMonth}
          options={[
            { value: '', label: 'Pick month…' },
            ...chit.installments.filter((i) => !i.paid).map((i) => ({ value: i.month, label: `Month ${i.month}` }))
          ]}
        />
      </Field>
    </Modal>
  );
}

function InvestmentForm({ open, onClose, platform, editing }) {
  const { profiles, activeProfileId } = useProfile();
  const { success, error } = useToast();
  const [form, setForm] = useState({
    profileId: activeProfileId ?? '',
    platform,
    name: '',
    identifier: '',
    units: '',
    investedAmount: '',
    currentValue: '',
    startDate: '',
    maturityDate: '',
    notes: '',
    monthlyAmt: '',
    durationMonths: '',
    totalMembers: '',
    myBidMonth: '',
    bidAmt: '',
    expectedPayout: ''
  });

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        ...form,
        ...editing,
        startDate: editing.startDate ? new Date(editing.startDate).toISOString().slice(0, 10) : '',
        maturityDate: editing.maturityDate ? new Date(editing.maturityDate).toISOString().slice(0, 10) : ''
      });
    } else {
      setForm((f) => ({ ...f, platform, profileId: activeProfileId ?? (profiles[0]?.id ?? '') }));
    }
  }, [open, editing, platform]); // eslint-disable-line

  const save = async () => {
    try {
      if (!form.profileId) throw new Error('Pick a profile');
      if (!form.name) throw new Error('Name required');
      const payload = {
        profileId: Number(form.profileId),
        platform: form.platform,
        name: form.name,
        identifier: form.identifier || null,
        units: form.units ? Number(form.units) : null,
        investedAmount: Number(form.investedAmount || 0),
        currentValue: Number(form.currentValue || form.investedAmount || 0),
        startDate: form.startDate ? new Date(form.startDate).getTime() : null,
        maturityDate: form.maturityDate ? new Date(form.maturityDate).getTime() : null,
        notes: form.notes ?? ''
      };
      let id;
      if (editing) {
        id = editing.id;
        await db.investments.update(id, payload);
      } else {
        id = await db.investments.add(payload);
      }

      if (form.platform === 'Chit') {
        const months = Number(form.durationMonths || 0);
        const monthlyAmt = Number(form.monthlyAmt || 0);
        if (!months || !monthlyAmt) throw new Error('Chit needs months and monthly amount');
        const start = form.startDate ? new Date(form.startDate) : new Date();
        const installments = Array.from({ length: months }, (_, i) => {
          const d = new Date(start);
          d.setMonth(d.getMonth() + i);
          return { month: i + 1, date: d.getTime(), paid: false, amount: monthlyAmt };
        });
        const existing = await db.chitFunds.where({ investmentId: id }).first();
        const chitData = {
          investmentId: id,
          monthlyAmt,
          durationMonths: months,
          totalMembers: Number(form.totalMembers || months),
          myBidMonth: form.myBidMonth ? Number(form.myBidMonth) : null,
          bidAmt: form.bidAmt ? Number(form.bidAmt) : null,
          expectedPayout: form.expectedPayout ? Number(form.expectedPayout) : null,
          installments: existing?.installments ?? installments
        };
        if (existing) await db.chitFunds.update(existing.id, chitData);
        else await db.chitFunds.add(chitData);
      }

      success(editing ? 'Holding updated' : 'Holding added');
      onClose?.();
    } catch (e) {
      error(e.message);
    }
  };

  if (!open) return null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit holding' : `Add ${platform} holding`}
      size="lg"
      footer={
        <>
          <button className="fs-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="fs-btn-primary" onClick={save}>Save</button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Profile">
          <Select
            value={form.profileId}
            onChange={(v) => setForm({ ...form, profileId: v })}
            options={profiles.map((p) => ({ value: p.id, label: p.name }))}
          />
        </Field>
        <Field label="Name">
          <input className="fs-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Axis Bluechip" />
        </Field>
        <Field
          label={platform === 'MF' ? 'AMFI scheme code' : platform === 'Stock' ? 'Ticker (e.g. RELIANCE.BSE)' : platform === 'Crypto' ? 'CoinGecko id (e.g. bitcoin)' : 'Identifier / folio'}
          hint={platform === 'MF' ? 'From api.mfapi.in/mf/search?q=NAME — the schemeCode number' : platform === 'Stock' ? 'TICKER.BSE or .NSE; needs an Alpha Vantage key in Preferences' : platform === 'Crypto' ? 'CoinGecko coin id, e.g. bitcoin, ethereum' : 'Used to fetch live prices'}
        >
          <input className="fs-input" value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })} placeholder="Optional" />
        </Field>
        {(platform === 'MF' || platform === 'Stock' || platform === 'Crypto' || platform === 'Gold') && (
          <Field label="Units / quantity">
            <input inputMode="decimal" className="fs-input" value={form.units} onChange={(e) => setForm({ ...form, units: e.target.value })} placeholder="0" />
          </Field>
        )}
        <Field label="Invested (₹)">
          <input inputMode="decimal" className="fs-input" value={form.investedAmount} onChange={(e) => setForm({ ...form, investedAmount: e.target.value })} placeholder="0" />
        </Field>
        <Field label="Current value (₹)">
          <input inputMode="decimal" className="fs-input" value={form.currentValue} onChange={(e) => setForm({ ...form, currentValue: e.target.value })} placeholder="defaults to invested" />
        </Field>
        <Field label="Start date">
          <input type="date" className="fs-input" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
        </Field>
        <Field label="Maturity (optional)">
          <input type="date" className="fs-input" value={form.maturityDate} onChange={(e) => setForm({ ...form, maturityDate: e.target.value })} />
        </Field>
      </div>

      {platform === 'Chit' && (
        <>
          <hr className="my-3 border-border" />
          <p className="text-xs font-semibold text-muted-fg uppercase tracking-wider mb-2">Chit-fund details</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Monthly amount (₹)">
              <input inputMode="decimal" className="fs-input" value={form.monthlyAmt} onChange={(e) => setForm({ ...form, monthlyAmt: e.target.value })} />
            </Field>
            <Field label="Duration (months)">
              <input inputMode="numeric" className="fs-input" value={form.durationMonths} onChange={(e) => setForm({ ...form, durationMonths: e.target.value })} />
            </Field>
            <Field label="Total members">
              <input inputMode="numeric" className="fs-input" value={form.totalMembers} onChange={(e) => setForm({ ...form, totalMembers: e.target.value })} />
            </Field>
            <Field label="My bid month">
              <input inputMode="numeric" className="fs-input" value={form.myBidMonth} onChange={(e) => setForm({ ...form, myBidMonth: e.target.value })} />
            </Field>
            <Field label="Bid amount">
              <input inputMode="decimal" className="fs-input" value={form.bidAmt} onChange={(e) => setForm({ ...form, bidAmt: e.target.value })} />
            </Field>
            <Field label="Expected payout">
              <input inputMode="decimal" className="fs-input" value={form.expectedPayout} onChange={(e) => setForm({ ...form, expectedPayout: e.target.value })} />
            </Field>
          </div>
        </>
      )}

      <Field label="Notes">
        <textarea className="fs-input min-h-[80px]" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder={platform === 'FD' || platform === 'PPF' || platform === 'EPF' ? 'e.g. "7.1% p.a."' : 'Anything to remember'} />
      </Field>
    </Modal>
  );
}
