import { formatCurrency } from "../../utils/currency.js";

// ── Persisted state ────────────────────────────────────────────────────────────
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

// ── Simulation ─────────────────────────────────────────────────────────────────
function runSimulation(s) {
  const g    = s.nominalGrowth / 100;
  const infl = s.inflation     / 100;
  const tax  = Math.min(s.taxRate / 100, 0.99);

  let portfolio = s.taxable + s.taxFree + s.taxDeferred;
  const MAX_AGE = 100;
  const data = []; // { age, real }  — real = today's-dollar value

  for (let age = s.currentAge; age <= MAX_AGE; age++) {
    const yi          = age - s.currentAge;
    const inflFactor  = Math.pow(1 + infl, yi);
    const real        = Math.max(0, portfolio / inflFactor);
    data.push({ age, real });

    if (portfolio <= 0) break;

    // Lump sums this year (in today's $, scaled to nominal)
    const lump = s.lumpSums
      .filter(l => l.age === age)
      .reduce((sum, l) => sum + l.amount * inflFactor, 0);

    // Annuity income this year (in today's $, scaled to nominal)
    const annuity = s.annuities
      .filter(a => age >= a.startAge)
      .reduce((sum, a) => sum + a.amount * inflFactor, 0);

    const realExpenses  = s.annualExpenses * inflFactor;
    const netNeeded     = Math.max(0, realExpenses - annuity);
    const grossWithdraw = netNeeded / (1 - tax);

    portfolio += lump;

    // Cash buffer earns 0; rest earns nominal growth
    const cash     = Math.min(portfolio, realExpenses * s.cashYears);
    const invested = Math.max(0, portfolio - cash);
    portfolio = cash + invested * (1 + g) - grossWithdraw;
  }

  // Clamp final entry to 0 if we went negative
  if (data.length && data[data.length - 1].real < 0) {
    data[data.length - 1].real = 0;
  }
  return data;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function niceStep(maxVal, steps = 5) {
  if (maxVal <= 0) return 100000;
  const rough = maxVal / steps;
  const mag   = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm  = rough / mag;
  const nice  = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return nice * mag;
}

function fmtShort(v) {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(v % 1e6 === 0 ? 0 : 1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(v % 1e3 === 0 ? 0 : 0)}k`;
  return `$${Math.round(v)}`;
}

// ── Number input helper ───────────────────────────────────────────────────────
function numInput(value, onChange, opts = {}) {
  const el = document.createElement("input");
  el.type  = "number";
  el.className = "form-input ret-num-input";
  el.value = value;
  if (opts.min !== undefined) el.min = opts.min;
  if (opts.max !== undefined) el.max = opts.max;
  if (opts.step) el.step = opts.step;
  if (opts.placeholder) el.placeholder = opts.placeholder;
  el.addEventListener("input", () => {
    const v = parseFloat(el.value);
    if (!isNaN(v)) onChange(v);
  });
  return el;
}

function labelWrap(text, input, hint = "") {
  const wrap = document.createElement("div");
  wrap.className = "ret-field";
  const lbl = document.createElement("label");
  lbl.className = "ret-label";
  lbl.textContent = text;
  wrap.appendChild(lbl);
  wrap.appendChild(input);
  if (hint) {
    const h = document.createElement("span");
    h.className = "ret-hint";
    h.textContent = hint;
    wrap.appendChild(h);
  }
  return wrap;
}

// ── Main export ────────────────────────────────────────────────────────────────
export function renderRetirementView(container) {
  container.innerHTML = "";

  // ── Header ──────────────────────────────────────────────────────────────────
  const header = document.createElement("div");
  header.className = "view-header";
  const h1 = document.createElement("h1");
  h1.textContent = "Retirement Projector";
  header.appendChild(h1);
  container.appendChild(header);

  // ── Two-column layout ────────────────────────────────────────────────────────
  const layout = document.createElement("div");
  layout.className = "retirement-layout";
  container.appendChild(layout);

  // ── LEFT: Inputs ─────────────────────────────────────────────────────────────
  const inputs = document.createElement("div");
  inputs.className = "retirement-inputs";
  layout.appendChild(inputs);

  // ── RIGHT: Results ────────────────────────────────────────────────────────────
  const results = document.createElement("div");
  results.className = "retirement-results";
  layout.appendChild(results);

  // Update function — redraws results panel only
  function update() {
    drawResults(results, _s);
  }

  // ── Section builder ──────────────────────────────────────────────────────────
  function section(title) {
    const sec = document.createElement("div");
    sec.className = "ret-section";
    const hd = document.createElement("h3");
    hd.className = "ret-section-title";
    hd.textContent = title;
    sec.appendChild(hd);
    return sec;
  }

  // ── Starting Conditions ───────────────────────────────────────────────────────
  const secStart = section("Starting Conditions");
  secStart.appendChild(labelWrap("Current Age",
    numInput(_s.currentAge, v => { _s.currentAge = v; update(); }, { min: 20, max: 90, step: 1 })));
  secStart.appendChild(labelWrap("Annual Expenses (today's $)",
    numInput(_s.annualExpenses, v => { _s.annualExpenses = v; update(); }, { min: 0, step: 1000 })));
  inputs.appendChild(secStart);

  // ── Account Balances ──────────────────────────────────────────────────────────
  const secAccts = section("Account Balances");
  const acctGrid = document.createElement("div");
  acctGrid.className = "ret-acct-grid";
  [
    ["Taxable",       "taxable",     "--color-taxable"],
    ["Tax-Free",      "taxFree",     "--color-tax-free"],
    ["Tax-Deferred",  "taxDeferred", "--color-tax-deferred"],
  ].forEach(([label, key, colorVar]) => {
    const cell = document.createElement("div");
    cell.className = "ret-acct-cell";
    const inp = numInput(_s[key], v => { _s[key] = v; update(); }, { min: 0, step: 1000 });
    inp.classList.add("ret-acct-input");
    inp.style.borderColor = `var(${colorVar})`;
    const lbl = document.createElement("div");
    lbl.className = "ret-acct-label";
    lbl.style.color = `var(${colorVar})`;
    lbl.textContent = label;
    cell.appendChild(lbl);
    cell.appendChild(inp);
    acctGrid.appendChild(cell);
  });
  secAccts.appendChild(acctGrid);
  inputs.appendChild(secAccts);

  // ── Assumptions ───────────────────────────────────────────────────────────────
  const secAssump = section("Assumptions");
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
    const inp = numInput(_s[key], v => { _s[key] = v; update(); }, opts);
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
  inputs.appendChild(secAssump);

  // ── Lump Sum Distributions ────────────────────────────────────────────────────
  const secLump = section("Lump Sum Distributions");
  const lumpList = document.createElement("div");
  lumpList.className = "ret-event-list";
  secLump.appendChild(lumpList);

  const addLumpBtn = document.createElement("button");
  addLumpBtn.className = "btn btn-secondary ret-add-btn";
  addLumpBtn.textContent = "+ Add Distribution";
  secLump.appendChild(addLumpBtn);
  inputs.appendChild(secLump);

  function renderLumpRows() {
    lumpList.innerHTML = "";
    _s.lumpSums.forEach((ls, i) => {
      const row = document.createElement("div");
      row.className = "ret-event-row";

      const ageInp = numInput(ls.age, v => { _s.lumpSums[i].age = v; update(); }, { min: _s.currentAge, max: 100, step: 1 });
      const amtInp = numInput(ls.amount, v => { _s.lumpSums[i].amount = v; update(); }, { min: 0, step: 1000 });

      const ageLbl = document.createElement("span"); ageLbl.className = "ret-event-lbl"; ageLbl.textContent = "At age";
      const amtLbl = document.createElement("span"); amtLbl.className = "ret-event-lbl"; amtLbl.textContent = "Amount ($)";

      const removeBtn = document.createElement("button");
      removeBtn.className = "btn-icon ret-remove-btn";
      removeBtn.title = "Remove";
      removeBtn.innerHTML = "&#x2715;";
      removeBtn.addEventListener("click", () => {
        _s.lumpSums.splice(i, 1);
        renderLumpRows();
        update();
      });

      row.appendChild(ageLbl);
      row.appendChild(ageInp);
      row.appendChild(amtLbl);
      row.appendChild(amtInp);
      row.appendChild(removeBtn);
      lumpList.appendChild(row);
    });
    addLumpBtn.style.display = _s.lumpSums.length >= 2 ? "none" : "";
  }

  addLumpBtn.addEventListener("click", () => {
    _s.lumpSums.push({ age: _s.currentAge + 5, amount: 50000 });
    renderLumpRows();
    update();
  });
  renderLumpRows();

  // ── Annuities ─────────────────────────────────────────────────────────────────
  const secAnn = section("Annuities");
  const annList = document.createElement("div");
  annList.className = "ret-event-list";
  secAnn.appendChild(annList);

  const addAnnBtn = document.createElement("button");
  addAnnBtn.className = "btn btn-secondary ret-add-btn";
  addAnnBtn.textContent = "+ Add Annuity";
  secAnn.appendChild(addAnnBtn);
  inputs.appendChild(secAnn);

  function renderAnnRows() {
    annList.innerHTML = "";
    _s.annuities.forEach((a, i) => {
      const row = document.createElement("div");
      row.className = "ret-event-row";

      const ageInp = numInput(a.startAge, v => { _s.annuities[i].startAge = v; update(); }, { min: _s.currentAge, max: 100, step: 1 });
      const amtInp = numInput(a.amount, v => { _s.annuities[i].amount = v; update(); }, { min: 0, step: 500 });

      const ageLbl = document.createElement("span"); ageLbl.className = "ret-event-lbl"; ageLbl.textContent = "Starts at age";
      const amtLbl = document.createElement("span"); amtLbl.className = "ret-event-lbl"; amtLbl.textContent = "Annual ($)";

      const removeBtn = document.createElement("button");
      removeBtn.className = "btn-icon ret-remove-btn";
      removeBtn.title = "Remove";
      removeBtn.innerHTML = "&#x2715;";
      removeBtn.addEventListener("click", () => {
        _s.annuities.splice(i, 1);
        renderAnnRows();
        update();
      });

      row.appendChild(ageLbl);
      row.appendChild(ageInp);
      row.appendChild(amtLbl);
      row.appendChild(amtInp);
      row.appendChild(removeBtn);
      annList.appendChild(row);
    });
    addAnnBtn.style.display = _s.annuities.length >= 2 ? "none" : "";
  }

  addAnnBtn.addEventListener("click", () => {
    _s.annuities.push({ startAge: _s.currentAge + 2, amount: 24000 });
    renderAnnRows();
    update();
  });
  renderAnnRows();

  // ── Initial draw ─────────────────────────────────────────────────────────────
  update();
}

// ── Results panel ─────────────────────────────────────────────────────────────
function drawResults(container, s) {
  container.innerHTML = "";

  const data = runSimulation(s);
  const lastPoint = data[data.length - 1];
  const depleted  = lastPoint.real <= 0;
  const depletionAge = depleted ? lastPoint.age : null;
  const totalStart   = s.taxable + s.taxFree + s.taxDeferred;
  const maxReal      = Math.max(...data.map(d => d.real), 0);

  // ── Headline card ──────────────────────────────────────────────────────────
  const headline = document.createElement("div");
  headline.className = "ret-headline-card";

  if (depleted) {
    headline.innerHTML = `
      <div class="ret-headline-label">Estimated Depletion Age</div>
      <div class="ret-headline-age ret-depleted">Age ${depletionAge}</div>
      <div class="ret-headline-sub">~${depletionAge - s.currentAge} years of retirement income</div>
    `;
  } else {
    headline.innerHTML = `
      <div class="ret-headline-label">Estimated Portfolio</div>
      <div class="ret-headline-age ret-solvent">100+ Years</div>
      <div class="ret-headline-sub">Portfolio survives to age 100 with ${formatCurrency(lastPoint.real)} remaining</div>
    `;
  }
  container.appendChild(headline);

  // ── Summary cards ──────────────────────────────────────────────────────────
  const cards = document.createElement("div");
  cards.className = "ret-summary-cards";

  const realExpAt62 = data.find(d => d.age === Math.round(s.currentAge + 2));
  const midPoint    = data[Math.floor(data.length / 2)];

  [
    ["Starting Portfolio",     formatCurrency(totalStart),                    "total"],
    ["Annual Expenses",        formatCurrency(s.annualExpenses) + "/yr",      "expenses"],
    ["Real Return",            `${(s.nominalGrowth - s.inflation).toFixed(1)}%`, "return"],
    ["Portfolio at " + (midPoint?.age ?? "—"), midPoint ? formatCurrency(midPoint.real) : "—", "mid"],
  ].forEach(([label, value, key]) => {
    const card = document.createElement("div");
    card.className = "ret-summary-card";
    card.innerHTML = `<div class="ret-card-val">${value}</div><div class="ret-card-lbl">${label}</div>`;
    cards.appendChild(card);
  });
  container.appendChild(cards);

  // ── Chart ──────────────────────────────────────────────────────────────────
  const chartWrap = document.createElement("div");
  chartWrap.className = "ret-chart-wrap";
  chartWrap.style.position = "relative";
  container.appendChild(chartWrap);

  const tooltip = document.createElement("div");
  tooltip.className = "report-tooltip";
  chartWrap.appendChild(tooltip);

  // Annotation events for the chart
  const events = [
    ...s.lumpSums.map(l => ({ age: l.age, label: `+${fmtShort(l.amount)}`, type: "lump" })),
    ...s.annuities.map(a => ({ age: a.startAge, label: `Annuity\n${fmtShort(a.amount)}/yr`, type: "annuity" })),
  ];

  function drawChart() {
    const oldSvg = chartWrap.querySelector("svg");
    if (oldSvg) oldSvg.remove();

    const MARGIN = { top: 28, right: 20, bottom: 52, left: 76 };
    const SVG_H  = 340;
    const W      = chartWrap.clientWidth || 640;
    const cW     = W - MARGIN.left - MARGIN.right;
    const cH     = SVG_H - MARGIN.top - MARGIN.bottom;

    const step  = niceStep(maxReal);
    const yMax  = maxReal > 0 ? Math.ceil(maxReal / step) * step : step;
    const yTicks = [];
    for (let v = 0; v <= yMax; v += step) yTicks.push(v);

    const ages = data.map(d => d.age);
    const minAge = ages[0];
    const maxAge = ages[ages.length - 1];
    const ageRange = Math.max(maxAge - minAge, 1);

    const xPx = age => ((age - minAge) / ageRange) * cW;
    const yPx = val  => cH - (Math.max(0, val) / yMax) * cH;

    const NS  = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("width", W);
    svg.setAttribute("height", SVG_H);

    const g = document.createElementNS(NS, "g");
    g.setAttribute("transform", `translate(${MARGIN.left},${MARGIN.top})`);
    svg.appendChild(g);

    // Y gridlines + labels
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
      txt.textContent = fmtShort(v);
      g.appendChild(txt);
    });

    // Y axis line
    const yLine = document.createElementNS(NS, "line");
    yLine.setAttribute("x1", 0); yLine.setAttribute("x2", 0);
    yLine.setAttribute("y1", 0); yLine.setAttribute("y2", cH);
    yLine.setAttribute("stroke", "#2e3248");
    g.appendChild(yLine);

    // X axis line
    const xLine = document.createElementNS(NS, "line");
    xLine.setAttribute("x1", 0); xLine.setAttribute("x2", cW);
    xLine.setAttribute("y1", cH); xLine.setAttribute("y2", cH);
    xLine.setAttribute("stroke", "#2e3248");
    g.appendChild(xLine);

    // X axis age labels — every 5 years
    const startAge5 = Math.ceil(minAge / 5) * 5;
    for (let a = startAge5; a <= maxAge; a += 5) {
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

    // X axis label
    const xAxisLbl = document.createElementNS(NS, "text");
    xAxisLbl.setAttribute("x", cW / 2);
    xAxisLbl.setAttribute("y", cH + 38);
    xAxisLbl.setAttribute("text-anchor", "middle");
    xAxisLbl.setAttribute("fill", "#718096");
    xAxisLbl.setAttribute("font-size", "11");
    xAxisLbl.textContent = "Age";
    g.appendChild(xAxisLbl);

    // Filled area under the curve
    const areaPoints = data.map(d => `${xPx(d.age)},${yPx(d.real)}`).join(" ");
    const areaPath = `M${xPx(data[0].age)},${cH} ` +
      data.map(d => `L${xPx(d.age)},${yPx(d.real)}`).join(" ") +
      ` L${xPx(data[data.length - 1].age)},${cH} Z`;

    const defs = document.createElementNS(NS, "defs");
    const grad = document.createElementNS(NS, "linearGradient");
    grad.setAttribute("id", "ret-area-grad");
    grad.setAttribute("x1", "0"); grad.setAttribute("y1", "0");
    grad.setAttribute("x2", "0"); grad.setAttribute("y2", "1");
    const stop1 = document.createElementNS(NS, "stop");
    stop1.setAttribute("offset", "0%");
    stop1.setAttribute("stop-color", depleted ? "#ef4444" : "#6366f1");
    stop1.setAttribute("stop-opacity", "0.18");
    const stop2 = document.createElementNS(NS, "stop");
    stop2.setAttribute("offset", "100%");
    stop2.setAttribute("stop-color", depleted ? "#ef4444" : "#6366f1");
    stop2.setAttribute("stop-opacity", "0.02");
    grad.appendChild(stop1);
    grad.appendChild(stop2);
    defs.appendChild(grad);
    svg.appendChild(defs);

    const area = document.createElementNS(NS, "path");
    area.setAttribute("d", areaPath);
    area.setAttribute("fill", "url(#ret-area-grad)");
    g.appendChild(area);

    // Line
    const lineEl = document.createElementNS(NS, "polyline");
    lineEl.setAttribute("points", areaPoints);
    lineEl.setAttribute("fill", "none");
    lineEl.setAttribute("stroke", depleted ? "#ef4444" : "#6366f1");
    lineEl.setAttribute("stroke-width", "2.5");
    lineEl.setAttribute("stroke-linejoin", "round");
    g.appendChild(lineEl);

    // Event annotations
    events.forEach(ev => {
      if (ev.age < minAge || ev.age > maxAge) return;
      const x = xPx(ev.age);
      const dataPoint = data.find(d => d.age === ev.age);
      if (!dataPoint) return;
      const y = yPx(dataPoint.real);

      const vline = document.createElementNS(NS, "line");
      vline.setAttribute("x1", x); vline.setAttribute("x2", x);
      vline.setAttribute("y1", 0); vline.setAttribute("y2", cH);
      vline.setAttribute("stroke", ev.type === "lump" ? "#22c55e" : "#f59e0b");
      vline.setAttribute("stroke-width", "1");
      vline.setAttribute("stroke-dasharray", "3,3");
      g.appendChild(vline);

      const dot = document.createElementNS(NS, "circle");
      dot.setAttribute("cx", x); dot.setAttribute("cy", y);
      dot.setAttribute("r", "4");
      dot.setAttribute("fill", ev.type === "lump" ? "#22c55e" : "#f59e0b");
      g.appendChild(dot);

      const lblLines = ev.label.split("\n");
      lblLines.forEach((line, li) => {
        const t = document.createElementNS(NS, "text");
        t.setAttribute("x", x + 4);
        t.setAttribute("y", Math.max(14, y - 8 - (lblLines.length - 1 - li) * 13));
        t.setAttribute("fill", ev.type === "lump" ? "#22c55e" : "#f59e0b");
        t.setAttribute("font-size", "10");
        t.setAttribute("font-weight", "600");
        t.textContent = line;
        g.appendChild(t);
      });
    });

    // Depletion marker
    if (depleted && depletionAge !== null) {
      const x = xPx(depletionAge);
      const depLbl = document.createElementNS(NS, "text");
      depLbl.setAttribute("x", x);
      depLbl.setAttribute("y", cH - 8);
      depLbl.setAttribute("text-anchor", x > cW * 0.8 ? "end" : "middle");
      depLbl.setAttribute("fill", "#ef4444");
      depLbl.setAttribute("font-size", "11");
      depLbl.setAttribute("font-weight", "600");
      depLbl.textContent = `Age ${depletionAge}`;
      g.appendChild(depLbl);
    }

    // Invisible hit targets for tooltip
    const hitW = Math.max(cW / data.length, 4);
    data.forEach(d => {
      const x = xPx(d.age);
      const hit = document.createElementNS(NS, "rect");
      hit.setAttribute("x", x - hitW / 2);
      hit.setAttribute("y", 0);
      hit.setAttribute("width", hitW);
      hit.setAttribute("height", cH);
      hit.setAttribute("fill", "transparent");
      hit.style.cursor = "default";
      hit.addEventListener("mouseenter", (e) => {
        const pct = x / cW;
        tooltip.innerHTML = `
          <div class="rtt-month">Age ${d.age}</div>
          <div class="rtt-divider"></div>
          <div class="rtt-cat">
            <span class="rtt-cat-name">Portfolio (today's $)</span>
            <span class="rtt-val">${formatCurrency(d.real)}</span>
          </div>`;
        tooltip.style.display = "block";
        tooltip.style.top = `${MARGIN.top}px`;
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

  // ── Milestone table ────────────────────────────────────────────────────────
  const tableWrap = document.createElement("div");
  tableWrap.className = "ret-table-wrap";

  const tbl = document.createElement("table");
  tbl.className = "ret-table";
  tbl.innerHTML = `
    <thead>
      <tr>
        <th>Age</th>
        <th>Portfolio (today's $)</th>
        <th>Notes</th>
      </tr>
    </thead>`;
  const tbody = document.createElement("tbody");

  // Milestone ages: every 5 years + event ages + depletion age
  const milestoneAges = new Set();
  for (let a = s.currentAge; a <= (depletionAge ?? 100); a += 5) milestoneAges.add(a);
  s.lumpSums.forEach(l => milestoneAges.add(l.age));
  s.annuities.forEach(a => milestoneAges.add(a.startAge));
  if (depletionAge !== null) milestoneAges.add(depletionAge);

  [...milestoneAges].sort((a, b) => a - b).forEach(age => {
    const point = data.find(d => d.age === age);
    if (!point) return;

    const notes = [];
    s.lumpSums.filter(l => l.age === age).forEach(l =>
      notes.push(`Lump sum +${formatCurrency(l.amount)}`));
    s.annuities.filter(a => a.startAge === age).forEach(a =>
      notes.push(`Annuity starts (${formatCurrency(a.amount)}/yr)`));
    if (age === depletionAge) notes.push("Portfolio depleted");

    const tr = document.createElement("tr");
    if (age === depletionAge) tr.className = "ret-depletion-row";
    tr.innerHTML = `
      <td>${age}</td>
      <td>${point.real > 0 ? formatCurrency(point.real) : "—"}</td>
      <td class="ret-table-notes">${notes.join(" · ") || ""}</td>`;
    tbody.appendChild(tr);
  });

  tbl.appendChild(tbody);
  tableWrap.appendChild(tbl);
  container.appendChild(tableWrap);
}
