const API_KEY_STORAGE     = "financetracker_apikey";
const AV_KEY_STORAGE      = "financetracker_avkey";
const PRICE_CACHE_STORAGE = "financetracker_pricecache";
const ACTIVE_PROFILE_KEY  = "financetracker_active_profile";

// ── Profile API ───────────────────────────────────────────────────────────────

export async function loadProfiles() {
  const res = await fetch("/api/profiles");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function createProfile(name) {
  const res = await fetch("/api/profiles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function renameProfile(id, name) {
  const res = await fetch(`/api/profiles/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function deleteProfile(id) {
  const res = await fetch(`/api/profiles/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Active profile persistence (localStorage) ─────────────────────────────────

export function loadActiveProfileId() {
  return window.localStorage.getItem(ACTIVE_PROFILE_KEY) || null;
}

export function saveActiveProfileId(id) {
  window.localStorage.setItem(ACTIVE_PROFILE_KEY, id);
}

// ── Data persistence via REST API ─────────────────────────────────────────────

export async function loadData(profileId) {
  const res = await fetch(`/api/data?profile=${encodeURIComponent(profileId)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function saveData(data, profileId) {
  fetch(`/api/data?profile=${encodeURIComponent(profileId)}`, {
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

// ── Price cache (localStorage) ────────────────────────────────────────────────
// Stores the last successfully fetched price for each symbol so the app can
// fall back to a known-good value when the API returns zero or times out.
// Shape: { [symbol]: { price: number, fetchedAt: number (ms epoch) } }

export function loadPriceCache() {
  try {
    const raw = window.localStorage.getItem(PRICE_CACHE_STORAGE);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function savePriceCache(cache) {
  try {
    window.localStorage.setItem(PRICE_CACHE_STORAGE, JSON.stringify(cache));
  } catch (e) {
    console.warn("[savePriceCache] localStorage write failed:", e);
  }
}
