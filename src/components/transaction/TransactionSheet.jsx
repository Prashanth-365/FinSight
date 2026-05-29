import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, reindexSlNo } from '@/db/database.js';
import { Sheet } from '@/components/ui/Modal.jsx';
import { Field } from '@/components/ui/Input.jsx';
import { Combobox } from '@/components/ui/Combobox.jsx';
import { Select } from '@/components/ui/Select.jsx';
import { useProfile } from '@/context/ProfileContext.jsx';
import { useToast } from '@/components/ui/Toast.jsx';
import { freqSorted, todayLocalISO, maskNumber, applyTxnDeltaToBalances, getAccountBalance, inferInvestmentPlatform } from '@/lib/utils.js';
import { formatINR } from '@/lib/currency.js';
import { ArrowDownLeft, ArrowUpRight, Users, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
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
  tags: '',
  investmentName: '' // used only when category resolves to type='investment'
});

export function TransactionSheet({
  open,
  onClose,
  editing = null,
  initial = null,
  smsLink = null,
  // SMS-conversion navigation (all optional, only used when smsLink is set)
  smsText = '',
  smsIndex = null,    // 1-based position in pending list
  smsTotal = null,    // total count
  onPrev = null,      // called when "previous" arrow tapped
  onNext = null,      // called when "next" arrow tapped
  onDismiss = null,   // called when trash icon tapped
  onSavedAndNext = null // called after save & add another, when smsLink is set
}) {
  const { profiles, activeProfileId } = useProfile();
  const { success, error } = useToast();

  const accounts = useLiveQuery(() => db.accounts.toArray(), [], []);
  const categories = useLiveQuery(() => db.categories.toArray(), [], []);
  const allTxns = useLiveQuery(() => db.transactions.toArray(), [], []);
  const investments = useLiveQuery(() => db.investments.toArray(), [], []);

  const [form, setForm] = useState(empty(activeProfileId));

  useEffect(() => {
    if (!open) return;
    if (editing) {
      const cat = categories.find((c) => c.id === editing.categoryId);
      const sub = categories.find((c) => c.id === editing.subCategoryId);
      const linkedInv = editing.investmentId
        ? investments.find((i) => i.id === editing.investmentId)
        : null;
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
        tags: (editing.tags ?? []).join(', '),
        investmentName: linkedInv?.name ?? ''
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

  // Is the typed category an "investment" type? Two signals:
  //   (a) it exists in db.categories with type='investment', or
  //   (b) the typed name (case-insensitive) equals "investment" (covers brand-new typing).
  const isInvestmentCategory = useMemo(() => {
    if (!form.category) return false;
    const lc = form.category.toLowerCase().trim();
    if (lc === 'investment' || lc === 'investments') return true;
    const cat = categories.find((c) => c.name.toLowerCase() === lc && c.parentId == null);
    return cat?.type === 'investment';
  }, [form.category, categories]);

  // Suggestions for the holding picker: existing investments filtered by inferred
  // platform under the active profile.
  const investmentSuggestions = useMemo(() => {
    if (!isInvestmentCategory) return [];
    const platform = inferInvestmentPlatform(form.subCategory);
    return investments
      .filter((i) => (!form.profileId || i.profileId === Number(form.profileId)) &&
                     (!platform || platform === 'Other' || i.platform === platform))
      .map((i) => ({ value: i.name, label: i.name, hint: i.platform }));
  }, [investments, form.profileId, form.subCategory, isInvestmentCategory]);

  // `mode` = 'close' (default — save and close)  or  'continue' (save & add another)
  const save = async (mode = 'close') => {
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

      // If this is an investment-type category and the user supplied/picked a
      // holding name, find-or-create the investment record and capture its id.
      let investmentId = null;
      if (isInvestmentCategory && form.investmentName?.trim()) {
        const platform = inferInvestmentPlatform(form.subCategory);
        const name = form.investmentName.trim();
        let inv = investments.find(
          (i) => i.profileId === Number(form.profileId) &&
                 i.platform === platform &&
                 i.name.toLowerCase() === name.toLowerCase()
        );
        if (!inv) {
          const id = await db.investments.add({
            profileId: Number(form.profileId),
            platform,
            name,
            identifier: null,
            units: null,
            investedAmount: 0,
            currentValue: 0,
            startDate: dateTime,
            maturityDate: null,
            notes: ''
          });
          inv = await db.investments.get(id);
        }
        investmentId = inv.id;
      }

      const payload = {
        slNo: 0,
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
        source: smsLink ? 'sms' : 'manual',
        investmentId
      };

      // When editing, we must first REVERSE the old balance + invested-amount
      // effects, then re-apply the new ones — otherwise account totals drift.
      const oldTxn = form.id ? await db.transactions.get(form.id) : null;
      if (oldTxn) {
        const oldAccount = await db.accounts.get(oldTxn.accountId);
        if (oldAccount) {
          const reverse = (oldTxn.txnType === 'credit' ? -1 : 1) * Number(oldTxn.amount ?? 0);
          const balances = applyTxnDeltaToBalances(oldAccount, oldTxn.profileId, reverse);
          await db.accounts.update(oldAccount.id, { balances, balance: null });
        }
        if (oldTxn.investmentId) {
          const oldInv = await db.investments.get(oldTxn.investmentId);
          if (oldInv) {
            const invReverse = (oldTxn.txnType === 'credit' ? 1 : -1) * Number(oldTxn.amount ?? 0);
            await db.investments.update(oldInv.id, {
              investedAmount: Math.max(0, Number(oldInv.investedAmount ?? 0) + invReverse)
            });
          }
        }
      }

      let txnId;
      if (form.id) {
        txnId = form.id;
        await db.transactions.update(form.id, payload);
      } else {
        txnId = await db.transactions.add(payload);
      }

      await reindexSlNo();

      // Apply new balance delta on the chosen account
      if (selectedAccount) {
        const delta = (form.txnType === 'credit' ? 1 : -1) * amt;
        const balances = applyTxnDeltaToBalances(selectedAccount, Number(form.profileId), delta);
        await db.accounts.update(selectedAccount.id, { balances, balance: null });
      }

      // Apply new invested-amount delta (debit on an investment row = money in)
      if (investmentId) {
        const inv = await db.investments.get(investmentId);
        if (inv) {
          const invDelta = (form.txnType === 'credit' ? -1 : 1) * amt;
          const nextInvested = Math.max(0, Number(inv.investedAmount ?? 0) + invDelta);
          const nextCurrent = Math.max(Number(inv.currentValue ?? 0), nextInvested);
          await db.investments.update(investmentId, {
            investedAmount: nextInvested,
            currentValue: nextCurrent
          });
        }
      }

      // Mark the originating SMS as processed (when this sheet was opened from an SMS row)
      if (smsLink) {
        await db.smsQueue.update(smsLink, { status: 'processed', linkedTxnId: txnId });
      }

      success(form.id ? 'Transaction updated' : 'Transaction added');

      if (mode === 'continue' && !form.id) {
        if (smsLink && onSavedAndNext) {
          // Convert-SMS mode: advance to the next pending SMS. The parent will
          // change the `smsLink` / `initial` props which triggers a form reset
          // (we use a `key` prop on the sheet to force this).
          onSavedAndNext();
        } else {
          // Plain "add another" mode: keep form, clear only amount + description.
          setForm((f) => ({ ...f, amount: '', description: '' }));
        }
      } else {
        onClose?.();
      }
    } catch (e) {
      error(e.message);
    }
  };

  const profileOptions = profiles.map((p) => ({ value: p.id, label: p.name }));
  const accountOptions = (accounts ?? []).filter((a) => a.isActive !== 0);
  const noProfiles = profiles.length === 0;

  if (open && noProfiles) {
    return (
      <Sheet open={open} onClose={onClose} title="Add a profile first">
        <div className="text-center py-6 space-y-3">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/15 text-primary">
            <Users className="w-7 h-7" />
          </div>
          <div>
            <h3 className="font-semibold">No profiles yet</h3>
            <p className="text-sm text-muted-fg mt-1 max-w-xs mx-auto">
              FinSight tracks money per profile (you, family members). Add at least one profile to start logging transactions.
            </p>
          </div>
          <Link
            to="/settings/profiles"
            onClick={onClose}
            className="fs-btn-primary inline-flex"
          >
            Set up first profile
          </Link>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={form.id ? 'Edit transaction' : (smsLink ? 'Convert SMS to transaction' : 'Add transaction')}
      footer={
        <>
          <button className="fs-btn-ghost" onClick={onClose}>Cancel</button>
          {!form.id && (
            <button
              className="fs-btn-secondary"
              onClick={() => save('continue')}
              title={smsLink
                ? 'Save and move to the next pending SMS'
                : 'Save and keep the sheet open with everything but amount preserved'}
            >
              {smsLink ? 'Save & next' : 'Save & add another'}
            </button>
          )}
          <button className="fs-btn-primary" onClick={() => save('close')}>
            {form.id ? 'Save changes' : 'Add transaction'}
          </button>
        </>
      }
    >
      {smsLink && (smsText || onPrev || onNext || onDismiss) && (
        <div className="mb-4 rounded-xl border border-border bg-elevated p-3">
          {smsText && (
            <p className="text-xs leading-snug whitespace-pre-wrap break-words text-foreground/90">
              {smsText}
            </p>
          )}
          {(onPrev || onNext || onDismiss || smsTotal != null) && (
            <div className="mt-2 pt-2 border-t border-border flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={onPrev}
                  disabled={!onPrev}
                  className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30"
                  title="Previous SMS (more recent)"
                  aria-label="Previous SMS"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                {smsIndex != null && smsTotal != null && (
                  <span className="text-[11px] text-muted-fg tabular-nums px-1">
                    {smsIndex} / {smsTotal}
                  </span>
                )}
                <button
                  type="button"
                  onClick={onNext}
                  disabled={!onNext}
                  className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30"
                  title="Next SMS (older)"
                  aria-label="Next SMS"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
              {onDismiss && (
                <button
                  type="button"
                  onClick={onDismiss}
                  className="p-1.5 rounded-lg hover:bg-muted text-muted-fg hover:text-danger"
                  title="Dismiss this SMS (won't be reimported)"
                  aria-label="Dismiss SMS"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
        </div>
      )}

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
              label: `${typeBadge(a.type)} ${a.name} ${maskNumber(a.number)} — ${formatINR(getAccountBalance(a, form.profileId || null), { hidePaise: true })}`
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

      {isInvestmentCategory && (
        <Field
          label="Investment holding"
          hint={`Linked under ${inferInvestmentPlatform(form.subCategory)}. Pick an existing holding or type a new name to create one.`}
        >
          <Combobox
            value={form.investmentName}
            onChange={(v) => setForm({ ...form, investmentName: v })}
            suggestions={investmentSuggestions}
            placeholder="e.g. Parag Parikh Flexi Cap"
            emptyHint="Type the holding name — we'll create it on save"
          />
        </Field>
      )}

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
