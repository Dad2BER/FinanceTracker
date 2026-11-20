const BASE_URL = "https://finnhub.io/api/v1";
const FETCH_TIMEOUT_MS = 8000;

// ── Rate-limited request queue ────────────────────────────────────────────────
// Finnhub's free tier allows 60 calls/minute and 30 calls/second per key. Every
// Finnhub request in the app goes through this queue, which stays safely under
// both limits. A 429 response pauses the whole queue and retries the request.
const MAX_PER_MINUTE = 55;
const MAX_PER_SECOND = 20;
const MAX_CONCURRENT = 4;
const RATE_LIMIT_PAUSE_MS = 20_000;
const MAX_RETRIES = 3;

const _queue = [];       // [{ run, resolve, reject, retries }]
const _sentAt = [];      // timestamps of requests started in the last minute
let _active = 0;
let _pausedUntil = 0;
let _timer = null;

class RateLimitError extends Error {}

function msUntilSlot(now) {
  while (_sentAt.length && now - _sentAt[0] >= 60_000) _sentAt.shift();
  let wait = Math.max(0, _pausedUntil - now);
  if (_sentAt.length >= MAX_PER_MINUTE) {
    wait = Math.max(wait, _sentAt[0] + 60_000 - now);
  }
  const lastSecond = _sentAt.filter((t) => now - t < 1000);
  if (lastSecond.length >= MAX_PER_SECOND) {
    wait = Math.max(wait, lastSecond[0] + 1000 - now);
  }
  return wait;
}

function pump() {
  if (_timer) return; // a wake-up is already scheduled
  while (_active < MAX_CONCURRENT && _queue.length) {
    const now = Date.now();
    const wait = msUntilSlot(now);
    if (wait > 0) {
      _timer = setTimeout(() => { _timer = null; pump(); }, wait + 5);
      return;
    }
    const job = _queue.shift();
    _active++;
    _sentAt.push(now);
    job.run()
      .then(job.resolve, (err) => {
        if (err instanceof RateLimitError && job.retries < MAX_RETRIES) {
          job.retries++;
          _pausedUntil = Math.max(_pausedUntil, Date.now() + RATE_LIMIT_PAUSE_MS);
          _queue.unshift(job);
        } else {
          job.reject(err);
        }
      })
      .finally(() => { _active--; pump(); });
  }
}

/** Queue a Finnhub request. `priority` jumps ahead of background price refreshes. */
function schedule(run, { priority = false } = {}) {
  return new Promise((resolve, reject) => {
    const job = { run, resolve, reject, retries: 0 };
    if (priority) _queue.unshift(job); else _queue.push(job);
    pump();
  });
}

/** Number of Finnhub requests waiting or in flight. */
export function pendingRequests() {
  return _queue.length + _active;
}

function fetchWithTimeout(url, ms = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

async function getJson(path, params, opts) {
  const API_KEY = window.__FINNHUB_API_KEY__ || "";
  if (!API_KEY) throw new Error("No Finnhub API key configured.");
  const qs = new URLSearchParams({ ...params, token: API_KEY }).toString();
  return schedule(async () => {
    const res = await fetchWithTimeout(`${BASE_URL}${path}?${qs}`);
    if (res.status === 429) throw new RateLimitError("Finnhub rate limit (429)");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }, opts);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetches one quote. Resolves to
 *   { status: "ok", price, dp, d }   — dp/d = daily % and $ change
 *   { status: "unsupported" }        — Finnhub returned no price (c = 0), e.g.
 *                                      mutual funds the free tier doesn't cover
 * Rejects on network errors, timeouts, or a rate limit that outlasted retries.
 */
export async function fetchQuote(symbol) {
  const data = await getJson("/quote", { symbol });
  if (!data || !(data.c > 0)) return { status: "unsupported" };
  return { status: "ok", price: data.c, dp: data.dp ?? null, d: data.d ?? null };
}

/**
 * Fetches the full quote object for a symbol (user-initiated — jumps the queue).
 * Returns the raw Finnhub /quote response: { c, d, dp, h, l, o, pc, t }
 */
export async function fetchQuoteDetail(symbol) {
  const data = await getJson("/quote", { symbol }, { priority: true });
  if (!data || data.c <= 0) throw new Error(`No price data for: ${symbol}`);
  return data;
}

/**
 * Fetches the company profile for a symbol (user-initiated — jumps the queue).
 * Returns the raw Finnhub /stock/profile2 response:
 *   { name, exchange, finnhubIndustry, marketCapitalization,
 *     weburl, logo, country, currency, ticker }
 */
export async function fetchProfile(symbol) {
  return getJson("/stock/profile2", { symbol }, { priority: true });
}
