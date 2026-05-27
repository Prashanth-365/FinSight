import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Moon, Sun, Plus, LogOut, ChevronDown, Users, Check } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext.jsx';
import { useAuth } from '@/context/AuthContext.jsx';
import { useProfile } from '@/context/ProfileContext.jsx';
import { Avatar } from '@/components/ui/Avatar.jsx';
import { IconButton } from '@/components/ui/Button.jsx';
import { cn } from '@/lib/utils.js';

export function Header({ onAdd }) {
  const { theme, toggle } = useTheme();
  const { user, logout } = useAuth();
  const { profiles, activeProfileId, activeProfile, setActive } = useProfile();

  return (
    <header className="sticky top-0 z-40 bg-background/85 backdrop-blur border-b border-border safe-top">
      <div className="container max-w-3xl flex items-center justify-between gap-3 py-2.5">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-primary/15 text-primary">₹</span>
          <span className="hidden sm:inline">FinSight</span>
        </Link>

        <ProfileSwitcher
          profiles={profiles}
          activeId={activeProfileId}
          activeProfile={activeProfile}
          onPick={setActive}
        />

        <div className="flex items-center gap-1 shrink-0">
          {onAdd && (
            <IconButton onClick={onAdd} aria-label="Quick add" title="Quick add" className="hidden md:inline-flex">
              <Plus className="w-5 h-5" />
            </IconButton>
          )}
          <IconButton onClick={toggle} aria-label="Toggle theme" title="Toggle theme">
            {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </IconButton>
          {user && (
            <IconButton onClick={logout} aria-label="Sign out" title="Sign out">
              <LogOut className="w-5 h-5" />
            </IconButton>
          )}
        </div>
      </div>
    </header>
  );
}

function ProfileSwitcher({ profiles, activeId, activeProfile, onPick }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    function h(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, []);

  const isAll = activeId == null;
  const display = isAll
    ? { name: 'All profiles', avatar: '👥', color: '#94a3b8', isAll: true }
    : activeProfile;

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center gap-2 rounded-xl border border-border bg-elevated hover:bg-muted px-2.5 py-1.5 transition-colors',
          open && 'bg-muted'
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {display?.isAll
          ? <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-muted text-muted-fg"><Users className="w-4 h-4" /></span>
          : <Avatar size="sm" name={display?.name} avatar={display?.avatar} color={display?.color} />}
        <span className="text-sm font-medium max-w-[120px] truncate">{display?.name ?? '—'}</span>
        <ChevronDown className={cn('w-4 h-4 text-muted-fg transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 mt-1.5 w-60 bg-surface border border-border rounded-xl shadow-card-dark py-1 z-50 animate-fade-in"
        >
          <ProfileRow
            isAll
            active={activeId == null}
            onClick={() => { onPick(null); setOpen(false); }}
          />
          {profiles.length > 0 && <div className="my-1 h-px bg-border" />}
          {profiles.map((p) => (
            <ProfileRow
              key={p.id}
              profile={p}
              active={activeId === p.id}
              onClick={() => { onPick(p.id); setOpen(false); }}
            />
          ))}
          <div className="my-1 h-px bg-border" />
          <Link
            to="/settings/profiles"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-primary hover:bg-muted"
          >
            <Plus className="w-4 h-4" /> Add a profile
          </Link>
        </div>
      )}
    </div>
  );
}

function ProfileRow({ profile, isAll, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-muted text-sm',
        active && 'bg-primary/5'
      )}
    >
      {isAll
        ? <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-muted text-muted-fg shrink-0"><Users className="w-4 h-4" /></span>
        : <Avatar size="sm" name={profile?.name} avatar={profile?.avatar} color={profile?.color} />}
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{isAll ? 'All profiles' : profile?.name}</p>
        {isAll && <p className="text-[11px] text-muted-fg">Show combined data across everyone</p>}
      </div>
      {active && <Check className="w-4 h-4 text-primary shrink-0" />}
    </button>
  );
}
