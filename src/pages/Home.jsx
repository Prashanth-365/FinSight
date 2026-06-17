import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Eye, EyeOff, Wallet, CreditCard, Landmark, PlusCircle } from 'lucide-react';
import { db, getSetting, setSetting } from '@/db/database.js';
import { useProfile } from '@/context/ProfileContext.jsx';
import { Card, CardBody } from '@/components/ui/Card.jsx';
import { EmptyState } from '@/components/ui/Empty.jsx';
import { Avatar } from '@/components/ui/Avatar.jsx';
import { formatINR, formatINRShort } from '@/lib/currency.js';
import { fmtDate, maskNumber, cn, getAccountBalance } from '@/lib/utils.js';
import { useOutletContext, Link } from 'react-router-dom';

const ACCOUNT_ICONS = { bank: Landmark, card: CreditCard, wallet: Wallet };

export default function Home() {
  const { openAdd } = useOutletContext() ?? {};
  const { activeProfileId, isMasterView, activeProfile, profiles } = useProfile();
  const [show, setShow] = useState(false);
  const [recentCount, setRecentCount] = useState(10);

  const accounts = useLiveQuery(() => db.accounts.toArray(), [], []);
  const investments = useLiveQuery(() => db.investments.toArray(), [], []);
  const txns = useLiveQuery(() => db.transactions.orderBy('dateTime').reverse().toArray(), [], []);
  const categories = useLiveQuery(() => db.categories.toArray(), [], []);

  useEffect(() => {
    getSetting('home.recentCount', 10).then((v) => setRecentCount(v ?? 10));
  }, []);

  const filteredAccounts = useMemo(() => {
    if (isMasterView) return accounts;
    return accounts.filter((a) => (a.profileIds ?? []).includes(activeProfileId));
  }, [accounts, isMasterView, activeProfileId]);

  const filteredInv = useMemo(() => {
    if (isMasterView) return investments;
    return investments.filter((i) => i.profileId === activeProfileId);
  }, [investments, isMasterView, activeProfileId]);

  const filteredTxns = useMemo(() => {
    if (isMasterView) return txns;
    return txns.filter((t) => t.profileId === activeProfileId);
  }, [txns, isMasterView, activeProfileId]);

  // assets vs liabilities
  const { bank, liabilities, invested } = useMemo(() => {
    let bank = 0, liabilities = 0;
    for (const a of filteredAccounts) {
      const bal = getAccountBalance(a, activeProfileId);
      if (a.type === 'card') liabilities += Math.max(0, -bal); // negative bal on card = outstanding
      else bank += bal;
    }
    let invested = 0;
    for (const i of filteredInv) invested += Number(i.investedAmount ?? 0);
    return { bank, liabilities, invested };
  }, [filteredAccounts, filteredInv, activeProfileId]);

  const netWorth = bank + invested - liabilities;

  const recents = filteredTxns.slice(0, recentCount);

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Hero / Net worth */}
      <section className="rounded-2xl bg-gradient-to-br from-primary/15 via-primary/5 to-transparent border border-border p-5">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs uppercase tracking-wider text-muted-fg">
            {isMasterView ? 'Net worth — all profiles' : `${activeProfile?.name}'s net worth`}
          </p>
          <button onClick={() => setShow((v) => !v)} className="text-muted-fg hover:text-foreground" aria-label="Toggle balance visibility">
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <h1 className="text-3xl font-bold tracking-tight">
          {show ? formatINR(netWorth, { hidePaise: true }) : '••••••'}
        </h1>
        <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
          <div className="rounded-xl bg-surface/60 backdrop-blur p-3">
            <p className="text-[11px] text-muted-fg">Bank / Wallets</p>
            <p className="font-semibold">{show ? formatINRShort(bank) : '••••'}</p>
          </div>
          <div className="rounded-xl bg-surface/60 backdrop-blur p-3">
            <p className="text-[11px] text-muted-fg">Invested</p>
            <p className="font-semibold">{show ? formatINRShort(invested) : '••••'}</p>
          </div>
          <div className="rounded-xl bg-surface/60 backdrop-blur p-3">
            <p className="text-[11px] text-muted-fg">Liabilities</p>
            <p className="font-semibold text-danger">{show ? formatINRShort(liabilities) : '••••'}</p>
          </div>
        </div>
      </section>

      {/* Account cards */}
      <section>
        <div className="flex items-center justify-between mb-2 px-1">
          <h2 className="text-sm font-semibold">Accounts</h2>
          <Link to="/settings/accounts" className="text-xs text-primary font-medium">Manage →</Link>
        </div>
        {filteredAccounts.length === 0 ? (
          <Card>
            <CardBody>
              <EmptyState
                icon={Wallet}
                title="No accounts yet"
                hint="Add a bank, credit card, or wallet to start tracking."
                action={
                  <Link to="/settings/accounts" className="fs-btn-primary inline-flex">
                    <PlusCircle className="w-4 h-4" /> Add account
                  </Link>
                }
              />
            </CardBody>
          </Card>
        ) : (
          <div className="flex gap-3 overflow-x-auto hide-scrollbar -mx-4 px-4 pb-1">
            {filteredAccounts.map((a) => {
              const Icon = ACCOUNT_ICONS[a.type] ?? Landmark;
              return (
                <div
                  key={a.id}
                  className="shrink-0 w-64 fs-card p-4 flex flex-col gap-2"
                  style={{ borderTop: `3px solid ${a.color ?? 'rgb(var(--primary))'}` }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-flex items-center justify-center w-8 h-8 rounded-lg"
                        style={{ background: (a.color ?? '#22d3ee') + '22', color: a.color ?? '#22d3ee' }}
                      >
                        <Icon className="w-4 h-4" />
                      </span>
                      <div>
                        <p className="text-sm font-semibold leading-tight">{a.name}</p>
                        <p className="text-[11px] text-muted-fg">{maskNumber(a.number)}</p>
                      </div>
                    </div>
                    <span className="fs-chip text-[10px] uppercase tracking-wider">{a.type}</span>
                  </div>
                  <div className="pt-1">
                    <p className="text-xs text-muted-fg">
                      Balance{!isMasterView ? ` · ${activeProfile?.name ?? ''}` : ''}
                    </p>
                    <p className="text-lg font-semibold">
                      {show ? formatINR(getAccountBalance(a, activeProfileId), { hidePaise: true }) : '••••••'}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Recent transactions */}
      <section>
        <div className="flex items-center justify-between mb-2 px-1">
          <h2 className="text-sm font-semibold">Recent transactions</h2>
          <div className="flex items-center gap-2">
            <select
              className="fs-input py-1.5 text-xs w-auto"
              value={recentCount}
              onChange={(e) => {
                const v = Number(e.target.value);
                setRecentCount(v);
                setSetting('home.recentCount', v);
              }}
            >
              {[5, 10, 20, 50].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <Link to="/transactions" className="text-xs text-primary font-medium">All →</Link>
          </div>
        </div>
        {recents.length === 0 ? (
          <Card>
            <CardBody>
              <EmptyState
                icon={PlusCircle}
                title="No transactions yet"
                hint="Add your first transaction to get started."
                action={<button className="fs-btn-primary" onClick={openAdd}>Add transaction</button>}
              />
            </CardBody>
          </Card>
        ) : (
          <Card>
            <ul className="divide-y divide-border">
              {recents.map((t) => (
                <TxnRow key={t.id} t={t} categories={categories} accounts={accounts} profiles={profiles} show={show} />
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}

function TxnRow({ t, categories, accounts, profiles, show }) {
  const cat = categories.find((c) => c.id === t.categoryId);
  const sub = categories.find((c) => c.id === t.subCategoryId);
  const acct = accounts.find((a) => a.id === t.accountId);
  const profile = profiles.find((p) => p.id === t.profileId);
  return (
    <li className="flex items-center gap-3 p-3">
      <span
        className="w-10 h-10 rounded-xl inline-flex items-center justify-center text-lg shrink-0"
        style={{ background: (cat?.color ?? '#94a3b8') + '22', color: cat?.color ?? '#94a3b8' }}
      >
        {cat?.icon ?? '🏷️'}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="font-medium text-sm truncate">{cat?.name ?? 'Uncategorized'}{sub && <span className="text-muted-fg"> · {sub.name}</span>}</p>
          {profile && <Avatar size="xs" name={profile.name} avatar={profile.avatar} color={profile.color} />}
        </div>
        <p className="text-xs text-muted-fg truncate">
          {acct?.name ?? '—'} · {fmtDate(t.dateTime)}{t.description ? ` · ${t.description}` : ''}
        </p>
      </div>
      <p className={cn('text-sm font-semibold tabular-nums', t.txnType === 'credit' ? 'text-success' : 'text-danger')}>
        {show
          ? `${t.txnType === 'credit' ? '+' : '−'} ${formatINR(t.amount, { hidePaise: true })}`
          : '••••'}
      </p>
    </li>
  );
}
