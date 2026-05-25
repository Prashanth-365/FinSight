import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, reindexSlNo } from '@/db/database.js';
import { Sheet } from '@/components/ui/Modal.jsx';
import { Field } from '@/components/ui/Input.jsx';
import { Combobox } from '@/components/ui/Combobox.jsx';
import { Select } from '@/components/ui/Select.jsx';
import { useProfile } from '@/context/ProfileContext.jsx';
import { useToast } from '@/components/ui/Toast.jsx';
import { freqSorted, todayLocalISO, maskNumber } from '@/lib/utils.js';
import { formatINR } from '@/lib/currency.js';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils.js';

const empty = (profileId) => ({
  id: null,
  dateTime: todayLocalISO(),
  profileId: profileId ?? null,
  accountId: '',
  category: '',
  subCategory: '',
  amount: '',
  txnType: 'debit',
  description: '',
  tags: ''
});

export function TransactionSheet({ open, onClose, editing = null, initial = null }) {
  const { profiles, activeProfileId } = useProfile();
  const { success, error } = useToast();

  const accounts = useLiveQuery(() => db.accounts.toArray(), [], []);
  const categories = useLiveQuery(() => db.categories.toArray(), [], []);
  const allTxns = useLiveQuery(() => db.transactions.toArray(), [], []);

  const [form, setForm] = useState(empty(activeProfileId));

  useEffect(() => {
    if (!open) return;
    if (editing) {
      const cat = categories.find((c) => c.id === editing.categoryId);
      const sub = categories.find((c) => c.id === editing.subCategoryId);
      setForm({
        id: editing.id,
        dateTime: new Date(editing.dateTime).toISOString().slice(0, 16),
        profileId: editing.profileId,
        accountId: editing.accountId ?? '',
        category: cat?.name ?? '',
        subCategory: sub?.name ?? '',
        amount: String(editing.amount ?? ''),
        txnType: editing.txnType ?? 'debit',
        description: editing.description ?? '',
        tags: (editing.tags ?? []).join(', ')
      });
    } else {
      setForm({ ...empty(activeProfileId), ...(initial ?? {}) });
    }
  }, [open, editing, activeProfileId, initial]); // eslint-disable-line

  const categorySuggestions = useMemo(() => {
    const topLevel = categories.filter((c) => c.parentId == null).map((c) => c.name);
    const fromTxn = freqSorted(
      allTxns
        .map((t) => categories.find((c) => c.id === t.categoryId)?.name)
        .filter(Boolean)
    );
    return Array.from(new Set([...fromTxn, ...topLevel]));
  }, [categories, allTxns]);

  const subCategorySuggestions = useMemo(() => {
    if (!form.category) return [];
    const parent = categories.find((c) => c.name === form.category && c.parentId == null);
    const children = parent ? categories.filter((c) => c.parentId === parent.id).map((c) => c.name) : [];
    const fromTxn = freqSorted(
      allTxns
        .filter((t) => categories.find((c) => c.id === t.categoryId)?.name === form.category)
        .map((t) => categories.find((c) => c.id === t.subCategoryId)?.name)
        .filter(Boolean)
    );
    return Array.from(new Set([...fromTxn, ...children]));
  }, [categories, allTxns, form.category]);

  const tagSuggestions = useMemo(() => freqSorted(allTxns.flatMap((t) => t.tags ?? [])), [allTxns]);
  const descSuggestions = useMemo(() => freqSorted(allTxns.map((t) => t.description).filter(Boolean)), [allTxns]);

  const selectedAccount = accounts.find((a) => a.id === Number(form.accountId));

  const save = async () => {
    try {
      if (!form.profileId) throw new Error('Please pick a profile.');
      if (!form.accountId) throw new Error('Please pick an account.');
      const amt = Number(form.amount);
      if (!isFinite(amt) || amt <= 0) throw new Error('Amount must be a positive number.');
      if (!form.category) throw new Error('Please pick or type a category.');

      // ensure category exists (top-level)
      let cat = await db.categories.where({ name: form.category }).filter((c) => c.parentId == null).first();
      if (!cat) {
        const id = await db.categories.add({
          name: form.category, parentId: null, icon: '🏷️', color: '#94a3b8', type: form.txnType === 'credit' ? 'income' : 'expense'
        });
        cat = await db.categories.get(id);
      }
      let sub = null;
      if (form.subCategory) {
        sub = await db.categories.where({ name: form.subCategory, parentId: cat.id }).first();
        if (!sub) {
          const id = await db.categories.add({
            name: form.subCategory, parentId: cat.id, icon: cat.icon, color: cat.color, type: cat.type
          });
          sub = await db.categories.get(id);
        }
      }

      const dateTime = new Date(form.dateTime).getTime();
      const tags = (form.tags ?? '').split(',').map((s) => s.trim()).filter(Boolean);

      const payload = {
        slNo: 0, // re-indexed below
        dateTime,
        profileId: Number(form.profileId),
        accountId: Number(form.accountId),
        categoryId: cat.id,
        subCategoryId: sub?.id ?? null,
        amount: amt,
        txnType: form.txnType,
        paymentMode: selectedAccount?.type ?? 'bank',
        description: form.description ?? '',
        tags,
        source: 'manual'
      };

      if (form.id) await db.transactions.update(form.id, payload);
      else await db.transactions.add(payload);

      await reindexSlNo();

      // update account balance heuristically
      if (selectedAccount) {
        const delta = (form.txnType === 'credit' ? 1 : -1) * amt;
        await db.accounts.update(selectedAccount.id, {
          balance: Number(selectedAccount.balance ?? 0) + delta
        });
      }

      success(form.id ? 'Transaction updated' : 'Transaction added');
      onClose?.();
    } catch (e) {
      error(e.message);
    }
  };

  const profileOptions = profiles.map((p) => ({ value: p.id, label: p.name }));
  const accountOptions = (accounts ?? []).filter((a) => a.isActive !== 0);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={form.id ? 'Edit transaction' : 'Add transaction'}
      footer={
        <>
          <button className="fs-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="fs-btn-primary" onClick={save}>{form.id ? 'Save changes' : 'Add transaction'}</button>
        </>
      }
    >
      <Field label="Type">
        <div className="grid grid-cols-2 gap-2">
          <TypeToggle
            active={form.txnType === 'debit'}
            onClick={() => setForm({ ...form, txnType: 'debit' })}
            icon={<ArrowUpRight className="w-4 h-4" />}
            label="Debit (spent)"
            tone="danger"
          />
          <TypeToggle
            active={form.txnType === 'credit'}
            onClick={() => setForm({ ...form, txnType: 'credit' })}
            icon={<ArrowDownLeft className="w-4 h-4" />}
            label="Credit (received)"
            tone="success"
          />
        </div>
      </Field>

      <Field label="Amount (₹)">
        <input
          inputMode="decimal"
          className="fs-input text-lg font-semibold"
          placeholder="0.00"
          value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Date & time">
          <input
            type="datetime-local"
            className="fs-input"
            value={form.dateTime}
            onChange={(e) => setForm({ ...form, dateTime: e.target.value })}
          />
        </Field>
        <Field label="Profile">
          <Select
            value={form.profileId ?? ''}
            onChange={(v) => setForm({ ...form, profileId: Number(v) })}
            options={[{ value: '', label: 'Pick profile…' }, ...profileOptions]}
          />
        </Field>
      </div>

      <Field label="Account">
        <Select
          value={form.accountId ?? ''}
          onChange={(v) => setForm({ ...form, accountId: v })}
          options={[
            { value: '', label: 'Pick account…' },
            ...accountOptions.map((a) => ({
              value: a.id,
              label: `${typeBadge(a.type)} ${a.name} ${maskNumber(a.number)} — ${formatINR(a.balance ?? 0, { hidePaise: true })}`
            }))
          ]}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Category">
          <Combobox
            value={form.category}
            onChange={(v) => setForm({ ...form, category: v, subCategory: '' })}
            suggestions={categorySuggestions}
            placeholder="Food, Transport…"
          />
        </Field>
        <Field label="Sub-category">
          <Combobox
            value={form.subCategory}
            onChange={(v) => setForm({ ...form, subCategory: v })}
            suggestions={subCategorySuggestions}
            placeholder="Optional"
          />
        </Field>
      </div>

      <Field label="Description">
        <Combobox
          value={form.description}
          onChange={(v) => setForm({ ...form, description: v })}
          suggestions={descSuggestions}
          placeholder="What was this for?"
        />
      </Field>

      <Field label="Tags" hint="Comma separated">
        <Combobox
          value={form.tags}
          onChange={(v) => setForm({ ...form, tags: v })}
          suggestions={tagSuggestions}
          placeholder="vacation, work…"
        />
      </Field>
    </Sheet>
  );
}

function typeBadge(t) {
  return t === 'card' ? '💳' : t === 'wallet' ? '👛' : '🏦';
}

function TypeToggle({ active, onClick, icon, label, tone }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-xl border px-3 py-2.5 text-sm flex items-center gap-2 justify-center font-medium transition-colors',
        active
          ? tone === 'danger'
            ? 'border-danger bg-danger/10 text-danger'
            : 'border-success bg-success/10 text-success'
          : 'border-border bg-elevated text-muted-fg hover:text-foreground'
      )}
    >
      {icon} {label}
    </button>
  );
}
