import { renderSummaryCards } from "../dashboard/summaryCards.js";
import { formatCurrency } from "../../utils/currency.js";
import { createLoadingSpinner } from "../ui/loadingSpinner.js";

// ── Day-change helpers ────────────────────────────────────────────────────────

/**
 * Asset accounts: compute daily $ change directly from Finnhub quoteDetails.
 * Works immediately — no stored history required.
 * Returns null if no quoteDetails are available for any holding.
 */
function computeAssetDayChange(account, quoteDetails) {
  if (!quoteDetails || Object.keys(quoteDetails).length === 0) return null;
  let sum = 0;
  let hasAny = false;
  (account.holdings || []).forEach((h) => {
    if (h.assetType === "cash") return;
    const d = quoteDetails[h.symbol]?.d;
    if (d !== null && d !== undefined) {
      sum += h.shares * d;
      hasAny = true;
    }
  });
  return hasAny ? sum : null;
}

/**
 * Ledger accounts: daily $ change from stored valueHistory (preferred) or,
 * on the first run, the net of today's transactions.
 */
function computeLedgerDayChange(account, currentTotal) {
  if (currentTotal === null) return null;

  const today = new Date().toISOString().slice(0, 10);

  // Prefer stored history
  const history = account.valueHistory;
  if (history && history.length > 0) {
    const prev = [...history]
      .sort((a, b) => b.date.localeCompare(a.date))
      .find((e) => e.date < today);
    if (prev) return currentTotal - prev.value;
  }

  // Fallback: sum today's transactions
  const todayNet = (account.transactions || [])
    .filter((t) => t.date === today)
    .reduce((sum, t) => sum + t.amount, 0);
  return todayNet !== 0 ? todayNet : null;
}

// ── Table builder ─────────────────────────────────────────────────────────────

