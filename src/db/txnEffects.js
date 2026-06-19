// Side-effects of a transaction on STORED derived values.
//
// Account balances are no longer stored — they are derived live from the
// transactions table (opening balance + Σ effects; see `deriveAccountBalance`
// in src/lib/utils.js). That makes balances a single source of truth: every
// create / edit / delete / bulk-edit / import path changes the transactions
// table and the balance recomputes automatically via useLiveQuery, so no path
// can leave a balance stale.
//
// The only value still mutated here is an investment holding's
// `investedAmount`, which is a hybrid (the user can also set it by hand in the
// InvestmentForm), so it can't be purely derived from transactions. Every
// mutation path therefore still routes through `applyTransactionEffects` for
// the investment side, and edits reverse the old effect (-1) before applying
// the new one (+1).
import { db, reindexSlNo } from './database.js';
import { computeAccountEffects } from '@/lib/utils.js';

// sign = +1 to apply a transaction's effect, -1 to reverse it.
export async function applyTransactionEffects(txn, sign) {
  if (!txn) return;
  const amt = Number(txn.amount ?? 0);
  if (!amt) return;

  // Investment invested-amount: a debit (buy) raises it, a credit (sell) lowers.
  if (txn.investmentId != null) {
    const inv = await db.investments.get(txn.investmentId);
    if (inv) {
      const invDelta = sign * (txn.txnType === 'credit' ? -1 : 1) * amt;
      const investedAmount = Math.max(0, Number(inv.investedAmount ?? 0) + invDelta);
      await db.investments.update(inv.id, { investedAmount });
    }
  }
}

// Delete one transaction, reversing its effects and re-numbering.
export async function deleteTransaction(id) {
  const txn = await db.transactions.get(id);
  if (!txn) return;
  await applyTransactionEffects(txn, -1);
  await db.transactions.delete(id);
  await reindexSlNo();
}

// Delete many, reversing each, with a single reindex at the end.
export async function deleteTransactions(ids) {
  const txns = (await db.transactions.bulkGet(ids)).filter(Boolean);
  for (const t of txns) await applyTransactionEffects(t, -1);
  await db.transactions.bulkDelete(ids);
  await reindexSlNo();
}

// Bulk-edit service: apply a field patch to many transactions while keeping
// derived effects correct. `patchFor` is either a plain patch object or a
// function (currentTxn) => patch | null. For each row we reverse the old
// effect, write the patch, then apply the new effect — so a bulk change to
// txnType/account/profile on investment-linked rows stays consistent (account
// balances are derived and need no explicit adjustment).
export async function updateTransactions(ids, patchFor) {
  await db.transaction('rw', db.transactions, db.investments, async () => {
    for (const id of ids) {
      const cur = await db.transactions.get(id);
      if (!cur) continue;
      const patch = typeof patchFor === 'function' ? patchFor(cur) : patchFor;
      if (!patch || Object.keys(patch).length === 0) continue;
      const next = { ...cur, ...patch };
      await applyTransactionEffects(cur, -1);
      await db.transactions.update(id, patch);
      await applyTransactionEffects(next, +1);
    }
  });
}

// One-time / idempotent backfill: give every account an `openingBalances` map
// so its balance can be derived (opening + Σ effects). Accounts created before
// the derived-balance model stored their CURRENT total in `balances`/`balance`;
// we back the opening figure out of that by subtracting the historical effect
// of their transactions, so the displayed balance is preserved exactly:
//   derived = opening + effects = (current − effects) + effects = current.
//
// Runs on app load (seed.js) and after an import/restore (backup.js). Accounts
// that already carry `openingBalances` (new records, fresh backups) are skipped,
// so it never recomputes a value that's already authoritative.
export async function ensureOpeningBalances() {
  const accounts = await db.accounts.toArray();
  const need = accounts.filter(
    (a) => !(a.openingBalances && typeof a.openingBalances === 'object')
  );
  if (need.length === 0) return;

  const txns = await db.transactions.toArray();
  const effects = computeAccountEffects(txns);

  await db.transaction('rw', db.accounts, async () => {
    for (const a of need) {
      const eff = effects.get(a.id) ?? {};
      // The account's current per-profile total before deriving: prefer the
      // per-profile `balances` map, else promote a legacy single `balance`.
      const base = (a.balances && typeof a.balances === 'object')
        ? a.balances
        : (a.balance != null && (a.profileIds ?? []).length
            ? { [String(a.profileIds[0])]: Number(a.balance) }
            : {});
      const opening = {};
      const keys = new Set([...Object.keys(base), ...Object.keys(eff)]);
      for (const k of keys) {
        opening[k] = Number(base[k] ?? 0) - Number(eff[k] ?? 0);
      }
      await db.accounts.update(a.id, { openingBalances: opening, balances: null, balance: null });
    }
  });
}
