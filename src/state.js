import { saveData } from "./services/storage.js";
import { generateId } from "./utils/uuid.js";

// Central reactive state — initialized by app.js via initState() after async load
let _data = { accounts: [], categories: [], payees: [] };
let _profileId = null;  // set by initState; passed to saveData on every mutation

const RET_INPUTS_PREFIX    = "financetracker_ret_";
const BUDGET_EST_PREFIX    = "financetracker_budget_est_";

export function initState(data, profileId) {
  _profileId = profileId;
  _data = {
    accounts:          Array.isArray(data?.accounts)   ? data.accounts   : [],
    categories:        Array.isArray(data?.categories) ? data.categories : [],
    payees:            Array.isArray(data?.payees)     ? data.payees     : [],
    tags:              Array.isArray(data?.tags)       ? data.tags       : [],
    dividendIncome:    Array.isArray(data?.dividendIncome) ? data.dividendIncome : [],
    rocRates:          Array.isArray(data?.rocRates)    ? data.rocRates   : [],
    checks:            Array.isArray(data?.checks)      ? data.checks     : [],
    retirementInputs:  data?.retirementInputs  ?? null,
    budgetEstInputs:   data?.budgetEstInputs   ?? null,
  };
}
let _listeners = [];

function notify() {
  _listeners.forEach((fn) => fn());
}

export function subscribe(fn) {
  _listeners.push(fn);
  return () => {
    _listeners = _listeners.filter((l) => l !== fn);
  };
}

// ── Retirement Inputs ─────────────────────────────────────────────────────────

export function getRetirementInputs() {
  return _data.retirementInputs ?? null;
}

// Writes inputs to localStorage only — synchronous and cheap enough to call on
// every keystroke.  Does NOT update _data or trigger a server POST.
export function flushRetirementInputs(inputs) {
  try {
    if (_profileId) {
      window.localStorage.setItem(RET_INPUTS_PREFIX + _profileId, JSON.stringify(inputs));
    }
  } catch (e) { /* quota exceeded or private mode — ignore */ }
}

export function saveRetirementInputs(inputs) {
  _data = { ..._data, retirementInputs: inputs };
  flushRetirementInputs(inputs);   // synchronous localStorage write
  saveData(_data, _profileId);     // async server POST (may be cancelled on unload)
}

