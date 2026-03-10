import { Modal } from "../ui/modal.js";
import { addTransactionsBatch, addPayee } from "../../state.js";

// ── Utilities ─────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseCSV(text) {
  const rows = [];
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    rows.push(parseCSVLine(line));
  }
  return rows;
}

function parseCSVLine(line) {
  const fields = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      i++;
      let field = "";
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { field += '"'; i += 2; }
        else if (line[i] === '"') { i++; break; }
        else { field += line[i++]; }
      }
      fields.push(field);
      if (i < line.length && line[i] === ",") i++;
    } else {
      const start = i;
      while (i < line.length && line[i] !== ",") i++;
      fields.push(line.slice(start, i).trim());
      if (i < line.length) i++;
    }
  }
  return fields;
}

function autoDetectColumns(headers) {
  const h = headers.map((x) => x.toLowerCase().trim());
  function findFirst(patterns) {
    for (const p of patterns) {
      const idx = h.findIndex((col) => col === p || col.includes(p));
      if (idx !== -1) return idx;
    }
    return -1;
  }
  const dateCol = findFirst(["transaction date", "trans date", "trans. date", "date"]);
  const descCol = findFirst(["description", "memo", "details", "payee", "merchant", "narrative"]);
  const amountCol = findFirst(["amount", "transaction amount"]);
  const debitCol = findFirst(["debit", "withdrawal", "withdrawals", "charge", "charges"]);
  const creditCol = findFirst(["credit", "deposit", "deposits", "payment"]);
  return { dateCol, descCol, amountCol, debitCol, creditCol };
}

function parseDate(str) {
  if (!str || !str.trim()) return null;
  const s = str.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  const mdy2 = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (mdy2) return `${mdy2[3]}-${mdy2[1].padStart(2, "0")}-${mdy2[2].padStart(2, "0")}`;
  return null;
}

function parseAmount(str) {
  if (!str || !str.trim()) return null;
  let s = str.trim().replace(/[$,\s]/g, "");
  const negative = s.startsWith("(") && s.endsWith(")");
  s = s.replace(/[()]/g, "");
  if (!s) return null;
  const num = parseFloat(s);
  return isNaN(num) ? null : negative ? -num : num;
}

function findMatchingPayee(description, payees) {
  const desc = description.toLowerCase();
  let best = null;
  let bestLen = 0;
  for (const payee of payees) {
    const name = payee.name.toLowerCase();
    if (name.length > 0 && desc.includes(name) && name.length > bestLen) {
      best = payee;
      bestLen = name.length;
    }
  }
  return best;
}

// ── Duplicate Detection ────────────────────────────────────────────────────────

// Builds a fast lookup map: "date||amount" → [payeeNames (lowercase)]
function buildExistingLookup(existingTransactions) {
  const map = new Map();
  for (const tx of existingTransactions) {
    const key = `${tx.date}||${tx.amount}`;
    if (!map.has(key)) map.set(key, []);
    const pn = (tx.payeeName || "").toLowerCase().trim();
    if (pn) map.get(key).push(pn);
  }
  return map;
}

// A row is a duplicate if an existing transaction shares the same date, amount,
// and description (matched bidirectionally against the stored payee name).
function checkIsDuplicate(date, description, amount, existingLookup) {
  const names = existingLookup.get(`${date}||${amount}`);
  if (!names || names.length === 0) return false;
  const desc = description.toLowerCase().trim();
  return names.some((pn) => pn === desc || desc.includes(pn) || pn.includes(desc));
}

const _fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
function formatAmt(amount) {
  if (amount === null) return "—";
  const s = _fmt.format(Math.abs(amount));
  return amount < 0 ? `-${s}` : s;
}

// ── Main Export ───────────────────────────────────────────────────────────────

