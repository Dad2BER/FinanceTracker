import { createTaxTypeBadge } from "./taxTypeBadge.js";
import { showAccountForm } from "./accountForm.js";
import { showConfirmDialog } from "../ui/confirmDialog.js";
import { deleteAccount } from "../../state.js";
import { formatCurrency } from "../../utils/currency.js";
import { createLoadingSpinner } from "../ui/loadingSpinner.js";

/**
 * Creates an AccountCard DOM element.
 * @param {object} account
 * @param {object|null} prices  - PriceMap or null (loading)
 * @param {boolean} pricesLoading
 * @param {function} onSelect - called when card is clicked to navigate to detail
 */
export function createAccountCard(account, prices, pricesLoading, onSelect) {
  const card = document.createElement("div");
  card.className = "account-card";

  // Compute total value
  let totalValue = null;
  if (prices !== null) {
    totalValue = account.holdings.reduce((sum, h) => {
      const price = h.assetType === "cash" ? 1 : prices[h.symbol];
      return price !== undefined ? sum + price * h.shares : sum;
    }, 0);
  }

  const badge = createTaxTypeBadge(account.taxType);

  card.innerHTML = `
    <div class="account-card-header">
      <div class="account-card-title">
        <h2 class="account-name">${escHtml(account.name)}</h2>
      </div>
      <div class="account-card-actions">
        <button class="icon-btn" title="Edit account" data-action="edit">&#9998;</button>
        <button class="icon-btn icon-btn-danger" title="Delete account" data-action="delete">&#128465;</button>
      </div>
    </div>
    <div class="account-card-body">
      <div class="account-badge-row"></div>
      <div class="account-value-row">
        <span class="account-holdings-count">${account.holdings.length} holding${account.holdings.length !== 1 ? "s" : ""}</span>
        <span class="account-total-value"></span>
      </div>
    </div>
  `;

  card.querySelector(".account-badge-row").appendChild(badge);

  const valueEl = card.querySelector(".account-total-value");
  if (pricesLoading) {
    valueEl.appendChild(createLoadingSpinner());
  } else if (prices === null) {
    valueEl.textContent = "";
  } else {
    valueEl.textContent = formatCurrency(totalValue);
  }

  // Navigate to detail on card body click
  card.querySelector(".account-card-body").addEventListener("click", () =>
    onSelect(account.id)
  );
  card.querySelector(".account-name").addEventListener("click", (e) => {
    e.stopPropagation();
    onSelect(account.id);
  });

  card.querySelector("[data-action='edit']").addEventListener("click", (e) => {
    e.stopPropagation();
    showAccountForm(account);
  });

  card.querySelector("[data-action='delete']").addEventListener("click", (e) => {
    e.stopPropagation();
    showConfirmDialog({
      title: "Delete Account",
      message: `Delete "${account.name}" and all its holdings? This cannot be undone.`,
      onConfirm: () => deleteAccount(account.id),
    });
  });

  return card;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
