import { showHoldingForm } from "./holdingForm.js";
import { showConfirmDialog } from "../ui/confirmDialog.js";
import { deleteHolding } from "../../state.js";
import { formatCurrency } from "../../utils/currency.js";
import { createLoadingSpinner } from "../ui/loadingSpinner.js";

/**
 * Creates a table row element for a holding.
 */
export function createHoldingRow(accountId, holding, prices, pricesLoading) {
  const tr = document.createElement("tr");

  const price = prices ? prices[holding.symbol] : undefined;
  const value = price !== undefined ? price * holding.shares : undefined;

  let priceCell, valueCell;

  if (pricesLoading) {
    priceCell = `<td class="align-right"><span class="loading-spinner" aria-label="Loading"></span></td>`;
    valueCell = `<td class="align-right"><span class="loading-spinner" aria-label="Loading"></span></td>`;
  } else if (price !== undefined) {
    priceCell = `<td class="align-right price-cell">${formatCurrency(price)}</td>`;
    valueCell = `<td class="align-right value-cell">${formatCurrency(value)}</td>`;
  } else {
    priceCell = `<td class="align-right dim">—</td>`;
    valueCell = `<td class="align-right dim">—</td>`;
  }

  tr.innerHTML = `
    <td class="symbol-cell"><strong>${escHtml(holding.symbol)}</strong></td>
    <td class="align-right">${holding.shares.toLocaleString("en-US", { maximumFractionDigits: 6 })}</td>
    ${priceCell}
    ${valueCell}
    <td class="actions-cell">
      <button class="icon-btn" title="Edit holding" data-action="edit">&#9998;</button>
      <button class="icon-btn icon-btn-danger" title="Delete holding" data-action="delete">&#128465;</button>
    </td>
  `;

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

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
