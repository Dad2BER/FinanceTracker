import { Modal } from "../ui/modal.js";
import { fetchProfile, fetchQuoteDetail } from "../../services/finnhub.js";
import { formatCurrency } from "../../utils/currency.js";
import { createLoadingSpinner } from "../ui/loadingSpinner.js";

/**
 * Opens a modal showing live stock/ETF info for `symbol` fetched from Finnhub.
 * For cash holdings, this should not be called.
 */
export function showStockInfo(symbol) {
  const content = document.createElement("div");
  content.className = "stock-info-modal";

  // Header — visible immediately while data loads
  const heading = document.createElement("div");
  heading.className = "stock-info-header";
  heading.innerHTML = `<h2 class="stock-info-symbol">${escHtml(symbol)}</h2>`;
  content.appendChild(heading);

  const body = document.createElement("div");
  body.className = "stock-info-body";
  body.appendChild(createLoadingSpinner());
  content.appendChild(body);

  Modal.open(content, null, { wide: true });

  // Fetch profile and full quote in parallel
  Promise.all([fetchProfile(symbol), fetchQuoteDetail(symbol)])
    .then(([profile, quote]) => {
      renderData(body, symbol, profile, quote);
    })
    .catch((err) => {
      body.innerHTML = `<p class="stock-info-error">Could not load data for <strong>${escHtml(symbol)}</strong>: ${escHtml(err.message)}</p>`;
    });
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderData(body, symbol, profile, quote) {
  const change = quote.d ?? 0;
  const changePct = quote.dp ?? 0;
  const isUp = change >= 0;
  const changeClass = isUp ? "stock-change-up" : "stock-change-down";
  const changeSign = isUp ? "+" : "";

  const name = profile.name || symbol;
  const logoHtml = profile.logo
    ? `<img class="stock-info-logo" src="${escHtml(profile.logo)}" alt="${escHtml(name)} logo" />`
    : "";

  const tags = [
    profile.exchange,
    profile.finnhubIndustry,
    profile.country,
  ]
    .filter(Boolean)
    .map((t) => `<span class="stock-tag">${escHtml(t)}</span>`)
    .join("");

  const weburlDisplay = profile.weburl
    ? profile.weburl.replace(/^https?:\/\//, "").replace(/\/$/, "")
    : "";
  const webLinkHtml = profile.weburl
    ? `<a class="stock-info-link" href="${escHtml(profile.weburl)}" target="_blank" rel="noopener">&#127760; ${escHtml(weburlDisplay)}</a>`
    : "";

  const marketCap = profile.marketCapitalization
    ? formatMarketCap(profile.marketCapitalization * 1_000_000)
    : "—";

  body.innerHTML = `
    <div class="stock-info-profile">
      ${logoHtml}
      <div class="stock-info-meta">
        <div class="stock-info-name">${escHtml(name)}</div>
        ${tags ? `<div class="stock-info-tags">${tags}</div>` : ""}
        ${webLinkHtml}
      </div>
    </div>

    <div class="stock-info-price-row">
      <span class="stock-info-current">${formatCurrency(quote.c)}</span>
      <span class="stock-info-change ${changeClass}">
        ${changeSign}${formatCurrency(Math.abs(change))}
        (${changeSign}${changePct.toFixed(2)}%)
      </span>
    </div>

    <div class="stock-info-grid">
      <div class="stock-info-stat">
        <span class="stat-label">Open</span>
        <span class="stat-value">${formatCurrency(quote.o)}</span>
      </div>
      <div class="stock-info-stat">
        <span class="stat-label">High</span>
        <span class="stat-value">${formatCurrency(quote.h)}</span>
      </div>
      <div class="stock-info-stat">
        <span class="stat-label">Low</span>
        <span class="stat-value">${formatCurrency(quote.l)}</span>
      </div>
      <div class="stock-info-stat">
        <span class="stat-label">Prev Close</span>
        <span class="stat-value">${formatCurrency(quote.pc)}</span>
      </div>
      <div class="stock-info-stat">
        <span class="stat-label">Market Cap</span>
        <span class="stat-value">${marketCap}</span>
      </div>
      <div class="stock-info-stat">
        <span class="stat-label">Currency</span>
        <span class="stat-value">${escHtml(profile.currency || "—")}</span>
      </div>
    </div>

    <div class="stock-info-footer">
      <a class="stock-info-attribution" href="https://finnhub.io" target="_blank" rel="noopener">
        Data provided by Finnhub
      </a>
    </div>
  `;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatMarketCap(val) {
  if (val >= 1e12) return `$${(val / 1e12).toFixed(2)}T`;
  if (val >= 1e9)  return `$${(val / 1e9).toFixed(2)}B`;
  if (val >= 1e6)  return `$${(val / 1e6).toFixed(2)}M`;
  return `$${val.toLocaleString()}`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
