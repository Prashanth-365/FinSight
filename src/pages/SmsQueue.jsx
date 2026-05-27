import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Inbox, Plus, Wand2, X, Smartphone, Download, Radio, ChevronLeft, ChevronRight,
  EyeOff, RotateCcw
} from 'lucide-react';
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
import { aliasMatchesAccountNumber, fmtDateTime, cn } from '@/lib/utils.js';
import { formatINR } from '@/lib/currency.js';

/* ───────── Native SMS controls ───────── */

function NativeSmsControls() {
  const [permission, setPermission] = useState('unknown');
  const [busy, setBusy] = useState('');
  const [listenerActive, setListenerActive] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [stopFn, setStopFn] = useState(null);

  // Progress dialog state
  const [progressOpen, setProgressOpen] = useState(false);
  const [progress, setProgress] = useState({ stage: '', read: 0, found: 0, added: 0, total: 0 });
  const cancelRef = useRef(false);

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
    cancelRef.current = false;
    setProgress({ stage: 'starting', read: 0, found: 0, added: 0, total: 0 });
    setProgressOpen(true);
    setBusy('import');
    try {
      const ok = await ensureSmsPermission();
      if (!ok) { setPermission('denied'); setProgressOpen(false); return; }

      // Always pull the full history (subject to limit). Dedup by nativeId against
      // ALL existing queue rows — pending, processed, AND dismissed — so a row
      // you've manually dismissed won't reappear on a future import.
      setProgress((p) => ({ ...p, stage: 'reading' }));
      const { messages } = await fetchSmsHistory({ sinceTs: 0, limit: 10000 });
      if (cancelRef.current) { setProgressOpen(false); return; }

      const allExisting = await db.smsQueue.toArray();
      const existingNativeIds = new Set(allExisting.map((s) => s.nativeId).filter(Boolean));

      setProgress((p) => ({ ...p, stage: 'parsing', total: messages.length }));

      // Build payloads in memory (fast), then bulkAdd in one transaction.
      const toInsert = [];
      let scanned = 0;
      for (const m of messages) {
        scanned++;
        if (cancelRef.current) break;
        if (scanned % 200 === 0) {
          setProgress((p) => ({ ...p, read: scanned, found: toInsert.length }));
          // give the UI a tick so progress actually paints
          await new Promise((r) => setTimeout(r, 0));
        }
        if (existingNativeIds.has(m.id)) continue;
        const parsed = parseSms(m.body);
        if (!parsed.amount) continue;
        toInsert.push({
          rawSms: `${m.sender}: ${m.body}`,
          parsedData: parsed,
          status: 'pending',
          dateTime: m.date,
          linkedTxnId: null,
          nativeId: m.id,
          source: 'inbox-history'
        });
      }

      if (cancelRef.current) { setProgressOpen(false); return; }
      setProgress((p) => ({ ...p, stage: 'saving', read: scanned, found: toInsert.length }));

      let added = 0;
      if (toInsert.length) {
        // Chunked bulkAdd so very large batches don't lock the DB for a long time.
        const CHUNK = 500;
        for (let i = 0; i < toInsert.length; i += CHUNK) {
          if (cancelRef.current) break;
          const slice = toInsert.slice(i, i + CHUNK);
          await db.smsQueue.bulkAdd(slice);
          added += slice.length;
          setProgress((p) => ({ ...p, added }));
        }
      }

      await setSetting('sms.lastImportTs', Date.now());
      setLastSync(Date.now());
      setProgress((p) => ({ ...p, stage: 'done', added }));
    } catch (e) {
      setProgress((p) => ({ ...p, stage: 'error', error: e.message }));
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

      <SmsImportProgress
        open={progressOpen}
        progress={progress}
        onCancel={() => { cancelRef.current = true; }}
        onHide={() => setProgressOpen(false)}
        onClose={() => setProgressOpen(false)}
      />
    </div>
  );
}

