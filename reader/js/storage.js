/**
 * Storage module for epub.co.il reader v2:
 * - IndexedDB ('epubcoil.reader.v2', store 'books') for book blobs, cover thumbnails, and metadata
 * - localStorage ('epubcoil.reader.v2.*') for settings, per-book reading state, and v1 migration
 */

export const DB_NAME = 'epubcoil.reader.v2';
export const DB_VERSION = 1;
export const BOOKS_STORE = 'books';

export const settingsKey = `${DB_NAME}.settings`;
export const migratedKey = `${DB_NAME}.migrated`;
export const libraryIndexKey = `${DB_NAME}.library`;
export const installDismissedKey = `${DB_NAME}.installDismissed`;
export const stateKey = id => `${DB_NAME}.book.${id}`;

export const DEFAULT_SETTINGS = Object.freeze({
  theme: 'auto',
  fontSize: 100,
  lineHeight: 1.7,
  margins: 32,
  maxWidth: 720,
  font: 'default',
  justify: false, // ragged by default: justified Hebrew on a 390px column leaves big gaps
  hyphenate: false,
  flow: 'paginated',
  columns: 'auto',
  wakeLock: false,
  lastOpen: null,
  onLibrary: true,
});

export const DEFAULT_BOOK_STATE = Object.freeze({
  cfi: null,
  fraction: 0,
  sectionIndex: 0,
  updatedAt: 0,
  bookmarks: [],
  highlights: [],
});

/**
 * Safely parse JSON from localStorage with fallback defaults.
 */
function safeParseObject(raw, fallback) {
  if (!raw || typeof raw !== 'string') {
    return structuredClone(fallback);
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return structuredClone(fallback);
    }
    return { ...structuredClone(fallback), ...parsed };
  } catch {
    return structuredClone(fallback);
  }
}

/**
 * Read global reader settings from localStorage.
 */
export function getSettings() {
  const settings = safeParseObject(localStorage.getItem(settingsKey), DEFAULT_SETTINGS);
  // Sanitize numeric fields
  settings.fontSize = clampNumber(settings.fontSize, 75, 180, DEFAULT_SETTINGS.fontSize);
  settings.lineHeight = clampNumber(settings.lineHeight, 1.2, 2.4, DEFAULT_SETTINGS.lineHeight);
  settings.margins = clampNumber(settings.margins, 0, 80, DEFAULT_SETTINGS.margins);
  settings.maxWidth = clampNumber(settings.maxWidth, 480, 1100, DEFAULT_SETTINGS.maxWidth);
  return settings;
}

/**
 * Persist global reader settings synchronously to localStorage.
 */
export function putSettings(settings) {
  try {
    localStorage.setItem(settingsKey, JSON.stringify(settings));
  } catch {
    // Ignore storage write errors in private/restricted contexts
  }
}

/**
 * Read per-book state (location, bookmarks, highlights) from localStorage.
 */
export function getState(bookId) {
  if (!bookId) return structuredClone(DEFAULT_BOOK_STATE);
  const state = safeParseObject(localStorage.getItem(stateKey(bookId)), DEFAULT_BOOK_STATE);
  if (!Array.isArray(state.bookmarks)) state.bookmarks = [];
  if (!Array.isArray(state.highlights)) state.highlights = [];
  return state;
}

/**
 * Persist per-book state synchronously to localStorage.
 */
export function putState(bookId, state) {
  if (!bookId) return;
  try {
    localStorage.setItem(stateKey(bookId), JSON.stringify(state));
  } catch {
    // Ignore quota errors on state write
  }
}

