import { STRINGS } from './he.js';
import { ReaderError, getFriendlyErrorMessage } from './errors.js';
import {
  migrate,
  getSettings,
  putSettings,
  getState,
  putState,
  readBook,
  saveBook,
  removeBook,
  clearBooks,
  idFor,
  requestPersistentStorage,
  DEFAULT_SETTINGS,
} from './storage.js';
import {
  applyThemeToDocument,
  applySettingsToView,
  renderSettingsDrawer,
} from './settings.js';
import {
  generateCoverThumbnail,
  renderLibraryList,
} from './library.js';
import { ReaderEngine } from './engine.js';
import { DrawerController, renderTocDrawer } from './ui/drawers.js';
import {
  updateBookmarkButton,
  toggleBookmarkAtCurrentLocation,
  renderBookmarksDrawer,
} from './bookmarks.js';
import { renderSearchDrawer } from './search.js';
import {
  initServiceWorker,
  initInstallBanner,
  initLaunchQueue,
  initFullscreenControl,
  WakeLockController,
} from './pwa.js';

const $ = selector => document.querySelector(selector);

let settings = getSettings();
let currentBook = null;
let currentState = getState(null);
let saveTimer = null;
let chromeTimer = null;
let liveTimer = null;
let toastTimer = null;
let lastAttemptAction = null;

const wakeLock = new WakeLockController();

const drawer = new DrawerController({
  drawerEl: $('#drawer'),
  titleEl: $('#drawer-title'),
  contentEl: $('#drawer-content'),
  closeBtnEl: $('#drawer-close-btn'),
  backdropEl: $('#modal-backdrop'),
});

const engine = new ReaderEngine({
  viewElement: $('#view'),
  onRelocate: handleRelocate,
  onSectionLoad: handleSectionLoad,
});

/**
 * Show a temporary toast notification in Hebrew (with optional action button).
 */
function showToast(message, actionLabel = null, onAction = null, duration = 4000) {
  const toastEl = $('#toast');
  if (!toastEl) return;

  clearTimeout(toastTimer);
  toastEl.innerHTML = '';

  const textSpan = document.createElement('span');
  textSpan.textContent = message;
  toastEl.appendChild(textSpan);

  if (actionLabel && typeof onAction === 'function') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'button tiny toast-action-btn';
    btn.textContent = actionLabel;
    btn.addEventListener('click', () => {
      toastEl.classList.remove('show');
      onAction();
    });
    toastEl.appendChild(btn);
  }

  toastEl.classList.add('show');
  if (!actionLabel) {
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('show');
    }, duration);
  }
}

/**
 * Display a persistent, actionable error banner with retry and back-to-library buttons,
 * plus a toast for screen readers and immediate visibility.
 */
function showErrorState(err, retryFn = null) {
  const friendlyMsg = getFriendlyErrorMessage(err);
  showToast(friendlyMsg);

  const errorBanner = $('#error-banner');
  const errorText = $('#error-text');
  const retryBtn = $('#error-retry-btn');
  const backBtn = $('#error-back-btn');

  if (errorBanner && errorText) {
    errorText.textContent = friendlyMsg;
    errorBanner.hidden = false;
    lastAttemptAction = retryFn;
    if (retryBtn) {
      retryBtn.hidden = typeof retryFn !== 'function';
    }
    if (backBtn) {
      backBtn.onclick = () => {
        hideErrorState();
        showLibraryView();
      };
    }
    if (retryBtn) {
      retryBtn.onclick = () => {
        const fn = lastAttemptAction;
        hideErrorState();
        fn?.();
      };
    }
  }
}

function hideErrorState() {
  const errorBanner = $('#error-banner');
  if (errorBanner) {
    errorBanner.hidden = true;
  }
}

/**
 * Politely announce reading progress changes to assistive technologies (throttled).
 */
function announcePolite(text) {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => {
    const liveEl = $('#live');
    if (liveEl) liveEl.textContent = text;
  }, 350);
}

/**
 * Resolve the demo book URL from `?book=` query parameter, `data-demo-book` attribute, or `../hebrew.epub`.
 */
function resolveDemoBookUrl() {
  const paramBook = new URLSearchParams(globalThis.location.search).get('book');
  const attrBook = document.documentElement.dataset.demoBook;
  const relativePath = paramBook || attrBook || '../hebrew.epub';
  return new URL(relativePath, globalThis.location.href).href;
}

/**
 * Immediately persist the current book's reading location and state to localStorage.
 */
function persistLocationNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!currentBook) return;

  const loc = engine.getLocation();
  if (loc) {
    const normFrac =
      loc.fraction >= 0.995 ? 1 : Math.max(0, Math.min(1, Number(loc.fraction) || 0));
    currentState = {
      ...currentState,
      cfi: loc.cfi || currentState.cfi || null,
      fraction: normFrac,
      sectionIndex: loc.section?.current ?? currentState.sectionIndex ?? 0,
      updatedAt: Date.now(),
    };
  }
  putState(currentBook.id, currentState);
  settings.lastOpen = currentBook.id;
  settings.onLibrary = false;
  putSettings(settings);
}

function schedulePersistLocation() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistLocationNow, 250);
}

/**
 * The UI chrome is always Hebrew RTL (<html dir="rtl">). Only the reading
 * surface (#viewer-wrap: book + tap zones) follows the book's direction, so
 * logical tap zones map to physical left = next for RTL and right = next for LTR.
 */
function setBookDir(dir) {
  const wrap = $('#viewer-wrap');
  if (wrap) wrap.dir = dir;
  const readerEl = $('#reader');
  if (readerEl) readerEl.dataset.bookDir = dir;
}

/**
 * Handle `relocate` events from the foliate engine.
 */
function handleRelocate(loc) {
  if (!loc) return;
  const fraction = Math.max(0, Math.min(1, Number(loc.fraction) || 0));
  // 100% is reserved for the true end of the book; elsewhere floor so we never overstate.
  const percent = fraction >= 1 ? 100 : Math.min(99, Math.floor(fraction * 100));
  const sectionIdx = loc.section?.current ?? 0;
  const chapterTitle = loc.tocItem?.label || STRINGS.chapterFallback(sectionIdx);

  const percentEl = $('#percent');
  const progressEl = $('#progress');
  const goPercentEl = $('#go-percent');
  const chapterEl = $('#chapter');

  if (percentEl) percentEl.textContent = `${percent}%`;
  if (progressEl) {
    progressEl.value = String(Math.round(fraction * 1000));
    progressEl.dir = currentBook?.dir || 'rtl';
    progressEl.style.direction = currentBook?.dir === 'rtl' ? 'rtl' : 'ltr';
  }
  if (goPercentEl && document.activeElement !== goPercentEl) {
    goPercentEl.value = String(percent);
  }
  if (chapterEl) {
    chapterEl.textContent = chapterTitle;
  }

  setBookDir(currentBook?.dir || 'rtl');

  currentState = {
    ...currentState,
    cfi: loc.cfi || currentState.cfi || null,
    fraction,
    sectionIndex: sectionIdx,
    updatedAt: Date.now(),
  };

  updateBookmarkButton($('#bookmark-btn'), currentState, loc.cfi);
  announcePolite(STRINGS.liveProgress(percent, chapterTitle));
  persistLocationNow();
  schedulePersistLocation();
}

/**
 * Handle section `load` events from the foliate engine:
 * apply user typography/theme styles and attach keyboard navigation inside the iframe.
 */
function handleSectionLoad({ doc }) {
  applySettingsToView(engine.view, settings, currentBook?.dir || 'rtl');
  if (doc) {
    doc.addEventListener('keydown', handleReaderKeydown);
    doc.addEventListener('pointermove', handlePointerActivity);
  }
}

let chromeRevealedByMouseAt = 0;

/**
 * Mouse movement reveals the chrome (desktop). Touch/pen moves are ignored so a
 * swipe or a tap never fights the centre-tap toggle on phones.
 */
function handlePointerActivity(event) {
  if (event.pointerType && event.pointerType !== 'mouse') return;
  if (document.body.classList.contains('chrome-hidden')) {
    chromeRevealedByMouseAt = performance.now();
  }
  scheduleChromeHide();
}

/**
 * Centre tap toggles the chrome. If the mouse just revealed it on the way to
 * the click, keep it visible instead of immediately hiding it again.
 */
function toggleChrome() {
  const hidden = document.body.classList.contains('chrome-hidden');
  const justRevealed = performance.now() - chromeRevealedByMouseAt < 600;
  if (hidden || justRevealed) {
    chromeRevealedByMouseAt = 0;
    scheduleChromeHide();
  } else {
    clearTimeout(chromeTimer);
    document.body.classList.add('chrome-hidden');
  }
}

/**
 * Auto-hide reading chrome after inactivity while reading.
 */
function scheduleChromeHide() {
  clearTimeout(chromeTimer);
  document.body.classList.remove('chrome-hidden');
  if ($('#reader')?.hidden || drawer.isOpen) return;
  chromeTimer = setTimeout(() => {
    if (!$('#reader')?.hidden && !drawer.isOpen) {
      document.body.classList.add('chrome-hidden');
    }
  }, 4000);
}

