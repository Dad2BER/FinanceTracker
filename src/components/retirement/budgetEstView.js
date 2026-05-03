import { formatCurrency } from "../../utils/currency.js";
import { getSimInputs } from "./retirementView.js";
import {
  getAccounts,
  getBudgetEstInputs,
  getBudgetEstInputsFromStorage,
  saveBudgetEstInputs,
  flushBudgetEstInputs,
} from "../../state.js";

// Local state — initialized once on first render
let _b = null;
let _bLoaded = false;
let _persistTimer = null;

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
  };
}

function persistInputs() {
  const { ror, taxRate, age, ssAge, annualSS, postSSYears } = _b;
  const inputs = { ror, taxRate, age, ssAge, annualSS, postSSYears };
  flushBudgetEstInputs(inputs);               // immediate localStorage write
  clearTimeout(_persistTimer);
  _persistTimer = setTimeout(() => saveBudgetEstInputs(inputs), 500); // debounced server POST
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
        <div id="be-results"></div>
      </div>

    </div>
  `;

  const resultsDiv = container.querySelector("#be-results");

  function renderResults() {
    const res = calcResults(_b);
    const { transitionValue, monthlyBudget } = res;
    const alreadySS = _b.ssAge <= _b.age;

    const tvDisplay = alreadySS
      ? `<span class="be-na">N/A</span>`
      : transitionValue === null
        ? `<span class="be-na">—</span>`
        : `<span class="be-result-val">${formatCurrency(transitionValue)}</span>`;

    const mbDisplay = monthlyBudget === null
      ? `<span class="be-na">—</span>`
      : `<span class="be-result-val ${monthlyBudget < 0 ? "be-negative" : ""}">${formatCurrency(monthlyBudget)}/mo</span>`;

    const tvNote = alreadySS
      ? "SS is already active — no transition period."
      : transitionValue !== null && transitionValue < 0
        ? "Portfolio depleted before SS — consider lower spending or later SS age."
        : "";

    resultsDiv.innerHTML = `
      <div class="ret-section">
        <div class="ret-section-title">Results</div>

        <div class="be-result-row">
          <div class="be-result-label">SS Transition End Value</div>
          <div>${tvDisplay}</div>
          ${tvNote ? `<div class="be-result-note">${tvNote}</div>` : ""}
        </div>

        <div class="be-result-row">
          <div class="be-result-label">Post-Tax Monthly Budget</div>
          <div>${mbDisplay}</div>
          <div class="be-result-note">
            ${alreadySS
              ? `From current portfolio over ${_b.postSSYears} yr + SS`
              : `From transition portfolio over ${_b.postSSYears} yr + SS`}
            &nbsp;·&nbsp; Pre-tax: ${monthlyBudget !== null ? formatCurrency(monthlyBudget / Math.max(0.01, 1 - _b.taxRate / 100)) + "/mo" : "—"}
          </div>
        </div>

        <div class="be-assumptions">
          <div class="be-assumptions-title">Assumptions</div>
          <div class="be-assump-grid">
            <span class="be-assump-key">Monthly RoR</span>
            <span class="be-assump-val">${(_b.ror / 12).toFixed(4)}%</span>
            <span class="be-assump-key">Pre-SS period</span>
            <span class="be-assump-val">${alreadySS ? "—" : (_b.ssAge - _b.age) + " yr"}</span>
            <span class="be-assump-key">Monthly SS income</span>
            <span class="be-assump-val">${formatCurrency(_b.annualSS / 12)}/mo</span>
          </div>
        </div>
      </div>
    `;
  }

  renderResults();

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
  }

  container.querySelector(".budget-est-left").addEventListener("input", onChange);

  container.querySelector("#be-nw-reset").addEventListener("click", () => {
    const nw = Math.round(currentNetWorth() * 100) / 100;
    _b.netWorth = nw;
    container.querySelector("#be-net-worth").value = nw;
    renderResults();
  });
}
