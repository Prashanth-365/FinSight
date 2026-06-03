// Reconcile freshly-parsed statement rows against what we already know, so we
// never create duplicates. Matching is multiplicity-aware and description-free:
// the key is (day, signed-amount) for a given account, and split groups collapse
// to a single entry at their total. Rows already present as final transactions
// are dropped; rows already represented by a pending inbox item merge into it;
// only the genuinely-missing rows are added to the inbox for review.

import { db } from '@/db/database.js';
import { aliasMatchesAccountNumber } from '@/lib/utils.js';

function dayBucket(ts) {
  const d = new Date(ts ?? Date.now());
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function signedCents(amount, txnType) {
  return (txnType === 'credit' ? '+' : '-') + Math.round(Number(amount ?? 0) * 100);
}

// A stable key for "the same real-world transaction" — day + signed amount only.
// Deliberately ignores description (it differs across SMS / statement / manual).
export function reconKey(ts, amount, txnType) {
  return dayBucket(ts) + '|' + signedCents(amount, txnType);
}

// Resolve which account an inbox item belongs to: an explicit accountId (always
// set for statement rows) wins; otherwise fall back to the SMS alias guess.
export function matchAccountForSms(sms, accounts = []) {
  if (sms?.accountId != null) return accounts.find((a) => a.id === sms.accountId) ?? null;
  const guess = sms?.parsedData?.aliasGuess ?? '';
  if (!guess) return null;
  const digits = guess.replace(/[X*]/g, '');
  return accounts.find((a) =>
    (a.aliases ?? []).some((al) => aliasMatchesAccountNumber(al, guess)) ||
    (a.number && digits && String(a.number).endsWith(digits))
  ) ?? null;
}

// Multiplicity-aware multiset of EXISTING transactions for one account, keyed by
// (day, signed amount). A split group counts once, at its total (matching the
// single bank debit a statement would show), not as its individual shares.
function buildFinalCounts(txns, accountId) {
  const counts = new Map();
  const seenGroups = new Set();
  const bump = (k) => counts.set(k, (counts.get(k) ?? 0) + 1);
  for (const t of txns) {
    if (t.accountId !== accountId) continue;
    if (t.splitGroupId) {
      if (seenGroups.has(t.splitGroupId)) continue;
      seenGroups.add(t.splitGroupId);
      const total = Number(t.splitTotal ?? t.amount ?? 0);
      bump(reconKey(t.dateTime, total, t.txnType));
    } else {
      bump(reconKey(t.dateTime, t.amount, t.txnType));
    }
  }
  return counts;
}

function take(map, key) {
  const arr = map.get(key);
  return arr && arr.length ? arr.shift() : null;
}

/**
 * Parse-then-reconcile entry point. Writes the genuinely-missing rows into the
 * inbox as kind='statement' pending items and enriches any matched SMS item with
 * the now-confirmed account.
 *
 * @param {{ rows: Array<{amount:number, txnType:'debit'|'credit', date:number, description?:string}>,
 *           accountId: number, accounts: Array }} args
 * @returns {{ total, alreadyInBooks, mergedWithInbox, dismissed, added }}
 */
export async function ingestStatementRows({ rows, accountId, accounts = [] }) {
  const acc = Number(accountId);
  const allTxns = await db.transactions.toArray();
  const finalCounts = buildFinalCounts(allTxns, acc);

  const allQueue = await db.smsQueue.toArray();

  // Pending items that can ABSORB a statement row (so we don't double-add):
  // same account, or an SMS with no resolvable account yet.
  const pendingByKey = new Map();
  // Dismissed STATEMENT rows for this account: a re-imported match should stay
  // gone, not reappear (statement rows carry no nativeId to dedup on).
  const dismissedByKey = new Map();

  for (const s of allQueue) {
    const pd = s.parsedData ?? {};
    if (!pd.amount || !pd.txnType) continue;
    const k = reconKey(s.dateTime ?? pd.date, pd.amount, pd.txnType);
    if (s.status === 'pending') {
      const matched = matchAccountForSms(s, accounts);
      if (matched && matched.id !== acc) continue; // resolved to a different account
      if (!pendingByKey.has(k)) pendingByKey.set(k, []);
      pendingByKey.get(k).push(s);
    } else if (s.status === 'dismissed' && (s.kind ?? 'sms') === 'statement' && s.accountId === acc) {
      if (!dismissedByKey.has(k)) dismissedByKey.set(k, []);
      dismissedByKey.get(k).push(s);
    }
  }

  let alreadyInBooks = 0;
  let mergedWithInbox = 0;
  let dismissed = 0;
  const toAdd = [];
  const toEnrich = [];

  for (const r of rows) {
    const k = reconKey(r.date, r.amount, r.txnType);

    const left = finalCounts.get(k) ?? 0;
    if (left > 0) { finalCounts.set(k, left - 1); alreadyInBooks++; continue; }

    const hit = take(pendingByKey, k);
    if (hit) {
      mergedWithInbox++;
      if (hit.accountId == null) toEnrich.push(hit.id);
      continue;
    }

    if (take(dismissedByKey, k)) { dismissed++; continue; }

    toAdd.push({
      kind: 'statement',
      accountId: acc,
      rawSms: r.description || 'Statement transaction',
      parsedData: {
        amount: r.amount,
        txnType: r.txnType,
        date: r.date,
        aliasGuess: null,
        description: r.description || ''
      },
      status: 'pending',
      dateTime: r.date,
      linkedTxnId: null,
      nativeId: null,
      source: 'statement-import'
    });
  }

  if (toAdd.length) await db.smsQueue.bulkAdd(toAdd);
  for (const id of toEnrich) await db.smsQueue.update(id, { accountId: acc });

  return { total: rows.length, alreadyInBooks, mergedWithInbox, dismissed, added: toAdd.length };
}

// ── Live "already in your books" check ──────────────────────────────────────
// Same matching as the import-time reconcile, but applied to the CURRENT pending
// inbox items so we can flag ones that now duplicate a real transaction (e.g. you
// entered it manually after the SMS landed). Multiplicity-aware, account-scoped.

function bookKey(accountId, ts, amount, txnType) {
  return accountId + '|' + reconKey(ts, amount, txnType);
}

function buildBooksCounts(txns) {
  const counts = new Map();
  const seenGroups = new Set();
  const bump = (k) => counts.set(k, (counts.get(k) ?? 0) + 1);
  for (const t of txns) {
    if (t.accountId == null) continue;
    if (t.splitGroupId) {
      if (seenGroups.has(t.splitGroupId)) continue;
      seenGroups.add(t.splitGroupId);
      bump(bookKey(t.accountId, t.dateTime, Number(t.splitTotal ?? t.amount ?? 0), t.txnType));
    } else {
      bump(bookKey(t.accountId, t.dateTime, t.amount, t.txnType));
    }
  }
  return counts;
}

/**
 * Returns a Set of pending-item ids whose (account, day, signed amount) already
 * exists in the books. Items whose account can't be resolved are never flagged
 * (we can't be sure). Multiplicity-aware: if the books hold one ₹500 on a day but
 * two identical ₹500 are pending, only one is flagged.
 *
 * @param {Array} pendingItems  pending smsQueue rows, in display order
 * @param {Array} txns          all transactions
 * @param {Array} accounts
 */
export function findAlreadyInBooks(pendingItems = [], txns = [], accounts = []) {
  const counts = buildBooksCounts(txns); // mutable; we consume matches
  const flagged = new Set();
  for (const s of pendingItems) {
    const pd = s.parsedData ?? {};
    if (!pd.amount || !pd.txnType) continue;
    const acc = matchAccountForSms(s, accounts);
    if (!acc) continue;
    const k = bookKey(acc.id, s.dateTime ?? pd.date, pd.amount, pd.txnType);
    const left = counts.get(k) ?? 0;
    if (left > 0) { counts.set(k, left - 1); flagged.add(s.id); }
  }
  return flagged;
}