function SmsImportProgress({ open, progress, onCancel, onHide, onClose }) {
  if (!open) return null;
  const { stage, read, found, added, total, error } = progress;
  const done = stage === 'done' || stage === 'error';
  const pct = total > 0 ? Math.min(100, Math.round((read / total) * 100)) : null;

  return (
    <Modal
      open={open}
      onClose={done ? onClose : onHide}
      title={
        stage === 'done' ? 'Import complete'
        : stage === 'error' ? 'Import failed'
        : stage === 'reading' ? 'Reading SMS inbox…'
        : stage === 'parsing' ? 'Scanning bank/UPI SMS…'
        : stage === 'saving' ? 'Saving to FinSight…'
        : 'Importing'
      }
      size="sm"
      footer={
        <>
          {!done && (
            <>
              <button className="fs-btn-ghost" onClick={() => { onCancel(); }}>Cancel</button>
              <button className="fs-btn-secondary" onClick={onHide}>
                <EyeOff className="w-4 h-4" /> Hide (keep running)
              </button>
            </>
          )}
          {done && <button className="fs-btn-primary" onClick={onClose}>Close</button>}
        </>
      }
    >
      {stage === 'error' ? (
        <p className="text-sm text-danger">{error}</p>
      ) : (
        <>
          {pct != null && (
            <div className="h-2 bg-muted rounded-full overflow-hidden mb-3">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: stage === 'saving' || stage === 'done' ? '100%' : `${pct}%` }}
              />
            </div>
          )}
          <ul className="space-y-1.5 text-sm">
            <Row label="Messages scanned" value={read.toLocaleString('en-IN')}
                 total={total ? total.toLocaleString('en-IN') : null} />
            <Row label="Bank/UPI matches" value={found.toLocaleString('en-IN')} />
            <Row label="Added to inbox" value={added.toLocaleString('en-IN')} />
          </ul>
          {stage !== 'done' && (
            <p className="text-xs text-muted-fg mt-3">
              You can close this dialog — the import keeps running in the background.
            </p>
          )}
        </>
      )}
    </Modal>
  );
}
function Row({ label, value, total }) {
  return (
    <li className="flex items-center justify-between">
      <span className="text-muted-fg">{label}</span>
      <span className="font-medium tabular-nums">{value}{total ? ` / ${total}` : ''}</span>
    </li>
  );
}

/* ───────── SMS parser ───────── */