export function showImportModal(accountId, categories, payees, existingTransactions = []) {
  const el = document.createElement("div");
  el.className = "import-modal";

  // Pre-build lookup for O(1) duplicate detection
  const existingLookup = buildExistingLookup(existingTransactions);

  // Persists across step nav so Back from step 2 can reuse the parsed CSV
  let _csvRows = null;

  function goStep(fn) {
    el.innerHTML = "";
    fn();
  }

  // ── Step 1: File Selection ────────────────────────────────────────────────
  function step1() {
    el.innerHTML = `
      <h3>Import Transactions — Step 1 of 3</h3>
      <p class="dim" style="margin-bottom:1rem;font-size:0.9rem;">
        Select a CSV file exported from your bank or credit card statement.
      </p>
      <div class="form-group">
        <label for="imp-file">CSV File</label>
        <input type="file" id="imp-file" accept=".csv,.txt" class="form-input" style="padding:0.4rem;">
        ${_csvRows ? `<span class="dim" style="font-size:0.8rem">A file is already loaded — select a new file to replace it, or click Next to continue.</span>` : ""}
        <span class="field-error" id="imp-file-err"></span>
      </div>
      <div class="form-actions">
        <button class="btn btn-secondary" id="imp-cancel">Cancel</button>
        <button class="btn btn-primary" id="imp-next">Next →</button>
      </div>
    `;

    el.querySelector("#imp-cancel").addEventListener("click", () => Modal.close());
    el.querySelector("#imp-next").addEventListener("click", () => {
      const fileInput = el.querySelector("#imp-file");
      const file = fileInput.files[0];

      if (!file) {
        if (_csvRows) {
          // Already have data from a previous load — proceed
          goStep(step2);
          return;
        }
        el.querySelector("#imp-file-err").textContent = "Please select a CSV file.";
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const rows = parseCSV(e.target.result);
        if (rows.length < 2) {
          el.querySelector("#imp-file-err").textContent = "File appears to be empty or has only a header row.";
          return;
        }
        _csvRows = rows;
        goStep(step2);
      };
      reader.onerror = () => {
        el.querySelector("#imp-file-err").textContent = "Could not read the file.";
      };
      reader.readAsText(file);
    });
  }

  // ── Step 2: Column Mapping ────────────────────────────────────────────────
  function step2() {
    const headers = _csvRows[0];
    const dataRows = _csvRows.slice(1).filter((r) => r.some((f) => f.trim()));
    const det = autoDetectColumns(headers);
    const hasSplit = det.debitCol !== -1 || det.creditCol !== -1;

    function buildSel(id, selectedIdx, includeNone = false) {
      const none = includeNone
        ? `<option value="-1" ${selectedIdx === -1 ? "selected" : ""}>— None —</option>`
        : "";
      const opts = headers
        .map((h, i) => `<option value="${i}" ${i === selectedIdx ? "selected" : ""}>${escHtml(h || `Column ${i + 1}`)}</option>`)
        .join("");
      return `<select id="${id}" class="form-select">${none}${opts}</select>`;
    }

    el.innerHTML = `
      <h3>Import Transactions — Step 2 of 3</h3>
      <p class="dim" style="margin-bottom:1rem;font-size:0.9rem;">
        Confirm which columns contain the transaction date, description, and amount.
        <strong>${dataRows.length}</strong> data row(s) detected.
      </p>
      <div class="form-group">
        <label for="imp-date-col">Date Column</label>
        ${buildSel("imp-date-col", det.dateCol !== -1 ? det.dateCol : 0)}
      </div>
      <div class="form-group">
        <label for="imp-desc-col">Description Column</label>
        ${buildSel("imp-desc-col", det.descCol !== -1 ? det.descCol : 0)}
      </div>
      <div class="form-group">
        <label>Amount Format</label>
        <div style="display:flex;gap:1.5rem;margin-top:0.3rem;">
          <label style="display:flex;align-items:center;gap:0.4rem;font-weight:400;cursor:pointer;">
            <input type="radio" name="imp-amt-type" value="single" ${!hasSplit ? "checked" : ""}> Single amount column
          </label>
          <label style="display:flex;align-items:center;gap:0.4rem;font-weight:400;cursor:pointer;">
            <input type="radio" name="imp-amt-type" value="split" ${hasSplit ? "checked" : ""}> Separate Debit / Credit columns
          </label>
        </div>
      </div>
      <div id="imp-single-wrap" class="form-group" ${hasSplit ? 'style="display:none"' : ""}>
        <label for="imp-amount-col">Amount Column</label>
        ${buildSel("imp-amount-col", det.amountCol !== -1 ? det.amountCol : 0)}
      </div>
      <div id="imp-split-wrap" ${!hasSplit ? 'style="display:none"' : ""}>
        <div class="form-group">
          <label for="imp-debit-col">Debit Column <span style="font-weight:400">(charges / purchases → positive)</span></label>
          ${buildSel("imp-debit-col", det.debitCol !== -1 ? det.debitCol : 0, true)}
        </div>
        <div class="form-group">
          <label for="imp-credit-col">Credit Column <span style="font-weight:400">(payments / credits → negative)</span></label>
          ${buildSel("imp-credit-col", det.creditCol !== -1 ? det.creditCol : 0, true)}
        </div>
      </div>
      <div class="import-preview">
        <div class="import-preview-label">Preview (first 3 rows)</div>
        <div id="imp-preview" class="import-preview-table-wrap"></div>
      </div>
      <span class="field-error" id="imp-map-err"></span>
      <div class="form-actions">
        <button class="btn btn-secondary" id="imp-back">← Back</button>
        <button class="btn btn-primary" id="imp-next">Next →</button>
      </div>
    `;

    function getAmtCfg() {
      const type = el.querySelector("input[name='imp-amt-type']:checked").value;
      return {
        type,
        amtCol: type === "single" ? parseInt(el.querySelector("#imp-amount-col")?.value ?? "-1") : -1,
        debitCol: type === "split" ? parseInt(el.querySelector("#imp-debit-col").value) : -1,
        creditCol: type === "split" ? parseInt(el.querySelector("#imp-credit-col").value) : -1,
      };
    }

    function rowAmount(row, cfg) {
      if (cfg.type === "single" && cfg.amtCol >= 0) {
        return parseAmount(row[cfg.amtCol]);
      } else if (cfg.type === "split") {
        const d = cfg.debitCol >= 0 ? parseAmount(row[cfg.debitCol]) : null;
        const c = cfg.creditCol >= 0 ? parseAmount(row[cfg.creditCol]) : null;
        if (d !== null && d !== 0) return Math.abs(d);
        if (c !== null && c !== 0) return -Math.abs(c);
        return null;
      }
      return null;
    }

    function updatePreview() {
      const dateCol = parseInt(el.querySelector("#imp-date-col").value);
      const descCol = parseInt(el.querySelector("#imp-desc-col").value);
      const cfg = getAmtCfg();
      let html = `<table class="holdings-table"><thead><tr>
        <th>Date</th><th>Description</th><th class="align-right">Amount</th>
      </tr></thead><tbody>`;
      for (const row of dataRows.slice(0, 3)) {
        const date = parseDate(row[dateCol] || "") || (row[dateCol] || "—");
        const desc = row[descCol] || "";
        const amt = rowAmount(row, cfg);
        const cls = amt !== null ? (amt >= 0 ? "amount-charge" : "amount-payment") : "";
        html += `<tr>
          <td>${escHtml(date)}</td>
          <td class="imp-desc-cell">${escHtml(desc)}</td>
          <td class="align-right"><span class="${cls}">${escHtml(formatAmt(amt))}</span></td>
        </tr>`;
      }
      html += "</tbody></table>";
      el.querySelector("#imp-preview").innerHTML = html;
    }

    el.querySelectorAll("input[name='imp-amt-type']").forEach((r) =>
      r.addEventListener("change", () => {
        const single = el.querySelector("input[name='imp-amt-type']:checked").value === "single";
        el.querySelector("#imp-single-wrap").style.display = single ? "" : "none";
        el.querySelector("#imp-split-wrap").style.display = single ? "none" : "";
        updatePreview();
      })
    );
    el.querySelectorAll("select").forEach((s) => s.addEventListener("change", updatePreview));
    updatePreview();

    el.querySelector("#imp-back").addEventListener("click", () => goStep(step1));

    el.querySelector("#imp-next").addEventListener("click", () => {
      const dateCol = parseInt(el.querySelector("#imp-date-col").value);
      const descCol = parseInt(el.querySelector("#imp-desc-col").value);
      const cfg = getAmtCfg();

      const parsed = [];
      for (const row of dataRows) {
        const date = parseDate(row[dateCol] || "");
        const desc = (row[descCol] || "").trim();
        const amount = rowAmount(row, cfg);
        if (!date || amount === null) continue;
        const matched = findMatchingPayee(desc, payees);
        const isDupe = checkIsDuplicate(date, desc, amount, existingLookup);
        parsed.push({
          date,
          description: desc,
          amount,
          matchedPayee: matched,
          payeeName: matched ? matched.name : "",
          subcategoryId: matched ? (matched.subcategoryId || null) : null,
          isNew: !matched,
          isDuplicate: isDupe,
          skip: isDupe,
        });
      }

      if (parsed.length === 0) {
        el.querySelector("#imp-map-err").textContent =
          "No valid rows found. Check column assignments above.";
        return;
      }

      goStep(() => step3(parsed));
    });
  }

  // ── Step 3: Review & Assign Payees ────────────────────────────────────────
  function step3(parsedRows) {
    const dupeCount = parsedRows.filter((r) => r.isDuplicate).length;
    const matchedCount = parsedRows.filter((r) => r.matchedPayee).length;
    const unmatchedCount = parsedRows.filter((r) => !r.matchedPayee && !r.isDuplicate).length;

    function getSubLabel(subId) {
      if (!subId) return "—";
      for (const cat of categories) {
        const sub = cat.subcategories.find((s) => s.id === subId);
        if (sub) return `${cat.name} / ${sub.name}`;
      }
      return "—";
    }

    function buildCatOpts(selId) {
      return categories
        .map((c) => `<option value="${escHtml(c.id)}" ${c.id === selId ? "selected" : ""}>${escHtml(c.name)}</option>`)
        .join("");
    }

    function buildSubOpts(catId, selId) {
      const cat = categories.find((c) => c.id === catId);
      if (!cat) return "";
      return cat.subcategories
        .map((s) => `<option value="${escHtml(s.id)}" ${s.id === selId ? "selected" : ""}>${escHtml(s.name)}</option>`)
        .join("");
    }

    function buildSubcatCell(known, subId) {
      if (known) {
        return `<span class="dim" style="font-size:0.8rem">${escHtml(getSubLabel(subId))}</span>`;
      }
      const catId = subId
        ? (categories.find((c) => c.subcategories.some((s) => s.id === subId))?.id ?? "")
        : "";
      return `
        <div style="display:flex;gap:0.3rem;align-items:center">
          <select class="form-select imp-cat-sel" style="font-size:0.8rem;">
            <option value="">— Cat —</option>
            ${buildCatOpts(catId)}
          </select>
          <select class="form-select imp-sub-sel" style="font-size:0.8rem;${!catId ? "display:none" : ""}">
            <option value="">— Sub —</option>
            ${catId ? buildSubOpts(catId, subId || "") : ""}
          </select>
        </div>`;
    }

    const dupeBadge = dupeCount > 0
      ? ` · <span style="color:var(--color-warning)">${dupeCount} duplicate${dupeCount > 1 ? "s" : ""} skipped</span>`
      : "";
    const statusBadge = unmatchedCount > 0
      ? `<span style="color:var(--color-warning)">${unmatchedCount} need payee assignment</span>`
      : `<span style="color:var(--color-success)">all payees matched ✓</span>`;

    const payeeDL = payees.map((p) => `<option value="${escHtml(p.name)}">`).join("");

    el.innerHTML = `
      <h3>Import Transactions — Step 3 of 3</h3>
      <p class="dim" style="margin-bottom:0.75rem;font-size:0.9rem;">
        ${parsedRows.length} transactions · ${matchedCount} payees matched${dupeBadge} · ${statusBadge}
      </p>
      <datalist id="imp-payee-dl">${payeeDL}</datalist>
      <div class="import-review-wrap">
        <table class="holdings-table import-review-table">
          <thead>
            <tr>
              <th style="width:2rem;text-align:center">
                <input type="checkbox" id="imp-chk-all" ${dupeCount === 0 ? "checked" : ""} title="Select / deselect all">
              </th>
              <th>Date</th>
              <th>Description</th>
              <th class="align-right">Amount</th>
              <th>Payee</th>
              <th>Category / Subcategory</th>
            </tr>
          </thead>
          <tbody id="imp-tbody"></tbody>
        </table>
      </div>
      <span class="field-error" id="imp-review-err"></span>
      <div class="form-actions">
        <button class="btn btn-secondary" id="imp-back">← Back</button>
        <button class="btn btn-primary" id="imp-import">
          Import <span id="imp-count">${parsedRows.filter((r) => !r.skip).length}</span> Transaction(s)
        </button>
      </div>
    `;

    function updateCount() {
      el.querySelector("#imp-count").textContent = parsedRows.filter((r) => !r.skip).length;
    }

    function wireSubcatSelects(tr, row) {
      const catSel = tr.querySelector(".imp-cat-sel");
      const subSel = tr.querySelector(".imp-sub-sel");
      if (!catSel || !subSel) return;
      catSel.addEventListener("change", () => {
        const catId = catSel.value;
        if (catId) {
          subSel.style.display = "";
          subSel.innerHTML = `<option value="">— Sub —</option>${buildSubOpts(catId, "")}`;
        } else {
          subSel.style.display = "none";
        }
        row.subcategoryId = null;
      });
      subSel.addEventListener("change", () => {
        row.subcategoryId = subSel.value || null;
      });
    }

    const tbody = el.querySelector("#imp-tbody");

    parsedRows.forEach((row) => {
      const tr = document.createElement("tr");
      if (row.skip) tr.classList.add("import-row-skipped");
      const amtClass = row.amount >= 0 ? "amount-charge" : "amount-payment";
      const isKnown = !!row.matchedPayee;
      const borderColor = isKnown
        ? "border-color:var(--color-success)"
        : row.payeeName
        ? "border-color:var(--color-warning)"
        : "";
      const dupeBadgeHtml = row.isDuplicate
        ? `<span class="imp-dupe-badge">Duplicate</span>`
        : "";

      tr.innerHTML = `
        <td style="text-align:center">
          <input type="checkbox" class="imp-row-chk" ${row.skip ? "" : "checked"}>
        </td>
        <td class="dim" style="white-space:nowrap;font-size:0.85rem">${escHtml(row.date)}</td>
        <td class="imp-desc-cell" title="${escHtml(row.description)}">${escHtml(row.description)}${dupeBadgeHtml}</td>
        <td class="align-right">
          <span class="${amtClass}" style="font-size:0.85rem">${escHtml(formatAmt(row.amount))}</span>
        </td>
        <td>
          <input type="text" class="imp-payee-input form-input" list="imp-payee-dl"
            value="${escHtml(row.payeeName)}" placeholder="Payee name"
            style="min-width:130px;font-size:0.85rem;${borderColor}">
        </td>
        <td class="imp-subcat-cell">${buildSubcatCell(isKnown, row.subcategoryId)}</td>
      `;

      // Payee input → live known/unknown detection
      const payeeInput = tr.querySelector(".imp-payee-input");
      payeeInput.addEventListener("input", () => {
        const name = payeeInput.value.trim();
        const match = payees.find((p) => p.name.toLowerCase() === name.toLowerCase());
        row.payeeName = name;
        const subcatCell = tr.querySelector(".imp-subcat-cell");
        if (match) {
          payeeInput.style.borderColor = "var(--color-success)";
          row.subcategoryId = match.subcategoryId || null;
          row.isNew = false;
          subcatCell.innerHTML = buildSubcatCell(true, row.subcategoryId);
        } else {
          payeeInput.style.borderColor = name ? "var(--color-warning)" : "";
          row.isNew = !!name;
          row.subcategoryId = null;
          subcatCell.innerHTML = buildSubcatCell(false, null);
          wireSubcatSelects(tr, row);
        }
      });

      // Wire cat/sub selects for rows that start as unknown
      if (!isKnown) {
        wireSubcatSelects(tr, row);
      }

      // Row checkbox
      tr.querySelector(".imp-row-chk").addEventListener("change", (e) => {
        row.skip = !e.target.checked;
        tr.classList.toggle("import-row-skipped", row.skip);
        updateCount();
      });

      tbody.appendChild(tr);
    });

    // Set select-all to indeterminate when some (not all) rows are pre-skipped as dupes
    const allChkEl = el.querySelector("#imp-chk-all");
    if (dupeCount > 0 && dupeCount < parsedRows.length) {
      allChkEl.indeterminate = true;
    }

    // Select-all checkbox
    el.querySelector("#imp-chk-all").addEventListener("change", (e) => {
      const checked = e.target.checked;
      el.querySelectorAll(".imp-row-chk").forEach((chk, i) => {
        chk.checked = checked;
        parsedRows[i].skip = !checked;
        chk.closest("tr").classList.toggle("import-row-skipped", !checked);
      });
      updateCount();
    });

    el.querySelector("#imp-back").addEventListener("click", () => goStep(step2));

    el.querySelector("#imp-import").addEventListener("click", () => {
      const errEl = el.querySelector("#imp-review-err");
      errEl.textContent = "";

      const toImport = parsedRows.filter((r) => !r.skip);
      if (toImport.length === 0) {
        errEl.textContent = "No transactions selected.";
        return;
      }
      const missing = toImport.filter((r) => !r.payeeName.trim());
      if (missing.length > 0) {
        errEl.textContent = `${missing.length} selected row(s) have no payee name. Assign a payee or deselect them.`;
        return;
      }

      // Register any new payees that have a subcategory assigned
      const knownNames = new Set(payees.map((p) => p.name.toLowerCase()));
      for (const row of toImport) {
        const key = row.payeeName.trim().toLowerCase();
        if (!knownNames.has(key) && row.subcategoryId) {
          addPayee(row.payeeName.trim(), row.subcategoryId);
          knownNames.add(key);
        }
      }

      // Batch-add all transactions in one state update
      addTransactionsBatch(
        accountId,
        toImport.map((row) => ({
          date: row.date,
          payeeName: row.payeeName.trim(),
          subcategoryId: row.subcategoryId || null,
          tag: "",
          amount: row.amount,
        }))
      );

      Modal.close();
    });
  }

  // ── Kick off ──────────────────────────────────────────────────────────────
  goStep(step1);
  Modal.open(el, null, { extraWide: true });
}
