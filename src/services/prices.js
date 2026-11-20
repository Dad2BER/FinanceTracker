import { fetchQuote as fetchFinnhubQuote } from "./finnhub.js";
import { fetchQuote as fetchAvQuote, isAvailable as avAvailable } from "./alphavantage.js";
import { loadPriceCache, savePriceCache } from "./storage.js";

/**
 * Cache-first price service.
 *
 * Every price ever fetched is kept in a localStorage cache:
 *   { [symbol]: { price, fetchedAt, dp, d, finnhubMissAt? } }
 * Views show cached prices immediately (getCachedQuotes); refreshQuotes then
 * fetches only symbols whose cache is older than STALE_AFTER_MS, through
 * Finnhub's rate-limited queue, reporting each price as it arrives.
 *
 * Alpha Vantage is used only for symbols Finnhub doesn't carry (it returned no
 * price, e.g. mutual funds) — never for rate-limited or failed requests. Such
 * symbols are remembered (finnhubMissAt) and go straight to Alpha Vantage for
 * FINNHUB_MISS_TTL_MS before Finnhub is tried again.
 */
export const STALE_AFTER_MS = 30 * 60 * 1000;            // 30 minutes
const MANUAL_PROMPT_AFTER_MS = 24 * 60 * 60 * 1000;       // prompt if failing and > 24h old
const FINNHUB_MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;      // re-check Finnhub weekly

let _cache = null;
let _saveTimer = null;

function cache() {
  if (_cache === null) _cache = loadPriceCache();
  return _cache;
}

function persistSoon() {
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => { _saveTimer = null; savePriceCache(cache()); }, 1000);
}

window.addEventListener("beforeunload", () => {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; savePriceCache(cache()); }
});

function store(symbol, { price, dp = null, d = null }) {
  const c = cache();
  c[symbol] = { ...(c[symbol] || {}), price, fetchedAt: Date.now(), dp, d };
  persistSoon();
}

// ── Status (number of symbols being fetched) ─────────────────────────────────
const _inflight = new Map();   // symbol → Promise<boolean>
const _listeners = new Set();

function emitStatus() {
  const n = _inflight.size;
  _listeners.forEach((fn) => fn(n));
}

/** Subscribe to the count of symbols still being fetched. Returns an unsubscribe fn. */
export function onPriceStatus(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

export function pendingSymbolCount() {
  return _inflight.size;
}

// ── Reads ─────────────────────────────────────────────────────────────────────

/**
 * Cached prices of any age (daily-change details only from today's quotes).
 * Returns { prices: { symbol: price }, details: { symbol: { dp, d } } }.
 */
export function getCachedQuotes(symbols) {
  const c = cache();
  const prices = {};
  const details = {};
  const today = new Date().toDateString();
  for (const sym of symbols) {
    const e = c[sym];
    if (!(e?.price > 0)) continue;
    prices[sym] = e.price;
    // Daily change is only meaningful for a quote fetched today
    if (e.dp != null && new Date(e.fetchedAt).toDateString() === today) {
      details[sym] = { dp: e.dp, d: e.d };
    }
  }
  return { prices, details };
}

/** Symbols with no cached price or one older than STALE_AFTER_MS. */
export function staleSymbols(symbols, now = Date.now()) {
  const c = cache();
  return symbols.filter((s) => !(c[s]?.price > 0) || now - (c[s].fetchedAt || 0) >= STALE_AFTER_MS);
}

// ── Fetching ──────────────────────────────────────────────────────────────────

async function fetchOne(sym, onQuote) {
  const c = cache();
  if (Date.now() - (c[sym]?.finnhubMissAt || 0) >= FINNHUB_MISS_TTL_MS) {
    try {
      const r = await fetchFinnhubQuote(sym);
      if (r.status === "ok") {
        store(sym, r);
        onQuote(sym, r.price, r.dp !== null ? { dp: r.dp, d: r.d } : null);
        return true;
      }
      // Finnhub doesn't carry this symbol — remember, then try Alpha Vantage.
      c[sym] = { ...(c[sym] || {}), finnhubMissAt: Date.now() };
      persistSoon();
    } catch (e) {
      console.warn(`[finnhub] ${sym}: ${e.message}`);
      return false;
    }
  }
  if (!avAvailable()) return false;
  try {
    const price = await fetchAvQuote(sym);
    store(sym, { price });
    onQuote(sym, price, null);
    return true;
  } catch (e) {
    console.warn(`[alphavantage] ${sym}: ${e.message}`);
    return false;
  }
}

/**
 * Fetches stale symbols (or all of them with `force`). Symbols already being
 * fetched aren't requested twice. `onQuote(symbol, price, detail|null)` is called
 * as each price arrives. Resolves when all requested symbols have settled to
 *   { needsManualEntry: [{ symbol, cachedPrice, cachedAt }] }
 * — symbols that failed and have no cached price, or one more than 24h old.
 */
export async function refreshQuotes(symbols, { force = false, onQuote = () => {} } = {}) {
  const targets = force ? [...new Set(symbols)] : staleSymbols([...new Set(symbols)]);
  const waits = targets.map((sym) => {
    if (!_inflight.has(sym)) {
      const p = fetchOne(sym, onQuote).finally(() => { _inflight.delete(sym); emitStatus(); });
      _inflight.set(sym, p);
    }
    return _inflight.get(sym).then((ok) => [sym, ok]);
  });
  emitStatus();

  const results = await Promise.all(waits);
  const c = cache();
  const now = Date.now();
  const needsManualEntry = [];
  for (const [sym, ok] of results) {
    if (ok) continue;
    const e = c[sym];
    if (!(e?.price > 0)) {
      needsManualEntry.push({ symbol: sym, cachedPrice: null, cachedAt: null });
    } else if (now - (e.fetchedAt || 0) > MANUAL_PROMPT_AFTER_MS) {
      needsManualEntry.push({ symbol: sym, cachedPrice: e.price, cachedAt: e.fetchedAt });
    }
  }
  return { needsManualEntry };
}

/**
 * Saves a manually entered price to the cache, treating it as freshly fetched.
 */
export function saveManualPrice(symbol, price) {
  store(symbol, { price });
}
