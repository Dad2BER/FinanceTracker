import { showHoldingForm } from "./holdingForm.js";
import { showConfirmDialog } from "../ui/confirmDialog.js";
import { deleteHolding } from "../../state.js";
import { formatCurrency } from "../../utils/currency.js";
import { createLoadingSpinner } from "../ui/loadingSpinner.js";
import { showStockInfo } from "./stockInfoModal.js";

/**
 * Creates a table row element for a holding.
 * @param {string} accountId
 * @param {object} holding
 * @param {object|null} prices        { symbol: price }
 * @param {object}      quoteDetails  { symbol: { dp, d } } — daily % / $ change
 * @param {boolean}     pricesLoading
 */
export function createHoldingRow(accountId, holding, prices, quoteDetails, pricesLoading) {
  const tr = document.createElement("tr");

  const isCash = holding.assetType === "cash";
  const price = isCash ? 1 : (prices ? prices[holding.symbol] : undefined);
  const value = price !== undefined ? price * holding.shares : undefined;
  const detail = (!isCash && quoteDetails) ? quoteDetails[holding.symbol] : null;

  let priceCell, valueCell;

  if (isCash) {
    priceCell = `<td class="align-right price-cell">${formatCurrency(1)}</td>`;
    valueCell = `<td class="align-right value-cell">${formatCurrency(holding.shares)}</td>`;
  } else if (pricesLoading) {
    priceCell = `<td class="align-right"><span class="loading-spinner" aria-label="Loading"></span></td>`;
    valueCell = `<td class="align-right"><span class="loading-spinner" aria-label="Loading"></span></td>`;
  } else if (price !== undefined) {
    const dpHtml = buildDpBadge(detail?.dp);
    priceCell = `<td class="align-right price-cell">${formatCurrency(price)}${dpHtml}</td>`;
    valueCell = `<td class="align-right value-cell">${formatCurrency(value)}</td>`;
  } else {
    priceCell = `<td class="align-right dim">—</td>`;
    valueCell = `<td class="align-right dim">—</td>`;
  }

  const ORIGIN_LABELS = { domestic: "Domestic", international: "International" };
  const TYPE_LABELS = {
    "stock-fund": "Stock Fund", "real-estate": "Real-estate",
    company: "Company", crypto: "Crypto", bonds: "Bonds", cash: "Cash",
  };
  const originCell = holding.origin
    ? `<td>${ORIGIN_LABELS[holding.origin] ?? escHtml(holding.origin)}</td>`
    : `<td><span class="dim">—</span></td>`;
  const typeCell = holding.assetType
    ? `<td>${TYPE_LABELS[holding.assetType] ?? escHtml(holding.assetType)}</td>`
    : `<td><span class="dim">—</span></td>`;
  const dr = (holding.dividendRate != null && holding.dividendRate > 0)
    ? holding.dividendRate
    : null;
  const dividendCell = dr !== null
    ? `<td class="align-right">${dr.toFixed(2)}%</td>`
    : `<td class="align-right dim">—</td>`;

  // Symbol cell: clickable for non-cash (opens stock info popup), plain for cash
  const symbolCellHtml = isCash
    ? `<td class="symbol-cell"><strong>${escHtml(holding.symbol)}</strong></td>`
    : `<td class="symbol-cell"><button class="symbol-link" data-action="info" title="View ${escHtml(holding.symbol)} info">${escHtml(holding.symbol)}</button></td>`;

  tr.innerHTML = `
    ${symbolCellHtml}
    <td class="align-right">${holding.shares.toLocaleString("en-US", { maximumFractionDigits: 6 })}</td>
    ${originCell}
    ${typeCell}
    ${dividendCell}
    ${priceCell}
    ${valueCell}
    <td class="actions-cell">
      <button class="icon-btn" title="Edit holding" data-action="edit">&#9998;</button>
      <button class="icon-btn icon-btn-danger" title="Delete holding" data-action="delete">&#128465;</button>
    </td>
  `;

  if (!isCash) {
    tr.querySelector("[data-action='info']").addEventListener("click", () =>
      showStockInfo(holding.symbol)
    );
  }

  tr.querySelector("[data-action='edit']").addEventListener("click", () =>
    showHoldingForm(accountId, holding)
  );

  tr.querySelector("[data-action='delete']").addEventListener("click", () =>
    showConfirmDialog({
      title: "Delete Holding",
      message: `Remove ${holding.symbol} from this account?`,
      onConfirm: () => deleteHolding(accountId, holding.id),
    })
  );

  return tr;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns an HTML string for the daily % change badge, or "" if unavailable.
 * dp > 0 → green, dp < 0 → red, dp === 0 → dim.
 */
function buildDpBadge(dp) {
  if (dp === null || dp === undefined) return "";
  const sign = dp > 0 ? "+" : "";
  const cls = dp > 0 ? "dp-up" : dp < 0 ? "dp-down" : "dp-flat";
  return ` <span class="dp-badge ${cls}">${sign}${dp.toFixed(2)}%</span>`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
