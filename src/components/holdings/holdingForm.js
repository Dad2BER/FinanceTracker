import { Modal } from "../ui/modal.js";
import { addHolding, updateHolding } from "../../state.js";

export function showHoldingForm(accountId, holding = null) {
  const isEdit = holding !== null;
  const el = document.createElement("div");
  el.className = "holding-form";
  el.innerHTML = `
    <h3>${isEdit ? "Edit Holding" : "Add Holding"}</h3>
    <div class="form-group">
      <label for="hf-symbol">Ticker Symbol</label>
      <input id="hf-symbol" type="text" class="form-input" placeholder="e.g. AAPL" maxlength="10"
        value="${isEdit ? escHtml(holding.symbol) : ""}">
      <span class="field-error" id="hf-symbol-err"></span>
    </div>
    <div class="form-group">
      <label for="hf-shares">Shares</label>
      <input id="hf-shares" type="number" class="form-input" placeholder="e.g. 10.5" min="0.000001" step="any"
        value="${isEdit ? holding.shares : ""}">
      <span class="field-error" id="hf-shares-err"></span>
    </div>
    <div class="form-group">
      <label for="hf-origin">Origin</label>
      <select id="hf-origin" class="form-input">
        <option value="">—</option>
        <option value="domestic" ${isEdit && holding.origin === "domestic" ? "selected" : ""}>Domestic</option>
        <option value="international" ${isEdit && holding.origin === "international" ? "selected" : ""}>International</option>
      </select>
    </div>
    <div class="form-group">
      <label for="hf-type">Asset Type</label>
      <select id="hf-type" class="form-input">
        <option value="">—</option>
        <option value="stock-fund" ${isEdit && holding.assetType === "stock-fund" ? "selected" : ""}>Stock Fund</option>
        <option value="real-estate" ${isEdit && holding.assetType === "real-estate" ? "selected" : ""}>Real-estate</option>
        <option value="company" ${isEdit && holding.assetType === "company" ? "selected" : ""}>Company</option>
        <option value="crypto" ${isEdit && holding.assetType === "crypto" ? "selected" : ""}>Crypto</option>
        <option value="bonds" ${isEdit && holding.assetType === "bonds" ? "selected" : ""}>Bonds</option>
        <option value="cash" ${isEdit && holding.assetType === "cash" ? "selected" : ""}>Cash</option>
      </select>
    </div>
    <div class="form-actions">
      <button class="btn btn-secondary" id="hf-cancel">Cancel</button>
      <button class="btn btn-primary" id="hf-submit">${isEdit ? "Save" : "Add"}</button>
    </div>
  `;

  const symbolInput = el.querySelector("#hf-symbol");
  const sharesInput = el.querySelector("#hf-shares");
  const originSelect = el.querySelector("#hf-origin");
  const typeSelect = el.querySelector("#hf-type");
  const symbolErr = el.querySelector("#hf-symbol-err");
  const sharesErr = el.querySelector("#hf-shares-err");

  el.querySelector("#hf-cancel").addEventListener("click", () => Modal.close());

  el.querySelector("#hf-submit").addEventListener("click", () => {
    const symbol = symbolInput.value.trim().toUpperCase();
    const sharesRaw = sharesInput.value.trim();
    const shares = parseFloat(sharesRaw);
    let valid = true;

    if (!symbol) {
      symbolErr.textContent = "Symbol is required.";
      valid = false;
    } else {
      symbolErr.textContent = "";
    }

    if (!sharesRaw || isNaN(shares) || shares <= 0) {
      sharesErr.textContent = "Enter a positive number of shares.";
      valid = false;
    } else {
      sharesErr.textContent = "";
    }

    if (!valid) return;

    const origin = originSelect.value || undefined;
    const assetType = typeSelect.value || undefined;

    if (isEdit) {
      updateHolding(accountId, holding.id, symbol, shares, origin, assetType);
    } else {
      addHolding(accountId, symbol, shares, origin, assetType);
    }
    Modal.close();
  });

  Modal.open(el);
  setTimeout(() => symbolInput.focus(), 50);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
