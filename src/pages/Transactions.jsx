import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, reindexSlNo } from '@/db/database.js';
import { useProfile } from '@/context/ProfileContext.jsx';
import { Card } from '@/components/ui/Card.jsx';
import { Select } from '@/components/ui/Select.jsx';
import { Avatar } from '@/components/ui/Avatar.jsx';
import { Sheet, Modal, ConfirmDialog } from '@/components/ui/Modal.jsx';
import { Field } from '@/components/ui/Input.jsx';
import { Combobox } from '@/components/ui/Combobox.jsx';
import { TransactionSheet } from '@/components/transaction/TransactionSheet.jsx';
import { EmptyState } from '@/components/ui/Empty.jsx';
import { useToast } from '@/components/ui/Toast.jsx';
import {
  Filter, Trash2, Edit3, ListOrdered, X, MousePointer2, CheckSquare, Square
} from 'lucide-react';
import { formatINR } from '@/lib/currency.js';
import { fmtDate, fmtDateTime, cn, maskNumber, applyTxnDeltaToBalances, freqSorted } from '@/lib/utils.js';

const LONG_PRESS_MS = 450;

export default function Transactions() {
  const { isMasterView, activeProfileId } = useProfile();
  const { success } = useToast();

  const txns = useLiveQuery(() => db.transactions.orderBy('dateTime').reverse().toArray(), [], []);
  const accounts = useLiveQuery(() => db.accounts.toArray(), [], []);
  const categories = useLiveQuery(() => db.categories.toArray(), [], []);
  const profiles = useLiveQuery(() => db.profiles.toArray(), [], []);

  const [filters, setFilters] = useState({
    accountId: '', from: '', to: '', categoryId: '', subCategoryId: '',
    profileId: '', txnType: '', minAmount: '', maxAmount: '', tag: ''
  });
  const [filterOpen, setFilterOpen] = useState(false);

  const [detailTxn, setDetailTxn] = useState(null);   // row clicked → details modal
  const [editingTxn, setEditingTxn] = useState(null); // editing in TransactionSheet
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const filtered = useMemo(() => {
    let out = txns;
    if (!isMasterView) out = out.filter((t) => t.profileId === activeProfileId);
    if (filters.accountId) out = out.filter((t) => t.accountId === Number(filters.accountId));
    if (filters.from) out = out.filter((t) => t.dateTime >= new Date(filters.from).getTime());
    if (filters.to) out = out.filter((t) => t.dateTime <= new Date(filters.to).getTime() + 86399000);
    if (filters.categoryId) out = out.filter((t) => t.categoryId === Number(filters.categoryId));
    if (filters.subCategoryId) out = out.filter((t) => t.subCategoryId === Number(filters.subCategoryId));
    if (filters.profileId) out = out.filter((t) => t.profileId === Number(filters.profileId));
    if (filters.txnType) out = out.filter((t) => t.txnType === filters.txnType);
    if (filters.minAmount) out = out.filter((t) => t.amount >= Number(filters.minAmount));
    if (filters.maxAmount) out = out.filter((t) => t.amount <= Number(filters.maxAmount));
    if (filters.tag) out = out.filter((t) => (t.tags ?? []).some((x) => x.toLowerCase().includes(filters.tag.toLowerCase())));
    return out;
  }, [txns, filters, isMasterView, activeProfileId]);

  const topCats = categories.filter((c) => c.parentId == null);
  const subCats = filters.categoryId ? categories.filter((c) => c.parentId === Number(filters.categoryId)) : [];

  const totals = useMemo(() => {
    let cr = 0, dr = 0;
    for (const t of filtered) {
      if (t.txnType === 'credit') cr += t.amount; else dr += t.amount;
    }
    return { cr, dr, net: cr - dr };
  }, [filtered]);

  const toggleSel = (id) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const exitSelection = () => {
    setSelectionMode(false);
    setSelected(new Set());
  };

  const deleteSelected = async () => {
    const ids = [...selected];
    const all = await db.transactions.bulkGet(ids);
    const accountsMap = new Map((await db.accounts.toArray()).map((a) => [a.id, a]));
    for (const t of all) {
      if (!t) continue;
      // Reverse balance delta
      const acc = accountsMap.get(t.accountId);
      if (acc) {
        const reverse = (t.txnType === 'credit' ? -1 : 1) * Number(t.amount ?? 0);
        const balances = applyTxnDeltaToBalances(acc, t.profileId, reverse);
        await db.accounts.update(acc.id, { balances, balance: null });
        accountsMap.set(acc.id, { ...acc, balances });
      }
      // Reverse invested-amount delta if linked to an investment
      if (t.investmentId) {
        const inv = await db.investments.get(t.investmentId);
        if (inv) {
          const invReverse = (t.txnType === 'credit' ? 1 : -1) * Number(t.amount ?? 0);
          await db.investments.update(inv.id, {
            investedAmount: Math.max(0, Number(inv.investedAmount ?? 0) + invReverse)
          });
        }
      }
    }
    await db.transactions.bulkDelete(ids);
    await reindexSlNo();
    success(`Deleted ${ids.length} transaction${ids.length > 1 ? 's' : ''}`);
    exitSelection();
  };

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  // Row interaction handlers — supports tap (open detail), long-press (start selection),
  // and click-in-selection-mode (toggle).
  const handleRow = (txn) => {
    if (selectionMode) return toggleSel(txn.id);
    setDetailTxn(txn);
  };

  return (
    <div className="space-y-3 animate-fade-in">
      {/* Top bar */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex-1 min-w-[180px]">
          <Select
            value={filters.accountId}
            onChange={(v) => setFilters({ ...filters, accountId: v })}
            options={[
              { value: '', label: 'All accounts' },
              ...accounts.map((a) => ({ value: a.id, label: `${a.name} ${maskNumber(a.number)}` }))
            ]}
          />
        </div>
        <input type="date" className="fs-input w-auto" value={filters.from}
          onChange={(e) => setFilters({ ...filters, from: e.target.value })} aria-label="From date" />
        <input type="date" className="fs-input w-auto" value={filters.to}
          onChange={(e) => setFilters({ ...filters, to: e.target.value })} aria-label="To date" />
        <button onClick={() => setFilterOpen(true)} className="fs-btn-secondary relative" aria-label="More filters">
          <Filter className="w-4 h-4" /> Filters
          {activeFilterCount > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary text-primary-fg text-[10px] grid place-items-center">
              {activeFilterCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setSelectionMode((m) => { if (m) setSelected(new Set()); return !m; })}
          className={cn('fs-btn-secondary', selectionMode && 'border-primary text-primary')}
          aria-label="Toggle select mode"
          title="Select mode"
        >
          <MousePointer2 className="w-4 h-4" /> {selectionMode ? 'Done' : 'Select'}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <SummaryPill label="Credits" value={formatINR(totals.cr, { hidePaise: true })} tone="success" />
        <SummaryPill label="Debits" value={formatINR(totals.dr, { hidePaise: true })} tone="danger" />
        <SummaryPill label="Net" value={formatINR(totals.net, { hidePaise: true })} tone={totals.net >= 0 ? 'success' : 'danger'} />
      </div>

      {selectionMode && (
        <div className="fs-card sticky top-[60px] z-30 px-3 py-2 flex items-center justify-between gap-2 animate-slide-up">
          <span className="text-sm font-medium">
            {selected.size === 0 ? 'Tap rows to select' : `${selected.size} selected`}
          </span>
          <div className="flex gap-1.5">
            <button className="fs-btn-ghost" onClick={exitSelection} aria-label="Cancel">
              <X className="w-4 h-4" />
            </button>
            <button
              className="fs-btn-secondary text-xs"
              disabled={selected.size === 0}
              onClick={() => setBulkEditOpen(true)}
            >
              <Edit3 className="w-3.5 h-3.5" /> Edit
            </button>
            <button
              className="fs-btn-danger text-xs"
              disabled={selected.size === 0}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <Card><div className="p-2">
          <EmptyState
            icon={ListOrdered}
            title="No transactions match"
            hint="Try clearing some filters, or add a new transaction."
          />
        </div></Card>
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {filtered.map((t) => (
              <TxnRow
                key={t.id}
                txn={t}
                categories={categories}
                accounts={accounts}
                profiles={profiles}
                selectionMode={selectionMode}
                selected={selected.has(t.id)}
                onPress={() => handleRow(t)}
                onLongPress={() => {
                  setSelectionMode(true);
                  setSelected((s) => new Set(s).add(t.id));
                }}
              />
            ))}
          </ul>
        </Card>
      )}

      <FilterDrawer
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        filters={filters}
        setFilters={setFilters}
        topCats={topCats}
        subCats={subCats}
        profiles={profiles}
      />

      <TxnDetail
        txn={detailTxn}
        onClose={() => setDetailTxn(null)}
        onEdit={() => { setEditingTxn(detailTxn); setDetailTxn(null); }}
        onDelete={async () => {
          const t = detailTxn;
          setDetailTxn(null);
          if (!t) return;
          const acc = await db.accounts.get(t.accountId);
          if (acc) {
            const reverse = (t.txnType === 'credit' ? -1 : 1) * Number(t.amount);
            const balances = applyTxnDeltaToBalances(acc, t.profileId, reverse);
            await db.accounts.update(acc.id, { balances, balance: null });
          }
          if (t.investmentId) {
            const inv = await db.investments.get(t.investmentId);
            if (inv) {
              const invReverse = (t.txnType === 'credit' ? 1 : -1) * Number(t.amount);
              await db.investments.update(inv.id, {
                investedAmount: Math.max(0, Number(inv.investedAmount ?? 0) + invReverse)
              });
            }
          }
          await db.transactions.delete(t.id);
          await reindexSlNo();
          success('Transaction deleted');
        }}
        categories={categories}
        accounts={accounts}
        profiles={profiles}
      />

      <TransactionSheet
        open={!!editingTxn}
        onClose={() => setEditingTxn(null)}
        editing={editingTxn}
      />

      <BulkEditModal
        open={bulkEditOpen}
        onClose={() => setBulkEditOpen(false)}
        ids={[...selected]}
        topCats={topCats}
        allCats={categories}
        accounts={accounts}
        profiles={profiles}
        onDone={() => { setBulkEditOpen(false); exitSelection(); success('Bulk edit applied'); }}
      />

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={deleteSelected}
        title={`Delete ${selected.size} transaction${selected.size > 1 ? 's' : ''}?`}
        message="Balances on the affected accounts will be reversed. This cannot be undone."
        danger
        confirmText="Delete"
      />
    </div>
  );
}

/* ───────── Row with long-press support ───────── */

function TxnRow({ txn, categories, accounts, profiles, selectionMode, selected, onPress, onLongPress }) {
  const t = txn;
  const cat = categories.find((c) => c.id === t.categoryId);
  const sub = categories.find((c) => c.id === t.subCategoryId);
  const acct = accounts.find((a) => a.id === t.accountId);
  const profile = profiles.find((p) => p.id === t.profileId);

  const timerRef = useRef(null);
  const movedRef = useRef(false);

  const startPress = () => {
    movedRef.current = false;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (!movedRef.current) {
        // haptic if available
        try { navigator.vibrate?.(35); } catch {}
        onLongPress?.();
      }
    }, LONG_PRESS_MS);
  };
  const cancelPress = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  };
  const endPress = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      if (!movedRef.current) onPress?.();
    }
  };
  const onMove = () => { movedRef.current = true; cancelPress(); };

  return (
    <li
      onPointerDown={startPress}
      onPointerUp={endPress}
      onPointerLeave={cancelPress}
      onPointerCancel={cancelPress}
      onPointerMove={onMove}
      onContextMenu={(e) => { e.preventDefault(); onLongPress?.(); }}
      className={cn(
        'flex items-center gap-3 p-3 cursor-pointer transition-colors select-none',
        selected ? 'bg-primary/10' : 'hover:bg-muted/40'
      )}
    >
      {selectionMode && (
        <span className="shrink-0">
          {selected ? <CheckSquare className="w-5 h-5 text-primary" /> : <Square className="w-5 h-5 text-muted-fg" />}
        </span>
      )}
      <span
        className="w-10 h-10 rounded-xl inline-flex items-center justify-center text-lg shrink-0"
        style={{ background: (cat?.color ?? '#94a3b8') + '22', color: cat?.color ?? '#94a3b8' }}
      >
        {cat?.icon ?? '🏷️'}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="font-medium text-sm truncate">
            {cat?.name ?? '—'}{sub && <span className="text-muted-fg"> · {sub.name}</span>}
          </p>
          {profile && <Avatar size="xs" name={profile.name} avatar={profile.avatar} color={profile.color} />}
        </div>
        <p className="text-xs text-muted-fg truncate">
          {fmtDate(t.dateTime)} · {acct?.name ?? '—'}{t.description ? ` · ${t.description}` : ''}
        </p>
      </div>
      <p className={cn('text-sm font-semibold tabular-nums shrink-0', t.txnType === 'credit' ? 'text-success' : 'text-danger')}>
        {t.txnType === 'credit' ? '+' : '−'} {formatINR(t.amount, { hidePaise: true })}
      </p>
    </li>
  );
}

