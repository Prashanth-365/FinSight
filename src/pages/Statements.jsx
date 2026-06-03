// Statement import is no longer a standalone page — it's a modal launched from
// the Inbox. Pick the account a statement belongs to, parse it on-device, and
// reconcile: anything already in your books or inbox is skipped, and only the
// genuinely-missing rows are added to the inbox for review/conversion.
import { useEffect, useRef, useState } from 'react';
import { Upload, Loader2, FileText, CheckCircle2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal.jsx';
import { Field } from '@/components/ui/Input.jsx';
import { Select } from '@/components/ui/Select.jsx';
import { useToast } from '@/components/ui/Toast.jsx';
import { parseStatement } from '@/lib/statement/index.js';
import { ingestStatementRows } from '@/lib/reconcile.js';
import { maskNumber } from '@/lib/utils.js';

export function StatementImportModal({ open, onClose, accounts = [] }) {
  const { success, error } = useToast();
  const fileRef = useRef(null);
  const [accountId, setAccountId] = useState('');
  const [parsing, setParsing] = useState(false);
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    if (open) { setAccountId(''); setSummary(null); setParsing(false); }
  }, [open]);

  const onPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!accountId) { error('Pick which account this statement belongs to first.'); return; }
    setParsing(true);
    setSummary(null);
    try {
      const { rows, meta } = await parseStatement(file);
      const res = await ingestStatementRows({ rows, accountId: Number(accountId), accounts });
      setSummary({ ...res, fileName: file.name, bank: meta?.bank });
      if (res.added > 0) success(`Added ${res.added} new transaction${res.added === 1 ? '' : 's'} to the inbox`);
      else success('Nothing new — everything in this statement is already logged');
    } catch (err) {
      error(err.message);
    } finally {
      setParsing(false);
    }
  };

  const accountChosen = !!accountId;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import statement"
      footer={<button className="fs-btn-primary" onClick={onClose}>Done</button>}
    >
      <p className="text-xs text-muted-fg mb-3">
        Upload a bank statement (PDF / Excel / CSV). We parse it on-device, skip anything already in
        your books or inbox, and add only the missing transactions here for review.
      </p>

      <Field label="Account this statement belongs to">
        <Select
          value={accountId}
          onChange={setAccountId}
          options={[
            { value: '', label: 'Pick account…' },
            ...accounts.map((a) => ({ value: a.id, label: `${a.name} ${maskNumber(a.number)}` }))
          ]}
        />
      </Field>

      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.xlsx,.xls,.csv,application/pdf"
        className="hidden"
        onChange={onPick}
      />
      <button
        className="fs-btn-primary w-full mt-3"
        onClick={() => fileRef.current?.click()}
        disabled={parsing || !accountChosen}
      >
        {parsing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        {parsing ? 'Parsing…' : 'Choose statement file'}
      </button>
      {!accountChosen && (
        <p className="text-[11px] text-muted-fg text-center mt-1">Select an account to enable upload.</p>
      )}

      {summary && (
        <div className="mt-4 rounded-xl border border-border bg-elevated p-3">
          <p className="text-sm font-medium flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary shrink-0" />
            <span className="truncate">{summary.fileName}</span>
            {summary.bank && summary.bank !== 'GENERIC' && <span className="fs-chip">{summary.bank}</span>}
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            <SummaryRow label="Added to inbox" value={summary.added} tone="primary" />
            <SummaryRow label="Already in your books" value={summary.alreadyInBooks} />
            <SummaryRow label="Already in inbox" value={summary.mergedWithInbox} />
            {summary.dismissed > 0 && <SummaryRow label="Previously dismissed" value={summary.dismissed} />}
            <SummaryRow label="Rows parsed" value={summary.total} />
          </ul>
          {summary.added > 0 && (
            <p className="text-[11px] text-success mt-2 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> Close this and review them in the pending list.
            </p>
          )}
        </div>
      )}

      <p className="text-[11px] text-muted-fg border-t border-border pt-3 mt-3">
        Supported: text-based PDF (not scanned), XLSX, XLS, CSV. Everything runs locally — the file never leaves your device.
      </p>
    </Modal>
  );
}

function SummaryRow({ label, value, tone }) {
  return (
    <li className="flex items-center justify-between">
      <span className="text-muted-fg">{label}</span>
      <span className={tone === 'primary' ? 'font-semibold tabular-nums text-primary' : 'font-semibold tabular-nums'}>
        {Number(value ?? 0).toLocaleString('en-IN')}
      </span>
    </li>
  );
}
