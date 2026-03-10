import { fetchQuotes as fetchFinnhubQuotes } from "./finnhub.js";
import { fetchQuotes as fetchAvQuotes } from "./alphavantage.js";
import { loadPriceCache, savePriceCache } from "./storage.js";

/**
 * Fetches prices for all symbols with multi-layer fallback:
 *
 *  1. Finnhub (primary) — fetched in parallel with an 8s timeout per symbol
 *  2. Alpha Vantage (fallback for symbols Finnhub missed, e.g. mutual funds)
 *  3. Cached last-known price (used when both APIs fail or return zero)
 *
 * Successfully fetched prices are always written back to the cache so the
 * next fetch has a good fallback value ready.
 */
export async function fetchQuotes(symbols) {
  const cache = loadPriceCache();

  // ── Step 1: Finnhub ───────────────────────────────────────────────────────
  const freshPrices = await fetchFinnhubQuotes(symbols);

  // ── Step 2: Alpha Vantage for anything Finnhub missed ─────────────────────
  let merged = { ...freshPrices };
  if (window.__AV_API_KEY__) {
    const missing = symbols.filter((s) => merged[s] === undefined);
    if (missing.length > 0) {
      const avPrices = await fetchAvQuotes(missing);
      merged = { ...merged, ...avPrices };
    }
  }

  // ── Step 3: Build result — use cache for any symbol still missing/zero ─────
  const result = {};
  const updatedCache = { ...cache };

  for (const sym of symbols) {
    const fresh = merged[sym];
    if (fresh !== undefined && fresh > 0) {
      // Good fresh price — use it and update the cache
      result[sym] = fresh;
      updatedCache[sym] = { price: fresh, fetchedAt: Date.now() };
    } else if (cache[sym]?.price > 0) {
      // API failed, timed out, or returned zero — fall back to last known price
      console.warn(
        `[prices] ${sym}: API returned no valid price; using cached $${cache[sym].price} ` +
        `(fetched ${new Date(cache[sym].fetchedAt).toLocaleString()})`
      );
      result[sym] = cache[sym].price;
      // Don't update fetchedAt — the cached timestamp stays truthful
    }
    // If neither source has a price this symbol genuinely has no data yet
  }

  savePriceCache(updatedCache);
  return result;
}
