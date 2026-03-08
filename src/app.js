import { getAccounts, getAccount, getCategories, getPayees, subscribe, initState } from "./state.js";
import { fetchQuotes } from "./services/prices.js";
import { loadData, loadApiKey, saveApiKey, loadAvKey, saveAvKey } from "./services/storage.js";
import { renderAccountList } from "./components/accounts/accountList.js";
import { renderHoldingList } from "./components/holdings/holdingList.js";
import { renderTransactionList } from "./components/liability/transactionList.js";
import { renderSettingsView } from "./components/settings/settingsView.js";

// ── View State ────────────────────────────────────────────────────────────────
// { page: "accounts" }
// | { page: "account-detail", accountId: string }
// | { page: "liability-detail", accountId: string }
// | { page: "settings" }
let view = { page: "accounts" };

// ── Price State ───────────────────────────────────────────────────────────────
let prices = null;
let pricesLoading = false;
let pricesError = null;

const container = document.getElementById("app");

// ── API Key Setup ─────────────────────────────────────────────────────────────
function initApiKey() {
  const stored = loadApiKey();
  if (stored) window.__FINNHUB_API_KEY__ = stored;
  const avStored = loadAvKey();
  if (avStored) window.__AV_API_KEY__ = avStored;
}

function showApiKeyScreen(isUpdate = false) {
  container.innerHTML = "";

  const screen = document.createElement("div");
  screen.className = "key-screen";
  screen.innerHTML = `
    <div class="key-card">
      <h1 class="key-title">Finance Tracker</h1>
      <p class="key-subtitle">
        Enter your free <a href="https://finnhub.io" target="_blank" rel="noopener">Finnhub API key</a>
        to enable live stock prices. Your key is stored only in your browser.
      </p>
      <div class="form-group">
        <label for="api-key-input">Finnhub API Key</label>
        <input id="api-key-input" type="text" class="form-input key-input"
          placeholder="Paste your Finnhub key here" autocomplete="off" spellcheck="false">
        <span class="field-error" id="api-key-err"></span>
      </div>
      <div class="form-group">
        <label for="av-key-input">Alpha Vantage API Key <span style="font-weight:400;text-transform:none;letter-spacing:0">(optional — for mutual funds)</span></label>
        <input id="av-key-input" type="text" class="form-input key-input"
          placeholder="Paste your Alpha Vantage key here" autocomplete="off" spellcheck="false">
      </div>
      <div class="key-actions">
        ${isUpdate ? '<button class="btn btn-secondary" id="key-cancel">Cancel</button>' : ""}
        <button class="btn btn-primary key-submit" id="key-submit">
          ${isUpdate ? "Save Key" : "Get Started"}
        </button>
      </div>
      <p class="key-hint">
        No account needed — get a free key at
        <a href="https://finnhub.io" target="_blank" rel="noopener">finnhub.io</a>
        in under a minute.
      </p>
    </div>
  `;

  const input = screen.querySelector("#api-key-input");
  const avInput = screen.querySelector("#av-key-input");
  const errEl = screen.querySelector("#api-key-err");

  if (isUpdate) {
    input.value = window.__FINNHUB_API_KEY__ || "";
    avInput.value = window.__AV_API_KEY__ || "";
    screen.querySelector("#key-cancel").addEventListener("click", () => {
      render();
    });
  }

  screen.querySelector("#key-submit").addEventListener("click", () => {
    const key = input.value.trim();
    if (!key) {
      errEl.textContent = "Please enter an API key.";
      input.focus();
      return;
    }
    errEl.textContent = "";
    window.__FINNHUB_API_KEY__ = key;
    saveApiKey(key);
    const avKey = avInput.value.trim();
    window.__AV_API_KEY__ = avKey;
    if (avKey) saveAvKey(avKey);
    // Reset prices so they reload with the new keys
    prices = null;
    pricesLoading = false;
    pricesError = null;
    render();
    loadPricesForCurrentView();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") screen.querySelector("#key-submit").click();
  });

  container.appendChild(screen);
  setTimeout(() => input.focus(), 50);
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function render() {
  if (view.page === "accounts") {
    const accounts = getAccounts();
    const symbols = uniqueSymbols(accounts);
    renderAccountList(
      container,
      accounts,
      prices,
      pricesLoading,
      pricesError,
      (accountId) => {
        const account = getAccount(accountId);
        navigateTo(
          account?.accountType === "liability"
            ? { page: "liability-detail", accountId }
            : { page: "account-detail", accountId }
        );
      },
      () => loadPrices(symbols),
      () => showApiKeyScreen(true),
      () => navigateTo({ page: "settings" })
    );
  } else if (view.page === "account-detail") {
    const account = getAccount(view.accountId);
    if (!account) {
      navigateTo({ page: "accounts" });
      return;
    }
    const symbols = account.holdings.filter((h) => h.assetType !== "cash").map((h) => h.symbol);
    renderHoldingList(
      container,
      account,
      prices,
      pricesLoading,
      pricesError,
      () => navigateTo({ page: "accounts" }),
      () => loadPrices(symbols),
      () => showApiKeyScreen(true)
    );
  } else if (view.page === "liability-detail") {
    const account = getAccount(view.accountId);
    if (!account) {
      navigateTo({ page: "accounts" });
      return;
    }
    renderTransactionList(
      container,
      account,
      getCategories(),
      getPayees(),
      () => navigateTo({ page: "accounts" })
    );
  } else if (view.page === "settings") {
    renderSettingsView(
      container,
      getCategories(),
      getPayees(),
      () => navigateTo({ page: "accounts" })
    );
  }
}

// ── Navigation ────────────────────────────────────────────────────────────────
function navigateTo(newView) {
  view = newView;
  prices = null;
  pricesLoading = false;
  pricesError = null;
  render();
  loadPricesForCurrentView();
}

// ── Price Loading ─────────────────────────────────────────────────────────────
async function loadPrices(symbols) {
  if (!symbols || symbols.length === 0) {
    prices = {};
    pricesLoading = false;
    pricesError = null;
    render();
    return;
  }
  pricesLoading = true;
  pricesError = null;
  render();
  try {
    prices = await fetchQuotes(symbols);
    pricesLoading = false;
  } catch (e) {
    pricesLoading = false;
    pricesError = e.message || "Failed to fetch prices.";
  }
  render();
}

function loadPricesForCurrentView() {
  if (view.page === "liability-detail" || view.page === "settings") return;
  if (view.page === "accounts") {
    loadPrices(uniqueSymbols(getAccounts()));
  } else {
    const account = getAccount(view.accountId);
    if (account) loadPrices(account.holdings.map((h) => h.symbol));
  }
}

function uniqueSymbols(accounts) {
  return [...new Set(accounts.flatMap((a) => a.holdings.filter((h) => h.assetType !== "cash").map((h) => h.symbol)))];
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function completeBootstrap(data) {
  initState(data ?? { accounts: [] });
  initApiKey();
  subscribe(() => {
    render();
    if (!pricesLoading) loadPricesForCurrentView();
  });
  if (!window.__FINNHUB_API_KEY__) {
    showApiKeyScreen(false);
  } else {
    render();
    loadPricesForCurrentView();
  }
}

// ── Entry Point ───────────────────────────────────────────────────────────────
(async () => {
  let data;
  try {
    data = await loadData();
  } catch (e) {
    container.innerHTML = `
      <div class="key-screen">
        <div class="key-card">
          <h1 class="key-title">Finance Tracker</h1>
          <p class="key-subtitle" style="color:var(--color-danger)">
            Could not connect to the local server.<br>
            Make sure <code>server.py</code> is running on port 3000.
          </p>
          <p class="key-hint" style="margin-top:1rem">${e.message}</p>
        </div>
      </div>`;
    return;
  }
  await completeBootstrap(data);
})();
