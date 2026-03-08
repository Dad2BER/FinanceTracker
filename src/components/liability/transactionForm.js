import { Modal } from "../ui/modal.js";
import { addTransaction, updateTransaction, addPayee } from "../../state.js";

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

export function showTransactionForm(accountId, categories, payees, transaction = null) {
  const isEdit = transaction !== null;

  const el = document.createElement("div");
  el.className = "transaction-form";

  // Build payee datalist options
  const payeeOptions = payees
    .map((p) => `<option value="${escHtml(p.name)}">`)
    .join("");

  el.innerHTML = `
    <h3>${isEdit ? "Edit Transaction" : "Add Transaction"}</h3>

    <div class="form-group">
      <label for="tf-date">Date</label>
      <input id="tf-date" type="date" class="form-input" value="${isEdit ? escHtml(transaction.date) : todayIso()}">
      <span class="field-error" id="tf-date-err"></span>
    </div>

    <div class="form-group">
      <label for="tf-payee">Payee</label>
      <input id="tf-payee" type="text" class="form-input" list="tf-payee-list"
        placeholder="Enter or select a payee" autocomplete="off"
        value="${isEdit ? escHtml(transaction.payeeName) : ""}">
      <datalist id="tf-payee-list">${payeeOptions}</datalist>
      <span class="field-error" id="tf-payee-err"></span>
    </div>

    <div id="tf-cat-section">
      <!-- populated dynamically -->
    </div>

    <div class="form-group">
      <label for="tf-tag">Tag <span style="font-weight:400;text-transform:none;letter-spacing:0">(optional)</span></label>
      <input id="tf-tag" type="text" class="form-input" placeholder="e.g. Business, Vacation"
        value="${isEdit ? escHtml(transaction.tag || "") : ""}">
    </div>

    <div class="form-group">
      <label for="tf-amount">Amount</label>
      <input id="tf-amount" type="number" step="0.01" class="form-input"
        placeholder="e.g. 45.00 or -45.00"
        value="${isEdit ? transaction.amount : ""}">
      <span class="field-hint">Positive = charge / purchase &nbsp;·&nbsp; Negative = payment / credit</span>
      <span class="field-error" id="tf-amount-err"></span>
    </div>

    <div class="form-actions">
      <button class="btn btn-secondary" id="tf-cancel">Cancel</button>
      <button class="btn btn-primary" id="tf-submit">${isEdit ? "Save" : "Add"}</button>
    </div>
  `;

  // ── Category/Subcategory section ──────────────────────────────────────────
  const catSection = el.querySelector("#tf-cat-section");
  const payeeInput = el.querySelector("#tf-payee");

  // State for the category section
  let resolvedSubcategoryId = isEdit ? (transaction.subcategoryId || null) : null;
  let isKnownPayee = false;

  function buildCategoryOptions(selectedCatId = null) {
    return categories
      .map((c) => `<option value="${escHtml(c.id)}" ${c.id === selectedCatId ? "selected" : ""}>${escHtml(c.name)}</option>`)
      .join("");
  }

  function buildSubcategoryOptions(categoryId, selectedSubId = null) {
    const cat = categories.find((c) => c.id === categoryId);
    if (!cat) return "";
    return cat.subcategories
      .map((s) => `<option value="${escHtml(s.id)}" ${s.id === selectedSubId ? "selected" : ""}>${escHtml(s.name)}</option>`)
      .join("");
  }

  function renderKnownPayeeSection(payee) {
    isKnownPayee = true;
    resolvedSubcategoryId = payee.subcategoryId || null;
    // Find category name
    let catName = "—";
    let subName = "—";
    if (payee.subcategoryId) {
      for (const cat of categories) {
        const sub = cat.subcategories.find((s) => s.id === payee.subcategoryId);
        if (sub) { catName = cat.name; subName = sub.name; break; }
      }
    }
    catSection.innerHTML = `
      <div class="form-group">
        <label>Category</label>
        <div class="form-display-value">${escHtml(catName)}</div>
      </div>
      <div class="form-group">
        <label>Subcategory</label>
        <div class="form-display-value">${escHtml(subName)}</div>
      </div>
    `;
  }

  function renderUnknownPayeeSection(initialCatId = null, initialSubId = null) {
    isKnownPayee = false;
    resolvedSubcategoryId = initialSubId;

    catSection.innerHTML = `
      <div class="form-group">
        <label for="tf-cat">Category <span style="font-weight:400;text-transform:none;letter-spacing:0">(new payee)</span></label>
        <select id="tf-cat" class="form-select">
          <option value="">— Select category —</option>
          ${buildCategoryOptions(initialCatId)}
        </select>
      </div>
      <div class="form-group" id="tf-sub-group" ${!initialCatId ? 'style="display:none"' : ""}>
        <label for="tf-sub">Subcategory</label>
        <select id="tf-sub" class="form-select">
          <option value="">— Select subcategory —</option>
          ${initialCatId ? buildSubcategoryOptions(initialCatId, initialSubId) : ""}
        </select>
      </div>
    `;

    const catSel = catSection.querySelector("#tf-cat");
    const subGroup = catSection.querySelector("#tf-sub-group");

    catSel.addEventListener("change", () => {
      const catId = catSel.value;
      if (catId) {
        subGroup.style.display = "";
        const subSel = catSection.querySelector("#tf-sub");
        subSel.innerHTML = `<option value="">— Select subcategory —</option>${buildSubcategoryOptions(catId)}`;
        resolvedSubcategoryId = null;
        subSel.addEventListener("change", () => {
          resolvedSubcategoryId = subSel.value || null;
        });
      } else {
        subGroup.style.display = "none";
        resolvedSubcategoryId = null;
      }
    });

    // Restore initial sub selection listener
    if (initialCatId) {
      const subSel = catSection.querySelector("#tf-sub");
      if (subSel) {
        subSel.addEventListener("change", () => {
          resolvedSubcategoryId = subSel.value || null;
        });
      }
    }
  }

  // Initialize the category section
  function initCategorySection() {
    if (isEdit && transaction.payeeName) {
      const match = payees.find(
        (p) => p.name.toLowerCase() === transaction.payeeName.toLowerCase()
      );
      if (match) {
        renderKnownPayeeSection(match);
        return;
      }
      // Edit but payee no longer in list — show selects with current values
      let initCatId = null;
      if (transaction.subcategoryId) {
        for (const cat of categories) {
          if (cat.subcategories.some((s) => s.id === transaction.subcategoryId)) {
            initCatId = cat.id;
            break;
          }
        }
      }
      renderUnknownPayeeSection(initCatId, transaction.subcategoryId || null);
    } else {
      renderUnknownPayeeSection();
    }
  }

  initCategorySection();

  // React to payee input changes
  payeeInput.addEventListener("input", () => {
    const name = payeeInput.value.trim().toLowerCase();
    const match = payees.find((p) => p.name.toLowerCase() === name);
    if (match) {
      renderKnownPayeeSection(match);
    } else {
      renderUnknownPayeeSection();
    }
  });

  // ── Actions ───────────────────────────────────────────────────────────────
  el.querySelector("#tf-cancel").addEventListener("click", () => Modal.close());

  el.querySelector("#tf-submit").addEventListener("click", () => {
    const date = el.querySelector("#tf-date").value.trim();
    const payeeName = payeeInput.value.trim();
    const tag = el.querySelector("#tf-tag").value.trim();
    const amountRaw = el.querySelector("#tf-amount").value.trim();

    // Validation
    let valid = true;
    el.querySelector("#tf-date-err").textContent = "";
    el.querySelector("#tf-payee-err").textContent = "";
    el.querySelector("#tf-amount-err").textContent = "";

    if (!date) {
      el.querySelector("#tf-date-err").textContent = "Date is required.";
      valid = false;
    }
    if (!payeeName) {
      el.querySelector("#tf-payee-err").textContent = "Payee is required.";
      valid = false;
    }
    if (!amountRaw || isNaN(parseFloat(amountRaw))) {
      el.querySelector("#tf-amount-err").textContent = "A valid amount is required.";
      valid = false;
    }
    if (!valid) return;

    const amount = parseFloat(amountRaw);

    // If unknown payee and category/subcategory was selected → register payee
    if (!isKnownPayee && resolvedSubcategoryId) {
      const alreadyExists = payees.some(
        (p) => p.name.toLowerCase() === payeeName.toLowerCase()
      );
      if (!alreadyExists) {
        addPayee(payeeName, resolvedSubcategoryId);
      }
    }

    const txData = { date, payeeName, subcategoryId: resolvedSubcategoryId, tag, amount };

    if (isEdit) {
      updateTransaction(accountId, transaction.id, txData);
    } else {
      addTransaction(accountId, txData);
    }

    Modal.close();
  });

  Modal.open(el, null, { wide: true });
  setTimeout(() => el.querySelector("#tf-date").focus(), 50);
}
