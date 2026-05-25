import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSetting, setSetting } from '@/db/database.js';
import { Card } from '@/components/ui/Card.jsx';
import { Field } from '@/components/ui/Input.jsx';
import { Select } from '@/components/ui/Select.jsx';
import { SectionHeader } from './Profiles.jsx';
import { useTheme } from '@/context/ThemeContext.jsx';
import { useToast } from '@/components/ui/Toast.jsx';

export default function Preferences() {
  const profiles = useLiveQuery(() => db.profiles.toArray(), [], []);
  const { theme, setTheme } = useTheme();
  const { success } = useToast();

  const [defaultProfile, setDefaultProfile] = useState('');
  const [recentCount, setRecentCount] = useState(10);
  const [alphaKey, setAlphaKey] = useState('');

  useEffect(() => {
    (async () => {
      setDefaultProfile((await getSetting('profile.active', '')) ?? '');
      setRecentCount(await getSetting('home.recentCount', 10));
      setAlphaKey(await getSetting('alphavantage.key', ''));
    })();
  }, []);

  const save = async () => {
    await setSetting('profile.active', defaultProfile === '' ? null : Number(defaultProfile));
    await setSetting('home.recentCount', Number(recentCount));
    await setSetting('alphavantage.key', alphaKey);
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
        <Field label="Alpha Vantage API key" hint="Optional, used to fetch live stock prices">
          <input className="fs-input" value={alphaKey} onChange={(e) => setAlphaKey(e.target.value)} placeholder="leave blank to skip live stocks" />
        </Field>
        <button className="fs-btn-primary" onClick={save}>Save preferences</button>
      </Card>
    </div>
  );
}
