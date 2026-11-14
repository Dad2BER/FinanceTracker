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
  // Let any queued saves for this profile land first, so switching back to a
  // profile right after editing it doesn't read a stale copy from the server.
  await _saveQueues.get(profileId)?.running;
  const res = await fetch(`/api/data?profile=${encodeURIComponent(profileId)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Each POST fully replaces the profile's stored data, and server.py handles
// requests concurrently (ThreadingHTTPServer). Firing one POST per mutation
// meant back-to-back mutations raced: an older, less complete snapshot could
// finish last and silently overwrite newer edits. So saves are serialized per
// profile — at most one POST in flight — and coalesced: while one is in flight,
// further calls just replace the pending snapshot, so the newest state is
// always the last one written.
const _saveQueues = new Map(); // profileId → { running: Promise|null, pending: string|null }

export function saveData(data, profileId) {
  let q = _saveQueues.get(profileId);
  if (!q) {
    q = { running: null, pending: null };
    _saveQueues.set(profileId, q);
  }
  q.pending = JSON.stringify(data); // snapshot now; later mutations don't leak in
  if (!q.running) q.running = _drainSaves(profileId, q);
  return q.running;
}

async function _drainSaves(profileId, q) {
  while (q.pending !== null) {
    const body = q.pending;
    q.pending = null;
    try {
      const res = await fetch(`/api/data?profile=${encodeURIComponent(profileId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (!res.ok) console.error("[saveData] POST /api/data failed:", res.status);
    } catch (err) {
      console.error("[saveData] network error:", err);
    }
  }
  q.running = null;
}

export function hasPendingSaves() {
  for (const q of _saveQueues.values()) if (q.running) return true;
  return false;
}

// A coalesced save may still be waiting behind an in-flight one; warn before
// the tab closes in that brief window rather than dropping the latest edits.
window.addEventListener("beforeunload", (e) => {
  if (hasPendingSaves()) {
    e.preventDefault();
    e.returnValue = "";
  }
});

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
