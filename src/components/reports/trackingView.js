import { formatCurrency } from "../../utils/currency.js";
import { createPieChart } from "../dashboard/pieChart.js";

// ── Tracking: spend grouped into three fixed buckets ──────────────────────────
// Cap. Ex.      — any transaction tagged "Cap. Ex." (wins over its category)
// Entertainment — top-level categories "Entertainment" and "Restaurants"
// Living Exp.   — every other top-level category
// Transfers and excluded transactions are ignored, as on Monthly Spend.

const CAP_EX_TAG = "Cap. Ex.";
const ENTERTAINMENT_CATS = new Set(["Entertainment", "Restaurants"]);
const FIRST_ANNUAL_YEAR = 2026;

// Stack order (bottom → top) and colours
const BUCKETS = [
  { id: "Living Exp.",   color: "#6366f1" },
  { id: "Entertainment", color: "#f28e2c" },
  { id: "Cap. Ex.",      color: "#59a14f" },
];
const BUCKET_COLOR = new Map(BUCKETS.map(b => [b.id, b.color]));

// ── Persisted state across navigations ────────────────────────────────────────
let _mode = "last12";          // "last12" | "annual"
let _hiddenBuckets = new Set();

function monthLabel(yyyyMM) {
  const [y, m] = yyyyMM.split("-");
  return new Date(+y, +m - 1, 1).toLocaleString("en-US", { month: "short", year: "2-digit" });
}

