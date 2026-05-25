import { Link } from 'react-router-dom';
import { Moon, Sun, Plus, LogOut } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext.jsx';
import { useAuth } from '@/context/AuthContext.jsx';
import { useProfile } from '@/context/ProfileContext.jsx';
import { Avatar } from '@/components/ui/Avatar.jsx';
import { IconButton } from '@/components/ui/Button.jsx';

export function Header({ onAdd }) {
  const { theme, toggle } = useTheme();
  const { user, logout } = useAuth();
  const { profiles, activeProfileId, setActive } = useProfile();

  return (
    <header className="sticky top-0 z-40 bg-background/85 backdrop-blur border-b border-border safe-top">
      <div className="container max-w-3xl flex items-center justify-between gap-3 py-2.5">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-primary/15 text-primary">₹</span>
          <span className="hidden sm:inline">FinSight</span>
        </Link>

        <div className="flex items-center gap-1 overflow-x-auto hide-scrollbar py-1">
          <ProfileSwitcher
            profiles={profiles}
            activeId={activeProfileId}
            onPick={setActive}
          />
        </div>

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

function ProfileSwitcher({ profiles, activeId, onPick }) {
  const items = [{ id: null, name: 'Master', avatar: '👑', color: '#22d3ee' }, ...profiles];
  return (
    <div className="flex items-center gap-1 px-1">
      {items.map((p) => {
        const active = activeId === p.id;
        return (
          <button
            key={String(p.id)}
            onClick={() => onPick(p.id)}
            className="group relative"
            title={p.name}
            aria-label={`Switch to ${p.name}`}
          >
            <Avatar name={p.name} avatar={p.avatar} color={p.color} ring={active} size="sm" />
          </button>
        );
      })}
    </div>
  );
}