/**
 * Builds a table for a list of account entries.
 * Each entry is { account, total, dayChange } — dayChange is pre-computed.
 */
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
          <th class="align-right">${countLabel}</th>
          <th class="align-right">Total Value</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  `;

  const tbody = wrapper.querySelector("tbody");

  entries.forEach(({ account, total, dayChange }) => {
    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";

    // Name — with pre-computed daily change badge
    const nameCell = document.createElement("td");
    nameCell.className = "symbol-cell";
    nameCell.textContent = account.name;

    if (dayChange !== null && Math.abs(dayChange) >= 0.01) {
      const badge = document.createElement("span");
      badge.className = "day-change-badge";
      const sign = dayChange > 0 ? "+" : "-";
      badge.textContent = ` (${sign}${formatCurrency(Math.abs(dayChange))})`;
      badge.style.color = dayChange > 0 ? "var(--color-success)" : "var(--color-danger)";
      nameCell.appendChild(badge);
    }

    // Count (holdings or transactions)
    const countCell = document.createElement("td");
    countCell.className = "align-right dim";
    countCell.textContent = account.accountType === "ledger"
      ? (account.transactions?.length ?? 0)
      : account.holdings.length;

    // Total value
    const valueCell = document.createElement("td");
    if (total === null) {
      valueCell.className = "align-right";
      valueCell.appendChild(createLoadingSpinner());
    } else if (account.accountType === "ledger") {
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

    tr.append(nameCell, countCell, valueCell);
    tr.addEventListener("click", () => onSelectAccount(account.id));
    tbody.appendChild(tr);
  });

  return wrapper;
}

// ── Section title helper ──────────────────────────────────────────────────────

/**
 * Creates an <h3> section title. If dayChangeTotal is non-null and significant,
 * appends a coloured "(+$X today)" badge after the total.
 */
function buildSectionTitle(name, sum, dayChangeTotal) {
  const h3 = document.createElement("h3");
  h3.className = "section-title";
  h3.textContent = sum === null ? `${name} (loading…)` : `${name} (${formatCurrency(sum)})`;

  if (dayChangeTotal !== null && Math.abs(dayChangeTotal) >= 0.01) {
    const badge = document.createElement("span");
    badge.className = "day-change-badge";
    const sign = dayChangeTotal > 0 ? "+" : "-";
    badge.textContent = ` (${sign}${formatCurrency(Math.abs(dayChangeTotal))} today)`;
    badge.style.color = dayChangeTotal > 0 ? "var(--color-success)" : "var(--color-danger)";
    h3.appendChild(badge);
  }

  return h3;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Renders the dashboard (summary cards + split accounts tables) into `container`.
 */
export function renderAccountList(
  container,
  accounts,
  prices,
  quoteDetails,
  pricesLoading,
  pricesError,
  onSelectAccount,
  onRefresh
) {
  container.innerHTML = "";

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

    // ── Separate assets vs ledgers ────────────────────────────────────────────
    const assetAccounts  = accounts.filter((a) => a.accountType !== "ledger");
    const ledgerAccounts = accounts.filter((a) => a.accountType === "ledger");

    function computeTotal(account) {
      if (account.accountType === "ledger") {
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

    // Build entries with pre-computed dayChange per account
    function toEntries(accs, isAsset) {
      const entries = accs.map((a) => {
        const total = computeTotal(a);
        const dayChange = isAsset
          ? (pricesLoading ? null : computeAssetDayChange(a, quoteDetails))
          : computeLedgerDayChange(a, total);
        return { account: a, total, dayChange };
      });
      if (!pricesLoading && prices !== null) {
        entries.sort((a, b) => (b.total ?? -Infinity) - (a.total ?? -Infinity));
      }
      return entries;
    }

    const assetEntries  = toEntries(assetAccounts,  true);
    const ledgerEntries = toEntries(ledgerAccounts, false);

    // Section totals
    const assetSum = assetEntries.every((e) => e.total !== null)
      ? assetEntries.reduce((s, e) => s + (e.total ?? 0), 0)
      : null;
    const ledgerSum = ledgerEntries.reduce((s, e) => s + (e.total ?? 0), 0);

    // Total daily change across all asset accounts (null if nothing available)
    const assetDayChanges = assetEntries.map((e) => e.dayChange).filter((d) => d !== null);
    const assetDayTotal   = assetDayChanges.length > 0
      ? assetDayChanges.reduce((s, d) => s + d, 0)
      : null;

    // ── Split table layout ────────────────────────────────────────────────────
    const section = document.createElement("div");
    section.className = "accounts-section";

    const grid = document.createElement("div");
    grid.className = "accounts-grid";

    // Assets column — section title carries the total daily change badge
    const assetsCol = document.createElement("div");
    assetsCol.className = "accounts-col";
    assetsCol.appendChild(buildSectionTitle("Assets", assetSum, assetDayTotal));
    assetsCol.appendChild(buildAccountTable(assetEntries, "Holdings", onSelectAccount));

    // Ledgers column — no day-change total in header for ledgers
    const liabCol = document.createElement("div");
    liabCol.className = "accounts-col";
    liabCol.appendChild(buildSectionTitle("Ledgers", ledgerSum, null));
    liabCol.appendChild(buildAccountTable(ledgerEntries, "Transactions", onSelectAccount));

    grid.appendChild(assetsCol);
    grid.appendChild(liabCol);
    section.appendChild(grid);
    container.appendChild(section);
  }

  // ── Bottom action bar ─────────────────────────────────────────────────────
  const actionsBar = document.createElement("div");
  actionsBar.className = "portfolio-actions";
  actionsBar.innerHTML = `
    <button class="btn btn-ghost btn-sm" id="refresh-btn" title="Refresh prices">&#8635; Refresh Prices</button>
    <button class="btn btn-primary" id="add-account-btn">+ Add Account</button>
  `;
  container.appendChild(actionsBar);

  actionsBar.querySelector("#refresh-btn").addEventListener("click", onRefresh);
  actionsBar.querySelector("#add-account-btn").addEventListener("click", () => showAccountForm());
}
