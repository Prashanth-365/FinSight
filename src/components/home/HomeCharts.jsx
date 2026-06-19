import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  BarChart, Bar, XAxis, YAxis, ReferenceLine, Tooltip, LabelList, Cell,
  PieChart, Pie, ResponsiveContainer
} from 'recharts';
import { BarChart3, PieChart as PieIcon, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { db } from '@/db/database.js';
import { useProfile } from '@/context/ProfileContext.jsx';
import { Card } from '@/components/ui/Card.jsx';
import { Select } from '@/components/ui/Select.jsx';
import { formatINR, formatINRShort } from '@/lib/currency.js';
import { bucketStart, bucketLabel, transferCategoryIds, tsToLocalISO, cn } from '@/lib/utils.js';

// Fixed chart colours (close to the success/danger theme vars in both modes).
const GREEN = '#10b981';
const RED = '#ef4444';

const GRAN_DEFAULTS = { day: 14, week: 12, month: 12 };
const GRAN_LABEL = { day: 'Daily', week: 'Weekly', month: 'Monthly' };
const BUCKET_PX = 56;

// Move a bucket-start timestamp by `delta` buckets (negative = older).
function stepBucket(ts, granularity, delta) {
  const d = new Date(ts);
  if (granularity === 'day') d.setDate(d.getDate() + delta);
  else if (granularity === 'week') d.setDate(d.getDate() + delta * 7);
  else d.setMonth(d.getMonth() + delta);
  return bucketStart(d.getTime(), granularity);
}

export default function HomeCharts() {
  const { activeProfileId, isMasterView } = useProfile();
  const categories = useLiveQuery(() => db.categories.toArray(), [], []);
  const transferIds = useMemo(() => transferCategoryIds(categories), [categories]);
  const catById = useMemo(() => {
    const m = new Map();
    for (const c of categories) m.set(c.id, c);
    return m;
  }, [categories]);

  return (
    <div className="space-y-4">
      <CashflowChart
        isMasterView={isMasterView}
        activeProfileId={activeProfileId}
        transferIds={transferIds}
      />
      <CategoryDonut
        isMasterView={isMasterView}
        activeProfileId={activeProfileId}
        transferIds={transferIds}
        catById={catById}
      />
    </div>
  );
}

/* ─────────────────────── Chart A — diverging cash-flow bars ─────────────────────── */

function CashflowChart({ isMasterView, activeProfileId, transferIds }) {
  const [granularity, setGranularity] = useState('month');
  const [pageCount, setPageCount] = useState(GRAN_DEFAULTS.month);

  const scrollRef = useRef(null);
  const anchorRightRef = useRef(true);   // keep newest bucket in view until user scrolls away
  const prependRef = useRef(null);        // holds scrollWidth captured before loading older buckets

  const nowBucket = bucketStart(Date.now(), granularity);
  const windowStart = stepBucket(nowBucket, granularity, -(pageCount - 1));

  // Lazy Dexie paging: only the visible window is read; widening pageCount refetches.
  const winTxns = useLiveQuery(
    () => db.transactions.where('dateTime').aboveOrEqual(windowStart).toArray(),
    [windowStart],
    []
  );

  // Profile-aware earliest transaction → whether older buckets remain to load.
  const earliest = useLiveQuery(async () => {
    const coll = db.transactions.orderBy('dateTime');
    const first = isMasterView
      ? await coll.first()
      : await coll.filter((t) => t.profileId === activeProfileId).first();
    return first?.dateTime ?? null;
  }, [isMasterView, activeProfileId]);

  const hasOlder = earliest != null && bucketStart(earliest, granularity) < windowStart;

  const buckets = useMemo(() => {
    const map = new Map();
    let b = windowStart;
    while (b <= nowBucket) {
      map.set(b, { key: b, label: bucketLabel(b, granularity), credit: 0, debit: 0, net: 0, netLabel: null });
      b = stepBucket(b, granularity, 1);
    }
    for (const t of winTxns) {
      if (!isMasterView && t.profileId !== activeProfileId) continue;
      if (transferIds.has(t.categoryId)) continue;
      const row = map.get(bucketStart(t.dateTime, granularity));
      if (!row) continue;
      if (t.txnType === 'credit') row.credit += t.amount;
      else row.debit += t.amount;
    }
    const arr = [...map.values()];
    for (const r of arr) {
      r.net = r.credit - r.debit;
      const active = r.credit !== 0 || r.debit !== 0;
      r.debit = -r.debit; // store debit as negative so it draws below the y=0 baseline
      r.netLabel = active ? r.net : null;
    }
    return arr;
  }, [winTxns, windowStart, nowBucket, granularity, isMasterView, activeProfileId, transferIds]);

  const hasData = buckets.some((b) => b.netLabel != null);

  const changeGranularity = (g) => {
    setGranularity(g);
    setPageCount(GRAN_DEFAULTS[g]);
    anchorRightRef.current = true;
  };

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    anchorRightRef.current = el.scrollLeft + el.clientWidth >= el.scrollWidth - 8;
    if (el.scrollLeft < 48 && hasOlder && prependRef.current == null) {
      prependRef.current = el.scrollWidth;
      setPageCount((c) => c + GRAN_DEFAULTS[granularity]);
    }
  };

  // After buckets change: restore scroll position when older buckets were prepended,
  // otherwise keep the newest bucket pinned to the right.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (prependRef.current != null) {
      el.scrollLeft += el.scrollWidth - prependRef.current;
      prependRef.current = null;
    } else if (anchorRightRef.current) {
      el.scrollLeft = el.scrollWidth;
    }
  }, [buckets]);

  const chartWidth = Math.max(buckets.length * BUCKET_PX, 320);

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <BarChart3 className="w-4 h-4 text-primary" /> Income vs spending
        </h3>
        <div className="inline-flex rounded-lg border border-border overflow-hidden text-xs">
          {['day', 'week', 'month'].map((g) => (
            <button
              key={g}
              onClick={() => changeGranularity(g)}
              className={cn('px-2.5 py-1 transition-colors',
                granularity === g ? 'bg-primary text-primary-fg' : 'text-muted-fg hover:bg-muted')}
            >
              {GRAN_LABEL[g]}
            </button>
          ))}
        </div>
      </div>

      {!hasData ? (
        <p className="text-xs text-muted-fg text-center py-10">No transactions in this period yet.</p>
      ) : (
        <>
          <div ref={scrollRef} onScroll={onScroll} className="overflow-x-auto hide-scrollbar text-muted-fg">
            <BarChart
              width={chartWidth}
              height={240}
              data={buckets}
              margin={{ top: 22, right: 10, left: 10, bottom: 4 }}
              barGap={2}
            >
              <XAxis dataKey="label" interval={0} axisLine={false} tickLine={false}
                tick={{ fontSize: 9, fill: 'currentColor' }} />
              <YAxis hide domain={['dataMin', 'dataMax']} />
              <ReferenceLine y={0} stroke="rgb(var(--border))" />
              <Tooltip content={<CashflowTooltip />} cursor={{ fill: 'rgb(var(--muted) / 0.4)' }} />
              <Bar dataKey="credit" fill={GREEN} radius={[3, 3, 0, 0]} maxBarSize={16} isAnimationActive={false}>
                <LabelList dataKey="netLabel" content={<NetLabel />} />
              </Bar>
              <Bar dataKey="debit" fill={RED} radius={[0, 0, 3, 3]} maxBarSize={16} isAnimationActive={false} />
            </BarChart>
          </div>
          <div className="flex items-center justify-center gap-4 mt-2 text-[11px] text-muted-fg">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: GREEN }} /> Credit</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: RED }} /> Debit</span>
            <span>Net labelled per bar</span>
          </div>
          {hasOlder && (
            <p className="text-[11px] text-muted-fg text-center mt-1">Scroll left to load older periods.</p>
          )}
        </>
      )}
    </Card>
  );
}