/* ───────── Detail modal ───────── */

function TxnDetail({ txn, onClose, onEdit, onDelete, categories, accounts, profiles }) {
  if (!txn) return null;
  const cat = categories.find((c) => c.id === txn.categoryId);
  const sub = categories.find((c) => c.id === txn.subCategoryId);
  const acct = accounts.find((a) => a.id === txn.accountId);
  const profile = profiles.find((p) => p.id === txn.profileId);
  return (
    <Modal
      open={!!txn}
      onClose={onClose}
      title="Transaction details"
      footer={
        <>
          <button className="fs-btn-ghost text-danger" onClick={onDelete}>
            <Trash2 className="w-4 h-4" /> Delete
          </button>
          <button className="fs-btn-primary" onClick={onEdit}>
            <Edit3 className="w-4 h-4" /> Edit
          </button>
        </>
      }
    >
      <div className="flex items-center gap-3 mb-3">
        <span
          className="w-12 h-12 rounded-xl inline-flex items-center justify-center text-2xl"
          style={{ background: (cat?.color ?? '#94a3b8') + '22', color: cat?.color ?? '#94a3b8' }}
        >
          {cat?.icon ?? '🏷️'}
        </span>
        <div className="flex-1">
          <p className="font-semibold">{cat?.name ?? '—'}{sub && <span className="text-muted-fg"> · {sub.name}</span>}</p>
          <p className={cn('text-2xl font-bold tabular-nums', txn.txnType === 'credit' ? 'text-success' : 'text-danger')}>
            {txn.txnType === 'credit' ? '+' : '−'} {formatINR(txn.amount, { hidePaise: true })}
          </p>
        </div>
      </div>

      <dl className="text-sm space-y-2 divide-y divide-border">
        <DetailRow label="Date" value={fmtDateTime(txn.dateTime)} />
        <DetailRow label="Profile" value={profile?.name ?? '—'} />
        <DetailRow label="Account" value={acct ? `${acct.name} ${maskNumber(acct.number)}` : '—'} />
        <DetailRow label="Type" value={<span className={txn.txnType === 'credit' ? 'text-success' : 'text-danger'}>{txn.txnType}</span>} />
        <DetailRow label="Sl. No." value={`#${txn.slNo}`} />
        {txn.description && <DetailRow label="Description" value={txn.description} />}
        {(txn.tags ?? []).length > 0 && (
          <DetailRow label="Tags" value={
            <div className="flex flex-wrap gap-1.5">
              {(txn.tags ?? []).map((tag) => <span key={tag} className="fs-chip">{tag}</span>)}
            </div>
          } />
        )}
        {txn.source && <DetailRow label="Source" value={txn.source} />}
      </dl>
    </Modal>
  );
}
function DetailRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <dt className="text-muted-fg shrink-0">{label}</dt>
      <dd className="text-right break-words">{value}</dd>
    </div>
  );
}

