import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Header } from './Header.jsx';
import { BottomNav } from './BottomNav.jsx';
import { LockGate } from './LockGate.jsx';
import { TransactionSheet } from '@/components/transaction/TransactionSheet.jsx';

export function AppShell() {
  const [adding, setAdding] = useState(false);
  return (
    <LockGate>
    <div className="min-h-screen pb-16">
      <Header onAdd={() => setAdding(true)} />

      <main className="container max-w-3xl py-4">
        <Outlet context={{ openAdd: () => setAdding(true) }} />
      </main>

      <button
        onClick={() => setAdding(true)}
        className="md:hidden fixed bottom-20 right-4 z-30 w-14 h-14 rounded-full bg-primary text-primary-fg shadow-card-dark
                   flex items-center justify-center active:scale-95 transition-transform"
        aria-label="Add transaction"
      >
        <Plus className="w-6 h-6" />
      </button>

      <BottomNav />

      <TransactionSheet open={adding} onClose={() => setAdding(false)} />
    </div>
    </LockGate>
  );
}
