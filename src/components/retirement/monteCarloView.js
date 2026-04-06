import { formatCurrency } from "../../utils/currency.js";
import { getSimInputs } from "./retirementView.js";
import { HISTORIC_DATA, ASSET_TYPE_TO_COLUMN } from "./historicData.js";
import { drawOutcomePie } from "./historicSimulationView.js";

const N_SIMS = 1000;

// ── Return statistics from historical data ────────────────────────────────────
function computeStats() {
  const cols = new Set(Object.values(ASSET_TYPE_TO_COLUMN));
  cols.add("inflation");
  const stats = {};
  for (const col of cols) {
    const vals = HISTORIC_DATA.map(d => d[col] / 100).filter(v => !isNaN(v));
    const n    = vals.length;
    const mean = vals.reduce((s, v) => s + v, 0) / n;
    const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    stats[col] = { mean, stddev: Math.sqrt(variance) };
  }
  return stats;
}

// Box-Muller normal distribution sample
function randNormal(mean, stddev) {
  let u;
  do { u = Math.random(); } while (u === 0);
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
  return mean + stddev * z;
}

// ── Single simulation run ─────────────────────────────────────────────────────
function runOneSim(s, stats) {
  const allocs     = s.glidePath.allocations;
  const transYears = s.glidePath.transitionYears;
  const tax        = Math.min(s.taxRate / 100, 0.99);

  let taxable     = s.taxable;
  let taxDeferred = s.taxDeferred;
  let taxFree     = s.taxFree;
  let cumulativeInflation = 1;

  const results = [];

  for (let age = s.currentAge; age <= 100; age++) {
    const yi = age - s.currentAge;
    const t  = transYears > 0 ? Math.min(yi / transYears, 1) : 1;

    // Blended return for this year (sampled)
    let portfolioReturn = 0;
    allocs.forEach(a => {
      const pct  = (a.startPct + (a.endPct - a.startPct) * t) / 100;
      const col  = ASSET_TYPE_TO_COLUMN[a.key] ?? "sp500";
      portfolioReturn += pct * randNormal(stats[col].mean, stats[col].stddev);
    });

    // Sampled inflation (floor at -5% to avoid extreme deflation)
    const yearInflation = Math.max(-0.05,
      randNormal(stats.inflation.mean, stats.inflation.stddev));

    const total = taxable + taxDeferred + taxFree;
    results.push({ age, total: Math.max(0, total / cumulativeInflation) });

    if (total <= 0) break;

    // Lump sums
    taxable += s.lumpSums
      .filter(l => l.age === age)
      .reduce((sum, l) => sum + l.amount * cumulativeInflation, 0);

    // Income
    const annuityIncome = s.annuities
      .filter(a => age >= a.startAge)
      .reduce((sum, a) => sum + a.amount * cumulativeInflation, 0);
    const ssFactor = s.ssInsolvency ? 0.8 : 1.0;
    const ssIncome = (s.incomeSources || [])
      .filter(src => age >= src.startAge && src.monthlyAmount > 0)
      .reduce((sum, src) => sum + src.monthlyAmount * 12 * cumulativeInflation * ssFactor, 0);

    const mortgagePmt     = (s.mortgagePmt > 0 && yi < s.mortgageYears) ? s.mortgagePmt : 0;
    const nominalExpenses = s.annualExpenses * cumulativeInflation + mortgagePmt;

    // Cash buffer + grow
    const cashTarget  = nominalExpenses * s.cashYears;
    const taxableCash = Math.min(taxable, cashTarget);
    const taxableInv  = Math.max(0, taxable - taxableCash);
    taxable     = taxableCash + taxableInv   * (1 + portfolioReturn);
    taxDeferred = taxDeferred                * (1 + portfolioReturn);
    taxFree     = taxFree                    * (1 + portfolioReturn);

    // Withdrawals
    let needed = Math.max(0, nominalExpenses - annuityIncome - ssIncome);
    if (needed > 0) { const d = Math.min(taxable,     needed);            taxable     -= d; needed -= d; }
    if (needed > 0) { const d = Math.min(taxDeferred, needed / (1 - tax)); taxDeferred -= d; needed -= d * (1 - tax); }
    if (needed > 0) { const d = Math.min(taxFree,     needed);            taxFree     -= d; needed -= d; }

    taxable     = Math.max(0, taxable);
    taxDeferred = Math.max(0, taxDeferred);
    taxFree     = Math.max(0, taxFree);
    cumulativeInflation *= (1 + yearInflation);
  }

  // Pad to 100 if depleted early
  if (results.length > 0) {
    const lastAge = results[results.length - 1].age;
    for (let a = lastAge + 1; a <= 100; a++) results.push({ age: a, total: 0 });
  }
  return results;
}

