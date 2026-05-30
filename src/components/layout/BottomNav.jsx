import { NavLink } from 'react-router-dom';
import { Home, ListOrdered, TrendingUp, Inbox, FileText, Settings } from 'lucide-react';
import { cn } from '@/lib/utils.js';

const items = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/transactions', label: 'Txns', icon: ListOrdered },
  { to: '/investments', label: 'Invest', icon: TrendingUp },
  { to: '/sms', label: 'SMS', icon: Inbox },
  { to: '/statements', label: 'Stmt', icon: FileText },
  { to: '/settings', label: 'Settings', icon: Settings }
];

export function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-background/95 backdrop-blur safe-bottom">
      <div className="container max-w-3xl grid grid-cols-6">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'py-2 flex flex-col items-center gap-0.5 text-[11px] transition-colors',
                isActive ? 'text-primary' : 'text-muted-fg hover:text-foreground'
              )
            }
          >
            <Icon className="w-5 h-5" />
            <span>{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
