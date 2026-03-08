import { Modal } from "../ui/modal.js";
import { showConfirmDialog } from "../ui/confirmDialog.js";
import {
  addCategory, updateCategory, deleteCategory,
  addSubcategory, updateSubcategory, deleteSubcategory,
  addPayee, updatePayee, deletePayee,
} from "../../state.js";

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Small helpers to open a prompt modal ─────────────────────────────────────

function showNamePrompt({ title, label, initialValue = "", onSave }) {
  const el = document.createElement("div");
  el.innerHTML = `
    <h3>${escHtml(title)}</h3>
    <div class="form-group">
      <label for="np-name">${escHtml(label)}</label>
      <input id="np-name" type="text" class="form-input" value="${escHtml(initialValue)}" maxlength="100">
      <span class="field-error" id="np-err"></span>
    </div>
    <div class="form-actions">
      <button class="btn btn-secondary" id="np-cancel">Cancel</button>
      <button class="btn btn-primary" id="np-save">Save</button>
    </div>
  `;
  const input = el.querySelector("#np-name");
  el.querySelector("#np-cancel").addEventListener("click", () => Modal.close());
  el.querySelector("#np-save").addEventListener("click", () => {
    const val = input.value.trim();
    if (!val) { el.querySelector("#np-err").textContent = "Name is required."; return; }
    Modal.close();
    onSave(val);
  });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") el.querySelector("#np-save").click(); });
  Modal.open(el);
  setTimeout(() => input.focus(), 50);
}

function showPayeeEditPrompt({ initialName = "", initialSubcategoryId = null, categories, onSave }) {
  const el = document.createElement("div");

  function buildCatOptions(selCatId) {
    return categories
      .map((c) => `<option value="${escHtml(c.id)}" ${c.id === selCatId ? "selected" : ""}>${escHtml(c.name)}</option>`)
      .join("");
  }
  function buildSubOptions(catId, selSubId) {
    const cat = categories.find((c) => c.id === catId);
    if (!cat) return "";
    return cat.subcategories
      .map((s) => `<option value="${escHtml(s.id)}" ${s.id === selSubId ? "selected" : ""}>${escHtml(s.name)}</option>`)
      .join("");
  }

  // Resolve initial category from subcategoryId
  let initCatId = null;
  if (initialSubcategoryId) {
    for (const cat of categories) {
      if (cat.subcategories.some((s) => s.id === initialSubcategoryId)) {
        initCatId = cat.id;
        break;
      }
    }
  }

  el.innerHTML = `
    <h3>Edit Payee</h3>
    <div class="form-group">
      <label for="pe-name">Payee Name</label>
      <input id="pe-name" type="text" class="form-input" value="${escHtml(initialName)}" maxlength="100">
      <span class="field-error" id="pe-err"></span>
    </div>
    <div class="form-group">
      <label for="pe-cat">Category</label>
      <select id="pe-cat" class="form-select">
        <option value="">— None —</option>
        ${buildCatOptions(initCatId)}
      </select>
    </div>
    <div class="form-group" id="pe-sub-group" ${!initCatId ? 'style="display:none"' : ""}>
      <label for="pe-sub">Subcategory</label>
      <select id="pe-sub" class="form-select">
        <option value="">— None —</option>
        ${initCatId ? buildSubOptions(initCatId, initialSubcategoryId) : ""}
      </select>
    </div>
    <div class="form-actions">
      <button class="btn btn-secondary" id="pe-cancel">Cancel</button>
      <button class="btn btn-primary" id="pe-save">Save</button>
    </div>
  `;

  const catSel = el.querySelector("#pe-cat");
  const subGroup = el.querySelector("#pe-sub-group");
  let selectedSubId = initialSubcategoryId;

  catSel.addEventListener("change", () => {
    const catId = catSel.value;
    if (catId) {
      subGroup.style.display = "";
      const subSel = el.querySelector("#pe-sub");
      subSel.innerHTML = `<option value="">— None —</option>${buildSubOptions(catId, null)}`;
      selectedSubId = null;
    } else {
      subGroup.style.display = "none";
      selectedSubId = null;
    }
  });

  const subSel = el.querySelector("#pe-sub");
  if (subSel) {
    subSel.addEventListener("change", () => {
      selectedSubId = subSel.value || null;
    });
  }

  el.querySelector("#pe-cancel").addEventListener("click", () => Modal.close());
  el.querySelector("#pe-save").addEventListener("click", () => {
    const name = el.querySelector("#pe-name").value.trim();
    if (!name) { el.querySelector("#pe-err").textContent = "Name is required."; return; }
    // Read current subSel value (it may have changed)
    const currentSubSel = el.querySelector("#pe-sub");
    const finalSubId = currentSubSel ? currentSubSel.value || null : null;
    Modal.close();
    onSave(name, finalSubId);
  });

  Modal.open(el, null, { wide: false });
  setTimeout(() => el.querySelector("#pe-name").focus(), 50);
}

