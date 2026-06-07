import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { parseStmtDate, parseAmount, cleanDescription } from './parseCommon.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

// Extract text as an array of lines (grouping items by their y position).
async function extractLines(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const byY = new Map();
    for (const item of content.items) {
      if (!item.str) continue;
      const y = Math.round(item.transform[5]); // vertical position
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y).push({ x: item.transform[4], s: item.str });
    }
    // sort rows top→bottom, items left→right
    const ys = [...byY.keys()].sort((a, b) => b - a);
    for (const y of ys) {
      const text = byY.get(y).sort((a, b) => a.x - b.x).map((i) => i.s).join(' ').replace(/\s+/g, ' ').trim();
      if (text) lines.push(text);
    }
  }
  return lines;
}

function detectBank(text) {
  const t = text.toLowerCase();
  if (t.includes('hdfc')) return 'HDFC';
  if (t.includes('icici')) return 'ICICI';
  if (t.includes('state bank of india') || /\bsbi\b/.test(t)) return 'SBI';
  if (t.includes('axis bank')) return 'AXIS';
  if (t.includes('kotak')) return 'KOTAK';
  if (t.includes('karnataka bank')) return 'KBL';
  if (t.includes('slice')) return 'SLICE';
  return 'GENERIC';
}

// A line carrying a transaction usually looks like:
//   <date> <description...> <amount> [<balance>]
// possibly with a Cr/Dr marker. We extract the leading date, trailing numbers,
// and treat the middle as the description.
// Optional leading serial number (Kotak prints a "#" column), then a date in
// DD/MM/YYYY, DD-MMM-YYYY, or "DD MMM 'YY" form (slice uses an apostrophe year).
const LEADING_DATE = /^(?:\d{1,3}\s+)?(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}[-\s][A-Za-z]{3,}[-\s]['’]?\d{2,4})/;
// Money may carry a leading minus (slice marks debits as "-₹5.00") and/or a Cr/Dr tag.
const MONEY = /(-)?\s*(?:₹|rs\.?|inr)?\s*([0-9][0-9,]*\.\d{2})(?:\s*(cr|dr))?/gi;

function parseGenericLines(lines) {
  const out = [];
  let prevBalance = null;

  for (const line of lines) {
    // Seed the running balance from an "Opening Balance" row so even the first
    // transaction can infer its direction (needed by tabular PDFs like Kotak).
    const obIdx = line.toLowerCase().indexOf('opening balance');
    if (obIdx !== -1) {
      const ms = [...line.matchAll(MONEY)].filter((mm) => (mm.index ?? 0) >= obIdx);
      if (ms.length) { prevBalance = parseAmount(ms[0][2]); continue; }
    }

    const dm = line.match(LEADING_DATE);
    if (!dm) continue;
    const date = parseStmtDate(dm[1]);
    if (!date) continue;

    const monies = [...line.matchAll(MONEY)];
    if (monies.length === 0) continue;

    // Heuristics (priority): explicit Cr/Dr tag → leading minus sign → running
    // balance change → keyword. Money groups: [1]=sign, [2]=number, [3]=cr/dr.
    let amount = null, txnType = null, balance = null, marker = null, neg = false;

    if (monies.length >= 2) {
      const amt = monies[monies.length - 2];
      const bal = monies[monies.length - 1];
      amount = parseAmount(amt[2]);
      neg = !!amt[1];
      marker = amt[3]?.toLowerCase() ?? null;
      balance = parseAmount(bal[2]);
    } else {
      const amt = monies[monies.length - 1];
      amount = parseAmount(amt[2]);
      neg = !!amt[1];
      marker = amt[3]?.toLowerCase() ?? null;
    }
    if (!amount) continue;

    if (marker === 'cr') txnType = 'credit';
    else if (marker === 'dr') txnType = 'debit';
    else if (neg) txnType = 'debit';
    else if (balance != null && prevBalance != null) {
      txnType = balance >= prevBalance ? 'credit' : 'debit';
    } else {
      // last resort: keyword in the line
      txnType = /\b(credit|cr|received|deposit|refund|neft cr|imps cr)\b/i.test(line) ? 'credit' : 'debit';
    }
    if (balance != null) prevBalance = balance;

    // description = the line minus the leading date/serial and the money tokens
    let desc = line.slice(dm[0].length);
    for (const mm of monies) desc = desc.replace(mm[0], ' ');
    desc = cleanDescription(desc);

    out.push({ date, description: desc, amount, txnType, balance, raw: line });
  }
  return out;
}

export async function parsePdf(file) {
  const lines = await extractLines(file);
  const joined = lines.join('\n');
  const bank = detectBank(joined);
  // All supported banks currently use the generic line parser — it's robust to
  // the "<date> <desc> <amount> <balance>" shape every Indian bank PDF follows.
  // Bank-specific quirks can override here later if needed.
  const rows = parseGenericLines(lines);
  if (rows.length === 0) {
    throw new Error('No transaction rows detected in this PDF. It may be a scanned/image PDF (needs OCR) or an unusual layout — try the Excel/CSV export instead.');
  }
  return { rows, meta: { bank, lineCount: lines.length } };
}
