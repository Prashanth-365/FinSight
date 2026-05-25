import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, ChevronDown, ChevronRight, Edit3, Trash2 } from 'lucide-react';
import { db } from '@/db/database.js';
import { Card } from '@/components/ui/Card.jsx';
import { Modal, ConfirmDialog } from '@/components/ui/Modal.jsx';
import { Field } from '@/components/ui/Input.jsx';
import { Select } from '@/components/ui/Select.jsx';
import { useToast } from '@/components/ui/Toast.jsx';
import { SectionHeader } from './Profiles.jsx';
import { cn } from '@/lib/utils.js';

const TYPES = ['expense', 'income', 'investment', 'transfer'];

export default function Categories() {
  const categories = useLiveQuery(() => db.categories.toArray(), [], []);
  const txns = useLiveQuery(() => db.transactions.toArray(), [], []);
  const [edit, setEdit] = useState(null);
  const [adding, setAdding] = useState(null); // { parentId } | null
  const [toDelete, setToDelete] = useState(null);
  const [expanded, setExpanded] = useState({});
  const { success, error } = useToast();

  const tree = useMemo(() => {
    const tops = categories.filter((c) => c.parentId == null);
    return tops.map((t) => ({ ...t, children: categories.filter((c) => c.parentId === t.id) }));
  }, [categories]);

  const usageCount = (id) => txns.filter((t) => t.categoryId === id || t.subCategoryId === id).length;

  const handleSave = async (form) => {
    try {
      if (!form.name.trim()) throw new Error('Name required');
      const cleanName = form.name.trim();
      const parentId = form.parentId || null;

      if (form.id) {
        // rename / merge
        const same = categories.find(
          (c) => c.id !== form.id && c.name.toLowerCase() === cleanName.toLowerCase() && (c.parentId ?? null) === (parentId ?? null)
        );
        if (same) {
          // merge: move txns to canonical, then delete this one
          await db.transaction('rw', db.categories, db.transactions, async () => {
            await db.transactions.where({ categoryId: form.id }).modify({ categoryId: same.id });
            await db.transactions.where({ subCategoryId: form.id }).modify({ subCategoryId: same.id });
            // also reparent any children of this category to the canonical one
            await db.categories.where({ parentId: form.id }).modify({ parentId: same.id });
            await db.categories.delete(form.id);
          });
          success(`Merged into "${same.name}"`);
        } else {
          await db.categories.update(form.id, {
            name: cleanName,
            icon: form.icon,
            color: form.color,
            type: form.type,
            parentId
          });
          success('Category updated');
        }
      } else {
        // add
        const dup = categories.find(
          (c) => c.name.toLowerCase() === cleanName.toLowerCase() && (c.parentId ?? null) === (parentId ?? null)
        );
        if (dup) throw new Error('A category with that name already exists at this level.');
        await db.categories.add({
          name: cleanName,
          parentId,
          icon: form.icon || '🏷️',
          color: form.color || '#94a3b8',
          type: form.type || 'expense'
        });
        success('Category added');
      }
    } catch (e) {
      error(e.message);
    }
  };

  const del = async () => {
    if (!toDelete) return;
    const usage = usageCount(toDelete.id);
    if (usage > 0) {
      error(`This category is used by ${usage} transaction${usage > 1 ? 's' : ''}. Merge or reassign first.`);
      return;
    }
    await db.transaction('rw', db.categories, async () => {
      await db.categories.where({ parentId: toDelete.id }).delete();
      await db.categories.delete(toDelete.id);
    });
    success('Deleted');
    setToDelete(null);
  };

  return (
    <div className="space-y-3 animate-fade-in">
      <SectionHeader title="Categories" subtitle="Tree of expense, income, investment & transfer tags" />
      <p className="text-xs text-muted-fg">
        💡 Renaming a category to a name that already exists at the same level will <em>merge</em> them — all transactions will be moved to the canonical category.
      </p>
      <button className="fs-btn-primary" onClick={() => setAdding({ parentId: null })}>
        <Plus className="w-4 h-4" /> Add top-level category
      </button>

      <Card>
        <ul className="divide-y divide-border">
          {tree.map((c) => {
            const open = !!expanded[c.id];
            const ucount = usageCount(c.id);
            return (
              <li key={c.id}>
                <div className="flex items-center gap-2 p-3">
                  <button
                    className="text-muted-fg hover:text-foreground"
                    onClick={() => setExpanded({ ...expanded, [c.id]: !open })}
                    aria-label="Toggle"
                  >
                    {c.children.length > 0
                      ? (open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />)
                      : <span className="w-4 h-4 inline-block" />}
                  </button>
                  <span
                    className="w-8 h-8 rounded-lg inline-flex items-center justify-center text-base"
                    style={{ background: (c.color ?? '#94a3b8') + '22', color: c.color ?? '#94a3b8' }}
                  >
                    {c.icon}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{c.name}</p>
                    <p className="text-[11px] text-muted-fg">{c.type} · {c.children.length} sub · {ucount} txn</p>
                  </div>
                  <button className="fs-btn-ghost text-xs" onClick={() => setAdding({ parentId: c.id })}>
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                  <button className="fs-btn-ghost" onClick={() => setEdit(c)}><Edit3 className="w-4 h-4" /></button>
                  <button className="fs-btn-ghost text-danger" onClick={() => setToDelete(c)}><Trash2 className="w-4 h-4" /></button>
                </div>
                {open && c.children.length > 0 && (
                  <ul className="bg-elevated/60 divide-y divide-border">
                    {c.children.map((sc) => {
                      const sUse = usageCount(sc.id);
                      return (
                        <li key={sc.id} className="flex items-center gap-2 p-3 pl-12">
                          <span
                            className="w-6 h-6 rounded inline-flex items-center justify-center text-xs"
                            style={{ background: (sc.color ?? '#94a3b8') + '22', color: sc.color ?? '#94a3b8' }}
                          >
                            {sc.icon}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm">{sc.name}</p>
                            <p className="text-[11px] text-muted-fg">{sUse} txn</p>
                          </div>
                          <button className="fs-btn-ghost" onClick={() => setEdit(sc)}><Edit3 className="w-4 h-4" /></button>
                          <button className="fs-btn-ghost text-danger" onClick={() => setToDelete(sc)}><Trash2 className="w-4 h-4" /></button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <CategoryEditor
        open={adding != null || edit != null}
        onClose={() => { setAdding(null); setEdit(null); }}
        editing={edit}
        defaults={adding ?? { parentId: null }}
        categories={categories}
        onSave={handleSave}
      />

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={del}
        title="Delete category?"
        message={`"${toDelete?.name}" will be removed.${toDelete?.parentId == null ? ' All its sub-categories will also be deleted.' : ''}`}
        danger
        confirmText="Delete"
      />
    </div>
  );
}

function CategoryEditor({ open, onClose, editing, defaults, categories, onSave }) {
  const tops = categories.filter((c) => c.parentId == null);
  const [form, setForm] = useState(blank());

  function blank() {
    return { id: null, name: '', icon: '🏷️', color: '#94a3b8', type: 'expense', parentId: null };
  }

  useEffect(() => {
    if (!open) return;
    if (editing) setForm({
      id: editing.id,
      name: editing.name,
      icon: editing.icon,
      color: editing.color,
      type: editing.type,
      parentId: editing.parentId
    });
    else setForm({ ...blank(), ...(defaults ?? {}) });
  }, [open, editing, defaults]); // eslint-disable-line

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit category' : 'Add category'}
      footer={
        <>
          <button className="fs-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="fs-btn-primary" onClick={() => { onSave(form); onClose(); }}>Save</button>
        </>
      }
    >
      <Field label="Name">
        <input className="fs-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Food" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type">
          <Select value={form.type} onChange={(v) => setForm({ ...form, type: v })}
            options={TYPES.map((t) => ({ value: t, label: t }))} />
        </Field>
        <Field label="Parent">
          <Select value={form.parentId ?? ''} onChange={(v) => setForm({ ...form, parentId: v ? Number(v) : null })}
            options={[{ value: '', label: 'None (top-level)' }, ...tops.filter((t) => t.id !== form.id).map((t) => ({ value: t.id, label: t.name }))]} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Icon (emoji)">
          <input className="fs-input" value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} maxLength={3} />
        </Field>
        <Field label="Color">
          <input type="color" className="fs-input p-1 h-10" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}
