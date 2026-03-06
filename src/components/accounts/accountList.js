import { createAccountCard } from "./accountCard.js";
import { showAccountForm } from "./accountForm.js";

/**
 * Renders the full account list view into `container`.
 */
export function renderAccountList(container, accounts, prices, pricesLoading, pricesError, onSelectAccount, onRefresh, onUpdateKey) {
  container.innerHTML = "";

  // Header
  const header = document.createElement("div");
  header.className = "view-header";
  header.innerHTML = `
    <div class="detail-title-row">
      <h1>My Accounts</h1>
      <div class="header-actions">
        <button class="btn btn-ghost btn-sm" id="refresh-btn" title="Refresh prices">&#8635; Refresh Prices</button>
        <button class="btn btn-ghost btn-sm" id="update-key-btn" title="Update API key">&#128273; API Key</button>
        <button class="btn btn-primary" id="add-account-btn">+ Add Account</button>
      </div>
    </div>
  `;
  container.appendChild(header);

  if (pricesError) {
    const errEl = document.createElement("div");
    errEl.className = "error-banner";
    errEl.textContent = `Price fetch error: ${pricesError}`;
    container.appendChild(errEl);
  }

  if (accounts.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `
      <p>No accounts yet.</p>
      <button class="btn btn-primary">+ Add Your First Account</button>
    `;
    empty.querySelector("button").addEventListener("click", () =>
      showAccountForm()
    );
    container.appendChild(empty);
  } else {
    const grid = document.createElement("div");
    grid.className = "account-grid";
    accounts.forEach((account) => {
      grid.appendChild(
        createAccountCard(account, prices, pricesLoading, onSelectAccount)
      );
    });
    container.appendChild(grid);
  }

  header.querySelector("#add-account-btn").addEventListener("click", () =>
    showAccountForm()
  );
  header.querySelector("#refresh-btn").addEventListener("click", onRefresh);
  header.querySelector("#update-key-btn").addEventListener("click", onUpdateKey);
}