function NetLabel({ x, y, width, value }) {
  if (value == null || width == null) return null;
  return (
    <text
      x={x + width / 2}
      y={11}
      textAnchor="middle"
      fontSize={9}
      style={{ fill: value >= 0 ? GREEN : RED, fontWeight: 600 }}
    >
      {formatINRShort(value)}
    </text>
  );
}

function CashflowTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const credit = payload.find((p) => p.dataKey === 'credit')?.value ?? 0;
  const debit = Math.abs(payload.find((p) => p.dataKey === 'debit')?.value ?? 0);
  const net = credit - debit;
  return (
    <div className="fs-card p-2.5 text-xs shadow-card">
      <p className="font-medium mb-1">{label}</p>
      <p className="text-success">In · {formatINR(credit, { hidePaise: true })}</p>
      <p className="text-danger">Out · {formatINR(debit, { hidePaise: true })}</p>
      <p className={cn('mt-0.5 font-medium', net >= 0 ? 'text-success' : 'text-danger')}>
        Net · {formatINR(net, { hidePaise: true })}
      </p>
    </div>
  );
}

/* ─────────────────────── Chart B — category spend donut ─────────────────────── */

const DONUT_COLORS = ['#3b82f6', '#f97316', '#10b981', '#a855f7', '#ec4899', '#eab308', '#06b6d4', '#ef4444', '#14b8a6', '#8b5cf6'];

