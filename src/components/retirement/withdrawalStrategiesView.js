import { formatCurrency } from "../../utils/currency.js";
import { getSimInputs } from "./retirementView.js";

// ── IRS Uniform Lifetime Table (2022) ─────────────────────────────────────────
const RMD_TABLE = {
  72:27.4, 73:26.5, 74:25.5, 75:24.6, 76:23.7, 77:22.9,
  78:22.0, 79:21.1, 80:20.2, 81:19.4, 82:18.5, 83:17.7,
  84:16.8, 85:16.0, 86:15.2, 87:14.4, 88:13.7, 89:12.9,
  90:12.2, 91:11.5, 92:10.8, 93:10.1, 94:9.5,  95:8.9,
  96:8.4,  97:7.8,  98:7.3,  99:6.8, 100:6.4,
};
function rmdFactor(age) {
  return RMD_TABLE[Math.min(Math.max(age, 72), 100)] ?? 6.4;
}

// ── VPW withdrawal rate (annuity factor for finite horizon) ───────────────────
// withdrawal = portfolio × vpwRate(age, realReturn)
function vpwRate(age, realReturn) {
  const n = 100 - age;
  if (n <= 0) return 1;
  if (Math.abs(realReturn) < 0.0001) return 1 / n;
  const r = realReturn;
  return r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
}

// ── Strategy definitions ──────────────────────────────────────────────────────
export const STRATEGIES = [
  { id: "flexible", label: "Flexible",  color: "#94a3b8",
    desc: "Withdraw exactly what's needed each year. Spending stays constant in real terms." },
  { id: "4pct",     label: "4% Rule",   color: "#3b82f6",
    desc: "Withdraw 4% of the starting portfolio in year 1, then increase by inflation each year." },
  { id: "rmd",      label: "RMD",       color: "#f59e0b",
    desc: "Take IRS Required Minimum Distributions from tax-deferred at age 73+. Excess reinvested." },
  { id: "vpw",      label: "VPW",       color: "#22c55e",
    desc: "Variable Percentage Withdrawal — spending adjusts each year based on remaining portfolio and horizon." },
];

