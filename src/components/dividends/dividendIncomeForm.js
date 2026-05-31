import { Modal } from "../ui/modal.js";
import { addDividendIncome, updateDividendIncome } from "../../state.js";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Form for adding / editing a dividend-income record.
 * `accounts` is the full account list (used to populate the Account dropdown).
 * `record` is null for add, or the existing record for edit.
 */
export function showDividendIncomeForm(accounts, record = null) {
  const isEdit = record !== null;

  const el = document.createElement("div");
  el.className = "dividend-form";

  const accountOptions = accounts
    .map((a) => `<option value="${escHtml(a.id)}" ${isEdit && record.accountId === a.id ? "selected" : ""}>${escHtml(a.name)}</option>`)
    .join("");

  el.innerHTML = `
    <h3>${isEdit ? "Edit Dividend Income" : "Add Dividend Income"}</h3>

    <div class="form-group">
      <label for="df-account">Account</label>
      <select id="df-account" class="form-select">
        <option value="">— Select account —</option>
        ${accountOptions}
      </select>
      <span class="field-error" id="df-account-err"></span>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label for="df-date">Date</label>
        <input id="df-date" type="date" class="form-input" value="${isEdit ? escHtml(record.date) : todayIso()}">
        <span class="field-error" id="df-date-err"></span>
      </div>
      <div class="form-group">
        <label for="df-symbol">Symbol</label>
        <input id="df-symbol" type="text" class="form-input" placeholder="e.g. SCHD"
          autocomplete="off" spellcheck="false"
          value="${isEdit ? escHtml(record.symbol || "") : ""}">
      </div>
    </div>

    <div class="form-group">
      <label for="df-description">Description</label>
      <input id="df-description" type="text" class="form-input" placeholder="e.g. Qualified dividend"
        value="${isEdit ? escHtml(record.description || "") : ""}">
    </div>

    <div class="form-group">
      <label for="df-amount">Amount</label>
      <input id="df-amount" type="number" step="0.01" class="form-input" placeholder="e.g. 125.00"
        value="${isEdit ? record.amount : ""}">
      <span class="field-error" id="df-amount-err"></span>
    </div>

    <div class="form-group">
      <label class="dividend-breakdown-label">Distribution <span style="font-weight:400;text-transform:none;letter-spacing:0">(optional)</span></label>
      <div class="form-row form-row-3">
        <div class="form-group">
          <label for="df-roc" class="dividend-sub-label">RoC</label>
          <input id="df-roc" type="number" step="0.01" class="form-input" placeholder="0.00"
            value="${isEdit && record.roc ? record.roc : ""}">
        </div>
        <div class="form-group">
          <label for="df-capgains" class="dividend-sub-label">Cap. Gains</label>
          <input id="df-capgains" type="number" step="0.01" class="form-input" placeholder="0.00"
            value="${isEdit && record.capGains ? record.capGains : ""}">
        </div>
        <div class="form-group">
          <label for="df-income" class="dividend-sub-label">Income</label>
          <input id="df-income" type="number" step="0.01" class="form-input" placeholder="0.00"
            value="${isEdit && record.income ? record.income : ""}">
        </div>
      </div>
      <span class="field-hint" id="df-breakdown-hint">Leave blank if not breaking the amount down.</span>
      <span class="field-error" id="df-breakdown-err"></span>
    </div>

    <div class="form-actions">
      <button class="btn btn-secondary" id="df-cancel">Cancel</button>
      <button class="btn btn-primary" id="df-submit">${isEdit ? "Save" : "Add"}</button>
    </div>
  `;

  const accountSel  = el.querySelector("#df-account");
  const dateInput   = el.querySelector("#df-date");
  const symbolInput = el.querySelector("#df-symbol");
  const descInput   = el.querySelector("#df-description");
  const amountInput = el.querySelector("#df-amount");
  const rocInput    = el.querySelector("#df-roc");
  const cgInput     = el.querySelector("#df-capgains");
  const incInput    = el.querySelector("#df-income");

  // Live hint: show running total of the breakdown vs. the amount
  const hintEl = el.querySelector("#df-breakdown-hint");
  function updateBreakdownHint() {
    const roc = parseFloat(rocInput.value) || 0;
    const cg  = parseFloat(cgInput.value) || 0;
    const inc = parseFloat(incInput.value) || 0;
    const sum = roc + cg + inc;
    if (sum === 0) {
      hintEl.textContent = "Leave blank if not breaking the amount down.";
      hintEl.classList.remove("field-hint-warn");
      return;
    }
    const amount = parseFloat(amountInput.value) || 0;
    const fmt = (n) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
    if (Math.abs(sum - amount) > 0.005) {
      hintEl.textContent = `Distribution totals ${fmt(sum)} — does not match Amount ${fmt(amount)}.`;
      hintEl.classList.add("field-hint-warn");
    } else {
      hintEl.textContent = `Distribution totals ${fmt(sum)} ✓`;
      hintEl.classList.remove("field-hint-warn");
    }
  }
  [amountInput, rocInput, cgInput, incInput].forEach((inp) =>
    inp.addEventListener("input", updateBreakdownHint)
  );

  el.querySelector("#df-cancel").addEventListener("click", () => Modal.close());

  el.querySelector("#df-submit").addEventListener("click", () => {
    const accountId   = accountSel.value;
    const date        = dateInput.value.trim();
    const symbol      = symbolInput.value.trim();
    const description = descInput.value.trim();
    const amountRaw   = amountInput.value.trim();

    let valid = true;
    el.querySelector("#df-account-err").textContent = "";
    el.querySelector("#df-date-err").textContent = "";
    el.querySelector("#df-amount-err").textContent = "";

    if (!accountId) {
      el.querySelector("#df-account-err").textContent = "Account is required.";
      valid = false;
    }
    if (!date) {
      el.querySelector("#df-date-err").textContent = "Date is required.";
      valid = false;
    }
    if (!amountRaw || isNaN(parseFloat(amountRaw))) {
      el.querySelector("#df-amount-err").textContent = "A valid amount is required.";
      valid = false;
    }
    if (!valid) return;

    const data = {
      accountId,
      date,
      description,
      symbol,
      amount:   parseFloat(amountRaw),
      roc:      parseFloat(rocInput.value) || 0,
      capGains: parseFloat(cgInput.value) || 0,
      income:   parseFloat(incInput.value) || 0,
    };

    if (isEdit) {
      updateDividendIncome(record.id, data);
    } else {
      addDividendIncome(data);
    }

    Modal.close();
  });

  Modal.open(el, null, { wide: true });
  setTimeout(() => accountSel.focus(), 50);
}
