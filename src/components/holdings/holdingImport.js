import { Modal } from "../ui/modal.js";
import { applyHoldingsImport } from "../../state.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function parseCSV(text) {
  const rows = [];
  for (const line of text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    if (line.trim()) rows.push(parseCSVLine(line));
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
  function findFirst(...patterns) {
    for (const p of patterns) {
      const idx = h.findIndex((col) => col === p || col.includes(p));
      if (idx !== -1) return idx;
    }
    return -1;
  }
  return {
    symbolCol:   findFirst("symbol", "ticker", "cusip", "security"),
    quantityCol: findFirst("quantity", "shares", "units", "qty"),
    valueCol:    findFirst("market value", "mkt val", "total value", "value", "amount"),
  };
}

function parseNum(str) {
  if (!str || !str.trim()) return null;
  const s = str.trim().replace(/[$,\s]/g, "");
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function fmtQty(n) {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

const ORIGIN_OPTS = [
  { value: "",              label: "—" },
  { value: "domestic",     label: "Domestic" },
  { value: "international",label: "International" },
];

const ASSET_TYPE_OPTS = [
  { value: "",            label: "—" },
  { value: "stock-fund",  label: "Stock Fund" },
  { value: "real-estate", label: "Real Estate" },
  { value: "company",     label: "Company" },
  { value: "crypto",      label: "Crypto" },
  { value: "bonds",       label: "Bonds" },
  { value: "cash",        label: "Cash" },
];

function buildSelect(opts, initValue = "") {
  const sel = document.createElement("select");
  sel.className = "form-select";
  sel.style.fontSize = "0.85rem";
  opts.forEach(({ value, label }) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    if (value === initValue) opt.selected = true;
    sel.appendChild(opt);
  });
  return sel;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function showHoldingImportModal(account) {
  const el = document.createElement("div");
  el.className = "import-modal";

  let _csvRows = null;
  function goStep(fn) { el.innerHTML = ""; fn(); }

  // ── Step 1: File selection ──────────────────────────────────────────────────
  function step1() {
    el.innerHTML = `
      <h3>Import Holdings — Step 1 of 3</h3>
      <p class="dim" style="margin-bottom:1rem;font-size:0.9rem;">
        Select a CSV file from your broker containing Symbol, Quantity, and Value columns.
        Existing holdings will be compared by symbol — quantities will be updated, holdings
        absent from the file will be flagged for removal, and new symbols will be added.
      </p>
      <div class="form-group">
        <label for="hi-file">CSV File</label>
        <input type="file" id="hi-file" accept=".csv,.txt" class="form-input" style="padding:0.4rem;">
        ${_csvRows ? `<span class="dim" style="font-size:0.8rem">File already loaded — select a new file or click Next to continue.</span>` : ""}
        <span class="field-error" id="hi-file-err"></span>
      </div>
      <div class="form-actions">
        <button class="btn btn-secondary" id="hi-cancel">Cancel</button>
        <button class="btn btn-primary" id="hi-next">Next →</button>
      </div>
    `;
    el.querySelector("#hi-cancel").addEventListener("click", () => Modal.close());
    el.querySelector("#hi-next").addEventListener("click", () => {
      const file = el.querySelector("#hi-file").files[0];
      if (!file) {
        if (_csvRows) { goStep(step2); return; }
        el.querySelector("#hi-file-err").textContent = "Please select a CSV file.";
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const rows = parseCSV(e.target.result);
        if (rows.length < 2) {
          el.querySelector("#hi-file-err").textContent = "File appears empty or has only a header row.";
          return;
        }
        _csvRows = rows;
        goStep(step2);
      };
      reader.onerror = () => {
        el.querySelector("#hi-file-err").textContent = "Could not read the file.";
      };
      reader.readAsText(file);
    });
  }

  // ── Step 2: Column mapping ──────────────────────────────────────────────────
  function step2() {
    const headers = _csvRows[0];
    const dataRows = _csvRows.slice(1).filter((r) => r.some((f) => f.trim()));
    const det = autoDetectColumns(headers);

    function buildColSel(id, selectedIdx, includeNone = false) {
      const none = includeNone
        ? `<option value="-1" ${selectedIdx === -1 ? "selected" : ""}>— None —</option>`
        : "";
      const opts = headers
        .map((h, i) => `<option value="${i}" ${i === selectedIdx ? "selected" : ""}>${escHtml(h || `Column ${i + 1}`)}</option>`)
        .join("");
      return `<select id="${id}" class="form-select">${none}${opts}</select>`;
    }

    el.innerHTML = `
      <h3>Import Holdings — Step 2 of 3</h3>
      <p class="dim" style="margin-bottom:1rem;font-size:0.9rem;">
        Confirm which columns contain the symbol, quantity, and market value.
        <strong>${dataRows.length}</strong> data row(s) detected.
      </p>
      <div class="form-group">
        <label for="hi-sym-col">Symbol Column</label>
        ${buildColSel("hi-sym-col", det.symbolCol !== -1 ? det.symbolCol : 0)}
      </div>
      <div class="form-group">
        <label for="hi-qty-col">Quantity / Shares Column</label>
        ${buildColSel("hi-qty-col", det.quantityCol !== -1 ? det.quantityCol : 0, true)}
      </div>
      <div class="form-group">
        <label for="hi-val-col">Value Column
          <span style="font-weight:400;font-size:0.85em"> — used as quantity for Cash holdings when Quantity is absent</span>
        </label>
        ${buildColSel("hi-val-col", det.valueCol !== -1 ? det.valueCol : 0, true)}
      </div>
      <div class="import-preview">
        <div class="import-preview-label">Preview (first 3 rows)</div>
        <div id="hi-preview" class="import-preview-table-wrap"></div>
      </div>
      <span class="field-error" id="hi-map-err"></span>
      <div class="form-actions">
        <button class="btn btn-secondary" id="hi-back">← Back</button>
        <button class="btn btn-primary" id="hi-next">Next →</button>
      </div>
    `;

    function updatePreview() {
      const symCol = parseInt(el.querySelector("#hi-sym-col").value);
      const qtyCol = parseInt(el.querySelector("#hi-qty-col").value);
      const valCol = parseInt(el.querySelector("#hi-val-col").value);
      let html = `<table class="holdings-table"><thead><tr>
        <th>Symbol</th><th class="align-right">Quantity</th><th class="align-right">Value</th>
      </tr></thead><tbody>`;
      for (const row of dataRows.slice(0, 3)) {
        html += `<tr>
          <td>${escHtml(row[symCol] || "—")}</td>
          <td class="align-right">${escHtml(qtyCol >= 0 ? (row[qtyCol] || "—") : "—")}</td>
          <td class="align-right">${escHtml(valCol >= 0 ? (row[valCol] || "—") : "—")}</td>
        </tr>`;
      }
      html += "</tbody></table>";
      el.querySelector("#hi-preview").innerHTML = html;
    }

    el.querySelectorAll("select").forEach((s) => s.addEventListener("change", updatePreview));
    updatePreview();

    el.querySelector("#hi-back").addEventListener("click", () => goStep(step1));
    el.querySelector("#hi-next").addEventListener("click", () => {
      const symCol = parseInt(el.querySelector("#hi-sym-col").value);
      const qtyCol = parseInt(el.querySelector("#hi-qty-col").value);
      const valCol = parseInt(el.querySelector("#hi-val-col").value);

      if (isNaN(symCol) || symCol < 0) {
        el.querySelector("#hi-map-err").textContent = "Symbol column is required.";
        return;
      }

      const importRows = [];
      for (const row of dataRows) {
        const symbol = (row[symCol] || "").trim().toUpperCase();
        if (!symbol) continue;
        importRows.push({
          symbol,
          rawQty: qtyCol >= 0 ? parseNum(row[qtyCol]) : null,
          rawVal: valCol >= 0 ? parseNum(row[valCol]) : null,
        });
      }

      if (importRows.length === 0) {
        el.querySelector("#hi-map-err").textContent = "No valid symbol rows found. Check column assignments.";
        return;
      }

      goStep(() => step3(importRows));
    });
  }

  // ── Step 3: Review changes ──────────────────────────────────────────────────
  function step3(importRows) {
    const importBySymbol  = new Map(importRows.map((r) => [r.symbol, r]));
    const existingBySymbol = new Map(account.holdings.map((h) => [h.symbol.toUpperCase(), h]));

    // Effective quantity: use rawQty if present; for cash fall back to rawVal
    function effectiveQty(rawQty, rawVal, assetType) {
      if (rawQty !== null) return rawQty;
      if (assetType === "cash" && rawVal !== null) return rawVal;
      return null;
    }

    // Section 1 — quantity changes for existing holdings
    const updates = [];
    // Section 2 — existing holdings absent from import file
    const deletes = [];
    // Section 3 — new symbols in import file
    const adds = [];

    importRows.forEach((row) => {
      const existing = existingBySymbol.get(row.symbol);
      if (existing) {
        const newQty = effectiveQty(row.rawQty, row.rawVal, existing.assetType);
        if (newQty !== null && Math.abs(newQty - existing.shares) > 0.000001) {
          updates.push({
            holding: existing,
            newQty,
            fromValue: row.rawQty === null,
            skip: false,
          });
        }
        // else: no change — silently omit
      } else {
        // Brand-new symbol
        const isCashLikely = row.rawQty === null && row.rawVal !== null;
        adds.push({
          symbol:    row.symbol,
          rawQty:    row.rawQty,
          rawVal:    row.rawVal,
          origin:    "",
          assetType: isCashLikely ? "cash" : "",
          skip:      false,
        });
      }
    });

    account.holdings.forEach((h) => {
      if (!importBySymbol.has(h.symbol.toUpperCase())) {
        deletes.push({ holding: h, skip: false });
      }
    });

    const hasChanges = updates.length > 0 || deletes.length > 0 || adds.length > 0;

    // ── Header ────────────────────────────────────────────────────────────────
    const hdr = document.createElement("h3");
    hdr.textContent = "Import Holdings — Step 3 of 3";
    el.appendChild(hdr);

    const summary = document.createElement("p");
    summary.className = "dim";
    summary.style.cssText = "margin-bottom:0.75rem;font-size:0.9rem";
    summary.textContent =
      `${updates.length} quantity change${updates.length !== 1 ? "s" : ""} · ` +
      `${deletes.length} removal${deletes.length !== 1 ? "s" : ""} · ` +
      `${adds.length} new holding${adds.length !== 1 ? "s" : ""}`;
    el.appendChild(summary);

    if (!hasChanges) {
      const msg = document.createElement("p");
      msg.style.cssText = "color:var(--color-text-dim);padding:0.5rem 0";
      msg.textContent = "No changes detected — the import file matches your current holdings.";
      el.appendChild(msg);
      const acts = document.createElement("div");
      acts.className = "form-actions";
      const backBtn = document.createElement("button");
      backBtn.className = "btn btn-secondary";
      backBtn.textContent = "← Back";
      backBtn.addEventListener("click", () => goStep(step2));
      acts.appendChild(backBtn);
      el.appendChild(acts);
      return;
    }

    // ── Review table ──────────────────────────────────────────────────────────
    const wrap = document.createElement("div");
    wrap.className = "import-review-wrap";
    el.appendChild(wrap);

    const table = document.createElement("table");
    table.className = "holdings-table import-review-table";
    table.innerHTML = `
      <thead>
        <tr>
          <th style="width:2rem;text-align:center">
            <input type="checkbox" id="hi-chk-all" checked title="Select / deselect all">
          </th>
          <th>Symbol</th>
          <th class="align-right">Shares / Qty</th>
          <th>Origin</th>
          <th>Asset Type</th>
        </tr>
      </thead>
      <tbody id="hi-tbody"></tbody>
    `;
    wrap.appendChild(table);
    const tbody = table.querySelector("#hi-tbody");

    // Collect all checkboxes for select-all wiring
    const allChks = [];

    function addSectionRow(label, cssClass, count) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 5;
      td.className = `hi-section-header ${cssClass}`;
      td.textContent = label + ` (${count})`;
      tr.appendChild(td);
      tbody.appendChild(tr);
    }

    // ── Section 1: Quantity changes ───────────────────────────────────────────
    if (updates.length > 0) {
      addSectionRow("Quantity Changes", "hi-section-update", updates.length);
      updates.forEach((u) => {
        const tr = document.createElement("tr");
        tbody.appendChild(tr);

        const chkTd = document.createElement("td");
        chkTd.style.textAlign = "center";
        const chk = document.createElement("input");
        chk.type = "checkbox"; chk.checked = true;
        chk.addEventListener("change", () => { u.skip = !chk.checked; tr.classList.toggle("import-row-skipped", u.skip); updateCount(); });
        chkTd.appendChild(chk); tr.appendChild(chkTd);
        allChks.push(chk);

        const symTd = document.createElement("td"); symTd.textContent = u.holding.symbol; tr.appendChild(symTd);

        const qtyTd = document.createElement("td"); qtyTd.className = "align-right";
        qtyTd.innerHTML =
          `<span class="dim">${fmtQty(u.holding.shares)}</span> → <strong>${fmtQty(u.newQty)}</strong>` +
          (u.fromValue ? ` <span class="dim" title="Quantity taken from Value column">(val)</span>` : "");
        tr.appendChild(qtyTd);

        const originTd = document.createElement("td"); originTd.className = "dim"; originTd.style.fontSize = "0.85rem";
        originTd.textContent = u.holding.origin || "—"; tr.appendChild(originTd);

        const typeTd = document.createElement("td"); typeTd.className = "dim"; typeTd.style.fontSize = "0.85rem";
        typeTd.textContent = u.holding.assetType || "—"; tr.appendChild(typeTd);
      });
    }

    // ── Section 2: Deletions ──────────────────────────────────────────────────
    if (deletes.length > 0) {
      addSectionRow("Not in Import File — uncheck to keep", "hi-section-delete", deletes.length);
      deletes.forEach((d) => {
        const tr = document.createElement("tr");
        tr.classList.add("hi-delete-row");
        tbody.appendChild(tr);

        const chkTd = document.createElement("td"); chkTd.style.textAlign = "center";
        const chk = document.createElement("input");
        chk.type = "checkbox"; chk.checked = true;
        chk.addEventListener("change", () => { d.skip = !chk.checked; tr.classList.toggle("import-row-skipped", d.skip); updateCount(); });
        chkTd.appendChild(chk); tr.appendChild(chkTd);
        allChks.push(chk);

        const symTd = document.createElement("td"); symTd.textContent = d.holding.symbol; tr.appendChild(symTd);

        const qtyTd = document.createElement("td"); qtyTd.className = "align-right dim";
        qtyTd.textContent = fmtQty(d.holding.shares); tr.appendChild(qtyTd);

        const originTd = document.createElement("td"); originTd.className = "dim"; originTd.style.fontSize = "0.85rem";
        originTd.textContent = d.holding.origin || "—"; tr.appendChild(originTd);

        const typeTd = document.createElement("td"); typeTd.className = "dim"; typeTd.style.fontSize = "0.85rem";
        typeTd.textContent = d.holding.assetType || "—"; tr.appendChild(typeTd);
      });
    }

    // ── Section 3: New additions ──────────────────────────────────────────────
    if (adds.length > 0) {
      addSectionRow("New Holdings", "hi-section-add", adds.length);
      adds.forEach((a) => {
        const tr = document.createElement("tr");
        tbody.appendChild(tr);

        const chkTd = document.createElement("td"); chkTd.style.textAlign = "center";
        const chk = document.createElement("input");
        chk.type = "checkbox"; chk.checked = true;
        chk.addEventListener("change", () => { a.skip = !chk.checked; tr.classList.toggle("import-row-skipped", a.skip); updateCount(); });
        chkTd.appendChild(chk); tr.appendChild(chkTd);
        allChks.push(chk);

        const symTd = document.createElement("td"); symTd.textContent = a.symbol; tr.appendChild(symTd);

        // Qty cell — shows rawQty, rawVal, or "Missing" depending on data
        const qtyTd = document.createElement("td"); qtyTd.className = "align-right";
        if (a.rawQty !== null) {
          qtyTd.textContent = fmtQty(a.rawQty);
        } else if (a.rawVal !== null) {
          qtyTd.innerHTML = `${fmtQty(a.rawVal)} <span class="dim" title="No quantity column — value will be used as quantity for Cash">(val)</span>`;
        } else {
          qtyTd.innerHTML = `<span style="color:var(--color-warning)">Missing</span>`;
        }
        tr.appendChild(qtyTd);

        // Origin dropdown
        const originTd = document.createElement("td");
        const originSel = buildSelect(ORIGIN_OPTS, a.origin);
        originSel.addEventListener("change", () => { a.origin = originSel.value; });
        originTd.appendChild(originSel); tr.appendChild(originTd);

        // Asset type dropdown
        const typeTd = document.createElement("td");
        const typeSel = buildSelect(ASSET_TYPE_OPTS, a.assetType);
        typeSel.addEventListener("change", () => { a.assetType = typeSel.value; });
        typeTd.appendChild(typeSel); tr.appendChild(typeTd);
      });
    }

    // ── Select-all checkbox ───────────────────────────────────────────────────
    table.querySelector("#hi-chk-all").addEventListener("change", (e) => {
      const checked = e.target.checked;
      allChks.forEach((chk, i) => {
        chk.checked = checked;
        // find corresponding data object
        const all = [...updates, ...deletes, ...adds];
        if (all[i]) all[i].skip = !checked;
        chk.closest("tr").classList.toggle("import-row-skipped", !checked);
      });
      updateCount();
    });

    // ── Error + action buttons ────────────────────────────────────────────────
    const errEl = document.createElement("span");
    errEl.className = "field-error";
    el.appendChild(errEl);

    const applyBtn = document.createElement("button");
    applyBtn.className = "btn btn-primary";

    function updateCount() {
      const n =
        updates.filter((u) => !u.skip).length +
        deletes.filter((d) => !d.skip).length +
        adds.filter((a) => !a.skip).length;
      applyBtn.textContent = `Apply ${n} Change${n !== 1 ? "s" : ""}`;
    }
    updateCount();

    applyBtn.addEventListener("click", () => {
      errEl.textContent = "";

      // Validate new adds: must have a resolvable quantity
      const badAdds = adds.filter((a) => {
        if (a.skip) return false;
        const qty = a.rawQty !== null ? a.rawQty
          : (a.assetType === "cash" && a.rawVal !== null ? a.rawVal : null);
        return qty === null;
      });
      if (badAdds.length > 0) {
        errEl.textContent =
          `${badAdds.length} new holding(s) have no quantity. ` +
          `Select "Cash" as Asset Type to use the Value column, or uncheck to skip.`;
        return;
      }

      applyHoldingsImport(account.id, {
        updates: updates
          .filter((u) => !u.skip)
          .map((u) => ({ holdingId: u.holding.id, shares: u.newQty })),
        deletes: deletes
          .filter((d) => !d.skip)
          .map((d) => ({ holdingId: d.holding.id })),
        adds: adds
          .filter((a) => !a.skip)
          .map((a) => ({
            symbol:    a.symbol,
            shares:    a.rawQty !== null ? a.rawQty : a.rawVal,
            origin:    a.origin    || null,
            assetType: a.assetType || null,
          })),
      });

      Modal.close();
    });

    const backBtn = document.createElement("button");
    backBtn.className = "btn btn-secondary";
    backBtn.textContent = "← Back";
    backBtn.addEventListener("click", () => goStep(step2));

    const acts = document.createElement("div");
    acts.className = "form-actions";
    acts.appendChild(backBtn);
    acts.appendChild(applyBtn);
    el.appendChild(acts);
  }

  goStep(step1);
  Modal.open(el, null, { extraWide: true });
}
