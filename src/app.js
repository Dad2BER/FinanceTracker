import { getAccounts, getAccount, getCategories, getPayees, subscribe, initState, recordAccountValue } from "./state.js";
import { fetchQuotes } from "./services/prices.js";
import { loadData, loadApiKey, saveApiKey, loadAvKey, saveAvKey } from "./services/storage.js";
import { showManualPriceModal } from "./components/ui/manualPriceModal.js";
import { renderAccountList } from "./components/accounts/accountList.js";
import { renderHoldingList } from "./components/holdings/holdingList.js";
import { renderTransactionList } from "./components/ledger/transactionList.js";
import { renderSettingsView } from "./components/settings/settingsView.js";
import { renderReportsView } from "./components/reports/reportsView.js";

// ── Tab / Page Definitions ─────────────────────────────────────────────────────
const TABS = [
  { id: "finances",   label: "Finances" },
  { id: "reports",    label: "Reports" },
  { id: "retirement", label: "Retirement" },
];

const TAB_PAGES = {
  finances:   [{ id: "summary",       label: "Portfolio" }],
  reports:    [{ id: "ytd-spending",  label: "Year to Date Spending" }],
  retirement: [],   // no pages yet
};

// Maps a content-page id to the sidebar entry that should appear active
const PAGE_TO_SIDEBAR = {
  "summary":        "summary",
  "account-detail": "summary",
  "ledger-detail":  "summary",
  "ytd-spending":   "ytd-spending",
};

// ── View State ────────────────────────────────────────────────────────────────
// { tab: "finances"|"reports"|"retirement"|"settings", page: string, accountId?: string }
let view = { tab: "finances", page: "summary" };
let prevNonSettingsView = null; // saved when navigating to settings

// ── Price State ───────────────────────────────────────────────────────────────
let prices = null;
let quoteDetails = {};   // { symbol: { dp, d } } — daily % and $ change
let pricesLoading = false;
let pricesError = null;

const container = document.getElementById("app");

// ── Shell State ───────────────────────────────────────────────────────────────
let shellInitialized = false;
let shellContent = null;
let shellSidebar = null;
let shellHeaderEl = null;

// ── API Key Setup ─────────────────────────────────────────────────────────────
function initApiKey() {
  const stored = loadApiKey();
  if (stored) window.__FINNHUB_API_KEY__ = stored;
  const avStored = loadAvKey();
  if (avStored) window.__AV_API_KEY__ = avStored;
}

// ── First-Run API Key Screen ──────────────────────────────────────────────────
function showApiKeyScreen() {
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
        <button class="btn btn-primary key-submit" id="key-submit">Get Started</button>
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
    // Initialize the shell and start the app
    initShell();
    render();
    loadPricesForCurrentView();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") screen.querySelector("#key-submit").click();
  });

  container.appendChild(screen);
  setTimeout(() => input.focus(), 50);
}

// ── Shell Init ────────────────────────────────────────────────────────────────
function initShell() {
  if (shellInitialized) return;
  shellInitialized = true;

  container.innerHTML = "";

  // Header
  const header = document.createElement("header");
  header.id = "shell-header";
  header.innerHTML = `
    <div class="shell-brand">Finance Tracker</div>
    <nav class="shell-tabs" id="shell-tabs">
      ${TABS.map((t) => `<button class="shell-tab" data-tab="${t.id}">${t.label}</button>`).join("")}
    </nav>
    <div class="shell-end">
      <button class="shell-icon-btn" id="shell-settings-btn" title="Settings">&#9881; Settings</button>
    </div>
  `;

  // Body
  const body = document.createElement("div");
  body.id = "shell-body";

  shellSidebar = document.createElement("nav");
  shellSidebar.id = "shell-sidebar";

  shellContent = document.createElement("main");
  shellContent.id = "shell-content";

  body.appendChild(shellSidebar);
  body.appendChild(shellContent);
  container.appendChild(header);
  container.appendChild(body);

  // Tab click handlers
  header.querySelectorAll(".shell-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      const firstPage = TAB_PAGES[tab]?.[0]?.id ?? "placeholder";
      navigateTo({ tab, page: firstPage });
    });
  });

  // Settings button — toggles in/out of settings
  header.querySelector("#shell-settings-btn").addEventListener("click", () => {
    if (view.tab === "settings") {
      navigateTo(prevNonSettingsView || { tab: "finances", page: "summary" });
    } else {
      prevNonSettingsView = { ...view };
      navigateTo({ tab: "settings", page: "settings" });
    }
  });

  shellHeaderEl = header;
}

