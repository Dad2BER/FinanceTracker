import { fileState, writeFile } from "./fileStorage.js";

const API_KEY_STORAGE = "financetracker_apikey";
const AV_KEY_STORAGE = "financetracker_avkey";

export function saveData(data) {
  if (!fileState.handle) return;
  writeFile(fileState.handle, data).catch((err) =>
    console.error("[saveData] write failed:", err)
  );
}

export function loadApiKey() {
  return window.localStorage.getItem(API_KEY_STORAGE) || "";
}

export function saveApiKey(key) {
  window.localStorage.setItem(API_KEY_STORAGE, key);
}

export function loadAvKey() {
  return window.localStorage.getItem(AV_KEY_STORAGE) || "";
}

export function saveAvKey(key) {
  window.localStorage.setItem(AV_KEY_STORAGE, key);
}
