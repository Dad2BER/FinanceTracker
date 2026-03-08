const API_KEY_STORAGE = "financetracker_apikey";
const AV_KEY_STORAGE  = "financetracker_avkey";

// ── Data persistence via REST API ─────────────────────────────────────────────

export async function loadData() {
  const res = await fetch("/api/data");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function saveData(data) {
  fetch("/api/data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).then((res) => {
    if (!res.ok) console.error("[saveData] POST /api/data failed:", res.status);
  }).catch((err) => {
    console.error("[saveData] network error:", err);
  });
}

// ── API key persistence (localStorage) ───────────────────────────────────────

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
