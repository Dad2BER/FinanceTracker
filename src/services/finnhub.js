const BASE_URL = "https://finnhub.io/api/v1";
const FETCH_TIMEOUT_MS = 8000;

/**
 * Wraps fetch() with an AbortController timeout so a hung request
 * doesn't stall the entire price-fetch cycle.
 */
function fetchWithTimeout(url, ms = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

export async function fetchQuote(symbol) {
  const API_KEY = window.__FINNHUB_API_KEY__ || "";
  if (!API_KEY) throw new Error("No Finnhub API key configured.");
  const res = await fetchWithTimeout(
    `${BASE_URL}/quote?symbol=${encodeURIComponent(symbol)}&token=${API_KEY}`
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  // c = current price; 0 is returned for unknown symbols, rate-limited
  // responses, or after-hours with no data — all invalid for our purposes.
  if (!data || data.c <= 0) {
    throw new Error(`No valid price data for: ${symbol}`);
  }
  return data.c;
}

export async function fetchQuotes(symbols) {
  const results = await Promise.allSettled(symbols.map(fetchQuote));
  const priceMap = {};
  symbols.forEach((sym, i) => {
    if (results[i].status === "fulfilled") {
      priceMap[sym] = results[i].value;
    } else {
      console.warn(`[finnhub] ${sym}: ${results[i].reason?.message}`);
    }
  });
  return priceMap;
}
