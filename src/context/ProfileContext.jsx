import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSetting, setSetting } from '@/db/database.js';
import { useAuth } from './AuthContext.jsx';

const ProfileContext = createContext(null);

// activeProfileId === null  => "master view" = all profiles
// otherwise restrict reads to that profile id.

export function ProfileProvider({ children }) {
  const { user } = useAuth();
  const profiles = useLiveQuery(() => db.profiles.orderBy('createdAt').toArray(), [], []);
  const [activeProfileId, setActiveProfileId] = useState(null); // null = master/all
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const stored = await getSetting('profile.active', null);
      setActiveProfileId(stored);
      setHydrated(true);
    })();
  }, [user]);

  const setActive = useCallback(async (id) => {
    setActiveProfileId(id);
    await setSetting('profile.active', id);
  }, []);

  const isMasterView = activeProfileId == null;

  const activeProfile = isMasterView
    ? { id: null, name: 'Master', avatar: '👑', color: '#22d3ee', isMaster: true }
    : profiles?.find((p) => p.id === activeProfileId) ?? null;

  return (
    <ProfileContext.Provider
      value={{
        profiles: profiles ?? [],
        activeProfileId,
        activeProfile,
        isMasterView,
        setActive,
        hydrated
      }}
    >
      {children}
    </ProfileContext.Provider>
  );
}

export const useProfile = () => useContext(ProfileContext);
