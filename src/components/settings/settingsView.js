import { Modal } from "../ui/modal.js";
import { showConfirmDialog } from "../ui/confirmDialog.js";
import {
  addCategory, updateCategory, deleteCategory,
  addSubcategory, updateSubcategory, deleteSubcategory,
  addPayee, updatePayee, deletePayee,
  getCategories, getPayees,
} from "../../state.js";

// ── Module-level selection state (persists across re-renders) ─────────────────
let _selectedCategoryId = null;
let _selectedSubcategoryId = null;

// ── Utilities ─────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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

  catSel.addEventListener("change", () => {
    const catId = catSel.value;
    if (catId) {
      subGroup.style.display = "";
      const subSel = el.querySelector("#pe-sub");
      subSel.innerHTML = `<option value="">— None —</option>${buildSubOptions(catId, null)}`;
    } else {
      subGroup.style.display = "none";
    }
  });

  el.querySelector("#pe-cancel").addEventListener("click", () => Modal.close());
  el.querySelector("#pe-save").addEventListener("click", () => {
    const name = el.querySelector("#pe-name").value.trim();
    if (!name) { el.querySelector("#pe-err").textContent = "Name is required."; return; }
    const subSel = el.querySelector("#pe-sub");
    const finalSubId = subSel ? subSel.value || null : null;
    Modal.close();
    onSave(name, finalSubId);
  });

  Modal.open(el);
  setTimeout(() => el.querySelector("#pe-name").focus(), 50);
}

// ── Main View ─────────────────────────────────────────────────────────────────