// ── Main View ─────────────────────────────────────────────────────────────────

export function renderSettingsView(container, categories, payees, onBack) {
  container.innerHTML = "";

  // ── Header ──────────────────────────────────────────────────────────────────
  const header = document.createElement("div");
  header.className = "view-header";
  header.innerHTML = `
    <div class="back-row">
      <button class="btn btn-ghost btn-sm" id="back-btn">&#8592; Back</button>
    </div>
    <div class="detail-title-row">
      <h1>Settings</h1>
    </div>
  `;
  container.appendChild(header);
  header.querySelector("#back-btn").addEventListener("click", onBack);

  // ── Section A: Categories & Subcategories ───────────────────────────────────
  renderCategorySection(container, categories);

  // ── Section B: Payees ───────────────────────────────────────────────────────
  renderPayeeSection(container, categories, payees);
}

// ── Category Section ──────────────────────────────────────────────────────────

function renderCategorySection(container, categories) {
  const section = document.createElement("div");
  section.className = "settings-section";

  const sectionHeader = document.createElement("div");
  sectionHeader.className = "settings-section-header";
  sectionHeader.innerHTML = `
    <h3 class="section-title" style="margin-bottom:0">Categories &amp; Subcategories</h3>
    <button class="btn btn-primary btn-sm" id="add-cat-btn">+ Add Category</button>
  `;
  section.appendChild(sectionHeader);

  sectionHeader.querySelector("#add-cat-btn").addEventListener("click", () => {
    showNamePrompt({
      title: "Add Category",
      label: "Category Name",
      onSave: (name) => addCategory(name),
    });
  });

  if (categories.length === 0) {
    const empty = document.createElement("p");
    empty.className = "dim";
    empty.style.fontSize = "0.88rem";
    empty.style.padding = "0.75rem 0";
    empty.textContent = "No categories yet. Add one to get started.";
    section.appendChild(empty);
    container.appendChild(section);
    return;
  }

  const tableWrapper = document.createElement("div");
  tableWrapper.className = "table-wrapper";
  tableWrapper.innerHTML = `
    <table class="holdings-table">
      <thead>
        <tr>
          <th>Name</th>
          <th class="actions-cell"></th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  `;

  const tbody = tableWrapper.querySelector("tbody");

  categories.forEach((cat) => {
    // Category row
    const catRow = document.createElement("tr");
    catRow.innerHTML = `
      <td><strong>${escHtml(cat.name)}</strong></td>
      <td class="actions-cell">
        <button class="icon-btn" title="Rename">&#9998;</button>
        <button class="icon-btn icon-btn-danger" title="Delete">&#128465;</button>
      </td>
    `;
    const [renameBtn, deleteBtn] = catRow.querySelectorAll("button");
    renameBtn.addEventListener("click", () => {
      showNamePrompt({
        title: "Rename Category",
        label: "Category Name",
        initialValue: cat.name,
        onSave: (name) => updateCategory(cat.id, name),
      });
    });
    deleteBtn.addEventListener("click", () => {
      showConfirmDialog({
        title: "Delete Category",
        message: `Delete "${cat.name}" and all its subcategories? Payees using these subcategories will lose their mapping.`,
        onConfirm: () => deleteCategory(cat.id),
      });
    });
    tbody.appendChild(catRow);

    // Subcategory rows
    cat.subcategories.forEach((sub) => {
      const subRow = document.createElement("tr");
      subRow.className = "settings-subrow";
      subRow.innerHTML = `
        <td>${escHtml(sub.name)}</td>
        <td class="actions-cell">
          <button class="icon-btn" title="Rename">&#9998;</button>
          <button class="icon-btn icon-btn-danger" title="Delete">&#128465;</button>
        </td>
      `;
      const [renSub, delSub] = subRow.querySelectorAll("button");
      renSub.addEventListener("click", () => {
        showNamePrompt({
          title: "Rename Subcategory",
          label: "Subcategory Name",
          initialValue: sub.name,
          onSave: (name) => updateSubcategory(cat.id, sub.id, name),
        });
      });
      delSub.addEventListener("click", () => {
        showConfirmDialog({
          title: "Delete Subcategory",
          message: `Delete subcategory "${sub.name}"? Payees using this subcategory will lose their mapping.`,
          onConfirm: () => deleteSubcategory(cat.id, sub.id),
        });
      });
      tbody.appendChild(subRow);
    });

    // Inline add subcategory row
    const addSubRow = document.createElement("tr");
    addSubRow.innerHTML = `
      <td colspan="2" style="padding: 0.4rem 1rem;">
        <div style="display:flex;gap:0.5rem;align-items:center;padding-left:1.5rem">
          <input type="text" class="inline-add-input" placeholder="+ Add subcategory…" maxlength="100">
          <button class="btn btn-secondary btn-sm" style="white-space:nowrap">Add</button>
        </div>
      </td>
    `;
    const subInput = addSubRow.querySelector("input");
    const subAddBtn = addSubRow.querySelector("button");
    function submitSubcategory() {
      const name = subInput.value.trim();
      if (!name) return;
      addSubcategory(cat.id, name);
      subInput.value = "";
    }
    subAddBtn.addEventListener("click", submitSubcategory);
    subInput.addEventListener("keydown", (e) => { if (e.key === "Enter") submitSubcategory(); });
    tbody.appendChild(addSubRow);
  });

  tableWrapper.appendChild(tableWrapper.querySelector("tbody")); // no-op, already appended
  section.appendChild(tableWrapper);
  container.appendChild(section);
}

