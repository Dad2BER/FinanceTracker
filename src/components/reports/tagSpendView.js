import { formatCurrency } from "../../utils/currency.js";

// ── Persisted state across navigations ────────────────────────────────────────
let _collapsedYears = new Set(); // YYYY keys of collapsed year sections

// Format a cell: blank when it rounds to zero, to keep the grid readable.
function cell(v) {
  return Math.round(v * 100) === 0 ? "" : formatCurrency(v);
}

// ── Main export ───────────────────────────────────────────────────────────────
export function renderTagSpendView(container, accounts, categories) {
  container.innerHTML = "";

  // ── Header ──────────────────────────────────────────────────────────────────
  const header = document.createElement("div");
  header.className = "view-header";
  const h1 = document.createElement("h1");
  h1.textContent = "Tag Spend";
  header.appendChild(h1);
  container.appendChild(header);

  // ── Lookups ──────────────────────────────────────────────────────────────────
  const catById = new Map(categories.map(c => [c.id, c.name]));

  // ── Collect tagged transactions ──────────────────────────────────────────────
  // year → tag → category → summed (signed) amount
  const data = new Map();
  const catSet = new Set(); // categories that actually appear among tagged txs

  const ledgers = accounts.filter(a => a.accountType === "ledger");
  ledgers.forEach(acct => {
    (acct.transactions || []).forEach(tx => {
      if (tx.excluded) return;
      const tag = (tx.tag || "").trim();
      if (!tag) return;
      const year = (tx.date || "").slice(0, 4);
      if (year.length !== 4) return;
      const catName = (tx.categoryId ? catById.get(tx.categoryId) : null) || "Uncategorized";
      if (catName === "Transfer") return;

      catSet.add(catName);
      if (!data.has(year)) data.set(year, new Map());
      const tagMap = data.get(year);
      if (!tagMap.has(tag)) tagMap.set(tag, new Map());
      const catMap = tagMap.get(tag);
      // Store spend-positive: expenses (negative amounts) become positive outflow,
      // refunds/income show as negative — consistent with the other Spend reports.
      catMap.set(catName, (catMap.get(catName) || 0) - tx.amount);
    });
  });

  // ── Empty state ──────────────────────────────────────────────────────────────
  if (data.size === 0) {
    const el = document.createElement("div");
    el.className = "empty-state";
    el.innerHTML = "<p>No tagged transactions yet. Add a tag to a transaction to see it here.</p>";
    container.appendChild(el);
    return;
  }

  const cats = [...catSet].sort((a, b) => a.localeCompare(b));
  const years = [...data.keys()].sort((a, b) => b.localeCompare(a)); // newest first

  // ── Table ────────────────────────────────────────────────────────────────────
  const section = document.createElement("div");
  section.className = "report-section";

  const tableWrap = document.createElement("div");
  tableWrap.className = "tagspend-table-wrap";

  const table = document.createElement("table");
  table.className = "tagspend-table";

  // Header: Tag | <each category> | Total
  const thead = document.createElement("thead");
  const htr = document.createElement("tr");
  htr.innerHTML =
    `<th class="tagspend-tag-col">Tag</th>` +
    cats.map(c => `<th class="tagspend-amt">${c}</th>`).join("") +
    `<th class="tagspend-amt tagspend-total-col">Total</th>`;
  thead.appendChild(htr);
  table.appendChild(thead);

  const colSpanToTotal = 1 + cats.length; // Tag col + every category col

  years.forEach(year => {
    const tagMap = data.get(year);
    const collapsed = _collapsedYears.has(year);

    // Per-category year subtotals + per-tag row totals + year grand total
    const catSubtotals = new Map(cats.map(c => [c, 0]));
    let yearGrand = 0;
    tagMap.forEach(catMap => {
      catMap.forEach((v, c) => {
        catSubtotals.set(c, catSubtotals.get(c) + v);
        yearGrand += v;
      });
    });

    // ── Year header row (clickable) ────────────────────────────────────────────
    const headBody = document.createElement("tbody");
    const headTr = document.createElement("tr");
    headTr.className = "tagspend-year-head";
    headTr.innerHTML =
      `<td class="tagspend-tag-col">
         <span class="tagspend-chevron">${collapsed ? "▶" : "▼"}</span>${year}
       </td>` +
      cats.map(c => `<td class="tagspend-amt">${cell(catSubtotals.get(c))}</td>`).join("") +
      `<td class="tagspend-amt tagspend-total-col">${cell(yearGrand)}</td>`;
    headBody.appendChild(headTr);
    table.appendChild(headBody);

    // ── Tag rows ───────────────────────────────────────────────────────────────
    const rowsBody = document.createElement("tbody");
    if (collapsed) rowsBody.style.display = "none";

    const tags = [...tagMap.keys()].sort((a, b) => a.localeCompare(b));
    tags.forEach(tag => {
      const catMap = tagMap.get(tag);
      let rowTotal = 0;
      catMap.forEach(v => { rowTotal += v; });
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td class="tagspend-tag-col">${tag}</td>` +
        cats.map(c => `<td class="tagspend-amt">${cell(catMap.get(c) || 0)}</td>`).join("") +
        `<td class="tagspend-amt tagspend-total-col">${cell(rowTotal)}</td>`;
      rowsBody.appendChild(tr);
    });
    table.appendChild(rowsBody);

    // Toggle handler
    headTr.addEventListener("click", () => {
      if (_collapsedYears.has(year)) {
        _collapsedYears.delete(year);
        rowsBody.style.display = "";
        headTr.querySelector(".tagspend-chevron").textContent = "▼";
      } else {
        _collapsedYears.add(year);
        rowsBody.style.display = "none";
        headTr.querySelector(".tagspend-chevron").textContent = "▶";
      }
    });
  });

  tableWrap.appendChild(table);
  section.appendChild(tableWrap);
  container.appendChild(section);
}
