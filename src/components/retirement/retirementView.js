import { formatCurrency } from "../../utils/currency.js";

// ── Shared persisted state ─────────────────────────────────────────────────────
let _s = {
  currentAge:     60,
  annualExpenses: 80000,
  taxable:        500000,
  taxFree:        300000,
  taxDeferred:    700000,
  cashYears:      2,
  nominalGrowth:  7,
  inflation:      3,
  taxRate:        22,
  lumpSums:  [],   // [{ age, amount }]
  annuities: [],   // [{ startAge, amount }]
};

// ── Per-account simulation ─────────────────────────────────────────────────────
// Withdrawal order: Taxable → Tax-Deferred (grossed up for taxes) → Tax-Free
// Returns array of { age, taxable, taxDeferred, taxFree, total }
// All values are in today's dollars (deflated by inflation).
function runSimulation(s) {
  const g    = s.nominalGrowth / 100;
  const infl = s.inflation     / 100;
  const tax  = Math.min(s.taxRate / 100, 0.99);

  let taxable    = s.taxable;
  let taxDeferred = s.taxDeferred;
  let taxFree    = s.taxFree;

  const MAX_AGE = 100;
  const data = [];

  for (let age = s.currentAge; age <= MAX_AGE; age++) {
    const yi         = age - s.currentAge;
    const inflFactor = Math.pow(1 + infl, yi);

    // Record start-of-year values in today's dollars
    const total = taxable + taxDeferred + taxFree;
    data.push({
      age,
      taxable:    Math.max(0, taxable    / inflFactor),
      taxDeferred: Math.max(0, taxDeferred / inflFactor),
      taxFree:    Math.max(0, taxFree    / inflFactor),
      total:      Math.max(0, total      / inflFactor),
    });

    if (total <= 0) break;

    // ── Lump sums this year — credited to taxable account ──────────────────
    const lump = s.lumpSums
      .filter(l => l.age === age)
      .reduce((sum, l) => sum + l.amount * inflFactor, 0);
    taxable += lump;

    // ── Annuity income this year ────────────────────────────────────────────
    const annuityIncome = s.annuities
      .filter(a => age >= a.startAge)
      .reduce((sum, a) => sum + a.amount * inflFactor, 0);

    const realExpenses = s.annualExpenses * inflFactor;

    // ── Cash buffer comes out of the taxable account (earns 0) ─────────────
    const cashTarget   = realExpenses * s.cashYears;
    const taxableCash  = Math.min(taxable, cashTarget);
    const taxableInv   = Math.max(0, taxable - taxableCash);

    // ── Grow invested portions ──────────────────────────────────────────────
    taxable    = taxableCash + taxableInv   * (1 + g);
    taxDeferred = taxDeferred               * (1 + g);
    taxFree    = taxFree                    * (1 + g);

    // ── Withdrawals ─────────────────────────────────────────────────────────
    let needed = Math.max(0, realExpenses - annuityIncome);

    // 1. From taxable (no tax grossup)
    if (needed > 0) {
      const draw = Math.min(taxable, needed);
      taxable -= draw;
      needed  -= draw;
    }

    // 2. From tax-deferred (gross up so we net what's needed after tax)
    if (needed > 0) {
      const grossNeeded = needed / (1 - tax);
      const draw        = Math.min(taxDeferred, grossNeeded);
      taxDeferred -= draw;
      needed      -= draw * (1 - tax);
    }

    // 3. From tax-free (no tax grossup)
    if (needed > 0) {
      const draw = Math.min(taxFree, needed);
      taxFree -= draw;
      needed  -= draw;
    }

    taxable    = Math.max(0, taxable);
    taxDeferred = Math.max(0, taxDeferred);
    taxFree    = Math.max(0, taxFree);
  }

  return data;
}

// ── Tiny helpers ──────────────────────────────────────────────────────────────
function niceStep(maxVal, steps = 5) {
  if (maxVal <= 0) return 100000;
  const rough = maxVal / steps;
  const mag   = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm  = rough / mag;
  const nice  = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return nice * mag;
}

