// Best-effort live price fetchers. Each function returns a Promise that resolves
// to a number (current value/price) or null if the call failed.
// We never throw — investments fall back to manually entered currentValue.

const cache = new Map();
const CACHE_TTL = 1000 * 60 * 60 * 4; // 4 hours

async function cached(key, fetcher) {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.ts < CACHE_TTL) return hit.value;
  try {
    const value = await fetcher();
    cache.set(key, { value, ts: now });
    return value;
  } catch (e) {
    console.warn('[pricing]', key, e?.message);
    return null;
  }
}

// AMFI NAV via mfapi.in. Identifier = scheme code (e.g., "120503").
export async function fetchMfNav(schemeCode) {
  if (!schemeCode) return null;
  return cached('mf:' + schemeCode, async () => {
    const res = await fetch(`https://api.mfapi.in/mf/${encodeURIComponent(schemeCode)}/latest`);
    if (!res.ok) throw new Error('mfapi ' + res.status);
    const j = await res.json();
    const nav = j?.data?.[0]?.nav;
    return nav ? Number(nav) : null;
  });
}

// Crypto via CoinGecko. Identifier = coin id (bitcoin, ethereum, etc.)
export async function fetchCryptoPriceINR(coinId) {
  if (!coinId) return null;
  return cached('cg:' + coinId, async () => {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coinId)}&vs_currencies=inr`
    );
    if (!res.ok) throw new Error('coingecko ' + res.status);
    const j = await res.json();
    return j?.[coinId]?.inr ?? null;
  });
}

// Stocks via Alpha Vantage (user key required). Identifier = ticker like RELIANCE.BSE
export async function fetchStockPriceINR(ticker, apiKey) {
  if (!ticker || !apiKey) return null;
  return cached('av:' + ticker, async () => {
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(ticker)}&apikey=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('alphavantage ' + res.status);
    const j = await res.json();
    const v = j?.['Global Quote']?.['05. price'];
    return v ? Number(v) : null;
  });
}

// FD / PPF / EPF: simple-interest projection. rate = % annually.
export function fdProjection({ principal, ratePct, startDate, asOfDate = Date.now() }) {
  if (!principal || !ratePct || !startDate) return null;
  const years = Math.max(0, (asOfDate - startDate) / (365.25 * 24 * 3600 * 1000));
  return principal * Math.pow(1 + ratePct / 100, years);
}
