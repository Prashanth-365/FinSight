// Shared helpers for statement parsing. A parsed row is normalised to:
//   { date: epochMillis, description: string, amount: number, txnType: 'debit'|'credit', balance?: number, raw?: string }

export function parseAmount(v) {
  if (v == null) return null;
  const s = String(v).replace(/[₹,\s]/g, '').replace(/(cr|dr)$/i, '');
  if (s === '' || s === '-') return null;
  const n = Number(s);
  return isFinite(n) ? Math.abs(n) : null;
}

// Parse many Indian date shapes → epoch millis (local midnight).
export function parseStmtDate(v, defaultYear = null) {
  if (v == null) return null;
  if (v instanceof Date && !isNaN(v)) return atMidnight(v.getTime());
  const s = String(v).trim();

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YY
  let m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    y = +y; if (y < 100) y += 2000;
    return atMidnight(new Date(y, +mo - 1, +d).getTime());
  }
  // DD-MMM-YYYY / DD MMM 'YY  e.g. 05-Apr-2024, "01 May '26" (slice uses an apostrophe year)
  m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,})[-\s]['’]?(\d{2,4})$/);
  if (m) {
    const mo = monthIndex(m[2]);
    if (mo >= 0) {
      let y = +m[3]; if (y < 100) y += 2000;
      return atMidnight(new Date(y, mo, +m[1]).getTime());
    }
  }
  // DD-MMM with NO year (e.g. KBL passbook "01-MAY") — use the statement's year if known.
  m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,})$/);
  if (m && defaultYear) {
    const mo = monthIndex(m[2]);
    if (mo >= 0) return atMidnight(new Date(defaultYear, mo, +m[1]).getTime());
  }
  // YYYY-MM-DD
  m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) return atMidnight(new Date(+m[1], +m[2] - 1, +m[3]).getTime());

  const t = Date.parse(s);
  return isFinite(t) ? atMidnight(t) : null;
}

function atMidnight(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
function monthIndex(name) {
  return MONTHS.indexOf(String(name).slice(0, 3).toLowerCase());
}

export function cleanDescription(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

// Heuristic: classify header tokens of a tabular statement to column roles.
export function classifyHeaders(headerCells) {
  const roles = {};
  headerCells.forEach((cell, i) => {
    const h = String(cell ?? '').toLowerCase();
    if (/(txn|transaction|value|tran)?\s*date/.test(h) && roles.date == null) roles.date = i;
    else if (/(narration|description|particular|remark|detail|transaction remarks)/.test(h) && roles.description == null) roles.description = i;
    else if (/(withdrawal|debit|paid out|\bdr\b)/.test(h) && roles.debit == null) roles.debit = i;
    else if (/(deposit|credit|paid in|\bcr\b)/.test(h) && roles.credit == null) roles.credit = i;
    else if (/(balance|closing bal)/.test(h) && roles.balance == null) roles.balance = i;
    else if (/amount/.test(h) && roles.amount == null) roles.amount = i;
  });
  return roles;
}

export function rowsFromTable(rows, roles, defaultYear = null) {
  const out = [];
  for (const r of rows) {
    const date = parseStmtDate(r[roles.date], defaultYear);
    if (!date) continue;
    const description = cleanDescription(r[roles.description] ?? '');
    let amount = null, txnType = null;

    if (roles.debit != null || roles.credit != null) {
      const dr = parseAmount(r[roles.debit]);
      const cr = parseAmount(r[roles.credit]);
      if (cr && cr > 0) { amount = cr; txnType = 'credit'; }
      else if (dr && dr > 0) { amount = dr; txnType = 'debit'; }
    } else if (roles.amount != null) {
      const raw = String(r[roles.amount] ?? '');
      amount = parseAmount(raw);
      txnType = /cr\b/i.test(raw) || /^\+/.test(raw.trim()) ? 'credit' : 'debit';
    }
    if (!amount) continue;

    out.push({
      date,
      description,
      amount,
      txnType,
      balance: roles.balance != null ? parseAmount(r[roles.balance]) : null,
      raw: r.join(' | ')
    });
  }
  return out;
}
