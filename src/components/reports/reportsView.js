import { formatCurrency } from "../../utils/currency.js";

const PALETTE = [
  "#6366f1", "#f28e2c", "#e15759", "#59a14f", "#76b7b2",
  "#edc948", "#af7aa1", "#ff9da7", "#9c755f", "#54a0ff",
  "#fd9644", "#2bcbba", "#a29bfe", "#fd79a8", "#00b4d8",
];

function monthLabel(yyyyMM) {
  const [y, m] = yyyyMM.split("-");
  const d = new Date(+y, +m - 1, 1);
  return d.toLocaleString("en-US", { month: "short", year: "2-digit" });
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

export function renderReportsView(container, accounts, categories, onBack) {
  container.innerHTML = "";

  // ── Header ──────────────────────────────────────────────────────────────────
  const header = document.createElement("div");
  header.className = "view-header";
  header.innerHTML = `
    <div class="detail-title-row">
      <div style="display:flex;align-items:center;gap:0.75rem">
        <button class="btn btn-ghost btn-sm" id="back-btn">&#8592; Back</button>
        <h1>Spending Report</h1>
      </div>
    </div>
  `;
  container.appendChild(header);
  header.querySelector("#back-btn").addEventListener("click", onBack);

  // ── Data Processing ──────────────────────────────────────────────────────────
  const ledgers = accounts.filter(a => a.accountType === "ledger");

  if (ledgers.length === 0) {
    const el = document.createElement("div");
    el.className = "empty-state";
    el.innerHTML = "<p>No ledger accounts found. Add a ledger account to see spending reports.</p>";
    container.appendChild(el);
    return;
  }

  // Current year: only show Jan through current month
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-indexed
  const yearPrefix = `${currentYear}-`;

  // Category and subcategory lookups
  const catById = new Map(categories.map(c => [c.id, c.name]));
  const subcatById = new Map();
  categories.forEach(cat => {
    cat.subcategories.forEach(sub => subcatById.set(sub.id, sub.name));
  });

  // Collect current-year transactions excluding Transfer category
  const txs = [];
  ledgers.forEach(acct => {
    (acct.transactions || []).forEach(tx => {
      const month = (tx.date || "").slice(0, 7);
      if (month.length !== 7 || !month.startsWith(yearPrefix)) return;
      const catName = tx.categoryId ? catById.get(tx.categoryId) : null;
      if (catName === "Transfer") return;
      const subcatName = tx.subcategoryId ? subcatById.get(tx.subcategoryId) : null;
      txs.push({
        month,
        amount: tx.amount,
        cat: catName || "Uncategorized",
        subcat: subcatName || "Other",
      });
    });
  });

  if (txs.length === 0) {
    const el = document.createElement("div");
    el.className = "empty-state";
    el.innerHTML = `<p>No transactions for ${currentYear} (excluding Transfers).</p>`;
    container.appendChild(el);
    return;
  }

  // Fixed month list: Jan through current month (fills gaps with empty bars)
  const months = [];
  for (let m = 1; m <= currentMonth; m++) {
    months.push(`${currentYear}-${String(m).padStart(2, "0")}`);
  }

  // Group: month → category → subcategory → total
  const monthMap = new Map();
  txs.forEach(({ month, amount, cat, subcat }) => {
    if (!monthMap.has(month)) monthMap.set(month, new Map());
    const cm = monthMap.get(month);
    if (!cm.has(cat)) cm.set(cat, new Map());
    const sm = cm.get(cat);
    sm.set(subcat, (sm.get(subcat) || 0) + amount);
  });

  // All categories across current year, sorted
  const allCats = [...new Set(txs.map(t => t.cat))].sort();
  const catColor = new Map(allCats.map((c, i) => [c, PALETTE[i % PALETTE.length]]));

  // Build chart data: net-negative categories only, with subcategory breakdown
  const chartData = months.map(month => {
    const cm = monthMap.get(month) || new Map();
    let total = 0;
    const segments = [];
    allCats.forEach(cat => {
      const sm = cm.get(cat) || new Map();
      let catNet = 0;
      sm.forEach(subTotal => { catNet += subTotal; });
      if (catNet < 0) {
        const v = Math.abs(catNet);
        const subcats = [];
        sm.forEach((subTotal, subName) => {
          if (subTotal < 0) subcats.push({ name: subName, v: Math.abs(subTotal) });
        });
        subcats.sort((a, b) => b.v - a.v);
        segments.push({ cat, v, subcats });
        total += v;
      }
    });
    return { month, segments, total };
  });

  const maxTotal = Math.max(...chartData.map(d => d.total), 0);

  // ── Section ──────────────────────────────────────────────────────────────────
  const section = document.createElement("div");
  section.className = "report-section";
  container.appendChild(section);

  // ── Chart wrap (position:relative so tooltip can be positioned inside) ───────
  const svgWrap = document.createElement("div");
  svgWrap.className = "report-chart-wrap";
  svgWrap.style.position = "relative";
  section.appendChild(svgWrap);

  // ── Tooltip (lives in svgWrap but outside <svg> so it survives redraws) ──────
  const tooltip = document.createElement("div");
  tooltip.className = "report-tooltip";
  svgWrap.appendChild(tooltip);

  const MARGIN = { top: 24, right: 16, bottom: 56, left: 72 };
  const SVG_H = 380;

  function buildTooltipHTML(d) {
    let html = `<div class="rtt-month">${monthLabelFull(d.month)}</div>`;
    html += `<div class="rtt-total">Total: <strong>${formatCurrency(d.total)}</strong></div>`;
    if (d.segments.length > 0) {
      html += `<div class="rtt-divider"></div>`;
      d.segments.forEach(seg => {
        html += `
          <div class="rtt-cat">
            <span class="legend-dot" style="background:${catColor.get(seg.cat)}"></span>
            <span class="rtt-cat-name">${seg.cat}</span>
            <span class="rtt-val">${formatCurrency(seg.v)}</span>
          </div>`;
        seg.subcats.forEach(sub => {
          html += `
            <div class="rtt-sub">
              <span class="rtt-sub-name">${sub.name}</span>
              <span class="rtt-val">${formatCurrency(sub.v)}</span>
            </div>`;
        });
      });
    }
    return html;
  }

  function showTooltip(d, svgCx, chartW) {
    tooltip.innerHTML = buildTooltipHTML(d);
    tooltip.style.display = "block";
    // Center tooltip on bar, but keep it within the chart area
    const pct = svgCx / chartW;
    const tipLeft = MARGIN.left + svgCx;
    tooltip.style.top = `${MARGIN.top}px`;
    tooltip.style.left = `${tipLeft}px`;
    tooltip.style.transform = pct < 0.2
      ? "translateX(0)"
      : pct > 0.8
        ? "translateX(-100%)"
        : "translateX(-50%)";
  }

  function hideTooltip() {
    tooltip.style.display = "none";
  }

  function drawChart() {
    const oldSvg = svgWrap.querySelector("svg");
    if (oldSvg) oldSvg.remove();

    const W = svgWrap.clientWidth || 800;
    const cW = W - MARGIN.left - MARGIN.right;
    const cH = SVG_H - MARGIN.top - MARGIN.bottom;

    const step = niceStep(maxTotal);
    const yMax = maxTotal > 0 ? Math.ceil(maxTotal / step) * step : step;
    const yTicks = [];
    for (let v = 0; v <= yMax; v += step) yTicks.push(v);

    const n = months.length || 1;
    const slotW = cW / n;
    const barW = Math.min(Math.max(slotW * 0.65, 6), 80);
    const yPx = v => cH - (v / yMax) * cH;

    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("width", W);
    svg.setAttribute("height", SVG_H);

    const g = document.createElementNS(NS, "g");
    g.setAttribute("transform", `translate(${MARGIN.left},${MARGIN.top})`);
    svg.appendChild(g);

    // Y-axis gridlines + labels
    yTicks.forEach(v => {
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
      txt.textContent = v >= 1000
        ? `$${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`
        : `$${v}`;
      g.appendChild(txt);
    });

    // Y axis line
    const yLine = document.createElementNS(NS, "line");
    yLine.setAttribute("x1", 0); yLine.setAttribute("x2", 0);
    yLine.setAttribute("y1", 0); yLine.setAttribute("y2", cH);
    yLine.setAttribute("stroke", "#2e3248");
    g.appendChild(yLine);

    // One <g> per column for hover events
    chartData.forEach((d, i) => {
      const cx = i * slotW + slotW / 2;
      const x = cx - barW / 2;

      const colGroup = document.createElementNS(NS, "g");

      // Invisible hover area covering the full slot width
      const hoverRect = document.createElementNS(NS, "rect");
      hoverRect.setAttribute("x", i * slotW);
      hoverRect.setAttribute("y", 0);
      hoverRect.setAttribute("width", slotW);
      hoverRect.setAttribute("height", cH);
      hoverRect.setAttribute("fill", "transparent");
      colGroup.appendChild(hoverRect);

      // Stacked bar segments
      let yBase = cH;
      d.segments.forEach(seg => {
        const segH = (seg.v / yMax) * cH;
        yBase -= segH;
        const rect = document.createElementNS(NS, "rect");
        rect.setAttribute("x", x);
        rect.setAttribute("y", yBase);
        rect.setAttribute("width", barW);
        rect.setAttribute("height", segH);
        rect.setAttribute("fill", catColor.get(seg.cat));
        rect.setAttribute("rx", 2);
        colGroup.appendChild(rect);
      });

      // Total label above bar
      if (d.total > 0) {
        const ty = yPx(d.total);
        if (ty > 14) {
          const lbl = document.createElementNS(NS, "text");
          lbl.setAttribute("x", cx);
          lbl.setAttribute("y", ty - 4);
          lbl.setAttribute("text-anchor", "middle");
          lbl.setAttribute("fill", "#718096");
          lbl.setAttribute("font-size", "10");
          lbl.textContent = d.total >= 1000
            ? `$${(d.total / 1000).toFixed(1)}k`
            : `$${Math.round(d.total)}`;
          colGroup.appendChild(lbl);
        }
      }

      // X-axis label (rotated)
      const lx = cx;
      const ly = cH + 10;
      const xlabel = document.createElementNS(NS, "text");
      xlabel.setAttribute("x", lx);
      xlabel.setAttribute("y", ly);
      xlabel.setAttribute("text-anchor", "end");
      xlabel.setAttribute("fill", "#718096");
      xlabel.setAttribute("font-size", "11");
      xlabel.setAttribute("transform", `rotate(-40,${lx},${ly})`);
      xlabel.textContent = monthLabel(d.month);
      colGroup.appendChild(xlabel);

      // Hover events
      if (d.total > 0) {
        colGroup.addEventListener("mouseenter", () => showTooltip(d, cx, cW));
        colGroup.addEventListener("mouseleave", hideTooltip);
      }

      g.appendChild(colGroup);
    });

    // Insert SVG before the tooltip div
    svgWrap.insertBefore(svg, tooltip);
  }

  drawChart();

  const ro = new ResizeObserver(() => drawChart());
  ro.observe(svgWrap);

  // ── Legend ───────────────────────────────────────────────────────────────────
  const legend = document.createElement("div");
  legend.className = "report-legend";
  allCats.forEach(cat => {
    const item = document.createElement("div");
    item.className = "legend-item";
    item.innerHTML = `
      <span class="legend-dot" style="background:${catColor.get(cat)}"></span>
      <span>${cat}</span>
    `;
    legend.appendChild(item);
  });
  section.appendChild(legend);
}
