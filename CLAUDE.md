# CLAUDE.md — Finance Tracker

Guidance for Claude Code when working in this repository.

---

## Git & Workflow

- **Commit to `master` after every completed feature.** No branches needed — commit directly and `git push origin master`.
- There are no CI checks, linters, or tests. The commit is the checkpoint.
- The current active worktree is `.claude/worktrees/brave-kirch/` — this name changes each session. The **server always serves from the main project directory** (`C:\Claude\FinanceTracker\`). Always edit files in the worktree, then `cp` them to the main project dir before testing. Never rely on worktree copies being picked up by the running server.

---

## Running the App

The app **must be served over HTTP** — ES modules refuse to load from `file://` URLs.

```bash
# From C:\Claude\FinanceTracker\
python server.py          # custom server on port 3000 (preferred)
# or
npx serve .
# or
python -m http.server 3000
```

Open `http://localhost:3000`. After editing files, a **Ctrl+Shift+R** (hard reload) is sufficient — no build step.

There are no tests, no linter, no `package.json`, and no build step of any kind.

---

## Architecture

Zero-dependency vanilla JS SPA using native ES modules (`type="module"`). No framework, no bundler.

### Entry Points
| File | Role |
|------|------|
| `index.html` | All CSS lives here in one `<style>` block; loads `src/app.js` |
| `src/app.js` | App bootstrap, shell/navigation, price-fetch orchestration |

### Navigation Model (`src/app.js`)
- Three top-level **tabs**: `finances`, `reports`, `retirement` (plus `settings`)
- Each tab has **sidebar pages** defined in `TAB_PAGES`
- View state is `{ tab, page, accountId? }` — no router library; navigation is `view = newView; render()`
- `PAGE_TO_SIDEBAR` maps content page IDs to their active sidebar entry

**Current tab/page tree:**
```
finances
  ├── summary        (Portfolio / account grid)
  ├── assets         (Assets view)
  ├── account-detail (Holdings for one account — not in sidebar)
  └── ledger-detail  (Transactions for one ledger account — not in sidebar)

reports
  ├── ytd-spending   (Monthly Spend)
  └── subcat-spend   (Subcategory Spend)

retirement
  ├── ret-inputs          (Inputs / Starting Conditions)
  ├── ret-simulation      (Simple Simulation)
  ├── ret-historic-sim    (Historic Simulation)
  └── ret-historic        (Historic Returns table)

settings  (no sidebar pages)
```

**Adding a new tab page:** update `TAB_PAGES`, `PAGE_TO_SIDEBAR`, the `render()` dispatch in `app.js`, and add any needed CSS to `index.html`.

### State Layer (`src/state.js`)
Central pub/sub store. Rules:
- Components **never write to localStorage directly** — call state functions instead.
- Every mutating function calls `saveData(_data, _profileId)` (async POST) and `notify()` (re-render).
- **Exception — retirement inputs** use a two-tier persistence strategy (see below).

Key exports:
```js
initState(data, profileId)      // called by app.js after async load
subscribe(fn)                   // returns unsubscribe fn
getAccounts() / getAccount(id)
addAccount / updateAccount / deleteAccount
addHolding / updateHolding / deleteHolding
addTransaction / updateTransaction / deleteTransaction
addCategory / updateCategory / deleteCategory
addPayee / updatePayee / deletePayee
recordAccountValue(accountId, date, value)
updateHoldingDividend(accountId, holdingId, dividendPerShare)  // lightweight; used by startup fetch
updateDividendBySymbol(symbol, dividendPerShare, dividendReinvested)  // updates all holdings of a symbol
getRetirementInputs()
saveRetirementInputs(inputs)    // updates _data + localStorage + async POST
flushRetirementInputs(inputs)   // localStorage only — safe on every keystroke
getRetirementInputsFromStorage(profileId?)
```

### Persistence Layers
| Layer | Key | When written |
|-------|-----|-------------|
| SQLite via `server.py` | `/api/data?profile=<id>` | Every mutation via `saveData()` async POST |
| localStorage (retirement inputs) | `financetracker_ret_<profileId>` | Every keystroke via `flushRetirementInputs` |
| API keys | `financetracker_apikey`, `financetracker_avkey` | Settings save |
| Active profile | `financetracker_active_profile` | Profile switch |

**`server.py` SQLite schema — `holdings` table columns:**
`id`, `account_id`, `symbol`, `shares`, `origin`, `asset_type`, `sort_order`, `dividend_per_share` (REAL), `dividend_reinvested` (INTEGER 0/1)
- `dividend_rate` column also exists as a legacy stub (unused; superseded by `dividend_per_share`)
- Schema migrations run at startup via `init_db()` using `ALTER TABLE … ADD COLUMN` wrapped in try/except — safe to re-run on existing databases.

**Retirement input load order** (in `retirementView.js → ensureLoaded()`):
1. Read `localStorage` first (always freshest — written on every keystroke)
2. Fall back to server data only if localStorage is empty
3. `beforeunload` handler writes one final sync flush

### Service Layer (`src/services/`)
| File | Purpose |
|------|---------|
| `storage.js` | REST calls to `server.py` (`/api/profiles`, `/api/data`) and localStorage helpers |
| `finnhub.js` | Fetches quotes + dividend data from `api.finnhub.io` using `window.__FINNHUB_API_KEY__` |
| `alphavantage.js` | Fallback for mutual funds (e.g. FXAIX) using `window.__AV_API_KEY__` |
| `prices.js` | Orchestrates Finnhub → Alpha Vantage fallback; returns `{ prices, quoteDetails, needsManualEntry }` |

**Price state** is local to `app.js` (not in `state.js`): `prices`, `quoteDetails`, `pricesLoading`, `pricesError`. Prices are never fetched for retirement or reports tabs.

**Dividend fetch** (`finnhub.js → fetchDividendMetric(symbol)`): called once at bootstrap via `loadDividendRates()` in `app.js`. Fetches `dividendPerShareAnnual` from Finnhub's `/stock/metric` endpoint. Only updates a holding if the API returns > 0 — never overwrites a user-set value with 0. Cash-type holdings (e.g. money market funds) are **excluded** from the startup fetch since Finnhub won't have them; users set those manually.

### Component Conventions
- Components are **plain functions**: `renderFoo(container, ...props)` — they set `container.innerHTML` or use `appendChild`.
- **Modal** (`src/components/ui/modal.js`): singleton, `Modal.open(el)` / `Modal.close()`.
- Forms open inside Modal; on submit they call state functions then `Modal.close()`.
- CSS lives entirely in `index.html`'s `<style>` block — add new classes there.
- **AbortController / signal pattern**: event listeners that need cleanup accept a `{ signal }` option to auto-remove on navigation.

### Avoiding the Slider/Focus Destruction Bug
When a UI control (slider, input) triggers a re-render, **never wipe the element's own container**. Instead:
- Build the control once in the outer render function
- Create a separate `resultsDiv` below it
- Re-render only `resultsDiv` on change events

This preserves focus so keyboard input (arrow keys, typing) keeps working after the first interaction. See `historicSimulationView.js` for the canonical example.

---

## Data Models

### Account
```js
{
  id: string,
  name: string,
  taxType: "taxable" | "tax-free" | "tax-deferred",
  accountType: "asset" | "ledger",
  openingBalance: number,       // ledger accounts only
  createdAt: ISO string,
  holdings: Holding[],          // asset accounts
  transactions: Transaction[],  // ledger accounts
  valueHistory: { date, value }[],
}
```

### Holding
```js
{
  id: string,
  symbol: string,
  shares: number,
  origin: "domestic" | "international",
  assetType: "stock-fund" | "real-estate" | "company" | "crypto" | "bonds" | "cash",
  dividendPerShare: number,   // optional — annual dividend in $/share (e.g. 2.88)
  dividendReinvested: boolean, // optional — true if DRIP; excluded from Est. Annual Income
}
```
- `cash` holdings: price is always $1/share, symbol is a display label, skipped by price APIs.
- **Cash holdings CAN have dividendPerShare** — money market funds like VMFXX and FDRXX earn yield this way.
- Mutual funds (e.g. FXAIX): fetched via Alpha Vantage since Finnhub doesn't support them.
- Dividend is stored as **$/share** (not %). The UI displays it as yield % (`dividendPerShare / price × 100`), so yield fluctuates naturally as price changes. Falls back to `$X.XX/sh` display when price unavailable.
- DRIP holdings show an amber **DRIP** badge in the Dividend column and are excluded from Est. Annual Income banners.

### Transaction (ledger accounts)
```js
{
  id: string,
  date: ISO string,
  amount: number,  // positive = income, negative = expense
  payee: string,
  categoryId: string,
  subcategory: string,
  note: string,
}
```

### Retirement Inputs (`_s` in `retirementView.js`)
```js
{
  currentAge: number,
  annualExpenses: number,
  mortgagePmt: number,       // nominal, not inflation-adjusted
  mortgageYears: number,     // years remaining; pmt added to withdrawal for first N years
  taxable: number,
  taxFree: number,
  taxDeferred: number,
  cashYears: number,
  nominalGrowth: number,     // % assumed annual return (Simple Simulation)
  inflation: number,         // % assumed inflation (Simple Simulation)
  taxRate: number,
  lumpSums: [{ age, amount }],
  annuities: [{ startAge, amount }],
  glidePath: {
    startPct: number,        // % in stocks at retirement
    endPct: number,          // % in stocks at end of transition
    transitionYears: number,
    stockColumn: string,     // key into HISTORIC_DATA row (e.g. "sp500")
    bondColumn: string,
    altColumn: string,
    altPct: number,
  },
}
```

---

## Retirement Tab — Key Files

| File | Purpose |
|------|---------|
| `retirementView.js` | Inputs form + Simple Simulation render; exports `getSimInputs()` |
| `historicSimulationView.js` | Historic Simulation tab; year slider + stacked area chart + outcome pie |
| `historicReturnsView.js` | Historic Returns table (read-only reference data) |
| `historicData.js` | Shared data module: `HISTORIC_DATA`, `COLUMNS`, `ASSET_TYPE_TO_COLUMN`, `FIRST_YEAR` (1928), `LAST_YEAR` (2025) |

### Historic Simulation Logic
- `runHistoricSimulation(s, startYear)` — runs year-by-year using actual `HISTORIC_DATA` returns and CPI; all values deflated to start-year dollars.
- Glide path: `t = min(yi / transitionYears, 1)`, `alloc = startPct + (endPct - startPct) * t`
- `categorizeAllSimulations(s)` — iterates all qualifying start years (`FIRST_YEAR` to `LAST_YEAR - (95 - currentAge)`), returns `{ insufficient, sufficient, excess, total }`.
- Outcome thresholds: Insufficient = depleted before 95; Sufficient = 0–150% of original portfolio at 95 in start-year dollars; Excess = >150%.

### `ASSET_TYPE_TO_COLUMN` mapping
```js
"stock-fund"  → "sp500"
"company"     → "sp500"
"crypto"      → "sp500"
"bonds"       → "corpBond"
"real-estate" → "realEstate"
"cash"        → "tBill"
```

---

## CSS Conventions

All styles are in `index.html`'s `<style>` block. Key namespaces:
- `.ret-*` — retirement tab shared styles (cards, headlines, charts, legends)
- `.hsim-*` — historic simulation specific (slider, top-row layout, pie chart)
- `.hist-*` — historic returns table
- `.report-*` — reports tab

Holdings / dividend-specific classes:
- `.account-total-banner` — flex row; Total Value (left) + Est. Annual Income (right)
- `.income-stat` — right-side income span inside the banner
- `.drip-badge` — amber inline badge shown in Dividend column for reinvested holdings
- `.dividend-edit-cell` — Dividend `<td>` in Assets view; pencil icon hidden until hover
- `.checkbox-label` — flex row label wrapping a checkbox + text (used in forms)

When adding a new page, add its CSS in `index.html` alongside a comment marking the section.

---

## API Keys

Stored in `localStorage`, never in code:
- Finnhub: `window.__FINNHUB_API_KEY__` (required for live prices)
- Alpha Vantage: `window.__AV_API_KEY__` (optional, mutual funds fallback)

---

## Profiles

Multiple named profiles are supported. Each profile has its own server-side JSON data file. The active profile ID is stored in `localStorage["financetracker_active_profile"]`. Retirement inputs are stored per-profile in `localStorage["financetracker_ret_<profileId>"]`.
