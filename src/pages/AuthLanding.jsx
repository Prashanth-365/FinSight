import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Moon, Sun, ShieldCheck, ChevronDown, ChevronUp } from 'lucide-react';
import { useAuth } from '@/context/AuthContext.jsx';
import { loginMaster, registerMaster, signInWithGoogle as localSignInWithGoogle } from '@/lib/auth.js';
import { signInWithGoogle, getEffectiveClientId, envHasClientId } from '@/lib/googleAuth.js';
import { setSetting } from '@/db/database.js';
import { useToast } from '@/components/ui/Toast.jsx';
import { useTheme } from '@/context/ThemeContext.jsx';
import { Field } from '@/components/ui/Input.jsx';
import { Modal } from '@/components/ui/Modal.jsx';

export function AuthLanding() {
  const { theme, toggle } = useTheme();
  const { user, hasMaster, refresh } = useAuth();
  const { success, error, info } = useToast();
  const navigate = useNavigate();

  const [clientId, setClientId] = useState('');
  const [resolved, setResolved] = useState(false);
  const [showLocal, setShowLocal] = useState(false); // auto-set after hasMaster resolves
  const [busy, setBusy] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);

  // Resolve effective Client ID (env var > stored setting)
  useEffect(() => {
    (async () => {
      const v = await getEffectiveClientId();
      setClientId(v);
      setResolved(true);
    })();
  }, []);

  // Auto-show the local form if a local master account already exists on this device.
  useEffect(() => { setShowLocal(hasMaster); }, [hasMaster]);

  // If already signed in, bounce home.
  useEffect(() => { if (user) navigate('/', { replace: true }); }, [user, navigate]);

  const handleGoogle = async () => {
    if (!clientId) { setSetupOpen(true); return; }
    setBusy(true);
    try {
      const profile = await signInWithGoogle(clientId);
      const { isNew } = await localSignInWithGoogle(profile);
      await refresh();
      success(isNew
        ? `Welcome, ${profile.givenName ?? ''}! 🎉`
        : `Welcome back, ${profile.givenName ?? ''}`);
      if (isNew) info('Settings → Data → enter passphrase → Restore from Drive to bring your data back.');
      navigate('/', { replace: true });
    } catch (e) {
      error(e.message);
    } finally {
      setBusy(false);
    }
  };

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
          <h1 className="text-xl font-semibold mb-1">
            {hasMaster ? 'Welcome back to FinSight' : 'Sign in to FinSight'}
          </h1>
          <p className="text-sm text-muted-fg mb-5">
            {hasMaster
              ? 'Sign in with Google to sync your data, or use your local account.'
              : 'One tap to sign in and unlock encrypted Google Drive backup. Your data stays private to your Drive — nothing else.'}
          </p>

          {resolved && (
            <>
              <GoogleButton onClick={handleGoogle} busy={busy} disabled={!clientId && !envHasClientId()} />
              <p className="mt-2 text-[11px] text-muted-fg text-center inline-flex items-center justify-center gap-1 w-full">
                <ShieldCheck className="w-3 h-3 text-success" /> Sign-in and Drive backup in one consent. We only ever access an app-private folder.
              </p>

              {!clientId && !envHasClientId() && (
                <button
                  onClick={() => setSetupOpen(true)}
                  className="mt-3 text-xs text-primary font-medium w-full text-center hover:underline"
                >
                  First-time setup → paste Google Client ID
                </button>
              )}
            </>
          )}

          <div className="my-5 flex items-center gap-3">
            <span className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-fg">or</span>
            <span className="flex-1 h-px bg-border" />
          </div>

          {!showLocal ? (
            <button
              onClick={() => setShowLocal(true)}
              className="fs-btn-ghost w-full text-sm"
            >
              <ChevronDown className="w-4 h-4" />
              {hasMaster ? 'Sign in with username & password' : 'Create a local-only account'}
            </button>
          ) : (
            <>
              <LocalAuthBlock
                hasMaster={hasMaster}
                onAuthed={async () => { await refresh(); navigate('/', { replace: true }); }}
              />
              <button
                onClick={() => setShowLocal(false)}
                className="mt-2 fs-btn-ghost w-full text-xs text-muted-fg"
              >
                <ChevronUp className="w-4 h-4" /> Hide
              </button>
            </>
          )}

          {clientId && (
            <button
              onClick={() => setSetupOpen(true)}
              className="mt-4 text-[11px] text-muted-fg w-full text-center hover:text-foreground"
            >
              Change Google Client ID
            </button>
          )}
        </div>
      </main>

      <footer className="container max-w-3xl text-center text-xs text-muted-fg py-4 safe-bottom">
        Your data never leaves this device unless you back it up.
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

