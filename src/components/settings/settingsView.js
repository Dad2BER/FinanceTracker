import { Modal } from "../ui/modal.js";
import { showConfirmDialog } from "../ui/confirmDialog.js";
import { saveApiKey, saveAvKey } from "../../services/storage.js";
import {
  addCategory, updateCategory, deleteCategory,
  addSubcategory, updateSubcategory, deleteSubcategory,
  addPayee, updatePayee, deletePayee,
  addTag, updateTag, deleteTag,
  addRocRate, updateRocRate, deleteRocRate,
  getCategories, getPayees, getRocRates, toggleAccountHidden, setAccountInstitution,
  addCheck, updateCheck, deleteCheck, autoLinkChecks, getChecks, getAccounts,
} from "../../state.js";
import { INSTITUTIONS } from "../../constants/institutions.js";
import { formatCurrency } from "../../utils/currency.js";

// ── Module-level selection state (persists across re-renders) ─────────────────
let _selectedCategoryId = null;
let _selectedSubcategoryId = null;
let _selectedRocYear = null;
let _checkAccountFilter = "";  // "" = all ledger accounts
let _checkMatchMsg = "";

// ── Utilities ─────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderPageHeader(container, title) {
  const header = document.createElement("div");
  header.className = "view-header";
  header.innerHTML = `<h1>${escHtml(title)}</h1>`;
  container.appendChild(header);
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

function showYearPrompt({ title, initialValue = "", onSave }) {
  const el = document.createElement("div");
  el.innerHTML = `
    <h3>${escHtml(title)}</h3>
    <div class="form-group">
      <label for="yp-year">Year</label>
      <input id="yp-year" type="number" class="form-input" placeholder="e.g. 2026" value="${escHtml(initialValue)}" min="1900" max="2999" step="1">
      <span class="field-error" id="yp-err"></span>
    </div>
    <div class="form-actions">
      <button class="btn btn-secondary" id="yp-cancel">Cancel</button>
      <button class="btn btn-primary" id="yp-save">Save</button>
    </div>
  `;
  const input = el.querySelector("#yp-year");
  el.querySelector("#yp-cancel").addEventListener("click", () => Modal.close());
  el.querySelector("#yp-save").addEventListener("click", () => {
    const val = input.value.trim();
    if (!/^\d{4}$/.test(val)) {
      el.querySelector("#yp-err").textContent = "Enter a 4-digit year.";
      return;
    }
    Modal.close();
    onSave(val);
  });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") el.querySelector("#yp-save").click(); });
  Modal.open(el);
  setTimeout(() => input.focus(), 50);
}

function showRocRateEditPrompt({ title, initialSymbol = "", initialPct = "", onSave }) {
  const el = document.createElement("div");
  el.innerHTML = `
    <h3>${escHtml(title)}</h3>
    <div class="form-row">
      <div class="form-group">
        <label for="rr-symbol">Symbol</label>
        <input id="rr-symbol" type="text" class="form-input" placeholder="e.g. SCHD"
          autocomplete="off" spellcheck="false" value="${escHtml(initialSymbol)}">
        <span class="field-error" id="rr-symbol-err"></span>
      </div>
      <div class="form-group">
        <label for="rr-pct">Return of Capital %</label>
        <input id="rr-pct" type="number" step="0.01" min="0" max="100" class="form-input"
          placeholder="e.g. 15.5" value="${initialPct === "" ? "" : initialPct}">
        <span class="field-error" id="rr-pct-err"></span>
      </div>
    </div>
    <div class="form-actions">
      <button class="btn btn-secondary" id="rr-cancel">Cancel</button>
      <button class="btn btn-primary" id="rr-save">Save</button>
    </div>
  `;
  const symbolInput = el.querySelector("#rr-symbol");
  const pctInput = el.querySelector("#rr-pct");
  el.querySelector("#rr-cancel").addEventListener("click", () => Modal.close());
  el.querySelector("#rr-save").addEventListener("click", () => {
    const symbol = symbolInput.value.trim();
    const pctRaw = pctInput.value.trim();
    const pct = parseFloat(pctRaw);

    let valid = true;
    el.querySelector("#rr-symbol-err").textContent = "";
    el.querySelector("#rr-pct-err").textContent = "";
    if (!symbol) {
      el.querySelector("#rr-symbol-err").textContent = "Symbol is required.";
      valid = false;
    }
    if (pctRaw === "" || isNaN(pct) || pct < 0 || pct > 100) {
      el.querySelector("#rr-pct-err").textContent = "Enter a percent between 0 and 100.";
      valid = false;
    }
    if (!valid) return;

    Modal.close();
    onSave(symbol, pct);
  });
  Modal.open(el);
  setTimeout(() => symbolInput.focus(), 50);
}

