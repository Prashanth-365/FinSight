import clsx from 'clsx';

export function cn(...args) {
  return clsx(...args);
}

export function uniq(arr) {
  return Array.from(new Set(arr));
}

export function groupBy(arr, fn) {
  const out = {};
  for (const x of arr) {
    const k = fn(x);
    if (!out[k]) out[k] = [];
    out[k].push(x);
  }
  return out;
}

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// frequency-sorted unique values
export function freqSorted(values) {
  const counts = new Map();
  for (const v of values) {
    if (v == null || v === '') continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
}

// mask matching (XX7890, 1234XX, 12xxxxxx90)
export function aliasMatchesAccountNumber(alias, accountNumber) {
  if (!alias || !accountNumber) return false;
  const a = alias.toUpperCase().trim();
  const acct = String(accountNumber).toUpperCase();
  if (a.length !== acct.length && !/^[X*]+/.test(a) && !/[X*]+$/.test(a)) {
    // try suffix-based matching: alias "XX7890" should match an account ending in 7890
    const digits = a.replace(/[X*]/g, '');
    if (a.startsWith('XX') || a.startsWith('**')) return acct.endsWith(digits);
    if (a.endsWith('XX') || a.endsWith('**')) return acct.startsWith(digits);
  }
  // generic regex: X/* as wildcard for one char
  const re = new RegExp('^' + a.replace(/[X*]/g, '.') + '$');
  return re.test(acct);
}

export function uid(prefix = '') {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

// ── Transaction fingerprint ────────────────────────────────────────────────
// A stable hash identifying the same real-world transaction regardless of
// whether it arrived via SMS, manual entry, or a statement import. We bucket
// the date to the DAY (statements rarely carry the exact second; SMS does) and
// use account + signed amount + the most distinctive description token.
//
// Returns a short hex string. Synchronous (FNV-1a) so it can run in tight loops.

function normalizeDesc(desc) {
  if (!desc) return '';
  // Strip everything but letters/numbers, lowercase, keep the most stable bits.
  // We pull out the longest alpha token (usually the merchant/UPI handle).
  const cleaned = String(desc).toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
  const tokens = cleaned.split(/\s+/).filter((t) => t.length >= 3 && !/^\d+$/.test(t));
  tokens.sort((a, b) => b.length - a.length);
  return tokens.slice(0, 2).sort().join(' ');
}

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function txnFingerprint({ accountId, amount, txnType, dateTime, description }) {
  const day = new Date(dateTime);
  day.setHours(0, 0, 0, 0);
  const dayKey = day.getTime();
  const signed = (txnType === 'credit' ? '+' : '-') + Math.round(Number(amount ?? 0) * 100);
  const key = [accountId ?? 'x', signed, dayKey, normalizeDesc(description)].join('|');
  return fnv1a(key);
}

// Convert a timestamp (default: now) into a value for <input type="datetime-local">.
export function tsToLocalISO(ts = Date.now()) {
  const d = new Date(ts);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm
}

export function todayLocalISO() {
  return tsToLocalISO();
}

export function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

export function maskNumber(num) {
  if (!num) return '';
  const s = String(num);
  if (s.length <= 4) return '••' + s;
  return '••••' + s.slice(-4);
}

export function isPositiveNumber(v) {
  return typeof v === 'number' && isFinite(v) && v > 0;
}

// Per-profile balance helpers ---------------------------------------------
// Balances are DERIVED, not stored: an account's current balance for a profile
// is its OPENING balance plus the net effect of every transaction on that
// account+profile (credits add, debits subtract). The opening balance lives in
// `account.openingBalances = { [profileId]: number }`; the running total is
// recomputed live from the transactions table (see `deriveAccountBalance`).
//
// `getAccountBalance` survives only as the legacy reader for accounts that have
// not yet been migrated to `openingBalances` (it returns the old stored
// `balances`/`balance`, which held the current total). `ensureOpeningBalances`
// converts those on app load / import; `deriveAccountBalance` falls back to it
// until then so the displayed value never doubles up.

export function getAccountBalance(account, profileId = null) {
  if (!account) return 0;
  if (account.balances && typeof account.balances === 'object') {
    if (profileId == null) {
      return Object.values(account.balances).reduce((s, v) => s + Number(v ?? 0), 0);
    }
    return Number(account.balances[profileId] ?? 0);
  }
  // legacy: single balance applies to whichever profile owns this txn
  return Number(account.balance ?? 0);
}

// Net signed effect of every transaction on each account+profile, as
// Map<accountId, { [profileId]: number }>. A credit raises the balance, a
// debit lowers it. Pure + synchronous so it can drive a useMemo over the live
// transactions list and recompute on ANY database change.
export function computeAccountEffects(txns) {
  const map = new Map();
  for (const t of txns ?? []) {
    if (t.accountId == null) continue;
    const amt = Number(t.amount ?? 0);
    if (!amt) continue;
    const delta = (t.txnType === 'credit' ? 1 : -1) * amt;
    let acc = map.get(t.accountId);
    if (!acc) { acc = {}; map.set(t.accountId, acc); }
    const key = String(t.profileId);
    acc[key] = (acc[key] ?? 0) + delta;
  }
  return map;
}

// Derived current balance for an account & profile.
//   account       — the account record
//   accountEffects— the `{ [profileId]: delta }` for THIS account (from
//                   computeAccountEffects(...).get(account.id) ?? {})
//   profileId     — a profile id, or null for the master ("all profiles") sum.
// When the account has `openingBalances`, balance = opening + effects. When it
// doesn't (legacy / not-yet-backfilled / old backup), we fall back to the old
// stored total as-is (effects already baked in) so nothing double-counts.
export function deriveAccountBalance(account, accountEffects, profileId = null) {
  if (!account) return 0;
  const ob = account.openingBalances && typeof account.openingBalances === 'object'
    ? account.openingBalances
    : null;
  if (!ob) return getAccountBalance(account, profileId);

  const eff = accountEffects ?? {};
  if (profileId == null) {
    const keys = new Set([...Object.keys(ob), ...Object.keys(eff)]);
    let sum = 0;
    for (const k of keys) sum += Number(ob[k] ?? 0) + Number(eff[k] ?? 0);
    return sum;
  }
  const key = String(profileId);
  return Number(ob[key] ?? 0) + Number(eff[key] ?? 0);
}

// Map a freeform sub-category name (e.g. "Mutual Fund") onto the canonical
// platform key used by the Investments page ("MF", "Stock", etc.). Free-typed
// platforms fall through to "Other".
const PLATFORM_FROM_SUBCAT = {
  'mutual fund': 'MF', 'mutual funds': 'MF', 'mf': 'MF', 'sip': 'MF',
  'stock': 'Stock', 'stocks': 'Stock', 'equity': 'Stock', 'shares': 'Stock',
  'gold': 'Gold', 'sgb': 'Gold', 'gold etf': 'Gold',
  'fd': 'FD', 'fixed deposit': 'FD', 'rd': 'FD', 'recurring deposit': 'FD',
  'ppf': 'PPF',
  'epf': 'EPF', 'pf': 'EPF',
  'nps': 'Other', 'elss': 'MF',
  'crypto': 'Crypto', 'cryptocurrency': 'Crypto', 'bitcoin': 'Crypto', 'ethereum': 'Crypto',
  'chit': 'Chit', 'chit fund': 'Chit', 'chits': 'Chit'
};
export function inferInvestmentPlatform(subCategoryName) {
  if (!subCategoryName) return 'Other';
  return PLATFORM_FROM_SUBCAT[String(subCategoryName).toLowerCase().trim()] ?? 'Other';
}

// Stable account ordering: respect an explicit `sortOrder` when present,
// otherwise fall back to insertion order (the auto-increment id). Used
// everywhere accounts are listed so a user's drag-to-reorder sticks.
export function accountSort(accounts) {
  return [...(accounts ?? [])].sort((a, b) => (a.sortOrder ?? a.id) - (b.sortOrder ?? b.id));
}

// Build the set of category ids that represent "Transfer" — the top-level
// Transfer category plus all of its sub-categories. Charts/sums exclude these
// so internal money movement doesn't distort income/expense or spend totals.
export function transferCategoryIds(categories) {
  const ids = new Set();
  const top = (categories ?? []).find(
    (c) => c.parentId == null && c.name?.toLowerCase() === 'transfer'
  );
  if (top) {
    ids.add(top.id);
    for (const c of categories) {
      if (c.parentId === top.id) ids.add(c.id);
    }
  }
  return ids;
}

// ── Time bucketing (for Home charts) ────────────────────────────────────────
// Collapse a timestamp to the start-of-bucket epoch ms for 'day' | 'week' |
// 'month'. Weeks start on Monday (Indian convention). Pure + synchronous so it
// can drive grouping in tight loops.
export function bucketStart(ts, granularity = 'month') {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  if (granularity === 'day') {
    return d.getTime();
  }
  if (granularity === 'week') {
    const day = d.getDay(); // 0 = Sun … 6 = Sat
    const diff = (day + 6) % 7; // days since Monday
    d.setDate(d.getDate() - diff);
    return d.getTime();
  }
  // month
  d.setDate(1);
  return d.getTime();
}

// Human label for a bucket start (Indian formatting).
export function bucketLabel(ts, granularity = 'month') {
  const d = new Date(ts);
  if (granularity === 'day') {
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  }
  if (granularity === 'week') {
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  }
  return d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
}

