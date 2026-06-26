import { formatCurrency } from "../../utils/currency.js";
import { getSimInputs } from "./retirementView.js";
import {
  getAccounts,
  getBudgetEstInputs,
  getBudgetEstInputsFromStorage,
  saveBudgetEstInputs,
  flushBudgetEstInputs,
} from "../../state.js";

// ── SVG helpers ───────────────────────────────────────────────────────────────
function svgEl(tag, attrs = {}) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function beNiceScale(minVal, maxVal, targetTicks = 5) {
  if (minVal === maxVal) { const p = Math.abs(minVal) * 0.1 || 100_000; minVal -= p; maxVal += p; }
  const range = maxVal - minVal;
  const roughStep = range / (targetTicks - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const norm = roughStep / mag;
  const mult = norm <= 1.5 ? 1 : norm <= 2.25 ? 2 : norm <= 3.5 ? 2.5 : norm <= 7 ? 5 : 10;
  const step = mult * mag;
  const ticks = [];
  let v = Math.floor(minVal / step) * step;
  const top = Math.ceil(maxVal / step) * step;
  while (v <= top + step * 1e-9) { ticks.push(Math.round(v / step) * step); v += step; }
  return ticks;
}

function beFmt(v) {
  const a = Math.abs(v);
  if (a >= 1_000_000) return (v < 0 ? "-$" : "$") + (Math.abs(v) / 1_000_000).toFixed(1) + "M";
  if (a >= 1_000)     return (v < 0 ? "-$" : "$") + (Math.abs(v) / 1_000).toFixed(0) + "K";
  return (v < 0 ? "-$" : "$") + Math.round(Math.abs(v));
}

// Local state — initialized once on first render
let _b = null;
let _bLoaded = false;
let _persistTimer = null;
let _dollarMode = "current";   // "current" = today's dollars, "future" = 3% inflation applied

const INFLATION = 0.03;        // assumed annual inflation, matches RoR hint

const ROR_VARIANTS = [
  { delta: +1.0, color: "#22c55e", dash: "6 3", label: "+1%" },
  { delta: +0.5, color: "#86efac", dash: "3 2", label: "+½%" },
  { delta: -0.5, color: "#fbbf24", dash: "3 2", label: "−½%" },
  { delta: -1.0, color: "#f87171", dash: "6 3", label: "−1%" },
];

function currentNetWorth() {
  let total = 0;
  for (const acct of getAccounts()) {
    const hist = acct.valueHistory;
    if (Array.isArray(hist) && hist.length > 0) {
      // Pick the entry with the latest date
      const latest = hist.reduce((a, b) => (a.date >= b.date ? a : b));
      total += latest.value ?? 0;
    }
  }
  return total;
}

function ensureLoaded() {
  if (_bLoaded) return;
  _bLoaded = true;

  const s       = getSimInputs();
  const primary = Array.isArray(s.incomeSources) ? s.incomeSources[0] : null;
  const ssAge   = primary?.startAge ?? 67;
  const nw      = currentNetWorth();

  // localStorage is always freshest; fall back to server data
  let saved = getBudgetEstInputsFromStorage();
  if (!saved) {
    saved = getBudgetEstInputs();
    // if localStorage was empty but server had data, re-sync localStorage
    if (saved) flushBudgetEstInputs(saved);
  }

  _b = {
    netWorth:    Math.round((nw > 0 ? nw : s.taxable + s.taxFree + s.taxDeferred) * 100) / 100,
    ror:         saved?.ror         ?? s.nominalGrowth,
    taxRate:     saved?.taxRate     ?? s.taxRate,
    age:         saved?.age         ?? s.currentAge,
    ssAge:       saved?.ssAge       ?? ssAge,
    annualSS:    saved?.annualSS    ?? (primary?.monthlyAmount ?? 0) * 12,
    postSSYears: saved?.postSSYears ?? Math.max(1, 95 - ssAge),
    budget:      saved?.budget      ?? null,
  };
}

function persistInputs() {
  const { ror, taxRate, age, ssAge, annualSS, postSSYears, budget } = _b;
  const inputs = { ror, taxRate, age, ssAge, annualSS, postSSYears, budget };
  flushBudgetEstInputs(inputs);               // immediate localStorage write
  clearTimeout(_persistTimer);
  _persistTimer = setTimeout(() => saveBudgetEstInputs(inputs), 500); // debounced server POST
}

// ── Projection data ───────────────────────────────────────────────────────────

// Returns {preDraw, postDraw} monthly portfolio withdrawals.
// budgetOverride: user-set post-tax monthly spend; null = solve to exhaust portfolio.
// rorForPmt: annual % used when solving for draws (ignored when budgetOverride set).
function computeDraws(b, budgetOverride, rorForPmt) {
  const ssMonthly = b.annualSS / 12;
  const n2        = b.postSSYears * 12;

  if (budgetOverride !== null) {
    const gross = budgetOverride / Math.max(0.01, 1 - b.taxRate / 100);
    return { preDraw: gross, postDraw: gross - ssMonthly };
  }

  const r   = rorForPmt / 100 / 12;
  const res = calcResults(b);
  if (res.monthlyBudget === null) return null;

  if (b.ssAge <= b.age) {
    return { preDraw: 0, postDraw: pmt(r, n2, b.netWorth) };
  }
  if (res.transitionValue === null) return null;
  const postDraw = pmt(r, n2, Math.max(0, res.transitionValue));
  return { preDraw: postDraw + ssMonthly, postDraw };
}

function buildNetWorthProjection(b, budgetOverride = null) {
  const r      = b.ror / 100 / 12;
  const draws  = computeDraws(b, budgetOverride, b.ror);
  if (!draws) return [];

  const n1 = (b.ssAge <= b.age) ? 0 : (b.ssAge - b.age) * 12;
  const n2 = b.postSSYears * 12;

  const points = [];
  let portfolio = b.netWorth;
  const total   = n1 + n2;
  for (let m = 0; m <= total; m++) {
    if (m % 12 === 0) points.push({ age: b.age + m / 12, value: portfolio, preSS: m < n1 });
    if (m < total) portfolio = portfolio * (1 + r) - (m < n1 ? draws.preDraw : draws.postDraw);
  }
  return points;
}

// Uses the base draw amounts (at base RoR or budgetOverride) but simulates with rorVariant,
// so variant lines show what happens if returns differ while spending stays the same.
function buildProjectionFixedDraw(b, rorVariant, budgetOverride = null) {
  const r     = Math.max(0, rorVariant) / 100 / 12;
  const draws = computeDraws(b, budgetOverride, b.ror);
  if (!draws) return [];

  const n1 = (b.ssAge <= b.age) ? 0 : (b.ssAge - b.age) * 12;
  const n2 = b.postSSYears * 12;

  const points = [];
  let portfolio = b.netWorth;
  const total   = n1 + n2;
  for (let m = 0; m <= total; m++) {
    if (m % 12 === 0) points.push({ age: b.age + m / 12, value: portfolio, preSS: m < n1 });
    if (m < total) portfolio = portfolio * (1 + r) - (m < n1 ? draws.preDraw : draws.postDraw);
  }
  return points;
}

// ── Chart renderer ────────────────────────────────────────────────────────────
function renderBudgetChart(chartDiv, points, b, variants = []) {
  chartDiv.innerHTML = "";
  if (points.length < 2) return;

  const W = 520, H = 220;
  const pad = { top: 20, right: 20, bottom: 30, left: 66 };
  const cW  = W - pad.left - pad.right;
  const cH  = H - pad.top  - pad.bottom;
  const n   = points.length;

  const allVals = [
    ...points.map(p => p.value),
    ...variants.flatMap(v => v.points.map(p => p.value)),
  ];
  const minVal  = 0;
  const maxVal  = Math.max(0, ...allVals);
  const ticks   = beNiceScale(minVal, maxVal, 5);
  const niceMin = ticks[0];
  const niceMax = ticks[ticks.length - 1];
  const nRange  = niceMax - niceMin || 1;

  const xOf = i => pad.left + (i / (n - 1)) * cW;
  // clamp at y-axis floor (niceMin=0) so lines don't extend below the chart area
  const yOf = v => Math.min(pad.top + cH, pad.top + cH - ((v - niceMin) / nRange) * cH);

  const PRIMARY = "var(--color-primary)";
  const POST_C  = "var(--color-success, #22c55e)";
  const alreadySS = b.ssAge <= b.age;
  // Index of first post-SS point
  const ssIdx = alreadySS ? 0 : (points.findIndex(p => !p.preSS) ?? 0);

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "be-chart-svg" });

  // Y grid + labels
  for (const v of ticks) {
    const y = yOf(v);
    svg.appendChild(svgEl("line", { x1: pad.left, y1: y, x2: pad.left + cW, y2: y, stroke: "var(--color-border)", "stroke-width": "1" }));
    const lbl = svgEl("text", { x: pad.left - 6, y: y + 4, "text-anchor": "end", fill: "var(--color-text-dim)", "font-size": "9", "font-family": "system-ui,sans-serif" });
    lbl.textContent = beFmt(v);
    svg.appendChild(lbl);
  }

  // SS transition vertical annotation
  if (!alreadySS && ssIdx > 0 && ssIdx < n) {
    const sx = xOf(ssIdx);
    svg.appendChild(svgEl("line", { x1: sx, y1: pad.top, x2: sx, y2: pad.top + cH, stroke: "var(--color-text-dim)", "stroke-width": "1", "stroke-dasharray": "4 3", opacity: "0.45" }));
    const ssLbl = svgEl("text", { x: sx + 4, y: pad.top + 11, fill: "var(--color-text-dim)", "font-size": "8.5", "font-family": "system-ui,sans-serif" });
    ssLbl.textContent = `SS age ${b.ssAge}`;
    svg.appendChild(ssLbl);
  }

  // Area + line helper
  function addSegment(from, to, color) {
    if (to <= from) return;
    const seg = points.slice(from, to + 1);
    const aD = `M ${xOf(from).toFixed(1)},${yOf(niceMin).toFixed(1)} ` +
      seg.map((p, i) => `L ${xOf(from + i).toFixed(1)},${yOf(p.value).toFixed(1)}`).join(" ") +
      ` L ${xOf(to).toFixed(1)},${yOf(niceMin).toFixed(1)} Z`;
    svg.appendChild(svgEl("path", { d: aD, fill: color, opacity: "0.13" }));

    const lD = seg.map((p, i) => `${i === 0 ? "M" : "L"} ${xOf(from + i).toFixed(1)} ${yOf(p.value).toFixed(1)}`).join(" ");
    svg.appendChild(svgEl("path", { d: lD, fill: "none", stroke: color, "stroke-width": "2", "stroke-linejoin": "round", "stroke-linecap": "round" }));
  }

  // Variant lines (drawn first, behind the main line)
  for (const v of variants) {
    if (v.points.length < 2) continue;
    const lD = v.points.map((p, i) => `${i === 0 ? "M" : "L"} ${xOf(i).toFixed(1)} ${yOf(p.value).toFixed(1)}`).join(" ");
    svg.appendChild(svgEl("path", { d: lD, fill: "none", stroke: v.color, "stroke-width": "1.5", "stroke-dasharray": v.dash, "stroke-linejoin": "round", "stroke-linecap": "round", opacity: "0.7" }));
  }

  if (!alreadySS && ssIdx > 0) addSegment(0, ssIdx, PRIMARY);
  addSegment(alreadySS ? 0 : ssIdx, n - 1, POST_C);

  // End dot
  const endC = POST_C;
  svg.appendChild(svgEl("circle", { cx: xOf(n - 1).toFixed(1), cy: yOf(points[n - 1].value).toFixed(1), r: "3.5", fill: endC }));

  // X-axis age labels
  const labelSet = new Set([points[0].age]);
  if (!alreadySS && ssIdx > 0) labelSet.add(points[ssIdx].age);
  labelSet.add(points[n - 1].age);
  for (const age of labelSet) {
    const idx = points.findIndex(p => p.age === age);
    if (idx < 0) continue;
    const anchor = idx === 0 ? "start" : idx === n - 1 ? "end" : "middle";
    const lbl = svgEl("text", { x: xOf(idx).toFixed(1), y: H - 4, "text-anchor": anchor, fill: "var(--color-text-dim)", "font-size": "9", "font-family": "system-ui,sans-serif" });
    lbl.textContent = `Age ${age}`;
    svg.appendChild(lbl);
  }

  // Depletion crossing labels — mark where any series first crosses below zero
  const allSeries = [
    { pts: points, color: POST_C },
    ...variants.map(v => ({ pts: v.points, color: v.color })),
  ];
  const depletionXPositions = new Set();
  for (const { pts, color } of allSeries) {
    const idx = pts.findIndex(p => p.value < 0);
    if (idx < 1) continue;
    const age = pts[idx].age;
    if (labelSet.has(age)) continue; // skip if already labelled
    const x = xOf(idx);
    // Avoid stacking labels at near-identical x positions (within 4px)
    const tooClose = [...depletionXPositions].some(ex => Math.abs(ex - x) < 4);
    if (tooClose) continue;
    depletionXPositions.add(x);
    svg.appendChild(svgEl("line", {
      x1: x.toFixed(1), y1: (pad.top + cH - 4).toFixed(1),
      x2: x.toFixed(1), y2: (pad.top + cH).toFixed(1),
      stroke: color, "stroke-width": "1.5",
    }));
    const lbl = svgEl("text", { x: x.toFixed(1), y: (H - 4).toFixed(1), "text-anchor": "middle", fill: color, "font-size": "8.5", "font-family": "system-ui,sans-serif" });
    lbl.textContent = `Age ${age}`;
    svg.appendChild(lbl);
  }

  // Legend — row 1: base series; row 2: variants
  const legX = pad.left;
  const legY = pad.top - 6;
  [[PRIMARY, "Pre-SS", ""], [POST_C, "Post-SS", ""]].forEach(([color, label], li) => {
    if (alreadySS && li === 0) return;
    const ox = legX + li * 80;
    svg.appendChild(svgEl("line", { x1: ox, y1: legY, x2: ox + 18, y2: legY, stroke: color, "stroke-width": "2.5", "stroke-linecap": "round" }));
    const t = svgEl("text", { x: ox + 22, y: legY + 4, fill: "var(--color-text-dim)", "font-size": "8.5", "font-family": "system-ui,sans-serif" });
    t.textContent = label;
    svg.appendChild(t);
  });
  // Variant legend — right-aligned on the same row as the base legend
  variants.forEach((v, li) => {
    const ox = W - pad.right - (variants.length - li) * 52;
    svg.appendChild(svgEl("line", { x1: ox, y1: legY, x2: ox + 14, y2: legY, stroke: v.color, "stroke-width": "1.5", "stroke-dasharray": v.dash, "stroke-linecap": "round", opacity: "0.8" }));
    const t = svgEl("text", { x: ox + 18, y: legY + 4, fill: "var(--color-text-dim)", "font-size": "8", "font-family": "system-ui,sans-serif" });
    t.textContent = v.label;
    svg.appendChild(t);
  });

  // Hover layer
  const hLine = svgEl("line", { x1: 0, y1: pad.top, x2: 0, y2: pad.top + cH, stroke: "var(--color-text-dim)", "stroke-width": "1", "stroke-dasharray": "3 2", opacity: "0" });
  svg.appendChild(hLine);
  const hDot = svgEl("circle", { cx: 0, cy: 0, r: "4", fill: PRIMARY, stroke: "var(--color-bg,#fff)", "stroke-width": "2", opacity: "0" });
  svg.appendChild(hDot);

  const TW = 140, TH = 42, TR = 5;
  const tip = svgEl("g", { opacity: "0", "pointer-events": "none" });
  tip.appendChild(svgEl("rect", { width: TW, height: TH, rx: TR, ry: TR, fill: "var(--color-surface,#1e2227)", stroke: "var(--color-border)", "stroke-width": "1" }));
  const tAge = svgEl("text", { x: TW / 2, y: 14, "text-anchor": "middle", fill: "var(--color-text-dim)", "font-size": "9", "font-family": "system-ui,sans-serif" });
  const tVal = svgEl("text", { x: TW / 2, y: 30, "text-anchor": "middle", fill: "var(--color-text,#e8eaf0)", "font-size": "11.5", "font-weight": "600", "font-family": "system-ui,sans-serif" });
  tip.appendChild(tAge); tip.appendChild(tVal);
  svg.appendChild(tip);

  const hit = svgEl("rect", { x: pad.left, y: pad.top, width: cW, height: cH, fill: "transparent", cursor: "crosshair" });
  svg.appendChild(hit);

  function onMove(clientX) {
    const rect = svg.getBoundingClientRect();
    const svgX  = ((clientX - rect.left) / rect.width) * W;
    const chartX = Math.max(0, Math.min(cW, svgX - pad.left));
    const idx    = Math.max(0, Math.min(n - 1, Math.round((chartX / cW) * (n - 1))));
    const pt     = points[idx];
    const cx     = xOf(idx), cy = yOf(pt.value);
    const color  = pt.preSS ? PRIMARY : POST_C;

    hLine.setAttribute("x1", cx); hLine.setAttribute("x2", cx); hLine.setAttribute("opacity", "1");
    hDot.setAttribute("cx", cx); hDot.setAttribute("cy", cy); hDot.setAttribute("fill", color); hDot.setAttribute("opacity", "1");

    tAge.textContent = `Age ${pt.age}  ·  ${pt.preSS ? "Pre-SS" : "Post-SS"}`;
    tVal.textContent = pt.value >= 0
      ? "$" + Math.round(pt.value).toLocaleString("en-US")
      : "Depleted";

    let tx = cx - TW / 2;
    if (tx < pad.left) tx = pad.left;
    if (tx + TW > W - pad.right) tx = W - pad.right - TW;
    const ty = cy - TH - 8 < pad.top ? cy + 10 : cy - TH - 8;
    tip.setAttribute("transform", `translate(${tx.toFixed(1)},${ty.toFixed(1)})`);
    tip.setAttribute("opacity", "1");
  }

  hit.addEventListener("mousemove",  e => onMove(e.clientX));
  hit.addEventListener("mouseleave", () => { hLine.setAttribute("opacity","0"); hDot.setAttribute("opacity","0"); tip.setAttribute("opacity","0"); });
  hit.addEventListener("touchmove",  e => { if (e.touches.length) { e.preventDefault(); onMove(e.touches[0].clientX); } }, { passive: false });
  hit.addEventListener("touchend",   () => { hLine.setAttribute("opacity","0"); hDot.setAttribute("opacity","0"); tip.setAttribute("opacity","0"); });

  chartDiv.appendChild(svg);
}

