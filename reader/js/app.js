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
  getLayoutSignature,
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
let resizeTimer = null;
let settingsRelayoutTimer = null;
let lastSettingsRelayoutAt = -1e9;
let lastAttemptAction = null;
let lastTouchTapTime = -1e9;
let lastTapHandledAt = -1e9;
let lastImageTap = { el: null, time: -1e9 };
let imageViewerLastFocused = null;
let imageViewerOpenedAt = -1e9;
let imageZoomState = { scale: 1, tx: 0, ty: 0 };

const boundDocs = new WeakSet();

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
  onPageUpdate: pageInfo => updateReadingFooter(pageInfo),
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
 * Update the subtle reading footer line (page X of Y, pages left in chapter, percent, chapter title)
 * and apply visibility toggles from settings.
 */
function updateReadingFooter(pageInfo = engine.getPageInfo(), loc = engine.getLocation()) {
  const footerEl = $('#reading-footer');
  if (!footerEl) return;

  const pageEl = $('#footer-page');
  const pagesLeftEl = $('#footer-pages-left');
  const percentEl = $('#footer-percent');
  const chapterEl = $('#footer-chapter');

  const fraction = Math.max(0, Math.min(1, Number(loc?.fraction) || 0));
  const percent = fraction >= 1 ? 100 : Math.min(99, Math.floor(fraction * 100));
  const sectionIdx = loc?.section?.current ?? pageInfo?.sectionIndex ?? 0;
  const chapterTitle = loc?.tocItem?.label || STRINGS.chapterFallback(sectionIdx);

  if (pageEl) {
    pageEl.textContent = STRINGS.pageOfTotal(
      pageInfo?.page ?? 1,
      pageInfo?.totalPages ?? 1,
      pageInfo?.isExact ?? true,
    );
    pageEl.hidden = !settings.footerPage;
  }

  if (pagesLeftEl) {
    pagesLeftEl.textContent = STRINGS.pagesLeftInChapter(
      pageInfo?.pagesLeftInChapter ?? 0,
    );
    pagesLeftEl.hidden = !settings.footerPagesLeft;
  }

  if (percentEl) {
    percentEl.textContent = `${percent}%`;
    percentEl.hidden = !settings.footerPercent;
  }

  if (chapterEl) {
    chapterEl.textContent = chapterTitle;
    chapterEl.hidden = !settings.footerChapter;
  }
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
  updateReadingFooter(engine.getPageInfo(), loc);

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
 * Move the reader action buttons (#toc-btn, #bookmark-btn, #bookmarks-btn, #search-btn,
 * #fullscreen-btn, #settings-btn) between the thumb-reachable #bottom-tools bar on phones
 * (<= 640px) and the #topbar slots on wider viewports (> 640px).
 */
function syncResponsiveToolbar() {
  const isPhone = (globalThis.innerWidth || 390) <= 640;
  const bottomTools = $('#bottom-tools');
  const topTocSlot = $('#topbar-toc-slot');
  const topActionsSlot = $('#topbar-actions-slot');
  const tocBtn = $('#toc-btn');
  const actionBtns = [
    $('#bookmark-btn'),
    $('#bookmarks-btn'),
    $('#search-btn'),
    $('#fullscreen-btn'),
    $('#settings-btn'),
  ].filter(Boolean);

  if (!bottomTools || !topTocSlot || !topActionsSlot) return;

  if (isPhone) {
    bottomTools.hidden = false;
    if (tocBtn && tocBtn.parentElement !== bottomTools) {
      bottomTools.appendChild(tocBtn);
    }
    for (const btn of actionBtns) {
      if (btn.parentElement !== bottomTools) {
        bottomTools.appendChild(btn);
      }
    }
  } else {
    bottomTools.hidden = true;
    if (tocBtn && tocBtn.parentElement !== topTocSlot) {
      topTocSlot.appendChild(tocBtn);
    }
    for (const btn of actionBtns) {
      if (btn.parentElement !== topActionsSlot) {
        topActionsSlot.appendChild(btn);
      }
    }
  }
}

/**
 * Convert client coordinates from inside a book section document (iframe) to host viewport coordinates.
 */
function toHostCoords(doc, clientX, clientY) {
  if (!doc || doc === document) {
    return { x: clientX, y: clientY };
  }
  const frame = doc.__hostFrame || doc.defaultView?.frameElement;
  if (!frame) {
    return { x: clientX, y: clientY };
  }
  const rect = frame.getBoundingClientRect();
  const scaleX = frame.offsetWidth ? rect.width / frame.offsetWidth : 1;
  const scaleY = frame.offsetHeight ? rect.height / frame.offsetHeight : 1;
  return {
    x: rect.left + clientX * scaleX,
    y: rect.top + clientY * scaleY,
  };
}

/**
 * Open a book image in the full-screen pinch-zoomable image viewer overlay.
 */
function openImageViewer(imgEl, triggerEl = null) {
  const viewer = $('#image-viewer');
  const targetImg = $('#image-viewer-img');
  if (!viewer || !targetImg || !imgEl) return;

  const innerImage =
    imgEl.tagName?.toLowerCase() === 'svg' ? imgEl.querySelector?.('image, img') : null;
  const candidate = innerImage || imgEl;

  let src =
    candidate.currentSrc ||
    (typeof candidate.src === 'string' ? candidate.src : '') ||
    (typeof candidate.href === 'string' ? candidate.href : candidate.href?.baseVal) ||
    candidate.getAttribute?.('src') ||
    candidate.getAttribute?.('href') ||
    candidate.getAttribute?.('xlink:href') ||
    candidate.getAttributeNS?.('http://www.w3.org/1999/xlink', 'href');

  const svgRoot = imgEl.tagName?.toLowerCase() === 'svg' ? imgEl : imgEl.closest?.('svg');
  if (!src && svgRoot) {
    const serialized = new XMLSerializer().serializeToString(svgRoot);
    src = `data:image/svg+xml;utf8,${encodeURIComponent(serialized)}`;
  }
  if (!src) return;

  imageViewerLastFocused = triggerEl || document.activeElement;
  imageViewerOpenedAt = performance.now();
  imageZoomState = { scale: 1, tx: 0, ty: 0 };
  targetImg.src = src;
  targetImg.alt = imgEl.getAttribute?.('alt') || STRINGS.untitledBook;
  targetImg.style.transform = 'translate(0px, 0px) scale(1)';
  viewer.hidden = false;
  $('#image-viewer-close')?.focus();
}

function closeImageViewer() {
  const viewer = $('#image-viewer');
  if (!viewer || viewer.hidden) return;
  viewer.hidden = true;
  const targetImg = $('#image-viewer-img');
  if (targetImg) {
    targetImg.src = '';
    targetImg.style.transform = '';
  }
  if (imageViewerLastFocused && typeof imageViewerLastFocused.focus === 'function') {
    try {
      imageViewerLastFocused.focus();
    } catch {
      // Ignore focus errors
    }
  }
  imageViewerLastFocused = null;
}

function initImageViewerControls() {
  const viewer = $('#image-viewer');
  const closeBtn = $('#image-viewer-close');
  const stage = $('#image-viewer-stage');
  const img = $('#image-viewer-img');
  if (!viewer || !stage || !img) return;

  const applyTransform = () => {
    img.style.transform = `translate(${imageZoomState.tx}px, ${imageZoomState.ty}px) scale(${imageZoomState.scale})`;
  };

  closeBtn?.addEventListener('click', () => {
    if (performance.now() - imageViewerOpenedAt < 250) return;
    closeImageViewer();
  });
  stage.addEventListener('click', e => {
    if (performance.now() - imageViewerOpenedAt < 350) return;
    if (e.target === stage) closeImageViewer();
  });

  img.addEventListener('dblclick', e => {
    e.preventDefault();
    imageZoomState =
      imageZoomState.scale > 1.1
        ? { scale: 1, tx: 0, ty: 0 }
        : { scale: 2.2, tx: 0, ty: 0 };
    applyTransform();
  });

  let gesture = null;
  let lastTapAt = 0;

  stage.addEventListener(
    'touchstart',
    e => {
      if (e.touches.length === 2) {
        const [t1, t2] = e.touches;
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        gesture = {
          mode: 'pinch',
          startDist: Math.max(10, dist),
          baseScale: imageZoomState.scale,
        };
      } else if (e.touches.length === 1) {
        const t = e.touches[0];
        gesture = {
          mode: 'pan',
          startX: t.clientX,
          startY: t.clientY,
          baseTx: imageZoomState.tx,
          baseTy: imageZoomState.ty,
          moved: false,
          target: e.target,
        };
      }
    },
    { passive: true },
  );

  stage.addEventListener(
    'touchmove',
    e => {
      if (!gesture) return;
      if (gesture.mode === 'pinch' && e.touches.length === 2) {
        if (e.cancelable) e.preventDefault();
        const [t1, t2] = e.touches;
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        imageZoomState.scale = Math.max(1, Math.min(4, gesture.baseScale * (dist / gesture.startDist)));
        if (imageZoomState.scale === 1) {
          imageZoomState.tx = 0;
          imageZoomState.ty = 0;
        }
        applyTransform();
      } else if (gesture.mode === 'pan' && e.touches.length === 1) {
        const t = e.touches[0];
        const dx = t.clientX - gesture.startX;
        const dy = t.clientY - gesture.startY;
        if (Math.hypot(dx, dy) > 8) gesture.moved = true;
        if (imageZoomState.scale > 1.05) {
          if (e.cancelable) e.preventDefault();
          imageZoomState.tx = gesture.baseTx + dx;
          imageZoomState.ty = gesture.baseTy + dy;
          applyTransform();
        }
      }
    },
    { passive: false },
  );

  stage.addEventListener(
    'touchend',
    e => {
      if (!gesture) return;
      const g = gesture;
      gesture = null;
      if (g.mode === 'pan' && !g.moved && e.touches.length === 0) {
        const now = performance.now();
        if (g.target === img && now - lastTapAt < 340) {
          imageZoomState =
            imageZoomState.scale > 1.1
              ? { scale: 1, tx: 0, ty: 0 }
              : { scale: 2.2, tx: 0, ty: 0 };
          applyTransform();
          lastTapAt = 0;
        } else if (g.target === stage && imageZoomState.scale <= 1.05) {
          closeImageViewer();
        } else {
          lastTapAt = now;
        }
      }
    },
    { passive: true },
  );
}

/**
 * Resolve the actual DOM element inside the active section document at (hostX, hostY)
 * when an event is retargeted to <foliate-view> across its closed shadow root.
 */
function resolveBookElement(target, doc, hostX, hostY) {
  const baseEl = target?.nodeType === 1 ? target : target?.parentElement;
  if (doc && doc !== document && baseEl) {
    return { el: baseEl, sectionDoc: doc };
  }
  const contents = engine.view?.renderer?.getContents?.() || [];
  for (const item of contents) {
    const sDoc = item?.doc;
    const frame = sDoc?.__hostFrame || sDoc?.defaultView?.frameElement;
    if (!sDoc || !frame) continue;
    const rect = frame.getBoundingClientRect();
    if (
      hostX >= rect.left &&
      hostX <= rect.right &&
      hostY >= rect.top &&
      hostY <= rect.bottom
    ) {
      const localX = hostX - rect.left;
      const localY = hostY - rect.top;
      const hit = sDoc.elementFromPoint?.(localX, localY);
      if (hit) {
        return { el: hit, sectionDoc: sDoc };
      }
    }
  }
  return { el: baseEl, sectionDoc: doc };
}

/**
 * Evaluate a tap inside the book viewport or iframe document and trigger
 * direction-aware page turn (left/right third) or chrome toggle (centre),
 * while ignoring drags, text selections, links, and images.
 */
function handleViewerTap({ hostX, hostY, target, doc }) {
  const now = performance.now();
  if (now - lastTapHandledAt < 60) return;
  if ($('#reader')?.hidden || !$('#image-viewer')?.hidden) return;
  if (drawer.isOpen) {
    if (drawer.currentKind === 'settings') {
      lastTapHandledAt = now;
      drawer.close();
    }
    return;
  }
  if ((globalThis.visualViewport?.scale ?? 1) > 1.05) return;

  const { el, sectionDoc } = resolveBookElement(target, doc, hostX, hostY);

  const sel = sectionDoc?.getSelection?.() || globalThis.getSelection?.();
  if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) {
    return;
  }

  if (
    el?.closest?.(
      'a[href], button, input, select, textarea, label, summary, details, audio, video, [role="button"]',
    )
  ) {
    return;
  }

  const mediaEl = el?.closest?.('img, svg, image');
  if (mediaEl && sectionDoc && sectionDoc !== document) {
    if (!currentBook?.isFixedLayout) {
      if (lastImageTap.el === mediaEl && now - lastImageTap.time < 360) {
        lastImageTap = { el: null, time: -1e9 };
        lastTapHandledAt = now;
        openImageViewer(mediaEl);
      } else {
        lastImageTap = { el: mediaEl, time: now };
      }
    }
    return;
  }

  const wrapRect = $('#viewer-wrap')?.getBoundingClientRect();
  if (!wrapRect || wrapRect.width <= 0) return;

  const relX = (hostX - wrapRect.left) / wrapRect.width;
  if (relX < 0 || relX > 1) return;

  lastTapHandledAt = now;
  const isRtl = (currentBook?.dir || 'rtl') === 'rtl';

  if (relX < 0.3) {
    if (isRtl) engine.next();
    else engine.prev();
  } else if (relX > 0.7) {
    if (isRtl) engine.prev();
    else engine.next();
  } else {
    toggleChrome();
  }
}

/**
 * Attach tap, double-click (image zoom), keyboard, and pointer listeners to a section document or host.
 */
function bindSurfaceInteractions(targetNode, doc = null) {
  if (!targetNode || boundDocs.has(targetNode)) return;
  boundDocs.add(targetNode);

  let touchInfo = null;
  let pointerInfo = null;

  targetNode.addEventListener(
    'touchstart',
    e => {
      if (e.touches.length !== 1) {
        if (touchInfo) touchInfo.multi = true;
        return;
      }
      const t = e.changedTouches[0];
      if (!t) return;
      const { x, y } = toHostCoords(doc, t.clientX, t.clientY);
      touchInfo = {
        hostX: x,
        hostY: y,
        screenX: t.screenX,
        screenY: t.screenY,
        time: performance.now(),
        moved: false,
        multi: false,
        target: e.target,
      };
    },
    { passive: true },
  );

  targetNode.addEventListener(
    'touchmove',
    e => {
      if (!touchInfo) return;
      if (e.touches.length > 1) {
        touchInfo.multi = true;
        return;
      }
      const t = e.changedTouches[0];
      if (!t) return;
      if (Math.hypot(t.screenX - touchInfo.screenX, t.screenY - touchInfo.screenY) > 10) {
        touchInfo.moved = true;
      }
    },
    { passive: true },
  );

  targetNode.addEventListener(
    'touchend',
    e => {
      if (!touchInfo) return;
      const info = touchInfo;
      touchInfo = null;
      const t = e.changedTouches?.[0];
      if (t && Math.hypot(t.screenX - info.screenX, t.screenY - info.screenY) > 10) {
        info.moved = true;
      }
      const duration = performance.now() - info.time;
      if (!info.moved && !info.multi && duration < 450) {
        lastTouchTapTime = performance.now();
        handleViewerTap({
          hostX: info.hostX,
          hostY: info.hostY,
          target: info.target,
          doc,
        });
      }
    },
    { passive: true },
  );

  targetNode.addEventListener(
    'pointerdown',
    e => {
      if (e.pointerType === 'touch') return;
      pointerInfo = {
        screenX: e.screenX,
        screenY: e.screenY,
        time: performance.now(),
      };
    },
    { passive: true },
  );

  targetNode.addEventListener('click', e => {
    if (performance.now() - lastTouchTapTime < 450) return;
    if (pointerInfo) {
      const dist = Math.hypot(e.screenX - pointerInfo.screenX, e.screenY - pointerInfo.screenY);
      pointerInfo = null;
      if (dist > 10) return;
    }
    const { x, y } = toHostCoords(doc, e.clientX, e.clientY);
    handleViewerTap({
      hostX: x,
      hostY: y,
      target: e.target,
      doc,
    });
  });

  if (doc && doc !== document) {
    doc.addEventListener('dblclick', e => {
      if (currentBook?.isFixedLayout) return;
      const el = e.target?.nodeType === 1 ? e.target : e.target?.parentElement;
      const mediaEl = el?.closest?.('img, svg, image');
      if (mediaEl) {
        e.preventDefault();
        openImageViewer(mediaEl);
      }
    });
  }
}

/**
 * Handle section `load` events from the foliate engine:
 * apply user typography/theme styles and attach keyboard/tap navigation inside the iframe.
 */
function handleSectionLoad({ doc }) {
  applySettingsToView(engine.view, settings, currentBook?.dir || 'rtl');
  if (doc) {
    doc.addEventListener('keydown', handleReaderKeydown);
    doc.addEventListener('pointermove', handlePointerActivity);
    bindSurfaceInteractions(doc, doc);
  }
}

let chromeRevealedByMouseAt = -1e9;

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
  closeImageViewer();
  document.body.classList.remove('chrome-hidden');
  document.body.classList.remove('is-reading');

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
    document.body.classList.add('is-reading');
    syncResponsiveToolbar();
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
    const sig = getLayoutSignature(engine.view, settings);
    engine.recalculatePages(bookId, sig);
    updateReadingFooter();

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
      getPageInfo: () => engine.getPageInfo(),
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
 * Open one of the slide-out drawers / bottom sheets ('toc' | 'bookmarks' | 'search' | 'settings').
 */
function openDrawerByKind(kind, triggerEl = null) {
  clearTimeout(chromeTimer);
  document.body.classList.remove('chrome-hidden');

  if (kind === 'toc') {
    drawer.open(
      'toc',
      STRINGS.tocTitle,
      container => {
        renderTocDrawer(container, {
          book: engine.book,
          currentLocation: engine.getLocation(),
          bookDir: currentBook?.dir || 'rtl',
          onSelectTarget: async target => {
            await engine.goTo(target);
            drawer.close();
          },
        });
      },
      { triggerEl },
    );
    return;
  }

  if (kind === 'bookmarks') {
    drawer.open(
      'bookmarks',
      STRINGS.bookmarksTitle,
      container => {
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
            openDrawerByKind('bookmarks', triggerEl);
          },
        });
      },
      { triggerEl },
    );
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
        triggerEl,
        onClose: () => {
          cancelActiveSearch?.();
        },
      },
    );
    return;
  }

  if (kind === 'settings') {
    if (currentBook && engine.view?.book) {
      engine.captureSettingsAnchor();
    }

    const flushSettingsRelayout = () => {
      clearTimeout(settingsRelayoutTimer);
      settingsRelayoutTimer = null;
      lastSettingsRelayoutAt = performance.now();
      if (!currentBook || !engine.view?.book) return;
      applySettingsToView(engine.view, settings, currentBook.dir || 'rtl');
      engine.reanchorToSettingsAnchor();
      const sig = getLayoutSignature(engine.view, settings);
      engine.recalculatePages(currentBook.id, sig);
      updateReadingFooter();
      persistLocationNow();
    };

    drawer.open(
      'settings',
      STRINGS.settingsTitle,
      async container => {
        await renderSettingsDrawer(container, {
          settings,
          wakeLockSupported: wakeLock.isSupported,
          onUpdateSettings: (partial, meta = {}) => {
            settings = { ...settings, ...partial };
            putSettings(settings);
            applyThemeToDocument(settings);
            wakeLock.setState({
              enabled: settings.wakeLock,
              activeReading: Boolean(currentBook),
            });
            updateReadingFooter();

            if (!currentBook || !engine.view?.book) return;

            const key = meta?.key || Object.keys(partial)[0] || '';
            const isNonLayoutOnly =
              key === 'theme' ||
              key === 'wakeLock' ||
              key === 'footerPage' ||
              key === 'footerPagesLeft' ||
              key === 'footerPercent' ||
              key === 'footerChapter';

            if (isNonLayoutOnly) {
              applySettingsToView(engine.view, settings, currentBook.dir || 'rtl');
              updateReadingFooter();
            } else if (meta?.type === 'input') {
              const now = performance.now();
              if (now - lastSettingsRelayoutAt >= 120 && !settingsRelayoutTimer) {
                flushSettingsRelayout();
              } else {
                clearTimeout(settingsRelayoutTimer);
                settingsRelayoutTimer = setTimeout(flushSettingsRelayout, 120);
              }
            } else {
              flushSettingsRelayout();
            }
          },
          onOpenBookmarks: () => openDrawerByKind('bookmarks', triggerEl),
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
      },
      {
        triggerEl,
        onClose: () => {
          if (settingsRelayoutTimer) {
            flushSettingsRelayout();
          }
          engine.clearSettingsAnchor();
        },
      },
    );
  }
}

/**
 * Keyboard handler for reading navigation.
 */
function handleReaderKeydown(event) {
  if (!$('#image-viewer')?.hidden) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeImageViewer();
    }
    return;
  }
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

  // Reader Topbar / Bottom Bar & Drawer controls
  syncResponsiveToolbar();
  initImageViewerControls();
  bindSurfaceInteractions($('#view'), document);

  $('#back')?.addEventListener('click', () => showLibraryView());
  $('#toc-btn')?.addEventListener('click', e => openDrawerByKind('toc', e.currentTarget));
  $('#bookmarks-btn')?.addEventListener('click', e => openDrawerByKind('bookmarks', e.currentTarget));
  $('#search-btn')?.addEventListener('click', e => openDrawerByKind('search', e.currentTarget));
  $('#settings-btn')?.addEventListener('click', e => openDrawerByKind('settings', e.currentTarget));
  $('#library-settings')?.addEventListener('click', e => openDrawerByKind('settings', e.currentTarget));

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

  // Keyboard-accessible / assistive Tap Zone buttons
  $('.tap.next')?.addEventListener('click', e => {
    e.stopPropagation();
    engine.next();
  });
  $('.tap.prev')?.addEventListener('click', e => {
    e.stopPropagation();
    engine.prev();
  });
  $('.tap.centre')?.addEventListener('click', e => {
    e.stopPropagation();
    toggleChrome();
  });

  // Debounced viewport / orientation resize handler: sync toolbar and preserve exact CFI position
  globalThis.addEventListener('resize', () => {
    syncResponsiveToolbar();
    if ($('#reader')?.hidden || !currentBook) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(async () => {
      await engine.restoreStablePosition();
      if (currentBook && engine.view?.book) {
        const sig = getLayoutSignature(engine.view, settings);
        engine.recalculatePages(currentBook.id, sig);
        updateReadingFooter();
      }
    }, 50);
  });

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