/**
 * Switch back to the Library view and close the active book.
 */
async function showLibraryView() {
  persistLocationNow();
  clearTimeout(chromeTimer);
  document.body.classList.remove('chrome-hidden');

  settings.onLibrary = true;
  putSettings(settings);
  wakeLock.setState({ enabled: settings.wakeLock, activeReading: false });

  engine.close();
  currentBook = null;

  const readerEl = $('#reader');
  const libraryEl = $('#library');
  if (readerEl) readerEl.hidden = true;
  if (libraryEl) libraryEl.hidden = false;

  await refreshLibrary();
}

/**
 * Re-render the library book list.
 */
async function refreshLibrary() {
  await renderLibraryList($('#book-list'), {
    onOpenSaved: id => openSavedBook(id),
    onRemoveSaved: async id => {
      await removeBook(id);
      await refreshLibrary();
    },
  });
}

/**
 * Open an EPUB File/Blob in the reader.
 */
async function openBookFile(file, { persist = true, id = null, existingCoverBlob = null } = {}) {
  const loadingEl = $('#loading');
  hideErrorState();
  if (loadingEl) loadingEl.hidden = false;

  try {
    const bookId = id || (await idFor(file));
    const info = await engine.openFile(file);

    currentBook = {
      id: bookId,
      file,
      dir: info.dir,
      title: info.title,
      author: info.author,
      isFixedLayout: info.isFixedLayout,
      demo: !persist && String(bookId).startsWith('demo-'),
    };

    currentState = getState(bookId);

    if (persist) {
      try {
        const coverBlob = existingCoverBlob || (await generateCoverThumbnail(info.book));
        await saveBook({
          id: bookId,
          blob: file,
          coverBlob,
          meta: {
            name: file.name || 'book.epub',
            title: info.title,
            author: info.author,
            dir: info.dir,
            size: file.size || 0,
            openedAt: Date.now(),
          },
        });
        requestPersistentStorage();
      } catch (storageErr) {
        if (
          storageErr?.name === 'QuotaExceededError' ||
          String(storageErr?.message || '').includes('Quota')
        ) {
          showToast(STRINGS.quotaExceededToast);
        } else {
          console.warn('Could not persist book in IndexedDB:', storageErr);
        }
      }
    } else if (!currentBook.demo) {
      // Update openedAt timestamp for existing saved book
      try {
        const existing = await readBook(bookId);
        if (existing) {
          existing.meta = {
            ...existing.meta,
            openedAt: Date.now(),
          };
          if (!existing.coverBlob) {
            existing.coverBlob = await generateCoverThumbnail(info.book);
          }
          await saveBook(existing);
        }
      } catch {
        // Ignore timestamp update errors
      }
    }

    const libraryEl = $('#library');
    const readerEl = $('#reader');
    const titleEl = $('#book-title');

    if (libraryEl) libraryEl.hidden = true;
    if (readerEl) readerEl.hidden = false;
    if (titleEl) {
      titleEl.textContent = info.title;
      titleEl.title = info.title;
    }

    setBookDir(info.dir);
    const progressEl = $('#progress');
    if (progressEl) {
      progressEl.dir = info.dir;
      progressEl.style.direction = info.dir === 'rtl' ? 'rtl' : 'ltr';
    }

    applySettingsToView(engine.view, settings, info.dir);
    await engine.initPosition(currentState);

    settings.lastOpen = bookId;
    settings.onLibrary = false;
    putSettings(settings);

    wakeLock.setState({ enabled: settings.wakeLock, activeReading: true });

    // Expose debug hook required by tests
    globalThis.__reader = {
      get view() {
        return engine.view;
      },
      get state() {
        return currentState;
      },
      next: () => engine.next(),
      prev: () => engine.prev(),
      getLocation: () => engine.getLocation(),
      goToFraction: f => engine.goToFraction(f),
    };

    scheduleChromeHide();
  } catch (err) {
    console.error('Failed to open book:', err);
    const readerEl = $('#reader');
    const libraryEl = $('#library');
    if (readerEl) readerEl.hidden = true;
    if (libraryEl) libraryEl.hidden = false;
      showErrorState(err, () => openBookFile(file, { persist, id, existingCoverBlob }));
  } finally {
    if (loadingEl) loadingEl.hidden = true;
    const fileInput = $('#file-input');
    if (fileInput) fileInput.value = '';
  }
}

/**
 * Fetch and open the configured demo EPUB book.
 */
