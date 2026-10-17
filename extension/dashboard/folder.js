// The archive folder: remembering which one the user picked, and reading and
// writing JSON files in it.

const DB_NAME = "archiver";
const STORE = "handles";
const KEY = "archive";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, action) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = action(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function pickFolder() {
  const handle = await window.showDirectoryPicker({ id: "archive", mode: "readwrite" });
  await withStore("readwrite", (store) => store.put(handle, KEY));
  return handle;
}

// Returns the remembered folder and whether it can be used right now. Chromium
// may require a click before it grants access again after a restart.
export async function rememberedFolder() {
  const handle = await withStore("readonly", (store) => store.get(KEY));
  if (!handle) return null;
  const permission = await handle.queryPermission({ mode: "readwrite" });
  return { handle, granted: permission === "granted" };
}

// Must be called from a click handler.
export async function regainAccess(handle) {
  return (await handle.requestPermission({ mode: "readwrite" })) === "granted";
}

// Returns null only when the file does not exist. A file that exists but cannot
// be read or parsed is an error, so it is never silently overwritten.
export async function readJson(dir, name) {
  let fileHandle;
  try {
    fileHandle = await dir.getFileHandle(name);
  } catch (err) {
    if (err.name === "NotFoundError") return null;
    throw err;
  }
  const file = await fileHandle.getFile();
  return JSON.parse(await file.text());
}

export async function writeJson(dir, name, value) {
  await writeText(dir, name, JSON.stringify(value, null, 2));
}

// The browser writes to a temporary file and swaps it in on close, so a crash
// mid-write leaves the previous version intact.
export async function writeText(dir, name, text) {
  const fileHandle = await dir.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(text);
    await writable.close();
  } catch (err) {
    await writable.abort().catch(() => {});
    throw err;
  }
}
