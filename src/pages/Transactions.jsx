import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/database.js';
import { deleteTransaction, deleteTransactions, updateTransactions } from '@/db/txnEffects.js';
import { useProfile } from '@/context/ProfileContext.jsx';
import { Card } from '@/components/ui/Card.jsx';
import { Select } from '@/components/ui/Select.jsx';
import { Avatar } from '@/components/ui/Avatar.jsx';
import { Sheet, Modal, ConfirmDialog } from '@/components/ui/Modal.jsx';
import { useBackHandler } from '@/context/NavContext.jsx';
import { Field } from '@/components/ui/Input.jsx';
import { Combobox } from '@/components/ui/Combobox.jsx';
import { TransactionSheet } from '@/components/transaction/TransactionSheet.jsx';
import { EmptyState } from '@/components/ui/Empty.jsx';
import { useToast } from '@/components/ui/Toast.jsx';
import {
  Filter, Trash2, Edit3, ListOrdered, X, MousePointer2, CheckSquare, Square
} from 'lucide-react';
import { formatINR } from '@/lib/currency.js';
import { fmtDate, fmtDateTime, cn, maskNumber, freqSorted, accountSort } from '@/lib/utils.js';

const LONG_PRESS_MS = 450;

const EMPTY_FILTERS = {
  accountId: '', from: '', to: '', categoryId: '', subCategoryId: '',
  profileId: '', txnType: '', minAmount: '', maxAmount: '', tag: ''
};