// Standard annuity payment: amount drawn each period to exhaust pv over n periods at rate r/period
function pmt(r, n, pv) {
  if (n <= 0) return 0;
  if (Math.abs(r) < 1e-10) return pv / n;
  return pv * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
}

function calcResults(b) {
  const r          = b.ror / 100 / 12;
  const ssMonthly  = b.annualSS / 12;
  const taxFactor  = 1 - b.taxRate / 100;
  const n2         = b.postSSYears * 12;

  // SS already in effect — no transition period
  if (b.ssAge <= b.age) {
    if (n2 <= 0) return { transitionValue: null, monthlyBudget: null };
    const monthly = (pmt(r, n2, b.netWorth) + ssMonthly) * taxFactor;
    return { transitionValue: null, monthlyBudget: monthly };
  }

  const n1 = (b.ssAge - b.age) * 12;
  if (n1 <= 0 || n2 <= 0) return { transitionValue: null, monthlyBudget: null };

  // Solve for SS Transition End Value (B8):
  // Pre-SS monthly withdrawal = pmt(r, n1, B1) - B8*r/(…)  — set equal to post-SS monthly.
  // Closed form derived from equating the two annuity equations.
  let B8;
  if (Math.abs(r) < 1e-10) {
    // r = 0 degenerate: PMT(0,n,pv) = pv/n
    const num = b.netWorth / n1 - ssMonthly;
    const den = 1 / n1 + 1 / n2;
    B8 = num / den;
  } else {
    const f1  = Math.pow(1 + r, n1);
    const f2  = Math.pow(1 + r, n2);
    const num = b.netWorth * r * f1 / (f1 - 1) - ssMonthly;
    const den = r * (1 / (f1 - 1) + f2 / (f2 - 1));
    B8 = num / den;
  }

  const monthly = (pmt(r, n2, B8) + ssMonthly) * taxFactor;
  return { transitionValue: B8, monthlyBudget: monthly };
}

