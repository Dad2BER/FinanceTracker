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
 *
 * Return-of-capital / income split is no longer entered here — it's derived
 * automatically from the Symbol + year against Settings > Return of Capital.
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
      amount: parseFloat(amountRaw),
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