async function openDemoBook() {
  const loadingEl = $('#loading');
  hideErrorState();
  if (loadingEl) loadingEl.hidden = false;

  const url = resolveDemoBookUrl();
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new ReaderError('demo-offline', `HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const demoFile = new File([blob], 'hebrew.epub', {
      type: 'application/epub+zip',
    });
    await openBookFile(demoFile, {
      persist: false,
      id: `demo-${url}`,
    });
  } catch (err) {
    if (loadingEl) loadingEl.hidden = true;
    const errorToReport =
      err instanceof ReaderError ? err : new ReaderError('demo-offline', err?.message);
    showErrorState(errorToReport, () => openDemoBook());
  }
}

/**
 * Open a book saved in IndexedDB by its ID.
 */
async function openSavedBook(id) {
  if (!id) return;
  if (String(id).startsWith('demo-')) {
    await openDemoBook();
    return;
  }

  try {
    const record = await readBook(id);
    if (!record || !record.blob) {
      settings.lastOpen = null;
      settings.onLibrary = true;
      putSettings(settings);
      await refreshLibrary();
      return;
    }

    const file =
      record.blob instanceof File
        ? record.blob
        : new File([record.blob], record.meta?.name || 'book.epub', {
            type: 'application/epub+zip',
          });

    await openBookFile(file, {
      persist: false,
      id: record.id,
      existingCoverBlob: record.coverBlob || null,
    });
  } catch (err) {
    showErrorState(err, () => openSavedBook(id));
  }
}

/**
 * Open one of the slide-out drawers ('toc' | 'bookmarks' | 'search' | 'settings').
 */
function openDrawerByKind(kind) {
  clearTimeout(chromeTimer);
  document.body.classList.remove('chrome-hidden');

  if (kind === 'toc') {
    drawer.open('toc', STRINGS.tocTitle, container => {
      renderTocDrawer(container, {
        book: engine.book,
        currentLocation: engine.getLocation(),
        bookDir: currentBook?.dir || 'rtl',
        onSelectTarget: async target => {
          await engine.goTo(target);
          drawer.close();
        },
      });
    });
    return;
  }

  if (kind === 'bookmarks') {
    drawer.open('bookmarks', STRINGS.bookmarksTitle, container => {
      renderBookmarksDrawer(container, {
        state: currentState,
        onSelectBookmark: async cfi => {
          await engine.goTo(cfi);
          drawer.close();
        },
        onDeleteBookmark: index => {
          currentState.bookmarks.splice(index, 1);
          persistLocationNow();
          updateBookmarkButton(
            $('#bookmark-btn'),
            currentState,
            engine.getLocation()?.cfi,
          );
          openDrawerByKind('bookmarks');
        },
      });
    });
    return;
  }

  if (kind === 'search') {
    let cancelActiveSearch = null;
    drawer.open(
      'search',
      STRINGS.searchTitle,
      container => {
        cancelActiveSearch = renderSearchDrawer(container, {
          view: engine.view,
          bookDir: currentBook?.dir || 'rtl',
          onSelectResult: async cfi => {
            await engine.goTo(cfi);
            drawer.close();
          },
        });
      },
      {
        onClose: () => {
          cancelActiveSearch?.();
        },
      },
    );
    return;
  }

  if (kind === 'settings') {
    drawer.open('settings', STRINGS.settingsTitle, async container => {
      await renderSettingsDrawer(container, {
        settings,
        wakeLockSupported: wakeLock.isSupported,
        onUpdateSettings: partial => {
          settings = { ...settings, ...partial };
          putSettings(settings);
          applySettingsToView(engine.view, settings, currentBook?.dir || 'rtl');
          wakeLock.setState({
            enabled: settings.wakeLock,
            activeReading: Boolean(currentBook),
          });
        },
        onOpenBookmarks: () => openDrawerByKind('bookmarks'),
        onClearAllData: async () => {
          if (globalThis.confirm(STRINGS.confirmClearAll)) {
            await clearBooks();
            settings = { ...DEFAULT_SETTINGS };
            putSettings(settings);
            applyThemeToDocument(settings);
            drawer.close();
            showToast(STRINGS.dataClearedToast);
            await showLibraryView();
          }
        },
      });
    });
  }
}

/**
 * Keyboard handler for reading navigation.
 */
function handleReaderKeydown(event) {
  if (drawer.isOpen) return;
  if ($('#reader')?.hidden) return;

  const activeTag = document.activeElement?.tagName;
  if (activeTag === 'INPUT' || activeTag === 'SELECT' || activeTag === 'TEXTAREA') {
    return;
  }

  const isRtl = (currentBook?.dir || 'rtl') === 'rtl';

  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    if (isRtl) engine.next();
    else engine.prev();
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    if (isRtl) engine.prev();
    else engine.next();
  } else if (event.key === 'PageDown' || (event.key === ' ' && !event.shiftKey)) {
    event.preventDefault();
    engine.next();
  } else if (event.key === 'PageUp' || (event.key === ' ' && event.shiftKey)) {
    event.preventDefault();
    engine.prev();
  } else if (event.key === 'Home') {
    event.preventDefault();
    engine.goToFraction(0);
  } else if (event.key === 'End') {
    event.preventDefault();
    engine.goToFraction(1);
  }
}

/**
 * Initialize the application, event listeners, migration, and PWA features.
 */
export async function initApp() {
  migrate();
  settings = getSettings();
  applyThemeToDocument(settings);

  // React to system dark/light changes when theme is 'auto'
  globalThis
    .matchMedia?.('(prefers-color-scheme: dark)')
    .addEventListener('change', () => {
      if (settings.theme === 'auto') {
        applySettingsToView(engine.view, settings, currentBook?.dir || 'rtl');
      }
    });

  await refreshLibrary();

  // Library controls
  $('#open-demo')?.addEventListener('click', () => openDemoBook());
  $('#file-input')?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (file) openBookFile(file, { persist: true });
  });

  // Drag & Drop anywhere on the document
  document.addEventListener('dragover', e => {
    e.preventDefault();
    document.body.classList.add('is-dragging');
  });
  document.addEventListener('dragleave', e => {
    if (e.relatedTarget === null) {
      document.body.classList.remove('is-dragging');
    }
  });
  document.addEventListener('drop', e => {
    e.preventDefault();
    document.body.classList.remove('is-dragging');
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      openBookFile(file, { persist: true });
    }
  });

  // Reader Topbar & Drawer controls
  $('#back')?.addEventListener('click', () => showLibraryView());
  $('#toc-btn')?.addEventListener('click', () => openDrawerByKind('toc'));
  $('#bookmarks-btn')?.addEventListener('click', () => openDrawerByKind('bookmarks'));
  $('#search-btn')?.addEventListener('click', () => openDrawerByKind('search'));
  $('#settings-btn')?.addEventListener('click', () => openDrawerByKind('settings'));
  $('#library-settings')?.addEventListener('click', () => openDrawerByKind('settings'));

  // Bookmark toggle button
  $('#bookmark-btn')?.addEventListener('click', () => {
    const loc = engine.getLocation();
    if (!loc?.cfi) return;
    const chapterText = $('#chapter')?.textContent || '';
    toggleBookmarkAtCurrentLocation(currentState, {
      cfi: loc.cfi,
      label: chapterText,
      fraction: loc.fraction,
    });
    persistLocationNow();
    updateBookmarkButton($('#bookmark-btn'), currentState, loc.cfi);
  });

  // Tap Zones
  $('.tap.next')?.addEventListener('click', () => engine.next());
  $('.tap.prev')?.addEventListener('click', () => engine.prev());
  $('.tap.centre')?.addEventListener('click', toggleChrome);

  // Progress bar slider & Go-to-% input
  $('#progress')?.addEventListener('input', e => {
    const val = Number(e.target.value);
    if (Number.isFinite(val)) {
      engine.goToFraction(val / 1000);
    }
  });
  $('#go-percent')?.addEventListener('change', e => {
    const pct = Math.min(100, Math.max(0, Number(e.target.value) || 0));
    e.target.value = String(Math.round(pct));
    engine.goToFraction(pct / 100);
  });

  // Keyboard & Pointer activity
  document.addEventListener('keydown', handleReaderKeydown);
  document.addEventListener('pointermove', handlePointerActivity);

  // Synchronous state saving on lifecycle unload/hide events
  globalThis.addEventListener('pagehide', persistLocationNow);
  globalThis.addEventListener('beforeunload', persistLocationNow);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      persistLocationNow();
    }
  });

  // PWA features: Service Worker, Install Hint, LaunchQueue, Fullscreen
  initServiceWorker({
    onUpdateToast: (msg, triggerUpdate) => {
      showToast(msg, STRINGS.swUpdateBtn, triggerUpdate, 0);
    },
  });
  initInstallBanner($('#install-hint'));
  initLaunchQueue(file => openBookFile(file, { persist: true }));
  initFullscreenControl($('#fullscreen-btn'));

  // Resume last opened book if the user was reading when the app was closed/reloaded
  if (settings.lastOpen && !settings.onLibrary) {
    await openSavedBook(settings.lastOpen);
  }
}
