# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the App

No build step required, but the app **must be served over a local web server** (not opened as a `file://` URL) due to ES module restrictions.

Ensure the local web server is running before testing:

```bash
npx serve .
# or
python -m http.server
```

Then open `http://localhost:3000` (or whichever port the server reports).

There are no tests, no linter, and no package.json.

## Architecture

This is a zero-dependency, no-build vanilla JS SPA using native ES modules (`type="module"`).

**Entry points:**
- `index.html` — single file containing all CSS (via `<style>`) and loads `src/app.js`
- `src/app.js` — bootstraps the app, owns view routing and price-fetch state

**State layer (`src/state.js`):**
Central reactive store using a simple pub/sub pattern. Holds all account and holding data. Components call exported CRUD functions (`addAccount`, `updateHolding`, etc.) which mutate state, persist to localStorage, and notify all subscribers. Components never write to localStorage directly.

**Two views, managed in `app.js`:**
- `accounts` — shows the account grid
- `account-detail` — shows holdings for one account

Navigation is just `view = newView; render()` — no router library.

**Price state** is local to `app.js` (not in `state.js`). Prices are fetched from Finnhub on every navigation and stored in `prices`, `pricesLoading`, `pricesError` variables, then passed down to components as props.

**Persistence:**
- Account/holding data: `localStorage["financetracker_v1"]`
- Finnhub API key: `localStorage["financetracker_apikey"]` and `window.__FINNHUB_API_KEY__`

**Component conventions:**
- Components are plain functions that accept a container element and data, then set `container.innerHTML` or `appendChild`
- Modal (`src/components/ui/modal.js`) is a singleton with `Modal.open(el)` / `Modal.close()`
- Forms (account, holding) open inside the Modal; on submit they call state functions and `Modal.close()`

**Data model:**
```
Account { id, name, taxType ("taxable"|"tax-free"|"tax-deferred"), createdAt, holdings[] }
Holding { id, symbol, shares, origin? ("domestic"|"international"), assetType? ("stock-fund"|"real-estate"|"company"|"crypto"|"bonds"|"cash") }
```
