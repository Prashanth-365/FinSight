import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Moon, Sun, ShieldCheck, ChevronDown, ChevronUp, Info } from 'lucide-react';
import { useAuth } from '@/context/AuthContext.jsx';
import { loginMaster, registerMaster, signInWithGoogle } from '@/lib/auth.js';
import { renderSignInButton } from '@/lib/googleAuth.js';
import { getSetting, setSetting } from '@/db/database.js';
import { useToast } from '@/components/ui/Toast.jsx';
import { useTheme } from '@/context/ThemeContext.jsx';
import { Field } from '@/components/ui/Input.jsx';
import { Modal } from '@/components/ui/Modal.jsx';

export function AuthLanding({ mode: _ignored }) {
  const { theme, toggle } = useTheme();
  const { user, hasMaster, refresh } = useAuth();
  const { success, error, info } = useToast();
  const navigate = useNavigate();

  const [clientId, setClientId] = useState('');
  const [clientIdLoaded, setClientIdLoaded] = useState(false);
  const [showLocal, setShowLocal] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const btnHostRef = useRef(null);

  // Load Client ID once
  useEffect(() => {
    (async () => {
      const v = (await getSetting('drive.clientId', '')) ?? '';
      setClientId(v);
      setClientIdLoaded(true);
    })();
  }, []);

  // Redirect if already authed
  useEffect(() => { if (user) navigate('/', { replace: true }); }, [user, navigate]);

  // Render the Google button when ready
  useEffect(() => {
    if (!clientIdLoaded || !clientId || !btnHostRef.current) return;
    renderSignInButton(
      btnHostRef.current,
      clientId,
      async (creds) => {
        try {
          const { isNew } = await signInWithGoogle(creds);
          await refresh();
          success(isNew ? `Welcome to FinSight, ${creds.givenName ?? ''}!` : 'Welcome back!');
          if (isNew) info('Tip: head to Settings → Data to restore your backup from Drive.');
          navigate('/', { replace: true });
        } catch (e) {
          error(e.message);
        }
      },
      (e) => error(e.message)
    ).catch((e) => error(e.message));
  }, [clientIdLoaded, clientId, theme]); // eslint-disable-line

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-background to-elevated">
      <header className="container max-w-3xl flex justify-between items-center py-4 safe-top">
        <div className="flex items-center gap-2 font-semibold">
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-primary/15 text-primary text-lg">₹</span>
          FinSight
        </div>
        <button
          onClick={toggle}
          className="inline-flex items-center justify-center w-10 h-10 rounded-xl hover:bg-muted"
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-6">
        <div className="w-full max-w-md fs-card p-6">
          <h1 className="text-xl font-semibold mb-1">Sign in to FinSight</h1>
          <p className="text-sm text-muted-fg mb-5">
            Use the same Google account on every device. Your data stays encrypted and on your own Drive.
          </p>

          {clientId ? (
            <>
              <div ref={btnHostRef} className="flex justify-center min-h-[44px]" />
              <p className="text-[11px] text-muted-fg text-center mt-2 inline-flex items-center justify-center gap-1 w-full">
                <ShieldCheck className="w-3 h-3 text-success" /> We use Google to verify it's you — nothing else.
              </p>
            </>
          ) : (
            <button
              onClick={() => setSetupOpen(true)}
              className="fs-btn-primary w-full"
            >
              Set up Google Sign-In
            </button>
          )}

          <div className="my-5 flex items-center gap-3">
            <span className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-fg">or</span>
            <span className="flex-1 h-px bg-border" />
          </div>

          <button
            onClick={() => setShowLocal((v) => !v)}
            className="fs-btn-ghost w-full text-sm"
          >
            {showLocal ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            Use a local-only account
          </button>

          {showLocal && (
            <LocalAuthBlock
              hasMaster={hasMaster}
              onAuthed={async () => { await refresh(); navigate('/', { replace: true }); }}
            />
          )}

          {clientId && (
            <button
              onClick={() => setSetupOpen(true)}
              className="mt-4 text-xs text-muted-fg flex items-center gap-1 hover:text-foreground mx-auto"
            >
              <Info className="w-3 h-3" /> Change Google Client ID
            </button>
          )}
        </div>
      </main>

      <footer className="container max-w-3xl text-center text-xs text-muted-fg py-4 safe-bottom">
        Your data never leaves this device unless you choose to back it up.
      </footer>

      <ClientIdSetupModal
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        clientId={clientId}
        onSave={async (v) => {
          await setSetting('drive.clientId', v.trim());
          setClientId(v.trim());
          success('Client ID saved');
          setSetupOpen(false);
        }}
      />
    </div>
  );
}

