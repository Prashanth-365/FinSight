// Indian Rupee formatting (lakhs, crores)
const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2
});
const inr0 = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0
});
const plainIn = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

export function formatINR(v, { hidePaise = false } = {}) {
  const n = Number(v ?? 0);
  if (!isFinite(n)) return '₹0';
  return (hidePaise ? inr0 : inr).format(n);
}

// short Indian: 1.25L, 2.4Cr
export function formatINRShort(v) {
  const n = Number(v ?? 0);
  if (!isFinite(n)) return '₹0';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_00_00_000) return `${sign}₹${(abs / 1_00_00_000).toFixed(2)} Cr`;
  if (abs >= 1_00_000) return `${sign}₹${(abs / 1_00_000).toFixed(2)} L`;
  if (abs >= 1_000) return `${sign}₹${(abs / 1_000).toFixed(1)}K`;
  return `${sign}₹${plainIn.format(abs)}`;
}

export function formatNumber(v) {
  return plainIn.format(Number(v ?? 0));
}

export function formatPercent(v, digits = 2) {
  const n = Number(v ?? 0);
  if (!isFinite(n)) return '0%';
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;
}
