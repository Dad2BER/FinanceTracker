import { getAccounts, getAccount, getCategories, getPayees, getTags, getRocRates, getChecks, subscribe, initState, recordAccountValues } from "./state.js";
import { getCachedQuotes, staleSymbols, refreshQuotes, onPriceStatus, pendingSymbolCount } from "./services/prices.js";
import {
  loadData, loadApiKey, saveApiKey, loadAvKey, saveAvKey,
  loadProfiles, createProfile, renameProfile, deleteProfile,
  loadActiveProfileId, saveActiveProfileId,
} from "./services/storage.js";
import { showManualPriceModal } from "./components/ui/manualPriceModal.js";
import { renderAccountList } from "./components/accounts/accountList.js";
import { renderHoldingList } from "./components/holdings/holdingList.js";
import { renderTransactionList } from "./components/ledger/transactionList.js";
import { renderLedgersView } from "./components/ledger/ledgersView.js";
import {
  renderSettingsProfiles, renderSettingsAccounts, renderSettingsApiKeys,
  renderSettingsDatabase, renderSettingsCategories, renderSettingsTags,
  renderSettingsRocRates, renderSettingsCheckRegister,
} from "./components/settings/settingsView.js";
import { renderReportsView }     from "./components/reports/reportsView.js";
import { renderSubcatSpendView } from "./components/reports/subcatSpendView.js";
import { renderTagSpendView } from "./components/reports/tagSpendView.js";
import { renderTrackingView } from "./components/reports/trackingView.js";
import { renderAssetsView } from "./components/assets/assetsView.js";
import { renderDividendIncome } from "./components/dividends/dividendIncomeView.js";
import { renderRetirementInputs, renderRetirementSimulation } from "./components/retirement/retirementView.js";
import { renderHistoricReturnsView } from "./components/retirement/historicReturnsView.js";
import { renderHistoricSimulationView } from "./components/retirement/historicSimulationView.js";
import { renderMonteCarloView } from "./components/retirement/monteCarloView.js";
import { renderWithdrawalStrategiesView } from "./components/retirement/withdrawalStrategiesView.js";
import { renderBudgetEstView } from "./components/retirement/budgetEstView.js";
import { clearFilterState } from "./utils/tableFilter.js";

// ── Tab / Page Definitions ─────────────────────────────────────────────────────
const TABS = [
  { id: "finances",   label: "Accounts" },
  { id: "reports",    label: "Budget" },
  { id: "retirement", label: "Simulations" },
];

const TAB_PAGES = {
  finances:   [
    { id: "summary",    label: "Portfolio" },
    { id: "assets",     label: "Assets" },
    { id: "ledgers",    label: "Ledgers" },
    { id: "div-income", label: "Div. Income" },
  ],
  reports:    [
    { id: "ytd-spending",  label: "Monthly Spend" },
    { id: "tracking",      label: "Tracking" },
    { id: "subcat-spend",  label: "Subcategory Spend" },
    { id: "tag-spend",     label: "Tag Spend" },
    { id: "ret-budget-est",  label: "Budget Est." },
  ],
  retirement: [
    { id: "ret-inputs",      label: "Inputs" },
    { id: "ret-simulation",  label: "Simple Simulation" },
    { id: "ret-historic-sim",label: "Historic Simulation" },
    { id: "ret-monte-carlo", label: "Monte Carlo" },
    { id: "ret-strategies",  label: "Withdrawal Strategies" },
    { id: "ret-historic",    label: "Historic Returns" },
  ],
  settings:   [
    { id: "settings-profiles",   label: "Profiles" },
    { id: "settings-accounts",   label: "Accounts" },
    { id: "settings-api-keys",   label: "API Keys" },
    { id: "settings-database",   label: "Database" },
    { id: "settings-categories", label: "Categories & Payees" },
    { id: "settings-tags",       label: "Tags" },
    { id: "settings-checks",     label: "Check Register" },
    { id: "settings-roc",        label: "Return of Capital" },
  ],
};

