const BASE_URL = "https://www.alphavantage.co/query";

export async function fetchQuote(symbol) {
  const API_KEY = window.__AV_API_KEY__ || "";
  if (!API_KEY) throw new Error("No Alpha Vantage API key configured.");
  const res = await fetch(
    `${BASE_URL}?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${API_KEY}`
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const quote = data["Global Quote"];
  if (!quote || !quote["05. price"] || quote["05. price"] === "0.0000") {
    throw new Error(`No price data for symbol: ${symbol}`);
  }
  return parseFloat(quote["05. price"]);
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
