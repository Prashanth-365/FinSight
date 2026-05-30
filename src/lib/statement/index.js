import { parseExcel } from './parseExcel.js';
import { parsePdf } from './parsePdf.js';

// Dispatch by file extension / MIME. Returns { rows, meta }.
export async function parseStatement(file) {
  const name = (file.name || '').toLowerCase();
  const isPdf = name.endsWith('.pdf') || file.type === 'application/pdf';
  const isExcel = /\.(xlsx|xls|csv)$/.test(name) ||
    file.type.includes('sheet') || file.type.includes('excel') || file.type === 'text/csv';

  if (isPdf) return parsePdf(file);
  if (isExcel) return parseExcel(file);
  throw new Error('Unsupported file. Upload a bank statement as PDF, XLSX, XLS, or CSV.');
}