// ── Profiles ─────────────────────────────────────────────────────────────────

export function renderSettingsProfiles(container, profileProps) {
  container.innerHTML = "";
  renderPageHeader(container, "Profiles");
  if (!profileProps) return;

  const { profiles, currentProfileId, onCreateProfile, onRenameProfile, onDeleteProfile } = profileProps;

  const profileSection = document.createElement("div");
  profileSection.className = "settings-profiles-section";

  const profileList = document.createElement("div");
  profileList.className = "settings-profile-list";

  profiles.forEach((p) => {
    const row = document.createElement("div");
    const isCurrent = p.id === currentProfileId;
    row.className = "settings-profile-row" + (isCurrent ? " current" : "");

    const nameSpan = document.createElement("span");
    nameSpan.className = "settings-profile-name";
    nameSpan.textContent = p.name + (isCurrent ? " (current)" : "");

    const actions = document.createElement("span");
    actions.className = "settings-profile-actions";

    const renBtn = document.createElement("button");
    renBtn.className = "icon-btn";
    renBtn.title = "Rename";
    renBtn.textContent = "✏";
    renBtn.addEventListener("click", () => {
      showNamePrompt({
        title: "Rename Profile",
        label: "Profile Name",
        initialValue: p.name,
        onSave: async (name) => {
          try {
            await onRenameProfile(p.id, name);
          } catch (e) {
            alert("Failed to rename profile: " + e.message);
          }
        },
      });
    });

    const delBtn = document.createElement("button");
    delBtn.className = "icon-btn icon-btn-danger";
    delBtn.title = "Delete";
    delBtn.textContent = "🗑";
    if (profiles.length <= 1) {
      delBtn.disabled = true;
      delBtn.title = "Cannot delete the last profile";
    } else if (isCurrent) {
      delBtn.disabled = true;
      delBtn.title = "Switch to another profile first";
    }
    delBtn.addEventListener("click", () => {
      if (delBtn.disabled) return;
      showConfirmDialog({
        title: "Delete Profile",
        message: `Delete "${p.name}" and ALL its accounts, holdings, transactions, categories, and payees? This cannot be undone.`,
        onConfirm: async () => {
          try {
            await onDeleteProfile(p.id);
          } catch (e) {
            alert("Failed to delete profile: " + e.message);
          }
        },
      });
    });

    actions.appendChild(renBtn);
    actions.appendChild(delBtn);
    row.appendChild(nameSpan);
    row.appendChild(actions);
    profileList.appendChild(row);
  });

  profileSection.appendChild(profileList);

  // Add profile button
  const addProfileRow = document.createElement("div");
  addProfileRow.className = "settings-profile-add";
  const addProfileBtn = document.createElement("button");
  addProfileBtn.className = "btn btn-secondary btn-sm";
  addProfileBtn.textContent = "+ Add Profile";
  addProfileBtn.addEventListener("click", () => {
    showNamePrompt({
      title: "Add Profile",
      label: "Profile Name",
      onSave: async (name) => {
        try {
          await onCreateProfile(name);
        } catch (e) {
          alert("Failed to create profile: " + e.message);
        }
      },
    });
  });
  addProfileRow.appendChild(addProfileBtn);
  profileSection.appendChild(addProfileRow);

  container.appendChild(profileSection);
}

// ── Accounts ─────────────────────────────────────────────────────────────────

function formatAccountType(account) {
  if (account.accountType === "ledger") return "Ledger";
  return account.taxType || "Asset";
}

