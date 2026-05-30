import { useCallback, useEffect, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Fingerprint, Lock } from 'lucide-react';
import { getSetting } from '@/db/database.js';
import { isNativeAndroid, biometricAuthenticate } from '@/lib/biometric.js';

// Re-lock after the app has been in the background for at least this long.
const GRACE_MS = 30_000;

/**
 * Wraps the authenticated app. When the biometric lock setting is on (and we're
 * on the native Android build), shows a full-screen lock until the user passes
 * the fingerprint/face prompt. Re-locks when the app returns from background.
 */
export function LockGate({ children }) {
  const [enabled, setEnabled] = useState(null); // null = still loading the setting
  const [locked, setLocked] = useState(false);
  const [authing, setAuthing] = useState(false);

  useEffect(() => {
    (async () => {
      const on = (await getSetting('security.biometricLock', false)) === true;
      const active = on && isNativeAndroid();
      setEnabled(active);
      setLocked(active);
    })();
  }, []);

  const unlock = useCallback(async () => {
    if (authing) return;
    setAuthing(true);
    const ok = await biometricAuthenticate({ title: 'Unlock FinSight' });
    setAuthing(false);
    if (ok) setLocked(false);
  }, [authing]);

  // Auto-prompt as soon as we become locked.
  useEffect(() => {
    if (enabled && locked) unlock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, locked]);

  // Re-lock on resume (after a grace period to avoid nagging on quick app-switches).
  useEffect(() => {
    if (!enabled) return;
    let backgroundedAt = 0;
    let handle;
    (async () => {
      handle = await CapApp.addListener('appStateChange', ({ isActive }) => {
        if (!isActive) backgroundedAt = Date.now();
        else if (backgroundedAt && Date.now() - backgroundedAt > GRACE_MS) setLocked(true);
      });
    })();
    return () => { handle?.remove?.(); };
  }, [enabled]);

  if (enabled === null) return null;            // brief: setting still loading
  if (!enabled || !locked) return children;     // unlocked / lock disabled

  return (
    <div className="fixed inset-0 z-[200] bg-background flex flex-col items-center justify-center px-6 text-center safe-top safe-bottom">
      <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-primary/15 text-primary mb-5">
        <Lock className="w-9 h-9" />
      </div>
      <h1 className="text-lg font-semibold mb-1">FinSight is locked</h1>
      <p className="text-sm text-muted-fg max-w-xs mb-6">
        Unlock with your fingerprint or face to view your finances.
      </p>
      <button onClick={unlock} disabled={authing} className="fs-btn-primary">
        <Fingerprint className="w-5 h-5" />
        {authing ? 'Waiting…' : 'Unlock'}
      </button>
    </div>
  );
}
