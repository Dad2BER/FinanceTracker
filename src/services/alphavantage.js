const BASE_URL = "https://www.alphavantage.co/query";
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

// Singleton flag so the rate-limit warning only logs once per fetch cycle
let _rateLimitWarned = false;

export async function fetchQuote(symbol) {
  const API_KEY = window.__AV_API_KEY__ || "";
  if (!API_KEY) throw new Error("No Alpha Vantage API key configured.");
  const res = await fetchWithTimeout(
    `${BASE_URL}?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${API_KEY}`
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  // AV returns HTTP 200 with an "Information" or "Note" field when rate-limited
  // instead of the actual quote data.
  if (data["Information"] || data["Note"]) {
    const msg = data["Information"] || data["Note"];
    if (!_rateLimitWarned) {
      console.warn(`[alphavantage] Rate limit reached: ${msg}`);
      _rateLimitWarned = true;
    }
    throw new Error(`Alpha Vantage rate limit reached (25 req/day on free tier)`);
  }

  const quote = data["Global Quote"];
  if (!quote || !quote["05. price"] || quote["05. price"] === "0.0000") {
    throw new Error(`No price data for symbol: ${symbol}`);
  }
  return parseFloat(quote["05. price"]);
}

export async function fetchQuotes(symbols) {
  _rateLimitWarned = false; // reset each fetch cycle
  const results = await Promise.allSettled(symbols.map(fetchQuote));
  const priceMap = {};
  symbols.forEach((sym, i) => {
    if (results[i].status === "fulfilled") {
      priceMap[sym] = results[i].value;
    } else {
      console.warn(`[alphavantage] ${sym}: ${results[i].reason?.message}`);
    }
  });
  return priceMap;
}