export function renderSettingsAccounts(container, accounts) {
  container.innerHTML = "";
  renderPageHeader(container, "Accounts");

  if (accounts.length === 0) {
    const empty = document.createElement("p");
    empty.className = "dim";
    empty.style.cssText = "font-size:0.88rem;padding:1rem 0;";
    empty.textContent = "No accounts yet.";
    container.appendChild(empty);
    return;
  }

  const section = document.createElement("div");
  section.className = "settings-accounts-section";

  const list = document.createElement("div");
  list.className = "settings-account-list";

  [...accounts]
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((account) => {
      const row = document.createElement("div");
      row.className = "settings-account-row" + (account.hidden ? " hidden" : "");

      const nameSpan = document.createElement("span");
      nameSpan.className = "settings-account-name";
      nameSpan.textContent = account.name;

      const typeSpan = document.createElement("span");
      typeSpan.className = "settings-account-type";
      typeSpan.textContent = formatAccountType(account);

      const institutionOptions = Object.entries(INSTITUTIONS)
        .map(([key, cfg]) => `<option value="${key}" ${account.institution === key ? "selected" : ""}>${escHtml(cfg.label)}</option>`)
        .join("");
      const institutionSel = document.createElement("select");
      institutionSel.className = "form-select settings-account-institution";
      institutionSel.innerHTML = `<option value="" ${!account.institution ? "selected" : ""}>— None —</option>${institutionOptions}`;
      institutionSel.addEventListener("change", () => setAccountInstitution(account.id, institutionSel.value));

      const toggleBtn = document.createElement("button");
      toggleBtn.className = "btn btn-secondary btn-sm";
      toggleBtn.textContent = account.hidden ? "Show" : "Hide";
      toggleBtn.title = account.hidden
        ? "Show this account on the Portfolio page"
        : "Hide this account from the Portfolio page";
      toggleBtn.addEventListener("click", () => toggleAccountHidden(account.id));

      row.appendChild(nameSpan);
      row.appendChild(typeSpan);
      row.appendChild(institutionSel);
      row.appendChild(toggleBtn);
      list.appendChild(row);
    });

  section.appendChild(list);
  container.appendChild(section);

  const hint = document.createElement("p");
  hint.className = "dim";
  hint.style.cssText = "font-size:0.8rem;margin-top:0.75rem;";
  hint.textContent = "Hidden accounts are removed from the Portfolio page only — their holdings, transactions, and history remain available everywhere else. Financial Institution narrows the account list on the Div. Income importer.";
  container.appendChild(hint);
}

// ── API Keys ─────────────────────────────────────────────────────────────────

export function renderSettingsApiKeys(container, onApiKeyChanged) {
  container.innerHTML = "";
  renderPageHeader(container, "API Keys");

  const apiSection = document.createElement("div");
  apiSection.className = "settings-api-section";
  apiSection.innerHTML = `
    <div class="form-group">
      <label for="finnhub-key-input">Finnhub API Key</label>
      <div class="settings-api-input-row">
        <input id="finnhub-key-input" type="text" class="form-input key-input"
          value="${escHtml(window.__FINNHUB_API_KEY__ || "")}"
          placeholder="Paste your Finnhub key" autocomplete="off" spellcheck="false">
        <button class="btn btn-secondary btn-sm" id="save-finnhub-btn">Save</button>
      </div>
      <div class="settings-api-saved" id="finnhub-saved"></div>
    </div>
    <div class="form-group">
      <label for="av-key-input">Alpha Vantage API Key <span style="font-weight:400;text-transform:none;letter-spacing:0">(optional — for mutual funds)</span></label>
      <div class="settings-api-input-row">
        <input id="av-key-input" type="text" class="form-input key-input"
          value="${escHtml(window.__AV_API_KEY__ || "")}"
          placeholder="Paste your Alpha Vantage key" autocomplete="off" spellcheck="false">
        <button class="btn btn-secondary btn-sm" id="save-av-btn">Save</button>
      </div>
      <div class="settings-api-saved" id="av-saved"></div>
    </div>
  `;
  container.appendChild(apiSection);

  // Save Finnhub key
  apiSection.querySelector("#save-finnhub-btn").addEventListener("click", () => {
    const key = apiSection.querySelector("#finnhub-key-input").value.trim();
    window.__FINNHUB_API_KEY__ = key;
    saveApiKey(key);
    if (onApiKeyChanged) onApiKeyChanged(key, undefined);
    const msg = apiSection.querySelector("#finnhub-saved");
    msg.textContent = "Saved!";
    setTimeout(() => { msg.textContent = ""; }, 2500);
  });

  // Save Alpha Vantage key
  apiSection.querySelector("#save-av-btn").addEventListener("click", () => {
    const key = apiSection.querySelector("#av-key-input").value.trim();
    window.__AV_API_KEY__ = key;
    if (key) saveAvKey(key);
    if (onApiKeyChanged) onApiKeyChanged(undefined, key);
    const msg = apiSection.querySelector("#av-saved");
    msg.textContent = "Saved!";
    setTimeout(() => { msg.textContent = ""; }, 2500);
  });
}

