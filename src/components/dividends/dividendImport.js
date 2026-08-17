import { Modal } from "../ui/modal.js";
import { addDividendIncomeBatch } from "../../state.js";
import { parseCSV } from "../../utils/csv.js";
import { formatCurrency } from "../../utils/currency.js";

// ── Utilities ─────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// eTrade/Schwab both use "--" as a "no value" placeholder for Symbol/Cusip etc.
function stripPlaceholder(str) {
  const t = (str || "").trim();
  return t === "--" ? "" : t;
}

function parseAmount(str) {
  if (!str) return null;
  const s = str.trim().replace(/[$,\s]/g, "");
  if (!s) return null;
  const num = parseFloat(s);
  return isNaN(num) ? null : num;
}

// Tolerates a trailing "as of MM/DD/YYYY" suffix some institutions append.
function parseMDY(str) {
  if (!str) return null;
  const m = str.trim().match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function findHeaderRow(rows, requiredHeaders) {
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].map((c) => c.trim().toLowerCase());
    if (requiredHeaders.every((h) => cells.includes(h))) return i;
  }
  return -1;
}

function colIndex(headerRow, name) {
  return headerRow.findIndex((c) => c.trim().toLowerCase() === name);
}

// ── Institution-specific parsers ────────────────────────────────────────────
// Each returns { rows: [{date, symbol, description, amount}] } or { error }.
// Only actual dividend / interest-income rows are returned — buys, sells,
// reinvestment-purchase rows, and transfers are filtered out here.

function parseSchwabCsv(rawRows) {
  const headerIdx = findHeaderRow(rawRows, ["date", "action", "amount"]);
  if (headerIdx === -1) {
    return { error: 'Could not find the Schwab header row (expected columns like "Date", "Action", "Amount").' };
  }
  const header = rawRows[headerIdx];
  const dateCol   = colIndex(header, "date");
  const actionCol = colIndex(header, "action");
  const symbolCol = colIndex(header, "symbol");
  const descCol   = colIndex(header, "description");
  const amountCol = colIndex(header, "amount");

  const rows = [];
  for (const row of rawRows.slice(headerIdx + 1)) {
    const action = (row[actionCol] || "").trim().toLowerCase();
    if (!(action.includes("dividend") || action === "credit interest")) continue;

    const date   = parseMDY(row[dateCol] || "");
    const amount = parseAmount(row[amountCol] || "");
    if (!date || amount === null || amount <= 0) continue;

    rows.push({
      date,
      symbol:      stripPlaceholder(row[symbolCol]).toUpperCase(),
      description: stripPlaceholder(row[descCol]),
      amount,
    });
  }
  return { rows };
}

function parseEtradeCsv(rawRows) {
  const headerIdx = findHeaderRow(rawRows, ["activity/trade date", "activity type", "amount $"]);
  if (headerIdx === -1) {
    return { error: 'Could not find the E*TRADE header row (expected columns like "Activity/Trade Date", "Activity Type", "Amount $").' };
  }
  const header = rawRows[headerIdx];
  const dateCol   = colIndex(header, "activity/trade date");
  const typeCol   = colIndex(header, "activity type");
  const symbolCol = colIndex(header, "symbol");
  const descCol   = colIndex(header, "description");
  const amountCol = colIndex(header, "amount $");

  const rows = [];
  for (const row of rawRows.slice(headerIdx + 1)) {
    const type = (row[typeCol] || "").trim().toLowerCase();
    if (!(type === "dividend" || type === "interest income")) continue;

    const date   = parseMDY(row[dateCol] || "");
    const amount = parseAmount(row[amountCol] || "");
    // eTrade labels both the dividend payment AND its reinvestment purchase as
    // "Dividend" — the purchase side is the negative-amount row. Amount > 0
    // keeps only the actual income side.
    if (!date || amount === null || amount <= 0) continue;

    rows.push({
      date,
      symbol:      stripPlaceholder(row[symbolCol]).toUpperCase(),
      description: stripPlaceholder(row[descCol]),
      amount,
    });
  }
  return { rows };
}

const INSTITUTIONS = {
  etrade: { label: "E*TRADE", parse: parseEtradeCsv },
  schwab: { label: "Charles Schwab", parse: parseSchwabCsv },
};

// ── Duplicate Detection ────────────────────────────────────────────────────────
// Unique on (institution, date, symbol, amount). Existing records without an
// institution (manual entries, or entries predating this feature) never match,
// since imported rows always carry a real institution value.