export default function Transactions() {
  const { isMasterView, activeProfileId } = useProfile();
  const { success } = useToast();
  const location = useLocation();
  const navigate = useNavigate();

  const txns = useLiveQuery(() => db.transactions.orderBy('dateTime').reverse().toArray(), [], []);
  const accounts = useLiveQuery(() => db.accounts.toArray(), [], []);
  const categories = useLiveQuery(() => db.categories.toArray(), [], []);
  const profiles = useLiveQuery(() => db.profiles.toArray(), [], []);

  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [filterOpen, setFilterOpen] = useState(false);

  // Apply filters passed in via navigation (e.g. tapping a donut legend item or
  // an account card on Home). We replace the whole filter set so the incoming
  // intent is exactly what's shown, then clear the history state so a back/
  // refresh doesn't silently re-apply it.
  useEffect(() => {
    const incoming = location.state?.filters;
    if (!incoming) return;
    setFilters({ ...EMPTY_FILTERS, ...incoming });
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);

  const [detailTxn, setDetailTxn] = useState(null);   // row clicked → details modal
  const [editingTxn, setEditingTxn] = useState(null); // editing in TransactionSheet
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Infinite scroll: render in batches as user scrolls toward the bottom
  const PAGE_SIZE = 50;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef(null);

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

  // Reset the visible window whenever filters/inputs change so we don't start
  // at the bottom of an old list.
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [filters, isMasterView, activeProfileId]);

  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);

  // IntersectionObserver: when the sentinel scrolls into view, append more rows.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    if (visibleCount >= filtered.length) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setVisibleCount((n) => Math.min(filtered.length, n + PAGE_SIZE));
      }
    }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, [filtered.length, visibleCount]);

  const toggleSel = (id) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const exitSelection = () => {
    setSelectionMode(false);
    setSelected(new Set());
  };
  // Android back exits selection mode before doing anything else.
  useBackHandler(selectionMode, exitSelection);

  const deleteSelected = async () => {
    const ids = [...selected];
    await deleteTransactions(ids);
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
              ...accountSort(accounts).map((a) => ({ value: a.id, label: `${a.name} ${maskNumber(a.number)}` }))
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

      <ActiveFilters
        filters={filters}
        setFilters={setFilters}
        accounts={accounts}
        categories={categories}
        profiles={profiles}
      />

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
            {visible.map((t) => (
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
          {visibleCount < filtered.length && (
            <div ref={sentinelRef} className="p-3 text-center text-xs text-muted-fg">
              Loading more… ({visible.length} of {filtered.length.toLocaleString('en-IN')})
            </div>
          )}
          {visibleCount >= filtered.length && filtered.length > PAGE_SIZE && (
            <div className="p-3 text-center text-[11px] text-muted-fg">
              End of list · {filtered.length.toLocaleString('en-IN')} transactions
            </div>
          )}
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
          await deleteTransaction(t.id);
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
        {txn.splitGroupId && (
          <DetailRow label="Split" value={
            <span className="text-primary">Part of a split · total {formatINR(txn.splitTotal ?? txn.amount, { hidePaise: true })}</span>
          } />
        )}
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

    // Pull the tag-merge out of `updates`; it's applied per-row below.
    const tagsAdd = updates.__tagsAdd;
    delete updates.__tagsAdd;

    // Route through the shared service so each row reverses its old effect and
    // applies the new one (keeps investment amounts correct; account balances
    // are derived and update automatically).
    await updateTransactions(ids, (cur) => {
      const patch = { ...updates };
      if (tagsAdd) patch.tags = [...new Set([...(cur.tags ?? []), ...tagsAdd])];
      return patch;
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
            options={[{ value: '', label: '— keep —' }, ...accountSort(accounts).map((a) => ({ value: a.id, label: a.name }))]} />
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
        Note: bulk editing the amount isn't supported — use the Edit button on an individual row. Account balances update automatically after profile, account or type changes.
      </p>
    </Modal>
  );
}

/* ───────── Active-filter chips ───────── */

function ActiveFilters({ filters, setFilters, accounts, categories, profiles }) {
  const patch = (p) => setFilters({ ...filters, ...p });
  const chips = [];

  if (filters.accountId) {
    const a = accounts.find((x) => x.id === Number(filters.accountId));
    chips.push({ key: 'account', label: `Account: ${a?.name ?? filters.accountId}`, clear: { accountId: '' } });
  }
  if (filters.categoryId) {
    const c = categories.find((x) => x.id === Number(filters.categoryId));
    chips.push({ key: 'category', label: `Category: ${c?.name ?? filters.categoryId}`, clear: { categoryId: '', subCategoryId: '' } });
  }
  if (filters.subCategoryId) {
    const c = categories.find((x) => x.id === Number(filters.subCategoryId));
    chips.push({ key: 'subcategory', label: `Sub: ${c?.name ?? filters.subCategoryId}`, clear: { subCategoryId: '' } });
  }
  if (filters.profileId) {
    const p = profiles.find((x) => x.id === Number(filters.profileId));
    chips.push({ key: 'profile', label: `Profile: ${p?.name ?? filters.profileId}`, clear: { profileId: '' } });
  }
  if (filters.txnType) {
    chips.push({ key: 'type', label: `Type: ${filters.txnType}`, clear: { txnType: '' } });
  }
  if (filters.from || filters.to) {
    chips.push({ key: 'date', label: `Date: ${filters.from || '…'} → ${filters.to || '…'}`, clear: { from: '', to: '' } });
  }
  if (filters.minAmount || filters.maxAmount) {
    chips.push({ key: 'amount', label: `₹ ${filters.minAmount || '0'}–${filters.maxAmount || '∞'}`, clear: { minAmount: '', maxAmount: '' } });
  }
  if (filters.tag) {
    chips.push({ key: 'tag', label: `Tag: ${filters.tag}`, clear: { tag: '' } });
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((ch) => (
        <button
          key={ch.key}
          onClick={() => patch(ch.clear)}
          className="fs-chip hover:bg-danger/10 hover:text-danger transition-colors"
          title="Remove this filter"
        >
          {ch.label} <X className="w-3 h-3" />
        </button>
      ))}
      {chips.length > 1 && (
        <button onClick={() => setFilters({ ...EMPTY_FILTERS })} className="text-xs text-primary font-medium px-1">
          Clear all
        </button>
      )}
    </div>
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
  const clear = () => setFilters({ ...EMPTY_FILTERS });
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
