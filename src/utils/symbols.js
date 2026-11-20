// Ticker symbol helpers shared by the importer, state layer, and price services.

// Share-class tickers are written differently by every broker: Morgan Stanley
// exports HEI'A, Schwab uses BRK/B, others BRK.B or "BRK B". We store them with a
// dash (HEI-A, BRK-B).
const SHARE_CLASS = /^([A-Z]{1,6})['’\/.\s-]([A-Z]{1,2})$/;

/** Trims, uppercases, and normalizes the share-class separator to "-". */
export function normalizeSymbol(symbol) {
  const s = String(symbol ?? "").trim().toUpperCase();
  const m = SHARE_CLASS.exec(s);
  return m ? `${m[1]}-${m[2]}` : s;
}

/**
 * Symbols to try on Finnhub, in order. Finnhub writes share classes with a dot
 * (BRK.B); the dash form is tried second in case a listing uses it.
 */
export function finnhubSymbolCandidates(symbol) {
  const m = SHARE_CLASS.exec(symbol);
  return m ? [`${m[1]}.${m[2]}`, `${m[1]}-${m[2]}`] : [symbol];
}

/**
 * True for US mutual-fund tickers: five letters ending in X (FXAIX, PDBAX).
 * Money-market funds (…XX) count too; callers decide whether they're priced.
 */
export function isMutualFundTicker(symbol) {
  return /^[A-Z]{4}X$/.test(symbol);
}
