import { deleteTransaction } from "../../state.js";
import { showConfirmDialog } from "../ui/confirmDialog.js";
import { showTransactionForm } from "./transactionForm.js";
import { showImportModal } from "./transactionImport.js";
import { formatCurrency } from "../../utils/currency.js";
import { showAccountForm } from "../accounts/accountForm.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveSubcategory(subcategoryId, categories) {
  if (!subcategoryId) return { categoryName: "—", subcategoryName: "—" };
  for (const cat of categories) {
    const sub = cat.subcategories.find((s) => s.id === subcategoryId);
    if (sub) return { categoryName: cat.name, subcategoryName: sub.name };
  }
  return { categoryName: "—", subcategoryName: "—" };
}

function computeRunningBalances(transactions) {
  // Sort by date ascending (stable — preserves insertion order for same-day)
  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
  let running = 0;
  return sorted.map((tx) => {
    running += tx.amount;
    return { ...tx, runningBalance: running };
  });
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

export function renderTransactionList(container, account, categories, payees, onBack) {
  container.innerHTML = "";

  const transactions = account.transactions || [];

  // ── Header ─────────────────────────────────────────────────────────────────
  const header = document.createElement("div");
  header.className = "view-header";
  header.innerHTML = `
    <div class="back-row">
      <button class="btn btn-ghost btn-sm" id="back-btn">&#8592; Back</button>
    </div>
    <div class="detail-title-row">
      <div>
        <h1>${escHtml(account.name)}</h1>
      </div>
      <div class="header-actions">
        <button class="btn btn-ghost btn-sm" id="edit-account-btn" title="Edit account">&#9881; Edit</button>
        <button class="btn btn-ghost btn-sm" id="import-tx-btn">&#8679; Import</button>
        <button class="btn btn-primary" id="add-tx-btn">+ Add Transaction</button>
      </div>
    </div>
  `;
  container.appendChild(header);

  header.querySelector("#back-btn").addEventListener("click", onBack);
  header.querySelector("#edit-account-btn").addEventListener("click", () => showAccountForm(account));
  header.querySelector("#import-tx-btn").addEventListener("click", () =>
    showImportModal(account.id, categories, payees)
  );
  header.querySelector("#add-tx-btn").addEventListener("click", () =>
    showTransactionForm(account.id, categories, payees, null)
  );

  // ── Balance Banner ──────────────────────────────────────────────────────────
  const totalBalance = transactions.reduce((sum, t) => sum + t.amount, 0);
  const banner = document.createElement("div");
  banner.className = `balance-banner ${totalBalance < 0 ? "balance-owed" : "balance-clear"}`;
  if (totalBalance > 0) {
    banner.textContent = `Credit balance: ${formatCurrency(totalBalance)}`;
  } else if (totalBalance < 0) {
    banner.textContent = `Balance owed: ${formatCurrency(Math.abs(totalBalance))}`;
  } else {
    banner.textContent = "Paid in full";
  }
  container.appendChild(banner);

  // ── Empty State ─────────────────────────────────────────────────────────────
  if (transactions.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `<p>No transactions yet.</p><button class="btn btn-primary">+ Add First Transaction</button>`;
    empty.querySelector("button").addEventListener("click", () =>
      showTransactionForm(account.id, categories, payees, null)
    );
    container.appendChild(empty);
    return;
  }

  // ── Transactions Table ──────────────────────────────────────────────────────
  const withBalances = computeRunningBalances(transactions);
  // Display newest first
  const displayRows = [...withBalances].reverse();

  const tableWrapper = document.createElement("div");
  tableWrapper.className = "table-wrapper";
  tableWrapper.innerHTML = `
    <table class="holdings-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Payee</th>
          <th>Category</th>
          <th>Subcategory</th>
          <th>Tag</th>
          <th class="align-right">Amount</th>
          <th class="align-right">Balance</th>
          <th class="actions-cell"></th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  `;

  const tbody = tableWrapper.querySelector("tbody");

  displayRows.forEach((tx) => {
    const { categoryName, subcategoryName } = resolveSubcategory(tx.subcategoryId, categories);
    const tr = document.createElement("tr");

    const amountClass = tx.amount >= 0 ? "amount-charge" : "amount-payment";

    tr.innerHTML = `
      <td>${escHtml(tx.date)}</td>
      <td>${escHtml(tx.payeeName)}</td>
      <td class="dim">${escHtml(categoryName)}</td>
      <td class="dim">${escHtml(subcategoryName)}</td>
      <td class="dim">${escHtml(tx.tag || "")}</td>
      <td class="align-right"><span class="${amountClass}">${formatAmount(tx.amount)}</span></td>
      <td class="align-right dim">${formatCurrency(tx.runningBalance)}</td>
      <td class="actions-cell">
        <button class="icon-btn" title="Edit">&#9998;</button>
        <button class="icon-btn icon-btn-danger" title="Delete">&#128465;</button>
      </td>
    `;

    const [editBtn, deleteBtn] = tr.querySelectorAll("button");
    editBtn.addEventListener("click", () =>
      showTransactionForm(account.id, categories, payees, tx)
    );
    deleteBtn.addEventListener("click", () =>
      showConfirmDialog({
        title: "Delete Transaction",
        message: `Delete the transaction "${tx.payeeName}" for ${formatAmount(tx.amount)}?`,
        onConfirm: () => deleteTransaction(account.id, tx.id),
      })
    );

    tbody.appendChild(tr);
  });

  container.appendChild(tableWrapper);
}