function dupKey(institution, date, symbol, amount) {
  return `${institution}||${date}||${(symbol || "").toUpperCase()}||${amount.toFixed(2)}`;
}

function buildExistingKeys(existingRecords) {
  const set = new Set();
  for (const r of existingRecords) {
    if (!r.institution) continue;
    set.add(dupKey(r.institution, r.date, r.symbol, r.amount || 0));
  }
  return set;
}

// ── Main Export ───────────────────────────────────────────────────────────────

export function showDividendImportModal(accounts, existingRecords = []) {
  const el = document.createElement("div");
  el.className = "import-modal";

  // Persist across step nav so Back from step 2 can reuse the parsed file
  let _rawRows = null;
  let _institutionKey = "";
  let _accountId = "";

  function goStep(fn) {
    el.innerHTML = "";
    fn();
  }

  // ── Step 1: Institution + Account + File ────────────────────────────────
  function step1() {
    const institutionOptions = Object.entries(INSTITUTIONS)
      .map(([key, cfg]) => `<option value="${key}" ${key === _institutionKey ? "selected" : ""}>${escHtml(cfg.label)}</option>`)
      .join("");
    const accountOptions = accounts
      .map((a) => `<option value="${escHtml(a.id)}" ${a.id === _accountId ? "selected" : ""}>${escHtml(a.name)}</option>`)
      .join("");

    el.innerHTML = `
      <h3>Import Dividend Income — Step 1 of 2</h3>
      <p class="dim" style="margin-bottom:1rem;font-size:0.9rem;">
        Select the financial institution the file was exported from, which account it belongs to, and the file itself.
        Only dividend and interest income rows are imported — buys, sells, reinvestment purchases, and transfers are skipped automatically.
      </p>
      <div class="form-group">
        <label for="div-imp-institution">Financial Institution</label>
        <select id="div-imp-institution" class="form-select">
          <option value="">— Select institution —</option>
          ${institutionOptions}
        </select>
        <span class="field-error" id="div-imp-institution-err"></span>
      </div>
      <div class="form-group">
        <label for="div-imp-account">Account</label>
        <select id="div-imp-account" class="form-select">
          <option value="">— Select account —</option>
          ${accountOptions}
        </select>
        <span class="field-error" id="div-imp-account-err"></span>
      </div>
      <div class="form-group">
        <label for="div-imp-file">File</label>
        <input type="file" id="div-imp-file" accept=".csv,.txt" class="form-input" style="padding:0.4rem;">
        ${_rawRows ? `<span class="dim" style="font-size:0.8rem">A file is already loaded — select a new file to replace it, or click Next to continue.</span>` : ""}
        <span class="field-error" id="div-imp-file-err"></span>
      </div>
      <div class="form-actions">
        <button class="btn btn-secondary" id="div-imp-cancel">Cancel</button>
        <button class="btn btn-primary" id="div-imp-next">Next →</button>
      </div>
    `;

    el.querySelector("#div-imp-cancel").addEventListener("click", () => Modal.close());

    el.querySelector("#div-imp-next").addEventListener("click", () => {
      const institutionKey = el.querySelector("#div-imp-institution").value;
      const accountId      = el.querySelector("#div-imp-account").value;
      const file            = el.querySelector("#div-imp-file").files[0];

      el.querySelector("#div-imp-institution-err").textContent = "";
      el.querySelector("#div-imp-account-err").textContent = "";
      el.querySelector("#div-imp-file-err").textContent = "";

      let valid = true;
      if (!institutionKey) {
        el.querySelector("#div-imp-institution-err").textContent = "Select a financial institution.";
        valid = false;
      }
      if (!accountId) {
        el.querySelector("#div-imp-account-err").textContent = "Select an account.";
        valid = false;
      }
      if (!file && !_rawRows) {
        el.querySelector("#div-imp-file-err").textContent = "Select a file.";
        valid = false;
      }
      if (!valid) return;

      _institutionKey = institutionKey;
      _accountId = accountId;

      function proceedWithRows(rawRows) {
        _rawRows = rawRows;
        const result = INSTITUTIONS[institutionKey].parse(rawRows);
        if (result.error) {
          el.querySelector("#div-imp-file-err").textContent = result.error;
          return;
        }
        if (result.rows.length === 0) {
          el.querySelector("#div-imp-file-err").textContent = "No dividend or interest income transactions were found in this file.";
          return;
        }
        goStep(() => step2(institutionKey, accountId, result.rows));
      }

      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => proceedWithRows(parseCSV(e.target.result));
        reader.onerror = () => {
          el.querySelector("#div-imp-file-err").textContent = "Could not read the file.";
        };
        reader.readAsText(file);
      } else {
        proceedWithRows(_rawRows);
      }
    });
  }

  // ── Step 2: Review & Import ──────────────────────────────────────────────
  function step2(institutionKey, accountId, parsedRows) {
    const existingKeys = buildExistingKeys(existingRecords);
    const rows = parsedRows.map((r) => {
      const isDuplicate = existingKeys.has(dupKey(institutionKey, r.date, r.symbol, r.amount));
      return { ...r, isDuplicate, skip: isDuplicate };
    });

    const dupeCount = rows.filter((r) => r.isDuplicate).length;
    const dupeBadge = dupeCount > 0
      ? ` · <span style="color:var(--color-warning)">${dupeCount} duplicate${dupeCount > 1 ? "s" : ""} skipped</span>`
      : "";

    el.innerHTML = `
      <h3>Import Dividend Income — Step 2 of 2</h3>
      <p class="dim" style="margin-bottom:0.75rem;font-size:0.9rem;">
        ${rows.length} transaction(s) found${dupeBadge}
      </p>
      <div class="import-review-wrap">
        <table class="holdings-table import-review-table">
          <thead>
            <tr>
              <th style="width:2rem;text-align:center">
                <input type="checkbox" id="div-imp-chk-all" ${dupeCount === 0 ? "checked" : ""} title="Select / deselect all">
              </th>
              <th>Date</th>
              <th>Symbol</th>
              <th>Description</th>
              <th class="align-right">Amount</th>
            </tr>
          </thead>
          <tbody id="div-imp-tbody"></tbody>
        </table>
      </div>
      <span class="field-error" id="div-imp-review-err"></span>
      <div class="form-actions">
        <button class="btn btn-secondary" id="div-imp-back">← Back</button>
        <button class="btn btn-primary" id="div-imp-import">
          Import <span id="div-imp-count">${rows.filter((r) => !r.skip).length}</span> Transaction(s)
        </button>
      </div>
    `;

    function updateCount() {
      el.querySelector("#div-imp-count").textContent = rows.filter((r) => !r.skip).length;
    }

    const tbody = el.querySelector("#div-imp-tbody");
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      if (row.skip) tr.classList.add("import-row-skipped");
      const dupeBadgeHtml = row.isDuplicate ? `<span class="imp-dupe-badge">Duplicate</span>` : "";

      tr.innerHTML = `
        <td style="text-align:center"><input type="checkbox" class="div-imp-row-chk" ${row.skip ? "" : "checked"}></td>
        <td class="dim" style="white-space:nowrap;font-size:0.85rem">${escHtml(row.date)}</td>
        <td style="font-weight:600">${escHtml(row.symbol || "—")}</td>
        <td class="imp-desc-cell" title="${escHtml(row.description)}">${escHtml(row.description)}${dupeBadgeHtml}</td>
        <td class="align-right">${escHtml(formatCurrency(row.amount))}</td>
      `;

      tr.querySelector(".div-imp-row-chk").addEventListener("change", (e) => {
        row.skip = !e.target.checked;
        tr.classList.toggle("import-row-skipped", row.skip);
        updateCount();
      });

      tbody.appendChild(tr);
    });

    const allChkEl = el.querySelector("#div-imp-chk-all");
    if (dupeCount > 0 && dupeCount < rows.length) {
      allChkEl.indeterminate = true;
    }
    allChkEl.addEventListener("change", (e) => {
      const checked = e.target.checked;
      el.querySelectorAll(".div-imp-row-chk").forEach((chk, i) => {
        chk.checked = checked;
        rows[i].skip = !checked;
        chk.closest("tr").classList.toggle("import-row-skipped", !checked);
      });
      updateCount();
    });

    el.querySelector("#div-imp-back").addEventListener("click", () => goStep(step1));

    el.querySelector("#div-imp-import").addEventListener("click", () => {
      const toImport = rows.filter((r) => !r.skip);
      if (toImport.length === 0) {
        el.querySelector("#div-imp-review-err").textContent = "No transactions selected.";
        return;
      }

      addDividendIncomeBatch(
        toImport.map((r) => ({
          accountId,
          date:        r.date,
          description: r.description,
          symbol:      r.symbol,
          amount:      r.amount,
          institution: institutionKey,
        }))
      );

      Modal.close();
    });
  }

  goStep(step1);
  Modal.open(el, null, { extraWide: true });
}
