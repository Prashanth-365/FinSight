import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { getCurrentUser, logout as doLogout, masterAccountExists } from '@/lib/auth.js';
import { signOutGoogle } from '@/lib/googleAuth.js';
import { seedIfEmpty } from '@/db/seed.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hasMaster, setHasMaster] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await seedIfEmpty();
      const [u, exists] = await Promise.all([getCurrentUser(), masterAccountExists()]);
      setUser(u);
      setHasMaster(exists);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const logout = async () => {
    await doLogout();
    await signOutGoogle();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, setUser, hasMaster, setHasMaster, loading, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
