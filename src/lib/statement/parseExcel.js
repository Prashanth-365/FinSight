import * as XLSX from 'xlsx';
import { classifyHeaders, rowsFromTable } from './parseCommon.js';

// Parse .xlsx / .xls / .csv. We scan the first sheet for the header row
// (the first row that yields at least a date + (debit|credit|amount) mapping),
// then map subsequent rows.
export async function parseExcel(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });

  // Find the header row: scan first ~25 rows for one that classifies well.
  let headerIdx = -1, roles = null;
  for (let i = 0; i < Math.min(grid.length, 25); i++) {
    const candidate = classifyHeaders(grid[i].map((c) => String(c)));
    if (candidate.date != null && (candidate.debit != null || candidate.credit != null || candidate.amount != null)) {
      headerIdx = i;
      roles = candidate;
      break;
    }
  }
  if (headerIdx === -1) {
    throw new Error('Could not find a recognisable header row (date + debit/credit/amount) in this spreadsheet.');
  }

  const dataRows = grid.slice(headerIdx + 1).filter((r) => r.some((c) => String(c).trim() !== ''));
  const rows = rowsFromTable(dataRows, roles);
  return { rows, meta: { sheet: wb.SheetNames[0], headerRow: headerIdx + 1 } };
}
