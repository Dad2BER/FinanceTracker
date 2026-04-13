import { createHoldingRow } from "./holdingRow.js";
import { showHoldingForm } from "./holdingForm.js";
import { showHoldingImportModal } from "./holdingImport.js";
import { showAccountForm } from "../accounts/accountForm.js";
import { createTaxTypeBadge } from "../accounts/taxTypeBadge.js";
import { formatCurrency } from "../../utils/currency.js";
import { createLoadingSpinner } from "../ui/loadingSpinner.js";
import { deleteAccount } from "../../state.js";
import { showConfirmDialog } from "../ui/confirmDialog.js";
import { attachTableFilter } from "../../utils/tableFilter.js";

/**
 * Renders the account detail / holdings view into `container`.
 */
export function renderHoldingList(
  container,
  account,
  prices,
  quoteDetails,
  pricesLoading,
  pricesError,
  onBack,
  onRefresh
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
      <div>
        <h1>${escHtml(account.name)}</h1>
        <div id="account-tax-badge"></div>
      </div>
      <div class="header-actions">
        <button class="btn btn-ghost btn-sm" id="edit-account-btn" title="Edit account">&#9881; Edit</button>
        <button class="btn btn-ghost btn-sm btn-danger" id="delete-account-btn" title="Delete account">&#128465; Delete</button>
        <button class="btn btn-ghost btn-sm" id="refresh-btn">&#8635; Refresh Prices</button>
        ${account.accountType === "asset" ? `<button class="btn btn-ghost btn-sm" id="import-holdings-btn">&#8679; Import</button>` : ""}
        <button class="btn btn-primary" id="add-holding-btn">+ Add Holding</button>
      </div>
    </div>
  `;
  container.appendChild(header);
  header.querySelector("#account-tax-badge").appendChild(createTaxTypeBadge(account.taxType));

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
        const p = h.assetType === "cash" ? 1 : prices[h.symbol];
        return p !== undefined ? sum + p * h.shares : sum;
      }, 0);
    }

    // Total daily change: sum of (shares × daily $ change) for holdings with Finnhub data
    let totalDayChange = null;
    if (!pricesLoading && quoteDetails && Object.keys(quoteDetails).length > 0) {
      let sum = 0;
      let hasAny = false;
      account.holdings.forEach((h) => {
        if (h.assetType === "cash") return;
        const d = quoteDetails[h.symbol]?.d;
        if (d !== undefined && d !== null) {
          sum += h.shares * d;
          hasAny = true;
        }
      });
      if (hasAny) totalDayChange = sum;
    }

    // Est. Annual Income: cash (non-reinvested) + DRIP (reinvested) totals
    let annualIncome = null, dripIncome = null;
    {
      let cashSum = 0, hasCash = false, dripSum = 0, hasDrip = false;
      account.holdings.forEach((h) => {
        if (!h.dividendPerShare || h.dividendPerShare <= 0) return;
        const amt = h.shares * h.dividendPerShare;
        if (h.dividendReinvested) { dripSum += amt; hasDrip = true; }
        else                       { cashSum += amt; hasCash = true; }
      });
      if (hasCash) annualIncome = cashSum;
      if (hasDrip) dripIncome  = dripSum;
    }

    const totalEl = document.createElement("div");
    totalEl.className = "account-total-banner";
    if (pricesLoading) {
      totalEl.innerHTML = `<span>Total Value: </span>`;
      totalEl.querySelector("span").appendChild(createLoadingSpinner());
    } else if (totalValue !== null) {
      let dayChangeHtml = "";
      if (totalDayChange !== null && Math.abs(totalDayChange) >= 0.01) {
        const sign = totalDayChange > 0 ? "+" : "-";
        const color = totalDayChange > 0 ? "var(--color-success)" : "var(--color-danger)";
        dayChangeHtml = ` <span class="total-day-change" style="color:${color}">(${sign}${formatCurrency(Math.abs(totalDayChange))} today)</span>`;
      }
      const dripHtml = dripIncome !== null
        ? ` <span class="dim">(+${formatCurrency(dripIncome)} DRIP)</span>` : "";
      const incomeHtml = annualIncome !== null
        ? `<strong>${formatCurrency(annualIncome)}</strong>${dripHtml}`
        : dripIncome !== null
          ? `<span class="dim">—</span>${dripHtml}`
          : `<span class="dim">—</span>`;
      totalEl.innerHTML = `
        <span>Total Value: <strong>${formatCurrency(totalValue)}</strong>${dayChangeHtml}</span>
        <span class="income-stat">Est. Annual Income: ${incomeHtml}</span>
      `;
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
            <th class="align-right">Dividend</th>
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
      tbody.appendChild(createHoldingRow(account.id, holding, prices, quoteDetails, pricesLoading));
    });
    // Columns: Symbol, Shares, Origin, Type, Dividend, Price, Value, Actions
    attachTableFilter(
      tableWrapper.querySelector("table"),
      [true, false, true, true, false, false, false, false],
      {},
      container
    );

    container.appendChild(tableWrapper);
  }

  header.querySelector("#back-btn").addEventListener("click", onBack);
  header.querySelector("#edit-account-btn").addEventListener("click", () => showAccountForm(account));
  header.querySelector("#delete-account-btn").addEventListener("click", () => {
    showConfirmDialog({
      title: "Delete Account",
      message: `Delete "${account.name}" and all its holdings? This cannot be undone.`,
      onConfirm: () => { deleteAccount(account.id); onBack(); },
    });
  });
  header.querySelector("#refresh-btn").addEventListener("click", onRefresh);
  const importBtn = header.querySelector("#import-holdings-btn");
  if (importBtn) importBtn.addEventListener("click", () => showHoldingImportModal(account));
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
