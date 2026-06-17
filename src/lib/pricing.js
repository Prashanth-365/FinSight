// Live price/NAV tracking has been removed — FinSight records only invested
// amounts (when, where, how much). This module previously fetched MF NAV from
// mfapi.in, crypto prices from CoinGecko, and stock prices from Alpha Vantage;
// all of that is intentionally gone. Kept as an empty module to avoid dangling
// imports if anything still references it.
export {};
