import { STRINGS } from './he.js';
import { validateEpubFile } from './errors.js';
import { getPageCache, putPageCache } from './storage.js';

const RTL_LANG_REGEX = /^(he|iw|yi|ji|ar|fa|ur)\b/i;

/**
 * Extract a display string from foliate metadata fields (which may be strings, arrays, or language maps).
 */
export function formatMetadataValue(value) {
  if (!value) return '';
  if (Array.isArray(value)) {
    return value
      .map(item => formatMetadataValue(item))
      .filter(Boolean)
      .join(', ');
  }
  if (typeof value === 'object') {
    if ('name' in value) return formatMetadataValue(value.name);
    const vals = Object.values(value).filter(v => typeof v === 'string' && v.trim());
    return vals[0] || '';
  }
  return String(value).trim();
}

/**
 * Determine the reading direction ('rtl' or 'ltr') of a foliate book instance.
 */
export function resolveBookDirection(book) {
  if (book?.dir === 'rtl' || book?.dir === 'ltr') {
    return book.dir;
  }
  const rawLang = book?.metadata?.language;
  const langs = Array.isArray(rawLang) ? rawLang : [rawLang];
  for (const lang of langs) {
    if (typeof lang === 'string' && RTL_LANG_REGEX.test(lang.trim())) {
      return 'rtl';
    }
  }
  return 'ltr';
}

