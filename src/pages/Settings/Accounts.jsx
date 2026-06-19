import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Edit3, Trash2, Wallet, CreditCard, Landmark, X, GripVertical } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { db } from '@/db/database.js';
import { Card } from '@/components/ui/Card.jsx';
import { Modal, ConfirmDialog } from '@/components/ui/Modal.jsx';
import { Field } from '@/components/ui/Input.jsx';
import { Select } from '@/components/ui/Select.jsx';
import { useToast } from '@/components/ui/Toast.jsx';
import { SectionHeader } from './Profiles.jsx';
import { maskNumber, cn, deriveAccountBalance, computeAccountEffects, accountSort } from '@/lib/utils.js';
import { formatINR } from '@/lib/currency.js';
import { Avatar } from '@/components/ui/Avatar.jsx';

const TYPES = [
  { value: 'bank', label: 'Bank', icon: Landmark },
  { value: 'card', label: 'Credit / Debit Card', icon: CreditCard },
  { value: 'wallet', label: 'Wallet / UPI', icon: Wallet }
];

const COLORS = ['#22d3ee', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#ec4899', '#64748b'];

export default function Accounts() {
  const accountsRaw = useLiveQuery(() => db.accounts.toArray(), [], []);
  const profiles = useLiveQuery(() => db.profiles.toArray(), [], []);
  const txns = useLiveQuery(() => db.transactions.toArray(), [], []);
  const accountEffects = useMemo(() => computeAccountEffects(txns), [txns]);
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const { success, error } = useToast();

  // Locally-ordered copy so a drag reorders instantly; persisted on drop.
  const [order, setOrder] = useState([]);
  useEffect(() => {
    setOrder(accountSort(accountsRaw));
  }, [accountsRaw]);

  const sensors = useSensors(
    // A small activation distance keeps taps on the edit/delete buttons working.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const del = async () => {
    if (!toDelete) return;
    const used = await db.transactions.where('accountId').equals(toDelete.id).count();
    if (used > 0) {
      error(`This account has ${used} transactions. Reassign or delete those first.`);
      return;
    }
    await db.accounts.delete(toDelete.id);
    success('Account deleted');
    setToDelete(null);
  };

  const onDragEnd = async ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const oldIndex = order.findIndex((a) => a.id === active.id);
    const newIndex = order.findIndex((a) => a.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(order, oldIndex, newIndex);
    setOrder(next); // optimistic
    await db.transaction('rw', db.accounts, async () => {
      for (let i = 0; i < next.length; i++) {
        if (next[i].sortOrder !== i) {
          await db.accounts.update(next[i].id, { sortOrder: i });
        }
      }
    });
  };

  return (
    <div className="space-y-3 animate-fade-in">
      <SectionHeader title="Accounts" subtitle="Banks, cards, wallets — and SMS aliases" />
      <button className="fs-btn-primary" onClick={() => setAdding(true)}>
        <Plus className="w-4 h-4" /> Add account
      </button>

      {order.length > 1 && (
        <p className="text-[11px] text-muted-fg px-1">Drag the handle to reorder how accounts appear across the app.</p>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={order.map((a) => a.id)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-2">
            {order.map((a) => (
              <SortableAccountRow
                key={a.id}
                account={a}
                effects={accountEffects.get(a.id)}
                onEdit={() => setEditing(a)}
                onDelete={() => setToDelete(a)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      <AccountEditor
        open={adding || !!editing}
        onClose={() => { setAdding(false); setEditing(null); }}
        editing={editing}
        effects={editing ? accountEffects.get(editing.id) : null}
        profiles={profiles}
        accounts={accountsRaw}
      />

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={del}
        title="Delete account?"
        message={`"${toDelete?.name}" will be removed.`}
        danger
        confirmText="Delete"
      />
    </div>
  );
}

function SortableAccountRow({ account: a, effects, onEdit, onDelete }) {
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging
  } = useSortable({ id: a.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 30 : undefined
  };
  const Icon = TYPES.find((t) => t.value === a.type)?.icon ?? Landmark;
  return (
    <li ref={setNodeRef} style={style} className={cn(isDragging && 'opacity-80')}>
      <Card className="p-3">
        <div className="flex items-center gap-3">
          <button
            ref={setActivatorNodeRef}
            className="fs-btn-ghost px-1 -ml-1 cursor-grab active:cursor-grabbing touch-none text-muted-fg"
            aria-label={`Reorder ${a.name}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="w-4 h-4" />
          </button>
          <span
            className="w-10 h-10 rounded-xl inline-flex items-center justify-center"
            style={{ background: (a.color ?? '#22d3ee') + '22', color: a.color ?? '#22d3ee' }}
          >
            <Icon className="w-5 h-5" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm">{a.name}</p>
            <p className="text-xs text-muted-fg">
              {maskNumber(a.number)} · {formatINR(deriveAccountBalance(a, effects, null), { hidePaise: true })}
            </p>
          </div>
          <span className="fs-chip text-[10px] uppercase">{a.type}</span>
          <button className="fs-btn-ghost" onClick={onEdit}><Edit3 className="w-4 h-4" /></button>
          <button className="fs-btn-ghost text-danger" onClick={onDelete}><Trash2 className="w-4 h-4" /></button>
        </div>
        {(a.aliases ?? []).length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {a.aliases.map((al) => <span key={al} className="fs-chip">{al}</span>)}
          </div>
        )}
      </Card>
    </li>
  );
}

function AccountEditor({ open, onClose, editing, effects, profiles, accounts = [] }) {
  const { success, error } = useToast();
  const [form, setForm] = useState(blank());

  useEffect(() => {
    if (!open) return;
    if (editing) {
      // The balance inputs show the DERIVED CURRENT balance per profile
      // (opening + Σ effects). On save we back the opening figure out again.
      const eff = effects ?? {};
      const ob = editing.openingBalances && typeof editing.openingBalances === 'object'
        ? editing.openingBalances
        : null;
      const balances = {};
      for (const pid of editing.profileIds ?? []) {
        const key = String(pid);
        balances[key] = ob
          ? Number(ob[key] ?? 0) + Number(eff[key] ?? 0)
          // legacy account not yet backfilled: old stored total per profile
          : Number((editing.balances ?? {})[key] ?? editing.balance ?? 0);
      }
      setForm({
        ...blank(),
        ...editing,
        balances,
        aliases: editing.aliases ?? [],
        profileIds: editing.profileIds ?? []
      });
    } else {
      setForm(blank());
    }
  }, [open, editing, effects]);

  function blank() {
    return {
      name: '',
      type: 'bank',
      number: '',
      balances: {},     // { [profileId]: number }
      color: COLORS[0],
      isActive: 1,
      profileIds: [],
      aliases: [],
      aliasDraft: ''
    };
  }

  const toggleProfile = (id) => {
    setForm((f) => {
      const has = f.profileIds.includes(id);
      const profileIds = has ? f.profileIds.filter((x) => x !== id) : [...f.profileIds, id];
      const balances = { ...f.balances };
      if (has) delete balances[String(id)];
      else if (!(String(id) in balances)) balances[String(id)] = 0;
      return { ...f, profileIds, balances };
    });
  };

  const setBalance = (profileId, raw) => {
    // Keep the raw string while typing so a "-" or a trailing "." isn't stripped by
    // Number() mid-edit (that was blocking negative and decimal entry). The save
    // handler coerces to a number.
    setForm((f) => ({
      ...f,
      balances: { ...f.balances, [String(profileId)]: raw }
    }));
  };

  const addAlias = () => {
    const v = form.aliasDraft.trim().toUpperCase();
    if (!v) return;
    if (form.aliases.includes(v)) return;
    setForm((f) => ({ ...f, aliases: [...f.aliases, v], aliasDraft: '' }));
  };

  const save = async () => {
    try {
      if (!form.name.trim()) throw new Error('Name required');
      if (form.profileIds.length === 0) throw new Error('Pick at least one profile');
      // The input holds the desired CURRENT balance per profile; store the
      // OPENING balance (current − Σ effects) so the derived current matches
      // exactly. For a new account there are no effects yet, so opening = current.
      const eff = effects ?? {};
      const openingBalances = {};
      for (const pid of form.profileIds) {
        const key = String(pid);
        const n = Number(form.balances[key]);
        const current = isFinite(n) ? n : 0;
        openingBalances[key] = current - Number(eff[key] ?? 0);
      }
      const payload = {
        name: form.name.trim(),
        type: form.type,
        number: form.number ?? '',
        openingBalances,
        balances: null, // clear legacy stored running balance
        balance: null,  // clear legacy single-balance field
        color: form.color,
        isActive: 1,
        profileIds: form.profileIds.map(Number),
        aliases: form.aliases
      };
      if (editing) {
        await db.accounts.update(editing.id, payload);
      } else {
        // Append: place new accounts at the end of the user's custom order.
        const maxOrder = (accounts ?? []).reduce(
          (m, a) => Math.max(m, a.sortOrder ?? a.id ?? 0),
          -1
        );
        await db.accounts.add({ ...payload, sortOrder: maxOrder + 1 });
      }
      success(editing ? 'Account updated' : 'Account added');
      onClose?.();
    } catch (e) {
      error(e.message);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit account' : 'Add account'}
      size="lg"
      footer={
        <>
          <button className="fs-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="fs-btn-primary" onClick={save}>Save</button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Account name">
          <input className="fs-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="HDFC Bank" />
        </Field>
        <Field label="Type">
          <Select value={form.type} onChange={(v) => setForm({ ...form, type: v })}
            options={TYPES.map((t) => ({ value: t.value, label: t.label }))} />
        </Field>
        <Field label="Account / card number">
          <input className="fs-input" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} placeholder="50100123457890" />
        </Field>
      </div>

      <Field label="Color">
        <div className="flex flex-wrap gap-2">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setForm({ ...form, color: c })}
              className={`w-8 h-8 rounded-full ring-2 ring-offset-2 ring-offset-background ${form.color === c ? 'ring-primary' : 'ring-transparent'}`}
              style={{ background: c }}
            />
          ))}
        </div>
      </Field>

      <Field label="Visible to profiles" hint="Each linked profile gets its own balance below">
        <div className="flex flex-wrap gap-2">
          {profiles.map((p) => {
            const active = form.profileIds.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => toggleProfile(p.id)}
                className={cn(
                  'px-3 py-1.5 rounded-xl border text-xs flex items-center gap-1.5',
                  active ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-elevated'
                )}
              >
                <span>{p.avatar}</span> {p.name}
              </button>
            );
          })}
        </div>
      </Field>

      {form.profileIds.length > 0 && (
        <Field
          label="Current balance per profile (₹)"
          hint="The balance as of now; transactions adjust it automatically. For credit cards, use a negative value if there's an outstanding balance"
        >
          <div className="space-y-2">
            {form.profileIds.map((pid) => {
              const profile = profiles.find((p) => p.id === pid);
              return (
                <div key={pid} className="flex items-center gap-2">
                  <Avatar size="sm" name={profile?.name} avatar={profile?.avatar} color={profile?.color} />
                  <span className="text-sm flex-1 truncate">{profile?.name ?? `#${pid}`}</span>
                  <input
                    inputMode="decimal"
                    className="fs-input w-36 text-right"
                    value={form.balances[String(pid)] ?? ''}
                    onChange={(e) => setBalance(pid, e.target.value)}
                    placeholder="0"
                  />
                </div>
              );
            })}
          </div>
        </Field>
      )}

      <Field
        label="SMS aliases"
        hint="Mask formats like XX7890, 12XXXX90, 1234XX. Used to auto-match incoming SMS to this account."
      >
        <div className="flex gap-2">
          <input
            className="fs-input"
            value={form.aliasDraft}
            onChange={(e) => setForm({ ...form, aliasDraft: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAlias(); } }}
            placeholder="XX7890"
          />
          <button type="button" className="fs-btn-secondary" onClick={addAlias}>Add</button>
        </div>
        {form.aliases.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {form.aliases.map((al) => (
              <span key={al} className="fs-chip">
                {al}
                <button onClick={() => setForm({ ...form, aliases: form.aliases.filter((x) => x !== al) })}>
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </Field>
    </Modal>
  );
}