function GoogleButton({ onClick, busy, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={busy || disabled}
      className="w-full flex items-center justify-center gap-3 rounded-xl border border-border bg-white text-[#1f1f1f] hover:bg-[#f6f8fc] active:scale-[0.99] transition px-5 py-3 font-medium disabled:opacity-60 disabled:cursor-not-allowed"
      style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.06)' }}
    >
      <GoogleLogo />
      <span>{busy ? 'Signing in…' : 'Continue with Google'}</span>
    </button>
  );
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.49h4.84a4.14 4.14 0 01-1.8 2.71v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 009 18z"/>
      <path fill="#FBBC05" d="M3.97 10.72A5.41 5.41 0 013.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 000 9c0 1.45.35 2.83.96 4.05l3.01-2.33z"/>
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.43 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 00.96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/>
    </svg>
  );
}

function LocalAuthBlock({ hasMaster, onAuthed }) {
  const { success, error } = useToast();
  // Default mode: login if a local account already exists on this device, else register
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
    <form onSubmit={submit} className="animate-fade-in">
      {mode === 'register' ? (
        <>
          <Field label="Username">
            <input className="fs-input" placeholder="e.g. arjun" value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="username" />
          </Field>
          <Field label="Email">
            <input className="fs-input" type="email" placeholder="you@email.com" value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" />
          </Field>
        </>
      ) : (
        <Field label="Username or email">
          <input className="fs-input" placeholder="username or email" value={form.identifier}
            onChange={(e) => setForm({ ...form, identifier: e.target.value })} autoComplete="username" />
        </Field>
      )}
      <Field label="Password">
        <input className="fs-input" type="password" placeholder="At least 6 characters" value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'} />
      </Field>
      <button type="submit" className="fs-btn-primary w-full mt-1" disabled={busy}>
        {busy ? 'Please wait…' : mode === 'register' ? 'Create local account' : 'Sign in'}
      </button>
      {hasMaster && (
        <button
          type="button"
          className="mt-2 text-xs text-muted-fg w-full text-center hover:text-foreground"
          onClick={() => setMode((m) => (m === 'register' ? 'login' : 'register'))}
        >
          {mode === 'login' ? 'Need a new local account instead?' : 'Have an account already? Sign in'}
        </button>
      )}
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
        Paste the OAuth Client ID from your Google Cloud project. One Client ID powers both
        Google sign-in and the encrypted Drive backup — granted in a single consent prompt.
      </p>
      <div className="rounded-xl bg-primary/10 border border-primary/30 p-3 mb-3 text-xs">
        <p className="font-semibold mb-1">💡 Skip this screen for everyone</p>
        <p>
          If <em>you</em> own this deployment, set the <code>VITE_GOOGLE_CLIENT_ID</code> environment
          variable in Vercel — visitors will see the Google button immediately with no setup. See README.
        </p>
      </div>
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
          <li>Open <a className="text-primary underline" target="_blank" rel="noopener" href="https://console.cloud.google.com/projectcreate">Google Cloud Console</a> and create a project.</li>
          <li>Enable the <a className="text-primary underline" target="_blank" rel="noopener" href="https://console.cloud.google.com/apis/library/drive.googleapis.com">Drive API</a>.</li>
          <li>Open <strong>OAuth consent screen</strong> → External → fill basics → add yourself as a Test user.</li>
          <li>Open <strong>Credentials → + Create credentials → OAuth client ID → Web application</strong>. Add <code>{location.origin}</code> to <em>Authorised JavaScript origins</em>.</li>
          <li>Copy the Client ID and paste it above.</li>
        </ol>
      </details>
    </Modal>
  );
}