// ── Database Backup / Restore ─────────────────────────────────────────────────

export function renderSettingsDatabase(container) {
  container.innerHTML = "";
  renderPageHeader(container, "Database");

  const dbSection = document.createElement("div");
  dbSection.className = "settings-db-section";
  dbSection.innerHTML = `
    <span class="settings-db-label">Backup or restore the entire database.</span>
    <div class="settings-db-actions">
      <button class="btn btn-secondary btn-sm" id="db-backup-btn">⬇ Backup</button>
      <button class="btn btn-secondary btn-sm settings-db-restore-btn" id="db-restore-btn">⬆ Restore</button>
    </div>
    <input type="file" id="db-restore-input" accept=".db" style="display:none">
  `;
  container.appendChild(dbSection);

  // Backup: fetch the DB as a blob and trigger a save-as download.
  // Using fetch+blob avoids navigating the page (which would show binary
  // data as garbage or a "Not Found" error in the browser).
  dbSection.querySelector("#db-backup-btn").addEventListener("click", async () => {
    const btn = dbSection.querySelector("#db-backup-btn");
    btn.disabled = true;
    btn.textContent = "⏳ Backing up…";
    try {
      const res = await fetch("/api/backup");
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert("Backup failed: " + (err.error || `HTTP ${res.status}`));
        return;
      }
      const blob = await res.blob();
      const today = new Date().toISOString().slice(0, 10);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `finance-tracker-backup-${today}.db`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("Backup failed: " + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "⬇ Backup";
    }
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
}

// ── Categories & Payees ────────────────────────────────────────────────────────

export function renderSettingsCategories(container, categories, payees) {
  // ── Validate & default selection state ──────────────────────────────────────
  if (!categories.find((c) => c.id === _selectedCategoryId)) {
    _selectedCategoryId = categories[0]?.id ?? null;
  }
  const selectedCategory = categories.find((c) => c.id === _selectedCategoryId) ?? null;

  if (!selectedCategory?.subcategories.find((s) => s.id === _selectedSubcategoryId)) {
    _selectedSubcategoryId = selectedCategory?.subcategories[0]?.id ?? null;
  }
  const selectedSub = selectedCategory?.subcategories.find((s) => s.id === _selectedSubcategoryId) ?? null;

  // Helper: re-render this page with fresh state (called after selection changes)
  function rerender() {
    renderSettingsCategories(container, getCategories(), getPayees());
  }

  container.innerHTML = "";
  renderPageHeader(container, "Categories & Payees");

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

// ── Tags ─────────────────────────────────────────────────────────────────────

export function renderSettingsTags(container, tags) {
  container.innerHTML = "";
  renderPageHeader(container, "Tags");

  if (tags.length === 0) {
    const empty = document.createElement("p");
    empty.className = "dim";
    empty.style.cssText = "font-size:0.88rem;padding:1rem 0;";
    empty.textContent = "No tags yet.";
    container.appendChild(empty);
  } else {
    const section = document.createElement("div");
    section.className = "settings-tags-section";

    const list = document.createElement("div");
    list.className = "settings-tag-list";

    [...tags]
      .sort((a, b) => (b.protected ? 1 : 0) - (a.protected ? 1 : 0) || a.name.localeCompare(b.name))
      .forEach((tag) => {
        const row = document.createElement("div");
        row.className = "settings-tag-row";

        const nameSpan = document.createElement("span");
        nameSpan.className = "settings-tag-name";
        nameSpan.textContent = tag.name;

        const actions = document.createElement("span");
        actions.className = "settings-tag-actions";

        if (tag.protected) {
          const badge = document.createElement("span");
          badge.className = "settings-tag-protected-badge";
          badge.title = "This tag can't be renamed or deleted";
          badge.textContent = "Protected";
          actions.appendChild(badge);
        } else {
          const editBtn = document.createElement("button");
          editBtn.className = "icon-btn";
          editBtn.title = "Rename";
          editBtn.textContent = "✏";
          editBtn.addEventListener("click", () => {
            showNamePrompt({
              title: "Rename Tag",
              label: "Tag Name",
              initialValue: tag.name,
              onSave: (name) => updateTag(tag.id, name),
            });
          });

          const delBtn = document.createElement("button");
          delBtn.className = "icon-btn icon-btn-danger";
          delBtn.title = "Delete";
          delBtn.textContent = "🗑";
          delBtn.addEventListener("click", () => {
            showConfirmDialog({
              title: "Delete Tag",
              message: `Delete tag "${tag.name}"? Existing transactions using this tag are not affected.`,
              onConfirm: () => deleteTag(tag.id),
            });
          });

          actions.appendChild(editBtn);
          actions.appendChild(delBtn);
        }

        row.appendChild(nameSpan);
        row.appendChild(actions);
        list.appendChild(row);
      });

    section.appendChild(list);
    container.appendChild(section);
  }

  // Add tag row
  const addRow = document.createElement("div");
  addRow.className = "settings-tag-add";
  const addBtn = document.createElement("button");
  addBtn.className = "btn btn-secondary btn-sm";
  addBtn.textContent = "+ Add Tag";
  addBtn.addEventListener("click", () => {
    showNamePrompt({
      title: "Add Tag",
      label: "Tag Name",
      onSave: (name) => addTag(name),
    });
  });
  addRow.appendChild(addBtn);
  container.appendChild(addRow);
}

// ── Return of Capital ──────────────────────────────────────────────────────

export function renderSettingsRocRates(container, rocRates) {
  // Years that actually have at least one saved rate, newest first.
  const years = [...new Set(rocRates.map((r) => r.year))].sort((a, b) => b.localeCompare(a));

  // _selectedRocYear may be a brand-new year the user just added (or an
  // emptied-out year whose last symbol was just deleted) that has no rates
  // yet — keep it selected until a rate is saved under it or the user picks
  // something else. Only default to the first real year on first render.
  if (_selectedRocYear === null) {
    _selectedRocYear = years[0] ?? null;
  }

  function rerender() {
    renderSettingsRocRates(container, getRocRates());
  }

  container.innerHTML = "";
  renderPageHeader(container, "Return of Capital");

  // ── Year Toolbar ─────────────────────────────────────────────────────────
  const toolbar = document.createElement("div");
  toolbar.className = "settings-toolbar";

  const selectableYears = _selectedRocYear && !years.includes(_selectedRocYear)
    ? [_selectedRocYear, ...years]
    : years;

  const yearOptions = selectableYears
    .map((y) => `<option value="${escHtml(y)}" ${y === _selectedRocYear ? "selected" : ""}>${escHtml(y)}</option>`)
    .join("");

  toolbar.innerHTML = `
    <select class="form-select settings-cat-select" id="roc-year-select" ${selectableYears.length === 0 ? "disabled" : ""}>
      ${selectableYears.length === 0 ? '<option value="">No years</option>' : yearOptions}
    </select>
    <button class="btn btn-primary btn-sm" id="add-year-btn">+ Add Year</button>
    <button class="btn btn-secondary btn-sm" id="delete-year-btn" ${!_selectedRocYear ? "disabled" : ""} style="color:var(--color-danger)">&#128465; Delete Year</button>
  `;
  container.appendChild(toolbar);

  toolbar.querySelector("#roc-year-select").addEventListener("change", (e) => {
    _selectedRocYear = e.target.value;
    rerender();
  });

  toolbar.querySelector("#add-year-btn").addEventListener("click", () => {
    showYearPrompt({
      title: "Add Year",
      onSave: (year) => {
        _selectedRocYear = year;
        rerender();
      },
    });
  });

  if (_selectedRocYear) {
    toolbar.querySelector("#delete-year-btn").addEventListener("click", () => {
      const yearRates = rocRates.filter((r) => r.year === _selectedRocYear);
      showConfirmDialog({
        title: "Delete Year",
        message: yearRates.length > 0
          ? `Delete all ${yearRates.length} Return of Capital rate(s) for ${_selectedRocYear}?`
          : `Remove ${_selectedRocYear} from the list?`,
        onConfirm: () => {
          yearRates.forEach((r) => deleteRocRate(r.id));
          _selectedRocYear = null;
          rerender();
        },
      });
    });
  }

  // ── Empty state (no years yet) ──────────────────────────────────────────
  if (!_selectedRocYear) {
    const empty = document.createElement("p");
    empty.className = "dim";
    empty.style.cssText = "font-size:0.88rem;padding:1rem 0;";
    empty.textContent = "No years configured yet. Add one above to get started.";
    container.appendChild(empty);
    return;
  }

  // ── Symbol / % list for the selected year ───────────────────────────────
  const yearRates = rocRates
    .filter((r) => r.year === _selectedRocYear)
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  const section = document.createElement("div");
  section.className = "settings-roc-section";

  if (yearRates.length === 0) {
    const empty = document.createElement("p");
    empty.className = "dim";
    empty.style.cssText = "font-size:0.88rem;padding:0.5rem 0;";
    empty.textContent = `No symbols configured for ${_selectedRocYear} yet. Add one below.`;
    section.appendChild(empty);
  } else {
    const list = document.createElement("div");
    list.className = "settings-roc-list";

    yearRates.forEach((rate) => {
      const row = document.createElement("div");
      row.className = "settings-roc-row";

      const symbolSpan = document.createElement("span");
      symbolSpan.className = "settings-roc-symbol";
      symbolSpan.textContent = rate.symbol;

      const pctSpan = document.createElement("span");
      pctSpan.className = "settings-roc-pct";
      pctSpan.textContent = `${rate.pct}%`;

      const actions = document.createElement("span");
      actions.className = "settings-roc-actions";

      const editBtn = document.createElement("button");
      editBtn.className = "icon-btn";
      editBtn.title = "Edit";
      editBtn.textContent = "✏";
      editBtn.addEventListener("click", () => {
        showRocRateEditPrompt({
          title: "Edit Symbol",
          initialSymbol: rate.symbol,
          initialPct: rate.pct,
          onSave: (symbol, pct) => updateRocRate(rate.id, symbol, pct),
        });
      });

      const delBtn = document.createElement("button");
      delBtn.className = "icon-btn icon-btn-danger";
      delBtn.title = "Delete";
      delBtn.textContent = "🗑";
      delBtn.addEventListener("click", () => {
        showConfirmDialog({
          title: "Delete Symbol",
          message: `Delete the ${rate.symbol} Return of Capital rate for ${_selectedRocYear}?`,
          onConfirm: () => deleteRocRate(rate.id),
        });
      });

      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      row.appendChild(symbolSpan);
      row.appendChild(pctSpan);
      row.appendChild(actions);
      list.appendChild(row);
    });

    section.appendChild(list);
  }

  container.appendChild(section);

  // ── Add symbol row ───────────────────────────────────────────────────────
  const addRocRow = document.createElement("div");
  addRocRow.className = "settings-roc-add";
  const addRocBtn = document.createElement("button");
  addRocBtn.className = "btn btn-secondary btn-sm";
  addRocBtn.textContent = "+ Add Symbol";
  addRocBtn.addEventListener("click", () => {
    showRocRateEditPrompt({
      title: `Add Symbol — ${_selectedRocYear}`,
      onSave: (symbol, pct) => addRocRate(_selectedRocYear, symbol, pct),
    });
  });
  addRocRow.appendChild(addRocBtn);
  container.appendChild(addRocRow);
}

// ── Check Register ─────────────────────────────────────────────────────────
// Maps check numbers on ledger (checking) accounts to the merchant paid.
// Transactions link to a row via `tx.checkId` — auto-matched on account +
// check number (+ amount when given), or set by hand in the transaction form.

function checkSortKey(c) {
  const n = parseInt(c.checkNumber, 10);
  return isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
}

function showCheckEditPrompt({ title, ledgers, payees, checks, initial = {}, onSave }) {
  const el = document.createElement("div");
  const accountOptions = ledgers
    .map((a) => `<option value="${escHtml(a.id)}" ${a.id === initial.accountId ? "selected" : ""}>${escHtml(a.name)}</option>`)
    .join("");
  const payeeOptions = payees.map((p) => `<option value="${escHtml(p.name)}">`).join("");
  el.innerHTML = `
    <h3>${escHtml(title)}</h3>
    <div class="form-group">
      <label for="cr-account">Account</label>
      <select id="cr-account" class="form-select">${accountOptions}</select>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label for="cr-number">Check #</label>
        <input id="cr-number" type="text" inputmode="numeric" class="form-input" placeholder="e.g. 1003"
          autocomplete="off" value="${escHtml(initial.checkNumber ?? "")}">
        <span class="field-error" id="cr-number-err"></span>
      </div>
      <div class="form-group">
        <label for="cr-amount">Amount <span style="font-weight:400;text-transform:none;letter-spacing:0">(optional)</span></label>
        <input id="cr-amount" type="number" step="0.01" min="0" class="form-input" placeholder="e.g. 294.02"
          value="${initial.amount ?? ""}">
      </div>
    </div>
    <div class="form-group">
      <label for="cr-merchant">Merchant</label>
      <input id="cr-merchant" type="text" class="form-input" list="cr-merchant-list" maxlength="100"
        placeholder="Who the check was written to" autocomplete="off" value="${escHtml(initial.merchant ?? "")}">
      <datalist id="cr-merchant-list">${payeeOptions}</datalist>
      <span class="field-error" id="cr-merchant-err"></span>
    </div>
    <span class="field-hint">When set, Amount must also match for a transaction to be linked automatically.</span>
    <div class="form-actions">
      <button class="btn btn-secondary" id="cr-cancel">Cancel</button>
      <button class="btn btn-primary" id="cr-save">Save</button>
    </div>
  `;
  const numberInput = el.querySelector("#cr-number");
  el.querySelector("#cr-cancel").addEventListener("click", () => Modal.close());
  el.querySelector("#cr-save").addEventListener("click", () => {
    const accountId = el.querySelector("#cr-account").value;
    const checkNumber = numberInput.value.trim();
    const merchant = el.querySelector("#cr-merchant").value.trim();
    const amount = el.querySelector("#cr-amount").value.trim();

    let valid = true;
    el.querySelector("#cr-number-err").textContent = "";
    el.querySelector("#cr-merchant-err").textContent = "";
    if (!checkNumber) {
      el.querySelector("#cr-number-err").textContent = "Check # is required.";
      valid = false;
    } else if (checks.some((c) => c.id !== initial.id && c.accountId === accountId &&
        c.checkNumber.replace(/^0+(?=\d)/, "") === checkNumber.replace(/^0+(?=\d)/, ""))) {
      el.querySelector("#cr-number-err").textContent = "This account already has that check #.";
      valid = false;
    }
    if (!merchant) {
      el.querySelector("#cr-merchant-err").textContent = "Merchant is required.";
      valid = false;
    }
    if (!valid) return;

    Modal.close();
    onSave({ accountId, checkNumber, merchant, amount });
  });
  Modal.open(el);
  setTimeout(() => numberInput.focus(), 50);
}

export function renderSettingsCheckRegister(container, accounts, checks, payees) {
  const ledgers = accounts
    .filter((a) => a.accountType === "ledger")
    .sort((a, b) => a.name.localeCompare(b.name));
  if (_checkAccountFilter && !ledgers.some((a) => a.id === _checkAccountFilter)) _checkAccountFilter = "";

  container.innerHTML = "";
  renderPageHeader(container, "Check Register");

  if (ledgers.length === 0) {
    const empty = document.createElement("p");
    empty.className = "dim";
    empty.style.cssText = "font-size:0.88rem;padding:1rem 0;";
    empty.textContent = "Add a ledger (checking) account first — checks are recorded per ledger account.";
    container.appendChild(empty);
    return;
  }

  // checkId → linked transaction (for the "Matched Transaction" column)
  const linkedTx = new Map();
  ledgers.forEach((a) => (a.transactions || []).forEach((t) => { if (t.checkId) linkedTx.set(t.checkId, t); }));
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));

  // ── Toolbar ──────────────────────────────────────────────────────────────
  const toolbar = document.createElement("div");
  toolbar.className = "settings-toolbar";
  toolbar.innerHTML = `
    <select class="form-select settings-cat-select" id="cr-filter">
      <option value="">All ledger accounts</option>
      ${ledgers.map((a) => `<option value="${escHtml(a.id)}" ${a.id === _checkAccountFilter ? "selected" : ""}>${escHtml(a.name)}</option>`).join("")}
    </select>
    <button class="btn btn-primary btn-sm" id="cr-add-btn">+ Add Check</button>
    <button class="btn btn-secondary btn-sm" id="cr-match-btn"
      title="Link unmatched checks to transactions whose payee is the check number">&#8635; Match Transactions</button>
    <span class="settings-api-saved" id="cr-match-msg">${escHtml(_checkMatchMsg)}</span>
  `;
  container.appendChild(toolbar);
  _checkMatchMsg = "";

  toolbar.querySelector("#cr-filter").addEventListener("change", (e) => {
    _checkAccountFilter = e.target.value;
    renderSettingsCheckRegister(container, getAccounts(), getChecks(), getPayees());
  });
  toolbar.querySelector("#cr-add-btn").addEventListener("click", () => {
    showCheckEditPrompt({
      title: "Add Check",
      ledgers, payees, checks,
      initial: { accountId: _checkAccountFilter || ledgers[0].id },
      onSave: (rec) => addCheck(rec),
    });
  });
  toolbar.querySelector("#cr-match-btn").addEventListener("click", () => {
    const n = autoLinkChecks();
    _checkMatchMsg = n === 0 ? "No new matches found." : `Linked ${n} transaction${n === 1 ? "" : "s"}.`;
    renderSettingsCheckRegister(container, getAccounts(), getChecks(), getPayees());
  });

  // ── Table ────────────────────────────────────────────────────────────────
  const visible = checks
    .filter((c) => !_checkAccountFilter || c.accountId === _checkAccountFilter)
    .sort((a, b) =>
      (accountName.get(a.accountId) || "").localeCompare(accountName.get(b.accountId) || "") ||
      checkSortKey(b) - checkSortKey(a));

  if (visible.length === 0) {
    const empty = document.createElement("p");
    empty.className = "dim";
    empty.style.cssText = "font-size:0.88rem;padding:0.5rem 0;";
    empty.textContent = "No checks recorded yet. Add one above.";
    container.appendChild(empty);
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "table-wrapper";
  wrapper.innerHTML = `
    <table class="holdings-table check-register-table">
      <thead>
        <tr>
          <th>Account</th>
          <th>Check #</th>
          <th>Merchant</th>
          <th class="align-right">Amount</th>
          <th>Matched Transaction</th>
          <th class="actions-cell"></th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  `;
  const tbody = wrapper.querySelector("tbody");

  visible.forEach((check) => {
    const tx = linkedTx.get(check.id);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escHtml(accountName.get(check.accountId) || "—")}</td>
      <td>${escHtml(check.checkNumber)}</td>
      <td>${escHtml(check.merchant)}</td>
      <td class="align-right">${check.amount != null ? formatCurrency(check.amount) : '<span class="dim">—</span>'}</td>
      <td>${tx
        ? `<span class="dim">${escHtml(tx.date)} · ${escHtml(tx.payeeName)} · ${formatCurrency(Math.abs(tx.amount))}</span>`
        : '<span class="check-unmatched">Not matched</span>'}</td>
      <td class="actions-cell">
        <button class="icon-btn" title="Edit">&#9998;</button>
        <button class="icon-btn icon-btn-danger" title="Delete">&#128465;</button>
      </td>
    `;
    const [editBtn, delBtn] = tr.querySelectorAll("button");
    editBtn.addEventListener("click", () => {
      showCheckEditPrompt({
        title: "Edit Check",
        ledgers, payees, checks,
        initial: check,
        onSave: (rec) => updateCheck(check.id, rec),
      });
    });
    delBtn.addEventListener("click", () => {
      showConfirmDialog({
        title: "Delete Check",
        message: `Delete check #${check.checkNumber} (${check.merchant})?${tx ? " Its transaction will show the bank's payee text again." : ""}`,
        onConfirm: () => deleteCheck(check.id),
      });
    });
    tbody.appendChild(tr);
  });

  container.appendChild(wrapper);

  const hint = document.createElement("p");
  hint.className = "dim";
  hint.style.cssText = "font-size:0.8rem;margin-top:0.75rem;";
  hint.textContent = "Checks are matched to transactions in the same account whose payee is the check number (e.g. \"Check 1003\", \"Draft 3047\", \"3055\"). Linked transactions show the Merchant in ledgers and reports. You can also link a check by hand from the transaction's Edit form.";
  container.appendChild(hint);
}
