import { Outlet, NavLink } from 'react-router-dom';
import { Users, Wallet, Tag, Briefcase, Sliders, Database, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils.js';

const sections = [
  { to: 'profiles', label: 'Profiles', desc: 'Family members & avatars', icon: Users },
  { to: 'accounts', label: 'Accounts', desc: 'Banks, cards, wallets & SMS aliases', icon: Wallet },
  { to: 'categories', label: 'Categories', desc: 'Tree of expense & income tags', icon: Tag },
  { to: 'investments', label: 'Investments', desc: 'Map MF schemes, edit holdings', icon: Briefcase },
  { to: 'preferences', label: 'Preferences', desc: 'Theme, defaults, recent count', icon: Sliders },
  { to: 'data', label: 'Data', desc: 'Export, import, Google Drive sync', icon: Database }
];

export default function Settings() {
  return (
    <div className="space-y-3 animate-fade-in">
      <ul className="grid gap-2">
        {sections.map(({ to, label, desc, icon: Icon }) => (
          <li key={to}>
            <NavLink
              to={to}
              className={({ isActive }) =>
                cn(
                  'fs-card p-4 flex items-center gap-3 hover:border-primary/60 transition-colors',
                  isActive && 'border-primary/60'
                )
              }
            >
              <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-primary/15 text-primary">
                <Icon className="w-5 h-5" />
              </span>
              <div className="flex-1">
                <p className="font-medium text-sm">{label}</p>
                <p className="text-xs text-muted-fg">{desc}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-fg" />
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SettingsLayout() {
  return <Outlet />;
}
