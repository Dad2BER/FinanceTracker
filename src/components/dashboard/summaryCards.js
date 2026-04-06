import { createPieChart } from "./pieChart.js";
import { createNetWorthChart } from "./netWorthChart.js";
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

const TARGETS_KEY = "financetracker_alloc_targets";

function loadTargets() {
  try { return JSON.parse(localStorage.getItem(TARGETS_KEY) || "{}"); }
  catch { return {}; }
}

function saveTargets(t) {
  localStorage.setItem(TARGETS_KEY, JSON.stringify(t));
}

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

function fmtValue(v) {
  if (v >= 1_000_000) return "$" + (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1_000)     return "$" + Math.round(v / 1_000) + "K";
  return "$" + Math.round(v);
}

// ── Standard pie card (Tax Type) ─────────────────────────────────────────────

function makeCard(slices, total, isLoading) {
  const card = document.createElement("div");
  card.className = "summary-card";

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
      <span class="legend-label">${slice.label} (${fmtValue(slice.value)})</span>
      <span class="legend-pct">${pct}%</span>
    `;
    legend.appendChild(item);
  });

  wrap.appendChild(legend);
  card.appendChild(wrap);
  return card;
}

// ── Allocation card (Asset Type) with target % editing ───────────────────────

function makeAllocationCard(slices, total, isLoading) {
  const card = document.createElement("div");
  card.className = "summary-card";

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

  let targets = loadTargets();
  let editing = false;

  const wrap = document.createElement("div");
  wrap.className = "pie-chart-wrap";
  wrap.appendChild(createPieChart(slices, total));

  const rightSide = document.createElement("div");
  rightSide.className = "pie-legend-col";

  const legend = document.createElement("div");
  legend.className = "pie-legend";

  const editBtn = document.createElement("button");
  editBtn.className = "btn btn-ghost btn-xs nw-edit-targets-btn";
  editBtn.textContent = "Edit Targets";

  function renderLegend() {
    legend.innerHTML = "";
    slices.filter(s => s.value > 0).forEach(slice => {
      const actualPct = total > 0 ? (slice.value / total) * 100 : 0;
      const targetPct = targets[slice.label] ?? null;

      const row = document.createElement("div");
      row.className = "legend-item";

      const dot = document.createElement("span");
      dot.className = "legend-dot";
      dot.style.background = slice.color;

      const lbl = document.createElement("span");
      lbl.className = "legend-label";

      const pct = document.createElement("span");
      pct.className = "legend-pct";
      pct.textContent = `${actualPct.toFixed(1)}%`;

      row.append(dot, lbl, pct);

      if (editing) {
        lbl.textContent = slice.label;
        const inp = document.createElement("input");
        inp.type = "number";
        inp.min = "0";
        inp.max = "100";
        inp.step = "1";
        inp.placeholder = "—";
        inp.value = targetPct !== null ? String(targetPct) : "";
        inp.dataset.key = slice.label;
        inp.className = "nw-target-input";
        row.appendChild(inp);
      } else {
        lbl.textContent = `${slice.label} (${fmtValue(slice.value)})`;
        if (targetPct !== null) {
          const variance = actualPct - targetPct;
          const badge = document.createElement("span");
          badge.className = "nw-variance-badge";
          badge.style.color = Math.abs(variance) <= 3
            ? "var(--color-success)"
            : "var(--color-warning)";
          badge.textContent = `${variance > 0 ? "+" : ""}${variance.toFixed(0)}%`;
          row.appendChild(badge);
        }
      }

      legend.appendChild(row);
    });
  }

  editBtn.addEventListener("click", () => {
    if (editing) {
      legend.querySelectorAll(".nw-target-input").forEach(inp => {
        const v = parseFloat(inp.value);
        if (!isNaN(v) && v >= 0) targets[inp.dataset.key] = v;
        else delete targets[inp.dataset.key];
      });
      saveTargets(targets);
      editing = false;
      editBtn.textContent = "Edit Targets";
    } else {
      editing = true;
      editBtn.textContent = "Save";
    }
    renderLegend();
  });

  renderLegend();
  rightSide.append(legend, editBtn);
  wrap.appendChild(rightSide);
  card.appendChild(wrap);
  return card;
}

// ── Net worth aggregation ────────────────────────────────────────────────────

function aggregateNetWorth(accounts, prices) {
  const dateMap = new Map();

  for (const account of accounts) {
    for (const entry of (account.valueHistory || [])) {
      dateMap.set(entry.date, (dateMap.get(entry.date) || 0) + entry.value);
    }
  }

  return [...dateMap.entries()]
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ── Net worth card ───────────────────────────────────────────────────────────

export function makeNetWorthCard(accounts, prices, isLoading) {
  const card = document.createElement("div");
  card.className = "summary-card nw-chart-card";

  const title = document.createElement("h3");
  title.textContent = "NET WORTH OVER TIME";
  card.appendChild(title);

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

  const points = aggregateNetWorth(accounts, prices);
  card.appendChild(createNetWorthChart(points));
  return card;
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * Renders the summary cards (allocation pies + net worth chart) into `container`.
 */
export function renderSummaryCards(container, accounts, prices, pricesLoading) {
  container.innerHTML = "";

  const isLoading = pricesLoading || prices === null;

  // Aggregate values for pie charts
  const byAsset = {};
  const byTax = {};
  let total = 0;

  if (!isLoading) {
    for (const account of accounts) {
      if (account.accountType === "ledger") {
        const balance = (account.openingBalance || 0) +
          (account.transactions || []).reduce((sum, t) => sum + t.amount, 0);
        if (balance === 0) continue;
        byAsset["cash"] = (byAsset["cash"] || 0) + balance;
        byTax[account.taxType] = (byTax[account.taxType] || 0) + balance;
        total += balance;
      } else {
        for (const holding of account.holdings) {
          const val = holdingValue(holding, prices);
          if (val === null) continue;
          const assetKey = holding.assetType || "other";
          byAsset[assetKey] = (byAsset[assetKey] || 0) + val;
          byTax[account.taxType] = (byTax[account.taxType] || 0) + val;
          total += val;
        }
      }
    }
  }

  const assetSlices = isLoading ? [] : buildSlices(byAsset, ASSET_TYPE_META);
  const taxSlices   = isLoading ? [] : buildSlices(byTax, TAX_TYPE_META);

  const grid = document.createElement("div");
  grid.className = "dashboard-grid";

  grid.appendChild(makeAllocationCard(assetSlices, total, isLoading));
  grid.appendChild(makeCard(taxSlices, total, isLoading));

  container.appendChild(grid);
}