export function renderSettingsView(container, categories, payees, onBack) {
  // ── Validate & default selection state ──────────────────────────────────────
  if (!categories.find((c) => c.id === _selectedCategoryId)) {
    _selectedCategoryId = categories[0]?.id ?? null;
  }
  const selectedCategory = categories.find((c) => c.id === _selectedCategoryId) ?? null;

  if (!selectedCategory?.subcategories.find((s) => s.id === _selectedSubcategoryId)) {
    _selectedSubcategoryId = selectedCategory?.subcategories[0]?.id ?? null;
  }
  const selectedSub = selectedCategory?.subcategories.find((s) => s.id === _selectedSubcategoryId) ?? null;

  // Helper: re-render this view with fresh state (called after selection changes)
  function rerender() {
    renderSettingsView(container, getCategories(), getPayees(), onBack);
  }

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

  // ── Database Backup / Restore ────────────────────────────────────────────────
  const dbSection = document.createElement("div");
  dbSection.className = "settings-db-section";
  dbSection.innerHTML = `
    <span class="settings-db-label">Database</span>
    <div class="settings-db-actions">
      <button class="btn btn-secondary btn-sm" id="db-backup-btn">⬇ Backup</button>
      <button class="btn btn-secondary btn-sm settings-db-restore-btn" id="db-restore-btn">⬆ Restore</button>
    </div>
    <input type="file" id="db-restore-input" accept=".db" style="display:none">
  `;
  container.appendChild(dbSection);

  // Backup: trigger a browser download from the server endpoint
  dbSection.querySelector("#db-backup-btn").addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = "/api/backup";
    a.click();
  });

  // Restore: confirm → file picker → POST bytes → reload
  const restoreInput = dbSection.querySelector("#db-restore-input");

  dbSection.querySelector("#db-restore-btn").addEventListener("click", () => {
    showConfirmDialog({
      title: "Restore Database",
      message: "This will replace ALL current data with the selected backup file. The page will reload automatically. This cannot be undone.",
      onConfirm: () => restoreInput.click(),
    });
  });

  restoreInput.addEventListener("change", async () => {
    const file = restoreInput.files[0];
    if (!file) return;
    restoreInput.value = ""; // reset for next use

    try {
      const bytes = await file.arrayBuffer();
      const res = await fetch("/api/restore", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: bytes,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert("Restore failed: " + (err.error || `HTTP ${res.status}`));
        return;
      }
      // Full page reload so all in-memory state is replaced with the restored DB
      window.location.reload();
    } catch (e) {
      alert("Restore failed: " + e.message);
    }
  });

  // ── Category Toolbar ────────────────────────────────────────────────────────
  const toolbar = document.createElement("div");
  toolbar.className = "settings-toolbar";

  const catOptions = categories
    .map((c) => `<option value="${escHtml(c.id)}" ${c.id === _selectedCategoryId ? "selected" : ""}>${escHtml(c.name)}</option>`)
    .join("");

  toolbar.innerHTML = `
    <select class="form-select settings-cat-select" id="cat-select" ${categories.length === 0 ? "disabled" : ""}>
      ${categories.length === 0 ? '<option value="">No categories</option>' : catOptions}
    </select>
    <button class="btn btn-primary btn-sm" id="add-cat-btn">+ Add Category</button>
    <button class="btn btn-secondary btn-sm" id="rename-cat-btn" ${!selectedCategory ? "disabled" : ""}>&#9998; Rename</button>
    <button class="btn btn-secondary btn-sm" id="delete-cat-btn" ${!selectedCategory ? "disabled" : ""} style="color:var(--color-danger)">&#128465; Delete</button>
  `;
  container.appendChild(toolbar);

  toolbar.querySelector("#cat-select").addEventListener("change", (e) => {
    _selectedCategoryId = e.target.value;
    _selectedSubcategoryId = null;
    rerender();
  });

  toolbar.querySelector("#add-cat-btn").addEventListener("click", () => {
    showNamePrompt({
      title: "Add Category",
      label: "Category Name",
      onSave: (name) => {
        const cat = addCategory(name);
        _selectedCategoryId = cat.id;
        _selectedSubcategoryId = null;
      },
    });
  });

  if (selectedCategory) {
    toolbar.querySelector("#rename-cat-btn").addEventListener("click", () => {
      showNamePrompt({
        title: "Rename Category",
        label: "Category Name",
        initialValue: selectedCategory.name,
        onSave: (name) => updateCategory(selectedCategory.id, name),
      });
    });

    toolbar.querySelector("#delete-cat-btn").addEventListener("click", () => {
      showConfirmDialog({
        title: "Delete Category",
        message: `Delete "${selectedCategory.name}" and all its subcategories? Payees using these subcategories will lose their mapping.`,
        onConfirm: () => {
          _selectedCategoryId = null;
          _selectedSubcategoryId = null;
          deleteCategory(selectedCategory.id);
        },
      });
    });
  }

  // ── Empty state (no categories) ─────────────────────────────────────────────
  if (!selectedCategory) {
    const empty = document.createElement("p");
    empty.className = "dim";
    empty.style.cssText = "font-size:0.88rem;padding:1rem 0;";
    empty.textContent = "No categories yet. Add one above to get started.";
    container.appendChild(empty);
    return;
  }

  // ── Two-panel layout ────────────────────────────────────────────────────────
  const twoPanel = document.createElement("div");
  twoPanel.className = "settings-two-panel";
  container.appendChild(twoPanel);

  // ── LEFT: Subcategory Tabs ──────────────────────────────────────────────────
  const tabsPanel = document.createElement("div");
  tabsPanel.className = "settings-tabs-panel";
  twoPanel.appendChild(tabsPanel);

  const tabsLabel = document.createElement("div");
  tabsLabel.className = "settings-tabs-label";
  tabsLabel.textContent = "Subcategories";
  tabsPanel.appendChild(tabsLabel);

  const tabsList = document.createElement("div");
  tabsList.style.cssText = "flex:1;overflow-y:auto;";
  tabsPanel.appendChild(tabsList);

  selectedCategory.subcategories.forEach((sub) => {
    const isActive = sub.id === _selectedSubcategoryId;
    const tab = document.createElement("div");
    tab.className = `settings-tab-item${isActive ? " active" : ""}`;
    tab.innerHTML = `
      <span class="settings-tab-name">${escHtml(sub.name)}</span>
      <span class="settings-tab-actions">
        <button class="icon-btn" title="Rename">&#9998;</button>
        <button class="icon-btn icon-btn-danger" title="Delete">&#128465;</button>
      </span>
    `;

    // Click on the tab (but not the action buttons) → select it
    tab.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      _selectedSubcategoryId = sub.id;
      rerender();
    });

    const [renBtn, delBtn] = tab.querySelectorAll("button");
    renBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      showNamePrompt({
        title: "Rename Subcategory",
        label: "Subcategory Name",
        initialValue: sub.name,
        onSave: (name) => updateSubcategory(selectedCategory.id, sub.id, name),
      });
    });
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      showConfirmDialog({
        title: "Delete Subcategory",
        message: `Delete "${sub.name}"? Payees using this subcategory will lose their mapping.`,
        onConfirm: () => {
          if (_selectedSubcategoryId === sub.id) _selectedSubcategoryId = null;
          deleteSubcategory(selectedCategory.id, sub.id);
        },
      });
    });

    tabsList.appendChild(tab);
  });

  // Inline add subcategory row at bottom of left panel
  const tabAddRow = document.createElement("div");
  tabAddRow.className = "settings-tab-add";
  tabAddRow.innerHTML = `
    <input type="text" class="inline-add-input" placeholder="New subcategory…" maxlength="100">
    <button class="btn btn-secondary btn-sm" style="white-space:nowrap">Add</button>
  `;
  const subInput = tabAddRow.querySelector("input");
  const subAddBtn = tabAddRow.querySelector("button");
  function submitNewSubcategory() {
    const name = subInput.value.trim();
    if (!name) return;
    const sub = addSubcategory(selectedCategory.id, name);
    _selectedSubcategoryId = sub.id;
    subInput.value = "";
  }
  subAddBtn.addEventListener("click", submitNewSubcategory);
  subInput.addEventListener("keydown", (e) => { if (e.key === "Enter") submitNewSubcategory(); });
  tabsPanel.appendChild(tabAddRow);

  // ── RIGHT: Payee Panel ──────────────────────────────────────────────────────
  const payeePanel = document.createElement("div");
  payeePanel.className = "settings-payee-panel";
  twoPanel.appendChild(payeePanel);

  // Header
  const payeeHeader = document.createElement("div");
  payeeHeader.className = "settings-payee-header";
  const headerLabel = selectedSub
    ? `Payees <span style="font-weight:400;text-transform:none;letter-spacing:0">— ${escHtml(selectedSub.name)}</span>`
    : "Payees";
  payeeHeader.innerHTML = `<span>${headerLabel}</span>`;
  payeePanel.appendChild(payeeHeader);

  if (!selectedSub) {
    // No subcategory selected
    const hint = document.createElement("div");
    hint.className = "settings-payee-empty";
    hint.textContent = selectedCategory.subcategories.length === 0
      ? "Add subcategories on the left, then payees will appear here."
      : "Select a subcategory on the left to see its payees.";
    payeePanel.appendChild(hint);
    return;
  }

  // Payee rows
  const subcategoryPayees = payees.filter((p) => p.subcategoryId === selectedSub.id);
  const payeeListEl = document.createElement("div");
  payeeListEl.style.cssText = "flex:1;overflow-y:auto;";
  payeePanel.appendChild(payeeListEl);

  if (subcategoryPayees.length === 0) {
    const empty = document.createElement("div");
    empty.className = "settings-payee-empty";
    empty.textContent = "No payees in this subcategory yet.";
    payeeListEl.appendChild(empty);
  } else {
    subcategoryPayees.forEach((payee) => {
      const row = document.createElement("div");
      row.className = "settings-payee-row";
      row.innerHTML = `
        <span class="settings-payee-name">${escHtml(payee.name)}</span>
        <span class="settings-payee-actions">
          <button class="icon-btn" title="Edit">&#9998;</button>
          <button class="icon-btn icon-btn-danger" title="Delete">&#128465;</button>
        </span>
      `;
      const [editBtn, delBtn] = row.querySelectorAll("button");
      editBtn.addEventListener("click", () => {
        showPayeeEditPrompt({
          initialName: payee.name,
          initialSubcategoryId: payee.subcategoryId || null,
          categories,
          onSave: (name, subcategoryId) => updatePayee(payee.id, name, subcategoryId),
        });
      });
      delBtn.addEventListener("click", () => {
        showConfirmDialog({
          title: "Delete Payee",
          message: `Delete payee "${payee.name}"? Existing transactions using this payee are not affected.`,
          onConfirm: () => deletePayee(payee.id),
        });
      });
      payeeListEl.appendChild(row);
    });
  }

  // Add payee row at bottom of right panel
  const payeeAddRow = document.createElement("div");
  payeeAddRow.className = "settings-payee-add";
  payeeAddRow.innerHTML = `
    <button class="btn btn-secondary btn-sm" id="add-payee-btn">+ Add Payee</button>
  `;
  payeeAddRow.querySelector("#add-payee-btn").addEventListener("click", () => {
    showNamePrompt({
      title: "Add Payee",
      label: "Payee Name",
      onSave: (name) => addPayee(name, _selectedSubcategoryId),
    });
  });
  payeePanel.appendChild(payeeAddRow);
}
