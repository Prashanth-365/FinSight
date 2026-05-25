import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { ChevronLeft, Plus, Edit3, Trash2 } from 'lucide-react';
import { db } from '@/db/database.js';
import { Card } from '@/components/ui/Card.jsx';
import { Modal, ConfirmDialog } from '@/components/ui/Modal.jsx';
import { Field } from '@/components/ui/Input.jsx';
import { Avatar } from '@/components/ui/Avatar.jsx';
import { useToast } from '@/components/ui/Toast.jsx';

const COLORS = ['#22d3ee', '#f97316', '#a855f7', '#10b981', '#ef4444', '#3b82f6', '#eab308', '#ec4899'];
const EMOJIS = ['👑', '🧑', '👩', '👶', '👦', '👧', '🧔', '👵', '👴', '🐱', '🐶', '🦊'];

export default function Profiles() {
  const profiles = useLiveQuery(() => db.profiles.orderBy('createdAt').toArray(), [], []);
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const { success, error } = useToast();

  const del = async () => {
    if (!toDelete) return;
    if (toDelete.isDefault) {
      error('Cannot delete the master profile.');
      return;
    }
    const used = await db.transactions.where('profileId').equals(toDelete.id).count();
    if (used > 0) {
      error(`This profile has ${used} transaction${used > 1 ? 's' : ''}. Reassign or delete those first.`);
      return;
    }
    await db.profiles.delete(toDelete.id);
    success('Profile deleted');
    setToDelete(null);
  };

  return (
    <div className="space-y-3 animate-fade-in">
      <SectionHeader title="Profiles" subtitle="Family members who share this device" />
      <button className="fs-btn-primary w-full md:w-auto" onClick={() => setAdding(true)}>
        <Plus className="w-4 h-4" /> Add profile
      </button>

      <ul className="space-y-2">
        {profiles.map((p) => (
          <li key={p.id}>
            <Card className="p-3 flex items-center gap-3">
              <Avatar name={p.name} avatar={p.avatar} color={p.color} size="md" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm flex items-center gap-2">
                  {p.name}
                  {p.isDefault === 1 && <span className="fs-chip text-[10px] uppercase">Master</span>}
                </p>
                <p className="text-xs text-muted-fg">No login required — switch via header avatar.</p>
              </div>
              <button className="fs-btn-ghost" onClick={() => setEditing(p)}><Edit3 className="w-4 h-4" /></button>
              {!p.isDefault && (
                <button className="fs-btn-ghost text-danger" onClick={() => setToDelete(p)}>
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </Card>
          </li>
        ))}
      </ul>

      <ProfileEditor
        open={adding || !!editing}
        onClose={() => { setAdding(false); setEditing(null); }}
        editing={editing}
      />

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={del}
        title="Delete this profile?"
        message={`"${toDelete?.name}" will be removed.`}
        danger
        confirmText="Delete"
      />
    </div>
  );
}

function ProfileEditor({ open, onClose, editing }) {
  const { success, error } = useToast();
  const [form, setForm] = useState({ name: '', avatar: '🧑', color: COLORS[0] });

  useEffect(() => {
    if (!open) return;
    if (editing) setForm({ name: editing.name, avatar: editing.avatar ?? '🧑', color: editing.color ?? COLORS[0] });
    else setForm({ name: '', avatar: '🧑', color: COLORS[0] });
  }, [open, editing]);

  const save = async () => {
    try {
      if (!form.name.trim()) throw new Error('Name required');
      if (editing) {
        await db.profiles.update(editing.id, { name: form.name.trim(), avatar: form.avatar, color: form.color });
      } else {
        await db.profiles.add({
          name: form.name.trim(),
          avatar: form.avatar,
          color: form.color,
          isDefault: 0,
          createdAt: Date.now()
        });
      }
      success(editing ? 'Profile updated' : 'Profile added');
      onClose?.();
    } catch (e) {
      error(e.message);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit profile' : 'Add profile'}
      footer={
        <>
          <button className="fs-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="fs-btn-primary" onClick={save}>Save</button>
        </>
      }
    >
      <Field label="Name">
        <input className="fs-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Priya" />
      </Field>
      <Field label="Avatar">
        <div className="flex flex-wrap gap-2">
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setForm({ ...form, avatar: e })}
              className={`w-10 h-10 rounded-xl border text-lg ${form.avatar === e ? 'border-primary bg-primary/10' : 'border-border'}`}
            >
              {e}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Color">
        <div className="flex flex-wrap gap-2">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setForm({ ...form, color: c })}
              className={`w-8 h-8 rounded-full ring-2 ring-offset-2 ring-offset-background ${form.color === c ? 'ring-primary' : 'ring-transparent'}`}
              style={{ background: c }}
              aria-label={c}
            />
          ))}
        </div>
      </Field>
    </Modal>
  );
}

export function SectionHeader({ title, subtitle, back = '/settings' }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <Link to={back} className="fs-btn-ghost"><ChevronLeft className="w-4 h-4" /></Link>
      <div className="flex-1">
        <h1 className="text-lg font-semibold leading-tight">{title}</h1>
        {subtitle && <p className="text-xs text-muted-fg">{subtitle}</p>}
      </div>
    </div>
  );
}
