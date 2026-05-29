import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Inbox, Plus, Wand2, X, Smartphone, Download, Radio, ChevronLeft, ChevronRight,
  EyeOff, RotateCcw
} from 'lucide-react';
import { db, getSetting, setSetting } from '@/db/database.js';
import {
  isNativeAndroid, ensureSmsPermission, checkSmsPermission, fetchSmsHistory, startSmsListener
} from '@/lib/smsNative.js';
import { Card } from '@/components/ui/Card.jsx';
import { EmptyState } from '@/components/ui/Empty.jsx';
import { Modal } from '@/components/ui/Modal.jsx';
import { useToast } from '@/components/ui/Toast.jsx';
import { TransactionSheet } from '@/components/transaction/TransactionSheet.jsx';
import { aliasMatchesAccountNumber, fmtDateTime, todayLocalISO, cn } from '@/lib/utils.js';
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
        if (!parsed.amount || !parsed.txnType) continue; // drop spam / non-txn
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
      if (!parsed.amount || !parsed.txnType) return;
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

const SPAM_RE = new RegExp(
  '(congratulations|pre-?approved|click here|apply now|hurry|offer ends|' +
  'limited offer|limited time|voucher|coupon|t&c|terms and conditions|' +
  'terms apply|know more|lifetime free|reward points|sign up|register now|' +
  'verify now|won |lucky|cashback up to|eligible to|eligibility)',
  'i'
);

const DEBIT_WORDS = /\b(debited|spent|withdrawn|withdrawal|paid|sent|purchase|charged|payment)\b/i;
const CREDIT_WORDS = /\b(credited|received|deposited|refund|cashback|salary|credit)\b/i;

// Parse a single "DD MMM YYYY HH:MM (AM|PM)?" style date if present.
function parseLooseDate(text) {
  if (!text) return null;
  // 1) DD-MM-YY or DD/MM/YYYY  (Indian convention)
  let m = text.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})\b/);
  if (m) {
    const day = +m[1], month = +m[2] - 1;
    let yr = +m[3];
    if (yr < 100) yr += 2000;
    const d = new Date(yr, month, day);
    if (!isNaN(d)) return d.getTime();
  }
  // 2) DD MMM YYYY HH:MM(AM/PM)?   e.g. "Apr 20 2024 9:26 PM" or "20 Apr 2024 21:35"
  m = text.match(
    /\b(?:(\d{1,2})\s+)?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})?(?:\s+|,\s*)(\d{2,4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM)?)?/i
  );
  if (m) {
    const day = +(m[1] || m[3] || 1);
    const monNames = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    const month = monNames.indexOf(m[2].toLowerCase());
    let yr = +m[4];
    if (yr < 100) yr += 2000;
    let hr = +(m[5] || 0);
    const min = +(m[6] || 0);
    if (m[7]?.toUpperCase() === 'PM' && hr < 12) hr += 12;
    if (m[7]?.toUpperCase() === 'AM' && hr === 12) hr = 0;
    const d = new Date(yr, month, day, hr, min);
    if (!isNaN(d)) return d.getTime();
  }
  return null;
}