function monthLabelFull(yyyyMM) {
  const [y, m] = yyyyMM.split("-");
  return new Date(+y, +m - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
}

function niceStep(maxVal, steps = 5) {
  if (maxVal <= 0) return 100;
  const rough = maxVal / steps;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const nice = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return nice * mag;
}

function ym(y, m) {
  return `${y}-${String(m).padStart(2, "0")}`;
}

// Inclusive list of YYYY-MM strings from start to end
function monthRange(startStr, endStr) {
  const out = [];
  let [y, m] = startStr.split("-").map(Number);
  while (ym(y, m) <= endStr) {
    out.push(ym(y, m));
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

function shortMoney(v) {
  return v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`;
}

function bucketFor(tx, catName) {
  if ((tx.tag || "").trim() === CAP_EX_TAG) return "Cap. Ex.";
  if (ENTERTAINMENT_CATS.has(catName)) return "Entertainment";
  return "Living Exp.";
}

export function renderTrackingView(container, accounts, categories) {
  container.innerHTML = "";

  function rerender() {
    renderTrackingView(container, accounts, categories);
  }

  // ── Header ──────────────────────────────────────────────────────────────────
  const header = document.createElement("div");
  header.className = "view-header";

  const titleRow = document.createElement("div");
  titleRow.className = "detail-title-row";
  titleRow.style.flexWrap = "wrap";
  titleRow.style.gap = "0.75rem";

  const h1 = document.createElement("h1");
  h1.textContent = "Tracking";

  const modeToggle = document.createElement("div");
  modeToggle.className = "report-mode-toggle";
  [["annual", "Annual"], ["last12", "Last 12 Months"]].forEach(([id, label]) => {
    const btn = document.createElement("button");
    btn.className = "report-mode-btn" + (_mode === id ? " active" : "");
    btn.textContent = label;
    btn.addEventListener("click", () => { _mode = id; rerender(); });
    modeToggle.appendChild(btn);
  });

  titleRow.appendChild(h1);
  titleRow.appendChild(modeToggle);
  header.appendChild(titleRow);
  container.appendChild(header);

  // ── Data ────────────────────────────────────────────────────────────────────
  const ledgers = accounts.filter(a => a.accountType === "ledger");
  if (ledgers.length === 0) {
    const el = document.createElement("div");
    el.className = "empty-state";
    el.innerHTML = "<p>No ledger accounts found. Add a ledger account to see tracking.</p>";
    container.appendChild(el);
    return;
  }

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const currentMonthStr = ym(currentYear, currentMonth);
  const lastCompleteStr = currentMonth === 1 ? ym(currentYear - 1, 12) : ym(currentYear, currentMonth - 1);

  // Range of months to load, the x-axis columns, and the completed months
  // that feed the totals / averages card.
  let rangeStart;
  let columns;        // [{ key, label, fullLabel, months: [YYYY-MM], inProgress }]
  let completedMonths;
  if (_mode === "annual") {
    rangeStart = ym(FIRST_ANNUAL_YEAR, 1);
    columns = [];
    for (let y = FIRST_ANNUAL_YEAR; y <= currentYear; y++) {
      columns.push({
        key: String(y),
        label: String(y),
        fullLabel: y === currentYear ? `${y} (year to date)` : String(y),
        months: monthRange(ym(y, 1), y === currentYear ? currentMonthStr : ym(y, 12)),
        inProgress: y === currentYear,
      });
    }
    completedMonths = rangeStart <= lastCompleteStr ? monthRange(rangeStart, lastCompleteStr) : [];
  } else {
    // Previous 12 complete months + the current (in-progress) month = 13 columns
    rangeStart = ym(currentYear - 1, currentMonth);
    const months = monthRange(rangeStart, currentMonthStr);
    columns = months.map(m => ({
      key: m,
      label: monthLabel(m),
      fullLabel: monthLabelFull(m) + (m === currentMonthStr ? " (in progress)" : ""),
      months: [m],
      inProgress: m === currentMonthStr,
    }));
    completedMonths = months.filter(m => m !== currentMonthStr);
  }

  const catById = new Map(categories.map(c => [c.id, c.name]));

  // month → bucket → top-level category → net amount (signed)
  const monthMap = new Map();
  let txCount = 0;
  ledgers.forEach(acct => {
    (acct.transactions || []).forEach(tx => {
      const month = (tx.date || "").slice(0, 7);
      if (month.length !== 7 || month < rangeStart || month > currentMonthStr) return;
      if (tx.excluded) return;
      const catName = (tx.categoryId ? catById.get(tx.categoryId) : null) || "Uncategorized";
      if (catName === "Transfer") return;
      const bucket = bucketFor(tx, catName);
      if (!monthMap.has(month)) monthMap.set(month, new Map());
      const bm = monthMap.get(month);
      if (!bm.has(bucket)) bm.set(bucket, new Map());
      const cm = bm.get(bucket);
      cm.set(catName, (cm.get(catName) || 0) + tx.amount);
      txCount++;
    });
  });

  if (txCount === 0) {
    const el = document.createElement("div");
    el.className = "empty-state";
    el.innerHTML = "<p>No transactions in this period (excluding Transfers).</p>";
    container.appendChild(el);
    return;
  }

  // Spend for a bucket over a set of months. Like Monthly Spend, each top-level
  // category is netted per month and only net-negative (spending) amounts count,
  // so income and refunds don't offset other categories.
  function bucketSpend(months, bucket) {
    let total = 0;
    const byCat = new Map();
    months.forEach(month => {
      const cm = monthMap.get(month)?.get(bucket);
      if (!cm) return;
      cm.forEach((net, cat) => {
        if (net < 0) {
          total += -net;
          byCat.set(cat, (byCat.get(cat) || 0) - net);
        }
      });
    });
    const cats = [...byCat].map(([name, v]) => ({ name, v })).sort((a, b) => b.v - a.v);
    return { total, cats };
  }

  const visibleBuckets = BUCKETS.map(b => b.id).filter(b => !_hiddenBuckets.has(b));

  const chartData = columns.map(col => {
    const segments = [];
    let total = 0;
    visibleBuckets.forEach(bucket => {
      const { total: v, cats } = bucketSpend(col.months, bucket);
      if (v > 0) {
        segments.push({ bucket, v, cats });
        total += v;
      }
    });
    return { col, segments, total };
  });
  const maxTotal = Math.max(...chartData.map(d => d.total), 0);

  // ── Layout ──────────────────────────────────────────────────────────────────
  const section = document.createElement("div");
  section.className = "report-section";
  container.appendChild(section);

  const body = document.createElement("div");
  body.className = "report-body";
  section.appendChild(body);

  const barCol = document.createElement("div");
  barCol.className = "report-bar-col";
  body.appendChild(barCol);

  const svgWrap = document.createElement("div");
  svgWrap.className = "report-chart-wrap";
  svgWrap.style.position = "relative";
  barCol.appendChild(svgWrap);

  const tooltip = document.createElement("div");
  tooltip.className = "report-tooltip";
  svgWrap.appendChild(tooltip);

  const MARGIN = { top: 24, right: 16, bottom: 56, left: 72 };
  const SVG_H = 380;

  function showTooltip(col, seg, svgCx, chartW) {
    let html = `<div class="rtt-month">${col.fullLabel}</div>
      <div class="rtt-cat">
        <span class="legend-dot" style="background:${BUCKET_COLOR.get(seg.bucket)}"></span>
        <span class="rtt-cat-name">${seg.bucket}</span>
        <span class="rtt-val">${formatCurrency(seg.v)}</span>
      </div>`;
    if (seg.cats.length > 0) {
      html += `<div class="rtt-divider"></div>`;
      seg.cats.forEach(c => {
        html += `<div class="rtt-sub">
            <span class="rtt-sub-name">${c.name}</span>
            <span class="rtt-val">${formatCurrency(c.v)}</span>
          </div>`;
      });
    }
    tooltip.innerHTML = html;
    tooltip.style.display = "block";
    const pct = svgCx / chartW;
    tooltip.style.top = `${MARGIN.top}px`;
    tooltip.style.left = `${MARGIN.left + svgCx}px`;
    tooltip.style.transform = pct < 0.2 ? "translateX(0)" : pct > 0.8 ? "translateX(-100%)" : "translateX(-50%)";
  }

  function hideTooltip() {
    tooltip.style.display = "none";
  }

  function drawChart() {
    const oldSvg = svgWrap.querySelector("svg");
    if (oldSvg) oldSvg.remove();

    const W = svgWrap.clientWidth || 600;
    const cW = W - MARGIN.left - MARGIN.right;
    const cH = SVG_H - MARGIN.top - MARGIN.bottom;

    const step = niceStep(maxTotal);
    const yMax = maxTotal > 0 ? Math.ceil(maxTotal / step) * step : step;
    const n = columns.length || 1;
    const slotW = cW / n;
    const barW = Math.min(Math.max(slotW * 0.65, 6), _mode === "annual" ? 120 : 80);
    const yPx = v => cH - (v / yMax) * cH;

    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("width", W);
    svg.setAttribute("height", SVG_H);
    const g = document.createElementNS(NS, "g");
    g.setAttribute("transform", `translate(${MARGIN.left},${MARGIN.top})`);
    svg.appendChild(g);

    for (let v = 0; v <= yMax; v += step) {
      const y = yPx(v);
      const line = document.createElementNS(NS, "line");
      line.setAttribute("x1", 0); line.setAttribute("x2", cW);
      line.setAttribute("y1", y); line.setAttribute("y2", y);
      line.setAttribute("stroke", "#2e3248");
      if (v > 0) line.setAttribute("stroke-dasharray", "4,3");
      g.appendChild(line);

      const txt = document.createElementNS(NS, "text");
      txt.setAttribute("x", -8);
      txt.setAttribute("y", y);
      txt.setAttribute("dy", "0.35em");
      txt.setAttribute("text-anchor", "end");
      txt.setAttribute("fill", "#718096");
      txt.setAttribute("font-size", "11");
      txt.textContent = v >= 1000 ? `$${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : `$${v}`;
      g.appendChild(txt);
    }

    const yLine = document.createElementNS(NS, "line");
    yLine.setAttribute("x1", 0); yLine.setAttribute("x2", 0);
    yLine.setAttribute("y1", 0); yLine.setAttribute("y2", cH);
    yLine.setAttribute("stroke", "#2e3248");
    g.appendChild(yLine);

    chartData.forEach((d, i) => {
      const cx = i * slotW + slotW / 2;
      const x = cx - barW / 2;
      const colGroup = document.createElementNS(NS, "g");

      if (d.col.inProgress) {
        const hi = document.createElementNS(NS, "rect");
        hi.setAttribute("x", cx - slotW / 2);
        hi.setAttribute("y", 0);
        hi.setAttribute("width", slotW);
        hi.setAttribute("height", cH);
        hi.setAttribute("fill", "rgba(99,102,241,0.06)");
        colGroup.appendChild(hi);
      }

      let yBase = cH;
      d.segments.forEach(seg => {
        const segH = (seg.v / yMax) * cH;
        yBase -= segH;
        const rect = document.createElementNS(NS, "rect");
        rect.setAttribute("x", x);
        rect.setAttribute("y", yBase);
        rect.setAttribute("width", barW);
        rect.setAttribute("height", segH);
        rect.setAttribute("fill", BUCKET_COLOR.get(seg.bucket));
        rect.setAttribute("rx", 2);
        if (d.col.inProgress) rect.setAttribute("opacity", "0.7");
        rect.addEventListener("mouseenter", () => showTooltip(d.col, seg, cx, cW));
        rect.addEventListener("mouseleave", hideTooltip);
        colGroup.appendChild(rect);
      });

      if (d.total > 0) {
        const ty = yPx(d.total);
        if (ty > 14) {
          const lbl = document.createElementNS(NS, "text");
          lbl.setAttribute("x", cx);
          lbl.setAttribute("y", ty - 4);
          lbl.setAttribute("text-anchor", "middle");
          lbl.setAttribute("fill", d.col.inProgress ? "#6366f1" : "#718096");
          lbl.setAttribute("font-size", "10");
          lbl.textContent = shortMoney(d.total);
          colGroup.appendChild(lbl);
        }
      }

      const ly = cH + (_mode === "annual" ? 18 : 10);
      const xlabel = document.createElementNS(NS, "text");
      xlabel.setAttribute("x", cx);
      xlabel.setAttribute("y", ly);
      xlabel.setAttribute("fill", d.col.inProgress ? "#6366f1" : "#718096");
      xlabel.setAttribute("font-size", "11");
      if (_mode === "annual") {
        xlabel.setAttribute("text-anchor", "middle");
      } else {
        xlabel.setAttribute("text-anchor", "end");
        xlabel.setAttribute("transform", `rotate(-40,${cx},${ly})`);
      }
      if (d.col.inProgress) xlabel.setAttribute("font-weight", "600");
      xlabel.textContent = d.col.label;
      colGroup.appendChild(xlabel);

      g.appendChild(colGroup);
    });

    svgWrap.insertBefore(svg, tooltip);
  }

  drawChart();
  new ResizeObserver(() => drawChart()).observe(svgWrap);

  // Legend — click to hide/show a bucket
  const legendWrap = document.createElement("div");
  legendWrap.className = "report-legend-wrap";
  const legendHeader = document.createElement("div");
  legendHeader.className = "report-legend-header";
  legendHeader.innerHTML = `<span class="report-legend-title">Categories</span>`;
  if (_hiddenBuckets.size > 0) {
    const showAll = document.createElement("button");
    showAll.className = "btn-link";
    showAll.textContent = `Show all (${_hiddenBuckets.size} hidden)`;
    showAll.addEventListener("click", () => { _hiddenBuckets.clear(); rerender(); });
    legendHeader.appendChild(showAll);
  }
  legendWrap.appendChild(legendHeader);

  const legend = document.createElement("div");
  legend.className = "report-legend";
  BUCKETS.forEach(({ id, color }) => {
    const off = _hiddenBuckets.has(id);
    const item = document.createElement("div");
    item.className = "legend-item legend-toggle" + (off ? " legend-toggle--off" : "");
    item.title = off ? "Click to show" : "Click to hide";
    item.innerHTML = `<span class="legend-dot" style="background:${color}"></span><span>${id}</span>`;
    item.addEventListener("click", () => {
      if (off) _hiddenBuckets.delete(id); else _hiddenBuckets.add(id);
      rerender();
    });
    legend.appendChild(item);
  });
  legendWrap.appendChild(legend);
  barCol.appendChild(legendWrap);

  // ── Totals / averages card (completed months only) ──────────────────────────
  const pieCol = document.createElement("div");
  pieCol.className = "report-pie-col tracking-pie-col";
  body.appendChild(pieCol);

  const card = document.createElement("div");
  card.className = "report-pie-card";
  pieCol.appendChild(card);

  const title = document.createElement("h3");
  title.className = "section-title";
  title.style.marginBottom = "0.25rem";
  title.textContent = "Monthly Average";
  card.appendChild(title);

  if (completedMonths.length === 0) {
    const msg = document.createElement("p");
    msg.style.cssText = "color:var(--color-text-dim);font-size:0.85rem;padding:0.5rem 0";
    msg.textContent = "No complete months yet.";
    card.appendChild(msg);
    return;
  }

  const first = completedMonths[0];
  const last = completedMonths[completedMonths.length - 1];
  const n = completedMonths.length;
  const sub = document.createElement("p");
  sub.style.cssText = "font-size:0.78rem;color:var(--color-text-dim);margin-bottom:0.85rem";
  sub.textContent = `${first === last ? monthLabel(first) : `${monthLabel(first)} – ${monthLabel(last)}`}`
    + ` · ${n} complete month${n === 1 ? "" : "s"}`;
  card.appendChild(sub);

  const rows = visibleBuckets.map(bucket => {
    const total = bucketSpend(completedMonths, bucket).total;
    return { bucket, total, avg: total / n };
  });
  const grandTotal = rows.reduce((s, r) => s + r.total, 0);
  const grandAvg = grandTotal / n;

  const slices = rows
    .filter(r => r.avg > 0)
    .map(r => ({ label: r.bucket, value: r.avg, color: BUCKET_COLOR.get(r.bucket) }));
  const pieSvg = createPieChart(slices, grandAvg, "AVG/MO");
  pieSvg.style.cssText = "display:block;margin:0 auto 0.85rem";
  card.appendChild(pieSvg);

  const table = document.createElement("table");
  table.className = "tracking-totals";
  table.innerHTML = `
    <thead><tr><th></th><th>Total</th><th>Avg/Mo</th></tr></thead>
    <tbody>
      ${rows.map(r => `
        <tr>
          <td><span class="legend-dot" style="background:${BUCKET_COLOR.get(r.bucket)}"></span>${r.bucket}</td>
          <td>${formatCurrency(r.total)}</td>
          <td>${formatCurrency(r.avg)}</td>
        </tr>`).join("")}
    </tbody>
    <tfoot><tr><td>Total</td><td>${formatCurrency(grandTotal)}</td><td>${formatCurrency(grandAvg)}</td></tr></tfoot>`;
  card.appendChild(table);
}
