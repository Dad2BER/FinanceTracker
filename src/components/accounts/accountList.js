import { showAccountForm } from "./accountForm.js";
import { renderSummaryCards } from "../dashboard/summaryCards.js";
import { createTaxTypeBadge } from "./taxTypeBadge.js";
import { formatCurrency } from "../../utils/currency.js";
import { createLoadingSpinner } from "../ui/loadingSpinner.js";

// ── Helper: build one account table ──────────────────────────────────────────

function buildAccountTable(entries, countLabel, onSelectAccount) {
  const wrapper = document.createElement("div");
  wrapper.className = "table-wrapper";

  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "table-empty-state";
    empty.textContent = "None";
    wrapper.appendChild(empty);
    return wrapper;
  }

  wrapper.innerHTML = `
    <table class="holdings-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Tax Type</th>
          <th class="align-right">${countLabel}</th>
          <th class="align-right">Total Value</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  `;

  const tbody = wrapper.querySelector("tbody");

  entries.forEach(({ account, total }) => {
    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";

    // Name
    const nameCell = document.createElement("td");
    nameCell.className = "symbol-cell";
    nameCell.textContent = account.name;

    // Tax type
    const taxCell = document.createElement("td");
    taxCell.appendChild(createTaxTypeBadge(account.taxType));

    // Count (holdings or transactions)
    const countCell = document.createElement("td");
    countCell.className = "align-right dim";
    countCell.textContent = account.accountType === "liability"
      ? (account.transactions?.length ?? 0)
      : account.holdings.length;

    // Total value
    const valueCell = document.createElement("td");
    if (total === null) {
      valueCell.className = "align-right";
      valueCell.appendChild(createLoadingSpinner());
    } else if (account.accountType === "liability") {
      valueCell.className = "align-right";
      const span = document.createElement("span");
      span.style.fontWeight = "600";
      if (total > 0) {
        span.style.color = "var(--color-success)";
        span.textContent = formatCurrency(total);
      } else if (total < 0) {
        span.style.color = "var(--color-danger)";
        span.textContent = `-${formatCurrency(Math.abs(total))}`;
      } else {
        span.textContent = formatCurrency(0);
      }
      valueCell.appendChild(span);
    } else {
      valueCell.className = "align-right value-cell";
      valueCell.textContent = formatCurrency(total);
    }

    tr.append(nameCell, taxCell, countCell, valueCell);
    tr.addEventListener("click", () => onSelectAccount(account.id));
    tbody.appendChild(tr);
  });

  return wrapper;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Renders the dashboard (summary cards + split accounts tables) into `container`.
 */
export function renderAccountList(
  container,
  accounts,
  prices,
  pricesLoading,
  pricesError,
  onSelectAccount,
  onRefresh,
  onUpdateKey,
  onSettings
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
        <button class="btn btn-ghost btn-sm" id="settings-btn" title="Settings">&#9881; Settings</button>
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
    // ── Summary Cards ────────────────────────────────────────────────────────
    const cardsSection = document.createElement("div");
    renderSummaryCards(cardsSection, accounts, prices, pricesLoading);
    container.appendChild(cardsSection);

    // ── Separate assets vs liabilities ───────────────────────────────────────
    const assetAccounts = accounts.filter((a) => a.accountType !== "liability");
    const liabilityAccounts = accounts.filter((a) => a.accountType === "liability");

    function computeTotal(account) {
      if (account.accountType === "liability") {
        return (account.openingBalance || 0) +
          (account.transactions || []).reduce((sum, t) => sum + t.amount, 0);
      }
      return (pricesLoading || prices === null)
        ? null
        : account.holdings.reduce((sum, h) => {
            const p = h.assetType === "cash" ? 1 : prices[h.symbol];
            return p !== undefined ? sum + p * h.shares : sum;
          }, 0);
    }

    function toEntries(accs) {
      const entries = accs.map((a) => ({ account: a, total: computeTotal(a) }));
      if (!pricesLoading && prices !== null) {
        entries.sort((a, b) => (b.total ?? -Infinity) - (a.total ?? -Infinity));
      }
      return entries;
    }

    // ── Split table layout ────────────────────────────────────────────────────
    const section = document.createElement("div");
    section.className = "accounts-section";

    const grid = document.createElement("div");
    grid.className = "accounts-grid";

    // Assets column
    const assetsCol = document.createElement("div");
    assetsCol.className = "accounts-col";
    const assetsTitle = document.createElement("h3");
    assetsTitle.className = "section-title";
    assetsTitle.textContent = "Assets";
    assetsCol.appendChild(assetsTitle);
    assetsCol.appendChild(buildAccountTable(toEntries(assetAccounts), "Holdings", onSelectAccount));

    // Liabilities column
    const liabCol = document.createElement("div");
    liabCol.className = "accounts-col";
    const liabTitle = document.createElement("h3");
    liabTitle.className = "section-title";
    liabTitle.textContent = "Liabilities";
    liabCol.appendChild(liabTitle);
    liabCol.appendChild(buildAccountTable(toEntries(liabilityAccounts), "Transactions", onSelectAccount));

    grid.appendChild(assetsCol);
    grid.appendChild(liabCol);
    section.appendChild(grid);
    container.appendChild(section);
  }

  header.querySelector("#add-account-btn").addEventListener("click", () => showAccountForm());
  header.querySelector("#refresh-btn").addEventListener("click", onRefresh);
  header.querySelector("#update-key-btn").addEventListener("click", onUpdateKey);
  if (onSettings) header.querySelector("#settings-btn").addEventListener("click", onSettings);
}
