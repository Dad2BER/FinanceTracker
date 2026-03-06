import { Modal } from "../ui/modal.js";
import { addAccount, updateAccount } from "../../state.js";

const TAX_TYPES = ["Taxable", "Tax-Free", "Tax-Deferred"];

export function showAccountForm(account = null) {
  const isEdit = account !== null;
  const el = document.createElement("div");
  el.className = "account-form";
  el.innerHTML = `
    <h3>${isEdit ? "Edit Account" : "Add Account"}</h3>
    <div class="form-group">
      <label for="af-name">Account Name</label>
      <input id="af-name" type="text" class="form-input" placeholder="e.g. Roth IRA" maxlength="100"
        value="${isEdit ? escHtml(account.name) : ""}">
      <span class="field-error" id="af-name-err"></span>
    </div>
    <div class="form-group">
      <label for="af-tax">Tax Type</label>
      <select id="af-tax" class="form-select">
        ${TAX_TYPES.map(
          (t) =>
            `<option value="${t}" ${isEdit && account.taxType === t ? "selected" : ""}>${t}</option>`
        ).join("")}
      </select>
    </div>
    <div class="form-actions">
      <button class="btn btn-secondary" id="af-cancel">Cancel</button>
      <button class="btn btn-primary" id="af-submit">${isEdit ? "Save" : "Add"}</button>
    </div>
  `;

  const nameInput = el.querySelector("#af-name");
  const taxSelect = el.querySelector("#af-tax");
  const nameErr = el.querySelector("#af-name-err");

  el.querySelector("#af-cancel").addEventListener("click", () => Modal.close());

  el.querySelector("#af-submit").addEventListener("click", () => {
    const name = nameInput.value.trim();
    if (!name) {
      nameErr.textContent = "Name is required.";
      nameInput.focus();
      return;
    }
    nameErr.textContent = "";
    const taxType = taxSelect.value;
    if (isEdit) {
      updateAccount(account.id, name, taxType);
    } else {
      addAccount(name, taxType);
    }
    Modal.close();
  });

  // Submit on Enter
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") el.querySelector("#af-submit").click();
  });

  Modal.open(el, () => {});
  setTimeout(() => nameInput.focus(), 50);
}

function escHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
