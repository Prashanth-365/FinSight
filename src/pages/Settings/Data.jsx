import { useEffect, useRef, useState } from 'react';
import { Download, Upload, Cloud, CloudOff, Trash2, ShieldCheck, RefreshCw, KeyRound, Info, Eye, EyeOff } from 'lucide-react';
import { db, reindexSlNo, getSetting, setSetting } from '@/db/database.js';
import { Card } from '@/components/ui/Card.jsx';
import { Field } from '@/components/ui/Input.jsx';
import { Modal, ConfirmDialog } from '@/components/ui/Modal.jsx';
import { useToast } from '@/components/ui/Toast.jsx';
import { SectionHeader } from './Profiles.jsx';
import { passphraseScore } from '@/lib/crypto.js';
import { connect, disconnect, isConnected } from '@/lib/drive.js';
import { pushBackup, pullBackup, remoteStatus } from '@/lib/backup.js';
import { fmtDateTime, cn } from '@/lib/utils.js';

const TABLES = ['users', 'profiles', 'accounts', 'categories', 'transactions', 'investments', 'chitFunds', 'smsQueue', 'settings'];

async function dumpAll() {
  const out = {};
  for (const t of TABLES) out[t] = await db.table(t).toArray();
  return { version: 1, exportedAt: Date.now(), data: out };
}

async function restoreAll(payload) {
  if (!payload?.data) throw new Error('Invalid export file');
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) {
      await db.table(t).clear();
      if (Array.isArray(payload.data[t]) && payload.data[t].length > 0) {
        await db.table(t).bulkAdd(payload.data[t]);
      }
    }
  });
  await reindexSlNo();
}

