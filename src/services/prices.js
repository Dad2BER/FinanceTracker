import { fetchQuotes as fetchFinnhubQuotes } from "./finnhub.js";
import { fetchQuotes as fetchAvQuotes } from "./alphavantage.js";
import { loadPriceCache, savePriceCache } from "./storage.js";

const STALE_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Fetches prices for all symbols with multi-layer fallback:
 *
 *  1. Finnhub (primary) — fetched in parallel with an 8s timeout per symbol
 *  2. Alpha Vantage (fallback for symbols Finnhub missed, e.g. mutual funds)
 *  3. Cached last-known price (used when both APIs fail or return zero)
 *
 * Returns { prices, needsManualEntry } where:
 *  - prices: { symbol: price } — best available price for each symbol
 *  - needsManualEntry: array of { symbol, cachedPrice, cachedAt } for symbols
 *    where both APIs failed AND there is no cache or the cache is > 24h old
 *
 * Successfully fetched prices are always written back to the cache.
 */
export async function fetchQuotes(symbols) {
  const cache = loadPriceCache();
  const now = Date.now();

  // ── Step 1: Finnhub ───────────────────────────────────────────────────────
  const { priceMap: finnhubPrices, detailsMap: quoteDetails } = await fetchFinnhubQuotes(symbols);

  // ── Step 2: Alpha Vantage for anything Finnhub missed ─────────────────────
  let merged = { ...finnhubPrices };
  if (window.__AV_API_KEY__) {
    const missing = symbols.filter((s) => merged[s] === undefined);
    if (missing.length > 0) {
      const avPrices = await fetchAvQuotes(missing);
      merged = { ...merged, ...avPrices };
    }
  }

  // ── Step 3: Build result — cache fallback, flag stale/missing for manual entry
  const result = {};
  const updatedCache = { ...cache };
  const needsManualEntry = [];

  for (const sym of symbols) {
    const fresh = merged[sym];
    if (fresh !== undefined && fresh > 0) {
      // Good fresh price — use it and update the cache
      result[sym] = fresh;
      updatedCache[sym] = { price: fresh, fetchedAt: now };
    } else if (cache[sym]?.price > 0) {
      const age = now - (cache[sym].fetchedAt || 0);
      // Always use the cached price (better than blank)
      result[sym] = cache[sym].price;
      if (age > STALE_MS) {
        // Cache is stale — show value but prompt user to confirm/update it
        console.warn(
          `[prices] ${sym}: cache is ${Math.round(age / 3_600_000)}h old; prompting for manual entry`
        );
        needsManualEntry.push({
          symbol: sym,
          cachedPrice: cache[sym].price,
          cachedAt: cache[sym].fetchedAt,
        });
      } else {
        console.warn(
          `[prices] ${sym}: API returned no valid price; using cached ` +
          `$${cache[sym].price} (${Math.round(age / 60_000)}m old)`
        );
      }
    } else {
      // No price at all — must prompt user
      needsManualEntry.push({ symbol: sym, cachedPrice: null, cachedAt: null });
    }
  }

  savePriceCache(updatedCache);
  // quoteDetails: { symbol: { dp, d } } — daily % and $ change, Finnhub only
  return { prices: result, needsManualEntry, quoteDetails };
}

/**
 * Saves a manually entered price to the cache, treating it as freshly
 * fetched so it won't trigger the manual-entry prompt for 24 hours.
 */
export function saveManualPrice(symbol, price) {
  const cache = loadPriceCache();
  cache[symbol] = { price, fetchedAt: Date.now() };
  savePriceCache(cache);
}
