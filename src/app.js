import { getAccounts, getAccount, subscribe, initState } from "./state.js";
import { fetchQuotes } from "./services/prices.js";
import { loadApiKey, saveApiKey, loadAvKey, saveAvKey } from "./services/storage.js";
import {
  getStoredHandle,
  storeHandle,
  clearStoredHandle,
  requestPermission,
  readFile,
  writeFile,
  fileState,
} from "./services/fileStorage.js";
import { renderAccountList } from "./components/accounts/accountList.js";
import { renderHoldingList } from "./components/holdings/holdingList.js";

// ── View State ────────────────────────────────────────────────────────────────
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
      (accountId) => navigateTo({ page: "account-detail", accountId }),
      () => loadPrices(symbols),
      () => showApiKeyScreen(true)
    );
  } else {
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

// ── File Picker Screen ────────────────────────────────────────────────────────
function showFileError(cardEl, message) {
  let errEl = cardEl.querySelector(".file-error");
  if (!errEl) {
    errEl = document.createElement("p");
    errEl.className = "file-error field-error";
    errEl.style.cssText = "margin-top:1rem;text-align:center;";
    cardEl.appendChild(errEl);
  }
  errEl.textContent = message;
}

async function openExistingFile(cardEl) {
  try {
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
      multiple: false,
    });
    let data;
    try {
      data = await readFile(handle);
    } catch (e) {
      showFileError(cardEl, `Could not read file: ${e.message}`);
      return;
    }
    await storeHandle(handle);
    fileState.handle = handle;
    await completeBootstrap(data);
  } catch (e) {
    if (e.name === "AbortError") return;
    showFileError(cardEl, `Could not open file: ${e.message}`);
  }
}

async function createNewFile(cardEl) {
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: "finance-tracker.json",
      types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
    });
    const emptyData = { accounts: [] };
    await writeFile(handle, emptyData);
    await storeHandle(handle);
    fileState.handle = handle;
    await completeBootstrap(emptyData);
  } catch (e) {
    if (e.name === "AbortError") return;
    showFileError(cardEl, `Could not create file: ${e.message}`);
  }
}

async function showFilePickerScreen() {
  if (!window.showOpenFilePicker) {
    container.innerHTML = `
      <div class="key-screen">
        <div class="key-card">
          <h1 class="key-title">Finance Tracker</h1>
          <p class="key-subtitle" style="color:var(--color-danger)">
            This app requires a Chromium-based browser (Chrome or Edge)
            to store data in a local file.
          </p>
        </div>
      </div>`;
    return;
  }

  const storedHandle = await getStoredHandle();

  container.innerHTML = "";
  const screen = document.createElement("div");
  screen.className = "key-screen";

  if (storedHandle) {
    // Return session — offer to resume with the stored file
    const fileName = storedHandle.name || "your data file";
    screen.innerHTML = `
      <div class="key-card">
        <h1 class="key-title">Finance Tracker</h1>
        <p class="key-subtitle">Resume with your saved data file.</p>
        <div class="key-actions">
          <button class="btn btn-primary" id="file-continue">Continue with ${fileName}</button>
        </div>
        <p class="key-hint" style="margin-top:1rem">
          <a href="#" id="file-open-different" style="color:var(--color-muted);font-size:.85rem">Open a different file</a>
          &nbsp;·&nbsp;
          <a href="#" id="file-create-new" style="color:var(--color-muted);font-size:.85rem">Create new file</a>
        </p>
      </div>`;
    container.appendChild(screen);

    const card = screen.querySelector(".key-card");

    screen.querySelector("#file-continue").addEventListener("click", async () => {
      let ok;
      try {
        ok = await requestPermission(storedHandle);
      } catch {
        ok = false;
      }
      if (!ok) {
        showFileError(card, "Permission denied. Click the button to try again.");
        return;
      }
      let data;
      try {
        data = await readFile(storedHandle);
      } catch (e) {
        if (e.name === "NotFoundError" || e.name === "NotReadableError") {
          await clearStoredHandle();
          showFileError(card, "File not found — it may have been moved or deleted. Choose a different file.");
        } else {
          showFileError(card, `Could not read file: ${e.message}`);
        }
        return;
      }
      fileState.handle = storedHandle;
      await completeBootstrap(data);
    });

    screen.querySelector("#file-open-different").addEventListener("click", async (e) => {
      e.preventDefault();
      await openExistingFile(card);
    });

    screen.querySelector("#file-create-new").addEventListener("click", async (e) => {
      e.preventDefault();
      await createNewFile(card);
    });

  } else {
    // First session — let user open or create a file
    screen.innerHTML = `
      <div class="key-card">
        <h1 class="key-title">Finance Tracker</h1>
        <p class="key-subtitle">
          Your portfolio data is saved to a file on your computer —
          never uploaded anywhere.
        </p>
        <div class="key-actions">
          <button class="btn btn-secondary" id="file-open">Open existing file</button>
          <button class="btn btn-primary" id="file-create">Create new file</button>
        </div>
        <p class="key-hint">Choose where to store your data to get started.</p>
      </div>`;
    container.appendChild(screen);

    const card = screen.querySelector(".key-card");

    screen.querySelector("#file-open").addEventListener("click", async () => {
      await openExistingFile(card);
    });

    screen.querySelector("#file-create").addEventListener("click", async () => {
      await createNewFile(card);
    });
  }
}

// ── Entry Point ───────────────────────────────────────────────────────────────
(async () => {
  await showFilePickerScreen();
})();
