import { saveData } from "./services/storage.js";
import { generateId } from "./utils/uuid.js";

// Central reactive state — initialized by app.js via initState() after async load
let _data = { accounts: [], categories: [], payees: [] };

export function initState(data) {
  _data = {
    accounts:   Array.isArray(data?.accounts)   ? data.accounts   : [],
    categories: Array.isArray(data?.categories) ? data.categories : [],
    payees:     Array.isArray(data?.payees)     ? data.payees     : [],
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

// ── Account Getters ───────────────────────────────────────────────────────────

export function getAccounts() {
  return _data.accounts;
}

export function getAccount(id) {
  return _data.accounts.find((a) => a.id === id) || null;
}

// ── Account CRUD ──────────────────────────────────────────────────────────────

export function addAccount(name, taxType, accountType = "asset") {
  const account = {
    id: generateId(),
    name: name.trim(),
    taxType,
    accountType,
    createdAt: new Date().toISOString(),
    holdings: [],
    transactions: [],
  };
  _data = { ..._data, accounts: [..._data.accounts, account] };
  saveData(_data);
  notify();
  return account;
}

export function updateAccount(id, name, taxType, accountType = "asset") {
  _data = {
    ..._data,
    accounts: _data.accounts.map((a) =>
      a.id === id ? { ...a, name: name.trim(), taxType, accountType } : a
    ),
  };
  saveData(_data);
  notify();
}

export function deleteAccount(id) {
  _data = { ..._data, accounts: _data.accounts.filter((a) => a.id !== id) };
  saveData(_data);
  notify();
}

// ── Holding CRUD ──────────────────────────────────────────────────────────────

export function addHolding(accountId, symbol, shares, origin, assetType) {
  const holding = {
    id: generateId(),
    symbol: symbol.trim().toUpperCase(),
    shares: parseFloat(shares),
    ...(origin ? { origin } : {}),
    ...(assetType ? { assetType } : {}),
  };
  _data = {
    ..._data,
    accounts: _data.accounts.map((a) =>
      a.id === accountId
        ? { ...a, holdings: [...a.holdings, holding] }
        : a
    ),
  };
  saveData(_data);
  notify();
  return holding;
}

export function updateHolding(accountId, holdingId, symbol, shares, origin, assetType) {
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
          return updated;
        }),
      };
    }),
  };
  saveData(_data);
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
  saveData(_data);
  notify();
}

// ── Transaction CRUD ──────────────────────────────────────────────────────────

export function addTransaction(accountId, { date, payeeName, subcategoryId, tag, amount }) {
  const tx = {
    id: generateId(),
    date,
    payeeName,
    amount: parseFloat(amount),
    ...(subcategoryId ? { subcategoryId } : {}),
    ...(tag ? { tag } : {}),
  };
  // Resolve categoryId from subcategoryId
  if (subcategoryId) {
    const cat = _data.categories.find((c) =>
      c.subcategories.some((s) => s.id === subcategoryId)
    );
    if (cat) tx.categoryId = cat.id;
  }
  _data = {
    ..._data,
    accounts: _data.accounts.map((a) =>
      a.id === accountId
        ? { ...a, transactions: [...(a.transactions || []), tx] }
        : a
    ),
  };
  saveData(_data);
  notify();
  return tx;
}

export function updateTransaction(accountId, txId, { date, payeeName, subcategoryId, tag, amount }) {
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
          return updated;
        }),
      };
    }),
  };
  saveData(_data);
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
  saveData(_data);
  notify();
}

// ── Category Getters ──────────────────────────────────────────────────────────

export function getCategories() {
  return _data.categories;
}

// ── Category CRUD ─────────────────────────────────────────────────────────────

export function addCategory(name) {
  const category = { id: generateId(), name: name.trim(), subcategories: [] };
  _data = { ..._data, categories: [..._data.categories, category] };
  saveData(_data);
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
  saveData(_data);
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
  saveData(_data);
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
  saveData(_data);
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
  saveData(_data);
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
  saveData(_data);
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
  saveData(_data);
  notify();
  return payee;
}

export function updatePayee(id, name, subcategoryId) {
  // Resolve categoryId
  let categoryId;
  if (subcategoryId) {
    const cat = _data.categories.find((c) =>
      c.subcategories.some((s) => s.id === subcategoryId)
    );
    if (cat) categoryId = cat.id;
  }
  _data = {
    ..._data,
    payees: _data.payees.map((p) => {
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
    }),
  };
  saveData(_data);
  notify();
}

export function deletePayee(id) {
  _data = { ..._data, payees: _data.payees.filter((p) => p.id !== id) };
  saveData(_data);
  notify();
}
