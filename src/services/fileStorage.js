// ── IndexedDB handle persistence ──────────────────────────────────────────────
const _dbPromise = new Promise((resolve, reject) => {
  const req = indexedDB.open("financetracker_fs", 1);
  req.onupgradeneeded = () => req.result.createObjectStore("handles");
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

export async function getStoredHandle() {
  try {
    const db = await _dbPromise;
    return await new Promise((resolve) => {
      const tx = db.transaction("handles", "readonly");
      const req = tx.objectStore("handles").get("main");
      req.onsuccess = () => resolve(req.result?.handle ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function storeHandle(handle) {
  try {
    const db = await _dbPromise;
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("handles", "readwrite");
      tx.objectStore("handles").put({ handle }, "main");
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // IndexedDB unavailable (e.g. private browsing) — degrade gracefully
  }
}

export async function clearStoredHandle() {
  try {
    const db = await _dbPromise;
    return await new Promise((resolve) => {
      const tx = db.transaction("handles", "readwrite");
      tx.objectStore("handles").delete("main");
      tx.oncomplete = resolve;
      tx.onerror = resolve; // best-effort
    });
  } catch {
    // ignore
  }
}

// ── File System Access API ─────────────────────────────────────────────────────

// Must be called inside a user-gesture handler.
// Returns true if permission is granted, false otherwise.
export async function requestPermission(handle) {
  let perm = await handle.queryPermission({ mode: "readwrite" });
  if (perm === "granted") return true;
  perm = await handle.requestPermission({ mode: "readwrite" });
  return perm === "granted";
}

// Returns parsed data, or null if file is empty.
// Throws SyntaxError on bad JSON, DOMException on file access errors.
export async function readFile(handle) {
  const file = await handle.getFile();
  const text = await file.text();
  if (!text.trim()) return null;
  return JSON.parse(text);
}

// Overwrites the file with pretty-printed JSON.
export async function writeFile(handle, data) {
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
}

// ── Shared handle reference ────────────────────────────────────────────────────
// app.js sets fileState.handle once bootstrap completes.
// storage.js reads it on every saveData() call.
export const fileState = { handle: null };