function nextFrame() {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wrapper around <foliate-view> providing lazy engine loading, direction management,
 * normalized progress reporting (reaching 1.0 / 100% at book end in both paginated & scrolled flows),
 * and defensive next()/prev() navigation that never gets stuck.
 */
export class ReaderEngine {
  constructor({ viewElement, onRelocate, onSectionLoad, onPageUpdate }) {
    this.view = viewElement;
    this.onRelocate = onRelocate;
    this.onSectionLoad = onSectionLoad;
    this.onPageUpdate = onPageUpdate;
    this.book = null;
    this.dir = 'rtl';
    this.#navChain = Promise.resolve();
    this.#boundRelocate = this.#handleRelocate.bind(this);
    this.#boundLoad = this.#handleLoad.bind(this);
    this.#boundSwipeTurn = this.#handleSwipeTurn.bind(this);
    this.#boundRendererScroll = this.#handleRendererScroll.bind(this);
    this.#boundHostFontLoad = () => this.#handleFontLoad(this.#getCurrentSectionIndex());
    document.fonts?.addEventListener?.('loadingdone', this.#boundHostFontLoad);
  }

  #navChain;
  #boundRelocate;
  #boundLoad;
  #boundSwipeTurn;
  #boundRendererScroll;
  #boundHostFontLoad;
  #navBusy = 0;
  #stablePosition = null;
  #isRestoringResize = false;
  #isApplyingSettings = false;
  #settingsAnchor = null;
  #bookId = null;
  #layoutSignature = '';
  #sectionPages = [];
  #sectionExact = [];
  #sectionChars = [];
  #calcRunId = 0;
  #idleHandle = null;
  #idleIsTimeout = false;
  #scrollRaf = null;

  #handleSwipeTurn(event) {
    const dir = event?.detail?.dir;
    if (dir === 1) this.next();
    else if (dir === -1) this.prev();
  }

  #handleRendererScroll() {
    if (!this.view?.renderer?.scrolled || !this.book) return;
    if (this.#scrollRaf != null) return;
    this.#scrollRaf = requestAnimationFrame(() => {
      this.#scrollRaf = null;
      if (!this.view?.renderer?.scrolled || !this.book) return;
      const loc = this.view.lastLocation;
      if (loc) {
        const normalizedFraction = this.#computeNormalizedFraction(loc);
        loc.fraction = normalizedFraction;
      }
      this.onPageUpdate?.(this.getPageInfo());
      if (loc) {
        this.onRelocate?.(loc);
      }
    });
  }

  #handleFontLoad(sectionIndex) {
    if (!this.view?.book || !this.view?.renderer) return;
    const curIdx = this.#getCurrentSectionIndex();
    if (typeof sectionIndex === 'number' && sectionIndex !== curIdx) return;
    const prevPages = this.#sectionPages[curIdx];
    const { sectionPages } = this.#getLiveSectionPageMetrics(curIdx);
    if (prevPages && sectionPages !== prevPages && this.#layoutSignature) {
      this.recalculatePages(this.#bookId, this.#layoutSignature, { force: true });
    } else {
      this.onPageUpdate?.(this.getPageInfo());
    }
  }

  /**
   * Lazy-load the foliate-js custom element module only when opening a book.
   */
  async ensureEngineLoaded() {
    if (!customElements.get('foliate-view')) {
      await import('../vendor/foliate-js/view.js');
    }
  }

  /**
   * Validate and open an EPUB File/Blob in <foliate-view>.
   */
  async openFile(file) {
    await validateEpubFile(file);
    await this.ensureEngineLoaded();

    this.close();

    this.view.addEventListener('relocate', this.#boundRelocate);
    this.view.addEventListener('load', this.#boundLoad);

    await this.view.open(file);
    this.book = this.view.book;
    this.dir = resolveBookDirection(this.book);

    // Ensure book.dir and renderer.bookDir reflect resolved direction
    this.book.dir = this.dir;
    if (this.view.renderer) {
      this.view.renderer.bookDir = this.dir;
      this.view.renderer.addEventListener('swipe-turn', this.#boundSwipeTurn);
      this.view.renderer.addEventListener('scroll', this.#boundRendererScroll);
    }

    const title = formatMetadataValue(this.book.metadata?.title) || file.name || STRINGS.untitledBook;
    const author =
      formatMetadataValue(this.book.metadata?.author || this.book.metadata?.creator) ||
      STRINGS.unknownAuthor;

    return {
      book: this.book,
      dir: this.dir,
      title,
      author,
      isFixedLayout: Boolean(this.view.isFixedLayout),
    };
  }

  /**
   * Initialize reading position from saved state (CFI or fraction) or start of book.
   */
  async initPosition(savedState = {}) {
    if (!this.view?.book) return;

    let lastLocation = null;
    if (typeof savedState.cfi === 'string' && savedState.cfi.trim()) {
      lastLocation = savedState.cfi;
    } else if (typeof savedState.fraction === 'number' && savedState.fraction > 0) {
      lastLocation = { fraction: savedState.fraction };
    }

    try {
      await this.view.init({
        lastLocation,
        showTextStart: !lastLocation,
      });
    } catch {
      // Fallback if saved CFI couldn't be resolved
      await this.view.init({
        lastLocation: null,
        showTextStart: true,
      });
    }
  }

  /**
   * Close the currently open book and clean up listeners.
   */
  close() {
    this.#cancelBackgroundCalc();
    if (this.#scrollRaf != null) {
      cancelAnimationFrame(this.#scrollRaf);
      this.#scrollRaf = null;
    }
    if (!this.view) return;
    this.view.removeEventListener('relocate', this.#boundRelocate);
    this.view.removeEventListener('load', this.#boundLoad);
    this.view.renderer?.removeEventListener?.('swipe-turn', this.#boundSwipeTurn);
    this.view.renderer?.removeEventListener?.('scroll', this.#boundRendererScroll);
    try {
      this.view.close?.();
    } catch {
      // Ignore close errors
    }
    this.book = null;
    this.#stablePosition = null;
    this.#settingsAnchor = null;
    this.#bookId = null;
    this.#layoutSignature = '';
    this.#sectionPages = [];
    this.#sectionExact = [];
    this.#sectionChars = [];
  }

  #cancelBackgroundCalc() {
    this.#calcRunId++;
    if (this.#idleHandle != null) {
      if (this.#idleIsTimeout) {
        clearTimeout(this.#idleHandle);
      } else {
        globalThis.cancelIdleCallback?.(this.#idleHandle);
      }
      this.#idleHandle = null;
    }
  }

  #waitIdle() {
    return new Promise(resolve => {
      if (typeof globalThis.requestIdleCallback === 'function') {
        this.#idleIsTimeout = false;
        this.#idleHandle = globalThis.requestIdleCallback(
          () => {
            this.#idleHandle = null;
            resolve();
          },
          { timeout: 35 },
        );
      } else {
        this.#idleIsTimeout = true;
        this.#idleHandle = setTimeout(() => {
          this.#idleHandle = null;
          resolve();
        }, 10);
      }
    });
  }

  #getLiveSectionPageMetrics(currentIndex) {
    const renderer = this.view?.renderer;
    if (!renderer || this.view?.isFixedLayout) {
      return { sectionPage: 1, sectionPages: 1 };
    }
    const loadedIndex = renderer.getContents?.()?.[0]?.index;
    const isCurrentLoaded = typeof loadedIndex === 'number' ? loadedIndex === currentIndex : true;
    if (!isCurrentLoaded) {
      const fallbackTotal = Math.max(1, this.#sectionPages[currentIndex] || 1);
      return { sectionPage: 1, sectionPages: fallbackTotal };
    }

    if (renderer.scrolled) {
      const size = renderer.size || 0;
      const viewSize = renderer.viewSize || 0;
      const start = renderer.start || 0;
      const end = renderer.end || start + size;
      const sectionPages = size > 0 ? Math.max(1, Math.ceil((viewSize - 1) / size)) : 1;
      let sectionPage = 1;
      if (size > 0) {
        if (viewSize > 0 && viewSize - end <= 4) {
          sectionPage = sectionPages;
        } else {
          sectionPage = Math.min(sectionPages, Math.max(1, Math.floor(start / size) + 1));
        }
      }
      return { sectionPage, sectionPages };
    }

    const rawPages = renderer.pages || 3;
    const sectionPages = Math.max(1, rawPages - 2);
    const rawPage = renderer.page ?? 1;
    const sectionPage = Math.min(sectionPages, Math.max(1, rawPage));
    return { sectionPage, sectionPages };
  }

  #updateEstimatesFromMeasured() {
    const sections = this.book?.sections || [];
    if (!sections.length) return;

    let measuredPages = 0;
    let measuredChars = 0;
    let measuredBytes = 0;

    for (let i = 0; i < sections.length; i++) {
      if (sections[i]?.linear === 'no' || !this.#sectionExact[i]) continue;
      const pages = Math.max(1, this.#sectionPages[i] || 1);
      measuredPages += pages;
      if (this.#sectionChars[i] > 0) {
        measuredChars += this.#sectionChars[i];
      }
      measuredBytes += Math.max(1, sections[i]?.size || 1000);
    }

    if (measuredPages <= 0) return;

    const charsPerPage = measuredChars > 0 ? measuredChars / measuredPages : 0;
    const bytesPerPage = measuredBytes > 0 ? measuredBytes / measuredPages : 1500;

    for (let i = 0; i < sections.length; i++) {
      if (sections[i]?.linear === 'no') {
        this.#sectionPages[i] = 0;
        continue;
      }
      if (this.#sectionExact[i]) continue;

      if (charsPerPage > 0 && this.#sectionChars[i] > 0) {
        this.#sectionPages[i] = Math.max(1, Math.round(this.#sectionChars[i] / charsPerPage));
      } else {
        const secBytes = Math.max(1, sections[i]?.size || 1000);
        this.#sectionPages[i] = Math.max(1, Math.round(secBytes / bytesPerPage));
      }
    }
  }

  /**
   * Return current relative page numbering (book-wide X of Y, estimate vs exact, and chapter pages left).
   */
  getPageInfo() {
    if (!this.view?.book || !this.view?.renderer) {
      return {
        page: 1,
        totalPages: 1,
        isExact: true,
        sectionPage: 1,
        sectionPages: 1,
        pagesLeftInChapter: 0,
        sectionIndex: 0,
      };
    }

    const sections = this.book?.sections || [];
    const currentIndex = this.#getCurrentSectionIndex();
    const { sectionPage, sectionPages } = this.#getLiveSectionPageMetrics(currentIndex);

    if (
      this.#sectionPages.length === sections.length &&
      sections[currentIndex]?.linear !== 'no'
    ) {
      this.#sectionPages[currentIndex] = sectionPages;
      this.#sectionExact[currentIndex] = true;
    }

    let pagesBefore = 0;
    let totalPages = 0;
    for (let i = 0; i < sections.length; i++) {
      if (sections[i]?.linear === 'no') continue;
      const count =
        i === currentIndex ? sectionPages : Math.max(1, this.#sectionPages[i] || 1);
      if (i < currentIndex) {
        pagesBefore += count;
      }
      totalPages += count;
    }

    totalPages = Math.max(1, totalPages);
    let page = Math.min(totalPages, Math.max(1, pagesBefore + sectionPage));
    if (this.isAtBookEnd()) {
      page = totalPages;
    }

    const pagesLeftInChapter = Math.max(0, sectionPages - sectionPage);
    const isExact =
      Boolean(this.view.isFixedLayout) ||
      (this.#sectionExact.length === sections.length && this.#sectionExact.every(Boolean));

    return {
      page,
      totalPages,
      isExact,
      sectionPage,
      sectionPages,
      pagesLeftInChapter,
      sectionIndex: currentIndex,
    };
  }

  /**
   * Compute or recalculate book-wide page counts for the current layout signature:
   * 1) Instant exact hit if cached in localStorage for (bookId, signature)
   * 2) Otherwise exact current section from live renderer + character/size scaled estimate for others
   * 3) Progressive background refinement in a hidden measuring container during idle time
   */
  recalculatePages(bookId, signature, { force = false } = {}) {
    if (!this.view?.book || !this.view?.renderer) return;
    if (bookId) this.#bookId = bookId;
    const sections = this.book.sections || [];
    if (!sections.length) return;

    if (
      !force &&
      signature &&
      signature === this.#layoutSignature &&
      this.#sectionPages.length === sections.length
    ) {
      this.onPageUpdate?.(this.getPageInfo());
      return;
    }

    this.#cancelBackgroundCalc();
    const runId = this.#calcRunId;
    if (signature) this.#layoutSignature = signature;

    if (this.view.isFixedLayout) {
      this.#sectionPages = sections.map(s => (s.linear === 'no' ? 0 : 1));
      this.#sectionExact = sections.map(() => true);
      this.onPageUpdate?.(this.getPageInfo());
      return;
    }

    const cached = getPageCache(this.#bookId, this.#layoutSignature);
    if (cached && cached.length === sections.length) {
      this.#sectionPages = [...cached];
      this.#sectionExact = sections.map(() => true);
      const curIdx = this.#getCurrentSectionIndex();
      const { sectionPages } = this.#getLiveSectionPageMetrics(curIdx);
      if (sections[curIdx]?.linear !== 'no') {
        this.#sectionPages[curIdx] = sectionPages;
      }
      this.onPageUpdate?.(this.getPageInfo());
      return;
    }

    if (this.#sectionChars.length !== sections.length) {
      this.#sectionChars = new Array(sections.length).fill(0);
    }

    this.#sectionPages = sections.map(s => (s.linear === 'no' ? 0 : 1));
    this.#sectionExact = sections.map(s => s.linear === 'no');

    const curIdx = this.#getCurrentSectionIndex();
    const { sectionPages } = this.#getLiveSectionPageMetrics(curIdx);
    if (sections[curIdx]?.linear !== 'no') {
      this.#sectionPages[curIdx] = sectionPages;
      this.#sectionExact[curIdx] = true;
    }

    const liveDoc = this.view.renderer?.getContents?.()?.[0]?.doc;
    if (liveDoc?.body && !this.#sectionChars[curIdx]) {
      this.#sectionChars[curIdx] = Math.max(1, (liveDoc.body.textContent || '').length);
    }

    this.#updateEstimatesFromMeasured();
    this.onPageUpdate?.(this.getPageInfo());

    this.#runBackgroundMeasure(runId, this.#layoutSignature);
  }

  async #runBackgroundMeasure(runId, signature) {
    const sections = this.book?.sections || [];
    if (!sections.length) return;

    // 1. Extract character lengths for all sections (once per book) for tight initial estimates
    let newCharsLoaded = false;
    for (let i = 0; i < sections.length; i++) {
      if (runId !== this.#calcRunId || !this.book) return;
      if (sections[i]?.linear === 'no' || this.#sectionChars[i] > 0) continue;
      try {
        const doc = await sections[i].createDocument?.();
        if (runId !== this.#calcRunId || !this.book) return;
        this.#sectionChars[i] = Math.max(1, (doc?.body?.textContent || '').length);
        newCharsLoaded = true;
      } catch {
        this.#sectionChars[i] = Math.max(1, sections[i]?.size || 1000);
      }
    }
    if (newCharsLoaded && runId === this.#calcRunId) {
      this.#updateEstimatesFromMeasured();
      this.onPageUpdate?.(this.getPageInfo());
    }

    // 2. Measure sections off-screen in idle time: prioritize sections <= currentIndex so X stabilizes first
    const curIdx = this.#getCurrentSectionIndex();
    const order = [];
    for (let i = 0; i <= curIdx && i < sections.length; i++) {
      if (!this.#sectionExact[i]) order.push(i);
    }
    for (let i = curIdx + 1; i < sections.length; i++) {
      if (!this.#sectionExact[i]) order.push(i);
    }

    for (const idx of order) {
      await this.#waitIdle();
      if (runId !== this.#calcRunId || !this.book || !this.view?.renderer) return;
      while (this.#navBusy > 0) {
        await delay(25);
        if (runId !== this.#calcRunId || !this.book) return;
      }
      if (this.#sectionExact[idx]) continue;

      const activeIdx = this.#getCurrentSectionIndex();
      const loadedIdx = this.view.renderer.getContents?.()?.[0]?.index;
      if (activeIdx === idx && loadedIdx === idx) {
        const { sectionPages } = this.#getLiveSectionPageMetrics(idx);
        this.#sectionPages[idx] = sectionPages;
        this.#sectionExact[idx] = true;
      } else {
        try {
          const res = await this.view.renderer.measureSection?.(sections[idx]);
          if (runId !== this.#calcRunId || !this.book) return;
          if (res && typeof res.pages === 'number' && res.pages >= 1) {
            this.#sectionPages[idx] = res.pages;
            if (res.charCount > 0) this.#sectionChars[idx] = res.charCount;
            this.#sectionExact[idx] = true;
          } else {
            this.#sectionExact[idx] = true;
          }
        } catch {
          if (runId !== this.#calcRunId) return;
          this.#sectionExact[idx] = true;
        }
      }

      this.#updateEstimatesFromMeasured();
      this.onPageUpdate?.(this.getPageInfo());
    }

    if (runId === this.#calcRunId && this.#sectionExact.every(Boolean)) {
      putPageCache(this.#bookId, signature, this.#sectionPages);
      this.onPageUpdate?.(this.getPageInfo());
    }
  }

  /**
   * Capture the visible start passage (Range + CFI) when the settings sheet opens
   * so repeated live setting changes stay anchored to the exact same passage without drift.
   */
  captureSettingsAnchor() {
    if (!this.view?.book) return null;
    const loc = this.getLocation();
    const contents = this.view?.renderer?.getContents?.() || [];
    const doc = contents[0]?.doc;
    const sectionIndex = this.#getCurrentSectionIndex();
    let anchorRange = null;
    let anchorCfi = loc?.cfi || null;

    if (doc && loc?.range) {
      try {
        const r = loc.range;
        if (r.startContainer?.nodeType === 3) {
          const node = r.startContainer;
          const len = node.nodeValue?.length || 0;
          const s = Math.min(r.startOffset, Math.max(0, len - 1));
          const e = Math.min(len, s + Math.max(1, Math.min(16, len - s)));
          anchorRange = doc.createRange();
          anchorRange.setStart(node, s);
          anchorRange.setEnd(node, e);
        } else {
          anchorRange = r.cloneRange();
        }
        anchorCfi = this.view.getCFI(sectionIndex, anchorRange) || loc.cfi;
      } catch {
        anchorRange = null;
      }
    }

    this.#settingsAnchor = {
      sectionIndex,
      range: anchorRange,
      cfi: anchorCfi,
      fullCfi: loc?.cfi || null,
      fraction: loc?.fraction ?? 0,
    };
    return this.#settingsAnchor;
  }

  clearSettingsAnchor() {
    this.#settingsAnchor = null;
  }

  /**
   * Re-layout and re-anchor the active section to the captured settings anchor synchronously.
   */
  reanchorToSettingsAnchor() {
    if (!this.view?.book || !this.view?.renderer) return;
    if (!this.#settingsAnchor) {
      this.captureSettingsAnchor();
    }
    const anchor = this.#settingsAnchor;
    const contents = this.view.renderer.getContents?.() || [];
    const doc = contents[0]?.doc;
    this.#isApplyingSettings = true;
    try {
      let targetRange = null;
      if (anchor?.range && doc && anchor.range.startContainer?.ownerDocument === doc) {
        targetRange = anchor.range;
      } else if (anchor?.cfi && doc) {
        try {
          const resolved = this.view.resolveNavigation(anchor.cfi);
          if (resolved?.anchor && typeof resolved.anchor === 'function') {
            targetRange = resolved.anchor(doc);
          }
        } catch {
          targetRange = null;
        }
      }
      if (typeof this.view.renderer.reanchor === 'function') {
        this.view.renderer.reanchor(targetRange);
      } else {
        this.view.renderer.render?.();
      }
    } finally {
      this.#isApplyingSettings = false;
    }
  }

  #getLinearIndices() {
    const sections = this.book?.sections || [];
    const indices = [];
    for (let i = 0; i < sections.length; i++) {
      if (sections[i]?.linear !== 'no') {
        indices.push(i);
      }
    }
    return indices.length ? indices : sections.map((_, i) => i);
  }

  #getCurrentSectionIndex() {
    const fromLoc = this.view?.lastLocation?.section?.current;
    if (typeof fromLoc === 'number' && fromLoc >= 0) return fromLoc;
    const contents = this.view?.renderer?.getContents?.() || [];
    if (typeof contents[0]?.index === 'number' && contents[0].index >= 0) {
      return contents[0].index;
    }
    return 0;
  }

  #findNextLinearIndex(afterIndex) {
    const linear = this.#getLinearIndices();
    return linear.find(idx => idx > afterIndex) ?? null;
  }

  #findPrevLinearIndex(beforeIndex) {
    const linear = this.#getLinearIndices();
    for (let i = linear.length - 1; i >= 0; i--) {
      if (linear[i] < beforeIndex) return linear[i];
    }
    return null;
  }

  /**
   * Determine if the renderer is currently at the very end of the entire book.
   */
  isAtBookEnd() {
    if (!this.view?.book || !this.view?.renderer) return false;
    const renderer = this.view.renderer;
    const currentIndex = this.#getCurrentSectionIndex();
    const hasNextSection = this.#findNextLinearIndex(currentIndex) !== null;

    if (this.view.isFixedLayout) {
      return !hasNextSection;
    }

    if (renderer.scrolled) {
      const remainingPx = (renderer.viewSize || 0) - (renderer.end || 0);
      return !hasNextSection && remainingPx <= 4;
    }

    if (renderer.atEnd) {
      return true;
    }

    if (!hasNextSection && renderer.pages > 0 && renderer.page >= renderer.pages - 2) {
      return true;
    }

    return false;
  }

  /**
   * Determine if the renderer is currently at the very start of the book.
   */
  isAtBookStart() {
    if (!this.view?.book || !this.view?.renderer) return false;
    const renderer = this.view.renderer;
    const currentIndex = this.#getCurrentSectionIndex();
    const hasPrevSection = this.#findPrevLinearIndex(currentIndex) !== null;

    if (this.view.isFixedLayout) {
      return !hasPrevSection;
    }

    if (renderer.scrolled) {
      return !hasPrevSection && (renderer.start || 0) <= 4;
    }

    if (renderer.atStart) {
      return true;
    }

    return !hasPrevSection && (renderer.page || 1) <= 1;
  }

  /**
   * Compute normalized book fraction in [0, 1] that accurately reflects scrolled and paginated progress
   * and reaches 1.0 on the final page/scroll position of the book.
   */
  #computeNormalizedFraction(detail) {
    if (!this.view?.book) return 0;

    if (this.isAtBookEnd()) {
      return 1;
    }

    const renderer = this.view.renderer;
    const sectionFractions = this.view.getSectionFractions?.() || [];
    const currentIndex = detail?.section?.current ?? this.#getCurrentSectionIndex();

    // In scrolled mode, foliate's paginator reports `start / viewSize` without `size`,
    // which never reaches 1.0 at the bottom of a section. Interpolate using scrollable range.
    if (renderer?.scrolled && sectionFractions.length > currentIndex + 1) {
      const secStart = Math.max(0, sectionFractions[currentIndex] || 0);
      const secEnd = Math.min(1, sectionFractions[currentIndex + 1] || secStart);
      const maxScroll = Math.max(0, (renderer.viewSize || 0) - (renderer.size || 0));
      let withinSection = 0;
      if (maxScroll > 2) {
        withinSection = Math.min(1, Math.max(0, (renderer.start || 0) / maxScroll));
      } else {
        withinSection = currentIndex > 0 ? 1 : 0;
      }
      const computed = secStart + withinSection * (secEnd - secStart);
      // Never report 1 unless we are truly at the end (handled by isAtBookEnd above).
      return Math.max(0, Math.min(0.9999, computed));
    }

    const raw = Number(detail?.fraction ?? this.view.lastLocation?.fraction ?? 0);
    if (!Number.isFinite(raw)) return 0;
    // Only isAtBookEnd() may report 100%; cap everything else just below.
    return Math.max(0, Math.min(0.9999, raw));
  }

  #handleRelocate(event) {
    const loc = this.view?.lastLocation || event?.detail || {};
    const normalizedFraction = this.#computeNormalizedFraction(loc);
    loc.fraction = normalizedFraction;
    if (this.view?.lastLocation) {
      this.view.lastLocation.fraction = normalizedFraction;
    }
    if (!this.#isRestoringResize && !this.#isApplyingSettings && loc.reason !== 'anchor' && loc.cfi) {
      this.#stablePosition = {
        cfi: loc.cfi,
        fraction: normalizedFraction,
        sectionIndex: loc.section?.current ?? this.#getCurrentSectionIndex(),
      };
      if (
        this.#settingsAnchor &&
        (loc.reason === 'page' || loc.reason === 'snap' || loc.reason === 'scroll')
      ) {
        this.captureSettingsAnchor();
      }
    } else if (!this.#stablePosition && loc.cfi) {
      this.#stablePosition = {
        cfi: loc.cfi,
        fraction: normalizedFraction,
        sectionIndex: loc.section?.current ?? this.#getCurrentSectionIndex(),
      };
    }
    this.onPageUpdate?.(this.getPageInfo());
    this.onRelocate?.(loc);
  }

  /**
   * Restore the exact pre-resize CFI position after an orientation change or viewport resize settles.
   */
  async restoreStablePosition() {
    if (!this.view?.book || !this.#stablePosition?.cfi) return;
    const targetCfi = this.#stablePosition.cfi;
    this.#isRestoringResize = true;
    try {
      this.view.renderer?.finishAnimation?.();
      this.view.renderer?.render?.();
      await this.view.goTo(targetCfi);
      await nextFrame();
    } catch {
      // Ignore transient resize navigation errors
    } finally {
      this.#isRestoringResize = false;
    }
  }

  #handleLoad(event) {
    const doc = event?.detail?.doc;
    const index = event?.detail?.index;
    if (doc?.documentElement && this.dir === 'rtl' && !doc.documentElement.dir) {
      doc.documentElement.dir = 'rtl';
    }
    if (doc?.fonts) {
      doc.fonts.ready?.then?.(() => this.#handleFontLoad(index));
      doc.fonts.addEventListener?.('loadingdone', () => this.#handleFontLoad(index));
    }
    this.onSectionLoad?.({ doc, index });
  }

  #captureSnapshot() {
    const renderer = this.view?.renderer;
    return {
      cfi: this.view?.lastLocation?.cfi || null,
      fraction: this.view?.lastLocation?.fraction ?? 0,
      sectionIndex: this.#getCurrentSectionIndex(),
      page: renderer?.page ?? 0,
      start: renderer?.start ?? 0,
    };
  }

  #hasAdvanced(before, after) {
    if (after.sectionIndex !== before.sectionIndex) return true;
    if (after.page !== before.page) return true;
    if (Math.abs((after.start || 0) - (before.start || 0)) > 1) return true;
    if (after.cfi && before.cfi && after.cfi !== before.cfi) return true;
    if (Math.abs((after.fraction || 0) - (before.fraction || 0)) > 1e-5) return true;
    return false;
  }

  #markAtEnd() {
    if (this.view?.lastLocation) {
      this.view.lastLocation.fraction = 1;
      this.onRelocate?.(this.view.lastLocation);
    } else {
      const total = this.book?.sections?.length || 1;
      const synthetic = {
        fraction: 1,
        section: { current: total - 1, total },
        cfi: null,
      };
      this.onRelocate?.(synthetic);
    }
  }

  /**
   * Turn to the next page / scroll step.
   * Serialized and defensive: if foliate's next() doesn't move and more sections exist,
   * jumps to the next linear section; at the end of the book, ensures 100% and is a safe no-op.
   */
  next() {
    if (this.#navBusy > 0) {
      this.view?.renderer?.finishAnimation?.();
    }
    this.#navBusy++;
    this.#navChain = this.#navChain
      .then(() => this.#performNext())
      .catch(err => console.warn('Navigation next warning:', err))
      .finally(() => {
        this.#navBusy = Math.max(0, this.#navBusy - 1);
      });
    return this.#navChain;
  }

  async #performNext() {
    if (!this.view?.book || !this.view?.renderer) return;
    const renderer = this.view.renderer;
    const currentIndex = this.#getCurrentSectionIndex();

    if (this.isAtBookEnd()) {
      this.#markAtEnd();
      return;
    }

    // In scrolled mode, check if we are at the bottom of the current section before calling renderer.next()
    // (because foliate's paginator.#turnPage in scrolled mode attempts to load sections[undefined] on the last section)
    if (renderer.scrolled) {
      const remainingPx = (renderer.viewSize || 0) - (renderer.end || 0);
      if (remainingPx <= 4) {
        const nextIdx = this.#findNextLinearIndex(currentIndex);
        if (nextIdx !== null) {
          await this.view.goTo(nextIdx);
          await nextFrame();
          if (this.isAtBookEnd()) this.#markAtEnd();
        } else {
          this.#markAtEnd();
        }
        return;
      }
    }

    const before = this.#captureSnapshot();
    // In scroll mode keep ~8% overlap between "pages" so no line is lost at the fold.
    await this.view.next(renderer.scrolled ? Math.round(renderer.size * 0.92) : undefined);
    await nextFrame();

    if (this.isAtBookEnd()) {
      this.#markAtEnd();
      return;
    }

    let after = this.#captureSnapshot();
    if (!this.#hasAdvanced(before, after)) {
      await delay(50);
      after = this.#captureSnapshot();
    }

    if (!this.#hasAdvanced(before, after)) {
      const nextIdx = this.#findNextLinearIndex(before.sectionIndex);
      if (nextIdx !== null) {
        if (typeof renderer.nextSection === 'function') {
          await renderer.nextSection();
        } else {
          await this.view.goTo(nextIdx);
        }
        await nextFrame();
      } else {
        this.#markAtEnd();
        return;
      }
    }

    if (this.isAtBookEnd()) {
      this.#markAtEnd();
    } else if (renderer.scrolled && this.view.lastLocation) {
      this.#handleRelocate({ detail: this.view.lastLocation });
    }
  }

  /**
   * Turn to the previous page / scroll step.
   * Serialized and defensive: if at the start of a section, jumps to the end of the previous linear section.
   */
  prev() {
    if (this.#navBusy > 0) {
      this.view?.renderer?.finishAnimation?.();
    }
    this.#navBusy++;
    this.#navChain = this.#navChain
      .then(() => this.#performPrev())
      .catch(err => console.warn('Navigation prev warning:', err))
      .finally(() => {
        this.#navBusy = Math.max(0, this.#navBusy - 1);
      });
    return this.#navChain;
  }

  async #performPrev() {
    if (!this.view?.book || !this.view?.renderer) return;
    const renderer = this.view.renderer;
    const currentIndex = this.#getCurrentSectionIndex();

    if (this.isAtBookStart()) {
      return;
    }

    if (renderer.scrolled && (renderer.start || 0) <= 4) {
      const prevIdx = this.#findPrevLinearIndex(currentIndex);
      if (prevIdx !== null) {
        await renderer.goTo({ index: prevIdx, anchor: () => 1 });
        await nextFrame();
        if (this.view.lastLocation) {
          this.#handleRelocate({ detail: this.view.lastLocation });
        }
      }
      return;
    }

    const before = this.#captureSnapshot();
    await this.view.prev(renderer.scrolled ? Math.round(renderer.size * 0.92) : undefined);
    await nextFrame();

    let after = this.#captureSnapshot();
    if (!this.#hasAdvanced(before, after)) {
      await delay(50);
      after = this.#captureSnapshot();
    }

    if (!this.#hasAdvanced(before, after)) {
      const prevIdx = this.#findPrevLinearIndex(before.sectionIndex);
      if (prevIdx !== null) {
        if (typeof renderer.goTo === 'function' && !this.view.isFixedLayout) {
          await renderer.goTo({ index: prevIdx, anchor: () => 1 });
        } else {
          await this.view.goTo(prevIdx);
        }
        await nextFrame();
      }
    }

    if (renderer.scrolled && this.view.lastLocation) {
      this.#handleRelocate({ detail: this.view.lastLocation });
    }
  }

  /**
   * Jump to a fraction [0, 1] of the book.
   */
  async goToFraction(fraction) {
    if (!this.view?.book) return;
    const clamped = Math.max(0, Math.min(1, Number(fraction) || 0));
    await this.view.goToFraction(clamped);
    await nextFrame();
    if (clamped >= 0.995 || this.isAtBookEnd()) {
      this.#markAtEnd();
    }
  }

  /**
   * Jump to a target (href, CFI, or section index).
   */
  async goTo(target) {
    if (!this.view?.book) return;
    await this.view.goTo(target);
    await nextFrame();
  }

  /**
   * Return the current location object.
   */
  getLocation() {
    return this.view?.lastLocation || null;
  }
}
