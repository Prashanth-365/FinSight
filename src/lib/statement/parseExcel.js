import * as XLSX from 'xlsx';
import { classifyHeaders, rowsFromTable } from './parseCommon.js';

// Look for a 4-digit year (20xx) in the top rows — bank "passbook" exports often
// print the statement period there, and some put dates as "01-MAY" with no year.
function guessYear(grid) {
  for (let i = 0; i < Math.min(grid.length, 12); i++) {
    for (const cell of grid[i] || []) {
      const m = String(cell).match(/\b(20\d{2})\b/);
      if (m) return Number(m[1]);
    }
  }
  return new Date().getFullYear();
}

// Parse .xlsx / .xls / .csv. Scans EVERY sheet for a header row (the first row
// that yields date + (debit|credit|amount)), then maps the rows below it. Picks
// the sheet that yields the most transactions.
export async function parseExcel(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });

  let best = null;
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
    if (!grid.length) continue;

    const defaultYear = guessYear(grid);

    // Find the header row: scan the first ~40 rows for one that classifies well.
    let headerIdx = -1, roles = null;
    for (let i = 0; i < Math.min(grid.length, 40); i++) {
      const candidate = classifyHeaders((grid[i] || []).map((c) => String(c)));
      if (candidate.date != null && (candidate.debit != null || candidate.credit != null || candidate.amount != null)) {
        headerIdx = i;
        roles = candidate;
        break;
      }
    }
    if (headerIdx === -1) continue;

    const dataRows = grid.slice(headerIdx + 1).filter((r) => r.some((c) => String(c).trim() !== ''));
    const rows = rowsFromTable(dataRows, roles, defaultYear);
    if (rows.length && (!best || rows.length > best.rows.length)) {
      best = { rows, sheet: name, headerRow: headerIdx + 1 };
    }
  }

  if (!best) {
    throw new Error('Could not find a transaction table (date + debit/credit/amount columns) in this spreadsheet. If it is a bank "mPassbook"/HTML export, try opening it and re-saving as CSV.');
  }
  return { rows: best.rows, meta: { sheet: best.sheet, headerRow: best.headerRow } };
}
