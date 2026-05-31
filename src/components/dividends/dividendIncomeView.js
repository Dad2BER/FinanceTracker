import { getDividendIncome, deleteDividendIncome } from "../../state.js";
import { formatCurrency } from "../../utils/currency.js";
import { showConfirmDialog } from "../ui/confirmDialog.js";
import { showDividendIncomeForm } from "./dividendIncomeForm.js";

// Preserved across re-renders so collapse state survives mutations.
// Holds the YEAR keys that are currently collapsed.
let _collapsedYears = new Set();

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(n) {
  return n ? formatCurrency(n) : "—";
}

// Entry point — receives accounts from app.js so it can resolve account
// names and populate the add/edit form.
export function renderDividendIncome(container, accounts) {
  container.innerHTML = "";

  const records = getDividendIncome();
  const accountName = (id) => accounts.find((a) => a.id === id)?.name || "—";

  // ── Header ─────────────────────────────────────────────────────────────────
  const header = document.createElement("div");
  header.className = "view-header";
  header.innerHTML = `
    <div class="detail-title-row">
      <h1>Dividend Income</h1>
      <div class="header-actions">
        <button class="btn btn-primary" id="add-div-btn">+ Add Income</button>
      </div>
    </div>
  `;
  container.appendChild(header);
  header.querySelector("#add-div-btn").addEventListener("click", () =>
    showDividendIncomeForm(accounts, null)
  );

  // ── Empty state ─────────────────────────────────────────────────────────────
  if (records.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `<p>No dividend income recorded yet.</p><button class="btn btn-primary">+ Add First Entry</button>`;
    empty.querySelector("button").addEventListener("click", () =>
      showDividendIncomeForm(accounts, null)
    );
    container.appendChild(empty);
    return;
  }

  // ── Group by calendar year ──────────────────────────────────────────────────
  const yearGroups = new Map();
  records.forEach((r) => {
    const year = (r.date || "").slice(0, 4) || "—";
    if (!yearGroups.has(year)) yearGroups.set(year, []);
    yearGroups.get(year).push(r);
  });
  // Years descending (newest first)
  const sortedYears = [...yearGroups.keys()].sort((a, b) => b.localeCompare(a));

  // ── Table shell ─────────────────────────────────────────────────────────────
  const wrapper = document.createElement("div");
  wrapper.className = "table-wrapper div-income-wrapper";
  const table = document.createElement("table");
  table.className = "holdings-table div-income-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Account</th>
        <th>Date</th>
        <th>Description</th>
        <th>Symbol</th>
        <th class="align-right">Amount</th>
        <th class="align-right">RoC</th>
        <th class="align-right">Cap. Gains</th>
        <th class="align-right">Income</th>
        <th class="actions-cell"></th>
      </tr>
    </thead>
  `;

  sortedYears.forEach((year) => {
    const rows = yearGroups.get(year)
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date)); // newest first within year

    const totals = rows.reduce(
      (t, r) => {
        t.amount   += r.amount   || 0;
        t.roc      += r.roc      || 0;
        t.capGains += r.capGains || 0;
        t.income   += r.income   || 0;
        return t;
      },
      { amount: 0, roc: 0, capGains: 0, income: 0 }
    );

    const collapsed = _collapsedYears.has(year);

    // Year header row (clickable to collapse/expand)
    const headBody = document.createElement("tbody");
    const headTr = document.createElement("tr");
    headTr.className = "div-year-head";
    headTr.innerHTML = `
      <td colspan="4">
        <span class="div-year-chevron">${collapsed ? "▶" : "▼"}</span>
        ${escHtml(year)}
        <span class="div-year-count">(${rows.length})</span>
      </td>
      <td class="align-right">${formatCurrency(totals.amount)}</td>
      <td class="align-right">${fmt(totals.roc)}</td>
      <td class="align-right">${fmt(totals.capGains)}</td>
      <td class="align-right">${fmt(totals.income)}</td>
      <td class="actions-cell"></td>
    `;
    headBody.appendChild(headTr);
    table.appendChild(headBody);

    // Data rows for this year
    const rowsBody = document.createElement("tbody");
    if (collapsed) rowsBody.style.display = "none";

    rows.forEach((r) => {
      const tr = document.createElement("tr");
      tr.className = "div-income-row";
      tr.innerHTML = `
        <td>${escHtml(accountName(r.accountId))}</td>
        <td>${escHtml(r.date)}</td>
        <td>${escHtml(r.description || "")}</td>
        <td class="div-symbol">${escHtml(r.symbol || "")}</td>
        <td class="align-right">${formatCurrency(r.amount)}</td>
        <td class="align-right dim">${fmt(r.roc)}</td>
        <td class="align-right dim">${fmt(r.capGains)}</td>
        <td class="align-right dim">${fmt(r.income)}</td>
        <td class="actions-cell">
          <button class="icon-btn" title="Edit">&#9998;</button>
          <button class="icon-btn icon-btn-danger" title="Delete">&#128465;</button>
        </td>
      `;
      const [editBtn, deleteBtn] = tr.querySelectorAll("button");
      editBtn.addEventListener("click", () => showDividendIncomeForm(accounts, r));
      deleteBtn.addEventListener("click", () =>
        showConfirmDialog({
          title: "Delete Dividend Income",
          message: `Delete the ${formatCurrency(r.amount)} entry from ${r.date}?`,
          onConfirm: () => deleteDividendIncome(r.id),
        })
      );
      rowsBody.appendChild(tr);
    });
    table.appendChild(rowsBody);

    // Wire collapse toggle
    headTr.addEventListener("click", () => {
      if (_collapsedYears.has(year)) {
        _collapsedYears.delete(year);
        rowsBody.style.display = "";
        headTr.querySelector(".div-year-chevron").textContent = "▼";
      } else {
        _collapsedYears.add(year);
        rowsBody.style.display = "none";
        headTr.querySelector(".div-year-chevron").textContent = "▶";
      }
    });
  });

  wrapper.appendChild(table);
  container.appendChild(wrapper);
}
