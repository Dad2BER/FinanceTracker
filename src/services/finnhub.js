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
  // Return price plus daily change data (dp = % change, d = $ change)
  return { price: data.c, dp: data.dp ?? null, d: data.d ?? null };
}

/**
 * Fetches quotes for multiple symbols.
 * Returns { priceMap, detailsMap } where:
 *   priceMap:   { symbol: price }
 *   detailsMap: { symbol: { dp, d } }  — daily % and $ change from Finnhub
 */
export async function fetchQuotes(symbols) {
  const results = await Promise.allSettled(symbols.map(fetchQuote));
  const priceMap = {};
  const detailsMap = {};
  symbols.forEach((sym, i) => {
    if (results[i].status === "fulfilled") {
      const { price, dp, d } = results[i].value;
      priceMap[sym] = price;
      if (dp !== null) detailsMap[sym] = { dp, d };
    } else {
      console.warn(`[finnhub] ${sym}: ${results[i].reason?.message}`);
    }
  });
  return { priceMap, detailsMap };
}

/**
 * Fetches the full quote object for a symbol (open, high, low, prev close,
 * current price, change, change %).
 * Returns the raw Finnhub /quote response: { c, d, dp, h, l, o, pc, t }
 */
export async function fetchQuoteDetail(symbol) {
  const API_KEY = window.__FINNHUB_API_KEY__ || "";
  if (!API_KEY) throw new Error("No Finnhub API key configured.");
  const res = await fetchWithTimeout(
    `${BASE_URL}/quote?symbol=${encodeURIComponent(symbol)}&token=${API_KEY}`
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data || data.c <= 0) throw new Error(`No price data for: ${symbol}`);
  return data;
}

/**
 * Fetches the company profile for a symbol.
 * Returns the raw Finnhub /stock/profile2 response:
 *   { name, exchange, finnhubIndustry, marketCapitalization,
 *     weburl, logo, country, currency, ticker }
 */
export async function fetchProfile(symbol) {
  const API_KEY = window.__FINNHUB_API_KEY__ || "";
  if (!API_KEY) throw new Error("No Finnhub API key configured.");
  const res = await fetchWithTimeout(
    `${BASE_URL}/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${API_KEY}`
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