function parseSms(raw) {
  const text = raw || '';
  const amountMatch = text.match(/(?:Rs\.?|INR|₹)\s*([0-9,]+(?:\.\d{1,2})?)/i);
  const amount = amountMatch ? Number(amountMatch[1].replace(/,/g, '')) : null;

  const typeDebit = /(debited|spent|withdrawn|paid|sent|purchase|charged)/i.test(text);
  const typeCredit = /(credited|received|deposited|refund|cashback)/i.test(text);
  const txnType = typeDebit ? 'debit' : typeCredit ? 'credit' : 'debit';

  const acctMatch = text.match(/(?:A\/c|Card|ending|XX|xx)\s*[*x]*\s*(\d{4,})/i);
  const aliasGuess = acctMatch ? `XX${acctMatch[1]}` : null;

  const dateMatch = text.match(/(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/);
  const date = dateMatch ? new Date(dateMatch[1]).getTime() : Date.now();

  return { amount, txnType, aliasGuess, date };
}

/* ───────── SMS Queue page ───────── */

const PAGE_SIZE_OPTIONS = [25, 50, 100, 'All'];

export default function SmsQueue() {
  const queue = useLiveQuery(() => db.smsQueue.orderBy('dateTime').reverse().toArray(), [], []);
  const accounts = useLiveQuery(() => db.accounts.toArray(), [], []);
  const [adding, setAdding] = useState(false);

  const [showDismissed, setShowDismissed] = useState(false);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);

  const pending = useMemo(() => (queue ?? []).filter((s) => s.status === 'pending'), [queue]);
  const processed = useMemo(() => (queue ?? []).filter((s) => s.status === 'processed'), [queue]);
  const dismissed = useMemo(() => (queue ?? []).filter((s) => s.status === 'dismissed'), [queue]);

  const pendingPage = useMemo(() => {
    if (pageSize === 'All') return pending;
    const start = (page - 1) * pageSize;
    return pending.slice(start, start + pageSize);
  }, [pending, page, pageSize]);

  const totalPages = pageSize === 'All' ? 1 : Math.max(1, Math.ceil(pending.length / pageSize));
  useEffect(() => { if (page > totalPages) setPage(1); }, [totalPages, page]);

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

      {/* Pending list */}
      <Card>
        <div className="px-4 py-2 flex items-center justify-between gap-2 border-b border-border">
          <div className="text-xs font-semibold text-muted-fg uppercase tracking-wider">
            Pending ({pending.length.toLocaleString('en-IN')})
          </div>
          {pending.length > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <label className="text-muted-fg">per page</label>
              <select
                className="fs-input py-1 px-2 text-xs w-auto"
                value={pageSize}
                onChange={(e) => {
                  const v = e.target.value === 'All' ? 'All' : Number(e.target.value);
                  setPageSize(v);
                  setPage(1);
                }}
              >
                {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          )}
        </div>
        {pending.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="Inbox is empty"
            hint={isNativeAndroid()
              ? 'Tap "Import past SMS" above to scan your phone\'s inbox for bank/UPI messages.'
              : 'Paste a bank/UPI SMS to auto-parse fields, or install the Android APK for automatic SMS sync.'}
            action={<button className="fs-btn-primary" onClick={() => setAdding(true)}>Paste SMS</button>}
          />
        ) : (
          <>
            <ul className="divide-y divide-border">
              {pendingPage.map((sms) => <SmsRow key={sms.id} sms={sms} accounts={accounts} />)}
            </ul>
            {pageSize !== 'All' && totalPages > 1 && (
              <Pager page={page} totalPages={totalPages} onChange={setPage}
                     visible={pendingPage.length} total={pending.length} />
            )}
          </>
        )}
      </Card>

      {/* Dismissed list (collapsed by default) */}
      {dismissed.length > 0 && (
        <Card>
          <button
            onClick={() => setShowDismissed((v) => !v)}
            className="w-full px-4 py-2 flex items-center justify-between text-xs font-semibold text-muted-fg uppercase tracking-wider border-b border-border hover:bg-muted/40"
          >
            <span>Dismissed ({dismissed.length})</span>
            <span className="normal-case text-[11px] text-primary">{showDismissed ? 'Hide' : 'Show'}</span>
          </button>
          {showDismissed && (
            <ul className="divide-y divide-border">
              {dismissed.slice(0, 100).map((sms) => (
                <li key={sms.id} className="p-3 text-sm flex items-center gap-2">
                  <span className="truncate text-muted-fg flex-1">{sms.rawSms.slice(0, 80)}…</span>
                  <button
                    className="fs-btn-ghost text-xs"
                    title="Restore to pending"
                    onClick={() => db.smsQueue.update(sms.id, { status: 'pending' })}
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Restore
                  </button>
                  <button
                    className="text-xs text-danger"
                    title="Delete permanently"
                    onClick={() => db.smsQueue.delete(sms.id)}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* Processed list */}
      {processed.length > 0 && (
        <Card>
          <div className="px-4 py-2 text-xs font-semibold text-muted-fg uppercase tracking-wider border-b border-border">
            Processed ({processed.length})
          </div>
          <ul className="divide-y divide-border">
            {processed.slice(0, 30).map((sms) => (
              <li key={sms.id} className="p-3 text-sm flex items-center justify-between">
                <span className="truncate text-muted-fg">{sms.rawSms.slice(0, 70)}…</span>
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

function Pager({ page, totalPages, onChange, visible, total }) {
  return (
    <div className="px-3 py-2 flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-fg">
        Showing {((page - 1) * (total / totalPages) | 0) + 1}–{((page - 1) * (total / totalPages) | 0) + visible} of {total.toLocaleString('en-IN')}
      </span>
      <div className="flex items-center gap-1">
        <button
          className="fs-btn-ghost px-2 py-1 disabled:opacity-50"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="px-2">{page} / {totalPages}</span>
        <button
          className="fs-btn-ghost px-2 py-1 disabled:opacity-50"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
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
  // X button = soft dismiss (preserves nativeId so re-import won't bring it back)
  const dismiss = async () => {
    await db.smsQueue.update(sms.id, { status: 'dismissed' });
  };
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
        <button onClick={dismiss} className="text-muted-fg hover:text-danger" aria-label="Dismiss" title="Dismiss — won't reimport">
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

  useEffect(() => {
    if (!open) return;
    setForm((f) => ({
      ...f,
      accountId: matched?.id ?? f.accountId,
      profileId: profiles[0]?.id ?? f.profileId
    }));
  }, [open, matched, profiles]);

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
      const txnDateTime = sms.dateTime ?? sms.parsedData?.date ?? Date.now();
      const txnType = sms.parsedData?.txnType ?? 'debit';
      const selectedAccount = accounts.find((a) => a.id === Number(form.accountId));
      const txnId = await db.transactions.add({
        slNo: 0,
        dateTime: txnDateTime,
        profileId: Number(form.profileId),
        accountId: Number(form.accountId),
        categoryId: cat.id,
        subCategoryId: sub?.id ?? null,
        amount: amt,
        txnType,
        paymentMode: selectedAccount?.type ?? 'bank',
        description: form.description ?? '',
        tags,
        source: 'sms'
      });
      await reindexSlNo();
      if (selectedAccount) {
        const delta = (txnType === 'credit' ? 1 : -1) * amt;
        await db.accounts.update(selectedAccount.id, {
          balance: Number(selectedAccount.balance ?? 0) + delta
        });
      }
      await db.smsQueue.update(sms.id, { status: 'processed', linkedTxnId: txnId });
      success('Transaction created — view it in the Transactions tab');
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
