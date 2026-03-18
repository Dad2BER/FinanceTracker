import { formatCurrency } from "../../utils/currency.js";
import { getSimInputs } from "./retirementView.js";
import { HISTORIC_DATA, ASSET_TYPE_TO_COLUMN, FIRST_YEAR, LAST_YEAR } from "./historicData.js";

// ── Module-level view state ────────────────────────────────────────────────────
// Persists the chosen starting year across SPA navigations within the session.
let _startYear = 1966; // default: tests a challenging stagflation period

// ── Simulation engine ─────────────────────────────────────────────────────────
// Returns array of { age, year, taxable, taxDeferred, taxFree, total,
//                    portfolioReturn, inflation } in today's (start-year) dollars.
function runHistoricSimulation(s, startYear) {
  const allocs     = s.glidePath.allocations;
  const transYears = s.glidePath.transitionYears;
  const tax        = Math.min(s.taxRate / 100, 0.99);

  let taxable    = s.taxable;
  let taxDeferred = s.taxDeferred;
  let taxFree    = s.taxFree;

  const startIdx = HISTORIC_DATA.findIndex(d => d.year === startYear);
  if (startIdx === -1) return [];

  const results = [];
  let cumulativeInflation = 1; // price level relative to startYear

  for (let age = s.currentAge; age <= 100; age++) {
    const yi      = age - s.currentAge;
    const dataIdx = startIdx + yi;
    if (dataIdx >= HISTORIC_DATA.length) break; // historic data exhausted

    const hist = HISTORIC_DATA[dataIdx];

    // ── Glide-path interpolation ──────────────────────────────────────────────
    // t=0 → startPct; t=1 → endPct; linear over transitionYears.
    const t = transYears > 0 ? Math.min(yi / transYears, 1) : 1;

    // ── Blended portfolio return for this year ────────────────────────────────
    let portfolioReturn = 0;
    allocs.forEach(a => {
      const pct    = (a.startPct + (a.endPct - a.startPct) * t) / 100;
      const col    = ASSET_TYPE_TO_COLUMN[a.key] ?? "sp500";
      portfolioReturn += pct * (hist[col] / 100);
    });

    const yearInflation = hist.inflation / 100;

    // ── Record start-of-year balances in today's (start-year) dollars ─────────
    const total = taxable + taxDeferred + taxFree;
    results.push({
      age,
      year:            hist.year,
      taxable:         Math.max(0, taxable     / cumulativeInflation),
      taxDeferred:     Math.max(0, taxDeferred / cumulativeInflation),
      taxFree:         Math.max(0, taxFree     / cumulativeInflation),
      total:           Math.max(0, total       / cumulativeInflation),
      portfolioReturn: portfolioReturn * 100,
      inflation:       hist.inflation,
    });

    if (total <= 0) break;

    // ── Lump sums (today's $ → nominal by cumulativeInflation) ───────────────
    taxable += s.lumpSums
      .filter(l => l.age === age)
      .reduce((sum, l) => sum + l.amount * cumulativeInflation, 0);

    // ── Annuity income (today's $ → nominal) ─────────────────────────────────
    const annuityIncome = s.annuities
      .filter(a => age >= a.startAge)
      .reduce((sum, a) => sum + a.amount * cumulativeInflation, 0);

    // ── Total nominal spending need ───────────────────────────────────────────
    // Annual expenses are in today's $ → inflate; mortgage is already nominal.
    const mortgagePmt   = (s.mortgagePmt > 0 && yi < s.mortgageYears) ? s.mortgagePmt : 0;
    const nominalExpenses = s.annualExpenses * cumulativeInflation + mortgagePmt;

    // ── Cash buffer (earns 0%) ────────────────────────────────────────────────
    const cashTarget  = nominalExpenses * s.cashYears;
    const taxableCash = Math.min(taxable, cashTarget);
    const taxableInv  = Math.max(0, taxable - taxableCash);

    // ── Grow invested portions at this year's blended return ─────────────────
    taxable    = taxableCash + taxableInv   * (1 + portfolioReturn);
    taxDeferred = taxDeferred               * (1 + portfolioReturn);
    taxFree    = taxFree                    * (1 + portfolioReturn);

    // ── Withdrawals ───────────────────────────────────────────────────────────
    let needed = Math.max(0, nominalExpenses - annuityIncome);

    if (needed > 0) { // 1. Taxable
      const draw = Math.min(taxable, needed);
      taxable -= draw; needed -= draw;
    }
    if (needed > 0) { // 2. Tax-deferred (grossed up)
      const draw = Math.min(taxDeferred, needed / (1 - tax));
      taxDeferred -= draw; needed -= draw * (1 - tax);
    }
    if (needed > 0) { // 3. Tax-free
      const draw = Math.min(taxFree, needed);
      taxFree -= draw; needed -= draw;
    }

    taxable    = Math.max(0, taxable);
    taxDeferred = Math.max(0, taxDeferred);
    taxFree    = Math.max(0, taxFree);

    // Compound inflation for next year
    cumulativeInflation *= (1 + yearInflation);
  }

  return results;
}

