import { formatCurrency } from "../../utils/currency.js";
import { createLoadingSpinner } from "../ui/loadingSpinner.js";
import { attachTableFilter } from "../../utils/tableFilter.js";
import { Modal } from "../ui/modal.js";
import { updateDividendBySymbol } from "../../state.js";
import { createPieChart } from "../dashboard/pieChart.js";

// ── Label maps ────────────────────────────────────────────────────────────────
const ORIGIN_LABELS = { domestic: "Domestic", international: "International" };

const ASSET_CLASS_LABELS = {
  equity:        "Equity",
  bonds:         "Bonds",
  "real-estate": "Real Estate",
  crypto:        "Crypto",
  cash:          "Cash",
};

const INSTRUMENT_LABELS = {
  etf:            "ETF",
  fund:           "Fund",
  stock:          "Stock",
  cash:           "Cash",
  "money-market": "Money Market",
};

// ── Pie chart meta (label + color) ──────────────────────────────────────────────
const TAX_TYPE_META = {
  "Taxable":      { label: "Taxable",      color: "#3b82f6" },
  "Tax-Free":     { label: "Tax-Free",     color: "#22c55e" },
  "Tax-Deferred": { label: "Tax-Deferred", color: "#f59e0b" },
};

const ORIGIN_META = {
  domestic:      { label: "Domestic",      color: "#3b82f6" },
  international: { label: "International", color: "#f59e0b" },
};

const ASSET_CLASS_META = {
  equity:        { label: "Equity",       color: "#6366f1" },
  bonds:         { label: "Bonds",        color: "#22c55e" },
  "real-estate": { label: "Real Estate",  color: "#f59e0b" },
  crypto:        { label: "Crypto",       color: "#f97316" },
  cash:          { label: "Cash",         color: "#64748b" },
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
function addShares(map, key, shares) {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + shares);
}