function clampNumber(val, min, max, fallback) {
  const num = Number(val);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

/**
 * One-time graceful migration from legacy `epubcoil.reader.v1` localStorage data.
 * Never throws on malformed or garbage JSON.
 */
export function migrate() {
  try {
    if (localStorage.getItem(migratedKey) === '1') {
      return;
    }

    const rawV1 = localStorage.getItem('epubcoil.reader.v1');
    if (rawV1) {
      let v1 = null;
      try {
        v1 = JSON.parse(rawV1);
      } catch {
        v1 = null;
      }

      if (v1 && typeof v1 === 'object' && !Array.isArray(v1)) {
        const settings = getSettings();

        // Map theme ('day' -> 'light', 'night' -> 'dark', 'sepia' -> 'sepia', etc.)
        const themeMap = {
          day: 'light',
          light: 'light',
          sepia: 'sepia',
          night: 'dark',
          dark: 'dark',
          oled: 'oled',
          black: 'oled',
          auto: 'auto',
        };
        if (typeof v1.theme === 'string' && themeMap[v1.theme.toLowerCase()]) {
          settings.theme = themeMap[v1.theme.toLowerCase()];
        }

        // Map fontSize
        const parsedFontSize = Number(v1.fontSize);
        if (Number.isFinite(parsedFontSize) && parsedFontSize > 0) {
          // If legacy value was small px (e.g., 16-32), convert to approx percentage
          const normalizedSize =
            parsedFontSize < 50 ? Math.round((parsedFontSize / 16) * 100) : Math.round(parsedFontSize);
          settings.fontSize = clampNumber(normalizedSize, 75, 180, DEFAULT_SETTINGS.fontSize);
        }

        // Map lineHeight if present
        const parsedLineHeight = Number(v1.lineHeight);
        if (Number.isFinite(parsedLineHeight) && parsedLineHeight >= 1.1 && parsedLineHeight <= 2.6) {
          settings.lineHeight = parsedLineHeight;
        }

        putSettings(settings);

        // Migrate demo location if present
        const cfi = typeof v1.cfi === 'string' ? v1.cfi : typeof v1.location === 'string' ? v1.location : null;
        const fraction = Number.isFinite(Number(v1.fraction)) ? Number(v1.fraction) : 0;
        if (cfi || fraction > 0) {
          const demoState = getState('demo-default');
          if (!demoState.cfi && cfi) demoState.cfi = cfi;
          if (!demoState.fraction && fraction > 0) demoState.fraction = fraction;
          demoState.updatedAt = Date.now();
          putState('demo-default', demoState);
        }
      }
    }

    localStorage.setItem(migratedKey, '1');
  } catch {
    // Never crash on storage errors
  }
}

/**
 * Compute deterministic SHA-256 hex digest of a file's bytes, with fallback hash.
 */
export async function idFor(file) {
  try {
    if (globalThis.crypto?.subtle && typeof file.arrayBuffer === 'function') {
      const buffer = await file.arrayBuffer();
      const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
      return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    }
  } catch {
    // Fallback below
  }
  const name = String(file?.name || 'book');
  const size = Number(file?.size || 0);
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return `fallback-${size}-${Math.abs(hash)}`;
}

/**
 * Open the IndexedDB database.
 */
function openDatabase() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(BOOKS_STORE)) {
        db.createObjectStore(BOOKS_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Update the lightweight metadata mirror in localStorage.
 */
function syncLibraryIndexMirror(books) {
  try {
    const summary = books.map(b => ({
      id: b.id,
      meta: b.meta,
    }));
    localStorage.setItem(libraryIndexKey, JSON.stringify(summary));
  } catch {
    // Ignore mirror errors
  }
}

/**
 * List all saved books from IndexedDB, sorted by most recently opened.
 */
export async function listBooks() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BOOKS_STORE, 'readonly');
    const req = tx.objectStore(BOOKS_STORE).getAll();
    req.onsuccess = () => {
      const list = (req.result || []).sort(
        (a, b) => (b.meta?.openedAt || 0) - (a.meta?.openedAt || 0),
      );
      syncLibraryIndexMirror(list);
      db.close();
      resolve(list);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

/**
 * Read a single book record ({ id, blob, coverBlob, meta }) from IndexedDB.
 */
export async function readBook(id) {
  if (!id) return null;
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BOOKS_STORE, 'readonly');
    const req = tx.objectStore(BOOKS_STORE).get(id);
    req.onsuccess = () => {
      db.close();
      resolve(req.result || null);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

/**
 * Save or update a book record ({ id, blob, coverBlob, meta }) in IndexedDB.
 */
export async function saveBook(record) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BOOKS_STORE, 'readwrite');
    const req = tx.objectStore(BOOKS_STORE).put(record);
    req.onsuccess = () => {
      db.close();
      resolve();
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

/**
 * Remove a book from IndexedDB and delete its reading state in localStorage.
 */
export async function removeBook(id) {
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(BOOKS_STORE, 'readwrite');
    const req = tx.objectStore(BOOKS_STORE).delete(id);
    req.onsuccess = () => {
      db.close();
      resolve();
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
  try {
    localStorage.removeItem(stateKey(id));
    const settings = getSettings();
    if (settings.lastOpen === id) {
      settings.lastOpen = null;
      settings.onLibrary = true;
      putSettings(settings);
    }
  } catch {
    // Ignore localStorage cleanup errors
  }
}

/**
 * Clear all saved books from IndexedDB and remove all v2 reader keys from localStorage.
 */
export async function clearBooks() {
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(BOOKS_STORE, 'readwrite');
    const req = tx.objectStore(BOOKS_STORE).clear();
    req.onsuccess = () => {
      db.close();
      resolve();
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(DB_NAME) && key !== migratedKey) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  } catch {
    // Ignore localStorage cleanup errors
  }
}

/**
 * Request persistent storage protection via StorageManager API (feature-detected).
 */
export async function requestPersistentStorage() {
  try {
    if (navigator.storage && typeof navigator.storage.persist === 'function') {
      return await navigator.storage.persist();
    }
  } catch {
    // Ignore errors
  }
  return false;
}

/**
 * Check whether storage is currently marked persistent.
 */
export async function isStoragePersisted() {
  try {
    if (navigator.storage && typeof navigator.storage.persisted === 'function') {
      return await navigator.storage.persisted();
    }
  } catch {
    // Ignore errors
  }
  return false;
}