// ── Run all simulations + compute percentile bands ────────────────────────────
function runMonteCarlo(s) {
  const stats   = computeStats();
  const allSims = [];
  for (let i = 0; i < N_SIMS; i++) allSims.push(runOneSim(s, stats));

  const ages = [];
  for (let a = s.currentAge; a <= 100; a++) ages.push(a);

  const percentiles = ages.map(age => {
    const vals = allSims
      .map(sim => { const pt = sim.find(d => d.age === age); return pt ? pt.total : 0; })
      .sort((a, b) => a - b);
    const n   = vals.length;
    const pct = p => vals[Math.max(0, Math.floor(p * (n - 1)))];
    return { age, p10: pct(0.10), p25: pct(0.25), p50: pct(0.50), p75: pct(0.75), p90: pct(0.90) };
  });

  const totalStart = s.taxable + s.taxFree + s.taxDeferred;
  const age95vals  = allSims.map(sim => { const pt = sim.find(d => d.age === 95); return pt ? pt.total : 0; });
  const insufficient = age95vals.filter(v => v <= 0).length;
  const excess       = age95vals.filter(v => v > 1.5 * totalStart).length;
  const sufficient   = N_SIMS - insufficient - excess;

  return {
    percentiles,
    outcomes: { insufficient, sufficient, excess, total: N_SIMS },
    stats,
  };
}

// ── Formatting helpers ────────────────────────────────────────────────────────
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

