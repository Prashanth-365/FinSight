import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Inbox, Plus, Wand2, X, Smartphone, Download, Radio } from 'lucide-react';
import { db, reindexSlNo, getSetting, setSetting } from '@/db/database.js';
import {
  isNativeAndroid, ensureSmsPermission, checkSmsPermission, fetchSmsHistory, startSmsListener
} from '@/lib/smsNative.js';
import { Card } from '@/components/ui/Card.jsx';
import { EmptyState } from '@/components/ui/Empty.jsx';
import { Modal } from '@/components/ui/Modal.jsx';
import { Field } from '@/components/ui/Input.jsx';
import { Combobox } from '@/components/ui/Combobox.jsx';
import { Select } from '@/components/ui/Select.jsx';
import { useToast } from '@/components/ui/Toast.jsx';
import { aliasMatchesAccountNumber, fmtDateTime } from '@/lib/utils.js';
import { formatINR } from '@/lib/currency.js';

function NativeSmsControls() {
  const [permission, setPermission] = useState('unknown');
  const [busy, setBusy] = useState('');
  const [listenerActive, setListenerActive] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [stopFn, setStopFn] = useState(null);

  useEffect(() => {
    (async () => {
      setPermission(await checkSmsPermission());
      setLastSync(await getSetting('sms.lastImportTs', null));
      const wantsListen = await getSetting('sms.autoListen', false);
      if (wantsListen) await startListening();
    })();
    return () => { if (stopFn) stopFn(); };
    // eslint-disable-next-line
  }, []);

  const grant = async () => {
    setBusy('perm');
    const ok = await ensureSmsPermission();
    setPermission(ok ? 'granted' : 'denied');
    setBusy('');
  };

  const importHistory = async () => {
    setBusy('import');
    try {
      const ok = await ensureSmsPermission();
      if (!ok) { setPermission('denied'); return; }
      const sinceTs = (await getSetting('sms.lastImportTs', 0)) ?? 0;
      const { messages } = await fetchSmsHistory({ sinceTs, limit: 5000 });
      let added = 0;
      const existingIds = new Set((await db.smsQueue.toArray())
        .map((s) => s.nativeId).filter(Boolean));
      for (const m of messages) {
        if (existingIds.has(m.id)) continue;
        const parsed = parseSms(m.body);
        if (!parsed.amount) continue; // skip messages we can't even pull an amount from
        await db.smsQueue.add({
          rawSms: `${m.sender}: ${m.body}`,
          parsedData: parsed,
          status: 'pending',
          dateTime: m.date,
          linkedTxnId: null,
          nativeId: m.id,
          source: 'inbox-history'
        });
        added++;
      }
      await setSetting('sms.lastImportTs', Date.now());
      setLastSync(Date.now());
      alert(added > 0
        ? `Imported ${added} new SMS into the inbox.`
        : 'No new bank/UPI messages found since last import.');
    } catch (e) {
      alert('Could not read SMS: ' + e.message);
    } finally {
      setBusy('');
    }
  };

  const startListening = async () => {
    setBusy('listen');
    const ok = await ensureSmsPermission();
    if (!ok) { setPermission('denied'); setBusy(''); return; }
    const stop = await startSmsListener(async (m) => {
      const parsed = parseSms(m.body);
      if (!parsed.amount) return;
      await db.smsQueue.add({
        rawSms: `${m.sender}: ${m.body}`,
        parsedData: parsed,
        status: 'pending',
        dateTime: m.date,
        linkedTxnId: null,
        nativeId: null,
        source: 'inbox-live'
      });
    });
    setStopFn(() => stop);
    setListenerActive(true);
    await setSetting('sms.autoListen', true);
    setBusy('');
  };

  const stopListening = async () => {
    if (stopFn) await stopFn();
    setStopFn(null);
    setListenerActive(false);
    await setSetting('sms.autoListen', false);
  };

  return (
    <div className="fs-card p-3.5 animate-slide-up">
      <div className="flex items-start gap-3">
        <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-primary/15 text-primary shrink-0">
          <Smartphone className="w-5 h-5" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium flex items-center gap-2">
            Auto SMS tracking
            <span className={`fs-chip text-[10px] uppercase ${
              permission === 'granted' ? 'text-success' : 'text-muted-fg'
            }`}>
              {permission === 'granted' ? 'enabled' : permission === 'denied' ? 'denied' : 'not granted'}
            </span>
          </p>
          <p className="text-xs text-muted-fg">
            We scan SMS only from likely bank/UPI senders. Your messages never leave this device.
          </p>
        </div>
      </div>

      {permission !== 'granted' ? (
        <button className="fs-btn-primary w-full mt-3" onClick={grant} disabled={busy === 'perm'}>
          {busy === 'perm' ? 'Asking…' : 'Grant SMS permission'}
        </button>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button className="fs-btn-secondary" onClick={importHistory} disabled={!!busy}>
            <Download className="w-4 h-4" />
            {busy === 'import' ? 'Reading inbox…' : 'Import past SMS'}
          </button>
          {!listenerActive ? (
            <button className="fs-btn-primary" onClick={startListening} disabled={!!busy}>
              <Radio className="w-4 h-4" /> Auto-track new SMS
            </button>
          ) : (
            <button className="fs-btn-ghost text-danger" onClick={stopListening}>
              <Radio className="w-4 h-4" /> Stop auto-track
            </button>
          )}
        </div>
      )}
      {lastSync && (
        <p className="text-[11px] text-muted-fg mt-2">
          Last history import: {new Date(lastSync).toLocaleString('en-IN')}
        </p>
      )}
    </div>
  );
}