// ── Single-strategy simulation ────────────────────────────────────────────────
// Returns [{ age, total, withdrawal }] in today's dollars.
function runOneStrategy(s, strategyId) {
  const g          = s.nominalGrowth / 100;
  const infl       = s.inflation     / 100;
  const tax        = Math.min(s.taxRate / 100, 0.99);
  const totalStart = s.taxable + s.taxFree + s.taxDeferred;
  const realReturn = Math.max(-0.99, (s.nominalGrowth - s.inflation) / 100);

  // 4% rule base (initial annual withdrawal in nominal year-0 $)
  const rule4Base  = totalStart * 0.04;

  let taxable     = s.taxable;
  let taxDeferred = s.taxDeferred;
  let taxFree     = s.taxFree;
  const data      = [];

  for (let age = s.currentAge; age <= 100; age++) {
    const yi         = age - s.currentAge;
    const inflFactor = Math.pow(1 + infl, yi);
    const total      = taxable + taxDeferred + taxFree;
    const totalReal  = total / inflFactor;

    // Income
    const annIncome = s.annuities
      .filter(a => age >= a.startAge)
      .reduce((sum, a) => sum + a.amount * inflFactor, 0);
    const ssFactor = s.ssInsolvency ? 0.8 : 1.0;
    const ssIncome = (s.incomeSources || [])
      .filter(src => age >= src.startAge && src.monthlyAmount > 0)
      .reduce((sum, src) => sum + src.monthlyAmount * 12 * inflFactor * ssFactor, 0);
    const totalIncome = annIncome + ssIncome;

    const mortgagePmt     = (s.mortgagePmt > 0 && yi < s.mortgageYears) ? s.mortgagePmt : 0;
    const nominalExpenses = s.annualExpenses * inflFactor + mortgagePmt;

    // Record start-of-year values before growth
    const taxDeferredSOY = taxDeferred; // for RMD calculation

    // Lump sums
    taxable += s.lumpSums
      .filter(l => l.age === age)
      .reduce((sum, l) => sum + l.amount * inflFactor, 0);

    // Cash buffer + grow
    const cashTarget  = nominalExpenses * s.cashYears;
    const taxableCash = Math.min(taxable, cashTarget);
    const taxableInv  = Math.max(0, taxable - taxableCash);
    taxable     = taxableCash + taxableInv * (1 + g);
    taxDeferred = taxDeferred              * (1 + g);
    taxFree     = taxFree                  * (1 + g);

    const currentTotal = taxable + taxDeferred + taxFree;

    // ── Strategy-specific needed withdrawal (nominal) ──────────────────────
    let needed;
    let rmdExcess = 0; // RMD amount beyond what's needed (goes to taxable)

    switch (strategyId) {
      case "flexible":
        needed = Math.max(0, nominalExpenses - totalIncome);
        break;

      case "4pct":
        needed = Math.max(0, rule4Base * inflFactor - totalIncome);
        break;

      case "rmd":
        if (age >= 73 && taxDeferredSOY > 0) {
          const rmd = taxDeferredSOY / rmdFactor(age);
          const normalNeeded = Math.max(0, nominalExpenses - totalIncome);
          if (rmd > normalNeeded) {
            // Must take the full RMD; excess after spending is reinvested
            const rmdNet = rmd * (1 - tax); // after-tax proceeds from RMD
            rmdExcess = Math.max(0, rmdNet - normalNeeded);
            needed = normalNeeded; // we'll handle the forced RMD withdraw below
          } else {
            needed = normalNeeded;
          }
        } else {
          needed = Math.max(0, nominalExpenses - totalIncome);
        }
        break;

      case "vpw": {
        const rate        = vpwRate(age, realReturn);
        const vpwNominal  = (currentTotal / inflFactor) * rate * inflFactor;
        needed = Math.max(0, vpwNominal - totalIncome);
        break;
      }
    }

    // Record before withdrawals
    const withdrawalReal = needed / inflFactor;
    data.push({ age, total: Math.max(0, totalReal), withdrawal: withdrawalReal });
    if (total <= 0) break;

    // ── Withdraw ───────────────────────────────────────────────────────────
    if (strategyId === "rmd" && age >= 73 && taxDeferredSOY > 0 && rmdExcess > 0) {
      // Forced RMD withdrawal: take full RMD from tax-deferred regardless
      const rmd  = taxDeferredSOY / rmdFactor(age);
      const draw = Math.min(taxDeferred, rmd);
      taxDeferred -= draw;
      // Net of tax; excess reinvested to taxable
      const netRmd = draw * (1 - tax);
      const spend  = Math.max(0, nominalExpenses - totalIncome);
      taxable += Math.max(0, netRmd - spend);
    } else {
      let rem = needed;
      if (rem > 0) { const d = Math.min(taxable,     rem);            taxable     -= d; rem -= d; }
      if (rem > 0) { const d = Math.min(taxDeferred, rem / (1 - tax)); taxDeferred -= d; rem -= d * (1 - tax); }
      if (rem > 0) { const d = Math.min(taxFree,     rem);            taxFree     -= d; rem -= d; }
    }

    taxable     = Math.max(0, taxable);
    taxDeferred = Math.max(0, taxDeferred);
    taxFree     = Math.max(0, taxFree);
  }

  return data;
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

// ── Comparison chart ──────────────────────────────────────────────────────────
function drawComparisonChart(container, allData, tooltip) {
  const oldSvg = container.querySelector("svg");
  if (oldSvg) oldSvg.remove();

  const MARGIN = { top: 28, right: 20, bottom: 52, left: 80 };
  const SVG_H  = 340;
  const W      = container.clientWidth || 700;
  const cW     = W - MARGIN.left - MARGIN.right;
  const cH     = SVG_H - MARGIN.top - MARGIN.bottom;
  const NS     = "http://www.w3.org/2000/svg";

  const allTotals = STRATEGIES.flatMap(st => (allData[st.id] || []).map(d => d.total));
  const maxVal    = Math.max(...allTotals, 0);
  const step      = niceStep(maxVal);
  const yMax      = maxVal > 0 ? Math.ceil(maxVal / step) * step : step;
  const yTicks    = [];
  for (let v = 0; v <= yMax; v += step) yTicks.push(v);

  // Determine age range from flexible (always present)
  const flexData = allData["flexible"] || [];
  const minAge   = flexData[0]?.age ?? 60;
  const maxAge   = 100;
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

  // X axis labels
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
  xAxisLbl.textContent = "Age (today's dollars)";
  g.appendChild(xAxisLbl);

  // One polyline per strategy
  STRATEGIES.forEach(st => {
    const data = allData[st.id] || [];
    if (data.length < 2) return;
    const pts = data.map(d => `${xPx(d.age).toFixed(1)},${yPx(d.total).toFixed(1)}`).join(" ");
    const line = document.createElementNS(NS, "polyline");
    line.setAttribute("points", pts);
    line.setAttribute("fill", "none"); line.setAttribute("stroke", st.color);
    line.setAttribute("stroke-width", "2.5"); line.setAttribute("stroke-linejoin", "round");
    g.appendChild(line);
  });

  // Hover
  const hoverLine = document.createElementNS(NS, "line");
  hoverLine.setAttribute("y1", 0); hoverLine.setAttribute("y2", cH);
  hoverLine.setAttribute("stroke", "#718096"); hoverLine.setAttribute("stroke-width", "1");
  hoverLine.setAttribute("stroke-dasharray", "4,3"); hoverLine.setAttribute("opacity", "0");
  g.appendChild(hoverLine);

  svg.addEventListener("mousemove", e => {
    const rect = svg.getBoundingClientRect();
    const mx   = e.clientX - rect.left - MARGIN.left;
    if (mx < 0 || mx > cW) { tooltip.style.opacity = "0"; hoverLine.setAttribute("opacity", "0"); return; }
    const hovAge = Math.round(minAge + (mx / cW) * ageRange);
    hoverLine.setAttribute("x1", xPx(hovAge)); hoverLine.setAttribute("x2", xPx(hovAge));
    hoverLine.setAttribute("opacity", "1");
    let html = `<strong>Age ${hovAge}</strong><br>`;
    STRATEGIES.forEach(st => {
      const pt = (allData[st.id] || []).find(d => d.age === hovAge);
      if (pt) {
        html += `<span style="color:${st.color}">${st.label}:</span> ${formatCurrency(pt.total)}<br>`;
      }
    });
    const tx = e.clientX - rect.left + 12;
    const ty = e.clientY - rect.top  - 10;
    tooltip.style.left    = Math.min(tx, W - 200) + "px";
    tooltip.style.top     = Math.max(0, ty) + "px";
    tooltip.innerHTML     = html;
    tooltip.style.opacity = "1";
  });
  svg.addEventListener("mouseleave", () => {
    tooltip.style.opacity = "0"; hoverLine.setAttribute("opacity", "0");
  });

  container.insertBefore(svg, tooltip);
}

// ── Withdrawal-rate delta chart ───────────────────────────────────────────────
// Y axis: % difference in annual withdrawal vs. Flexible baseline.
// delta = (strategy_withdrawal − flex_withdrawal) / flex_withdrawal × 100
function drawDeltaChart(container, allData, tooltip) {
  const oldSvg = container.querySelector("svg");
  if (oldSvg) oldSvg.remove();

  const MARGIN = { top: 28, right: 20, bottom: 52, left: 64 };
  const SVG_H  = 280;
  const W      = container.clientWidth || 700;
  const cW     = W - MARGIN.left - MARGIN.right;
  const cH     = SVG_H - MARGIN.top - MARGIN.bottom;
  const NS     = "http://www.w3.org/2000/svg";

  // Build per-age flexible withdrawal map for ALL ages where flexible portfolio > 0.
  // Keyed to withdrawal amount (may be 0 when income covers expenses).
  const flexMap = {};
  (allData["flexible"] || []).forEach(d => {
    if (d.total > 0 || d.withdrawal > 0) flexMap[d.age] = d.withdrawal;
  });

  // delta(age) = (strategy_withdrawal - flex_withdrawal) / flex_withdrawal * 100
  // Special cases: both 0 → delta 0; flex 0 but strategy > 0 → skip (undefined %).
  const getDelta = (stratWd, flexWd) => {
    if (flexWd === 0 && stratWd === 0) return 0;
    if (flexWd === 0) return null;          // can't express as % of 0
    return (stratWd - flexWd) / flexWd * 100;
  };

  const nonFlex = STRATEGIES.filter(st => st.id !== "flexible");
  const allDeltas = nonFlex.flatMap(st =>
    (allData[st.id] || [])
      .filter(d => flexMap[d.age] !== undefined)
      .map(d => getDelta(d.withdrawal, flexMap[d.age]))
      .filter(v => v !== null)
  );
  if (allDeltas.length === 0) return;

  const rawMax = Math.max(...allDeltas.map(Math.abs), 1);
  const step   = niceStep(rawMax * 2, 4) / 2; // symmetric, 4 ticks each side
  const yMax   = Math.ceil(rawMax / step) * step;
  const yTicks = [];
  for (let v = -yMax; v <= yMax; v += step) yTicks.push(+v.toFixed(8));

  const flexData = allData["flexible"] || [];
  const minAge   = flexData[0]?.age ?? 60;
  const maxAge   = 100;
  const ageRange = Math.max(maxAge - minAge, 1);
  const xPx = age => ((age - minAge) / ageRange) * cW;
  const yPx = val  => cH / 2 - (val / yMax) * (cH / 2);

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
    line.setAttribute("stroke", v === 0 ? "#4a5078" : "#2e3248");
    if (v !== 0) line.setAttribute("stroke-dasharray", "4,3");
    g.appendChild(line);
    const txt = document.createElementNS(NS, "text");
    txt.setAttribute("x", -8); txt.setAttribute("y", y); txt.setAttribute("dy", "0.35em");
    txt.setAttribute("text-anchor", "end"); txt.setAttribute("fill", "#718096"); txt.setAttribute("font-size", "11");
    txt.textContent = (v >= 0 ? "+" : "") + v.toFixed(1) + "%";
    g.appendChild(txt);
  });

  // "Flexible (0%)" baseline label
  const baseLabel = document.createElementNS(NS, "text");
  baseLabel.setAttribute("x", cW + 4); baseLabel.setAttribute("y", yPx(0));
  baseLabel.setAttribute("dy", "0.35em"); baseLabel.setAttribute("fill", "#94a3b8");
  baseLabel.setAttribute("font-size", "10");
  baseLabel.textContent = "Flexible";
  g.appendChild(baseLabel);

  // Axes
  [[0, 0, 0, cH], [0, cW, cH, cH]].forEach(([x1, x2, y1, y2]) => {
    const line = document.createElementNS(NS, "line");
    line.setAttribute("x1", x1); line.setAttribute("x2", x2);
    line.setAttribute("y1", y1); line.setAttribute("y2", y2);
    line.setAttribute("stroke", "#2e3248");
    g.appendChild(line);
  });

  // X axis labels
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
  xAxisLbl.textContent = "Age";
  g.appendChild(xAxisLbl);

  // Polylines for non-flexible strategies (skip points where delta is undefined)
  nonFlex.forEach(st => {
    const pts = (allData[st.id] || [])
      .filter(d => flexMap[d.age] !== undefined)
      .map(d => {
        const delta = getDelta(d.withdrawal, flexMap[d.age]);
        if (delta === null) return null;
        return `${xPx(d.age).toFixed(1)},${yPx(delta).toFixed(1)}`;
      }).filter(Boolean).join(" ");
    if (!pts) return;
    const line = document.createElementNS(NS, "polyline");
    line.setAttribute("points", pts);
    line.setAttribute("fill", "none"); line.setAttribute("stroke", st.color);
    line.setAttribute("stroke-width", "2.5"); line.setAttribute("stroke-linejoin", "round");
    g.appendChild(line);
  });

  // Hover
  const hoverLine = document.createElementNS(NS, "line");
  hoverLine.setAttribute("y1", 0); hoverLine.setAttribute("y2", cH);
  hoverLine.setAttribute("stroke", "#718096"); hoverLine.setAttribute("stroke-width", "1");
  hoverLine.setAttribute("stroke-dasharray", "4,3"); hoverLine.setAttribute("opacity", "0");
  g.appendChild(hoverLine);

  svg.addEventListener("mousemove", e => {
    const rect   = svg.getBoundingClientRect();
    const mx     = e.clientX - rect.left - MARGIN.left;
    if (mx < 0 || mx > cW) { tooltip.style.opacity = "0"; hoverLine.setAttribute("opacity", "0"); return; }
    const hovAge = Math.round(minAge + (mx / cW) * ageRange);
    hoverLine.setAttribute("x1", xPx(hovAge)); hoverLine.setAttribute("x2", xPx(hovAge));
    hoverLine.setAttribute("opacity", "1");
    const flexWd = flexMap[hovAge];
    if (flexWd === undefined) { tooltip.style.opacity = "0"; return; }
    let html = `<strong>Age ${hovAge}</strong><br>`;
    html += `<span style="color:#94a3b8">Flexible:</span> ${formatCurrency(flexWd)} (baseline)<br>`;
    nonFlex.forEach(st => {
      const pt = (allData[st.id] || []).find(d => d.age === hovAge);
      if (pt) {
        const delta = getDelta(pt.withdrawal, flexWd);
        const deltaStr = delta === null ? "n/a" : (delta >= 0 ? "+" : "") + delta.toFixed(1) + "%";
        html += `<span style="color:${st.color}">${st.label}:</span> ${formatCurrency(pt.withdrawal)} (${deltaStr})<br>`;
      }
    });
    const tx = e.clientX - rect.left + 12;
    const ty = e.clientY - rect.top  - 10;
    tooltip.style.left    = Math.min(tx, W - 220) + "px";
    tooltip.style.top     = Math.max(0, ty) + "px";
    tooltip.innerHTML     = html;
    tooltip.style.opacity = "1";
  });
  svg.addEventListener("mouseleave", () => {
    tooltip.style.opacity = "0"; hoverLine.setAttribute("opacity", "0");
  });

  container.insertBefore(svg, tooltip);
}