// ── Render ────────────────────────────────────────────────────────────────────

export function renderBudgetEstView(container) {
  ensureLoaded();

  const _initBudget = (() => {
    const v = _b.budget ?? calcResults(_b).monthlyBudget;
    return v != null ? v.toFixed(2) : "";
  })();

  container.innerHTML = `
    <div class="budget-est-page">

      <div class="budget-est-left">
        <div class="ret-section">
          <div class="ret-section-title">Inputs</div>

          <div class="ret-field">
            <label class="ret-label" for="be-net-worth">Net Worth</label>
            <div class="ret-input-unit-row">
              <span class="ret-unit">$</span>
              <input id="be-net-worth" type="number" class="ret-num-input" step="100000"
                     value="${_b.netWorth}" min="0" />
              <button id="be-nw-reset" class="be-reset-btn" title="Reset to current net worth">Reset</button>
            </div>
          </div>

          <div class="ret-field">
            <label class="ret-label" for="be-ror">Annual RoR</label>
            <div class="ret-input-unit-row">
              <input id="be-ror" type="number" class="ret-num-input" step="0.1"
                     value="${_b.ror}" min="0" max="50" style="width:90px" />
              <span class="ret-unit">%</span>
              <span class="be-ror-hint">assumes 3.0% inflation</span>
            </div>
          </div>

          <div class="ret-field">
            <label class="ret-label" for="be-tax-rate">Tax Rate</label>
            <div class="ret-input-unit-row">
              <input id="be-tax-rate" type="number" class="ret-num-input" step="1"
                     value="${_b.taxRate}" min="0" max="99" style="width:90px" />
              <span class="ret-unit">%</span>
            </div>
          </div>

          <div class="ret-field">
            <label class="ret-label" for="be-age">Age</label>
            <input id="be-age" type="number" class="ret-num-input" step="1"
                   value="${_b.age}" min="1" max="120" style="width:90px" />
          </div>

          <div class="ret-field">
            <label class="ret-label" for="be-ss-age">SS Age</label>
            <input id="be-ss-age" type="number" class="ret-num-input" step="1"
                   value="${_b.ssAge}" min="1" max="120" style="width:90px" />
          </div>

          <div class="ret-field">
            <label class="ret-label" for="be-annual-ss">Annual SS</label>
            <div class="ret-input-unit-row">
              <span class="ret-unit">$</span>
              <input id="be-annual-ss" type="number" class="ret-num-input" step="100"
                     value="${_b.annualSS}" min="0" />
            </div>
          </div>

          <div class="ret-field">
            <label class="ret-label" for="be-post-ss-years">Post SS Years</label>
            <input id="be-post-ss-years" type="number" class="ret-num-input" step="1"
                   value="${_b.postSSYears}" min="1" max="60" style="width:90px" />
          </div>
        </div>
      </div>

      <div class="budget-est-right">
        <div id="be-results">
          <div class="ret-section">
            <div class="ret-section-title">Results</div>
            <div class="be-result-grid">
              <div class="be-result-row">
                <div class="be-result-label">
                  Post-Tax Monthly Budget
                  <span id="be-budget-hint" class="be-calc-hint"></span>
                </div>
                <div>
                  <input id="be-budget-input" type="number" class="ret-num-input be-budget-editable" step="100" min="0" value="${_initBudget}" />
                </div>
                <div id="be-budget-note" class="be-result-note"></div>
              </div>
              <div class="be-result-row" id="be-tv-row"></div>
            </div>
          </div>
        </div>
        <div id="be-chart" class="ret-section be-chart-wrap">
          <div class="be-chart-header">
            <div class="ret-section-title">Portfolio Projection</div>
            <div class="report-mode-toggle" id="be-dollar-toggle">
              <button class="report-mode-btn" data-dollar="current" title="Inflation-adjusted to today's purchasing power">Today's $</button>
              <button class="report-mode-btn" data-dollar="future" title="Nominal dollars with 3% annual inflation applied">Future $</button>
            </div>
          </div>
          <div id="be-chart-svg-wrap"></div>
        </div>
      </div>

    </div>
  `;

  function renderResults() {
    const res = calcResults(_b);
    const { transitionValue, monthlyBudget } = res;
    const alreadySS = _b.ssAge <= _b.age;
    const taxFactor = Math.max(0.01, 1 - _b.taxRate / 100);

    // Update the suggested-budget hint in parens
    const hint = container.querySelector("#be-budget-hint");
    if (hint) hint.textContent = monthlyBudget !== null ? `(${formatCurrency(monthlyBudget)}/mo)` : "";

    // Populate the input: if empty (e.g. after re-navigation), fill from saved budget or
    // calculated. If already has a value and no custom budget is set, track the calculation.
    const budgetInput = container.querySelector("#be-budget-input");
    if (budgetInput) {
      if (!budgetInput.value) {
        const fill = _b.budget ?? monthlyBudget;
        if (fill != null) budgetInput.value = fill.toFixed(2);
      } else if (_b.budget === null && monthlyBudget !== null) {
        budgetInput.value = monthlyBudget.toFixed(2);
      }
    }

    // Budget note
    const effectiveBudget = _b.budget !== null ? _b.budget : monthlyBudget;
    const budgetNote = container.querySelector("#be-budget-note");
    if (budgetNote) {
      budgetNote.innerHTML = effectiveBudget !== null
        ? `${alreadySS ? "From current portfolio" : "From transition portfolio"} over ${_b.postSSYears} yr + SS
           &nbsp;·&nbsp; Pre-tax: ${formatCurrency(effectiveBudget / taxFactor)}/mo`
        : "";
    }

    // SS Transition End Value row
    const preSSYears = _b.ssAge - _b.age;
    const tvNominal = transitionValue !== null && preSSYears > 0
      ? transitionValue * Math.pow(1.03, preSSYears) : null;

    const tvDisplay = alreadySS
      ? `<span class="be-na">N/A</span>`
      : transitionValue === null
        ? `<span class="be-na">—</span>`
        : `<span class="be-result-val">${formatCurrency(transitionValue)}</span>`;

    const tvNote = alreadySS
      ? "SS is already active — no transition period."
      : transitionValue !== null && transitionValue < 0
        ? "Portfolio depleted before SS — consider lower spending or later SS age."
        : "";

    const tvRow = container.querySelector("#be-tv-row");
    if (tvRow) {
      tvRow.innerHTML = `
        <div class="be-result-label">SS Transition End Value</div>
        <div>${tvDisplay}</div>
        ${!alreadySS && tvNominal !== null ? `<div class="be-result-label be-infl-adj">${formatCurrency(tvNominal)} in future dollars</div>` : ""}
        ${tvNote ? `<div class="be-result-note">${tvNote}</div>` : ""}
      `;
    }
  }

  const svgWrap = container.querySelector("#be-chart-svg-wrap");
  function refreshChart() {
    let points = buildNetWorthProjection(_b, _b.budget);
    const variants = ROR_VARIANTS.map(v => {
      let vpts = buildProjectionFixedDraw(_b, _b.ror + v.delta, _b.budget);
      if (_dollarMode === "future") {
        vpts = vpts.map(p => ({ ...p, value: p.value * Math.pow(1 + INFLATION, p.age - _b.age) }));
      }
      return { ...v, points: vpts };
    });
    if (_dollarMode === "future") {
      // Inflate each point from today's dollars to nominal dollars at its age
      points = points.map(p => ({
        ...p,
        value: p.value * Math.pow(1 + INFLATION, p.age - _b.age),
      }));
    }
    renderBudgetChart(svgWrap, points, _b, variants);
    container.querySelectorAll("#be-dollar-toggle [data-dollar]").forEach(btn =>
      btn.classList.toggle("active", btn.dataset.dollar === _dollarMode));
  }

  container.querySelector("#be-dollar-toggle").addEventListener("click", e => {
    const btn = e.target.closest("[data-dollar]");
    if (!btn || btn.dataset.dollar === _dollarMode) return;
    _dollarMode = btn.dataset.dollar;
    refreshChart();
  });

  renderResults();
  refreshChart();

  // Budget input — live editing drives the chart; Escape resets to calculated
  container.querySelector("#be-budget-input").addEventListener("input", e => {
    const val = parseFloat(e.target.value);
    _b.budget = isNaN(val) ? null : val;
    persistInputs();
    renderResults();
    refreshChart();
  });
  container.querySelector("#be-budget-input").addEventListener("keydown", e => {
    if (e.key === "Escape") {
      _b.budget = null;
      const res = calcResults(_b);
      e.target.value = res.monthlyBudget !== null ? res.monthlyBudget.toFixed(2) : "";
      persistInputs();
      renderResults();
      refreshChart();
    }
  });

  function onChange(e) {
    const id  = e.target.id;
    const val = parseFloat(e.target.value);
    if (isNaN(val)) return;
    if (id === "be-net-worth")     _b.netWorth    = val;
    if (id === "be-ror")           _b.ror         = val;
    if (id === "be-tax-rate")      _b.taxRate     = val;
    if (id === "be-age")           _b.age         = val;
    if (id === "be-ss-age")        _b.ssAge       = val;
    if (id === "be-annual-ss")     _b.annualSS    = val;
    if (id === "be-post-ss-years") _b.postSSYears = val;
    if (id !== "be-net-worth") persistInputs();
    renderResults();
    refreshChart();
  }

  container.querySelector(".budget-est-left").addEventListener("input", onChange);

  container.querySelector("#be-nw-reset").addEventListener("click", () => {
    const nw = Math.round(currentNetWorth() * 100) / 100;
    _b.netWorth = nw;
    container.querySelector("#be-net-worth").value = nw;
    renderResults();
    refreshChart();
  });
}
