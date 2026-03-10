import { Modal } from "./modal.js";
import { saveManualPrice } from "../../services/prices.js";

/**
 * Shows a modal prompting the user to enter prices for symbols that
 * could not be fetched from any API and have no cache, or whose cache
 * is more than 24 hours old.
 *
 * @param {Array<{symbol: string, cachedPrice: number|null, cachedAt: number|null}>} items
 * @param {function(Object): void} onSave - called with { symbol: price, ... } for entered values
 */
export function showManualPriceModal(items, onSave) {
  const el = document.createElement("div");

  el.innerHTML = `
    <h3>Manual Price Entry</h3>
    <p class="manual-price-intro">
      The following symbol${items.length > 1 ? "s" : ""} could not be fetched from any
      price source${items.some(i => i.cachedPrice) ? " or the cached price is more than 24 hours old" : ""}.
      Enter current values to keep your portfolio accurate.
    </p>
    <div class="manual-price-list"></div>
    <div class="form-actions">
      <button class="btn btn-secondary" id="mp-skip">Skip</button>
      <button class="btn btn-primary" id="mp-save">Save</button>
    </div>
  `;

  const listEl = el.querySelector(".manual-price-list");

  items.forEach(({ symbol, cachedPrice, cachedAt }) => {
    const row = document.createElement("div");
    row.className = "manual-price-row";

    let hint = "No previous price on record";
    if (cachedPrice !== null) {
      const age = timeSince(cachedAt);
      hint = `Last known: $${cachedPrice.toFixed(2)} &nbsp;·&nbsp; ${age} ago`;
    }

    row.innerHTML = `
      <div class="manual-price-meta">
        <span class="manual-price-symbol">${symbol}</span>
        <span class="manual-price-hint">${hint}</span>
      </div>
      <div class="manual-price-input-wrap">
        <span class="manual-price-prefix">$</span>
        <input
          type="number" min="0" step="0.01"
          class="form-input manual-price-input"
          data-symbol="${symbol}"
          placeholder="${cachedPrice !== null ? cachedPrice.toFixed(2) : "0.00"}"
        >
      </div>
    `;
    listEl.appendChild(row);
  });

  el.querySelector("#mp-skip").addEventListener("click", () => Modal.close());

  el.querySelector("#mp-save").addEventListener("click", () => {
    const entered = {};
    el.querySelectorAll(".manual-price-input").forEach((input) => {
      const val = parseFloat(input.value);
      if (val > 0) {
        const sym = input.dataset.symbol;
        saveManualPrice(sym, val);
        entered[sym] = val;
      }
    });
    Modal.close();
    if (Object.keys(entered).length > 0) onSave(entered);
  });

  // Allow Enter key to save from any input
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") el.querySelector("#mp-save").click();
  });

  Modal.open(el, null, { wide: true });

  setTimeout(() => {
    const first = el.querySelector(".manual-price-input");
    if (first) first.focus();
  }, 50);
}

function timeSince(timestamp) {
  if (!timestamp) return "unknown time";
  const ms = Date.now() - timestamp;
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor(ms / 3_600_000);
  const mins = Math.floor(ms / 60_000);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${mins % 60}m`;
  return `${mins}m`;
}