// Maps a content-page id to the sidebar entry that should appear active
const PAGE_TO_SIDEBAR = {
  "summary":        "summary",
  "account-detail": "summary",
  "ledger-detail":  "summary",
  "assets":         "assets",
  "ledgers":        "ledgers",
  "div-income":     "div-income",
  "ytd-spending":   "ytd-spending",
  "tracking":       "tracking",
  "subcat-spend":   "subcat-spend",
  "tag-spend":      "tag-spend",
  "ret-inputs":       "ret-inputs",
  "ret-simulation":   "ret-simulation",
  "ret-historic-sim": "ret-historic-sim",
  "ret-monte-carlo":  "ret-monte-carlo",
  "ret-strategies":   "ret-strategies",
  "ret-budget-est":   "ret-budget-est",
  "ret-historic":     "ret-historic",
  "settings-profiles":   "settings-profiles",
  "settings-accounts":   "settings-accounts",
  "settings-api-keys":   "settings-api-keys",
  "settings-database":   "settings-database",
  "settings-categories": "settings-categories",
  "settings-tags":       "settings-tags",
  "settings-checks":     "settings-checks",
  "settings-roc":        "settings-roc",
};

// ── View State ────────────────────────────────────────────────────────────────
// { tab: "finances"|"reports"|"retirement"|"settings", page: string, accountId?: string }
let view = { tab: "finances", page: "summary" };
let prevNonSettingsView = null; // saved when navigating to settings

// ── Profile State ─────────────────────────────────────────────────────────────
let profiles = [];        // [{ id, name, createdAt }, ...]
let currentProfileId = null;

// ── Price State ───────────────────────────────────────────────────────────────
// prices/quoteDetails persist across navigation; they're seeded from the price
// cache and updated as refreshed quotes arrive (see loadPricesForCurrentView).
let prices = {};
let quoteDetails = {};   // { symbol: { dp, d } } — daily % and $ change
let pricesLoading = false; // derived in render(): fetching AND nothing to show yet
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
  prices = {};
  quoteDetails = {};
  pricesError = null;

  // Load the new profile's data and reinitialize state
  try {
    const data = await loadData(id);
    initState(data, id);
  } catch (e) {
    console.error("[switchProfile] failed to load data:", e);
  }
  mergeCachedPrices(uniqueSymbols(getAccounts()));

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
  end.innerHTML = `<span class="price-status" id="shell-price-status" hidden></span>` +
    `<button class="shell-icon-btn" id="shell-settings-btn" title="Settings">&#9881; Settings</button>`;
  const priceStatusEl = end.querySelector("#shell-price-status");
  onPriceStatus((n) => {
    priceStatusEl.hidden = n === 0;
    priceStatusEl.textContent = `Updating prices… ${n} left`;
  });

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
      navigateTo({ tab: "settings", page: "settings-profiles" });
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
  cancelScheduledRender();

  const viewSymbols = viewPriceSymbols() || [];
  pricesLoading = pendingSymbolCount() > 0 && viewSymbols.length > 0 &&
    viewSymbols.every((s) => prices[s] === undefined);

  if (view.tab === "finances") {
    if (view.page === "summary") {
      const accounts = getAccounts();
      const visibleAccounts = accounts.filter((a) => !a.hidden);
      renderAccountList(
        shellContent,
        visibleAccounts,
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
        () => loadPricesForCurrentView({ force: true }),
        accounts.some((a) => a.hidden)
      );
    } else if (view.page === "account-detail") {
      const account = getAccount(view.accountId);
      if (!account) {
        navigateTo({ tab: "finances", page: "summary" });
        return;
      }
      renderHoldingList(
        shellContent,
        account,
        prices,
        quoteDetails,
        pricesLoading,
        pricesError,
        () => navigateTo({ tab: "finances", page: "summary" }),
        () => loadPricesForCurrentView({ force: true })
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
    } else if (view.page === "ledgers") {
      renderLedgersView(shellContent, getAccounts(), getCategories());
    } else if (view.page === "div-income") {
      renderDividendIncome(shellContent, getAccounts(), getRocRates());
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
        getTags(),
        () => navigateTo({ tab: "finances", page: "summary" })
      );
    }
  } else if (view.tab === "reports") {
    const _reportAccounts   = getAccounts();
    const _reportCategories = getCategories();
    const _reportOnBack     = () => navigateTo({ tab: "finances", page: "summary" });
    if (view.page === "subcat-spend") {
      renderSubcatSpendView(shellContent, _reportAccounts, _reportCategories, _reportOnBack, getPayees(), getTags());
    } else if (view.page === "tracking") {
      renderTrackingView(shellContent, _reportAccounts, _reportCategories);
    } else if (view.page === "tag-spend") {
      renderTagSpendView(shellContent, _reportAccounts, _reportCategories);
    } else if (view.page === "ret-budget-est") {
      renderBudgetEstView(shellContent);
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
    if (view.page === "settings-accounts") {
      renderSettingsAccounts(shellContent, getAccounts());
    } else if (view.page === "settings-api-keys") {
      renderSettingsApiKeys(shellContent, (finnhubKey, avKey) => {
        if (finnhubKey !== undefined) {
          window.__FINNHUB_API_KEY__ = finnhubKey;
          saveApiKey(finnhubKey);
        }
        if (avKey !== undefined) {
          window.__AV_API_KEY__ = avKey;
          if (avKey) saveAvKey(avKey);
        }
        // Clear any error so prices retry with the new keys on next navigation
        pricesError = null;
      });
    } else if (view.page === "settings-database") {
      renderSettingsDatabase(shellContent);
    } else if (view.page === "settings-categories") {
      renderSettingsCategories(shellContent, getCategories(), getPayees());
    } else if (view.page === "settings-tags") {
      renderSettingsTags(shellContent, getTags());
    } else if (view.page === "settings-checks") {
      renderSettingsCheckRegister(shellContent, getAccounts(), getChecks(), getPayees());
    } else if (view.page === "settings-roc") {
      renderSettingsRocRates(shellContent, getRocRates());
    } else {
      renderSettingsProfiles(shellContent, {
        profiles,
        currentProfileId,
        onCreateProfile: async (name) => {
          const newProfile = await createProfile(name);
          profiles = [...profiles, newProfile];
          render();
          return newProfile;
        },
        onRenameProfile: async (id, name) => {
          const updated = await renameProfile(id, name);
          profiles = profiles.map((p) => p.id === id ? { ...p, name: updated.name } : p);
          render();
        },
        onDeleteProfile: async (id) => {
          await deleteProfile(id);
          profiles = profiles.filter((p) => p.id !== id);
          render();
        },
      });
    }
  }
}

