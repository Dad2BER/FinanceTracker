import { showAccountForm } from "./accountForm.js";
import { renderSummaryCards } from "../dashboard/summaryCards.js";
import { createTaxTypeBadge } from "./taxTypeBadge.js";
import { formatCurrency } from "../../utils/currency.js";
import { createLoadingSpinner } from "../ui/loadingSpinner.js";

/**
 * Renders the dashboard (summary cards + accounts table) into `container`.
 */
export function renderAccountList(
  container,
  accounts,
  prices,
  pricesLoading,
  pricesError,
  onSelectAccount,
  onRefresh,
  onUpdateKey
) {
  container.innerHTML = "";

  // ── Header ──────────────────────────────────────────────────────────────────
  const header = document.createElement("div");
  header.className = "view-header";
  header.innerHTML = `
    <div class="detail-title-row">
      <h1>My Portfolio</h1>
      <div class="header-actions">
        <button class="btn btn-ghost btn-sm" id="refresh-btn" title="Refresh prices">&#8635; Refresh Prices</button>
        <button class="btn btn-ghost btn-sm" id="update-key-btn" title="Update API key">&#128273; API Key</button>
        <button class="btn btn-primary" id="add-account-btn">+ Add Account</button>
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

  if (accounts.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `<p>No accounts yet.</p><button class="btn btn-primary">+ Add Your First Account</button>`;
    empty.querySelector("button").addEventListener("click", () => showAccountForm());
    container.appendChild(empty);
  } else {
    // ── Summary Cards ──────────────────────────────────────────────────────────
    const cardsSection = document.createElement("div");
    renderSummaryCards(cardsSection, accounts, prices, pricesLoading);
    container.appendChild(cardsSection);

    // ── Accounts Table ─────────────────────────────────────────────────────────
    const section = document.createElement("div");
    section.className = "accounts-section";

    const sectionTitle = document.createElement("h3");
    sectionTitle.className = "section-title";
    sectionTitle.textContent = "Accounts";
    section.appendChild(sectionTitle);

    const tableWrapper = document.createElement("div");
    tableWrapper.className = "table-wrapper";
    tableWrapper.innerHTML = `
      <table class="holdings-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Tax Type</th>
            <th class="align-right">Holdings</th>
            <th class="align-right">Total Value</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    `;

    const tbody = tableWrapper.querySelector("tbody");

    // Compute totals and sort by value descending (unpriced accounts go last)
    const withTotals = accounts.map((account) => {
      const total = (pricesLoading || prices === null)
        ? null
        : account.holdings.reduce((sum, h) => {
            const p = h.assetType === "cash" ? 1 : prices[h.symbol];
            return p !== undefined ? sum + p * h.shares : sum;
          }, 0);
      return { account, total };
    });
    if (!pricesLoading && prices !== null) {
      withTotals.sort((a, b) => b.total - a.total);
    }

    withTotals.forEach(({ account, total }) => {
      const tr = document.createElement("tr");
      tr.style.cursor = "pointer";

      // Total value for this account
      let valueCell;
      if (total === null) {
        valueCell = document.createElement("td");
        valueCell.className = "align-right";
        valueCell.appendChild(createLoadingSpinner());
      } else {
        valueCell = document.createElement("td");
        valueCell.className = "align-right value-cell";
        valueCell.textContent = formatCurrency(total);
      }

      // Name cell
      const nameCell = document.createElement("td");
      nameCell.className = "symbol-cell";
      nameCell.textContent = account.name;

      // Account type cell (Asset / Liability)
      const accountTypeCell = document.createElement("td");
      const accountTypeLabel = account.accountType === "liability" ? "Liability" : "Asset";
      accountTypeCell.textContent = accountTypeLabel;
      accountTypeCell.className = account.accountType === "liability" ? "dim" : "";

      // Tax type cell with badge
      const taxCell = document.createElement("td");
      taxCell.appendChild(createTaxTypeBadge(account.taxType));

      // Holdings count cell
      const countCell = document.createElement("td");
      countCell.className = "align-right dim";
      countCell.textContent = account.holdings.length;

      tr.appendChild(nameCell);
      tr.appendChild(accountTypeCell);
      tr.appendChild(taxCell);
      tr.appendChild(countCell);
      tr.appendChild(valueCell);

      tr.addEventListener("click", () => onSelectAccount(account.id));
      tbody.appendChild(tr);
    });

    section.appendChild(tableWrapper);
    container.appendChild(section);
  }

  header.querySelector("#add-account-btn").addEventListener("click", () => showAccountForm());
  header.querySelector("#refresh-btn").addEventListener("click", onRefresh);
  header.querySelector("#update-key-btn").addEventListener("click", onUpdateKey);
}