// Minimal SMS heuristic parser — works on common Indian bank/UPI SMS shapes.
function parseSms(raw) {
  const text = raw || '';
  const amountMatch = text.match(/(?:Rs\.?|INR|₹)\s*([0-9,]+(?:\.\d{1,2})?)/i);
  const amount = amountMatch ? Number(amountMatch[1].replace(/,/g, '')) : null;

  const typeDebit = /(debited|spent|withdrawn|paid|sent|purchase|charged)/i.test(text);
  const typeCredit = /(credited|received|deposited|refund|cashback)/i.test(text);
  const txnType = typeDebit ? 'debit' : typeCredit ? 'credit' : 'debit';

  // account hint like XX1234 or ending 1234
  const acctMatch = text.match(/(?:A\/c|Card|ending|XX|xx)\s*[*x]*\s*(\d{4,})/i);
  const aliasGuess = acctMatch ? `XX${acctMatch[1]}` : null;

  // date is best-effort; default now
  const dateMatch = text.match(/(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/);
  const date = dateMatch ? new Date(dateMatch[1]).getTime() : Date.now();

  return { amount, txnType, aliasGuess, date };
}

export default function SmsQueue() {
  const queue = useLiveQuery(() => db.smsQueue.toArray(), [], []);
  const accounts = useLiveQuery(() => db.accounts.toArray(), [], []);
  const [adding, setAdding] = useState(false);

  const pending = (queue ?? []).filter((s) => s.status === 'pending');
  const processed = (queue ?? []).filter((s) => s.status === 'processed');

  return (
    <div className="space-y-3 animate-fade-in">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold">SMS inbox</h1>
          <p className="text-xs text-muted-fg">Review parsed SMS and convert into transactions.</p>
        </div>
        <button className="fs-btn-secondary" onClick={() => setAdding(true)}>
          <Plus className="w-4 h-4" /> Paste SMS
        </button>
      </div>

      {isNativeAndroid() && <NativeSmsControls />}

      <Card>
        <div className="px-4 py-2 text-xs font-semibold text-muted-fg uppercase tracking-wider border-b border-border">
          Pending ({pending.length})
        </div>
        {pending.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="Inbox is empty"
            hint="Paste a bank/UPI SMS to auto-parse fields. Background SMS sync arrives on Android in a later release."
            action={<button className="fs-btn-primary" onClick={() => setAdding(true)}>Paste SMS</button>}
          />
        ) : (
          <ul className="divide-y divide-border">
            {pending.map((sms) => <SmsRow key={sms.id} sms={sms} accounts={accounts} />)}
          </ul>
        )}
      </Card>

      {processed.length > 0 && (
        <Card>
          <div className="px-4 py-2 text-xs font-semibold text-muted-fg uppercase tracking-wider border-b border-border">
            Processed ({processed.length})
          </div>
          <ul className="divide-y divide-border">
            {processed.slice(0, 20).map((sms) => (
              <li key={sms.id} className="p-3 text-sm flex items-center justify-between">
                <span className="truncate text-muted-fg">{sms.rawSms.slice(0, 60)}…</span>
                <button
                  className="text-xs text-danger ml-2"
                  onClick={() => db.smsQueue.delete(sms.id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <AddSmsModal open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function AddSmsModal({ open, onClose }) {
  const [text, setText] = useState('');
  const { success } = useToast();
  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const parsed = parseSms(trimmed);
    await db.smsQueue.add({
      rawSms: trimmed,
      parsedData: parsed,
      status: 'pending',
      dateTime: parsed.date,
      linkedTxnId: null
    });
    setText('');
    success('SMS added to inbox');
    onClose?.();
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Paste SMS"
      footer={
        <>
          <button className="fs-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="fs-btn-primary" onClick={submit}>Add to inbox</button>
        </>
      }
    >
      <p className="text-xs text-muted-fg mb-2">Paste a bank/UPI SMS — we'll try to extract amount, account, and type.</p>
      <textarea
        rows={6}
        className="fs-input"
        placeholder="e.g. Rs.350 debited from A/c XX7890 on 12-08-25 to PAYTM."
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
    </Modal>
  );
}

function SmsRow({ sms, accounts }) {
  const [open, setOpen] = useState(false);
  const matched = accounts.find((a) =>
    (a.aliases ?? []).some((al) => aliasMatchesAccountNumber(al, sms.parsedData?.aliasGuess ?? '')) ||
    (sms.parsedData?.aliasGuess && a.number && String(a.number).endsWith(sms.parsedData.aliasGuess.replace(/[X*]/g, '')))
  );
  return (
    <li className="p-3">
      <div className="flex items-start gap-3">
        <Wand2 className="w-4 h-4 mt-1 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-snug break-words">{sms.rawSms}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
            {sms.parsedData?.amount && (
              <span className="fs-chip">₹ {formatINR(sms.parsedData.amount, { hidePaise: true }).replace('₹', '')}</span>
            )}
            <span className={`fs-chip ${sms.parsedData?.txnType === 'credit' ? 'text-success' : 'text-danger'}`}>
              {sms.parsedData?.txnType ?? 'debit'}
            </span>
            {sms.parsedData?.aliasGuess && <span className="fs-chip">{sms.parsedData.aliasGuess}</span>}
            <span className="fs-chip">{fmtDateTime(sms.dateTime ?? sms.parsedData?.date)}</span>
            {matched && <span className="fs-chip text-primary">→ {matched.name}</span>}
          </div>
        </div>
        <button onClick={() => db.smsQueue.delete(sms.id)} className="text-muted-fg hover:text-danger" aria-label="Discard">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <button className="fs-btn-primary text-xs px-3 py-1.5" onClick={() => setOpen(true)}>Convert to transaction</button>
      </div>
      <SmsConvertModal open={open} onClose={() => setOpen(false)} sms={sms} matched={matched} />
    </li>
  );
}

function SmsConvertModal({ open, onClose, sms, matched }) {
  const { success, error } = useToast();
  const accounts = useLiveQuery(() => db.accounts.toArray(), [], []);
  const categories = useLiveQuery(() => db.categories.toArray(), [], []);
  const profiles = useLiveQuery(() => db.profiles.toArray(), [], []);
  const allTxns = useLiveQuery(() => db.transactions.toArray(), [], []);

  const [form, setForm] = useState({
    profileId: '',
    accountId: matched?.id ?? '',
    category: '',
    subCategory: '',
    description: '',
    tags: ''
  });

  const categorySuggestions = Array.from(new Set([
    ...categories.filter((c) => c.parentId == null).map((c) => c.name),
    ...allTxns.map((t) => categories.find((c) => c.id === t.categoryId)?.name).filter(Boolean)
  ]));
  const subSuggestions = form.category ? categories.filter((c) =>
    c.parentId === categories.find((p) => p.name === form.category && p.parentId == null)?.id
  ).map((c) => c.name) : [];

  const save = async () => {
    try {
      const amt = Number(sms.parsedData?.amount ?? 0);
      if (!amt) throw new Error('No amount parsed — edit the SMS or add the transaction manually.');
      if (!form.profileId) throw new Error('Pick a profile');
      if (!form.accountId) throw new Error('Pick an account');
      if (!form.category) throw new Error('Pick or type a category');

      let cat = await db.categories.where({ name: form.category }).filter((c) => c.parentId == null).first();
      if (!cat) {
        const id = await db.categories.add({ name: form.category, parentId: null, icon: '🏷️', color: '#94a3b8', type: 'expense' });
        cat = await db.categories.get(id);
      }
      let sub = null;
      if (form.subCategory) {
        sub = await db.categories.where({ name: form.subCategory, parentId: cat.id }).first();
        if (!sub) {
          const id = await db.categories.add({ name: form.subCategory, parentId: cat.id, icon: cat.icon, color: cat.color, type: cat.type });
          sub = await db.categories.get(id);
        }
      }
      const tags = form.tags.split(',').map((s) => s.trim()).filter(Boolean);
      const txnId = await db.transactions.add({
        slNo: 0,
        dateTime: sms.parsedData?.date ?? Date.now(),
        profileId: Number(form.profileId),
        accountId: Number(form.accountId),
        categoryId: cat.id,
        subCategoryId: sub?.id ?? null,
        amount: amt,
        txnType: sms.parsedData?.txnType ?? 'debit',
        paymentMode: accounts.find((a) => a.id === Number(form.accountId))?.type ?? 'bank',
        description: form.description ?? '',
        tags,
        source: 'sms'
      });
      await reindexSlNo();
      await db.smsQueue.update(sms.id, { status: 'processed', linkedTxnId: txnId });
      success('Transaction created');
      onClose?.();
    } catch (e) {
      error(e.message);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Convert SMS to transaction"
      size="lg"
      footer={
        <>
          <button className="fs-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="fs-btn-primary" onClick={save}>Create transaction</button>
        </>
      }
    >
      <p className="text-xs text-muted-fg italic mb-3">{sms.rawSms}</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Profile">
          <Select value={form.profileId} onChange={(v) => setForm({ ...form, profileId: v })}
            options={[{ value: '', label: 'Pick…' }, ...profiles.map((p) => ({ value: p.id, label: p.name }))]} />
        </Field>
        <Field label="Account">
          <Select value={form.accountId} onChange={(v) => setForm({ ...form, accountId: v })}
            options={[{ value: '', label: 'Pick…' }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category">
          <Combobox value={form.category} onChange={(v) => setForm({ ...form, category: v, subCategory: '' })} suggestions={categorySuggestions} />
        </Field>
        <Field label="Sub-category">
          <Combobox value={form.subCategory} onChange={(v) => setForm({ ...form, subCategory: v })} suggestions={subSuggestions} />
        </Field>
      </div>
      <Field label="Description">
        <input className="fs-input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </Field>
      <Field label="Tags" hint="comma separated">
        <input className="fs-input" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
      </Field>
    </Modal>
  );
}