// ── Navigation ────────────────────────────────────────────────────────────────
function navigateTo(newView) {
  clearFilterState(shellContent);
  view = newView;
  pricesError = null;
  render();
  loadPricesForCurrentView();
}

// ── Daily Value Recording ──────────────────────────────────────────────────────
let lastRecordedSnapshot = null; // skips re-saving an identical snapshot

function recordDailyValues() {
  const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

  // A daily snapshot is all-or-nothing. We compute every account's value first
  // and only commit if EVERY asset account is fully priced. Recording a partial
  // day (e.g. ledger balances but unpriced asset accounts) makes the net-worth
  // chart sum only the accounts present, collapsing to the negative credit-card
  // balances — the exact bug that produced the bogus -$13,842 on 2026-06-23.
  const snapshots = [];
  for (const account of getAccounts()) {
    if (account.accountType === "ledger") {
      const value = (account.openingBalance || 0) +
        (account.transactions || []).reduce((sum, t) => sum + t.amount, 0);
      snapshots.push({ id: account.id, value });
    } else {
      let allPriced = true;
      const value = account.holdings.reduce((sum, h) => {
        if (h.assetType === "cash") return sum + h.shares;
        const p = prices[h.symbol];
        if (p === undefined) { allPriced = false; return sum; }
        return sum + p * h.shares;
      }, 0);
      // If any asset account is missing a price, abort the entire snapshot.
      if (!allPriced) return;
      snapshots.push({ id: account.id, value });
    }
  }

  const entries = snapshots.map(({ id, value }) => ({ accountId: id, date: today, value }));
  const key = JSON.stringify(entries);
  if (key === lastRecordedSnapshot) return;
  lastRecordedSnapshot = key;
  recordAccountValues(entries);
}

