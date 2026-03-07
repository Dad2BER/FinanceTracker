import { createPieChart } from "./pieChart.js";
import { createLoadingSpinner } from "../ui/loadingSpinner.js";

const ASSET_TYPE_META = {
  "stock-fund":   { label: "Stock Fund",   color: "#6366f1" },
  "real-estate":  { label: "Real Estate",  color: "#f59e0b" },
  "company":      { label: "Company",      color: "#3b82f6" },
  "crypto":       { label: "Crypto",       color: "#f97316" },
  "bonds":        { label: "Bonds",        color: "#22c55e" },
  "cash":         { label: "Cash",         color: "#64748b" },
  "other":        { label: "Other",        color: "#94a3b8" },
};

const TAX_TYPE_META = {
  "Taxable":      { label: "Taxable",      color: "#3b82f6" },
  "Tax-Free":     { label: "Tax-Free",     color: "#22c55e" },
  "Tax-Deferred": { label: "Tax-Deferred", color: "#f59e0b" },
};

function holdingValue(holding, prices) {
  if (holding.assetType === "cash") return holding.shares;
  const p = prices?.[holding.symbol];
  return p !== undefined ? p * holding.shares : null;
}

function buildSlices(map, metaMap) {
  return Object.entries(map)
    .map(([key, value]) => {
      const meta = metaMap[key] || { label: key, color: "#94a3b8" };
      return { label: meta.label, value, color: meta.color };
    })
    .sort((a, b) => b.value - a.value);
}

function makeCard(title, slices, total, isLoading) {
  const card = document.createElement("div");
  card.className = "summary-card";

  const h3 = document.createElement("h3");
  h3.textContent = title;
  card.appendChild(h3);

  if (isLoading) {
    const loadRow = document.createElement("div");
    loadRow.className = "chart-loading";
    loadRow.appendChild(createLoadingSpinner());
    const span = document.createElement("span");
    span.textContent = "Loading prices…";
    loadRow.appendChild(span);
    card.appendChild(loadRow);
    return card;
  }

  const wrap = document.createElement("div");
  wrap.className = "pie-chart-wrap";
  wrap.appendChild(createPieChart(slices, total));

  const legend = document.createElement("div");
  legend.className = "pie-legend";
  slices.filter((s) => s.value > 0).forEach((slice) => {
    const pct = total > 0 ? ((slice.value / total) * 100).toFixed(1) : "0.0";
    const item = document.createElement("div");
    item.className = "legend-item";
    item.innerHTML = `
      <span class="legend-dot" style="background:${slice.color}"></span>
      <span class="legend-label">${slice.label}</span>
      <span class="legend-pct">${pct}%</span>
    `;
    legend.appendChild(item);
  });

  wrap.appendChild(legend);
  card.appendChild(wrap);
  return card;
}

/**
 * Renders the two summary pie-chart cards into `container`.
 */
export function renderSummaryCards(container, accounts, prices, pricesLoading) {
  container.innerHTML = "";

  const isLoading = pricesLoading || prices === null;

  // Aggregate values
  const byAsset = {};
  const byTax = {};
  let total = 0;

  if (!isLoading) {
    for (const account of accounts) {
      for (const holding of account.holdings) {
        const val = holdingValue(holding, prices);
        if (val === null) continue;

        const assetKey = holding.assetType || "other";
        byAsset[assetKey] = (byAsset[assetKey] || 0) + val;

        const taxKey = account.taxType;
        byTax[taxKey] = (byTax[taxKey] || 0) + val;

        total += val;
      }
    }
  }

  const grid = document.createElement("div");
  grid.className = "dashboard-grid";

  grid.appendChild(makeCard(
    "By Asset Type",
    isLoading ? [] : buildSlices(byAsset, ASSET_TYPE_META),
    total,
    isLoading
  ));
  grid.appendChild(makeCard(
    "By Tax Type",
    isLoading ? [] : buildSlices(byTax, TAX_TYPE_META),
    total,
    isLoading
  ));

  container.appendChild(grid);
}
