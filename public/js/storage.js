// Saved worlds live in the host's browser (IndexedDB), like singleplayer saves.

const DB_NAME = 'blockcraft';
const STORE = 'worlds';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const result = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Saving was cancelled'));
    });
  } finally {
    db.close();
  }
}

export function listWorlds() {
  return withStore('readonly', (s) => s.getAll()).then((all) =>
    (all || []).map(({ id, name, mode, lastPlayed, created, seed }) => ({ id, name, mode, lastPlayed, created, seed }))
      .sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0)));
}

export function loadWorld(id) {
  return withStore('readonly', (s) => s.get(id));
}

export function saveWorld(save) {
  return withStore('readwrite', (s) => s.put(save));
}

export function deleteWorld(id) {
  return withStore('readwrite', (s) => s.delete(id));
}

// Ask the browser not to clear our data when space runs low.
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch { /* not supported */ }
}
