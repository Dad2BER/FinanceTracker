import { formatCurrency } from "../../utils/currency.js";
import { attachTableFilter } from "../../utils/tableFilter.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveSubcategory(subcategoryId, categories) {
  if (!subcategoryId) return { categoryName: "—", subcategoryName: "—" };
  for (const cat of categories) {
    const sub = cat.subcategories.find((s) => s.id === subcategoryId);
    if (sub) return { categoryName: cat.name, subcategoryName: sub.name };
  }
  return { categoryName: "—", subcategoryName: "—" };
}

function formatAmount(amount) {
  const abs = Math.abs(amount);
  const str = formatCurrency(abs);
  return amount >= 0 ? str : `-${str}`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Main Component ────────────────────────────────────────────────────────────
// Combines the transactions of every ledger account into one read-only table.

export function renderLedgersView(container, accounts, categories) {
  container.innerHTML = "";

  const ledgers = accounts.filter((a) => a.accountType === "ledger");

  // ── Header ─────────────────────────────────────────────────────────────────
  const header = document.createElement("div");
  header.className = "view-header";
  const h1 = document.createElement("h1");
  h1.textContent = "Ledgers";
  header.appendChild(h1);
  container.appendChild(header);

  // ── Flatten every ledger's transactions ─────────────────────────────────────
  const rows = [];
  ledgers.forEach((acct) => {
    (acct.transactions || []).forEach((tx) => {
      const { categoryName, subcategoryName } = resolveSubcategory(tx.subcategoryId, categories);
      rows.push({
        ledger: acct.name,
        date: tx.date || "",
        payee: tx.payeeName || "",
        category: categoryName,
        subcategory: subcategoryName,
        tag: tx.tag || "",
        amount: tx.amount,
        excluded: !!tx.excluded,
      });
    });
  });

  // Sort by date, newest first (stable for same-day rows)
  rows.sort((a, b) => b.date.localeCompare(a.date));

  // ── Empty State ─────────────────────────────────────────────────────────────
  if (rows.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = "<p>No ledger transactions yet.</p>";
    container.appendChild(empty);
    return;
  }

  // ── Table ───────────────────────────────────────────────────────────────────
  const tableWrapper = document.createElement("div");
  tableWrapper.className = "table-wrapper";
  tableWrapper.innerHTML = `
    <table class="holdings-table">
      <thead>
        <tr>
          <th>Ledger</th>
          <th>Date</th>
          <th>Payee</th>
          <th>Category</th>
          <th>Subcategory</th>
          <th>Tag</th>
          <th class="align-right">Amount</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  `;

  const tbody = tableWrapper.querySelector("tbody");

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    if (row.excluded) tr.classList.add("tx-excluded");
    const amountClass = row.amount >= 0 ? "amount-charge" : "amount-payment";
    tr.innerHTML = `
      <td>${escHtml(row.ledger)}</td>
      <td>${escHtml(row.date)}</td>
      <td>${escHtml(row.payee)}</td>
      <td class="dim">${escHtml(row.category)}</td>
      <td class="dim">${escHtml(row.subcategory)}</td>
      <td class="dim">${escHtml(row.tag)}</td>
      <td class="align-right"><span class="${amountClass}">${formatAmount(row.amount)}</span></td>
    `;
    tbody.appendChild(tr);
  });

  // ── Per-column filters ───────────────────────────────────────────────────────
  const ledgerNames = ledgers.map((a) => a.name);
  const categoryNames = categories.map((c) => c.name);
  const allSubcatNames = categories.flatMap((c) => c.subcategories.map((s) => s.name));

  // Columns: Ledger, Date, Payee, Category, Subcategory, Tag, Amount
  // The Amount column (index 6) has no filter — its filter cell shows the
  // running total of all visible rows instead.
  attachTableFilter(
    tableWrapper.querySelector("table"),
    [
      { type: "select", options: ledgerNames },
      "daterange",
      "text",
      { type: "select", options: categoryNames },
      { type: "select", options: allSubcatNames },
      "text",
      null,
    ],
    {
      categoryCol: 3,
      subcategoryCol: 4,
      categories,
    },
    container
  );

  // ── Visible-row total in the filter row's Amount cell ────────────────────────
  // The Amount filter cell (index 6) is empty — display the sum of every visible
  // row's amount there and keep it in sync as filters change.
  const filterRow = tableWrapper.querySelector(".filter-row");
  const amountTh   = filterRow?.querySelectorAll("th")[6] ?? null;
  const sumEl      = amountTh ? document.createElement("span") : null;
  if (amountTh) {
    amountTh.classList.add("align-right");
    sumEl.className = "filter-col-sum";
    amountTh.appendChild(sumEl);
  }

  function updateVisibleTotal() {
    if (!sumEl) return;
    let sum = 0;
    tableWrapper.querySelectorAll("tbody tr").forEach((row) => {
      if (row.style.display === "none") return;
      const text = (row.querySelectorAll("td")[6]?.textContent ?? "").trim();
      const num  = parseFloat(text.replace(/[$,]/g, ""));
      if (!isNaN(num)) sum += num;
    });
    sumEl.textContent = formatAmount(sum);
  }

  // Initial total (all rows visible). The table-level listener fires after the
  // filterRow's applyFilters via event bubbling, so the total reflects the
  // post-filter visibility.
  updateVisibleTotal();
  const table = tableWrapper.querySelector("table");
  table.addEventListener("input", updateVisibleTotal);
  table.addEventListener("change", updateVisibleTotal);

  container.appendChild(tableWrapper);
}