// ── Price Loading ─────────────────────────────────────────────────────────────
// Cache-first: a view shows cached prices immediately, then only symbols whose
// cache is older than 30 minutes are re-fetched (throttled to Finnhub's rate
// limit in finnhub.js). Prices stream in and the view re-renders at most every
// few seconds — never while the user is typing in a field.
const RENDER_THROTTLE_MS = 3000;
let renderTimer = null;

function cancelScheduledRender() {
  if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
}

function userIsEditing() {
  const a = document.activeElement;
  return !!a && !!shellContent && shellContent.contains(a) &&
    /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName);
}

function scheduleRender(delay = RENDER_THROTTLE_MS) {
  if (renderTimer) return;
  renderTimer = setTimeout(() => {
    renderTimer = null;
    if (userIsEditing()) scheduleRender();
    else render();
  }, delay);
}

/** Symbols the current view prices, or null for views that show no prices. */
function viewPriceSymbols() {
  if (view.tab !== "finances") return null;
  if (view.page === "summary" || view.page === "assets") return uniqueSymbols(getAccounts());
  if (view.page === "account-detail") {
    const account = getAccount(view.accountId);
    return account
      ? [...new Set(account.holdings.filter((h) => h.assetType !== "cash").map((h) => h.symbol))]
      : null;
  }
  return null;
}

/** Copies cached prices into `prices`/`quoteDetails`. Returns true if anything changed. */
function mergeCachedPrices(symbols) {
  const cached = getCachedQuotes(symbols);
  let changed = false;
  for (const [sym, price] of Object.entries(cached.prices)) {
    if (prices[sym] !== price) { prices[sym] = price; changed = true; }
  }
  for (const [sym, detail] of Object.entries(cached.details)) {
    if (!quoteDetails[sym]) { quoteDetails[sym] = detail; changed = true; }
  }
  return changed;
}

function handleQuote(sym, price, detail) {
  prices[sym] = price;
  if (detail) quoteDetails[sym] = detail;
  else delete quoteDetails[sym];
  scheduleRender();
}

function loadPricesForCurrentView({ force = false } = {}) {
  const symbols = viewPriceSymbols();
  if (!symbols) return;
  if (mergeCachedPrices(symbols)) render();

  const mutualFunds = mutualFundSymbols();
  if (!force && staleSymbols(symbols, { mutualFunds }).length === 0) {
    recordDailyValues();
    return;
  }

  const nothingToShow = symbols.every((s) => prices[s] === undefined);
  refreshQuotes(symbols, { force, onQuote: handleQuote, mutualFunds })
    .then(({ needsManualEntry }) => {
      cancelScheduledRender();
      scheduleRender(userIsEditing() ? RENDER_THROTTLE_MS : 0);
      recordDailyValues();
      // Don't stack on top of a modal the user already has open
      if (needsManualEntry.length > 0 && !document.querySelector(".modal-backdrop")) {
        showManualPriceModal(needsManualEntry, (entered) => {
          Object.assign(prices, entered);
          recordDailyValues();
          render();
        });
      }
    })
    .catch((e) => {
      pricesError = e.message || "Failed to fetch prices.";
      render();
    });
  if (nothingToShow) render(); // show the loading state
}

/** Symbols held anywhere with instrument type "fund" — priced via Alpha Vantage. */
function mutualFundSymbols() {
  return new Set(getAccounts().flatMap((a) =>
    (a.holdings || []).filter((h) => h.instrumentType === "fund").map((h) => h.symbol)
  ));
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
  initState(data ?? { accounts: [] }, currentProfileId);
  initApiKey();
  subscribe(() => {
    if (shellInitialized) {
      render();
      loadPricesForCurrentView(); // only fetches new or stale symbols
    }
  });
  if (!window.__FINNHUB_API_KEY__) {
    showApiKeyScreen();
  } else {
    initShell();
    mergeCachedPrices(uniqueSymbols(getAccounts()));
    render();
    loadPricesForCurrentView();
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
