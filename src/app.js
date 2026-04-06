import { getAccounts, getAccount, getCategories, getPayees, subscribe, initState, recordAccountValue, updateHoldingDividend } from "./state.js";
import { fetchQuotes } from "./services/prices.js";
import { fetchDividendMetric } from "./services/finnhub.js";
import {
  loadData, loadApiKey, saveApiKey, loadAvKey, saveAvKey,
  loadProfiles, createProfile, renameProfile, deleteProfile,
  loadActiveProfileId, saveActiveProfileId,
} from "./services/storage.js";
import { showManualPriceModal } from "./components/ui/manualPriceModal.js";
import { renderAccountList } from "./components/accounts/accountList.js";
import { renderHoldingList } from "./components/holdings/holdingList.js";
import { renderTransactionList } from "./components/ledger/transactionList.js";
import { renderSettingsView } from "./components/settings/settingsView.js";
import { renderReportsView }     from "./components/reports/reportsView.js";
import { renderSubcatSpendView } from "./components/reports/subcatSpendView.js";
import { renderAssetsView } from "./components/assets/assetsView.js";
import { renderRetirementInputs, renderRetirementSimulation } from "./components/retirement/retirementView.js";
import { renderHistoricReturnsView } from "./components/retirement/historicReturnsView.js";
import { renderHistoricSimulationView } from "./components/retirement/historicSimulationView.js";
import { renderMonteCarloView } from "./components/retirement/monteCarloView.js";
import { renderWithdrawalStrategiesView } from "./components/retirement/withdrawalStrategiesView.js";

// ── Tab / Page Definitions ─────────────────────────────────────────────────────
const TABS = [
  { id: "finances",   label: "Finances" },
  { id: "reports",    label: "Reports" },
  { id: "retirement", label: "Retirement" },
];

const TAB_PAGES = {
  finances:   [
    { id: "summary", label: "Portfolio" },
    { id: "assets",  label: "Assets" },
  ],
  reports:    [
    { id: "ytd-spending",  label: "Monthly Spend" },
    { id: "subcat-spend",  label: "Subcategory Spend" },
  ],
  retirement: [
    { id: "ret-inputs",      label: "Inputs" },
    { id: "ret-simulation",  label: "Simple Simulation" },
    { id: "ret-historic-sim",label: "Historic Simulation" },
    { id: "ret-monte-carlo", label: "Monte Carlo" },
    { id: "ret-strategies",  label: "Withdrawal Strategies" },
    { id: "ret-historic",    label: "Historic Returns" },
  ],
};

// Maps a content-page id to the sidebar entry that should appear active
const PAGE_TO_SIDEBAR = {
  "summary":        "summary",
  "account-detail": "summary",
  "ledger-detail":  "summary",
  "assets":         "assets",
  "ytd-spending":   "ytd-spending",
  "subcat-spend":   "subcat-spend",
  "ret-inputs":       "ret-inputs",
  "ret-simulation":   "ret-simulation",
  "ret-historic-sim": "ret-historic-sim",
  "ret-monte-carlo":  "ret-monte-carlo",
  "ret-strategies":   "ret-strategies",
  "ret-historic":     "ret-historic",
};

// ── View State ────────────────────────────────────────────────────────────────
// { tab: "finances"|"reports"|"retirement"|"settings", page: string, accountId?: string }
let view = { tab: "finances", page: "summary" };
let prevNonSettingsView = null; // saved when navigating to settings

// ── Profile State ─────────────────────────────────────────────────────────────
let profiles = [];        // [{ id, name, createdAt }, ...]
let currentProfileId = null;

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

// ── Utility ───────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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

// ── Profile Switching ─────────────────────────────────────────────────────────
async function switchProfile(id) {
  if (id === currentProfileId) return;
  currentProfileId = id;
  saveActiveProfileId(id);

  // Reset price state
  prices = null;
  quoteDetails = {};
  pricesLoading = false;
  pricesError = null;

  // Load the new profile's data and reinitialize state
  try {
    const data = await loadData(id);
    initState(data, id);
  } catch (e) {
    console.error("[switchProfile] failed to load data:", e);
  }

  // Navigate back to the portfolio page and re-render
  view = { tab: "finances", page: "summary" };
  prevNonSettingsView = null;
  render();
  loadPricesForCurrentView();
}

