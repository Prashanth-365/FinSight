import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext.jsx';
import { loginMaster, registerMaster } from '@/lib/auth.js';
import { useToast } from '@/components/ui/Toast.jsx';
import { useTheme } from '@/context/ThemeContext.jsx';
import { Field } from '@/components/ui/Input.jsx';
import { Moon, Sun } from 'lucide-react';

export function AuthLanding({ mode: defaultMode = 'login' }) {
  const { theme, toggle } = useTheme();
  const { user, hasMaster, refresh } = useAuth();
  const { success, error } = useToast();
  const navigate = useNavigate();

  const [mode, setMode] = useState(hasMaster ? 'login' : 'register');
  useEffect(() => { setMode(hasMaster ? 'login' : 'register'); }, [hasMaster]);
  useEffect(() => { if (user) navigate('/', { replace: true }); }, [user, navigate]);

  const [form, setForm] = useState({ username: '', email: '', password: '', identifier: '' });
  const [busy, setBusy] = useState(false);

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
      await refresh();
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
            {mode === 'register' ? 'Create your master account' : 'Welcome back'}
          </h1>
          <p className="text-sm text-muted-fg mb-5">
            {mode === 'register'
              ? 'Your data lives only on this device — no servers, no tracking.'
              : 'Sign in to your local finance vault.'}
          </p>

          <form onSubmit={submit}>
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
            <button type="submit" className="fs-btn-primary w-full mt-2" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'}
            </button>
          </form>

          <div className="mt-4 text-center text-sm text-muted-fg">
            {mode === 'register' ? (
              hasMaster && (
                <>
                  Already have an account?{' '}
                  <button className="text-primary font-medium" onClick={() => setMode('login')}>Sign in</button>
                </>
              )
            ) : (
              !hasMaster && (
                <>
                  New here?{' '}
                  <button className="text-primary font-medium" onClick={() => setMode('register')}>Create master account</button>
                </>
              )
            )}
          </div>
        </div>
      </main>

      <footer className="container max-w-3xl text-center text-xs text-muted-fg py-4 safe-bottom">
        Your data never leaves this device unless you export it.
      </footer>
    </div>
  );
}
