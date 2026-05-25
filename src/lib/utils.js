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

export function todayLocalISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm
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
