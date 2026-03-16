import { formatCurrency } from "../../utils/currency.js";

const PALETTE = [
  "#6366f1", "#f28e2c", "#e15759", "#59a14f", "#76b7b2",
  "#edc948", "#af7aa1", "#ff9da7", "#9c755f", "#54a0ff",
  "#fd9644", "#2bcbba", "#a29bfe", "#fd79a8", "#00b4d8",
];

const MAX_PAYEES_FOR_STACK = 10;

// ── Persisted state across navigations ────────────────────────────────────────
let _subcatMode      = "ytd"; // "ytd" | "last12"
let _selectedCatId   = null;
let _selectedSubId   = null;

// ── Tiny helpers (mirrors reportsView.js) ─────────────────────────────────────
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
function subtractMonths(year, month, n) {
  let m = month - n, y = year;
  while (m <= 0) { m += 12; y--; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

// ── Main export ───────────────────────────────────────────────────────────────
export function renderSubcatSpendView(container, accounts, categories, onBack, payees = []) {
  container.innerHTML = "";

  function rerender() {
    renderSubcatSpendView(container, accounts, categories, onBack, payees);
  }

  // ── Header ──────────────────────────────────────────────────────────────────
  const header = document.createElement("div");
  header.className = "view-header";

  const titleRow = document.createElement("div");
  titleRow.className = "detail-title-row";
  titleRow.style.flexWrap = "wrap";
  titleRow.style.gap = "0.75rem";

  const leftGroup = document.createElement("div");
  leftGroup.style.cssText = "display:flex;align-items:center;gap:0.75rem";

  const h1 = document.createElement("h1");
  h1.textContent = "Subcategory Spend";
  leftGroup.appendChild(h1);

  // Mode toggle (YTD / Last 12 Months)
  const modeToggle = document.createElement("div");
  modeToggle.className = "report-mode-toggle";

  const ytdBtn = document.createElement("button");
  ytdBtn.className = "report-mode-btn" + (_subcatMode === "ytd" ? " active" : "");
  ytdBtn.textContent = "Year to Date";
  ytdBtn.addEventListener("click", () => { _subcatMode = "ytd"; rerender(); });

  const l12Btn = document.createElement("button");
  l12Btn.className = "report-mode-btn" + (_subcatMode === "last12" ? " active" : "");
  l12Btn.textContent = "Last 12 Months";
  l12Btn.addEventListener("click", () => { _subcatMode = "last12"; rerender(); });

  modeToggle.appendChild(ytdBtn);
  modeToggle.appendChild(l12Btn);

  titleRow.appendChild(leftGroup);
  titleRow.appendChild(modeToggle);
  header.appendChild(titleRow);
  container.appendChild(header);

  // ── Category / Subcategory Selectors ─────────────────────────────────────────
  const filterCats = categories.filter(c => c.name !== "Transfer" && c.subcategories.length > 0);

  // Initialise / validate persisted selection
  if (!_selectedCatId || !filterCats.find(c => c.id === _selectedCatId)) {
    _selectedCatId = filterCats[0]?.id ?? null;
    _selectedSubId = null;
  }
  const selCat = filterCats.find(c => c.id === _selectedCatId) ?? null;
  if (_selectedSubId && !selCat?.subcategories.find(s => s.id === _selectedSubId)) {
    _selectedSubId = null;
  }
  if (!_selectedSubId) {
    _selectedSubId = selCat?.subcategories[0]?.id ?? null;
  }

  const filterRow = document.createElement("div");
  filterRow.className = "subcat-filter-row";

  // Category select
  const catLbl = document.createElement("label");
  catLbl.className = "subcat-filter-label";
  catLbl.textContent = "Category";
  const catSel = document.createElement("select");
  catSel.className = "form-select";
  filterCats.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.name;
    if (c.id === _selectedCatId) opt.selected = true;
    catSel.appendChild(opt);
  });
  catSel.addEventListener("change", () => {
    _selectedCatId = catSel.value;
    _selectedSubId = null;
    rerender();
  });
  catLbl.appendChild(catSel);

  // Subcategory select
  const subLbl = document.createElement("label");
  subLbl.className = "subcat-filter-label";
  subLbl.textContent = "Subcategory";
  const subSel = document.createElement("select");
  subSel.className = "form-select";
  (selCat?.subcategories ?? []).forEach(s => {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.name;
    if (s.id === _selectedSubId) opt.selected = true;
    subSel.appendChild(opt);
  });
  subSel.addEventListener("change", () => {
    _selectedSubId = subSel.value || null;
    rerender();
  });
  subLbl.appendChild(subSel);

  filterRow.appendChild(catLbl);
  filterRow.appendChild(subLbl);
  container.appendChild(filterRow);

  // ── Guard: nothing selected ───────────────────────────────────────────────────
  if (!_selectedCatId || !_selectedSubId) {
    const el = document.createElement("div");
    el.className = "empty-state";
    el.innerHTML = "<p>Select a category and subcategory to view spending.</p>";
    container.appendChild(el);
    return;
  }

  // ── Date range ───────────────────────────────────────────────────────────────
  const now = new Date();
  const currentYear  = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const currentMonthStr = `${currentYear}-${String(currentMonth).padStart(2, "0")}`;

  let months, startMonthStr, emptyMsg;
  if (_subcatMode === "ytd") {
    months = [];
    for (let m = 1; m <= currentMonth; m++) {
      months.push(`${currentYear}-${String(m).padStart(2, "0")}`);
    }
    startMonthStr = months[0];
    emptyMsg = `No expenses in this subcategory for ${currentYear}.`;
  } else {
    startMonthStr = subtractMonths(currentYear, currentMonth, 12);
    months = [];
    let [iterY, iterM] = startMonthStr.split("-").map(Number);
    while (iterY < currentYear || (iterY === currentYear && iterM <= currentMonth)) {
      months.push(`${iterY}-${String(iterM).padStart(2, "0")}`);
      if (++iterM > 12) { iterM = 1; iterY++; }
    }
    emptyMsg = "No expenses in this subcategory for the last 12 months.";
  }

  // ── Normalise payee names against the registered payees list ─────────────────
  // Transactions may have legacy/differently-cased payee names from before a
  // rename. Build a case-insensitive lookup so "KROGER" and "Kroger" both
  // resolve to whatever canonical name is stored in the payees list.
  const payeeNormMap = new Map(); // lowercase → canonical name
  payees.forEach(p => payeeNormMap.set(p.name.toLowerCase(), p.name));
  const normaliseName = raw =>
    payeeNormMap.get((raw || "").toLowerCase()) || raw || "Unassigned";

  // ── Collect transactions ─────────────────────────────────────────────────────
  const ledgers = accounts.filter(a => a.accountType === "ledger");
  const txs = [];
  ledgers.forEach(acct => {
    (acct.transactions || []).forEach(tx => {
      if (tx.excluded) return;
      if (tx.subcategoryId !== _selectedSubId) return;
      if (tx.amount >= 0) return; // expenses only
      const month = (tx.date || "").slice(0, 7);
      if (month.length !== 7 || month < startMonthStr || month > currentMonthStr) return;
      txs.push({ month, amount: Math.abs(tx.amount), payee: normaliseName(tx.payeeName) });
    });
  });

  if (txs.length === 0) {
    const el = document.createElement("div");
    el.className = "empty-state";
    el.innerHTML = `<p>${emptyMsg}</p>`;
    container.appendChild(el);
    return;
  }

  // ── Payee aggregation ────────────────────────────────────────────────────────
  const payeeTotals = new Map();
  txs.forEach(({ payee, amount }) => {
    payeeTotals.set(payee, (payeeTotals.get(payee) || 0) + amount);
  });
  // Sort payees largest→smallest total; stack is rendered bottom-up so largest is at the bottom
  const allPayees = [...payeeTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);

  const useStack = allPayees.length <= MAX_PAYEES_FOR_STACK;
  const payeeColor = new Map(allPayees.map((p, i) => [p, PALETTE[i % PALETTE.length]]));

  // ── Month → payee → total ────────────────────────────────────────────────────
  const monthMap = new Map();
  txs.forEach(({ month, amount, payee }) => {
    if (!monthMap.has(month)) monthMap.set(month, new Map());
    const pm = monthMap.get(month);
    pm.set(payee, (pm.get(payee) || 0) + amount);
  });

  const chartData = months.map(month => {
    const pm = monthMap.get(month) || new Map();
    let total = 0;
    const segments = [];
    if (useStack) {
      allPayees.forEach(payee => {
        const v = pm.get(payee) || 0;
        if (v > 0) { segments.push({ payee, v }); total += v; }
      });
    } else {
      pm.forEach(v => { total += v; });
    }
    return { month, segments, total };
  });

  const maxTotal = Math.max(...chartData.map(d => d.total), 0);

  // ── Chart section ────────────────────────────────────────────────────────────
  const section = document.createElement("div");
  section.className = "report-section";
  container.appendChild(section);

  const svgWrap = document.createElement("div");
  svgWrap.className = "report-chart-wrap";
  svgWrap.style.position = "relative";
  section.appendChild(svgWrap);

  const tooltip = document.createElement("div");
  tooltip.className = "report-tooltip";
  svgWrap.appendChild(tooltip);

  const MARGIN = { top: 24, right: 16, bottom: 56, left: 72 };
  const SVG_H  = 380;

  function buildTooltipHTML(d) {
    let html = `<div class="rtt-month">${monthLabelFull(d.month)}</div>`;
    if (useStack && d.segments.length > 0) {
      html += `<div class="rtt-divider"></div>`;
      d.segments.forEach(seg => {
        html += `
          <div class="rtt-cat">
            <span class="legend-dot" style="background:${payeeColor.get(seg.payee)}"></span>
            <span class="rtt-cat-name">${seg.payee}</span>
            <span class="rtt-val">${formatCurrency(seg.v)}</span>
          </div>`;
      });
      html += `
        <div class="rtt-divider"></div>
        <div class="rtt-cat">
          <span class="rtt-cat-name" style="font-weight:600">Total</span>
          <span class="rtt-val" style="font-weight:600">${formatCurrency(d.total)}</span>
        </div>`;
    } else {
      html += `
        <div class="rtt-cat">
          <span class="rtt-cat-name">Total</span>
          <span class="rtt-val">${formatCurrency(d.total)}</span>
        </div>`;
    }
    return html;
  }

  function showTooltip(d, svgCx, chartW) {
    tooltip.innerHTML = buildTooltipHTML(d);
    tooltip.style.display = "block";
    const pct = svgCx / chartW;
    tooltip.style.top  = `${MARGIN.top}px`;
    tooltip.style.left = `${MARGIN.left + svgCx}px`;
    tooltip.style.transform = pct < 0.2
      ? "translateX(0)"
      : pct > 0.8
        ? "translateX(-100%)"
        : "translateX(-50%)";
  }
  function hideTooltip() { tooltip.style.display = "none"; }

  function drawChart() {
    const oldSvg = svgWrap.querySelector("svg");
    if (oldSvg) oldSvg.remove();

    const W  = svgWrap.clientWidth || 700;
    const cW = W - MARGIN.left - MARGIN.right;
    const cH = SVG_H - MARGIN.top - MARGIN.bottom;

    const step = niceStep(maxTotal);
    const yMax = maxTotal > 0 ? Math.ceil(maxTotal / step) * step : step;
    const yTicks = [];
    for (let v = 0; v <= yMax; v += step) yTicks.push(v);

    const n     = months.length || 1;
    const slotW = cW / n;
    const barW  = Math.min(Math.max(slotW * 0.65, 6), 80);
    const yPx   = v => cH - (v / yMax) * cH;

    const NS  = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("width", W);
    svg.setAttribute("height", SVG_H);

    const g = document.createElementNS(NS, "g");
    g.setAttribute("transform", `translate(${MARGIN.left},${MARGIN.top})`);
    svg.appendChild(g);

    // Y-axis gridlines + labels
    yTicks.forEach(v => {
      const y    = yPx(v);
      const line = document.createElementNS(NS, "line");
      line.setAttribute("x1", 0); line.setAttribute("x2", cW);
      line.setAttribute("y1", y); line.setAttribute("y2", y);
      line.setAttribute("stroke", "#2e3248");
      if (v > 0) line.setAttribute("stroke-dasharray", "4,3");
      g.appendChild(line);

      const txt = document.createElementNS(NS, "text");
      txt.setAttribute("x", -8); txt.setAttribute("y", y); txt.setAttribute("dy", "0.35em");
      txt.setAttribute("text-anchor", "end");
      txt.setAttribute("fill", "#718096");
      txt.setAttribute("font-size", "11");
      txt.textContent = v >= 1000
        ? `$${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`
        : `$${v}`;
      g.appendChild(txt);
    });

    // Y-axis line
    const yLine = document.createElementNS(NS, "line");
    yLine.setAttribute("x1", 0); yLine.setAttribute("x2", 0);
    yLine.setAttribute("y1", 0); yLine.setAttribute("y2", cH);
    yLine.setAttribute("stroke", "#2e3248");
    g.appendChild(yLine);

    // Current-month column highlight
    const curIdx = months.indexOf(currentMonthStr);
    if (curIdx >= 0) {
      const cx = curIdx * slotW + slotW / 2;
      const hi = document.createElementNS(NS, "rect");
      hi.setAttribute("x", cx - slotW / 2); hi.setAttribute("y", 0);
      hi.setAttribute("width", slotW);       hi.setAttribute("height", cH);
      hi.setAttribute("fill", "rgba(99,102,241,0.06)");
      g.appendChild(hi);
    }

    // Bars
    chartData.forEach((d, i) => {
      const cx        = i * slotW + slotW / 2;
      const x         = cx - barW / 2;
      const isCurrent = d.month === currentMonthStr;
      const colGroup  = document.createElementNS(NS, "g");

      if (useStack) {
        let yBase = cH;
        d.segments.forEach(seg => {
          const segH = (seg.v / yMax) * cH;
          yBase -= segH;
          const rect = document.createElementNS(NS, "rect");
          rect.setAttribute("x", x);     rect.setAttribute("y", yBase);
          rect.setAttribute("width", barW); rect.setAttribute("height", segH);
          rect.setAttribute("fill", payeeColor.get(seg.payee));
          rect.setAttribute("rx", 2);
          if (isCurrent) rect.setAttribute("opacity", "0.7");
          rect.style.cursor = "default";
          rect.addEventListener("mouseenter", () => showTooltip(d, cx, cW));
          rect.addEventListener("mouseleave", hideTooltip);
          colGroup.appendChild(rect);
        });
      } else if (d.total > 0) {
        const barH = (d.total / yMax) * cH;
        const rect = document.createElementNS(NS, "rect");
        rect.setAttribute("x", x);       rect.setAttribute("y", cH - barH);
        rect.setAttribute("width", barW); rect.setAttribute("height", barH);
        rect.setAttribute("fill", PALETTE[0]);
        rect.setAttribute("rx", 2);
        if (isCurrent) rect.setAttribute("opacity", "0.7");
        rect.style.cursor = "default";
        rect.addEventListener("mouseenter", () => showTooltip(d, cx, cW));
        rect.addEventListener("mouseleave", hideTooltip);
        colGroup.appendChild(rect);
      }

      // Total label above bar
      if (d.total > 0) {
        const ty = yPx(d.total);
        if (ty > 14) {
          const lbl = document.createElementNS(NS, "text");
          lbl.setAttribute("x", cx);           lbl.setAttribute("y", ty - 4);
          lbl.setAttribute("text-anchor", "middle");
          lbl.setAttribute("fill", isCurrent ? "#6366f1" : "#718096");
          lbl.setAttribute("font-size", "10");
          lbl.textContent = d.total >= 1000
            ? `$${(d.total / 1000).toFixed(1)}k`
            : `$${Math.round(d.total)}`;
          colGroup.appendChild(lbl);
        }
      }

      // X-axis label (rotated)
      const lx = cx, ly = cH + 10;
      const xlabel = document.createElementNS(NS, "text");
      xlabel.setAttribute("x", lx);       xlabel.setAttribute("y", ly);
      xlabel.setAttribute("text-anchor", "end");
      xlabel.setAttribute("fill", isCurrent ? "#6366f1" : "#718096");
      xlabel.setAttribute("font-size", "11");
      xlabel.setAttribute("transform", `rotate(-40,${lx},${ly})`);
      if (isCurrent) xlabel.setAttribute("font-weight", "600");
      xlabel.textContent = monthLabel(d.month);
      colGroup.appendChild(xlabel);

      g.appendChild(colGroup);
    });

    svgWrap.insertBefore(svg, tooltip);
  }

  drawChart();
  const ro = new ResizeObserver(() => drawChart());
  ro.observe(svgWrap);

  // ── Legend ───────────────────────────────────────────────────────────────────
  if (useStack && allPayees.length > 0) {
    const legendWrap = document.createElement("div");
    legendWrap.className = "report-legend-wrap";

    const legendHeader = document.createElement("div");
    legendHeader.className = "report-legend-header";
    const legendTitle = document.createElement("span");
    legendTitle.className = "report-legend-title";
    legendTitle.textContent = "Payees";
    legendHeader.appendChild(legendTitle);
    legendWrap.appendChild(legendHeader);

    const legend = document.createElement("div");
    legend.className = "report-legend";
    allPayees.forEach(payee => {
      const item = document.createElement("div");
      item.className = "legend-item";
      item.innerHTML = `
        <span class="legend-dot" style="background:${payeeColor.get(payee)}"></span>
        <span>${payee}</span>
      `;
      legend.appendChild(item);
    });
    legendWrap.appendChild(legend);
    section.appendChild(legendWrap);
  } else if (!useStack) {
    const note = document.createElement("p");
    note.className = "dim";
    note.style.cssText = "font-size:0.82rem;margin-top:0.5rem";
    note.textContent = `${allPayees.length} payees — bars show monthly totals only (breakdown shown when 10 or fewer payees).`;
    section.appendChild(note);
  }
}
