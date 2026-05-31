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
      <label class="dividend-breakdown-label">Per Share Distribution <span style="font-weight:400;text-transform:none;letter-spacing:0">(optional)</span></label>
      <div class="form-row form-row-3">
        <div class="form-group">
          <label for="df-ps-total" class="dividend-sub-label">Total / sh</label>
          <input id="df-ps-total" type="number" step="0.0001" class="form-input" placeholder="0.0000"
            value="${isEdit && record.perShareTotal ? record.perShareTotal : ""}">
        </div>
        <div class="form-group">
          <label for="df-ps-roc" class="dividend-sub-label">RoC / sh</label>
          <input id="df-ps-roc" type="number" step="0.0001" class="form-input" placeholder="0.0000"
            value="${isEdit && record.perShareRoc ? record.perShareRoc : ""}">
        </div>
        <div class="form-group">
          <label for="df-ps-income" class="dividend-sub-label">Income / sh</label>
          <input id="df-ps-income" type="number" step="0.0001" class="form-input" placeholder="0.0000"
            value="${isEdit && record.perShareIncome ? record.perShareIncome : ""}">
        </div>
      </div>
      <span class="field-hint" id="df-breakdown-hint">Leave blank if not distributing. RoC + Income must equal Total.</span>
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
  const psTotalInput  = el.querySelector("#df-ps-total");
  const psRocInput    = el.querySelector("#df-ps-roc");
  const psIncomeInput = el.querySelector("#df-ps-income");

  const fmtCur = (n) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

  // Live hint: validate RoC + Income = Total (per share) and preview the
  // dollar distribution of the entered Amount.
  const hintEl = el.querySelector("#df-breakdown-hint");
  function updateBreakdownHint() {
    const total  = parseFloat(psTotalInput.value)  || 0;
    const roc    = parseFloat(psRocInput.value)    || 0;
    const income = parseFloat(psIncomeInput.value) || 0;

    if (total === 0 && roc === 0 && income === 0) {
      hintEl.textContent = "Leave blank if not distributing. RoC + Income must equal Total.";
      hintEl.classList.remove("field-hint-warn");
      return;
    }
    if (Math.abs((roc + income) - total) > 0.00005) {
      hintEl.textContent = `RoC + Income (${(roc + income).toFixed(4)}/sh) must equal Total (${total.toFixed(4)}/sh).`;
      hintEl.classList.add("field-hint-warn");
      return;
    }
    // Valid split — preview the dollar distribution of the Amount
    const amount = parseFloat(amountInput.value) || 0;
    if (total > 0 && amount) {
      const shares = amount / total;
      hintEl.textContent = `≈ ${fmtCur(shares * roc)} RoC + ${fmtCur(shares * income)} Income`;
    } else {
      hintEl.textContent = "RoC + Income = Total ✓";
    }
    hintEl.classList.remove("field-hint-warn");
  }
  [amountInput, psTotalInput, psRocInput, psIncomeInput].forEach((inp) =>
    inp.addEventListener("input", updateBreakdownHint)
  );

  el.querySelector("#df-cancel").addEventListener("click", () => Modal.close());

  el.querySelector("#df-submit").addEventListener("click", () => {
    const accountId   = accountSel.value;
    const date        = dateInput.value.trim();
    const symbol      = symbolInput.value.trim();
    const description = descInput.value.trim();
    const amountRaw   = amountInput.value.trim();

    const psTotal  = parseFloat(psTotalInput.value)  || 0;
    const psRoc    = parseFloat(psRocInput.value)    || 0;
    const psIncome = parseFloat(psIncomeInput.value) || 0;

    let valid = true;
    el.querySelector("#df-account-err").textContent = "";
    el.querySelector("#df-date-err").textContent = "";
    el.querySelector("#df-amount-err").textContent = "";
    el.querySelector("#df-breakdown-err").textContent = "";

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
    // Distribution is optional, but if any field is filled, RoC + Income must equal Total
    if ((psTotal !== 0 || psRoc !== 0 || psIncome !== 0) &&
        Math.abs((psRoc + psIncome) - psTotal) > 0.00005) {
      el.querySelector("#df-breakdown-err").textContent =
        "RoC + Income must equal Total (per share).";
      valid = false;
    }
    if (!valid) return;

    const data = {
      accountId,
      date,
      description,
      symbol,
      amount:         parseFloat(amountRaw),
      perShareTotal:  psTotal,
      perShareRoc:    psRoc,
      perShareIncome: psIncome,
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