export function getRetirementInputsFromStorage(profileId) {
  const id = profileId || _profileId;
  if (!id) return null;
  try {
    const raw = window.localStorage.getItem(RET_INPUTS_PREFIX + id);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// ── Budget Estimator Inputs ───────────────────────────────────────────────────

export function getBudgetEstInputs() {
  return _data.budgetEstInputs ?? null;
}

export function flushBudgetEstInputs(inputs) {
  try {
    if (_profileId) {
      window.localStorage.setItem(BUDGET_EST_PREFIX + _profileId, JSON.stringify(inputs));
    }
  } catch (e) { /* quota or private mode */ }
}

export function saveBudgetEstInputs(inputs) {
  _data = { ..._data, budgetEstInputs: inputs };
  flushBudgetEstInputs(inputs);
  saveData(_data, _profileId);
}

export function getBudgetEstInputsFromStorage() {
  if (!_profileId) return null;
  try {
    const raw = window.localStorage.getItem(BUDGET_EST_PREFIX + _profileId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// ── Account Getters ───────────────────────────────────────────────────────────

export function getAccounts() {
  return _data.accounts;
}

export function getAccount(id) {
  return _data.accounts.find((a) => a.id === id) || null;
}

// ── Account CRUD ──────────────────────────────────────────────────────────────

export function addAccount(name, taxType, accountType = "asset", openingBalance = 0) {
  const account = {
    id: generateId(),
    name: name.trim(),
    taxType,
    accountType,
    openingBalance: parseFloat(openingBalance) || 0,
    createdAt: new Date().toISOString(),
    holdings: [],
    transactions: [],
    valueHistory: [],
  };
  _data = { ..._data, accounts: [..._data.accounts, account] };
  saveData(_data, _profileId);
  notify();
  return account;
}

export function updateAccount(id, name, taxType, accountType = "asset", openingBalance = 0) {
  _data = {
    ..._data,
    accounts: _data.accounts.map((a) =>
      a.id === id ? { ...a, name: name.trim(), taxType, accountType, openingBalance: parseFloat(openingBalance) || 0 } : a
    ),
  };
  saveData(_data, _profileId);
  notify();
}

export function deleteAccount(id) {
  _data = { ..._data, accounts: _data.accounts.filter((a) => a.id !== id) };
  saveData(_data, _profileId);
  notify();
}

// Toggles whether an account is hidden from the Portfolio page. Hidden accounts
// keep all their data (holdings, transactions, history) and remain fully visible
// everywhere else — used to retire closed accounts without losing their history.
export function toggleAccountHidden(id) {
  _data = {
    ..._data,
    accounts: _data.accounts.map((a) =>
      a.id === id ? { ...a, hidden: !a.hidden } : a
    ),
  };
  saveData(_data, _profileId);
  notify();
}

// Tags an account with which financial institution it belongs to (e.g.
// "etrade" / "schwab" — see src/constants/institutions.js). Used to narrow
// the account dropdown on the Div. Income importer. Pass "" to clear it.
export function setAccountInstitution(id, institution) {
  _data = {
    ..._data,
    accounts: _data.accounts.map((a) =>
      a.id === id ? { ...a, institution: institution || "" } : a
    ),
  };
  saveData(_data, _profileId);
  notify();
}

// ── Value History ─────────────────────────────────────────────────────────────

/**
 * Upserts daily value snapshots for one or more accounts in a single save.
 * Each POST to /api/data fully replaces the profile's stored data, and the
 * server handles requests concurrently — firing one saveData() per account
 * (as this used to do via a per-account call) sends several overlapping
 * full-state writes whose completion order isn't guaranteed, so a
 * still-in-flight earlier (less complete) request can land last and wipe
 * out later accounts' updates. Batching into one call/one save avoids that
 * race entirely.
 *
 * Intentionally does NOT call notify() — recording history must not
 * trigger re-renders or it would create an infinite loop.
 */
export function recordAccountValues(entries) {
  // entries: [{ accountId, date, value }]
  const byAccount = new Map(entries.map((e) => [e.accountId, e]));
  _data = {
    ..._data,
    accounts: _data.accounts.map((a) => {
      const entry = byAccount.get(a.id);
      if (!entry) return a;
      const history = a.valueHistory || [];
      const idx = history.findIndex((e) => e.date === entry.date);
      const newEntry = { date: entry.date, value: entry.value };
      const newHistory = idx >= 0
        ? history.map((e, i) => (i === idx ? newEntry : e))
        : [...history, newEntry];
      return { ...a, valueHistory: newHistory };
    }),
  };
  saveData(_data, _profileId);
}

export function getAccountValueHistory(accountId) {
  return _data.accounts.find((a) => a.id === accountId)?.valueHistory ?? [];
}

// ── Holding CRUD ──────────────────────────────────────────────────────────────

export function addHolding(accountId, symbol, shares, origin, assetType, instrumentType, dividendPerShare, dividendReinvested) {
  const holding = {
    id: generateId(),
    symbol: symbol.trim().toUpperCase(),
    shares: parseFloat(shares),
    ...(origin ? { origin } : {}),
    ...(assetType ? { assetType } : {}),
    ...(instrumentType ? { instrumentType } : {}),
    ...(dividendPerShare != null && dividendPerShare !== '' ? { dividendPerShare: parseFloat(dividendPerShare) } : {}),
    ...(dividendReinvested ? { dividendReinvested: true } : {}),
  };
  _data = {
    ..._data,
    accounts: _data.accounts.map((a) =>
      a.id === accountId
        ? { ...a, holdings: [...a.holdings, holding] }
        : a
    ),
  };
  saveData(_data, _profileId);
  notify();
  return holding;
}

export function updateHolding(accountId, holdingId, symbol, shares, origin, assetType, instrumentType, dividendPerShare, dividendReinvested) {
  _data = {
    ..._data,
    accounts: _data.accounts.map((a) => {
      if (a.id !== accountId) return a;
      return {
        ...a,
        holdings: a.holdings.map((h) => {
          if (h.id !== holdingId) return h;
          const updated = { ...h, symbol: symbol.trim().toUpperCase(), shares: parseFloat(shares) };
          if (origin) updated.origin = origin; else delete updated.origin;
          if (assetType) updated.assetType = assetType; else delete updated.assetType;
          if (instrumentType) updated.instrumentType = instrumentType; else delete updated.instrumentType;
          if (dividendPerShare != null && dividendPerShare !== '') updated.dividendPerShare = parseFloat(dividendPerShare);
          else delete updated.dividendPerShare;
          if (dividendReinvested) updated.dividendReinvested = true; else delete updated.dividendReinvested;
          return updated;
        }),
      };
    }),
  };
  saveData(_data, _profileId);
  notify();
}

export function updateHoldingDividend(accountId, holdingId, dividendPerShare) {
  _data = {
    ..._data,
    accounts: _data.accounts.map((a) => {
      if (a.id !== accountId) return a;
      return {
        ...a,
        holdings: a.holdings.map((h) => {
          if (h.id !== holdingId) return h;
          return { ...h, dividendPerShare };
        }),
      };
    }),
  };
  saveData(_data, _profileId);
  notify();
}

export function updateDividendBySymbol(symbol, dividendPerShare, dividendReinvested) {
  _data = {
    ..._data,
    accounts: _data.accounts.map((a) => ({
      ...a,
      holdings: a.holdings.map((h) => {
        if (h.symbol !== symbol) return h;
        const updated = { ...h, dividendPerShare };
        if (dividendReinvested) updated.dividendReinvested = true; else delete updated.dividendReinvested;
        return updated;
      }),
    })),
  };
  saveData(_data, _profileId);
  notify();
}

export function deleteHolding(accountId, holdingId) {
  _data = {
    ..._data,
    accounts: _data.accounts.map((a) => {
      if (a.id !== accountId) return a;
      return { ...a, holdings: a.holdings.filter((h) => h.id !== holdingId) };
    }),
  };
  saveData(_data, _profileId);
  notify();
}

// Applies all three kinds of holding changes in one atomic state mutation.
// updates: [{ holdingId, shares }]
// deletes: [{ holdingId }]
// adds:    [{ symbol, shares, origin, assetType, instrumentType }]
export function applyHoldingsImport(accountId, { updates = [], deletes = [], adds = [] }) {
  const deleteIds = new Set(deletes.map((d) => d.holdingId));
  const updateMap = new Map(updates.map((u) => [u.holdingId, u.shares]));
  _data = {
    ..._data,
    accounts: _data.accounts.map((a) => {
      if (a.id !== accountId) return a;
      let holdings = (a.holdings || [])
        .filter((h) => !deleteIds.has(h.id))
        .map((h) => updateMap.has(h.id) ? { ...h, shares: updateMap.get(h.id) } : h);
      adds.forEach(({ symbol, shares, origin, assetType, instrumentType }) => {
        const h = { id: generateId(), symbol: symbol.trim().toUpperCase(), shares: parseFloat(shares) };
        if (origin)         h.origin         = origin;
        if (assetType)      h.assetType      = assetType;
        if (instrumentType) h.instrumentType = instrumentType;
        holdings.push(h);
      });
      return { ...a, holdings };
    }),
  };
  saveData(_data, _profileId);
  notify();
}

// ── Transaction CRUD ──────────────────────────────────────────────────────────

export function addTransaction(accountId, { date, payeeName, subcategoryId, tag, amount, checkId }) {
  const tx = {
    id: generateId(),
    date,
    payeeName,
    amount: parseFloat(amount),
    ...(subcategoryId ? { subcategoryId } : {}),
    ...(tag ? { tag } : {}),
    ...(checkId ? { checkId } : {}),
  };
  // Resolve categoryId from subcategoryId
  if (subcategoryId) {
    const cat = _data.categories.find((c) =>
      c.subcategories.some((s) => s.id === subcategoryId)
    );
    if (cat) tx.categoryId = cat.id;
  }
  let accounts = _data.accounts.map((a) =>
    a.id === accountId
      ? { ...a, transactions: [...(a.transactions || []), tx] }
      : a
  );
  if (checkId) accounts = unlinkCheckElsewhere(accounts, checkId, tx.id);
  _data = { ..._data, accounts: linkUnmatchedChecks(accounts, _data.checks).accounts };
  saveData(_data, _profileId);
  notify();
  return tx;
}

// `checkId`: undefined leaves the transaction's check link untouched, null/""
// unlinks it, and an id links it (moving the link off any other transaction —
// a check-register row maps to at most one transaction).
export function updateTransaction(accountId, txId, { date, payeeName, subcategoryId, tag, amount, checkId }) {
  _data = {
    ..._data,
    accounts: _data.accounts.map((a) => {
      if (a.id !== accountId) return a;
      return {
        ...a,
        transactions: (a.transactions || []).map((t) => {
          if (t.id !== txId) return t;
          const updated = {
            ...t,
            date,
            payeeName,
            amount: parseFloat(amount),
          };
          if (subcategoryId) {
            updated.subcategoryId = subcategoryId;
            const cat = _data.categories.find((c) =>
              c.subcategories.some((s) => s.id === subcategoryId)
            );
            if (cat) updated.categoryId = cat.id;
            else delete updated.categoryId;
          } else {
            delete updated.subcategoryId;
            delete updated.categoryId;
          }
          if (tag) updated.tag = tag; else delete updated.tag;
          if (checkId !== undefined) {
            if (checkId) updated.checkId = checkId; else delete updated.checkId;
          }
          return updated;
        }),
      };
    }),
  };
  if (checkId) _data = { ..._data, accounts: unlinkCheckElsewhere(_data.accounts, checkId, txId) };
  saveData(_data, _profileId);
  notify();
}

export function addTransactionsBatch(accountId, txDataArray) {
  const newTxs = txDataArray.map(({ date, payeeName, subcategoryId, tag, amount }) => {
    const tx = {
      id: generateId(),
      date,
      payeeName,
      amount: parseFloat(amount),
      ...(subcategoryId ? { subcategoryId } : {}),
      ...(tag ? { tag } : {}),
    };
    if (subcategoryId) {
      const cat = _data.categories.find((c) =>
        c.subcategories.some((s) => s.id === subcategoryId)
      );
      if (cat) tx.categoryId = cat.id;
    }
    return tx;
  });
  const accounts = _data.accounts.map((a) =>
    a.id === accountId
      ? { ...a, transactions: [...(a.transactions || []), ...newTxs] }
      : a
  );
  _data = { ..._data, accounts: linkUnmatchedChecks(accounts, _data.checks).accounts };
  saveData(_data, _profileId);
  notify();
  return newTxs;
}

export function toggleTransactionExcluded(accountId, txId) {
  _data = {
    ..._data,
    accounts: _data.accounts.map((a) => {
      if (a.id !== accountId) return a;
      return {
        ...a,
        transactions: (a.transactions || []).map((t) =>
          t.id === txId ? { ...t, excluded: !t.excluded } : t
        ),
      };
    }),
  };
  saveData(_data, _profileId);
  notify();
}

export function deleteTransaction(accountId, txId) {
  _data = {
    ..._data,
    accounts: _data.accounts.map((a) => {
      if (a.id !== accountId) return a;
      return { ...a, transactions: (a.transactions || []).filter((t) => t.id !== txId) };
    }),
  };
  saveData(_data, _profileId);
  notify();
}

// ── Dividend Income CRUD ──────────────────────────────────────────────────────

export function getDividendIncome() {
  return _data.dividendIncome || [];
}

function normalizeDivRecord({ accountId, date, description, symbol, amount }) {
  return {
    accountId:   accountId || null,
    date,
    description: (description || "").trim(),
    symbol:      (symbol || "").trim().toUpperCase(),
    amount:      parseFloat(amount) || 0,
  };
}

export function addDividendIncome(record) {
  const rec = { id: generateId(), ...normalizeDivRecord(record) };
  _data = { ..._data, dividendIncome: [...(_data.dividendIncome || []), rec] };
  saveData(_data, _profileId);
  notify();
  return rec;
}

// Batch add for CSV import — one state update / save for the whole file instead
// of one per row. `institution` (set by the importer, e.g. "etrade"/"schwab")
// is kept separate from normalizeDivRecord so it's never touched by the manual
// add/edit form, which has no institution field.
export function addDividendIncomeBatch(records) {
  const newRecs = records.map((r) => ({
    id: generateId(),
    ...normalizeDivRecord(r),
    ...(r.institution ? { institution: r.institution } : {}),
  }));
  _data = { ..._data, dividendIncome: [...(_data.dividendIncome || []), ...newRecs] };
  saveData(_data, _profileId);
  notify();
  return newRecs;
}

export function updateDividendIncome(id, record) {
  _data = {
    ..._data,
    dividendIncome: (_data.dividendIncome || []).map((r) =>
      r.id === id ? { ...r, ...normalizeDivRecord(record) } : r
    ),
  };
  saveData(_data, _profileId);
  notify();
}

export function deleteDividendIncome(id) {
  _data = {
    ..._data,
    dividendIncome: (_data.dividendIncome || []).filter((r) => r.id !== id),
  };
  saveData(_data, _profileId);
  notify();
}

// ── Return of Capital Rates ─────────────────────────────────────────────────
// One rate per (year, symbol): the % of that symbol's dividend to treat as
// return of capital in that year. Looked up by Div. Income at render time
// instead of being entered per-transaction.

export function getRocRates() {
  return _data.rocRates || [];
}

export function addRocRate(year, symbol, pct) {
  const rate = {
    id:     generateId(),
    year:   String(year).trim(),
    symbol: symbol.trim().toUpperCase(),
    pct:    parseFloat(pct) || 0,
  };
  _data = { ..._data, rocRates: [...(_data.rocRates || []), rate] };
  saveData(_data, _profileId);
  notify();
  return rate;
}

export function updateRocRate(id, symbol, pct) {
  _data = {
    ..._data,
    rocRates: (_data.rocRates || []).map((r) =>
      r.id === id ? { ...r, symbol: symbol.trim().toUpperCase(), pct: parseFloat(pct) || 0 } : r
    ),
  };
  saveData(_data, _profileId);
  notify();
}

export function deleteRocRate(id) {
  _data = {
    ..._data,
    rocRates: (_data.rocRates || []).filter((r) => r.id !== id),
  };
  saveData(_data, _profileId);
  notify();
}

// ── Check Register ─────────────────────────────────────────────────────────
// Maps a checking account's check numbers to the merchant actually paid. The
// link lives on the transaction (`tx.checkId` → check.id) so the bank's raw
// payee text ("Check 1003", "Draft 3047", "3055") is kept as-is, and display /
// grouping code swaps in the merchant via resolvePayeeName().

export function getChecks() {
  return _data.checks || [];
}

function normCheckNo(n) {
  return String(n ?? "").trim().replace(/^0+(?=\d)/, "");
}

// Pulls a check number out of a bank's payee text — "Check 1003", "CHK #1003",
// "Draft 3047", or a bare "3055". Returns null for anything else.
export function extractCheckNumber(payeeName) {
  const m = /^\s*(?:check|chk|ck|draft)?\s*(?:no\.?|#)?\s*(\d{3,})\s*$/i.exec(payeeName || "");
  return m ? normCheckNo(m[1]) : null;
}

function checkMatchesTx(check, tx) {
  return extractCheckNumber(tx.payeeName) === normCheckNo(check.checkNumber);
}

// Links every not-yet-linked check to the first unlinked transaction in its
// account whose payee text carries the same check number. Pure — returns new
// accounts + match count.
function linkUnmatchedChecks(accounts, checks) {
  const linked = new Set();
  accounts.forEach((a) => (a.transactions || []).forEach((t) => { if (t.checkId) linked.add(t.checkId); }));
  const pending = (checks || []).filter((c) => !linked.has(c.id));
  if (pending.length === 0) return { accounts, count: 0 };

  let count = 0;
  const next = accounts.map((a) => {
    const mine = pending.filter((c) => c.accountId === a.id);
    if (mine.length === 0 || !a.transactions?.length) return a;
    let changed = false;
    const transactions = a.transactions.map((t) => {
      if (t.checkId || mine.length === 0) return t;
      const idx = mine.findIndex((c) => checkMatchesTx(c, t));
      if (idx < 0) return t;
      const [check] = mine.splice(idx, 1);
      changed = true;
      count++;
      return { ...t, checkId: check.id };
    });
    return changed ? { ...a, transactions } : a;
  });
  return { accounts: next, count };
}

// Clears `checkId` from every transaction except `keepTxId`.
function unlinkCheckElsewhere(accounts, checkId, keepTxId = null) {
  return accounts.map((a) => {
    if (!(a.transactions || []).some((t) => t.checkId === checkId && t.id !== keepTxId)) return a;
    return {
      ...a,
      transactions: a.transactions.map((t) => {
        if (t.checkId !== checkId || t.id === keepTxId) return t;
        const { checkId: _drop, ...rest } = t;
        return rest;
      }),
    };
  });
}

// No amount on the check itself — the register shows the linked
// transaction's amount, so there's only one source of truth for it.
function normalizeCheck({ accountId, checkNumber, merchant }) {
  return {
    accountId,
    checkNumber: String(checkNumber ?? "").trim(),
    merchant:    (merchant || "").trim(),
  };
}

export function addCheck(record) {
  const check = { id: generateId(), ...normalizeCheck(record) };
  const checks = [...getChecks(), check];
  _data = { ..._data, checks, accounts: linkUnmatchedChecks(_data.accounts, checks).accounts };
  saveData(_data, _profileId);
  notify();
  return check;
}

export function updateCheck(id, record) {
  const old = getChecks().find((c) => c.id === id);
  const updated = { id, ...normalizeCheck(record) };
  const checks = getChecks().map((c) => (c.id === id ? updated : c));
  // A changed account or check # means the linked transaction is probably the
  // wrong one — drop the link so auto-match can re-find it. A merchant-only
  // edit keeps the link (including one made by hand in the transaction form).
  let accounts = _data.accounts;
  if (old && (old.accountId !== updated.accountId ||
      normCheckNo(old.checkNumber) !== normCheckNo(updated.checkNumber))) {
    accounts = unlinkCheckElsewhere(accounts, id);
  }
  _data = { ..._data, checks, accounts: linkUnmatchedChecks(accounts, checks).accounts };
  saveData(_data, _profileId);
  notify();
}

export function deleteCheck(id) {
  _data = {
    ..._data,
    checks: getChecks().filter((c) => c.id !== id),
    accounts: unlinkCheckElsewhere(_data.accounts, id),
  };
  saveData(_data, _profileId);
  notify();
}

// Re-runs auto-matching across every account; returns how many were linked.
export function autoLinkChecks() {
  const { accounts, count } = linkUnmatchedChecks(_data.accounts, _data.checks);
  if (count > 0) {
    _data = { ..._data, accounts };
    saveData(_data, _profileId);
  }
  notify();
  return count;
}

let _checkMapSrc = null;
let _checkMap = new Map();
export function getCheckForTransaction(tx) {
  if (!tx?.checkId) return null;
  if (_checkMapSrc !== _data.checks) {
    _checkMapSrc = _data.checks;
    _checkMap = new Map(getChecks().map((c) => [c.id, c]));
  }
  return _checkMap.get(tx.checkId) || null;
}

// The human-readable payee for a transaction: the check register's merchant
// when the transaction is linked to a check, otherwise the bank's payee text.
export function resolvePayeeName(tx) {
  return getCheckForTransaction(tx)?.merchant || tx?.payeeName || "";
}

// ── Category Getters ──────────────────────────────────────────────────────────

export function getCategories() {
  return _data.categories;
}

// ── Category CRUD ─────────────────────────────────────────────────────────────

export function addCategory(name) {
  const category = { id: generateId(), name: name.trim(), subcategories: [] };
  _data = { ..._data, categories: [..._data.categories, category] };
  saveData(_data, _profileId);
  notify();
  return category;
}

export function updateCategory(id, name) {
  _data = {
    ..._data,
    categories: _data.categories.map((c) =>
      c.id === id ? { ...c, name: name.trim() } : c
    ),
  };
  saveData(_data, _profileId);
  notify();
}

export function deleteCategory(id) {
  // Collect subcategory IDs belonging to this category
  const cat = _data.categories.find((c) => c.id === id);
  const subIds = new Set((cat?.subcategories || []).map((s) => s.id));

  // Remove payees mapped to any of those subcategories
  const newPayees = _data.payees.filter((p) => !subIds.has(p.subcategoryId));

  _data = {
    ..._data,
    categories: _data.categories.filter((c) => c.id !== id),
    payees: newPayees,
  };
  saveData(_data, _profileId);
  notify();
}

export function addSubcategory(categoryId, name) {
  const sub = { id: generateId(), name: name.trim() };
  _data = {
    ..._data,
    categories: _data.categories.map((c) =>
      c.id === categoryId
        ? { ...c, subcategories: [...c.subcategories, sub] }
        : c
    ),
  };
  saveData(_data, _profileId);
  notify();
  return sub;
}

export function updateSubcategory(categoryId, subcategoryId, name) {
  _data = {
    ..._data,
    categories: _data.categories.map((c) => {
      if (c.id !== categoryId) return c;
      return {
        ...c,
        subcategories: c.subcategories.map((s) =>
          s.id === subcategoryId ? { ...s, name: name.trim() } : s
        ),
      };
    }),
  };
  saveData(_data, _profileId);
  notify();
}

export function deleteSubcategory(categoryId, subcategoryId) {
  // Remove payees using this subcategory
  const newPayees = _data.payees.filter((p) => p.subcategoryId !== subcategoryId);
  _data = {
    ..._data,
    categories: _data.categories.map((c) => {
      if (c.id !== categoryId) return c;
      return { ...c, subcategories: c.subcategories.filter((s) => s.id !== subcategoryId) };
    }),
    payees: newPayees,
  };
  saveData(_data, _profileId);
  notify();
}

// ── Payee Getters ─────────────────────────────────────────────────────────────

export function getPayees() {
  return _data.payees;
}

export function getPayee(name) {
  const lower = name.trim().toLowerCase();
  return _data.payees.find((p) => p.name.toLowerCase() === lower) || null;
}

// ── Payee CRUD ────────────────────────────────────────────────────────────────

export function addPayee(name, subcategoryId) {
  // Resolve categoryId
  let categoryId;
  if (subcategoryId) {
    const cat = _data.categories.find((c) =>
      c.subcategories.some((s) => s.id === subcategoryId)
    );
    if (cat) categoryId = cat.id;
  }
  const payee = {
    id: generateId(),
    name: name.trim(),
    ...(subcategoryId ? { subcategoryId } : {}),
    ...(categoryId   ? { categoryId }   : {}),
  };
  _data = { ..._data, payees: [..._data.payees, payee] };
  saveData(_data, _profileId);
  notify();
  return payee;
}

export function updatePayee(id, name, subcategoryId) {
  // Resolve categoryId from the new subcategoryId
  let categoryId;
  if (subcategoryId) {
    const cat = _data.categories.find((c) =>
      c.subcategories.some((s) => s.id === subcategoryId)
    );
    if (cat) categoryId = cat.id;
  }

  // Capture the old payee so we can detect subcategory changes and match transactions
  const oldPayee = _data.payees.find((p) => p.id === id);
  const subcategoryChanged = oldPayee && subcategoryId !== (oldPayee.subcategoryId ?? null);
  const matchName = (oldPayee?.name ?? "").toLowerCase();

  // Update the payee record
  const updatedPayees = _data.payees.map((p) => {
    if (p.id !== id) return p;
    const updated = { ...p, name: name.trim() };
    if (subcategoryId) {
      updated.subcategoryId = subcategoryId;
      if (categoryId) updated.categoryId = categoryId;
      else delete updated.categoryId;
    } else {
      delete updated.subcategoryId;
      delete updated.categoryId;
    }
    return updated;
  });

  // If the subcategory changed, re-categorize every transaction that references
  // this payee (matched case-insensitively by name) across all accounts
  let updatedAccounts = _data.accounts;
  if (subcategoryChanged && matchName) {
    updatedAccounts = _data.accounts.map((a) => {
      if (!a.transactions?.length) return a;
      const newTxs = a.transactions.map((tx) => {
        if ((tx.payeeName ?? "").toLowerCase() !== matchName) return tx;
        const updated = { ...tx };
        if (subcategoryId) {
          updated.subcategoryId = subcategoryId;
          if (categoryId) updated.categoryId = categoryId;
          else delete updated.categoryId;
        } else {
          delete updated.subcategoryId;
          delete updated.categoryId;
        }
        return updated;
      });
      return { ...a, transactions: newTxs };
    });
  }

  _data = { ..._data, payees: updatedPayees, accounts: updatedAccounts };
  saveData(_data, _profileId);
  notify();
}

export function deletePayee(id) {
  _data = { ..._data, payees: _data.payees.filter((p) => p.id !== id) };
  saveData(_data, _profileId);
  notify();
}

// ── Tag Getters ───────────────────────────────────────────────────────────────

export function getTags() {
  return _data.tags;
}

// ── Tag CRUD ──────────────────────────────────────────────────────────────────
// The "Cap. Ex." tag is seeded server-side as `protected: true` and can't be
// renamed or deleted — updateTag/deleteTag silently no-op on protected tags as
// a defensive backstop (the UI already hides their rename/delete controls).

export function addTag(name) {
  const tag = { id: generateId(), name: name.trim(), protected: false };
  _data = { ..._data, tags: [..._data.tags, tag] };
  saveData(_data, _profileId);
  notify();
  return tag;
}

export function updateTag(id, name) {
  _data = {
    ..._data,
    tags: _data.tags.map((t) =>
      t.id === id && !t.protected ? { ...t, name: name.trim() } : t
    ),
  };
  saveData(_data, _profileId);
  notify();
}

export function deleteTag(id) {
  _data = { ..._data, tags: _data.tags.filter((t) => t.id !== id || t.protected) };
  saveData(_data, _profileId);
  notify();
}
