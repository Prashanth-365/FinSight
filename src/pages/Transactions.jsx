import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, reindexSlNo } from '@/db/database.js';
import { useProfile } from '@/context/ProfileContext.jsx';
import { Card } from '@/components/ui/Card.jsx';
import { Select } from '@/components/ui/Select.jsx';
import { Avatar } from '@/components/ui/Avatar.jsx';
import { Sheet, ConfirmDialog } from '@/components/ui/Modal.jsx';
import { TransactionSheet } from '@/components/transaction/TransactionSheet.jsx';
import { EmptyState } from '@/components/ui/Empty.jsx';
import { useToast } from '@/components/ui/Toast.jsx';
import { Filter, Trash2, Edit3, ListOrdered, ChevronUp, ChevronDown } from 'lucide-react';
import { formatINR } from '@/lib/currency.js';
import { fmtDate, fmtDateTime, cn, maskNumber } from '@/lib/utils.js';

export default function Transactions() {
  const { isMasterView, activeProfileId } = useProfile();
  const { success } = useToast();

  const txns = useLiveQuery(() => db.transactions.orderBy('dateTime').reverse().toArray(), [], []);
  const accounts = useLiveQuery(() => db.accounts.toArray(), [], []);
  const categories = useLiveQuery(() => db.categories.toArray(), [], []);
  const profiles = useLiveQuery(() => db.profiles.toArray(), [], []);

  const [filters, setFilters] = useState({
    accountId: '',
    from: '',
    to: '',
    categoryId: '',
    subCategoryId: '',
    profileId: '',
    txnType: '',
    minAmount: '',
    maxAmount: '',
    tag: ''
  });
  const [filterOpen, setFilterOpen] = useState(false);
  const [sort, setSort] = useState({ key: 'dateTime', dir: 'desc' });
  const [selected, setSelected] = useState(new Set());
  const [editing, setEditing] = useState(null);
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

    out = [...out].sort((a, b) => {
      const k = sort.key;
      const va = a[k] ?? '', vb = b[k] ?? '';
      const cmp = va > vb ? 1 : va < vb ? -1 : 0;
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return out;
  }, [txns, filters, sort, isMasterView, activeProfileId]);

  const topCats = categories.filter((c) => c.parentId == null);
  const subCats = filters.categoryId
    ? categories.filter((c) => c.parentId === Number(filters.categoryId))
    : [];

  const totals = useMemo(() => {
    let cr = 0, dr = 0;
    for (const t of filtered) {
      if (t.txnType === 'credit') cr += t.amount; else dr += t.amount;
    }
    return { cr, dr, net: cr - dr };
  }, [filtered]);

  const toggleSel = (id) => setSelected((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const deleteSelected = async () => {
    const ids = [...selected];
    await db.transactions.bulkDelete(ids);
    await reindexSlNo();
    setSelected(new Set());
    success(`Deleted ${ids.length} transaction${ids.length > 1 ? 's' : ''}`);
  };

  const setSortKey = (key) => setSort((s) =>
    s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }
  );

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

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
        <input
          type="date"
          className="fs-input w-auto"
          value={filters.from}
          onChange={(e) => setFilters({ ...filters, from: e.target.value })}
          aria-label="From date"
        />
        <input
          type="date"
          className="fs-input w-auto"
          value={filters.to}
          onChange={(e) => setFilters({ ...filters, to: e.target.value })}
          aria-label="To date"
        />
        <button
          onClick={() => setFilterOpen(true)}
          className="fs-btn-secondary relative"
          aria-label="More filters"
        >
          <Filter className="w-4 h-4" />
          Filters
          {activeFilterCount > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary text-primary-fg text-[10px] grid place-items-center">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-3 gap-2">
        <SummaryPill label="Credits" value={formatINR(totals.cr, { hidePaise: true })} tone="success" />
        <SummaryPill label="Debits" value={formatINR(totals.dr, { hidePaise: true })} tone="danger" />
        <SummaryPill label="Net" value={formatINR(totals.net, { hidePaise: true })} tone={totals.net >= 0 ? 'success' : 'danger'} />
      </div>

      {/* Bulk action */}
      {selected.size > 0 && (
        <div className="fs-card px-3 py-2 flex items-center justify-between animate-slide-up">
          <span className="text-sm">{selected.size} selected</span>
          <div className="flex gap-2">
            <button className="fs-btn-ghost" onClick={() => setSelected(new Set())}>Clear</button>
            <button className="fs-btn-danger" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="w-4 h-4" /> Delete
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      {filtered.length === 0 ? (
        <Card><div className="p-2">
          <EmptyState
            icon={ListOrdered}
            title="No transactions match"
            hint="Try clearing some filters, or add a new transaction."
          />
        </div></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="hidden md:grid grid-cols-[40px_60px_120px_1fr_140px_120px] gap-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-fg bg-elevated border-b border-border">
            <div></div>
            <SortBtn label="#" k="slNo" sort={sort} onClick={setSortKey} />
            <SortBtn label="Date" k="dateTime" sort={sort} onClick={setSortKey} />
            <div>Details</div>
            <div>Account</div>
            <SortBtn label="Amount" k="amount" sort={sort} onClick={setSortKey} className="text-right" />
          </div>

          <ul className="divide-y divide-border">
            {filtered.map((t) => {
              const cat = categories.find((c) => c.id === t.categoryId);
              const sub = categories.find((c) => c.id === t.subCategoryId);
              const acct = accounts.find((a) => a.id === t.accountId);
              const profile = profiles.find((p) => p.id === t.profileId);
              const sel = selected.has(t.id);
              return (
                <li
                  key={t.id}
                  className={cn(
                    'md:grid md:grid-cols-[40px_60px_120px_1fr_140px_120px] gap-2 items-center p-3 hover:bg-muted/40 transition-colors',
                    sel && 'bg-primary/5'
                  )}
                >
                  <div className="hidden md:block">
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-primary"
                      checked={sel}
                      onChange={() => toggleSel(t.id)}
                      aria-label="Select row"
                    />
                  </div>
                  <div className="hidden md:block text-xs text-muted-fg tabular-nums">{t.slNo}</div>
                  <div className="hidden md:block text-xs">{fmtDate(t.dateTime)}</div>

                  {/* Mobile-first */}
                  <div className="flex items-center gap-3 md:contents">
                    <span
                      className="md:hidden w-10 h-10 rounded-xl inline-flex items-center justify-center text-lg shrink-0"
                      style={{ background: (cat?.color ?? '#94a3b8') + '22', color: cat?.color ?? '#94a3b8' }}
                    >
                      {cat?.icon ?? '🏷️'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="hidden md:inline-flex w-7 h-7 rounded-lg items-center justify-center text-sm shrink-0"
                          style={{ background: (cat?.color ?? '#94a3b8') + '22', color: cat?.color ?? '#94a3b8' }}>
                          {cat?.icon ?? '🏷️'}
                        </span>
                        <p className="font-medium text-sm truncate">
                          {cat?.name ?? '—'}{sub && <span className="text-muted-fg"> · {sub.name}</span>}
                        </p>
                        {profile && <Avatar size="xs" name={profile.name} avatar={profile.avatar} color={profile.color} />}
                      </div>
                      <p className="text-xs text-muted-fg truncate">
                        <span className="md:hidden">{fmtDate(t.dateTime)} · </span>
                        {t.description || 'No description'}
                        {(t.tags ?? []).length > 0 && <span className="ml-1">· {t.tags.join(', ')}</span>}
                      </p>
                    </div>
                    <div className="md:hidden text-right">
                      <p className={cn('text-sm font-semibold tabular-nums', t.txnType === 'credit' ? 'text-success' : 'text-danger')}>
                        {t.txnType === 'credit' ? '+' : '−'} {formatINR(t.amount, { hidePaise: true })}
                      </p>
                      <p className="text-[11px] text-muted-fg">{acct?.name ?? '—'}</p>
                    </div>
                    <div className="hidden md:block text-xs">
                      <p className="font-medium truncate">{acct?.name ?? '—'}</p>
                      <p className="text-muted-fg text-[11px]">{maskNumber(acct?.number)}</p>
                    </div>
                    <div className={cn('hidden md:block text-right text-sm font-semibold tabular-nums',
                      t.txnType === 'credit' ? 'text-success' : 'text-danger')}>
                      {t.txnType === 'credit' ? '+' : '−'} {formatINR(t.amount, { hidePaise: true })}
                    </div>
                  </div>

                  <div className="md:hidden mt-2 flex gap-1.5">
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-primary"
                      checked={sel}
                      onChange={() => toggleSel(t.id)}
                      aria-label="Select row"
                    />
                    <button className="fs-btn-ghost text-xs" onClick={() => setEditing(t)}>
                      <Edit3 className="w-3.5 h-3.5" /> Edit
                    </button>
                  </div>

                  <div className="hidden md:flex absolute right-3 top-3 gap-1 md:static md:col-span-6 md:row-span-0 md:hidden">
                    <button onClick={() => setEditing(t)}><Edit3 className="w-4 h-4" /></button>
                  </div>
                </li>
              );
            })}
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

      <TransactionSheet
        open={!!editing}
        onClose={() => setEditing(null)}
        editing={editing}
      />

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={deleteSelected}
        title="Delete selected transactions?"
        message={`This will permanently remove ${selected.size} transaction${selected.size > 1 ? 's' : ''}. This cannot be undone.`}
        confirmText="Delete"
        danger
      />
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

function SortBtn({ label, k, sort, onClick, className }) {
  const active = sort.key === k;
  return (
    <button
      onClick={() => onClick(k)}
      className={cn('inline-flex items-center gap-1 text-left', className, active && 'text-foreground')}
    >
      {label}
      {active && (sort.dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
    </button>
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
            <input
              inputMode="decimal" className="fs-input"
              value={filters.minAmount}
              onChange={(e) => setFilters({ ...filters, minAmount: e.target.value })}
              placeholder="0"
            />
          </FilterField>
          <FilterField label="Max amount">
            <input
              inputMode="decimal" className="fs-input"
              value={filters.maxAmount}
              onChange={(e) => setFilters({ ...filters, maxAmount: e.target.value })}
              placeholder="0"
            />
          </FilterField>
        </div>
        <FilterField label="Tag contains">
          <input
            className="fs-input"
            value={filters.tag}
            onChange={(e) => setFilters({ ...filters, tag: e.target.value })}
            placeholder="vacation, work…"
          />
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