function LocalAuthBlock({ hasMaster, onAuthed }) {
  const { success, error } = useToast();
  const [mode, setMode] = useState(hasMaster ? 'login' : 'register');
  const [form, setForm] = useState({ username: '', email: '', password: '', identifier: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => { setMode(hasMaster ? 'login' : 'register'); }, [hasMaster]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === 'register') {
        await registerMaster(form);
        success('Welcome to FinSight!');
      } else {
        await loginMaster({ identifier: form.identifier, password: form.password });
        success('Welcome back!');
      }
      await onAuthed?.();
    } catch (e) {
      error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-3 animate-fade-in">
      {mode === 'register' ? (
        <>
          <Field label="Username">
            <input
              className="fs-input"
              placeholder="e.g. arjun"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          </Field>
          <Field label="Email">
            <input
              className="fs-input"
              type="email"
              placeholder="you@email.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
        </>
      ) : (
        <Field label="Username or email">
          <input
            className="fs-input"
            placeholder="username or email"
            value={form.identifier}
            onChange={(e) => setForm({ ...form, identifier: e.target.value })}
          />
        </Field>
      )}
      <Field label="Password">
        <input
          className="fs-input"
          type="password"
          placeholder="At least 6 characters"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
      </Field>
      <button type="submit" className="fs-btn-primary w-full mt-1" disabled={busy}>
        {busy ? 'Please wait…' : mode === 'register' ? 'Create local account' : 'Sign in'}
      </button>
      <button
        type="button"
        className="mt-2 text-xs text-muted-fg w-full text-center hover:text-foreground"
        onClick={() => setMode((m) => (m === 'register' ? 'login' : 'register'))}
      >
        {mode === 'register'
          ? (hasMaster ? 'Already have a local account? Sign in' : '')
          : 'Create a new local account'}
      </button>
    </form>
  );
}

function ClientIdSetupModal({ open, onClose, clientId, onSave }) {
  const [v, setV] = useState('');
  useEffect(() => { if (open) setV(clientId ?? ''); }, [open, clientId]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Google Sign-In setup"
      size="lg"
      footer={
        <>
          <button className="fs-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="fs-btn-primary" onClick={() => v.trim() && onSave(v)}>Save</button>
        </>
      }
    >
      <p className="text-sm text-muted-fg mb-3">
        Paste the OAuth Client ID from your Google Cloud project. The same Client ID powers both
        Google sign-in and the encrypted Drive backup — no extra setup needed.
      </p>
      <Field label="Google OAuth Client ID">
        <input
          className="fs-input font-mono text-xs"
          placeholder="123456-abc.apps.googleusercontent.com"
          value={v}
          onChange={(e) => setV(e.target.value)}
          spellCheck={false}
        />
      </Field>
      <details className="text-xs text-muted-fg">
        <summary className="cursor-pointer">I don't have a Client ID yet</summary>
        <ol className="list-decimal pl-5 mt-2 space-y-1.5">
          <li>Open <a className="text-primary underline" target="_blank" rel="noopener" href="https://console.cloud.google.com/projectcreate">Google Cloud Console</a> and create a project (any name).</li>
          <li>Enable the <a className="text-primary underline" target="_blank" rel="noopener" href="https://console.cloud.google.com/apis/library/drive.googleapis.com">Drive API</a> for that project.</li>
          <li>Open <strong>APIs &amp; Services → OAuth consent screen</strong>. Pick <em>External</em>, fill in app name + your email, add yourself as a Test user.</li>
          <li>Open <strong>Credentials → + Create credentials → OAuth client ID → Web application</strong>. Add <code>{location.origin}</code> to <em>Authorised JavaScript origins</em>.</li>
          <li>Copy the Client ID and paste it above.</li>
        </ol>
      </details>
    </Modal>
  );
}