// ── Fan chart ─────────────────────────────────────────────────────────────────
function drawFanChart(container, percentiles, s) {
  const oldSvg = container.querySelector("svg");
  if (oldSvg) oldSvg.remove();

  const MARGIN = { top: 28, right: 20, bottom: 52, left: 80 };
  const SVG_H  = 340;
  const W      = container.clientWidth || 700;
  const cW     = W - MARGIN.left - MARGIN.right;
  const cH     = SVG_H - MARGIN.top - MARGIN.bottom;
  const NS     = "http://www.w3.org/2000/svg";

  const maxVal = Math.max(...percentiles.map(p => p.p90), 0);
  const step   = niceStep(maxVal);
  const yMax   = maxVal > 0 ? Math.ceil(maxVal / step) * step : step;
  const yTicks = [];
  for (let v = 0; v <= yMax; v += step) yTicks.push(v);

  const minAge   = percentiles[0].age;
  const maxAge   = percentiles[percentiles.length - 1].age;
  const ageRange = Math.max(maxAge - minAge, 1);
  const xPx = age => ((age - minAge) / ageRange) * cW;
  const yPx = val  => cH - (Math.max(0, Math.min(val, yMax)) / yMax) * cH;

  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("width", W);
  svg.setAttribute("height", SVG_H);

  const g = document.createElementNS(NS, "g");
  g.setAttribute("transform", `translate(${MARGIN.left},${MARGIN.top})`);
  svg.appendChild(g);

  // Y grid + labels
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
    txt.setAttribute("text-anchor", "end"); txt.setAttribute("fill", "#718096"); txt.setAttribute("font-size", "11");
    txt.textContent = fmtShort(v);
    g.appendChild(txt);
  });

  // Axes
  [[0, 0, 0, cH], [0, cW, cH, cH]].forEach(([x1, x2, y1, y2]) => {
    const line = document.createElementNS(NS, "line");
    line.setAttribute("x1", x1); line.setAttribute("x2", x2);
    line.setAttribute("y1", y1); line.setAttribute("y2", y2);
    line.setAttribute("stroke", "#2e3248");
    g.appendChild(line);
  });

  // X axis labels every 5 years
  for (let a = Math.ceil(minAge / 5) * 5; a <= maxAge; a += 5) {
    const x    = xPx(a);
    const tick = document.createElementNS(NS, "line");
    tick.setAttribute("x1", x); tick.setAttribute("x2", x);
    tick.setAttribute("y1", cH); tick.setAttribute("y2", cH + 4);
    tick.setAttribute("stroke", "#2e3248");
    g.appendChild(tick);
    const lbl = document.createElementNS(NS, "text");
    lbl.setAttribute("x", x); lbl.setAttribute("y", cH + 16);
    lbl.setAttribute("text-anchor", "middle"); lbl.setAttribute("fill", "#718096"); lbl.setAttribute("font-size", "11");
    lbl.textContent = a;
    g.appendChild(lbl);
  }
  const xAxisLbl = document.createElementNS(NS, "text");
  xAxisLbl.setAttribute("x", cW / 2); xAxisLbl.setAttribute("y", cH + 38);
  xAxisLbl.setAttribute("text-anchor", "middle"); xAxisLbl.setAttribute("fill", "#718096"); xAxisLbl.setAttribute("font-size", "11");
  xAxisLbl.textContent = "Age (today's dollars, deflated by sampled inflation)";
  g.appendChild(xAxisLbl);

  // Helper: filled band between two percentile keys
  function addBand(hiKey, loKey, fill) {
    const fwd  = percentiles.map(p => `${xPx(p.age).toFixed(1)},${yPx(p[hiKey]).toFixed(1)}`).join(" ");
    const back = [...percentiles].reverse().map(p => `${xPx(p.age).toFixed(1)},${yPx(p[loKey]).toFixed(1)}`).join(" ");
    const poly = document.createElementNS(NS, "polygon");
    poly.setAttribute("points", `${fwd} ${back}`);
    poly.setAttribute("fill", fill);
    g.appendChild(poly);
  }

  addBand("p90", "p10", "rgba(99,102,241,0.10)");
  addBand("p75", "p25", "rgba(99,102,241,0.22)");

  // Median line
  const medPts = percentiles.map(p => `${xPx(p.age).toFixed(1)},${yPx(p.p50).toFixed(1)}`).join(" ");
  const medLine = document.createElementNS(NS, "polyline");
  medLine.setAttribute("points", medPts);
  medLine.setAttribute("fill", "none"); medLine.setAttribute("stroke", "#6366f1");
  medLine.setAttribute("stroke-width", "2.5"); medLine.setAttribute("stroke-linejoin", "round");
  g.appendChild(medLine);

  // Hover interaction
  const hoverLine = document.createElementNS(NS, "line");
  hoverLine.setAttribute("y1", 0); hoverLine.setAttribute("y2", cH);
  hoverLine.setAttribute("stroke", "#718096"); hoverLine.setAttribute("stroke-width", "1");
  hoverLine.setAttribute("stroke-dasharray", "4,3"); hoverLine.setAttribute("opacity", "0");
  g.appendChild(hoverLine);

  const tooltip = container.querySelector(".report-tooltip") ||
    (() => { const t = document.createElement("div"); t.className = "report-tooltip"; container.appendChild(t); return t; })();
  tooltip.style.opacity = "0";

  svg.addEventListener("mousemove", e => {
    const rect = svg.getBoundingClientRect();
    const mx   = e.clientX - rect.left - MARGIN.left;
    if (mx < 0 || mx > cW) { tooltip.style.opacity = "0"; hoverLine.setAttribute("opacity", "0"); return; }
    const hovAge = minAge + (mx / cW) * ageRange;
    let closest  = percentiles[0];
    percentiles.forEach(p => { if (Math.abs(p.age - hovAge) < Math.abs(closest.age - hovAge)) closest = p; });
    hoverLine.setAttribute("x1", xPx(closest.age)); hoverLine.setAttribute("x2", xPx(closest.age));
    hoverLine.setAttribute("opacity", "1");
    tooltip.innerHTML = `
      <strong>Age ${closest.age}</strong><br>
      90th pct: ${formatCurrency(closest.p90)}<br>
      75th pct: ${formatCurrency(closest.p75)}<br>
      Median:   <strong>${formatCurrency(closest.p50)}</strong><br>
      25th pct: ${formatCurrency(closest.p25)}<br>
      10th pct: ${formatCurrency(closest.p10)}`;
    const tx = e.clientX - rect.left + 12;
    const ty = e.clientY - rect.top  - 10;
    tooltip.style.left    = Math.min(tx, W - 180) + "px";
    tooltip.style.top     = Math.max(0, ty) + "px";
    tooltip.style.opacity = "1";
  });
  svg.addEventListener("mouseleave", () => {
    tooltip.style.opacity = "0";
    hoverLine.setAttribute("opacity", "0");
  });

  container.insertBefore(svg, tooltip);
}

