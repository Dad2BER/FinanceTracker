const BASE_URL = "https://finnhub.io/api/v1";

export async function fetchQuote(symbol) {
  const API_KEY = window.__FINNHUB_API_KEY__ || "";
  if (!API_KEY) throw new Error("No Finnhub API key configured.");
  const res = await fetch(
    `${BASE_URL}/quote?symbol=${encodeURIComponent(symbol)}&token=${API_KEY}`
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.c === 0 && data.d === null) {
    throw new Error(`Unknown symbol: ${symbol}`);
  }
  return data.c;
}

export async function fetchQuotes(symbols) {
  const results = await Promise.allSettled(symbols.map(fetchQuote));
  const priceMap = {};
  symbols.forEach((sym, i) => {
    if (results[i].status === "fulfilled") {
      priceMap[sym] = results[i].value;
    }
  });
  return priceMap;
}
