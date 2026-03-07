import { createHoldingRow } from "./holdingRow.js";
import { showHoldingForm } from "./holdingForm.js";
import { formatCurrency } from "../../utils/currency.js";
import { createLoadingSpinner } from "../ui/loadingSpinner.js";

/**
 * Renders the account detail / holdings view into `container`.
 */
export function renderHoldingList(
  container,
  account,
  prices,
  pricesLoading,
  pricesError,
  onBack,
  onRefresh,
  onUpdateKey
) {
  container.innerHTML = "";

  // Header
  const header = document.createElement("div");
  header.className = "view-header";
  header.innerHTML = `
    <div class="back-row">
      <button class="btn btn-ghost btn-sm" id="back-btn">&#8592; Back</button>
    </div>
    <div class="detail-title-row">
      <h1>${escHtml(account.name)}</h1>
      <div class="header-actions">
        <button class="btn btn-ghost btn-sm" id="refresh-btn">&#8635; Refresh Prices</button>
        <button class="btn btn-ghost btn-sm" id="update-key-btn" title="Update API key">&#128273; API Key</button>
        <button class="btn btn-primary" id="add-holding-btn">+ Add Holding</button>
      </div>
    </div>
  `;
  container.appendChild(header);

  if (pricesError) {
    const errEl = document.createElement("div");
    errEl.className = "error-banner";
    errEl.textContent = `Price fetch error: ${pricesError}`;
    container.appendChild(errEl);
  }

  if (account.holdings.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `
      <p>No holdings in this account yet.</p>
      <button class="btn btn-primary">+ Add First Holding</button>
    `;
    empty.querySelector("button").addEventListener("click", () =>
      showHoldingForm(account.id)
    );
    container.appendChild(empty);
  } else {
    // Total row
    let totalValue = null;
    if (prices !== null) {
      totalValue = account.holdings.reduce((sum, h) => {
        const p = prices[h.symbol];
        return p !== undefined ? sum + p * h.shares : sum;
      }, 0);
    }

    const totalEl = document.createElement("div");
    totalEl.className = "account-total-banner";
    if (pricesLoading) {
      totalEl.innerHTML = `<span>Total Value: </span>`;
      totalEl.querySelector("span").appendChild(createLoadingSpinner());
    } else if (totalValue !== null) {
      totalEl.innerHTML = `<span>Total Value: <strong>${formatCurrency(totalValue)}</strong></span>`;
    }
    container.appendChild(totalEl);

    // Table
    const tableWrapper = document.createElement("div");
    tableWrapper.className = "table-wrapper";
    tableWrapper.innerHTML = `
      <table class="holdings-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th class="align-right">Shares</th>
            <th>Origin</th>
            <th>Type</th>
            <th class="align-right">Price</th>
            <th class="align-right">Value</th>
            <th></th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    `;
    const tbody = tableWrapper.querySelector("tbody");
    account.holdings.forEach((holding) => {
      tbody.appendChild(createHoldingRow(account.id, holding, prices, pricesLoading));
    });
    container.appendChild(tableWrapper);
  }

  header.querySelector("#back-btn").addEventListener("click", onBack);
  header.querySelector("#refresh-btn").addEventListener("click", onRefresh);
  header.querySelector("#update-key-btn").addEventListener("click", onUpdateKey);
  header.querySelector("#add-holding-btn").addEventListener("click", () =>
    showHoldingForm(account.id)
  );
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
