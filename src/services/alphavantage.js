const BASE_URL = "https://www.alphavantage.co/query";
const FETCH_TIMEOUT_MS = 8000;

// The free tier allows ~25 requests/day and rejects bursts, so requests run one at
// a time with a gap between them. When AV reports its limit, further calls are
// skipped until local midnight (persisted so a reload doesn't burn more calls).
const GAP_MS = 1500;
const BLOCK_KEY = "financetracker_av_blocked_until";

let _chain = Promise.resolve();
let _lastAt = 0;

function blockedUntil() {
  try { return Number(localStorage.getItem(BLOCK_KEY)) || 0; } catch { return 0; }
}

function blockUntilMidnight() {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  try { localStorage.setItem(BLOCK_KEY, String(d.getTime())); } catch { /* ignore */ }
}

/** True when an AV key is set and today's quota hasn't been reported as used up. */
export function isAvailable() {
  return !!window.__AV_API_KEY__ && Date.now() >= blockedUntil();
}

function fetchWithTimeout(url, ms = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

async function doFetch(symbol) {
  const API_KEY = window.__AV_API_KEY__ || "";
  if (!API_KEY) throw new Error("No Alpha Vantage API key configured.");
  if (Date.now() < blockedUntil()) throw new Error("Alpha Vantage daily limit reached");

  const wait = _lastAt + GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  _lastAt = Date.now();

  const res = await fetchWithTimeout(
    `${BASE_URL}?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${API_KEY}`
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  // AV returns HTTP 200 with an "Information" or "Note" field when rate-limited
  // instead of the actual quote data.
  if (data["Information"] || data["Note"]) {
    console.warn(`[alphavantage] Rate limit reached: ${data["Information"] || data["Note"]}`);
    blockUntilMidnight();
    throw new Error("Alpha Vantage daily limit reached");
  }

  const quote = data["Global Quote"];
  if (!quote || !quote["05. price"] || quote["05. price"] === "0.0000") {
    throw new Error(`No price data for symbol: ${symbol}`);
  }
  return parseFloat(quote["05. price"]);
}

/** Fetches one price. Requests are serialized across the whole app. */
export function fetchQuote(symbol) {
  const p = _chain.then(() => doFetch(symbol));
  _chain = p.catch(() => {});
  return p;
}