// ── Profile Prompt ────────────────────────────────────────────────────────────
function showNewProfilePrompt() {
  const name = window.prompt("New profile name:");
  if (!name || !name.trim()) return;
  createProfile(name.trim()).then((newProfile) => {
    profiles = [...profiles, newProfile];
    updateShell();   // refresh dropdown with the new profile listed
  }).catch((e) => {
    alert("Failed to create profile: " + e.message);
  });
}

// ── Shell Init ────────────────────────────────────────────────────────────────
function initShell() {
  if (shellInitialized) return;
  shellInitialized = true;

  container.innerHTML = "";

  // Header
  const header = document.createElement("header");
  header.id = "shell-header";

  // Brand
  const brand = document.createElement("div");
  brand.className = "shell-brand";
  brand.textContent = "Finance Tracker";

  // Profile switcher
  const profileWrap = document.createElement("div");
  profileWrap.className = "profile-switcher-wrap";
  profileWrap.id = "shell-profile-wrap";

  const profileBtn = document.createElement("button");
  profileBtn.className = "profile-switcher";
  profileBtn.id = "shell-profile-btn";
  profileBtn.innerHTML = `<span id="shell-profile-name"></span><span class="profile-chevron">▾</span>`;

  const profileDropdown = document.createElement("div");
  profileDropdown.className = "profile-dropdown";
  profileDropdown.id = "profile-dropdown";

  profileWrap.appendChild(profileBtn);
  profileWrap.appendChild(profileDropdown);

  // Tab bar
  const tabs = document.createElement("nav");
  tabs.className = "shell-tabs";
  tabs.id = "shell-tabs";
  tabs.innerHTML = TABS.map((t) =>
    `<button class="shell-tab" data-tab="${t.id}">${t.label}</button>`
  ).join("");

  // Settings end
  const end = document.createElement("div");
  end.className = "shell-end";
  end.innerHTML = `<button class="shell-icon-btn" id="shell-settings-btn" title="Settings">&#9881; Settings</button>`;

  header.appendChild(brand);
  header.appendChild(profileWrap);
  header.appendChild(tabs);
  header.appendChild(end);

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

  // ── Tab click handlers ──────────────────────────────────────────────────────
  tabs.querySelectorAll(".shell-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      const firstPage = TAB_PAGES[tab]?.[0]?.id ?? "placeholder";
      navigateTo({ tab, page: firstPage });
    });
  });

  // ── Settings button ─────────────────────────────────────────────────────────
  header.querySelector("#shell-settings-btn").addEventListener("click", () => {
    if (view.tab === "settings") {
      navigateTo(prevNonSettingsView || { tab: "finances", page: "summary" });
    } else {
      prevNonSettingsView = { ...view };
      navigateTo({ tab: "settings", page: "settings" });
    }
  });

  // ── Profile dropdown toggle ─────────────────────────────────────────────────
  profileBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = profileDropdown.classList.toggle("open");
    if (open) {
      // Position dropdown below the button
      profileDropdown.style.minWidth = profileWrap.offsetWidth + "px";
    }
  });

  // Close dropdown when clicking anywhere outside
  document.addEventListener("click", () => {
    profileDropdown.classList.remove("open");
  });
  profileDropdown.addEventListener("click", (e) => e.stopPropagation());

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

  // Profile button label
  const currentProfile = profiles.find((p) => p.id === currentProfileId);
  const profileNameEl = shellHeaderEl.querySelector("#shell-profile-name");
  if (profileNameEl) profileNameEl.textContent = currentProfile?.name ?? "Profile";

  // Rebuild profile dropdown items
  const dropdown = shellHeaderEl.querySelector("#profile-dropdown");
  if (dropdown) {
    dropdown.innerHTML = "";

    profiles.forEach((p) => {
      const item = document.createElement("button");
      item.className = "profile-dropdown-item" + (p.id === currentProfileId ? " active" : "");
      item.innerHTML = `<span class="profile-check">${p.id === currentProfileId ? "✓" : ""}</span>${escHtml(p.name)}`;
      item.addEventListener("click", () => {
        dropdown.classList.remove("open");
        switchProfile(p.id);
      });
      dropdown.appendChild(item);
    });

    // Divider + New Profile
    const divider = document.createElement("div");
    divider.className = "profile-dropdown-divider";
    dropdown.appendChild(divider);

    const newItem = document.createElement("button");
    newItem.className = "profile-dropdown-item profile-dropdown-new";
    newItem.textContent = "+ New Profile…";
    newItem.addEventListener("click", () => {
      dropdown.classList.remove("open");
      showNewProfilePrompt();
    });
    dropdown.appendChild(newItem);
  }

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
    } else if (view.page === "assets") {
      renderAssetsView(
        shellContent,
        getAccounts(),
        prices,
        quoteDetails,
        pricesLoading,
        pricesError
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
    const _reportAccounts   = getAccounts();
    const _reportCategories = getCategories();
    const _reportOnBack     = () => navigateTo({ tab: "finances", page: "summary" });
    if (view.page === "subcat-spend") {
      renderSubcatSpendView(shellContent, _reportAccounts, _reportCategories, _reportOnBack, getPayees());
    } else {
      renderReportsView(shellContent, _reportAccounts, _reportCategories, _reportOnBack);
    }
  } else if (view.tab === "retirement") {
    if (view.page === "ret-simulation") {
      renderRetirementSimulation(shellContent);
    } else if (view.page === "ret-historic-sim") {
      renderHistoricSimulationView(shellContent);
    } else if (view.page === "ret-monte-carlo") {
      renderMonteCarloView(shellContent);
    } else if (view.page === "ret-strategies") {
      renderWithdrawalStrategiesView(shellContent);
    } else if (view.page === "ret-historic") {
      renderHistoricReturnsView(shellContent);
    } else {
      renderRetirementInputs(shellContent,
        () => navigateTo({ tab: "retirement", page: "ret-simulation" }));
    }
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
      },
      // Profile props passed to settings view
      {
        profiles,
        currentProfileId,
        onCreateProfile: async (name) => {
          const newProfile = await createProfile(name);
          profiles = [...profiles, newProfile];
          updateShell();
          return newProfile;
        },
        onRenameProfile: async (id, name) => {
          const updated = await renameProfile(id, name);
          profiles = profiles.map((p) => p.id === id ? { ...p, name: updated.name } : p);
          updateShell();
        },
        onDeleteProfile: async (id) => {
          await deleteProfile(id);
          profiles = profiles.filter((p) => p.id !== id);
          updateShell();
        },
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
    if (view.page === "summary" || view.page === "assets") {
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

// ── Dividend Rate Fetch ────────────────────────────────────────────────────────
async function loadDividendRates() {
  const accounts = getAccounts().filter((a) => a.accountType === "asset");
  // Collect all non-cash holdings across all asset accounts
  const allHoldings = accounts.flatMap((a) =>
    (a.holdings || [])
      .filter((h) => h.assetType !== "cash")
      .map((h) => ({ accountId: a.id, holding: h }))
  );
  // Fetch dividend rate per unique symbol, then apply to all matching holdings
  const symbols = [...new Set(allHoldings.map((x) => x.holding.symbol))];
  const rateMap = {};
  await Promise.all(symbols.map(async (sym) => {
    rateMap[sym] = await fetchDividendMetric(sym);
  }));
  for (const { accountId, holding } of allHoldings) {
    const rate = rateMap[holding.symbol];
    // Only update if API returned a non-zero rate
    if (rate > 0) {
      updateHoldingDividend(accountId, holding.id, rate);
    }
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function completeBootstrap(data) {
  initState(data ?? { accounts: [] }, currentProfileId);
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
    loadDividendRates();
  }
}

// ── Entry Point ───────────────────────────────────────────────────────────────
(async () => {
  // ── Step 1: Load profile list ───────────────────────────────────────────────
  try {
    profiles = await loadProfiles();
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

  // ── Step 2: Determine active profile ────────────────────────────────────────
  const savedId = loadActiveProfileId();
  const savedProfile = profiles.find((p) => p.id === savedId);
  currentProfileId = savedProfile ? savedProfile.id : profiles[0]?.id;
  if (currentProfileId) saveActiveProfileId(currentProfileId);

  // ── Step 3: Load data for the active profile ─────────────────────────────────
  let data;
  try {
    data = await loadData(currentProfileId);
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