export default function Data() {
  const { success, error, info } = useToast();
  const fileRef = useRef(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const onExport = async () => {
    const payload = await dumpAll();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `finsight-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    success('Export downloaded');
  };

  const onImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      await restoreAll(payload);
      success('Import complete — reloading…');
      setTimeout(() => location.reload(), 800);
    } catch (err) {
      error('Could not import: ' + err.message);
    } finally {
      e.target.value = '';
    }
  };

  const onWipe = async () => {
    for (const t of TABLES) await db.table(t).clear();
    info('All data cleared — reloading…');
    setTimeout(() => location.reload(), 800);
  };

  return (
    <div className="space-y-3 animate-fade-in">
      <SectionHeader title="Data" subtitle="Backup, restore, encrypted Google Drive sync" />

      <DriveCard />

      <Card className="p-4 space-y-3">
        <Row
          title="Export to JSON"
          desc="Download every record on this device as an unencrypted JSON file."
          icon={Download}
          action={<button className="fs-btn-primary" onClick={onExport}>Export</button>}
        />
        <Row
          title="Import from JSON"
          desc="Restore from a previous FinSight export. Replaces all current data."
          icon={Upload}
          action={
            <>
              <input ref={fileRef} type="file" accept="application/json" onChange={onImport} className="hidden" />
              <button className="fs-btn-secondary" onClick={() => fileRef.current?.click()}>Import file</button>
            </>
          }
        />
        <Row
          title="Wipe all data"
          desc="Permanently delete every transaction, account and profile on this device."
          icon={Trash2}
          action={<button className="fs-btn-danger" onClick={() => setConfirmReset(true)}>Wipe</button>}
        />
      </Card>

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={onWipe}
        title="Wipe all data?"
        message="This will permanently delete every transaction, account, profile, and investment on this device. You will be logged out."
        danger
        confirmText="Wipe everything"
      />
    </div>
  );
}

function Row({ title, desc, icon: Icon, action }) {
  return (
    <div className="flex items-center gap-3">
      <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-muted text-muted-fg shrink-0">
        <Icon className="w-5 h-5" />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-fg">{desc}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

/* -------------------- Drive sync card -------------------- */

function DriveCard() {
  const { success, error, info } = useToast();
  const [clientId, setClientId] = useState('');
  const [passphrase, setPassphrase] = useState(''); // kept only in memory
  const [showPass, setShowPass] = useState(false);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState('');
  const [status, setStatus] = useState({ lastSyncedAt: null, remoteModifiedTime: null, exists: null });
  const [setupOpen, setSetupOpen] = useState(false);
  const [confirmPull, setConfirmPull] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  useEffect(() => {
    (async () => {
      setClientId((await getSetting('drive.clientId', '')) ?? '');
      setStatus({
        lastSyncedAt: await getSetting('drive.lastSyncedAt', null),
        remoteModifiedTime: await getSetting('drive.remoteModifiedTime', null)
      });
    })();
  }, []);

  const refreshStatus = async () => {
    try {
      const r = await remoteStatus();
      setStatus((s) => ({
        ...s,
        exists: r?.exists ?? false,
        remoteModifiedTime: r?.modifiedTime ?? s.remoteModifiedTime
      }));
    } catch {}
  };

  const handleConnect = async (mode = 'consent') => {
    try {
      if (!clientId.trim()) throw new Error('Paste your Google OAuth Client ID first.');
      setBusy('connect');
      await setSetting('drive.clientId', clientId.trim());
      await connect(clientId.trim(), mode);
      setConnected(true);
      success('Connected to Google Drive');
      await refreshStatus();
    } catch (e) {
      error(e.message);
    } finally {
      setBusy('');
    }
  };

  const handleDisconnect = async () => {
    disconnect();
    setConnected(false);
    setPassphrase('');
    info('Disconnected from Google Drive');
  };

  const handlePush = async () => {
    try {
      if (!connected && !isConnected()) await handleConnect('');
      if (!passphrase) throw new Error('Enter your encryption passphrase.');
      if (passphraseScore(passphrase) < 2) throw new Error('Passphrase is too weak. Use 8+ chars with mixed case / digits.');
      setBusy('push');
      const meta = await pushBackup(passphrase);
      setStatus({ lastSyncedAt: Date.now(), remoteModifiedTime: meta.modifiedTime ?? null, exists: true });
      success('Encrypted backup uploaded');
    } catch (e) {
      error(e.message);
    } finally {
      setBusy('');
    }
  };

  const handlePull = async () => {
    try {
      if (!connected && !isConnected()) await handleConnect('');
      if (!passphrase) throw new Error('Enter your encryption passphrase.');
      setBusy('pull');
      await pullBackup(passphrase);
      success('Restored from Google Drive — reloading…');
      setTimeout(() => location.reload(), 1000);
    } catch (e) {
      error(e.message);
    } finally {
      setBusy('');
      setConfirmPull(false);
    }
  };

  const connectedNow = connected || isConnected();
  const score = passphraseScore(passphrase);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start gap-3">
        <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-primary/15 text-primary shrink-0">
          {connectedNow ? <Cloud className="w-5 h-5" /> : <CloudOff className="w-5 h-5" />}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium flex items-center gap-2">
            Google Drive sync
            <span className={cn('fs-chip text-[10px] uppercase', connectedNow ? 'text-success' : 'text-muted-fg')}>
              {connectedNow ? 'connected' : 'not connected'}
            </span>
          </p>
          <p className="text-xs text-muted-fg leading-snug">
            End-to-end encrypted backup to a hidden app folder on your Google Drive. No one else — not even Google's general search — can read it.
          </p>
        </div>
        <button className="fs-btn-ghost text-xs" onClick={() => setSetupOpen(true)} title="How to set up">
          <Info className="w-4 h-4" />
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Google OAuth Client ID" hint="One-time setup. See the ⓘ icon above.">
          <input
            className="fs-input font-mono text-xs"
            placeholder="123456-abc.apps.googleusercontent.com"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            spellCheck={false}
          />
        </Field>
        <Field label="Encryption passphrase" hint="Used only in this browser session. Never uploaded. Lose it = backup unreadable.">
          <div className="relative">
            <input
              className="fs-input pr-10"
              type={showPass ? 'text' : 'password'}
              placeholder="At least 8 chars; longer is better"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowPass((v) => !v)}
              className="absolute inset-y-0 right-2 grid place-items-center text-muted-fg"
              aria-label="Toggle visibility"
            >
              {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <PasswordStrength score={score} />
        </Field>
      </div>

      <div className="flex flex-wrap gap-2">
        {!connectedNow ? (
          <button className="fs-btn-primary" onClick={() => handleConnect('')} disabled={busy === 'connect'}>
            <KeyRound className="w-4 h-4" /> {busy === 'connect' ? 'Connecting…' : 'Connect to Google Drive'}
          </button>
        ) : (
          <>
            <button className="fs-btn-primary" onClick={handlePush} disabled={!!busy}>
              <Cloud className="w-4 h-4" /> {busy === 'push' ? 'Encrypting & uploading…' : 'Back up now'}
            </button>
            <button className="fs-btn-secondary" onClick={() => setConfirmPull(true)} disabled={!!busy}>
              <RefreshCw className={cn('w-4 h-4', busy === 'pull' && 'animate-spin')} /> Restore from Drive
            </button>
            <button className="fs-btn-ghost" onClick={refreshStatus}>Check status</button>
            <button className="fs-btn-ghost text-danger ml-auto" onClick={() => setConfirmDisconnect(true)}>
              Disconnect
            </button>
          </>
        )}
      </div>

      <div className="text-xs text-muted-fg space-y-0.5 border-t border-border pt-3">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-success" />
          AES-256-GCM · PBKDF2-SHA256 (200k iter) · scope <code>drive.appdata</code> only
        </div>
        {status.lastSyncedAt && <div>Last sync from this device: {fmtDateTime(status.lastSyncedAt)}</div>}
        {status.remoteModifiedTime && <div>Drive backup last modified: {fmtDateTime(new Date(status.remoteModifiedTime).getTime())}</div>}
        {status.exists === false && <div>No backup file in Drive yet — click "Back up now" to create one.</div>}
      </div>

      <SetupModal open={setupOpen} onClose={() => setSetupOpen(false)} />

      <ConfirmDialog
        open={confirmPull}
        onClose={() => setConfirmPull(false)}
        onConfirm={handlePull}
        title="Restore from Drive?"
        message="This will REPLACE all data currently on this device with the encrypted backup from Google Drive. Make sure you have entered the correct passphrase."
        danger
        confirmText="Replace local data"
      />
      <ConfirmDialog
        open={confirmDisconnect}
        onClose={() => setConfirmDisconnect(false)}
        onConfirm={handleDisconnect}
        title="Disconnect Google Drive?"
        message="The access token is revoked and forgotten. Your Drive backup is not deleted — you can reconnect any time."
        confirmText="Disconnect"
      />
    </Card>
  );
}

function PasswordStrength({ score }) {
  const labels = ['', 'Weak', 'Okay', 'Strong', 'Very strong'];
  const colors = ['', 'bg-danger', 'bg-warning', 'bg-success', 'bg-success'];
  return (
    <div className="mt-1.5">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className={cn('h-1 flex-1 rounded-full', i <= score ? colors[score] : 'bg-muted')} />
        ))}
      </div>
      {score > 0 && <p className="text-[11px] text-muted-fg mt-1">{labels[score]}</p>}
    </div>
  );
}

function SetupModal({ open, onClose }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="One-time Google Drive setup"
      size="lg"
      footer={<button className="fs-btn-primary" onClick={onClose}>Got it</button>}
    >
      <div className="text-sm space-y-3 leading-relaxed">
        <p className="text-muted-fg">
          FinSight talks to <em>your own</em> Google Cloud project — that means the consent screen
          is yours, no third-party app is ever approved, and your Drive backup uses Google's
          own infrastructure.
        </p>

        <ol className="list-decimal pl-5 space-y-2.5">
          <li>
            Open the{' '}
            <a className="text-primary underline" target="_blank" rel="noopener" href="https://console.cloud.google.com/projectcreate">
              Google Cloud Console
            </a>{' '}
            and create a new project (name it anything, e.g. <code>finsight</code>).
          </li>
          <li>
            Enable the{' '}
            <a className="text-primary underline" target="_blank" rel="noopener" href="https://console.cloud.google.com/apis/library/drive.googleapis.com">
              Google Drive API
            </a>{' '}
            for that project.
          </li>
          <li>
            Open <strong>APIs &amp; Services → OAuth consent screen</strong>. Pick <em>External</em>,
            fill in just the app name (e.g. FinSight) and your email. On the <em>Scopes</em>{' '}
            step, leave it empty — we use a non-sensitive scope so no review is needed.{' '}
            On <em>Test users</em>, add your own Google account.
          </li>
          <li>
            Open <strong>APIs &amp; Services → Credentials → Create credentials → OAuth client ID →
            Web application</strong>. Under <em>Authorised JavaScript origins</em>, add the exact
            URL where this app runs — e.g. <code>https://finsight-you.vercel.app</code>{' '}
            (also <code>http://localhost:5173</code> if you run it locally).
          </li>
          <li>
            Copy the <strong>Client ID</strong> (looks like <code>123-abc.apps.googleusercontent.com</code>)
            and paste it into the field above. Click <em>Connect</em>.
          </li>
        </ol>

        <div className="rounded-xl bg-elevated border border-border p-3 text-xs space-y-1.5">
          <p className="font-semibold flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-success" /> What we ask Google for</p>
          <p>
            One scope: <code>drive.appdata</code>. That gives access <em>only</em> to a hidden
            folder created by FinSight — not the rest of your Drive. You can revoke access any time at{' '}
            <a className="text-primary underline" target="_blank" rel="noopener" href="https://myaccount.google.com/connections">myaccount.google.com/connections</a>.
          </p>
        </div>

        <div className="rounded-xl bg-warning/10 border border-warning/30 p-3 text-xs">
          <p className="font-semibold mb-1">About the passphrase</p>
          <p>
            We encrypt the backup before uploading. Your passphrase is the only key — it is never
            sent anywhere. <strong>If you forget it, the backup cannot be recovered.</strong>{' '}
            Write it down somewhere safe.
          </p>
        </div>
      </div>
    </Modal>
  );
}
