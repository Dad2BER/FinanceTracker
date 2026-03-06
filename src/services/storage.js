const STORAGE_KEY = "financetracker_v1";
const API_KEY_STORAGE = "financetracker_apikey";

export function loadData() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { accounts: [] };
    return JSON.parse(raw);
  } catch {
    return { accounts: [] };
  }
}

export function saveData(data) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function clearData() {
  window.localStorage.removeItem(STORAGE_KEY);
}

export function loadApiKey() {
  return window.localStorage.getItem(API_KEY_STORAGE) || "";
}

export function saveApiKey(key) {
  window.localStorage.setItem(API_KEY_STORAGE, key);
}
