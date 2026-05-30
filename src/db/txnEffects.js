// Single source of truth for the side-effects of a transaction on derived
// balances: the account's per-profile balance and (if linked) an investment's
// invested amount. Every create / edit / delete / import path routes through
// here so the sign math lives in exactly one place.
import { db, reindexSlNo } from './database.js';
import { applyTxnDeltaToBalances } from '@/lib/utils.js';

// sign = +1 to apply a transaction's effect, -1 to reverse it.
export async function applyTransactionEffects(txn, sign) {
  if (!txn) return;
  const amt = Number(txn.amount ?? 0);
  if (!amt) return;

  // Account balance: a debit lowers the balance, a credit raises it.
  if (txn.accountId != null) {
    const account = await db.accounts.get(txn.accountId);
    if (account) {
      const delta = sign * (txn.txnType === 'credit' ? 1 : -1) * amt;
      const balances = applyTxnDeltaToBalances(account, txn.profileId, delta);
      await db.accounts.update(account.id, { balances, balance: null });
    }
  }

  // Investment invested-amount: a debit (buy) raises it, a credit (sell) lowers.
  if (txn.investmentId != null) {
    const inv = await db.investments.get(txn.investmentId);
    if (inv) {
      const invDelta = sign * (txn.txnType === 'credit' ? -1 : 1) * amt;
      const investedAmount = Math.max(0, Number(inv.investedAmount ?? 0) + invDelta);
      const patch = { investedAmount };
      // Only bump current value when applying (never shrink it on reversal).
      if (sign > 0) patch.currentValue = Math.max(Number(inv.currentValue ?? 0), investedAmount);
      await db.investments.update(inv.id, patch);
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
