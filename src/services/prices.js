import { fetchQuotes as fetchFinnhubQuotes } from "./finnhub.js";
import { fetchQuotes as fetchAvQuotes } from "./alphavantage.js";

/**
 * Fetches prices for all symbols.
 * Tries Finnhub first; any symbols without a price are retried via Alpha Vantage.
 */
export async function fetchQuotes(symbols) {
  const prices = await fetchFinnhubQuotes(symbols);

  if (!window.__AV_API_KEY__) return prices;

  const missing = symbols.filter((s) => prices[s] === undefined);
  if (missing.length === 0) return prices;

  const avPrices = await fetchAvQuotes(missing);
  return { ...prices, ...avPrices };
}