function fmtShort(v) {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}k`;
  return `$${Math.round(v)}`;
}

function numInput(value, onChange, opts = {}) {
  const el = document.createElement("input");
  el.type  = "number";
  el.className = "form-input ret-num-input";
  el.value = value;
  if (opts.min !== undefined) el.min = opts.min;
  if (opts.max !== undefined) el.max = opts.max;
  if (opts.step) el.step = opts.step;
  el.addEventListener("input", () => {
    const v = parseFloat(el.value);
    if (!isNaN(v)) onChange(v);
  });
  return el;
}

function retSection(title) {
  const sec = document.createElement("div");
  sec.className = "ret-section";
  const hd = document.createElement("h3");
  hd.className = "ret-section-title";
  hd.textContent = title;
  sec.appendChild(hd);
  return sec;
}

// ── INPUTS PAGE ───────────────────────────────────────────────────────────────
export function renderRetirementInputs(container, onViewSimulation) {
  container.innerHTML = "";

  const header = document.createElement("div");
  header.className = "view-header";
  const h1 = document.createElement("h1");
  h1.textContent = "Retirement Inputs";
  header.appendChild(h1);
  container.appendChild(header);

  const page = document.createElement("div");
  page.className = "ret-inputs-page";
  container.appendChild(page);

  // ── Starting Conditions ─────────────────────────────────────────────────────
  const secStart = retSection("Starting Conditions");
  const startGrid = document.createElement("div");
  startGrid.className = "ret-two-col";

  startGrid.appendChild(retField("Current Age",
    numInput(_s.currentAge, v => { _s.currentAge = v; }, { min: 20, max: 90, step: 1 })));
  startGrid.appendChild(retField("Annual Expenses (today's $)",
    numInput(_s.annualExpenses, v => { _s.annualExpenses = v; }, { min: 0, step: 1000 })));
  secStart.appendChild(startGrid);
  page.appendChild(secStart);

  // ── Account Balances ────────────────────────────────────────────────────────
  const secAccts = retSection("Account Balances");
  const acctGrid = document.createElement("div");
  acctGrid.className = "ret-acct-grid";
  [
    ["Taxable",      "taxable",     "--color-taxable"],
    ["Tax-Free",     "taxFree",     "--color-tax-free"],
    ["Tax-Deferred", "taxDeferred", "--color-tax-deferred"],
  ].forEach(([label, key, colorVar]) => {
    const inp = numInput(_s[key], v => { _s[key] = v; }, { min: 0, step: 1000 });
    inp.classList.add("ret-acct-input");
    inp.style.setProperty("--acct-color", `var(${colorVar})`);
    const cell = document.createElement("div");
    cell.className = "ret-acct-cell";
    const lbl = document.createElement("div");
    lbl.className = "ret-acct-label";
    lbl.style.color = `var(${colorVar})`;
    lbl.textContent = label;
    cell.appendChild(lbl);
    cell.appendChild(inp);
    acctGrid.appendChild(cell);
  });
  secAccts.appendChild(acctGrid);
  const acctNote = document.createElement("p");
  acctNote.className = "ret-note";
  acctNote.textContent = "Withdrawal order: Taxable → Tax-Deferred → Tax-Free";
  secAccts.appendChild(acctNote);
  page.appendChild(secAccts);

  // ── Assumptions ─────────────────────────────────────────────────────────────
  const secAssump = retSection("Assumptions");
  const assumpGrid = document.createElement("div");
  assumpGrid.className = "ret-assump-grid";
  [
    ["Years of Expenses in Cash", "cashYears",     { min: 0, max: 10,  step: 0.5 }, "yrs"],
    ["Nominal Growth Rate",       "nominalGrowth", { min: 0, max: 20,  step: 0.1 }, "%"  ],
    ["Inflation Rate",            "inflation",     { min: 0, max: 15,  step: 0.1 }, "%"  ],
    ["Effective Tax Rate",        "taxRate",       { min: 0, max: 60,  step: 1   }, "%"  ],
  ].forEach(([label, key, opts, unit]) => {
    const cell = document.createElement("div");
    cell.className = "ret-assump-cell";
    const lbl = document.createElement("div");
    lbl.className = "ret-label";
    lbl.textContent = label;
    const row = document.createElement("div");
    row.className = "ret-input-unit-row";
    const inp = numInput(_s[key], v => { _s[key] = v; }, opts);
    const unitEl = document.createElement("span");
    unitEl.className = "ret-unit";
    unitEl.textContent = unit;
    row.appendChild(inp);
    row.appendChild(unitEl);
    cell.appendChild(lbl);
    cell.appendChild(row);
    assumpGrid.appendChild(cell);
  });
  secAssump.appendChild(assumpGrid);
  page.appendChild(secAssump);

  // ── Lump Sum Distributions ───────────────────────────────────────────────────
  const secLump = retSection("Lump Sum Distributions");
  const lumpNote = document.createElement("p");
  lumpNote.className = "ret-note";
  lumpNote.textContent = "Amounts in today's dollars — will be inflation-adjusted at the time of distribution.";
  secLump.appendChild(lumpNote);
  const lumpList = document.createElement("div");
  lumpList.className = "ret-event-list";
  secLump.appendChild(lumpList);
  const addLumpBtn = document.createElement("button");
  addLumpBtn.className = "btn btn-secondary ret-add-btn";
  addLumpBtn.textContent = "+ Add Distribution";
  secLump.appendChild(addLumpBtn);
  page.appendChild(secLump);

  function renderLumpRows() {
    lumpList.innerHTML = "";
    _s.lumpSums.forEach((ls, i) => {
      lumpList.appendChild(eventRow(
        [["At age", ls.age, v => { _s.lumpSums[i].age = v; },
            { min: _s.currentAge, max: 100, step: 1 }],
         ["Amount ($)", ls.amount, v => { _s.lumpSums[i].amount = v; },
            { min: 0, step: 1000 }]],
        () => { _s.lumpSums.splice(i, 1); renderLumpRows(); }
      ));
    });
    addLumpBtn.style.display = _s.lumpSums.length >= 2 ? "none" : "";
  }
  addLumpBtn.addEventListener("click", () => {
    _s.lumpSums.push({ age: _s.currentAge + 5, amount: 50000 });
    renderLumpRows();
  });
  renderLumpRows();

  // ── Annuities ────────────────────────────────────────────────────────────────
  const secAnn = retSection("Annuities");
  const annNote = document.createElement("p");
  annNote.className = "ret-note";
  annNote.textContent = "Annual amounts in today's dollars — will be inflation-adjusted each year.";
  secAnn.appendChild(annNote);
  const annList = document.createElement("div");
  annList.className = "ret-event-list";
  secAnn.appendChild(annList);
  const addAnnBtn = document.createElement("button");
  addAnnBtn.className = "btn btn-secondary ret-add-btn";
  addAnnBtn.textContent = "+ Add Annuity";
  secAnn.appendChild(addAnnBtn);
  page.appendChild(secAnn);

  function renderAnnRows() {
    annList.innerHTML = "";
    _s.annuities.forEach((a, i) => {
      annList.appendChild(eventRow(
        [["Starts at age", a.startAge, v => { _s.annuities[i].startAge = v; },
            { min: _s.currentAge, max: 100, step: 1 }],
         ["Annual ($)", a.amount, v => { _s.annuities[i].amount = v; },
            { min: 0, step: 500 }]],
        () => { _s.annuities.splice(i, 1); renderAnnRows(); }
      ));
    });
    addAnnBtn.style.display = _s.annuities.length >= 2 ? "none" : "";
  }
  addAnnBtn.addEventListener("click", () => {
    _s.annuities.push({ startAge: _s.currentAge + 2, amount: 24000 });
    renderAnnRows();
  });
  renderAnnRows();

  // ── CTA ──────────────────────────────────────────────────────────────────────
  if (onViewSimulation) {
    const cta = document.createElement("div");
    cta.className = "ret-cta-row";
    const btn = document.createElement("button");
    btn.className = "btn btn-primary";
    btn.textContent = "View Simulation →";
    btn.addEventListener("click", onViewSimulation);
    cta.appendChild(btn);
    page.appendChild(cta);
  }
}

// ── SIMULATION PAGE ───────────────────────────────────────────────────────────
export function renderRetirementSimulation(container) {
  container.innerHTML = "";

  const header = document.createElement("div");
  header.className = "view-header";
  const h1 = document.createElement("h1");
  h1.textContent = "Simple Simulation";
  header.appendChild(h1);
  container.appendChild(header);

  const data = runSimulation(_s);
  const lastPt  = data[data.length - 1];
  const depleted = lastPt.total <= 0;
  const depletionAge = depleted ? lastPt.age : null;

  // ── Headline ─────────────────────────────────────────────────────────────────
  const headline = document.createElement("div");
  headline.className = "ret-headline-card";
  if (depleted) {
    headline.innerHTML = `
      <div class="ret-headline-label">Portfolio Depleted at Age</div>
      <div class="ret-headline-age ret-depleted">Age ${depletionAge}</div>
      <div class="ret-headline-sub">~${depletionAge - _s.currentAge} years of retirement income</div>`;
  } else {
    headline.innerHTML = `
      <div class="ret-headline-label">Estimated Portfolio Longevity</div>
      <div class="ret-headline-age ret-solvent">100+ Years</div>
      <div class="ret-headline-sub">Survives to age 100 with ${formatCurrency(lastPt.total)} remaining (today's $)</div>`;
  }
  container.appendChild(headline);

  // ── Summary cards ────────────────────────────────────────────────────────────
  const totalStart   = _s.taxable + _s.taxFree + _s.taxDeferred;
  const midPt        = data[Math.floor(data.length / 2)];
  const realReturn   = (_s.nominalGrowth - _s.inflation).toFixed(1);
  const netAnnuities = _s.annuities.reduce((s, a) => s + a.amount, 0);
  const netExpenses  = Math.max(0, _s.annualExpenses - netAnnuities);

  const cards = document.createElement("div");
  cards.className = "ret-summary-cards";
  [
    ["Starting Portfolio",        formatCurrency(totalStart)],
    ["Net Annual Withdrawal",     formatCurrency(netExpenses) + "/yr"],
    ["Real Return",               realReturn + "%"],
    ["Portfolio at Age " + (midPt?.age ?? "—"), midPt ? formatCurrency(midPt.total) : "—"],
  ].forEach(([label, value]) => {
    const card = document.createElement("div");
    card.className = "ret-summary-card";
    card.innerHTML = `<div class="ret-card-val">${value}</div><div class="ret-card-lbl">${label}</div>`;
    cards.appendChild(card);
  });
  container.appendChild(cards);

  // ── Stacked area chart ───────────────────────────────────────────────────────
  const chartWrap = document.createElement("div");
  chartWrap.className = "ret-chart-wrap";
  chartWrap.style.position = "relative";
  container.appendChild(chartWrap);

  const tooltip = document.createElement("div");
  tooltip.className = "report-tooltip";
  chartWrap.appendChild(tooltip);

  const COLORS = {
    taxable:    "#3b82f6",
    taxDeferred: "#f59e0b",
    taxFree:    "#22c55e",
  };

  const events = [
    ..._s.lumpSums.map(l  => ({ age: l.age,      label: `+${fmtShort(l.amount)}`,             type: "lump"    })),
    ..._s.annuities.map(a => ({ age: a.startAge,  label: `Annuity\n${fmtShort(a.amount)}/yr`, type: "annuity" })),
  ];

  function drawChart() {
    const oldSvg = chartWrap.querySelector("svg");
    if (oldSvg) oldSvg.remove();

    const MARGIN = { top: 28, right: 20, bottom: 52, left: 80 };
    const SVG_H  = 340;
    const W      = chartWrap.clientWidth || 700;
    const cW     = W - MARGIN.left - MARGIN.right;
    const cH     = SVG_H - MARGIN.top - MARGIN.bottom;

    const maxTotal = Math.max(...data.map(d => d.total), 0);
    const step  = niceStep(maxTotal);
    const yMax  = maxTotal > 0 ? Math.ceil(maxTotal / step) * step : step;
    const yTicks = [];
    for (let v = 0; v <= yMax; v += step) yTicks.push(v);

    const minAge   = data[0].age;
    const maxAge   = data[data.length - 1].age;
    const ageRange = Math.max(maxAge - minAge, 1);
    const xPx = age => ((age - minAge) / ageRange) * cW;
    const yPx = val  => cH - (Math.max(0, Math.min(val, yMax)) / yMax) * cH;

    const NS  = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("width", W);
    svg.setAttribute("height", SVG_H);

    // Defs for gradients
    const defs = document.createElementNS(NS, "defs");
    svg.appendChild(defs);
    ["taxable", "taxDeferred", "taxFree"].forEach(key => {
      const grad = document.createElementNS(NS, "linearGradient");
      grad.setAttribute("id", `ret-grad-${key}`);
      grad.setAttribute("x1", "0"); grad.setAttribute("y1", "0");
      grad.setAttribute("x2", "0"); grad.setAttribute("y2", "1");
      const s1 = document.createElementNS(NS, "stop");
      s1.setAttribute("offset", "0%");
      s1.setAttribute("stop-color", COLORS[key]);
      s1.setAttribute("stop-opacity", "0.55");
      const s2 = document.createElementNS(NS, "stop");
      s2.setAttribute("offset", "100%");
      s2.setAttribute("stop-color", COLORS[key]);
      s2.setAttribute("stop-opacity", "0.15");
      grad.appendChild(s1);
      grad.appendChild(s2);
      defs.appendChild(grad);
    });

    const g = document.createElementNS(NS, "g");
    g.setAttribute("transform", `translate(${MARGIN.left},${MARGIN.top})`);
    svg.appendChild(g);

    // Y-axis grid + labels
    yTicks.forEach(v => {
      const y = yPx(v);
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
      txt.textContent = fmtShort(v);
      g.appendChild(txt);
    });

    // Axes
    const yLine = document.createElementNS(NS, "line");
    yLine.setAttribute("x1", 0); yLine.setAttribute("x2", 0);
    yLine.setAttribute("y1", 0); yLine.setAttribute("y2", cH);
    yLine.setAttribute("stroke", "#2e3248");
    g.appendChild(yLine);
    const xLine = document.createElementNS(NS, "line");
    xLine.setAttribute("x1", 0); xLine.setAttribute("x2", cW);
    xLine.setAttribute("y1", cH); xLine.setAttribute("y2", cH);
    xLine.setAttribute("stroke", "#2e3248");
    g.appendChild(xLine);

    // X axis labels every 5 years
    for (let a = Math.ceil(minAge / 5) * 5; a <= maxAge; a += 5) {
      const x = xPx(a);
      const tick = document.createElementNS(NS, "line");
      tick.setAttribute("x1", x); tick.setAttribute("x2", x);
      tick.setAttribute("y1", cH); tick.setAttribute("y2", cH + 4);
      tick.setAttribute("stroke", "#2e3248");
      g.appendChild(tick);
      const lbl = document.createElementNS(NS, "text");
      lbl.setAttribute("x", x); lbl.setAttribute("y", cH + 16);
      lbl.setAttribute("text-anchor", "middle");
      lbl.setAttribute("fill", "#718096");
      lbl.setAttribute("font-size", "11");
      lbl.textContent = a;
      g.appendChild(lbl);
    }
    const xAxisLbl = document.createElementNS(NS, "text");
    xAxisLbl.setAttribute("x", cW / 2); xAxisLbl.setAttribute("y", cH + 38);
    xAxisLbl.setAttribute("text-anchor", "middle");
    xAxisLbl.setAttribute("fill", "#718096");
    xAxisLbl.setAttribute("font-size", "11");
    xAxisLbl.textContent = "Age (values in today's dollars)";
    g.appendChild(xAxisLbl);

    // ── Stacked area paths ─────────────────────────────────────────────────────
    // Each band: polygon of "top of this layer going forward" + "top of previous layer going back"
    const layers = [
      { key: "taxable",     getBase:  _  => 0,                              getTop: d => d.taxable },
      { key: "taxDeferred", getBase:  d  => d.taxable,                      getTop: d => d.taxable + d.taxDeferred },
      { key: "taxFree",     getBase:  d  => d.taxable + d.taxDeferred,      getTop: d => d.total },
    ];

    layers.forEach(({ key, getBase, getTop }) => {
      const fwdPts  = data.map(d => `${xPx(d.age)},${yPx(getTop(d))}`).join(" ");
      const backPts = [...data].reverse().map(d => `${xPx(d.age)},${yPx(getBase(d))}`).join(" ");
      const path = document.createElementNS(NS, "polygon");
      path.setAttribute("points", `${fwdPts} ${backPts}`);
      path.setAttribute("fill", `url(#ret-grad-${key})`);
      g.appendChild(path);

      // Border line along the top of each band
      const topLine = document.createElementNS(NS, "polyline");
      topLine.setAttribute("points", fwdPts);
      topLine.setAttribute("fill", "none");
      topLine.setAttribute("stroke", COLORS[key]);
      topLine.setAttribute("stroke-width", "1.5");
      topLine.setAttribute("stroke-linejoin", "round");
      topLine.setAttribute("opacity", "0.7");
      g.appendChild(topLine);
    });

    // Total outline
    const totalPts = data.map(d => `${xPx(d.age)},${yPx(d.total)}`).join(" ");
    const totalLine = document.createElementNS(NS, "polyline");
    totalLine.setAttribute("points", totalPts);
    totalLine.setAttribute("fill", "none");
    totalLine.setAttribute("stroke", depleted ? "#ef4444" : "#e2e8f0");
    totalLine.setAttribute("stroke-width", "2");
    totalLine.setAttribute("stroke-linejoin", "round");
    totalLine.setAttribute("opacity", "0.5");
    g.appendChild(totalLine);

    // Event annotations
    events.forEach(ev => {
      if (ev.age < minAge || ev.age > maxAge) return;
      const x = xPx(ev.age);
      const dp = data.find(d => d.age === ev.age);
      if (!dp) return;
      const y = yPx(dp.total);
      const color = ev.type === "lump" ? "#22c55e" : "#f59e0b";
      const vl = document.createElementNS(NS, "line");
      vl.setAttribute("x1", x); vl.setAttribute("x2", x);
      vl.setAttribute("y1", 0); vl.setAttribute("y2", cH);
      vl.setAttribute("stroke", color); vl.setAttribute("stroke-width", "1");
      vl.setAttribute("stroke-dasharray", "3,3");
      g.appendChild(vl);
      const dot = document.createElementNS(NS, "circle");
      dot.setAttribute("cx", x); dot.setAttribute("cy", y);
      dot.setAttribute("r", "4"); dot.setAttribute("fill", color);
      g.appendChild(dot);
      ev.label.split("\n").forEach((line, li, arr) => {
        const t = document.createElementNS(NS, "text");
        t.setAttribute("x", x + 5);
        t.setAttribute("y", Math.max(14, y - 6 - (arr.length - 1 - li) * 13));
        t.setAttribute("fill", color);
        t.setAttribute("font-size", "10");
        t.setAttribute("font-weight", "600");
        t.textContent = line;
        g.appendChild(t);
      });
    });

    // Depletion marker
    if (depleted && depletionAge !== null) {
      const x = xPx(depletionAge);
      const marker = document.createElementNS(NS, "text");
      marker.setAttribute("x", x);
      marker.setAttribute("y", cH - 8);
      marker.setAttribute("text-anchor", x > cW * 0.8 ? "end" : "middle");
      marker.setAttribute("fill", "#ef4444");
      marker.setAttribute("font-size", "11");
      marker.setAttribute("font-weight", "600");
      marker.textContent = `Age ${depletionAge}`;
      g.appendChild(marker);
    }

    // Hit targets for tooltip
    const hitW = Math.max(cW / data.length, 4);
    data.forEach(d => {
      const x = xPx(d.age);
      const hit = document.createElementNS(NS, "rect");
      hit.setAttribute("x", x - hitW / 2); hit.setAttribute("y", 0);
      hit.setAttribute("width", hitW);      hit.setAttribute("height", cH);
      hit.setAttribute("fill", "transparent");
      hit.style.cursor = "default";
      hit.addEventListener("mouseenter", () => {
        const pct = x / cW;
        tooltip.innerHTML = `
          <div class="rtt-month">Age ${d.age}</div>
          <div class="rtt-divider"></div>
          <div class="rtt-cat">
            <span class="legend-dot" style="background:${COLORS.taxable}"></span>
            <span class="rtt-cat-name">Taxable</span>
            <span class="rtt-val">${formatCurrency(d.taxable)}</span>
          </div>
          <div class="rtt-cat">
            <span class="legend-dot" style="background:${COLORS.taxDeferred}"></span>
            <span class="rtt-cat-name">Tax-Deferred</span>
            <span class="rtt-val">${formatCurrency(d.taxDeferred)}</span>
          </div>
          <div class="rtt-cat">
            <span class="legend-dot" style="background:${COLORS.taxFree}"></span>
            <span class="rtt-cat-name">Tax-Free</span>
            <span class="rtt-val">${formatCurrency(d.taxFree)}</span>
          </div>
          <div class="rtt-divider"></div>
          <div class="rtt-cat">
            <span class="rtt-cat-name" style="font-weight:600">Total</span>
            <span class="rtt-val" style="font-weight:600">${formatCurrency(d.total)}</span>
          </div>`;
        tooltip.style.display = "block";
        tooltip.style.top  = "28px";
        tooltip.style.left = `${MARGIN.left + x}px`;
        tooltip.style.transform = pct < 0.2 ? "translateX(0)" : pct > 0.8 ? "translateX(-100%)" : "translateX(-50%)";
      });
      hit.addEventListener("mouseleave", () => { tooltip.style.display = "none"; });
      g.appendChild(hit);
    });

    chartWrap.insertBefore(svg, tooltip);
  }

  drawChart();
  const ro = new ResizeObserver(() => drawChart());
  ro.observe(chartWrap);

  // ── Chart legend ─────────────────────────────────────────────────────────────
  const chartLegend = document.createElement("div");
  chartLegend.className = "ret-chart-legend";
  [
    ["Taxable",      COLORS.taxable],
    ["Tax-Deferred", COLORS.taxDeferred],
    ["Tax-Free",     COLORS.taxFree],
  ].forEach(([label, color]) => {
    const item = document.createElement("div");
    item.className = "ret-legend-item";
    item.innerHTML = `<span class="legend-dot" style="background:${color}"></span>${label}`;
    chartLegend.appendChild(item);
  });
  container.appendChild(chartLegend);

  // ── Milestone table ───────────────────────────────────────────────────────────
  const tableWrap = document.createElement("div");
  tableWrap.className = "ret-table-wrap";

  const tbl = document.createElement("table");
  tbl.className = "ret-table";
  tbl.innerHTML = `
    <thead>
      <tr>
        <th>Age</th>
        <th class="ret-col-taxable">Taxable</th>
        <th class="ret-col-deferred">Tax-Deferred</th>
        <th class="ret-col-free">Tax-Free</th>
        <th class="ret-col-total">Total</th>
        <th>Notes</th>
      </tr>
    </thead>`;
  const tbody = document.createElement("tbody");

  const milestones = new Set();
  for (let a = _s.currentAge; a <= (depletionAge ?? 100); a += 5) milestones.add(a);
  _s.lumpSums.forEach(l  => milestones.add(l.age));
  _s.annuities.forEach(a => milestones.add(a.startAge));
  if (depletionAge !== null) milestones.add(depletionAge);

  [...milestones].sort((a, b) => a - b).forEach(age => {
    const pt = data.find(d => d.age === age);
    if (!pt) return;
    const notes = [];
    _s.lumpSums.filter(l  => l.age === age).forEach(l =>
      notes.push(`Lump sum +${formatCurrency(l.amount)}`));
    _s.annuities.filter(a => a.startAge === age).forEach(a =>
      notes.push(`Annuity starts (${formatCurrency(a.amount)}/yr)`));
    if (age === depletionAge) notes.push("Portfolio depleted");

    const tr = document.createElement("tr");
    if (age === depletionAge) tr.className = "ret-depletion-row";

    const fmtCell = (val, cls) => {
      const td = document.createElement("td");
      td.className = cls;
      td.textContent = val > 0 ? formatCurrency(val) : "—";
      return td;
    };

    tr.innerHTML = `<td>${age}</td>`;
    tr.appendChild(fmtCell(pt.taxable,    "ret-col-taxable"));
    tr.appendChild(fmtCell(pt.taxDeferred,"ret-col-deferred"));
    tr.appendChild(fmtCell(pt.taxFree,    "ret-col-free"));
    tr.appendChild(fmtCell(pt.total,      "ret-col-total"));
    const notesTd = document.createElement("td");
    notesTd.className = "ret-table-notes";
    notesTd.textContent = notes.join(" · ");
    tr.appendChild(notesTd);
    tbody.appendChild(tr);
  });

  tbl.appendChild(tbody);
  tableWrap.appendChild(tbl);
  container.appendChild(tableWrap);
}

// ── Internal helpers ──────────────────────────────────────────────────────────
function retField(label, input) {
  const wrap = document.createElement("div");
  wrap.className = "ret-field";
  const lbl = document.createElement("label");
  lbl.className = "ret-label";
  lbl.textContent = label;
  wrap.appendChild(lbl);
  wrap.appendChild(input);
  return wrap;
}

function eventRow(fields, onRemove) {
  const row = document.createElement("div");
  row.className = "ret-event-row";
  fields.forEach(([label, value, onChange, opts]) => {
    const lbl = document.createElement("span");
    lbl.className = "ret-event-lbl";
    lbl.textContent = label;
    row.appendChild(lbl);
    row.appendChild(numInput(value, onChange, opts));
  });
  const btn = document.createElement("button");
  btn.className = "btn-icon ret-remove-btn";
  btn.title = "Remove";
  btn.innerHTML = "&#x2715;";
  btn.addEventListener("click", onRemove);
  row.appendChild(btn);
  return row;
}
