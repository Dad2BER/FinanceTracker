import { saveData } from "./services/storage.js";
import { generateId } from "./utils/uuid.js";

// Central reactive state — initialized by app.js via initState() after async file load
let _data = { accounts: [] };

export function initState(data) {
  _data = data?.accounts ? data : { accounts: [] };
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

export function getAccounts() {
  return _data.accounts;
}

export function getAccount(id) {
  return _data.accounts.find((a) => a.id === id) || null;
}

export function addAccount(name, taxType, accountType = "asset") {
  const account = {
    id: generateId(),
    name: name.trim(),
    taxType,
    accountType,
    createdAt: new Date().toISOString(),
    holdings: [],
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