function parseSms(raw) {
  const text = raw || '';

  // Reject obvious promotional / phishing content outright
  if (SPAM_RE.test(text)) {
    return { amount: null, txnType: null, aliasGuess: null, date: Date.now(), rejectedAs: 'spam' };
  }

  // Find all currency amounts; pick the one nearest a transaction verb,
  // otherwise the first one. This avoids confusing the "available balance"
  // with the actual transaction amount.
  const amountRe = /(?:Rs\.?|INR|₹)\s*([0-9,]+(?:\.\d{1,2})?)/gi;
  const matches = [...text.matchAll(amountRe)];
  if (matches.length === 0) {
    return { amount: null, txnType: null, aliasGuess: null, date: Date.now(), rejectedAs: 'no-amount' };
  }

  let best = matches[0];
  let bestScore = -1;
  for (const m of matches) {
    const idx = m.index ?? 0;
    const near = text.slice(Math.max(0, idx - 40), Math.min(text.length, idx + m[0].length + 40));
    // Prefer amounts near a verb and away from "bal"/"balance"/"available"
    let score = 0;
    if (DEBIT_WORDS.test(near) || CREDIT_WORDS.test(near)) score += 5;
    if (/\b(bal|balance|available|avail)\b/i.test(near)) score -= 3;
    if (score > bestScore) { bestScore = score; best = m; }
  }
  const amount = Number(best[1].replace(/,/g, ''));
  if (!amount || !isFinite(amount)) {
    return { amount: null, txnType: null, aliasGuess: null, date: Date.now(), rejectedAs: 'no-amount' };
  }

  // Detect txnType from the words IMMEDIATELY around the chosen amount.
  const idx = best.index ?? 0;
  const near = text.slice(Math.max(0, idx - 40), Math.min(text.length, idx + best[0].length + 40));
  let txnType;
  if (CREDIT_WORDS.test(near) && !DEBIT_WORDS.test(near)) txnType = 'credit';
  else if (DEBIT_WORDS.test(near) && !CREDIT_WORDS.test(near)) txnType = 'debit';
  else {
    // ambiguous near the amount — fall back to whichever verb appears first in the whole body
    const cIdx = text.search(CREDIT_WORDS);
    const dIdx = text.search(DEBIT_WORDS);
    if (cIdx === -1 && dIdx === -1) {
      return { amount, txnType: null, aliasGuess: null, date: Date.now(), rejectedAs: 'no-verb' };
    }
    if (cIdx === -1) txnType = 'debit';
    else if (dIdx === -1) txnType = 'credit';
    else txnType = cIdx < dIdx ? 'credit' : 'debit';
  }

  // Account hint
  const acctMatch = text.match(/(?:A\/c|Card|ending|XX|xx)\s*[*x]*\s*(\d{4,})/i);
  const aliasGuess = acctMatch ? `XX${acctMatch[1]}` : null;

  // Date — try richer formats; fall back to "now" only if absolutely nothing parses.
  const date = parseLooseDate(text) ?? Date.now();

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

  // One hoisted "convert this SMS" id so prev/next navigation lives in one place.
  const [convertingSmsId, setConvertingSmsId] = useState(null);

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
              {pendingPage.map((sms) => (
                <SmsRow
                  key={sms.id}
                  sms={sms}
                  accounts={accounts}
                  onConvert={(id) => setConvertingSmsId(id)}
                />
              ))}
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

      <SmsConverterSheet
        smsId={convertingSmsId}
        pending={pending}
        accounts={accounts}
        onClose={() => setConvertingSmsId(null)}
        onChange={setConvertingSmsId}
      />
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
  const [dateTime, setDateTime] = useState(todayLocalISO());
  const [autoDate, setAutoDate] = useState(true); // when true, follow parsed date as user types
  const { success, error } = useToast();

  useEffect(() => {
    if (open) {
      setText('');
      setDateTime(todayLocalISO());
      setAutoDate(true);
    }
  }, [open]);

  // Live-preview parse: as the user types, surface what we'd save.
  const preview = text ? parseSms(text) : null;

  useEffect(() => {
    if (!autoDate) return;
    if (preview?.date) {
      const d = new Date(preview.date);
      d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
      setDateTime(d.toISOString().slice(0, 16));
    }
  }, [preview?.date, autoDate]);

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const parsed = parseSms(trimmed);
    if (!parsed.amount || !parsed.txnType) {
      error('Could not find an amount + transaction verb in this SMS. Edit it or use Add Transaction manually.');
      return;
    }
    const ts = new Date(dateTime).getTime();
    await db.smsQueue.add({
      rawSms: trimmed,
      parsedData: { ...parsed, date: ts },
      status: 'pending',
      dateTime: ts,
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
        className="fs-input mb-3"
        placeholder="e.g. Rs.350 debited from A/c XX7890 on 12-08-25 to PAYTM."
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div>
        <label className="text-xs font-medium text-muted-fg mb-1.5 block">
          Date &amp; time {autoDate && '(auto-detected — edit to override)'}
        </label>
        <input
          type="datetime-local"
          className="fs-input"
          value={dateTime}
          onChange={(e) => { setDateTime(e.target.value); setAutoDate(false); }}
        />
      </div>
      {preview?.amount && preview?.txnType && (
        <div className="mt-3 text-xs flex flex-wrap gap-1.5">
          <span className="fs-chip">₹ {Number(preview.amount).toLocaleString('en-IN')}</span>
          <span className={`fs-chip ${preview.txnType === 'credit' ? 'text-success' : 'text-danger'}`}>
            {preview.txnType}
          </span>
          {preview.aliasGuess && <span className="fs-chip">{preview.aliasGuess}</span>}
        </div>
      )}
      {text && !preview?.amount && (
        <p className="text-[11px] text-warning mt-2">⚠ Couldn't extract an amount from this SMS.</p>
      )}
      {text && preview?.amount && !preview?.txnType && (
        <p className="text-[11px] text-warning mt-2">⚠ Looks like a non-transaction SMS (no debit/credit verb).</p>
      )}
    </Modal>
  );
}

function matchAccountForSms(sms, accounts) {
  return accounts.find((a) =>
    (a.aliases ?? []).some((al) => aliasMatchesAccountNumber(al, sms.parsedData?.aliasGuess ?? '')) ||
    (sms.parsedData?.aliasGuess && a.number && String(a.number).endsWith(sms.parsedData.aliasGuess.replace(/[X*]/g, '')))
  );
}

function buildInitialFromSms(sms, matched) {
  const ts = sms.dateTime ?? sms.parsedData?.date ?? Date.now();
  const d = new Date(ts);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return {
    dateTime: d.toISOString().slice(0, 16),
    accountId: matched?.id ?? '',
    amount: sms.parsedData?.amount ? String(sms.parsedData.amount) : '',
    txnType: sms.parsedData?.txnType ?? 'debit',
    description: '',
    tags: ''
  };
}

/**
 * One TransactionSheet for the whole SMS Queue page; navigates between pending
 * SMS via prev/next/dismiss icons and "Save & next".
 *
 *   smsId    — id of the SMS currently being converted (null hides the sheet)
 *   pending  — full pending list (newest-first), used to compute prev/next
 *   onChange — called with a new id when nav buttons move us along
 *   onClose  — closes the sheet entirely
 */
function SmsConverterSheet({ smsId, pending, accounts, onClose, onChange }) {
  const idx = useMemo(
    () => (smsId == null ? -1 : pending.findIndex((s) => s.id === smsId)),
    [smsId, pending]
  );
  const current = idx >= 0 ? pending[idx] : null;
  const matched = current ? matchAccountForSms(current, accounts) : null;
  const initial = useMemo(
    () => (current ? buildInitialFromSms(current, matched) : null),
    [current, matched]
  );

  // After current SMS is processed/dismissed and disappears from `pending`,
  // pick the row that was right after it (now at the same idx), else the
  // previous one, else close.
  const advance = () => {
    const remaining = pending.filter((s) => s.id !== smsId);
    if (remaining.length === 0) { onClose?.(); return; }
    const nextSms = remaining[idx] ?? remaining[idx - 1] ?? remaining[0];
    onChange?.(nextSms.id);
  };

  if (!current) return null;

  const hasPrev = idx > 0;
  const hasNext = idx < pending.length - 1;

  return (
    <TransactionSheet
      // Force form reset when switching to a different SMS
      key={current.id}
      open={!!current}
      onClose={onClose}
      initial={initial}
      smsLink={current.id}
      smsText={current.rawSms}
      smsIndex={idx + 1}
      smsTotal={pending.length}
      onPrev={hasPrev ? () => onChange?.(pending[idx - 1].id) : null}
      onNext={hasNext ? () => onChange?.(pending[idx + 1].id) : null}
      onDismiss={async () => {
        await db.smsQueue.update(current.id, { status: 'dismissed' });
        advance();
      }}
      onSavedAndNext={advance}
    />
  );
}

function SmsRow({ sms, accounts, onConvert }) {
  const matched = matchAccountForSms(sms, accounts);
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
        <button className="fs-btn-primary text-xs px-3 py-1.5" onClick={() => onConvert(sms.id)}>Convert to transaction</button>
      </div>
    </li>
  );
}

