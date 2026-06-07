import { createContext, useContext, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { App as CapApp } from '@capacitor/app';
import { useToast } from '@/components/ui/Toast.jsx';
import { isNativeAndroid } from '@/lib/smsNative.js';

// Hierarchical back navigation for the Android hardware back button.
//   1) If an overlay (modal/sheet/in-page view) is open → close the top-most one.
//   2) Otherwise go UP one level (sub-page → section → Home), not back through history.
//   3) At Home with nothing open → "press back again to exit".
// Web keeps the browser's native back button; this only drives the native back key.

const NavCtx = createContext(null);

function logicalParent(pathname) {
  if (pathname === '/' || pathname === '/login' || pathname === '/register') return null; // → exit
  if (pathname.startsWith('/settings/')) return '/settings';
  return '/'; // any top-level tab → Home
}

export function NavProvider({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { info } = useToast();

  const handlers = useRef([]);   // LIFO stack of { id, fn }
  const idSeq = useRef(0);
  const exitArmed = useRef(false);

  const pushHandler = useCallback((fn) => {
    const id = ++idSeq.current;
    handlers.current.push({ id, fn });
    return id;
  }, []);
  const removeHandler = useCallback((id) => {
    handlers.current = handlers.current.filter((h) => h.id !== id);
  }, []);

  // Kept in a ref so the once-registered native listener always sees fresh state.
  const back = useRef(() => {});
  back.current = () => {
    const stack = handlers.current;
    if (stack.length) { stack[stack.length - 1].fn(); return; }   // close top overlay
    const parent = logicalParent(location.pathname);
    if (parent) { navigate(parent); return; }                     // go up one level
    if (exitArmed.current) { CapApp.exitApp?.(); return; }        // exit on 2nd press
    exitArmed.current = true;
    info('Press back again to exit');
    setTimeout(() => { exitArmed.current = false; }, 2000);
  };

  useEffect(() => {
    if (!isNativeAndroid()) return undefined;
    let handle;
    (async () => { handle = await CapApp.addListener('backButton', () => back.current()); })();
    return () => { handle?.remove?.(); };
  }, []);

  return <NavCtx.Provider value={{ pushHandler, removeHandler }}>{children}</NavCtx.Provider>;
}

export function useNav() {
  return useContext(NavCtx) ?? { pushHandler: () => 0, removeHandler: () => {} };
}

/**
 * Register a back action while `active` is true. The most-recently-registered
 * active handler fires first (LIFO), so a modal opened over a view closes before
 * the view behind it. The handler should dismiss whatever it owns.
 */
export function useBackHandler(active, handler) {
  const { pushHandler, removeHandler } = useNav();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return undefined;
    const id = pushHandler(() => ref.current?.());
    return () => removeHandler(id);
  }, [active, pushHandler, removeHandler]);
}
