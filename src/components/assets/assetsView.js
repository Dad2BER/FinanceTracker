import { showStockInfo } from "../holdings/stockInfoModal.js";
import { formatCurrency } from "../../utils/currency.js";
import { createLoadingSpinner } from "../ui/loadingSpinner.js";
import { attachTableFilter } from "../../utils/tableFilter.js";

// ── Label maps ────────────────────────────────────────────────────────────────
const ORIGIN_LABELS = { domestic: "Domestic", international: "International" };
const TYPE_LABELS = {
  "stock-fund": "Stock Fund", "real-estate": "Real-estate",
  company: "Company", crypto: "Crypto", bonds: "Bonds", cash: "Cash",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildDpBadge(dp) {
  if (dp === null || dp === undefined) return "";
  const sign = dp > 0 ? "+" : "";
  const cls = dp > 0 ? "dp-up" : dp < 0 ? "dp-down" : "dp-flat";
  return ` <span class="dp-badge ${cls}">${sign}${dp.toFixed(2)}%</span>`;
}

// ── Aggregate builder ─────────────────────────────────────────────────────────

/**
 * Walks all asset accounts and returns a Map keyed by symbol.
 * Each entry tracks total shares and the set of origins/types seen,
 * so we can show a unified value or "—" when accounts disagree.
 */
function aggregateHoldings(accounts) {
  const map = new Map();
  const assetAccounts = accounts.filter((a) => a.accountType !== "ledger");

  assetAccounts.forEach((account) => {
    (account.holdings || []).forEach((h) => {
      if (map.has(h.symbol)) {
        const e = map.get(h.symbol);
        e.shares += h.shares;
        if (h.origin)    e.origins.add(h.origin);
        if (h.assetType) e.types.add(h.assetType);
      } else {
        map.set(h.symbol, {
          symbol:   h.symbol,
          shares:   h.shares,
          isCash:   h.assetType === "cash",
          origins:  new Set(h.origin    ? [h.origin]    : []),
          types:    new Set(h.assetType ? [h.assetType] : []),
        });
      }
    });
  });

  return map;
}

// ── Row builder ───────────────────────────────────────────────────────────────

function buildRow(entry, prices, quoteDetails, pricesLoading) {
  const { symbol, shares, isCash } = entry;
  const tr = document.createElement("tr");

  const price  = isCash ? 1 : (prices ? prices[symbol] : undefined);
  const value  = price !== undefined ? price * shares : undefined;
  const detail = (!isCash && quoteDetails) ? quoteDetails[symbol] : null;

  // Origin: single value or "—" when accounts disagree
  const originArr = [...entry.origins];
  const originTxt = originArr.length === 1
    ? (ORIGIN_LABELS[originArr[0]] ?? escHtml(originArr[0]))
    : null;

  // Type: single value or "—" when accounts disagree
  const typeArr = [...entry.types];
  const typeTxt = typeArr.length === 1
    ? (TYPE_LABELS[typeArr[0]] ?? escHtml(typeArr[0]))
    : null;

  // Price / value cells
  let priceCell, valueCell;
  if (isCash) {
    priceCell = `<td class="align-right price-cell">${formatCurrency(1)}</td>`;
    valueCell = `<td class="align-right value-cell">${formatCurrency(shares)}</td>`;
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

  // Symbol cell: clickable for non-cash
  const symbolCell = isCash
    ? `<td class="symbol-cell"><strong>${escHtml(symbol)}</strong></td>`
    : `<td class="symbol-cell"><button class="symbol-link" data-action="info" title="View ${escHtml(symbol)} info">${escHtml(symbol)}</button></td>`;

  tr.innerHTML = `
    ${symbolCell}
    <td class="align-right">${shares.toLocaleString("en-US", { maximumFractionDigits: 6 })}</td>
    <td>${originTxt ? originTxt : '<span class="dim">—</span>'}</td>
    <td>${typeTxt   ? typeTxt   : '<span class="dim">—</span>'}</td>
    ${priceCell}
    ${valueCell}
  `;

  if (!isCash) {
    tr.querySelector("[data-action='info']")?.addEventListener("click", () =>
      showStockInfo(symbol)
    );
  }

  return tr;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Renders a consolidated view of all holdings across every asset account.
 * Holdings with the same symbol are merged into one row with summed shares.
 */
export function renderAssetsView(
  container,
  accounts,
  prices,
  quoteDetails,
  pricesLoading,
  pricesError
) {
  container.innerHTML = "";

  if (pricesError) {
    const errEl = document.createElement("div");
    errEl.className = "error-banner";
    errEl.textContent = `Price fetch error: ${pricesError}`;
    container.appendChild(errEl);
  }

  const symbolMap = aggregateHoldings(accounts);

  if (symbolMap.size === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `<p>No assets found. Add holdings to your asset accounts on the Portfolio page.</p>`;
    container.appendChild(empty);
    return;
  }

  // Sort: non-cash first (by value desc when prices are available), cash at bottom
  const entries = [...symbolMap.values()].sort((a, b) => {
    if (a.isCash !== b.isCash) return a.isCash ? 1 : -1;
    if (!pricesLoading && prices !== null) {
      const aVal = (a.isCash ? 1 : (prices[a.symbol] ?? 0)) * a.shares;
      const bVal = (b.isCash ? 1 : (prices[b.symbol] ?? 0)) * b.shares;
      return bVal - aVal;
    }
    return 0;
  });

  // ── Total value + day change banner ─────────────────────────────────────────
  let totalValue = null;
  let totalDayChange = null;

  if (!pricesLoading && prices !== null) {
    totalValue = 0;
    entries.forEach((e) => {
      const p = e.isCash ? 1 : prices[e.symbol];
      if (p !== undefined) totalValue += p * e.shares;
    });

    if (quoteDetails && Object.keys(quoteDetails).length > 0) {
      let sum = 0, hasAny = false;
      entries.forEach((e) => {
        if (e.isCash) return;
        const d = quoteDetails[e.symbol]?.d;
        if (d !== undefined && d !== null) { sum += e.shares * d; hasAny = true; }
      });
      if (hasAny) totalDayChange = sum;
    }
  }

  const totalEl = document.createElement("div");
  totalEl.className = "account-total-banner";
  if (pricesLoading) {
    totalEl.innerHTML = `<span>Total Value: </span>`;
    totalEl.querySelector("span").appendChild(createLoadingSpinner());
  } else if (totalValue !== null) {
    let dayChangeHtml = "";
    if (totalDayChange !== null && Math.abs(totalDayChange) >= 0.01) {
      const sign  = totalDayChange > 0 ? "+" : "-";
      const color = totalDayChange > 0 ? "var(--color-success)" : "var(--color-danger)";
      dayChangeHtml = ` <span class="total-day-change" style="color:${color}">(${sign}${formatCurrency(Math.abs(totalDayChange))} today)</span>`;
    }
    totalEl.innerHTML = `<span>Total Value: <strong>${formatCurrency(totalValue)}</strong>${dayChangeHtml}</span>`;
  }
  container.appendChild(totalEl);

  // ── Table ───────────────────────────────────────────────────────────────────
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
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  `;

  const tbody = tableWrapper.querySelector("tbody");
  entries.forEach((entry) => {
    tbody.appendChild(buildRow(entry, prices, quoteDetails, pricesLoading));
  });

  // Columns: Symbol, Shares, Origin, Type, Price, Value
  attachTableFilter(
    tableWrapper.querySelector("table"),
    [true, false, true, true, false, false]
  );

  // ── Visible-row value sum in the filter row's Value cell ─────────────────────
  // The filter row's last <th> (Value column, index 5) is an empty cell — we
  // display the running sum of visible rows there.  It starts equal to Total
  // Value and updates live as the user types in any filter.
  const filterRow = tableWrapper.querySelector(".filter-row");
  const valueTh   = filterRow?.querySelectorAll("th")[5] ?? null;
  const sumEl     = valueTh ? document.createElement("span") : null;
  if (sumEl) {
    sumEl.className = "filter-col-sum";
    valueTh.appendChild(sumEl);
  }

  function updateVisibleSum() {
    if (!sumEl) return;
    let sum = 0;
    tableWrapper.querySelectorAll("tbody tr").forEach((row) => {
      if (row.style.display === "none") return;
      // Value cell is the 6th td (index 5); text is formatted currency or "—"
      const text = (row.querySelectorAll("td")[5]?.textContent ?? "").trim();
      const num  = parseFloat(text.replace(/[$,]/g, ""));
      if (!isNaN(num)) sum += num;
    });
    sumEl.textContent = formatCurrency(sum);
  }

  // Set initial sum (all rows visible)
  updateVisibleSum();

  // filterRow's applyFilters listener fires first (registered on filterRow);
  // our listener is on the table so it fires afterwards via event bubbling.
  tableWrapper.querySelector("table").addEventListener("input",  updateVisibleSum);
  tableWrapper.querySelector("table").addEventListener("change", updateVisibleSum);

  container.appendChild(tableWrapper);
}