// ── Formatting helpers ─────────────────────────────────────────────────────────
function fmtPct(v) {
  const s = (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
  return s;
}

function fmtShort(v) {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}k`;
  return `$${Math.round(v)}`;
}

function niceStep(maxVal, steps = 5) {
  if (maxVal <= 0) return 100000;
  const rough = maxVal / steps;
  const mag   = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm  = rough / mag;
  const nice  = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return nice * mag;
}

// ── Outcome categorization (all qualifying start years) ───────────────────────
// A simulation "qualifies" when there are enough years of data to reach age 95.
// Threshold: 150% of the original (start-year dollar) portfolio value.
// Insufficient — depleted before age 95
// Sufficient   — 0 < value_at_95 ≤ 1.5 × starting portfolio
// Excess       — value_at_95 > 1.5 × starting portfolio
function categorizeAllSimulations(s) {
  const totalStart   = s.taxable + s.taxFree + s.taxDeferred;
  const yearsNeeded  = 95 - s.currentAge;
  const lastQualYear = LAST_YEAR - yearsNeeded;

  let insufficient = 0, sufficient = 0, excess = 0;

  for (let yr = FIRST_YEAR; yr <= lastQualYear; yr++) {
    const sim  = runHistoricSimulation(s, yr);
    const pt95 = sim.find(d => d.age === 95);

    if (!pt95 || pt95.total <= 0) {
      insufficient++;
    } else if (pt95.total > 1.5 * totalStart) {
      excess++;
    } else {
      sufficient++;
    }
  }

  return {
    insufficient, sufficient, excess,
    total: insufficient + sufficient + excess,
  };
}

// ── Outcome pie chart ──────────────────────────────────────────────────────────
function drawOutcomePie(wrap, counts) {
  const { insufficient, sufficient, excess, total } = counts;

  const title = document.createElement("div");
  title.className = "hsim-pie-title";
  title.textContent = "Outcomes to Age 95";
  wrap.appendChild(title);

  if (total === 0) {
    const msg = document.createElement("p");
    msg.className = "ret-note";
    msg.style.textAlign = "center";
    msg.textContent = "No qualifying scenarios — choose an earlier start year.";
    wrap.appendChild(msg);
    return;
  }

  const SEGS = [
    { label: "Insufficient", count: insufficient, color: "#ef4444" },
    { label: "Sufficient",   count: sufficient,   color: "#f59e0b" },
    { label: "Excess",       count: excess,        color: "#22c55e" },
  ];

  const SIZE = 160, CX = 80, CY = 80, RO = 64, RI = 40;
  const NS  = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("width", SIZE); svg.setAttribute("height", SIZE);
  svg.setAttribute("style", "display:block;margin:0 auto");

  // Donut segment path: startDeg→endDeg, 0° = top, clockwise
  function arcPath(startDeg, endDeg) {
    const r = a => (a - 90) * Math.PI / 180;
    const [sx, sy] = [CX + RO * Math.cos(r(startDeg)), CY + RO * Math.sin(r(startDeg))];
    const [ex, ey] = [CX + RO * Math.cos(r(endDeg)),   CY + RO * Math.sin(r(endDeg))];
    const [ix, iy] = [CX + RI * Math.cos(r(endDeg)),   CY + RI * Math.sin(r(endDeg))];
    const [ox, oy] = [CX + RI * Math.cos(r(startDeg)), CY + RI * Math.sin(r(startDeg))];
    const lg = (endDeg - startDeg) > 180 ? 1 : 0;
    return `M${sx},${sy} A${RO},${RO} 0 ${lg} 1 ${ex},${ey} L${ix},${iy} A${RI},${RI} 0 ${lg} 0 ${ox},${oy} Z`;
  }

  let angle = 0;
  SEGS.forEach(seg => {
    if (!seg.count) return;
    const endAngle = angle + (seg.count / total) * 360;
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", arcPath(angle, endAngle - 0.4)); // tiny gap between segments
    path.setAttribute("fill", seg.color);
    path.setAttribute("opacity", "0.88");
    svg.appendChild(path);
    angle = endAngle;
  });

  // Center text: total count
  const ct = document.createElementNS(NS, "text");
  ct.setAttribute("x", CX); ct.setAttribute("y", CY - 6);
  ct.setAttribute("text-anchor", "middle"); ct.setAttribute("font-size", "22");
  ct.setAttribute("font-weight", "700"); ct.setAttribute("fill", "#e2e8f0");
  ct.textContent = total;
  svg.appendChild(ct);
  const cl = document.createElementNS(NS, "text");
  cl.setAttribute("x", CX); cl.setAttribute("y", CY + 12);
  cl.setAttribute("text-anchor", "middle"); cl.setAttribute("font-size", "10");
  cl.setAttribute("fill", "#718096");
  cl.textContent = "scenarios";
  svg.appendChild(cl);
  wrap.appendChild(svg);

  // Legend rows
  const legend = document.createElement("div");
  legend.className = "hsim-pie-legend";
  SEGS.forEach(seg => {
    const pct  = ((seg.count / total) * 100).toFixed(0);
    const item = document.createElement("div");
    item.className = "hsim-pie-legend-item";
    item.innerHTML =
      `<span class="hsim-pie-dot" style="background:${seg.color}"></span>` +
      `<span class="hsim-pie-lbl">${seg.label}</span>` +
      `<span class="hsim-pie-cnt">${seg.count} <span class="hsim-pie-pct">(${pct}%)</span></span>`;
    legend.appendChild(item);
  });
  wrap.appendChild(legend);
}

// ── Main render ────────────────────────────────────────────────────────────────
export function renderHistoricSimulationView(container) {
  const s = getSimInputs();

  function render() {
    container.innerHTML = "";

    // ── Header ──────────────────────────────────────────────────────────────
    const header = document.createElement("div");
    header.className = "view-header";
    const h1 = document.createElement("h1");
    h1.textContent = "Historic Simulation";
    header.appendChild(h1);
    container.appendChild(header);

    // ── Year selector ────────────────────────────────────────────────────────
    const controls = document.createElement("div");
    controls.className = "hsim-controls";

    const lbl = document.createElement("label");
    lbl.className = "hsim-year-label";
    lbl.textContent = "Retirement Start Year:";

    const sel = document.createElement("select");
    sel.className = "form-input hsim-year-select";
    for (let y = FIRST_YEAR; y <= LAST_YEAR; y++) {
      const opt = document.createElement("option");
      opt.value = y;
      opt.textContent = y;
      if (y === _startYear) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener("change", () => {
      _startYear = parseInt(sel.value, 10);
      render();
    });

    const hint = document.createElement("span");
    hint.className = "hsim-year-hint";
    hint.textContent = `Data available ${FIRST_YEAR}–${LAST_YEAR}. Simulation ends when data runs out.`;

    controls.appendChild(lbl);
    controls.appendChild(sel);
    controls.appendChild(hint);
    container.appendChild(controls);

    // ── Run selected simulation ───────────────────────────────────────────────
    const data = runHistoricSimulation(s, _startYear);

    if (data.length === 0) {
      const msg = document.createElement("p");
      msg.className = "ret-note";
      msg.textContent = `No historic data available starting in ${_startYear}.`;
      container.appendChild(msg);
      return;
    }

    const lastPt       = data[data.length - 1];
    const depleted     = lastPt.total <= 0;
    const dataEnded    = lastPt.year < _startYear + (100 - s.currentAge);
    const depletionAge = depleted ? lastPt.age : null;
    const totalStart   = s.taxable + s.taxFree + s.taxDeferred;

    // ── Top row: headline + summary (left) | pie chart (right) ───────────────
    const topRow = document.createElement("div");
    topRow.className = "hsim-top-row";
    container.appendChild(topRow);

    const topLeft = document.createElement("div");
    topLeft.className = "hsim-top-left";
    topRow.appendChild(topLeft);

    const topRight = document.createElement("div");
    topRight.className = "hsim-top-right";
    topRow.appendChild(topRight);

    // ── Headline card (inside left column) ───────────────────────────────────
    const headline = document.createElement("div");
    headline.className = "ret-headline-card";
    if (depleted) {
      headline.innerHTML = `
        <div class="ret-headline-label">Portfolio Depleted at Age</div>
        <div class="ret-headline-age ret-depleted">Age ${depletionAge}</div>
        <div class="ret-headline-sub">~${depletionAge - s.currentAge} years of retirement income
          (historic ${_startYear}–${lastPt.year})</div>`;
    } else if (dataEnded) {
      headline.innerHTML = `
        <div class="ret-headline-label">Historic Data Ends at Age ${lastPt.age}</div>
        <div class="ret-headline-age" style="color:var(--color-warning,#f59e0b)">Age ${lastPt.age}</div>
        <div class="ret-headline-sub">Portfolio: ${formatCurrency(lastPt.total)} remaining in ${_startYear}'s dollars
          — choose an earlier start year for a full run</div>`;
    } else {
      headline.innerHTML = `
        <div class="ret-headline-label">Estimated Portfolio Longevity</div>
        <div class="ret-headline-age ret-solvent">100+ Years</div>
        <div class="ret-headline-sub">Survives to age 100 with ${formatCurrency(lastPt.total)} remaining
          (${_startYear}'s dollars · historic ${_startYear}–${lastPt.year})</div>`;
    }
    topLeft.appendChild(headline);

    // ── Summary cards (inside left column) ───────────────────────────────────
    const midPt        = data[Math.floor(data.length / 2)];
    const avgReturn    = data.reduce((sum, d) => sum + d.portfolioReturn, 0) / data.length;
    const avgInflation = data.reduce((sum, d) => sum + d.inflation,       0) / data.length;

    const cards = document.createElement("div");
    cards.className = "ret-summary-cards";
    [
      ["Starting Portfolio",         formatCurrency(totalStart)],
      ["Avg Portfolio Return",        avgReturn.toFixed(1) + "%/yr"],
      ["Avg Inflation",               avgInflation.toFixed(1) + "%/yr"],
      ["Portfolio at Age " + (midPt?.age ?? "—"), midPt ? formatCurrency(midPt.total) : "—"],
    ].forEach(([label, value]) => {
      const card = document.createElement("div");
      card.className = "ret-summary-card";
      card.innerHTML = `<div class="ret-card-val">${value}</div><div class="ret-card-lbl">${label}</div>`;
      cards.appendChild(card);
    });
    topLeft.appendChild(cards);

    // ── Outcome pie chart (inside right column) ───────────────────────────────
    const counts = categorizeAllSimulations(s);
    drawOutcomePie(topRight, counts);

    // ── Stacked area chart ────────────────────────────────────────────────────
    const COLORS = {
      taxable:    "#3b82f6",
      taxDeferred: "#f59e0b",
      taxFree:    "#22c55e",
    };

    const chartWrap = document.createElement("div");
    chartWrap.className = "ret-chart-wrap";
    chartWrap.style.position = "relative";
    container.appendChild(chartWrap);

    const tooltip = document.createElement("div");
    tooltip.className = "report-tooltip";
    chartWrap.appendChild(tooltip);

    const events = [
      ...s.lumpSums.map(l  => ({ age: l.age,     label: `+${fmtShort(l.amount)}`,            type: "lump"    })),
      ...s.annuities.map(a => ({ age: a.startAge, label: `Annuity\n${fmtShort(a.amount)}/yr`, type: "annuity" })),
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
      const step     = niceStep(maxTotal);
      const yMax     = maxTotal > 0 ? Math.ceil(maxTotal / step) * step : step;
      const yTicks   = [];
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

      const defs = document.createElementNS(NS, "defs");
      svg.appendChild(defs);
      ["taxable", "taxDeferred", "taxFree"].forEach(key => {
        const grad = document.createElementNS(NS, "linearGradient");
        grad.setAttribute("id", `hsim-grad-${key}`);
        grad.setAttribute("x1", "0"); grad.setAttribute("y1", "0");
        grad.setAttribute("x2", "0"); grad.setAttribute("y2", "1");
        [[0, "0.55"], [100, "0.15"]].forEach(([offset, opacity]) => {
          const stop = document.createElementNS(NS, "stop");
          stop.setAttribute("offset", offset + "%");
          stop.setAttribute("stop-color", COLORS[key]);
          stop.setAttribute("stop-opacity", opacity);
          grad.appendChild(stop);
        });
        defs.appendChild(grad);
      });

      const g = document.createElementNS(NS, "g");
      g.setAttribute("transform", `translate(${MARGIN.left},${MARGIN.top})`);
      svg.appendChild(g);

      // Y grid + labels
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
        txt.setAttribute("text-anchor", "end"); txt.setAttribute("fill", "#718096"); txt.setAttribute("font-size", "11");
        txt.textContent = fmtShort(v);
        g.appendChild(txt);
      });

      // Axes
      [["x1","x2","y1","y2","0",cW.toString(),"0","0"],
       ["x1","x2","y1","y2","0","0","0",cH.toString()]].forEach(([a,b,c,d,v1,v2,v3,v4]) => {
        const line = document.createElementNS(NS, "line");
        line.setAttribute(a, v1); line.setAttribute(b, v2);
        line.setAttribute(c, v3); line.setAttribute(d, v4);
        line.setAttribute("stroke", "#2e3248");
        g.appendChild(line);
      });

      // X axis labels every 5 years, showing age (year)
      for (let a = Math.ceil(minAge / 5) * 5; a <= maxAge; a += 5) {
        const d = data.find(dp => dp.age === a);
        if (!d) continue;
        const x = xPx(a);
        const tick = document.createElementNS(NS, "line");
        tick.setAttribute("x1", x); tick.setAttribute("x2", x);
        tick.setAttribute("y1", cH); tick.setAttribute("y2", cH + 4);
        tick.setAttribute("stroke", "#2e3248");
        g.appendChild(tick);
        const lbl = document.createElementNS(NS, "text");
        lbl.setAttribute("x", x); lbl.setAttribute("y", cH + 16);
        lbl.setAttribute("text-anchor", "middle"); lbl.setAttribute("fill", "#718096"); lbl.setAttribute("font-size", "10");
        lbl.textContent = `${a}`;
        g.appendChild(lbl);
        const ylbl = document.createElementNS(NS, "text");
        ylbl.setAttribute("x", x); ylbl.setAttribute("y", cH + 28);
        ylbl.setAttribute("text-anchor", "middle"); ylbl.setAttribute("fill", "#4a5568"); ylbl.setAttribute("font-size", "9");
        ylbl.textContent = `(${d.year})`;
        g.appendChild(ylbl);
      }
      const xAxisLbl = document.createElementNS(NS, "text");
      xAxisLbl.setAttribute("x", cW / 2); xAxisLbl.setAttribute("y", cH + 44);
      xAxisLbl.setAttribute("text-anchor", "middle"); xAxisLbl.setAttribute("fill", "#718096"); xAxisLbl.setAttribute("font-size", "11");
      xAxisLbl.textContent = `Age (${_startYear}'s dollars)`;
      g.appendChild(xAxisLbl);

      // Stacked area bands
      const layers = [
        { key: "taxable",     getBase: _  => 0,                         getTop: d => d.taxable },
        { key: "taxDeferred", getBase: d  => d.taxable,                 getTop: d => d.taxable + d.taxDeferred },
        { key: "taxFree",     getBase: d  => d.taxable + d.taxDeferred, getTop: d => d.total },
      ];
      layers.forEach(({ key, getBase, getTop }) => {
        const fwd  = data.map(d => `${xPx(d.age)},${yPx(getTop(d))}`).join(" ");
        const back = [...data].reverse().map(d => `${xPx(d.age)},${yPx(getBase(d))}`).join(" ");
        const poly = document.createElementNS(NS, "polygon");
        poly.setAttribute("points", `${fwd} ${back}`);
        poly.setAttribute("fill", `url(#hsim-grad-${key})`);
        g.appendChild(poly);
        const line = document.createElementNS(NS, "polyline");
        line.setAttribute("points", fwd);
        line.setAttribute("fill", "none"); line.setAttribute("stroke", COLORS[key]);
        line.setAttribute("stroke-width", "1.5"); line.setAttribute("stroke-linejoin", "round");
        line.setAttribute("opacity", "0.7");
        g.appendChild(line);
      });

      // Total outline
      const totalPts = data.map(d => `${xPx(d.age)},${yPx(d.total)}`).join(" ");
      const totalLine = document.createElementNS(NS, "polyline");
      totalLine.setAttribute("points", totalPts);
      totalLine.setAttribute("fill", "none");
      totalLine.setAttribute("stroke", depleted ? "#ef4444" : "#e2e8f0");
      totalLine.setAttribute("stroke-width", "2"); totalLine.setAttribute("stroke-linejoin", "round");
      totalLine.setAttribute("opacity", "0.5");
      g.appendChild(totalLine);

      // Event markers
      events.forEach(ev => {
        if (ev.age < minAge || ev.age > maxAge) return;
        const dp = data.find(d => d.age === ev.age);
        if (!dp) return;
        const x = xPx(ev.age);
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
          t.setAttribute("fill", color); t.setAttribute("font-size", "10"); t.setAttribute("font-weight", "600");
          t.textContent = line;
          g.appendChild(t);
        });
      });

      // Hover interaction
      const hoverLine = document.createElementNS(NS, "line");
      hoverLine.setAttribute("y1", 0); hoverLine.setAttribute("y2", cH);
      hoverLine.setAttribute("stroke", "#718096"); hoverLine.setAttribute("stroke-width", "1");
      hoverLine.setAttribute("stroke-dasharray", "4,3"); hoverLine.setAttribute("opacity", "0");
      g.appendChild(hoverLine);

      svg.addEventListener("mousemove", e => {
        const rect = svg.getBoundingClientRect();
        const mx   = e.clientX - rect.left - MARGIN.left;
        if (mx < 0 || mx > cW) { tooltip.style.opacity = "0"; hoverLine.setAttribute("opacity", "0"); return; }
        const hovAge = minAge + (mx / cW) * ageRange;
        let closest = data[0];
        data.forEach(d => { if (Math.abs(d.age - hovAge) < Math.abs(closest.age - hovAge)) closest = d; });
        hoverLine.setAttribute("x1", xPx(closest.age)); hoverLine.setAttribute("x2", xPx(closest.age));
        hoverLine.setAttribute("opacity", "1");
        tooltip.innerHTML = `
          <strong>Age ${closest.age} (${closest.year})</strong><br>
          Total: ${formatCurrency(closest.total)}<br>
          Taxable: ${formatCurrency(closest.taxable)}<br>
          Tax-Deferred: ${formatCurrency(closest.taxDeferred)}<br>
          Tax-Free: ${formatCurrency(closest.taxFree)}<br>
          Portfolio Return: <span style="color:${closest.portfolioReturn>=0?'#22c55e':'#ef4444'}">${fmtPct(closest.portfolioReturn)}</span><br>
          Inflation: ${closest.inflation.toFixed(1)}%`;
        const tx = e.clientX - rect.left + 12;
        const ty = e.clientY - rect.top  - 10;
        tooltip.style.left    = Math.min(tx, W - 180) + "px";
        tooltip.style.top     = Math.max(0, ty)       + "px";
        tooltip.style.opacity = "1";
      });
      svg.addEventListener("mouseleave", () => {
        tooltip.style.opacity = "0";
        hoverLine.setAttribute("opacity", "0");
      });

      chartWrap.appendChild(svg);
    }

    drawChart();
    window.addEventListener("resize", drawChart, { once: true });

    // ── Legend ────────────────────────────────────────────────────────────────
    const legend = document.createElement("div");
    legend.className = "ret-chart-legend";
    [["Taxable", COLORS.taxable], ["Tax-Deferred", COLORS.taxDeferred], ["Tax-Free", COLORS.taxFree]].forEach(([lbl, color]) => {
      const item = document.createElement("span");
      item.className = "ret-legend-item";
      item.innerHTML = `<span class="ret-legend-dot" style="background:${color}"></span>${lbl}`;
      legend.appendChild(item);
    });
    container.appendChild(legend);

    // ── Year-by-year table ────────────────────────────────────────────────────
    const tableWrap = document.createElement("div");
    tableWrap.className = "hist-table-wrap hsim-table-wrap";
    container.appendChild(tableWrap);

    const table = document.createElement("table");
    table.className = "hist-table hsim-table";

    const thead = document.createElement("thead");
    thead.innerHTML = `<tr>
      <th>Year</th><th>Age</th>
      <th>Port. Return</th><th>Inflation</th>
      <th>Taxable</th><th>Tax-Deferred</th><th>Tax-Free</th><th>Total</th>
    </tr>`;
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    data.forEach(d => {
      const tr = document.createElement("tr");
      const retClass = d.portfolioReturn >= 0 ? "hist-pos" : "hist-neg";
      const inflClass = d.inflation > 5 ? "hist-neg" : d.inflation < 0 ? "hist-pos" : "";
      tr.innerHTML = `
        <td class="hist-year-cell">${d.year}</td>
        <td>${d.age}</td>
        <td class="${retClass}">${fmtPct(d.portfolioReturn)}</td>
        <td class="${inflClass}">${d.inflation.toFixed(1)}%</td>
        <td>${formatCurrency(d.taxable)}</td>
        <td>${formatCurrency(d.taxDeferred)}</td>
        <td>${formatCurrency(d.taxFree)}</td>
        <td><strong>${formatCurrency(d.total)}</strong></td>`;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tableWrap.appendChild(table);
  }

  render();
}
