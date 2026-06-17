import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Fingerprint } from 'lucide-react';
import { db, getSetting, setSetting } from '@/db/database.js';
import { Card } from '@/components/ui/Card.jsx';
import { Field } from '@/components/ui/Input.jsx';
import { Select } from '@/components/ui/Select.jsx';
import { SectionHeader } from './Profiles.jsx';
import { useTheme } from '@/context/ThemeContext.jsx';
import { useToast } from '@/components/ui/Toast.jsx';
import { cn } from '@/lib/utils.js';
import { biometricAvailable, biometricAuthenticate, isNativeAndroid } from '@/lib/biometric.js';

export default function Preferences() {
  const profiles = useLiveQuery(() => db.profiles.toArray(), [], []);
  const { theme, setTheme } = useTheme();
  const { success } = useToast();

  const [defaultProfile, setDefaultProfile] = useState('');
  const [recentCount, setRecentCount] = useState(10);

  useEffect(() => {
    (async () => {
      setDefaultProfile((await getSetting('profile.active', '')) ?? '');
      setRecentCount(await getSetting('home.recentCount', 10));
    })();
  }, []);

  const save = async () => {
    await setSetting('profile.active', defaultProfile === '' ? null : Number(defaultProfile));
    await setSetting('home.recentCount', Number(recentCount));
    success('Preferences saved');
  };

  return (
    <div className="space-y-3 animate-fade-in">
      <SectionHeader title="Preferences" />
      <Card className="p-4 space-y-3">
        <Field label="Theme">
          <Select value={theme} onChange={setTheme}
            options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]} />
        </Field>
        <Field label="Default profile on launch">
          <Select value={defaultProfile ?? ''} onChange={setDefaultProfile}
            options={[{ value: '', label: 'Master (all data)' }, ...profiles.map((p) => ({ value: p.id, label: p.name }))]} />
        </Field>
        <Field label="Recent transactions on Home">
          <Select value={recentCount} onChange={setRecentCount}
            options={[5, 10, 20, 50].map((n) => ({ value: n, label: `${n} transactions` }))} />
        </Field>
        <button className="fs-btn-primary" onClick={save}>Save preferences</button>
      </Card>

      <SectionHeader title="Security" back={null} />
      <BiometricToggle />
    </div>
  );
}

function BiometricToggle() {
  const { success, error, info } = useToast();
  const [enabled, setEnabled] = useState(false);
  const [avail, setAvail] = useState({ available: false, reason: 'loading' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      setEnabled((await getSetting('security.biometricLock', false)) === true);
      setAvail(await biometricAvailable());
    })();
  }, []);

  const toggle = async (next) => {
    if (busy) return;
    setBusy(true);
    try {
      // Require a successful biometric check to either enable OR disable, so the
      // lock can't be turned off by someone who can't pass it.
      const ok = await biometricAuthenticate({
        title: next ? 'Enable app lock' : 'Disable app lock'
      });
      if (!ok) { error('Biometric check failed — setting unchanged.'); return; }
      await setSetting('security.biometricLock', next);
      setEnabled(next);
      success(next ? 'App lock enabled' : 'App lock disabled');
    } finally {
      setBusy(false);
    }
  };

  const reasonText = {
    'not-native': 'Available only in the FinSight Android app.',
    'none-enrolled': 'No fingerprint/face is set up on this device yet — add one in Android Settings.',
    'no-hardware': 'This device has no biometric hardware.',
    'hardware-unavailable': 'Biometric hardware is currently unavailable.',
    loading: 'Checking…'
  };

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-primary/15 text-primary shrink-0">
          <Fingerprint className="w-5 h-5" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Unlock with fingerprint / face</p>
          <p className="text-xs text-muted-fg">
            {avail.available
              ? 'Require biometric authentication every time you open FinSight.'
              : (reasonText[avail.reason] ?? 'Biometric lock is unavailable on this device.')}
          </p>
        </div>
        <button
          role="switch"
          aria-checked={enabled}
          disabled={!avail.available || busy}
          onClick={() => toggle(!enabled)}
          className={cn(
            'shrink-0 w-11 h-6 rounded-full relative transition-colors disabled:opacity-40',
            enabled ? 'bg-primary' : 'bg-muted'
          )}
        >
          <span className={cn('absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all', enabled ? 'left-[22px]' : 'left-0.5')} />
        </button>
      </div>
      {!isNativeAndroid() && (
        <p className="text-[11px] text-muted-fg mt-3 border-t border-border pt-3">
          Install the Android APK to use fingerprint lock. On the web, your data is already protected by your device login and Google sign-in.
        </p>
      )}
    </Card>
  );
}