/* ───────── Bulk edit modal ───────── */

function BulkEditModal({ open, onClose, ids, topCats, allCats, accounts, profiles, onDone }) {
  const allTxns = useLiveQuery(() => db.transactions.toArray(), [], []);
  const [patch, setPatch] = useState({});
  // each key holds either undefined (leave alone) or a value to apply
  useEffect(() => { if (open) setPatch({}); }, [open]);

  const catSuggestions = useMemo(() => freqSorted(allTxns.map((t) => allCats.find((c) => c.id === t.categoryId)?.name).filter(Boolean)), [allTxns, allCats]);
  const subSuggestions = useMemo(() => {
    if (!patch.category) return [];
    const parent = allCats.find((c) => c.name === patch.category && c.parentId == null);
    if (!parent) return [];
    return allCats.filter((c) => c.parentId === parent.id).map((c) => c.name);
  }, [allCats, patch.category]);

  const apply = async () => {
    const updates = {};
    if (patch.profileId) updates.profileId = Number(patch.profileId);
    if (patch.accountId) updates.accountId = Number(patch.accountId);

    let categoryId, subCategoryId;
    if (patch.category) {
      let cat = await db.categories.where({ name: patch.category }).filter((c) => c.parentId == null).first();
      if (!cat) {
        const id = await db.categories.add({ name: patch.category, parentId: null, icon: '🏷️', color: '#94a3b8', type: 'expense' });
        cat = await db.categories.get(id);
      }
      categoryId = cat.id;
    }
    if (patch.subCategory && categoryId) {
      let sub = await db.categories.where({ name: patch.subCategory, parentId: categoryId }).first();
      if (!sub) {
        const id = await db.categories.add({ name: patch.subCategory, parentId: categoryId, icon: '🏷️', color: '#94a3b8', type: 'expense' });
        sub = await db.categories.get(id);
      }
      subCategoryId = sub.id;
    }
    if (categoryId) updates.categoryId = categoryId;
    if (subCategoryId !== undefined) updates.subCategoryId = subCategoryId;
    if (patch.txnType) updates.txnType = patch.txnType;
    if (patch.tagsAdd) {
      const adds = patch.tagsAdd.split(',').map((s) => s.trim()).filter(Boolean);
      // we can't simply use bulkUpdate with array merge — fall through to a loop
      // (handled below)
      updates.__tagsAdd = adds;
    }

    if (Object.keys(updates).length === 0) { onClose?.(); return; }

    await db.transaction('rw', db.transactions, async () => {
      for (const id of ids) {
        const cur = await db.transactions.get(id);
        if (!cur) continue;
        const next = { ...updates };
        if (next.__tagsAdd) {
          const set = new Set([...(cur.tags ?? []), ...next.__tagsAdd]);
          next.tags = [...set];
          delete next.__tagsAdd;
        }
        await db.transactions.update(id, next);
      }
    });
    onDone?.();
  };

  if (!open) return null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Bulk edit ${ids.length} transaction${ids.length > 1 ? 's' : ''}`}
      size="lg"
      footer={
        <>
          <button className="fs-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="fs-btn-primary" onClick={apply}>Apply changes</button>
        </>
      }
    >
      <p className="text-xs text-muted-fg mb-3">
        Leave a field blank to keep it unchanged. Filled fields are applied to all selected transactions.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Profile">
          <Select value={patch.profileId ?? ''} onChange={(v) => setPatch({ ...patch, profileId: v })}
            options={[{ value: '', label: '— keep —' }, ...profiles.map((p) => ({ value: p.id, label: p.name }))]} />
        </Field>
        <Field label="Account">
          <Select value={patch.accountId ?? ''} onChange={(v) => setPatch({ ...patch, accountId: v })}
            options={[{ value: '', label: '— keep —' }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]} />
        </Field>
        <Field label="Category">
          <Combobox value={patch.category ?? ''} onChange={(v) => setPatch({ ...patch, category: v, subCategory: '' })} suggestions={catSuggestions} />
        </Field>
        <Field label="Sub-category">
          <Combobox value={patch.subCategory ?? ''} onChange={(v) => setPatch({ ...patch, subCategory: v })} suggestions={subSuggestions} />
        </Field>
        <Field label="Type">
          <Select value={patch.txnType ?? ''} onChange={(v) => setPatch({ ...patch, txnType: v })}
            options={[{ value: '', label: '— keep —' }, { value: 'debit', label: 'Debit' }, { value: 'credit', label: 'Credit' }]} />
        </Field>
        <Field label="Add tags" hint="comma separated">
          <input className="fs-input" value={patch.tagsAdd ?? ''} onChange={(e) => setPatch({ ...patch, tagsAdd: e.target.value })} placeholder="e.g. holiday, work" />
        </Field>
      </div>
      <p className="text-[11px] text-muted-fg mt-2">
        Note: bulk editing the amount or per-row balance impact isn't supported (each row's balance was already applied at creation). Use the Edit button on individual rows for amount fixes.
      </p>
    </Modal>
  );
}

function SummaryPill({ label, value, tone }) {
  return (
    <div className="fs-card px-3 py-2.5">
      <p className="text-[11px] text-muted-fg">{label}</p>
      <p className={cn('font-semibold text-sm', tone === 'success' && 'text-success', tone === 'danger' && 'text-danger')}>{value}</p>
    </div>
  );
}

function FilterDrawer({ open, onClose, filters, setFilters, topCats, subCats, profiles }) {
  const clear = () => setFilters({
    accountId: '', from: '', to: '', categoryId: '', subCategoryId: '', profileId: '',
    txnType: '', minAmount: '', maxAmount: '', tag: ''
  });
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Filters"
      footer={
        <>
          <button className="fs-btn-ghost" onClick={clear}>Clear</button>
          <button className="fs-btn-primary" onClick={onClose}>Apply</button>
        </>
      }
    >
      <div className="space-y-3">
        <FilterField label="Category">
          <Select
            value={filters.categoryId}
            onChange={(v) => setFilters({ ...filters, categoryId: v, subCategoryId: '' })}
            options={[{ value: '', label: 'All categories' }, ...topCats.map((c) => ({ value: c.id, label: `${c.icon} ${c.name}` }))]}
          />
        </FilterField>
        <FilterField label="Sub-category">
          <Select
            value={filters.subCategoryId}
            onChange={(v) => setFilters({ ...filters, subCategoryId: v })}
            options={[{ value: '', label: 'All sub-categories' }, ...subCats.map((c) => ({ value: c.id, label: c.name }))]}
          />
        </FilterField>
        <FilterField label="Profile">
          <Select
            value={filters.profileId}
            onChange={(v) => setFilters({ ...filters, profileId: v })}
            options={[{ value: '', label: 'All profiles' }, ...profiles.map((p) => ({ value: p.id, label: p.name }))]}
          />
        </FilterField>
        <FilterField label="Type">
          <Select
            value={filters.txnType}
            onChange={(v) => setFilters({ ...filters, txnType: v })}
            options={[{ value: '', label: 'All' }, { value: 'debit', label: 'Debit' }, { value: 'credit', label: 'Credit' }]}
          />
        </FilterField>
        <div className="grid grid-cols-2 gap-3">
          <FilterField label="Min amount">
            <input inputMode="decimal" className="fs-input"
              value={filters.minAmount} onChange={(e) => setFilters({ ...filters, minAmount: e.target.value })} placeholder="0" />
          </FilterField>
          <FilterField label="Max amount">
            <input inputMode="decimal" className="fs-input"
              value={filters.maxAmount} onChange={(e) => setFilters({ ...filters, maxAmount: e.target.value })} placeholder="0" />
          </FilterField>
        </div>
        <FilterField label="Tag contains">
          <input className="fs-input"
            value={filters.tag} onChange={(e) => setFilters({ ...filters, tag: e.target.value })} placeholder="vacation, work…" />
        </FilterField>
      </div>
    </Sheet>
  );
}

function FilterField({ label, children }) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-fg mb-1.5 block">{label}</label>
      {children}
    </div>
  );
}
