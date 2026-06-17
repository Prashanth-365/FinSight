import { useEffect, useRef, useState } from 'react';
import { Download, Upload, Cloud, CloudOff, Trash2, ShieldCheck, ShieldAlert, RefreshCw, Eye, EyeOff, LogIn } from 'lucide-react';
import { db, getSetting, setSetting } from '@/db/database.js';
import { Card } from '@/components/ui/Card.jsx';
import { Field } from '@/components/ui/Input.jsx';
import { Modal, ConfirmDialog } from '@/components/ui/Modal.jsx';
import { useToast } from '@/components/ui/Toast.jsx';
import { SectionHeader } from './Profiles.jsx';
import { passphraseScore } from '@/lib/crypto.js';
import { isSignedIn, signInWithGoogle, getEffectiveClientId } from '@/lib/googleAuth.js';
import { pushBackup, pullBackup, remoteStatus, verifyPassphraseAgainstRemote, TABLES, restoreAll, exportToFile } from '@/lib/backup.js';
import { fmtDateTime, cn } from '@/lib/utils.js';

export default function Data() {
  const { success, error, info } = useToast();
  const fileRef = useRef(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const onExport = async () => {
    try {
      const { platform, path } = await exportToFile();
      if (platform === 'android') success(`Saved to Downloads → ${path}`);
      else success('Export downloaded');
    } catch (e) {
      error('Export failed: ' + e.message);
    }
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
      <SectionHeader title="Data" subtitle="Encrypted Drive backup, export, import, wipe" />

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
  const [passphrase, setPassphrase] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState('');
  const [status, setStatus] = useState({ lastSyncedAt: null, remoteModifiedTime: null, exists: null, lastEncrypted: null });
  const [confirmPull, setConfirmPull] = useState(false);
  const [encrypt, setEncrypt] = useState(true);
  const [confirmTurnOff, setConfirmTurnOff] = useState(false);
  const [confirmPassOpen, setConfirmPassOpen] = useState(false);
  const [confirmPass, setConfirmPass] = useState('');
  const [mismatchOpen, setMismatchOpen] = useState(false);

  useEffect(() => {
    setConnected(isSignedIn());
    (async () => {
      const enc = await getSetting('drive.encrypt', true);
      setEncrypt(enc !== false);
      setStatus({
        lastSyncedAt: await getSetting('drive.lastSyncedAt', null),
        remoteModifiedTime: await getSetting('drive.remoteModifiedTime', null),
        lastEncrypted: await getSetting('drive.lastEncrypted', null)
      });
    })();
  }, []);

  const toggleEncrypt = async (nextOn) => {
    if (!nextOn) { setConfirmTurnOff(true); return; }
    setEncrypt(true);
    await setSetting('drive.encrypt', true);
  };
  const reallyTurnOff = async () => {
    setEncrypt(false);
    await setSetting('drive.encrypt', false);
    setConfirmTurnOff(false);
  };

  const refreshStatus = async () => {
    try {
      const r = await remoteStatus();
      setStatus((s) => ({
        ...s,
        exists: r?.exists ?? false,
        remoteModifiedTime: r?.modifiedTime ?? s.remoteModifiedTime
      }));
    } catch (e) {
      error(e.message);
    }
  };

  const handleReconnect = async () => {
    try {
      setBusy('reconnect');
      const cid = await getEffectiveClientId();
      if (!cid) throw new Error('No Google Client ID configured.');
      await signInWithGoogle(cid);
      setConnected(true);
      success('Drive access restored');
    } catch (e) {
      error(e.message);
    } finally {
      setBusy('');
    }
  };

  const ensureConnected = async () => {
    if (isSignedIn()) return true;
    const cid = await getEffectiveClientId();
    if (!cid) {
      error('Google Sign-In is not set up. Sign out and use the Google button on the login screen.');
      return false;
    }
    await signInWithGoogle(cid);
    setConnected(isSignedIn());
    return isSignedIn();
  };

  const reallyPush = async () => {
    setConfirmPassOpen(false);
    setMismatchOpen(false);
    try {
      setBusy('push');
      const meta = await pushBackup(passphrase, { encrypt });
      setStatus((s) => ({ ...s, lastSyncedAt: Date.now(), remoteModifiedTime: meta.modifiedTime ?? null, exists: true, lastEncrypted: encrypt }));
      success(encrypt ? 'Encrypted backup uploaded' : 'Backup uploaded (plain text)');
    } catch (e) {
      error(e.message);
    } finally {
      setBusy('');
    }
  };

  const handlePush = async () => {
    try {
      if (encrypt) {
        if (!passphrase) throw new Error('Enter your encryption passphrase.');
        if (passphraseScore(passphrase) < 2) throw new Error('Passphrase is too weak. Use 8+ chars with mixed case / digits.');
      }
      if (!(await ensureConnected())) return;

      // Encryption has no "correct" passphrase to check against — a typo silently
      // locks the backup. Guard it: verify against the existing Drive file, and on
      // the very first backup (nothing to verify against) confirm by re-typing.
      if (encrypt) {
        setBusy('verify');
        const v = await verifyPassphraseAgainstRemote(passphrase);
        setBusy('');
        if (v.firstBackup) { setConfirmPass(''); setConfirmPassOpen(true); return; }
        if (!v.ok) { setMismatchOpen(true); return; }
      }
      await reallyPush();
    } catch (e) {
      error(e.message);
      setBusy('');
    }
  };

  const handlePull = async () => {
    try {
      if (!(await ensureConnected())) return;
      setBusy('pull');
      // Pull tries with whatever passphrase is in the field — empty is fine for plain-text backups.
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

  const score = passphraseScore(passphrase);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start gap-3">
        <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-primary/15 text-primary shrink-0">
          {connected ? <Cloud className="w-5 h-5" /> : <CloudOff className="w-5 h-5" />}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium flex items-center gap-2">
            Google Drive sync
            <span className={cn('fs-chip text-[10px] uppercase', connected ? 'text-success' : 'text-muted-fg')}>
              {connected ? 'connected' : 'session expired'}
            </span>
          </p>
          <p className="text-xs text-muted-fg leading-snug">
            End-to-end encrypted backup. We talk to a hidden app-private folder on your own Drive —
            not visible in Drive UI, no other app can read it.
          </p>
        </div>
      </div>

      {/* Encryption toggle */}
      <div className="flex items-start gap-3 rounded-xl bg-elevated border border-border p-3">
        <span className={cn(
          'inline-flex items-center justify-center w-9 h-9 rounded-lg shrink-0',
          encrypt ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'
        )}>
          {encrypt ? <ShieldCheck className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Encrypt backup with a passphrase</p>
          <p className="text-xs text-muted-fg leading-snug">
            {encrypt
              ? 'Recommended. Even Google can\'t read the file without your passphrase.'
              : 'Off — the backup will upload as plain JSON. Only your Google account password protects it.'}
          </p>
        </div>
        <button
          role="switch"
          aria-checked={encrypt}
          onClick={() => toggleEncrypt(!encrypt)}
          className={cn(
            'shrink-0 w-11 h-6 rounded-full relative transition-colors',
            encrypt ? 'bg-success' : 'bg-muted'
          )}
        >
          <span className={cn(
            'absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all',
            encrypt ? 'left-[22px]' : 'left-0.5'
          )} />
        </button>
      </div>

      {encrypt && (
        <Field label="Encryption passphrase" hint="Used only in this browser session. Never uploaded. We check it against your existing backup to catch typos. Lose it = backup is unreadable.">
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
      )}

      <div className="flex flex-wrap gap-2">
        {!connected && (
          <button className="fs-btn-secondary" onClick={handleReconnect} disabled={busy === 'reconnect'}>
            <LogIn className="w-4 h-4" /> {busy === 'reconnect' ? 'Reconnecting…' : 'Reconnect to Google'}
          </button>
        )}
        <button className="fs-btn-primary" onClick={handlePush} disabled={!!busy}>
          <Cloud className="w-4 h-4" /> {busy === 'push' ? 'Encrypting & uploading…' : busy === 'verify' ? 'Checking passphrase…' : 'Back up now'}
        </button>
        <button className="fs-btn-secondary" onClick={() => setConfirmPull(true)} disabled={!!busy}>
          <RefreshCw className={cn('w-4 h-4', busy === 'pull' && 'animate-spin')} /> Restore from Drive
        </button>
        <button className="fs-btn-ghost" onClick={refreshStatus}>Check status</button>
      </div>

      <div className="text-xs text-muted-fg space-y-0.5 border-t border-border pt-3">
        <div className="flex items-center gap-1.5">
          {encrypt
            ? <><ShieldCheck className="w-3.5 h-3.5 text-success" /> AES-256-GCM · PBKDF2-SHA256 (200k iter) · scope <code>drive.appdata</code> only</>
            : <><ShieldAlert className="w-3.5 h-3.5 text-warning" /> Plain JSON · protected only by your Google account login</>
          }
        </div>
        {status.lastSyncedAt && <div>Last sync from this device: {fmtDateTime(status.lastSyncedAt)}</div>}
        {status.remoteModifiedTime && <div>Drive backup last modified: {fmtDateTime(new Date(status.remoteModifiedTime).getTime())}</div>}
        {status.lastEncrypted === true && <div>Drive backup is currently <span className="text-success">encrypted</span>.</div>}
        {status.lastEncrypted === false && <div>Drive backup is currently <span className="text-warning">plain text</span>.</div>}
        {status.exists === false && <div>No backup file in Drive yet — click "Back up now" to create one.</div>}
      </div>

      <ConfirmDialog
        open={confirmPull}
        onClose={() => setConfirmPull(false)}
        onConfirm={handlePull}
        title="Restore from Drive?"
        message="This will REPLACE all data currently on this device with the backup from Google Drive."
        danger
        confirmText="Replace local data"
      />

      <ConfirmDialog
        open={confirmTurnOff}
        onClose={() => setConfirmTurnOff(false)}
        onConfirm={reallyTurnOff}
        title="Turn off encryption?"
        message="Your next backup will be uploaded as plain JSON. Anyone who can access your Google Drive (including if your Google account is ever compromised) will be able to read your transactions, balances, and account names. This setting only affects the NEXT backup — your current Drive file is unchanged until then."
        danger
        confirmText="Turn off encryption"
      />

      <ConfirmDialog
        open={mismatchOpen}
        onClose={() => setMismatchOpen(false)}
        onConfirm={reallyPush}
        title="Passphrase doesn't match your backup"
        message="This passphrase can't open the backup currently on Drive — most likely a typo. If you're deliberately changing your passphrase you can continue; otherwise cancel and re-enter it. Continuing overwrites the existing backup with this passphrase."
        danger
        confirmText="Use this passphrase anyway"
      />

      <Modal
        open={confirmPassOpen}
        onClose={() => setConfirmPassOpen(false)}
        title="Confirm your passphrase"
        size="sm"
        footer={
          <>
            <button className="fs-btn-ghost" onClick={() => setConfirmPassOpen(false)}>Cancel</button>
            <button
              className="fs-btn-primary"
              onClick={() => {
                if (confirmPass !== passphrase) { error("Passphrases don't match — check for a typo."); return; }
                reallyPush();
              }}
            >
              Confirm &amp; back up
            </button>
          </>
        }
      >
        <p className="text-xs text-muted-fg mb-3">
          This is your first encrypted backup, so there's nothing to check it against yet. Re-enter the
          passphrase to rule out a typo — if you lose it, the backup can't be recovered.
        </p>
        <input
          className="fs-input"
          type="password"
          placeholder="Re-enter passphrase"
          value={confirmPass}
          onChange={(e) => setConfirmPass(e.target.value)}
          autoComplete="new-password"
        />
      </Modal>
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