function aggregateHoldings(accounts) {
  const map = new Map();
  const assetAccounts = accounts.filter((a) => a.accountType !== "ledger");

  assetAccounts.forEach((account) => {
    const taxType = account.taxType;
    (account.holdings || []).forEach((h) => {
      if (map.has(h.symbol)) {
        const e = map.get(h.symbol);
        e.shares += h.shares;
        if (h.origin)         e.origins.add(h.origin);
        if (h.assetType)      e.types.add(h.assetType);
        if (h.instrumentType) e.instruments.add(h.instrumentType);
        // Use first non-zero dividendPerShare found for this symbol
        if (!e.dividendPerShare && h.dividendPerShare > 0) e.dividendPerShare = h.dividendPerShare;
        // DRIP: true only if ALL holdings of this symbol are reinvested
        if (!h.dividendReinvested) e.dividendReinvested = false;
        addShares(e.sharesByTaxType, taxType, h.shares);
        addShares(e.sharesByOrigin, h.origin, h.shares);
        addShares(e.sharesByType, h.assetType, h.shares);
      } else {
        const e = {
          symbol:             h.symbol,
          shares:             h.shares,
          isCash:             h.assetType === "cash",
          origins:            new Set(h.origin         ? [h.origin]         : []),
          types:              new Set(h.assetType      ? [h.assetType]      : []),
          instruments:        new Set(h.instrumentType ? [h.instrumentType] : []),
          dividendPerShare:   (h.dividendPerShare > 0) ? h.dividendPerShare : null,
          dividendReinvested: h.dividendReinvested ?? false,
          // Per-breakdown share totals, since a symbol can span multiple accounts
          // (e.g. same fund held in both a Taxable and a Tax-Deferred account) —
          // used to split this symbol's value across pie-chart slices.
          sharesByTaxType: new Map(),
          sharesByOrigin:  new Map(),
          sharesByType:    new Map(),
        };
        addShares(e.sharesByTaxType, taxType, h.shares);
        addShares(e.sharesByOrigin, h.origin, h.shares);
        addShares(e.sharesByType, h.assetType, h.shares);
        map.set(h.symbol, e);
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

  // Asset class: single value or "—" when accounts disagree
  const typeArr = [...entry.types];
  const typeTxt = typeArr.length === 1
    ? (ASSET_CLASS_LABELS[typeArr[0]] ?? escHtml(typeArr[0]))
    : null;

  // Instrument type: single value or "—" when accounts disagree
  const instrArr = [...entry.instruments];
  const instrTxt = instrArr.length === 1
    ? (INSTRUMENT_LABELS[instrArr[0]] ?? escHtml(instrArr[0]))
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

  const dps = (entry.dividendPerShare > 0) ? entry.dividendPerShare : null;
  let dividendValueHtml;
  if (dps !== null) {
    const pricePaid = isCash ? 1 : (prices ? prices[symbol] : undefined);
    const yieldPct = pricePaid ? (dps / pricePaid * 100).toFixed(2) + "%" : `$${dps.toFixed(4)}/sh`;
    const dripBadge = entry.dividendReinvested ? ` <span class="drip-badge">DRIP</span>` : "";
    dividendValueHtml = `${yieldPct}${dripBadge}`;
  } else {
    dividendValueHtml = `<span class="dim">—</span>`;
  }

  tr.innerHTML = `
    ${symbolCell}
    <td class="align-right">${shares.toLocaleString("en-US", { maximumFractionDigits: 6 })}</td>
    <td>${originTxt ? originTxt : '<span class="dim">—</span>'}</td>
    <td>${typeTxt   ? typeTxt   : '<span class="dim">—</span>'}</td>
    <td>${(instrTxt && instrArr[0] !== "cash") ? instrTxt : '<span class="dim">—</span>'}</td>
    <td class="align-right dividend-edit-cell">${dividendValueHtml} <button class="icon-btn dividend-edit-btn" title="Edit dividend rate">&#9998;</button></td>
    ${priceCell}
    ${valueCell}
  `;

  if (!isCash) {
    tr.querySelector("[data-action='info']")?.addEventListener("click", () => {
      const sym   = symbol.toLowerCase();
      const isEtf = entry.instruments.has("etf") || entry.instruments.has("fund");
      window.open(`https://stockanalysis.com/${isEtf ? "etf" : "stocks"}/${sym}/`, "_blank", "noopener");
    });
  }
  tr.querySelector(".dividend-edit-btn")?.addEventListener("click", () =>
    showDividendModal(symbol, entry.dividendPerShare, entry.dividendReinvested)
  );

  return tr;
}

function showDividendModal(symbol, currentDps, currentDrip) {
  const el = document.createElement("div");
  el.className = "holding-form";
  el.innerHTML = `
    <h3>Dividend — ${escHtml(symbol)}</h3>
    <div class="form-group">
      <label for="div-dps-input">Annual Dividend ($/share)</label>
      <input id="div-dps-input" type="number" class="form-input" placeholder="e.g. 2.88"
        min="0" step="0.0001" value="${currentDps != null && currentDps > 0 ? currentDps : ""}">
    </div>
    <div class="form-group">
      <label class="checkbox-label">
        <input id="div-drip" type="checkbox" ${currentDrip ? "checked" : ""}>
        Dividends reinvested (DRIP)
      </label>
    </div>
    <div class="form-actions">
      <button class="btn btn-secondary" id="div-cancel">Cancel</button>
      <button class="btn btn-primary" id="div-save">Save</button>
    </div>
  `;
  const input = el.querySelector("#div-dps-input");
  const drip  = el.querySelector("#div-drip");
  el.querySelector("#div-cancel").addEventListener("click", () => Modal.close());
  el.querySelector("#div-save").addEventListener("click", () => {
    const raw = input.value.trim();
    const dps = raw !== "" ? parseFloat(raw) : undefined;
    updateDividendBySymbol(symbol, dps, drip.checked);
    Modal.close();
  });
  Modal.open(el);
  setTimeout(() => input.focus(), 50);
}

// ── Summary pie chart helpers ────────────────────────────────────────────────

function addValue(map, key, value) {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + value);
}

function buildSlices(map, metaMap) {
  return [...map.entries()]
    .map(([key, value]) => {
      const meta = metaMap[key] || { label: key, color: "#94a3b8" };
      return { label: meta.label, value, color: meta.color };
    })
    .sort((a, b) => b.value - a.value);
}

function buildChartCard(title) {
  const card = document.createElement("div");
  card.className = "summary-card";
  const h3 = document.createElement("h3");
  h3.textContent = title;
  card.appendChild(h3);
  const body = document.createElement("div");
  card.appendChild(body);
  return { card, body };
}

function buildLoadingChartCard(title) {
  const card = document.createElement("div");
  card.className = "summary-card";
  const h3 = document.createElement("h3");
  h3.textContent = title;
  card.appendChild(h3);
  const loadRow = document.createElement("div");
  loadRow.className = "chart-loading";
  loadRow.appendChild(createLoadingSpinner());
  const span = document.createElement("span");
  span.textContent = "Loading prices…";
  loadRow.appendChild(span);
  card.appendChild(loadRow);
  return card;
}

function renderChartBody(body, slices) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  body.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "pie-chart-wrap";
  wrap.appendChild(createPieChart(slices, total));

  const legend = document.createElement("div");
  legend.className = "pie-legend";
  const activeSlices = slices.filter((s) => s.value > 0);

  if (activeSlices.length === 0) {
    const empty = document.createElement("div");
    empty.className = "dim";
    empty.style.fontSize = "0.8rem";
    empty.textContent = "No matching rows";
    legend.appendChild(empty);
  } else {
    activeSlices.forEach((slice) => {
      const pct = total > 0 ? ((slice.value / total) * 100).toFixed(1) : "0.0";
      const item = document.createElement("div");
      item.className = "legend-item";
      item.innerHTML = `
        <span class="legend-dot" style="background:${slice.color}"></span>
        <span class="legend-label">${escHtml(slice.label)} (${formatCurrency(slice.value)})</span>
        <span class="legend-pct">${pct}%</span>
      `;
      legend.appendChild(item);
    });
  }

  wrap.appendChild(legend);
  body.appendChild(wrap);
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

  let annualIncome = null, dripIncome = null;
  {
    let cashSum = 0, hasCash = false, dripSum = 0, hasDrip = false;
    entries.forEach((e) => {
      if (!e.dividendPerShare || e.dividendPerShare <= 0) return;
      const amt = e.shares * e.dividendPerShare;
      if (e.dividendReinvested) { dripSum += amt; hasDrip = true; }
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
      const sign  = totalDayChange > 0 ? "+" : "-";
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

  // ── Summary pie charts (Tax Treatment / Origin / Asset Class) ────────────────
  // These reflect only the rows currently visible in the table below — they are
  // recomputed whenever the table's filters change.
  const chartsGrid = document.createElement("div");
  chartsGrid.className = "assets-charts-grid";

  let taxChartBody = null, originChartBody = null, classChartBody = null;
  if (pricesLoading) {
    chartsGrid.appendChild(buildLoadingChartCard("By Tax Treatment"));
    chartsGrid.appendChild(buildLoadingChartCard("By Origin"));
    chartsGrid.appendChild(buildLoadingChartCard("By Asset Class"));
  } else {
    const taxCard    = buildChartCard("By Tax Treatment");
    const originCard = buildChartCard("By Origin");
    const classCard  = buildChartCard("By Asset Class");
    taxChartBody    = taxCard.body;
    originChartBody = originCard.body;
    classChartBody  = classCard.body;
    chartsGrid.append(taxCard.card, originCard.card, classCard.card);
  }
  container.appendChild(chartsGrid);

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
          <th>Asset Class</th>
          <th>Instrument</th>
          <th class="align-right">Dividend</th>
          <th class="align-right">Price</th>
          <th class="align-right">Value</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  `;

  const tbody = tableWrapper.querySelector("tbody");
  const rowEntryMap = new Map();
  entries.forEach((entry) => {
    const row = buildRow(entry, prices, quoteDetails, pricesLoading);
    rowEntryMap.set(row, entry);
    tbody.appendChild(row);
  });

  // Columns: Symbol, Shares, Origin, Asset Class, Instrument, Dividend, Price, Value
  attachTableFilter(
    tableWrapper.querySelector("table"),
    [true, false, true, true, true, false, false, false]
  );

  // ── Recompute pie charts from currently-visible rows only ────────────────────
  function updateCharts() {
    if (!taxChartBody) return; // prices still loading — spinner cards shown instead

    const byTax = new Map(), byOrigin = new Map(), byClass = new Map();
    tableWrapper.querySelectorAll("tbody tr").forEach((row) => {
      if (row.style.display === "none") return;
      const entry = rowEntryMap.get(row);
      if (!entry) return;
      const price = entry.isCash ? 1 : (prices ? prices[entry.symbol] : undefined);
      if (price === undefined) return;
      entry.sharesByTaxType.forEach((sh, key) => addValue(byTax, key, sh * price));
      entry.sharesByOrigin.forEach((sh, key) => addValue(byOrigin, key, sh * price));
      entry.sharesByType.forEach((sh, key) => addValue(byClass, key, sh * price));
    });

    const taxSlices    = buildSlices(byTax, TAX_TYPE_META);
    const originSlices = buildSlices(byOrigin, ORIGIN_META);
    const classSlices  = buildSlices(byClass, ASSET_CLASS_META);

    renderChartBody(taxChartBody, taxSlices);
    renderChartBody(originChartBody, originSlices);
    renderChartBody(classChartBody, classSlices);
  }

  updateCharts();
  tableWrapper.querySelector("table").addEventListener("input",  updateCharts);
  tableWrapper.querySelector("table").addEventListener("change", updateCharts);

  // ── Visible-row value sum in the filter row's Value cell ─────────────────────
  // The filter row's last <th> (Value column, index 7) is an empty cell — we
  // display the running sum of visible rows there.  It starts equal to Total
  // Value and updates live as the user types in any filter.
  const filterRow = tableWrapper.querySelector(".filter-row");
  const valueTh   = filterRow?.querySelectorAll("th")[7] ?? null;
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
      // Value cell is the 8th td (index 7); text is formatted currency or "—"
      const text = (row.querySelectorAll("td")[7]?.textContent ?? "").trim();
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
