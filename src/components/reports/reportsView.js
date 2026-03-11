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

  // Category id → name lookup
  const catById = new Map(categories.map(c => [c.id, c.name]));

  // Collect all transactions excluding the Transfer category
  const txs = [];
  ledgers.forEach(acct => {
    (acct.transactions || []).forEach(tx => {
      const catName = tx.categoryId ? catById.get(tx.categoryId) : null;
      if (catName === "Transfer") return;
      const month = (tx.date || "").slice(0, 7);
      if (month.length !== 7) return;
      txs.push({ month, amount: tx.amount, cat: catName || "Uncategorized" });
    });
  });

  if (txs.length === 0) {
    const el = document.createElement("div");
    el.className = "empty-state";
    el.innerHTML = "<p>No transactions to display (excluding Transfers).</p>";
    container.appendChild(el);
    return;
  }

  // Group: month → category → total
  const monthMap = new Map();
  txs.forEach(({ month, amount, cat }) => {
    if (!monthMap.has(month)) monthMap.set(month, new Map());
    const cm = monthMap.get(month);
    cm.set(cat, (cm.get(cat) || 0) + amount);
  });

  const months = [...monthMap.keys()].sort();

  // All categories sorted, with assigned colors
  const allCats = [...new Set(txs.map(t => t.cat))].sort();
  const catColor = new Map(allCats.map((c, i) => [c, PALETTE[i % PALETTE.length]]));

  // Per month: only include categories with net-negative totals (expenses
  // exceed credits). Show absolute value so bars are positive heights.
  const chartData = months.map(month => {
    const cm = monthMap.get(month);
    let total = 0;
    const segments = [];
    allCats.forEach(cat => {
      const net = cm.get(cat) || 0;
      if (net < 0) {
        const v = Math.abs(net);
        segments.push({ cat, v });
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

  // ── SVG Chart ────────────────────────────────────────────────────────────────
  const MARGIN = { top: 24, right: 16, bottom: 56, left: 72 };
  const SVG_H = 380;

  const svgWrap = document.createElement("div");
  svgWrap.className = "report-chart-wrap";
  section.appendChild(svgWrap);

  function drawChart() {
    svgWrap.innerHTML = "";
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
      line.setAttribute("x1", 0);
      line.setAttribute("x2", cW);
      line.setAttribute("y1", y);
      line.setAttribute("y2", y);
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

    // Bars
    chartData.forEach((d, i) => {
      const cx = i * slotW + slotW / 2;
      const x = cx - barW / 2;
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

        const title = document.createElementNS(NS, "title");
        title.textContent = `${seg.cat}: ${formatCurrency(seg.v)}`;
        rect.appendChild(title);
        g.appendChild(rect);
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
          g.appendChild(lbl);
        }
      }

      // X-axis label (rotated for readability)
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
      g.appendChild(xlabel);
    });

    svgWrap.appendChild(svg);
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