// ── Main render ───────────────────────────────────────────────────────────────
export function renderMonteCarloView(container) {
  const s = getSimInputs();

  container.innerHTML = "";

  // Header
  const header = document.createElement("div");
  header.className = "view-header";
  const h1 = document.createElement("h1");
  h1.textContent = "Monte Carlo Simulation";
  header.appendChild(h1);
  container.appendChild(header);

  // Loading notice while computing
  const loadNote = document.createElement("p");
  loadNote.className = "ret-note";
  loadNote.textContent = `Running ${N_SIMS.toLocaleString()} simulations…`;
  container.appendChild(loadNote);

  // Defer computation to next frame so the loading message renders
  requestAnimationFrame(() => {
    const { percentiles, outcomes, stats } = runMonteCarlo(s);
    loadNote.remove();

    const totalStart = s.taxable + s.taxFree + s.taxDeferred;
    const p50at95    = percentiles.find(p => p.age === 95)?.p50 ?? 0;
    const p10at95    = percentiles.find(p => p.age === 95)?.p10 ?? 0;
    const p90at95    = percentiles.find(p => p.age === 95)?.p90 ?? 0;
    const survivePct = ((outcomes.sufficient + outcomes.excess) / outcomes.total * 100).toFixed(0);

    // ── Top row: summary cards + stats note (left) | outcome pie (right) ──
    const topRow = document.createElement("div");
    topRow.className = "hsim-top-row";
    container.appendChild(topRow);

    const topLeft  = document.createElement("div");
    topLeft.className  = "hsim-top-left";
    const topRight = document.createElement("div");
    topRight.className = "hsim-top-right";
    topRow.appendChild(topLeft);
    topRow.appendChild(topRight);

    // Stacked summary cards (left)
    const cards = document.createElement("div");
    cards.className = "mc-summary-stack";
    [
      ["Median Portfolio at 95",  formatCurrency(p50at95)],
      ["Survive to Age 95",       `${survivePct}% (${outcomes.sufficient + outcomes.excess}/${outcomes.total})`],
      ["10th Percentile at 95",   formatCurrency(p10at95)],
      ["90th Percentile at 95",   formatCurrency(p90at95)],
    ].forEach(([label, value]) => {
      const card = document.createElement("div");
      card.className = "ret-summary-card";
      card.innerHTML = `<div class="ret-card-val">${value}</div><div class="ret-card-lbl">${label}</div>`;
      cards.appendChild(card);
    });
    topLeft.appendChild(cards);

    // Return stats note (left, below cards)
    const statCols = [
      ["S&P 500",   "sp500"],
      ["Corp Bond", "corpBond"],
      ["T-Bill",    "tBill"],
      ["Real Estate","realEstate"],
      ["Inflation", "inflation"],
    ];
    const statsNote = document.createElement("p");
    statsNote.className = "ret-note mc-stats-note";
    statsNote.innerHTML = "Sampled from historical distributions: " +
      statCols.map(([lbl, col]) => {
        const st = stats[col];
        return st ? `${lbl} <strong>${(st.mean * 100).toFixed(1)}% ± ${(st.stddev * 100).toFixed(1)}%</strong>` : "";
      }).filter(Boolean).join(" · ");
    topLeft.appendChild(statsNote);

    // Outcome pie (right)
    drawOutcomePie(topRight, outcomes);

    // ── Fan chart ──────────────────────────────────────────────────────────
    const chartWrap = document.createElement("div");
    chartWrap.className = "ret-chart-wrap mc-chart-wrap";
    chartWrap.style.position = "relative";
    container.appendChild(chartWrap);
    drawFanChart(chartWrap, percentiles, s);
    const ro = new ResizeObserver(() => drawFanChart(chartWrap, percentiles, s));
    ro.observe(chartWrap);

    // ── Chart legend ───────────────────────────────────────────────────────
    const legend = document.createElement("div");
    legend.className = "ret-chart-legend";
    [
      ["Median", "solid", "#6366f1"],
      ["25th–75th percentile", "block", "rgba(99,102,241,0.4)"],
      ["10th–90th percentile", "block", "rgba(99,102,241,0.2)"],
    ].forEach(([label, type, color]) => {
      const item = document.createElement("div");
      item.className = "ret-legend-item";
      if (type === "solid") {
        item.innerHTML = `<span class="legend-dot" style="background:${color};border-radius:0;width:20px;height:3px;display:inline-block;vertical-align:middle;margin-right:6px"></span>${label}`;
      } else {
        item.innerHTML = `<span style="display:inline-block;width:20px;height:12px;background:${color};vertical-align:middle;margin-right:6px;border-radius:2px"></span>${label}`;
      }
      legend.appendChild(item);
    });
    container.appendChild(legend);

    // ── Methodology note ───────────────────────────────────────────────────
    const note = document.createElement("p");
    note.className = "ret-note";
    note.style.marginTop = "1rem";
    note.textContent = `Each simulation samples annual returns and inflation independently from historical distributions (${HISTORIC_DATA.length} years of data). All values shown in today's purchasing power (deflated by each run's sampled inflation). Uses your glide path, withdrawal order, and income sources from Inputs.`;
    container.appendChild(note);
  });
}
