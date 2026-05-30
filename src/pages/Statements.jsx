import { useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  FileText, Upload, ChevronLeft, CheckSquare, Square, Loader2
} from 'lucide-react';
import { db, reindexSlNo } from '@/db/database.js';
import { useProfile } from '@/context/ProfileContext.jsx';
import { Card } from '@/components/ui/Card.jsx';
import { Field } from '@/components/ui/Input.jsx';
import { Select } from '@/components/ui/Select.jsx';
import { Combobox } from '@/components/ui/Combobox.jsx';
import { useToast } from '@/components/ui/Toast.jsx';
import { parseStatement } from '@/lib/statement/index.js';
import {
  txnFingerprint, applyTxnDeltaToBalances, fmtDate, maskNumber, cn, freqSorted
} from '@/lib/utils.js';
import { formatINR } from '@/lib/currency.js';

export default function Statements() {
  const { profiles, activeProfileId } = useProfile();
  const accounts = useLiveQuery(() => db.accounts.toArray(), [], []);
  const categories = useLiveQuery(() => db.categories.toArray(), [], []);
  const existingTxns = useLiveQuery(() => db.transactions.toArray(), [], []);
  const { success, error } = useToast();
  const fileRef = useRef(null);

  const [accountId, setAccountId] = useState('');
  const [profileId, setProfileId] = useState(activeProfileId ?? '');
  const [parsing, setParsing] = useState(false);
  const [rows, setRows] = useState(null);      // parsed + dedup-annotated rows
  const [meta, setMeta] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [defaultCategory, setDefaultCategory] = useState('');

  const existingFingerprints = useMemo(
    () => new Set((existingTxns ?? []).map((t) => t.importFingerprint).filter(Boolean)),
    [existingTxns]
  );

  const catSuggestions = useMemo(
    () => freqSorted((categories ?? []).filter((c) => c.parentId == null).map((c) => c.name)),
    [categories]
  );

  const onPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!accountId) { error('Pick which account this statement belongs to first.'); return; }
    setParsing(true);
    setRows(null);
    try {
      const { rows: parsed, meta } = await parseStatement(file);
      // Annotate each row: is it a duplicate of something we already have?
      const annotated = parsed.map((r, i) => {
        const fp = txnFingerprint({
          accountId: Number(accountId),
          amount: r.amount,
          txnType: r.txnType,
          dateTime: r.date,
          description: r.description
        });
        return { ...r, _i: i, fingerprint: fp, duplicate: existingFingerprints.has(fp) };
      });
      setRows(annotated);
      setMeta({ ...meta, fileName: file.name });
      // Pre-select only the NEW (non-duplicate) rows
      setSelected(new Set(annotated.filter((r) => !r.duplicate).map((r) => r._i)));
      success(`Parsed ${annotated.length} rows from ${file.name}`);
    } catch (e) {
      error(e.message);
    } finally {
      setParsing(false);
    }
  };

  const toggle = (i) => setSelected((s) => {
    const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n;
  });

  const newCount = rows ? rows.filter((r) => !r.duplicate).length : 0;
  const dupCount = rows ? rows.length - newCount : 0;

  const doImport = async () => {
    if (!rows || selected.size === 0) return;
    if (!profileId) { error('Pick a profile to attach these transactions to.'); return; }
    const chosen = rows.filter((r) => selected.has(r._i));

    // Resolve default category once (fallback "Uncategorized")
    const catName = (defaultCategory || 'Uncategorized').trim();
    let cat = await db.categories.where({ name: catName }).filter((c) => c.parentId == null).first();
    if (!cat) {
      const id = await db.categories.add({ name: catName, parentId: null, icon: '🏷️', color: '#94a3b8', type: 'expense' });
      cat = await db.categories.get(id);
    }

    const acc = await db.accounts.get(Number(accountId));
    let balances = acc?.balances ?? null;
    let net = 0;
    const payloads = chosen.map((r) => {
      net += (r.txnType === 'credit' ? 1 : -1) * r.amount;
      return {
        slNo: 0,
        dateTime: r.date,
        profileId: Number(profileId),
        accountId: Number(accountId),
        categoryId: cat.id,
        subCategoryId: null,
        amount: r.amount,
        txnType: r.txnType,
        paymentMode: acc?.type ?? 'bank',
        description: r.description || 'Statement import',
        tags: [],
        source: 'statement',
        importFingerprint: r.fingerprint
      };
    });

    await db.transactions.bulkAdd(payloads);
    await reindexSlNo();

    // Apply net balance change for the imported rows
    if (acc) {
      const updated = applyTxnDeltaToBalances(acc, Number(profileId), net);
      await db.accounts.update(acc.id, { balances: updated, balance: null });
    }
    await db.statements.add({
      accountId: Number(accountId),
      importedAt: Date.now(),
      status: 'imported',
      fileName: meta?.fileName,
      count: payloads.length
    });

    success(`Imported ${payloads.length} transactions`);
    setRows(null);
    setMeta(null);
    setSelected(new Set());
  };

  return (
    <div className="space-y-3 animate-fade-in">
      <div>
        <h1 className="text-lg font-semibold">Statement import</h1>
        <p className="text-xs text-muted-fg">
          Upload a bank statement (PDF / Excel / CSV). We parse it on-device and skip anything already logged from SMS.
        </p>
      </div>

      {!rows ? (
        <Card className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Account">
              <Select
                value={accountId}
                onChange={setAccountId}
                options={[
                  { value: '', label: 'Pick account…' },
                  ...(accounts ?? []).map((a) => ({ value: a.id, label: `${a.name} ${maskNumber(a.number)}` }))
                ]}
              />
            </Field>
            <Field label="Profile">
              <Select
                value={profileId}
                onChange={setProfileId}
                options={[
                  { value: '', label: 'Pick profile…' },
                  ...(profiles ?? []).map((p) => ({ value: p.id, label: p.name }))
                ]}
              />
            </Field>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.xlsx,.xls,.csv,application/pdf"
            className="hidden"
            onChange={onPick}
          />
          <button
            className="fs-btn-primary w-full"
            onClick={() => fileRef.current?.click()}
            disabled={parsing || !accountId}
          >
            {parsing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {parsing ? 'Parsing…' : 'Choose statement file'}
          </button>
          {!accountId && <p className="text-[11px] text-muted-fg text-center">Select an account to enable upload.</p>}

          <div className="text-[11px] text-muted-fg border-t border-border pt-3 space-y-1">
            <p>• Supported: PDF (text-based, not scanned), XLSX, XLS, CSV.</p>
            <p>• Duplicates already captured via SMS are detected and skipped automatically.</p>
            <p>• Everything runs locally — the file never leaves your device.</p>
          </div>
        </Card>
      ) : (
        <>
          <Card className="p-3">
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span className="fs-chip"><FileText className="w-3 h-3" /> {meta?.fileName}</span>
              <span className="fs-chip">{rows.length} rows</span>
              <span className="fs-chip text-success">{newCount} new</span>
              {dupCount > 0 && <span className="fs-chip text-warning">{dupCount} already logged</span>}
              {meta?.bank && meta.bank !== 'GENERIC' && <span className="fs-chip">{meta.bank}</span>}
            </div>
            <div className="mt-3">
              <Field label="Default category for imported rows" hint="You can recategorise later in Transactions">
                <Combobox value={defaultCategory} onChange={setDefaultCategory} suggestions={catSuggestions} placeholder="Uncategorized" />
              </Field>
            </div>
          </Card>

          <Card>
            <div className="px-3 py-2 flex items-center justify-between border-b border-border text-xs">
              <button
                className="text-primary font-medium"
                onClick={() => setSelected(new Set(rows.filter((r) => !r.duplicate).map((r) => r._i)))}
              >
                Select new
              </button>
              <span className="text-muted-fg">{selected.size} selected</span>
              <button className="text-muted-fg" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
            <ul className="divide-y divide-border max-h-[50vh] overflow-auto">
              {rows.map((r) => (
                <li
                  key={r._i}
                  onClick={() => toggle(r._i)}
                  className={cn(
                    'flex items-center gap-3 p-3 cursor-pointer',
                    selected.has(r._i) ? 'bg-primary/5' : 'hover:bg-muted/40',
                    r.duplicate && 'opacity-60'
                  )}
                >
                  {selected.has(r._i)
                    ? <CheckSquare className="w-5 h-5 text-primary shrink-0" />
                    : <Square className="w-5 h-5 text-muted-fg shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{r.description || '—'}</p>
                    <p className="text-[11px] text-muted-fg">
                      {fmtDate(r.date)}
                      {r.duplicate && <span className="text-warning"> · already logged</span>}
                    </p>
                  </div>
                  <p className={cn('text-sm font-semibold tabular-nums', r.txnType === 'credit' ? 'text-success' : 'text-danger')}>
                    {r.txnType === 'credit' ? '+' : '−'} {formatINR(r.amount, { hidePaise: true })}
                  </p>
                </li>
              ))}
            </ul>
          </Card>

          <div className="flex gap-2">
            <button className="fs-btn-ghost flex-1" onClick={() => { setRows(null); setMeta(null); }}>
              <ChevronLeft className="w-4 h-4" /> Back
            </button>
            <button className="fs-btn-primary flex-1" onClick={doImport} disabled={selected.size === 0}>
              Import {selected.size} transaction{selected.size === 1 ? '' : 's'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
