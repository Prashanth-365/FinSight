import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { ArrowRight, Briefcase } from 'lucide-react';
import { db } from '@/db/database.js';
import { Card } from '@/components/ui/Card.jsx';
import { EmptyState } from '@/components/ui/Empty.jsx';
import { SectionHeader } from './Profiles.jsx';
import { formatINRShort } from '@/lib/currency.js';

export default function InvestmentsSettings() {
  const investments = useLiveQuery(() => db.investments.toArray(), [], []);

  return (
    <div className="space-y-3 animate-fade-in">
      <SectionHeader title="Investments" subtitle="Holdings live on the Investments page" />
      <Card>
        <div className="p-2">
          {investments.length === 0 ? (
            <EmptyState
              icon={Briefcase}
              title="No holdings yet"
              hint="Add holdings from the Investments tab."
              action={
                <Link to="/investments" className="fs-btn-primary inline-flex">
                  Open Investments <ArrowRight className="w-4 h-4" />
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {investments.map((inv) => (
                <li key={inv.id} className="p-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{inv.name}</p>
                    <p className="text-xs text-muted-fg">
                      {inv.platform}{inv.identifier ? ` · ${inv.identifier}` : ''}
                    </p>
                  </div>
                  <p className="text-sm font-semibold">{formatINRShort(inv.currentValue ?? inv.investedAmount ?? 0)}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
      <p className="text-xs text-muted-fg px-1">
        Tip: for Mutual Funds, set the identifier to your <strong>AMFI scheme code</strong> (e.g., <code>120503</code>) so we can fetch live NAV.
        For Crypto, use a CoinGecko id (<code>bitcoin</code>, <code>ethereum</code>). For Stocks, use Alpha Vantage tickers like <code>RELIANCE.BSE</code>.
      </p>
    </div>
  );
}