// ── Main render ───────────────────────────────────────────────────────────────
export function renderWithdrawalStrategiesView(container) {
  const s = getSimInputs();
  container.innerHTML = "";

  // Header
  const header = document.createElement("div");
  header.className = "view-header";
  const h1 = document.createElement("h1");
  h1.textContent = "Withdrawal Strategies";
  header.appendChild(h1);
  container.appendChild(header);

  const note = document.createElement("p");
  note.className = "ret-note";
  note.textContent = `Comparing four withdrawal strategies using ${s.nominalGrowth}% nominal growth and ${s.inflation}% inflation from your Simple Assumptions. All values in today's dollars.`;
  container.appendChild(note);

  // ── Run all strategies ───────────────────────────────────────────────────
  const allData = {};
  STRATEGIES.forEach(st => { allData[st.id] = runOneStrategy(s, st.id); });

  // ── Strategy description cards ───────────────────────────────────────────
  const descGrid = document.createElement("div");
  descGrid.className = "strat-desc-grid";
  STRATEGIES.forEach(st => {
    const card = document.createElement("div");
    card.className = "strat-desc-card";
    const data     = allData[st.id] || [];
    const last     = data[data.length - 1];
    const depleted = last?.total <= 0;
    const deplAge  = depleted ? last.age : null;

    const dot = document.createElement("div");
    dot.className = "strat-color-dot";
    dot.style.background = st.color;

    const lbl = document.createElement("div");
    lbl.className = "strat-card-label";
    lbl.style.color = st.color;
    lbl.textContent = st.label;

    const result = document.createElement("div");
    result.className = "strat-card-result";
    result.textContent = depleted
      ? `Depletes at ${deplAge}`
      : `Survives to 100+`;
    result.style.color = depleted ? "var(--color-danger)" : "var(--color-success)";

    const age90pt = data.find(d => d.age === 90);
    const age90   = document.createElement("div");
    age90.className = "strat-card-age90";
    age90.textContent = age90pt ? `Age 90: ${formatCurrency(age90pt.total)}` : "";

    const desc = document.createElement("div");
    desc.className = "strat-card-desc";
    desc.textContent = st.desc;

    card.append(dot, lbl, result, age90, desc);
    descGrid.appendChild(card);
  });
  container.appendChild(descGrid);

  // ── Comparison chart ─────────────────────────────────────────────────────
  const chartWrap = document.createElement("div");
  chartWrap.className = "ret-chart-wrap";
  chartWrap.style.position = "relative";
  const tooltip = document.createElement("div");
  tooltip.className = "report-tooltip";
  tooltip.style.opacity = "0";
  chartWrap.appendChild(tooltip);
  container.appendChild(chartWrap);

  drawComparisonChart(chartWrap, allData, tooltip);
  const ro = new ResizeObserver(() => drawComparisonChart(chartWrap, allData, tooltip));
  ro.observe(chartWrap);

  // ── Chart legend ─────────────────────────────────────────────────────────
  const legend = document.createElement("div");
  legend.className = "ret-chart-legend";
  STRATEGIES.forEach(st => {
    const item = document.createElement("div");
    item.className = "ret-legend-item";
    item.innerHTML = `<span class="legend-dot" style="background:${st.color}"></span>${st.label}`;
    legend.appendChild(item);
  });
  container.appendChild(legend);

  // ── Withdrawal-rate delta chart ──────────────────────────────────────────
  const deltaLabel = document.createElement("h3");
  deltaLabel.className = "ret-section-title";
  deltaLabel.textContent = "Annual Withdrawal vs. Flexible (% delta)";
  container.appendChild(deltaLabel);

  const deltaNote = document.createElement("p");
  deltaNote.className = "ret-note";
  deltaNote.textContent = "Shows how much each strategy's annual withdrawal differs from Flexible each year, as a percentage of what Flexible would spend. Above 0 = spending more; below 0 = spending less.";
  container.appendChild(deltaNote);

  const deltaWrap = document.createElement("div");
  deltaWrap.className = "ret-chart-wrap";
  deltaWrap.style.position = "relative";
  const deltaTooltip = document.createElement("div");
  deltaTooltip.className = "report-tooltip";
  deltaTooltip.style.opacity = "0";
  deltaWrap.appendChild(deltaTooltip);
  container.appendChild(deltaWrap);

  drawDeltaChart(deltaWrap, allData, deltaTooltip);
  const deltaRo = new ResizeObserver(() => drawDeltaChart(deltaWrap, allData, deltaTooltip));
  deltaRo.observe(deltaWrap);

  // Delta legend (non-flexible only)
  const deltaLegend = document.createElement("div");
  deltaLegend.className = "ret-chart-legend";
  STRATEGIES.filter(st => st.id !== "flexible").forEach(st => {
    const item = document.createElement("div");
    item.className = "ret-legend-item";
    item.innerHTML = `<span class="legend-dot" style="background:${st.color}"></span>${st.label}`;
    deltaLegend.appendChild(item);
  });
  container.appendChild(deltaLegend);

  // ── Annual spending comparison table ─────────────────────────────────────
  const tableWrap = document.createElement("div");
  tableWrap.className = "ret-table-wrap";
  const tbl = document.createElement("table");
  tbl.className = "ret-table strat-table";
  tbl.innerHTML = `
    <thead><tr>
      <th>Age</th>
      ${STRATEGIES.map(st => `<th style="color:${st.color}">${st.label} Spend/yr</th>`).join("")}
      ${STRATEGIES.map(st => `<th style="color:${st.color}">${st.label} Total</th>`).join("")}
    </tr></thead>`;

  const tbody = document.createElement("tbody");
  const maxAge = 100;
  for (let age = s.currentAge; age <= maxAge; age += 5) {
    const tr = document.createElement("tr");
    const ageTd = document.createElement("td");
    ageTd.textContent = age;
    tr.appendChild(ageTd);

    STRATEGIES.forEach(st => {
      const pt = (allData[st.id] || []).find(d => d.age === age);
      const td = document.createElement("td");
      if (pt && pt.total > 0) {
        td.textContent = pt.withdrawal > 0 ? formatCurrency(pt.withdrawal) : "$0";
        if (pt.withdrawal === 0) td.style.color = "var(--color-text-muted, #718096)";
      } else {
        td.textContent = "—";
      }
      tr.appendChild(td);
    });
    STRATEGIES.forEach(st => {
      const pt = (allData[st.id] || []).find(d => d.age === age);
      const td = document.createElement("td");
      td.textContent = pt && pt.total > 0 ? formatCurrency(pt.total) : "—";
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }

  tbl.appendChild(tbody);
  tableWrap.appendChild(tbl);
  container.appendChild(tableWrap);
}