// ── Payee Section ─────────────────────────────────────────────────────────────

function renderPayeeSection(container, categories, payees) {
  const section = document.createElement("div");
  section.className = "settings-section";

  const sectionHeader = document.createElement("div");
  sectionHeader.className = "settings-section-header";
  sectionHeader.innerHTML = `
    <h3 class="section-title" style="margin-bottom:0">Payees</h3>
  `;
  section.appendChild(sectionHeader);

  if (payees.length === 0) {
    const empty = document.createElement("p");
    empty.className = "dim";
    empty.style.fontSize = "0.88rem";
    empty.style.padding = "0.75rem 0";
    empty.textContent = "No payees yet. They are added automatically when you record transactions.";
    section.appendChild(empty);
    container.appendChild(section);
    return;
  }

  const tableWrapper = document.createElement("div");
  tableWrapper.className = "table-wrapper";
  tableWrapper.innerHTML = `
    <table class="holdings-table">
      <thead>
        <tr>
          <th>Payee</th>
          <th>Category</th>
          <th>Subcategory</th>
          <th class="actions-cell"></th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  `;

  const tbody = tableWrapper.querySelector("tbody");

  payees.forEach((payee) => {
    let catName = "—";
    let subName = "—";
    if (payee.subcategoryId) {
      for (const cat of categories) {
        const sub = cat.subcategories.find((s) => s.id === payee.subcategoryId);
        if (sub) { catName = cat.name; subName = sub.name; break; }
      }
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="symbol-cell">${escHtml(payee.name)}</td>
      <td class="dim">${escHtml(catName)}</td>
      <td class="dim">${escHtml(subName)}</td>
      <td class="actions-cell">
        <button class="icon-btn" title="Edit">&#9998;</button>
        <button class="icon-btn icon-btn-danger" title="Delete">&#128465;</button>
      </td>
    `;

    const [editBtn, deleteBtn] = tr.querySelectorAll("button");

    editBtn.addEventListener("click", () => {
      showPayeeEditPrompt({
        initialName: payee.name,
        initialSubcategoryId: payee.subcategoryId || null,
        categories,
        onSave: (name, subcategoryId) => updatePayee(payee.id, name, subcategoryId),
      });
    });

    deleteBtn.addEventListener("click", () => {
      showConfirmDialog({
        title: "Delete Payee",
        message: `Delete payee "${payee.name}"? This will not affect existing transactions.`,
        onConfirm: () => deletePayee(payee.id),
      });
    });

    tbody.appendChild(tr);
  });

  section.appendChild(tableWrapper);
  container.appendChild(section);
}