function parseMonth(value) {
  const [y, m] = (value ?? '').split('-').map(Number);
  if (!y || !m) return null;
  return { y, m: m - 1 };
}

function CategoryDonut({ isMasterView, activeProfileId, transferIds, catById }) {
  const navigate = useNavigate();
  const [mode, setMode] = useState('month');     // 'month' | 'year'
  const [preset, setPreset] = useState('this');  // 'this' | 'previous' | 'custom'
  const [fromMonth, setFromMonth] = useState('');
  const [toMonth, setToMonth] = useState('');
  const [fromYear, setFromYear] = useState('');
  const [toYear, setToYear] = useState('');

  const range = useMemo(() => {
    const now = new Date();
    if (mode === 'month') {
      if (preset === 'this') {
        const s = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
        const e = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime() - 1;
        return [s, e];
      }
      if (preset === 'previous') {
        const s = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
        const e = new Date(now.getFullYear(), now.getMonth(), 1).getTime() - 1;
        return [s, e];
      }
      const f = parseMonth(fromMonth) ?? { y: now.getFullYear(), m: now.getMonth() };
      const t = parseMonth(toMonth) ?? f;
      const a = new Date(f.y, f.m, 1).getTime();
      const b = new Date(t.y, t.m + 1, 1).getTime() - 1;
      return [Math.min(a, b), Math.max(a, b)];
    }
    // yearly
    if (preset === 'this') {
      return [new Date(now.getFullYear(), 0, 1).getTime(), new Date(now.getFullYear() + 1, 0, 1).getTime() - 1];
    }
    if (preset === 'previous') {
      return [new Date(now.getFullYear() - 1, 0, 1).getTime(), new Date(now.getFullYear(), 0, 1).getTime() - 1];
    }
    const fy = Number(fromYear) || now.getFullYear();
    const ty = Number(toYear) || fy;
    const a = new Date(Math.min(fy, ty), 0, 1).getTime();
    const b = new Date(Math.max(fy, ty) + 1, 0, 1).getTime() - 1;
    return [a, b];
  }, [mode, preset, fromMonth, toMonth, fromYear, toYear]);

  const rangeTxns = useLiveQuery(
    () => db.transactions.where('dateTime').between(range[0], range[1], true, true).toArray(),
    [range[0], range[1]],
    []
  );

  const { rows, total } = useMemo(() => {
    const map = new Map();
    for (const t of rangeTxns) {
      if (t.txnType !== 'debit') continue;
      if (!isMasterView && t.profileId !== activeProfileId) continue;
      if (transferIds.has(t.categoryId)) continue;
      const key = t.categoryId ?? 'uncat';
      const cat = catById.get(t.categoryId);
      const cur = map.get(key) ?? {
        id: key,
        name: cat?.name ?? 'Uncategorized',
        icon: cat?.icon ?? '🏷️',
        color: cat?.color ?? null,
        value: 0
      };
      cur.value += t.amount;
      map.set(key, cur);
    }
    const arr = [...map.values()].sort((a, b) => b.value - a.value);
    arr.forEach((d, i) => { if (!d.color) d.color = DONUT_COLORS[i % DONUT_COLORS.length]; });
    const total = arr.reduce((s, d) => s + d.value, 0);
    return { rows: arr, total };
  }, [rangeTxns, isMasterView, activeProfileId, transferIds, catById]);

  const presetOptions = [
    { value: 'this', label: mode === 'month' ? 'This month' : 'This year' },
    { value: 'previous', label: mode === 'month' ? 'Previous month' : 'Previous year' },
    { value: 'custom', label: 'Custom' }
  ];

  // Tapping a legend row opens Transactions filtered to that category over the
  // donut's currently-selected date range (mapped to concrete from/to dates).
  const openCategory = (d) => {
    navigate('/transactions', {
      state: {
        filters: {
          categoryId: typeof d.id === 'number' ? String(d.id) : '',
          from: tsToLocalISO(range[0]).slice(0, 10),
          to: tsToLocalISO(range[1]).slice(0, 10)
        }
      }
    });
  };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <PieIcon className="w-4 h-4 text-primary" /> Spending by category
        </h3>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="inline-flex rounded-lg border border-border overflow-hidden text-xs">
          {[['month', 'Monthly'], ['year', 'Yearly']].map(([m, lbl]) => (
            <button
              key={m}
              onClick={() => { setMode(m); setPreset('this'); }}
              className={cn('px-2.5 py-1 transition-colors',
                mode === m ? 'bg-primary text-primary-fg' : 'text-muted-fg hover:bg-muted')}
            >
              {lbl}
            </button>
          ))}
        </div>
        <Select value={preset} onChange={setPreset} options={presetOptions} className="w-auto text-xs" />
        {preset === 'custom' && mode === 'month' && (
          <div className="flex items-center gap-1.5">
            <input type="month" className="fs-input w-auto py-1.5 text-xs" value={fromMonth}
              onChange={(e) => setFromMonth(e.target.value)} aria-label="From month" />
            <span className="text-muted-fg text-xs">to</span>
            <input type="month" className="fs-input w-auto py-1.5 text-xs" value={toMonth}
              onChange={(e) => setToMonth(e.target.value)} aria-label="To month (optional)" />
          </div>
        )}
        {preset === 'custom' && mode === 'year' && (
          <div className="flex items-center gap-1.5">
            <input type="number" inputMode="numeric" placeholder="From" className="fs-input w-20 py-1.5 text-xs"
              value={fromYear} onChange={(e) => setFromYear(e.target.value)} aria-label="From year" />
            <span className="text-muted-fg text-xs">to</span>
            <input type="number" inputMode="numeric" placeholder="To" className="fs-input w-20 py-1.5 text-xs"
              value={toYear} onChange={(e) => setToYear(e.target.value)} aria-label="To year (optional)" />
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-muted-fg text-center py-10">No spending in this period.</p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3 items-center">
          <div className="relative h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={rows}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={58}
                  outerRadius={88}
                  paddingAngle={rows.length > 1 ? 2 : 0}
                  stroke="none"
                  isAnimationActive={false}
                >
                  {rows.map((d) => <Cell key={d.id} fill={d.color} />)}
                </Pie>
                <Tooltip content={<DonutTooltip total={total} />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-[10px] text-muted-fg">Total spend</span>
              <span className="text-sm font-semibold">{formatINR(total, { hidePaise: true })}</span>
            </div>
          </div>

          <ul className="space-y-0.5 max-h-[200px] overflow-y-auto hide-scrollbar pr-1">
            {rows.map((d) => {
              const pct = total > 0 ? (d.value / total) * 100 : 0;
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => openCategory(d)}
                    className="group w-full flex items-center gap-2 text-sm rounded-lg px-1.5 py-1 hover:bg-muted/60 transition-colors text-left"
                    title={`View ${d.name} transactions for this period`}
                  >
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                    <span className="flex-1 truncate">{d.icon} {d.name}</span>
                    <span className="tabular-nums">{formatINR(d.value, { hidePaise: true })}</span>
                    <span className="text-muted-fg tabular-nums w-11 text-right">{pct.toFixed(1)}%</span>
                    <ChevronRight className="w-3.5 h-3.5 text-muted-fg opacity-0 group-hover:opacity-100 shrink-0" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  );
}

function DonutTooltip({ active, payload, total }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const pct = total > 0 ? (d.value / total) * 100 : 0;
  return (
    <div className="fs-card p-2.5 text-xs shadow-card">
      <p className="font-medium">{d.icon} {d.name}</p>
      <p className="text-muted-fg mt-0.5">
        {formatINR(d.value, { hidePaise: true })} · {pct.toFixed(1)}%
      </p>
    </div>
  );
}