// ── Shell Update ──────────────────────────────────────────────────────────────
function updateShell() {
  if (!shellInitialized) return;

  // Active tab highlight
  shellHeaderEl.querySelectorAll(".shell-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === view.tab);
  });

  // Settings button active state
  shellHeaderEl.querySelector("#shell-settings-btn")
    .classList.toggle("active", view.tab === "settings");

  // Sidebar pages
  const pages = TAB_PAGES[view.tab] ?? [];
  shellSidebar.innerHTML = "";
  const activeSidebarPage = PAGE_TO_SIDEBAR[view.page] ?? view.page;

  pages.forEach(({ id, label }) => {
    const item = document.createElement("button");
    item.className = "sidebar-item" + (activeSidebarPage === id ? " active" : "");
    item.textContent = label;
    item.addEventListener("click", () => {
      navigateTo({ tab: view.tab, page: id });
    });
    shellSidebar.appendChild(item);
  });

  // Hide sidebar when there are no pages (retirement, settings)
  const shellBody = container.querySelector("#shell-body");
  if (shellBody) shellBody.classList.toggle("no-sidebar", pages.length === 0);
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function render() {
  if (!shellInitialized) return;
  updateShell();

  if (view.tab === "finances") {
    if (view.page === "summary") {
      const accounts = getAccounts();
      const symbols = uniqueSymbols(accounts);
      renderAccountList(
        shellContent,
        accounts,
        prices,
        quoteDetails,
        pricesLoading,
        pricesError,
        (accountId) => {
          const account = getAccount(accountId);
          navigateTo(
            account?.accountType === "ledger"
              ? { tab: "finances", page: "ledger-detail", accountId }
              : { tab: "finances", page: "account-detail", accountId }
          );
        },
        () => loadPrices(symbols)
      );
    } else if (view.page === "account-detail") {
      const account = getAccount(view.accountId);
      if (!account) {
        navigateTo({ tab: "finances", page: "summary" });
        return;
      }
      const symbols = account.holdings
        .filter((h) => h.assetType !== "cash")
        .map((h) => h.symbol);
      renderHoldingList(
        shellContent,
        account,
        prices,
        quoteDetails,
        pricesLoading,
        pricesError,
        () => navigateTo({ tab: "finances", page: "summary" }),
        () => loadPrices(symbols)
      );
    } else if (view.page === "ledger-detail") {
      const account = getAccount(view.accountId);
      if (!account) {
        navigateTo({ tab: "finances", page: "summary" });
        return;
      }
      renderTransactionList(
        shellContent,
        account,
        getCategories(),
        getPayees(),
        () => navigateTo({ tab: "finances", page: "summary" })
      );
    }
  } else if (view.tab === "reports") {
    renderReportsView(
      shellContent,
      getAccounts(),
      getCategories(),
      () => navigateTo({ tab: "finances", page: "summary" })
    );
  } else if (view.tab === "retirement") {
    shellContent.innerHTML = `
      <div style="padding:2rem 0">
        <h2 style="margin-bottom:0.5rem">Retirement</h2>
        <p style="color:var(--color-text-dim)">Retirement planning tools are coming soon.</p>
      </div>
    `;
  } else if (view.tab === "settings") {
    renderSettingsView(
      shellContent,
      getCategories(),
      getPayees(),
      () => navigateTo(prevNonSettingsView || { tab: "finances", page: "summary" }),
      (finnhubKey, avKey) => {
        if (finnhubKey !== undefined) {
          window.__FINNHUB_API_KEY__ = finnhubKey;
          saveApiKey(finnhubKey);
        }
        if (avKey !== undefined) {
          window.__AV_API_KEY__ = avKey;
          if (avKey) saveAvKey(avKey);
        }
        // Reset price state so it reloads with new keys on next navigation
        prices = null;
        pricesLoading = false;
        pricesError = null;
      }
    );
  }
}

// ── Navigation ────────────────────────────────────────────────────────────────
function navigateTo(newView) {
  view = newView;
  prices = null;
  quoteDetails = {};
  pricesLoading = false;
  pricesError = null;
  render();
  loadPricesForCurrentView();
}

// ── Daily Value Recording ──────────────────────────────────────────────────────
function recordDailyValues() {
  if (prices === null) return;
  const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
  getAccounts().forEach((account) => {
    let value;
    if (account.accountType === "ledger") {
      value = (account.openingBalance || 0) +
        (account.transactions || []).reduce((sum, t) => sum + t.amount, 0);
    } else {
      // Only record asset accounts when all non-cash holdings have a price
      let allPriced = true;
      value = account.holdings.reduce((sum, h) => {
        if (h.assetType === "cash") return sum + h.shares;
        const p = prices[h.symbol];
        if (p === undefined) { allPriced = false; return sum; }
        return sum + p * h.shares;
      }, 0);
      if (!allPriced) return;
    }
    recordAccountValue(account.id, today, value);
  });
}

// ── Price Loading ─────────────────────────────────────────────────────────────
async function loadPrices(symbols) {
  if (!symbols || symbols.length === 0) {
    prices = {};
    pricesLoading = false;
    pricesError = null;
    render();
    recordDailyValues();
    return;
  }
  pricesLoading = true;
  pricesError = null;
  render();
  try {
    const result = await fetchQuotes(symbols);
    prices = result.prices;
    quoteDetails = result.quoteDetails ?? {};
    pricesLoading = false;
    render();
    recordDailyValues();
    if (result.needsManualEntry.length > 0) {
      showManualPriceModal(result.needsManualEntry, (entered) => {
        prices = { ...prices, ...entered };
        render();
        recordDailyValues();
      });
    }
  } catch (e) {
    pricesLoading = false;
    pricesError = e.message || "Failed to fetch prices.";
    render();
  }
}

function loadPricesForCurrentView() {
  if (view.tab === "settings" || view.tab === "retirement" || view.tab === "reports") return;
  if (view.tab === "finances") {
    if (view.page === "ledger-detail") return;
    if (view.page === "summary") {
      loadPrices(uniqueSymbols(getAccounts()));
    } else if (view.page === "account-detail") {
      const account = getAccount(view.accountId);
      if (account) {
        const symbols = account.holdings
          .filter((h) => h.assetType !== "cash")
          .map((h) => h.symbol);
        loadPrices(symbols);
      }
    }
  }
}

function uniqueSymbols(accounts) {
  return [...new Set(
    accounts.flatMap((a) =>
      a.holdings.filter((h) => h.assetType !== "cash").map((h) => h.symbol)
    )
  )];
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function completeBootstrap(data) {
  initState(data ?? { accounts: [] });
  initApiKey();
  subscribe(() => {
    if (shellInitialized) {
      render();
      if (!pricesLoading) loadPricesForCurrentView();
    }
  });
  if (!window.__FINNHUB_API_KEY__) {
    showApiKeyScreen();
  } else {
    initShell();
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
