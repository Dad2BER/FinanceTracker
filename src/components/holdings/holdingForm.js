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
        <option value="domestic"      ${isEdit && holding.origin === "domestic"      ? "selected" : ""}>Domestic</option>
        <option value="international" ${isEdit && holding.origin === "international" ? "selected" : ""}>International</option>
      </select>
    </div>
    <div class="form-group">
      <label for="hf-asset-class">Asset Class</label>
      <select id="hf-asset-class" class="form-input">
        <option value="">—</option>
        <option value="equity"       ${isEdit && holding.assetType === "equity"       ? "selected" : ""}>Equity</option>
        <option value="bonds"        ${isEdit && holding.assetType === "bonds"        ? "selected" : ""}>Bonds</option>
        <option value="real-estate"  ${isEdit && holding.assetType === "real-estate"  ? "selected" : ""}>Real Estate</option>
        <option value="crypto"       ${isEdit && holding.assetType === "crypto"       ? "selected" : ""}>Crypto</option>
        <option value="cash"         ${isEdit && holding.assetType === "cash"         ? "selected" : ""}>Cash</option>
      </select>
    </div>
    <div class="form-group" id="hf-instrument-group">
      <label for="hf-instrument">Instrument</label>
      <select id="hf-instrument" class="form-input">
        <option value="">—</option>
        <option value="etf"   ${isEdit && holding.instrumentType === "etf"   ? "selected" : ""}>ETF</option>
        <option value="fund"  ${isEdit && holding.instrumentType === "fund"  ? "selected" : ""}>Fund</option>
        <option value="stock" ${isEdit && holding.instrumentType === "stock" ? "selected" : ""}>Stock</option>
        <option value="cash"         ${isEdit && holding.instrumentType === "cash"         ? "selected" : ""}>Cash</option>
        <option value="money-market" ${isEdit && holding.instrumentType === "money-market" ? "selected" : ""}>Money Market</option>
      </select>
    </div>
    <div class="form-group" id="hf-dividend-group">
      <label for="hf-dividend">Annual Dividend ($/share)</label>
      <input id="hf-dividend" type="number" class="form-input" placeholder="e.g. 2.88" min="0" step="0.0001"
        value="${isEdit && holding.dividendPerShare != null ? holding.dividendPerShare : ""}">
    </div>
    <div class="form-group" id="hf-drip-group">
      <label class="checkbox-label">
        <input id="hf-drip" type="checkbox" ${isEdit && holding.dividendReinvested ? "checked" : ""}>
        Dividends reinvested (DRIP)
      </label>
    </div>
    <div class="form-actions">
      <button class="btn btn-secondary" id="hf-cancel">Cancel</button>
      <button class="btn btn-primary" id="hf-submit">${isEdit ? "Save" : "Add"}</button>
    </div>
  `;

  const symbolInput      = el.querySelector("#hf-symbol");
  const sharesInput      = el.querySelector("#hf-shares");
  const originSelect     = el.querySelector("#hf-origin");
  const assetClassSelect = el.querySelector("#hf-asset-class");
  const instrumentSelect = el.querySelector("#hf-instrument");
  const instrumentGroup  = el.querySelector("#hf-instrument-group");
  const dividendInput    = el.querySelector("#hf-dividend");
  const dividendGroup    = el.querySelector("#hf-dividend-group");
  const dripCheckbox     = el.querySelector("#hf-drip");
  const dripGroup        = el.querySelector("#hf-drip-group");
  const symbolErr        = el.querySelector("#hf-symbol-err");
  const sharesErr        = el.querySelector("#hf-shares-err");
  const symbolLabel      = el.querySelector("label[for='hf-symbol']");
  const sharesLabel      = el.querySelector("label[for='hf-shares']");

  function updateCashLabels() {
    const isCash = assetClassSelect.value === "cash";
    symbolLabel.textContent   = isCash ? "Label"      : "Ticker Symbol";
    symbolInput.placeholder   = isCash ? "e.g. Savings" : "e.g. AAPL";
    sharesLabel.textContent   = isCash ? "Amount ($)" : "Shares";
    sharesInput.placeholder   = isCash ? "e.g. 5000"  : "e.g. 10.5";
    dividendGroup.style.display = "";
    dripGroup.style.display     = "";

    const CASH_INSTRUMENTS = new Set(["cash", "money-market"]);
    if (isCash) {
      // Reset to "cash" only if a non-cash instrument (ETF/Fund/Stock) is selected
      if (!CASH_INSTRUMENTS.has(instrumentSelect.value)) instrumentSelect.value = "cash";
      instrumentSelect.disabled = false; // allow Cash or Money Market
    } else {
      instrumentSelect.disabled = false;
      // Clear cash-specific instruments when switching away to a non-cash asset class
      if (CASH_INSTRUMENTS.has(instrumentSelect.value)) instrumentSelect.value = "";
    }
  }

  assetClassSelect.addEventListener("change", updateCashLabels);
  updateCashLabels();

  el.querySelector("#hf-cancel").addEventListener("click", () => Modal.close());

  el.querySelector("#hf-submit").addEventListener("click", () => {
    const symbol   = symbolInput.value.trim().toUpperCase();
    const sharesRaw = sharesInput.value.trim();
    const shares   = parseFloat(sharesRaw);
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

    const origin         = originSelect.value     || undefined;
    const assetType      = assetClassSelect.value || undefined;
    const instrumentType = instrumentSelect.value || undefined;
    const dividendRaw    = dividendInput.value.trim();
    const dividendPerShare = dividendRaw !== "" ? parseFloat(dividendRaw) : undefined;
    const dividendReinvested = dripCheckbox.checked;

    if (isEdit) {
      updateHolding(accountId, holding.id, symbol, shares, origin, assetType, instrumentType, dividendPerShare, dividendReinvested);
    } else {
      addHolding(accountId, symbol, shares, origin, assetType, instrumentType, dividendPerShare, dividendReinvested);
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
