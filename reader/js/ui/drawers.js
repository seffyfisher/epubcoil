import { STRINGS, escapeHTML } from '../he.js';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible Drawer Manager:
 * - Implements modal dialog semantics (`role="dialog"`, `aria-modal="true"`)
 * - Traps Tab / Shift+Tab focus within the drawer
 * - Closes on Escape or backdrop click and restores focus to the opener button
 */
export class DrawerController {
  #sheetDrag = null;

  constructor({ drawerEl, titleEl, contentEl, closeBtnEl, backdropEl }) {
    this.drawerEl = drawerEl;
    this.titleEl = titleEl;
    this.contentEl = contentEl;
    this.closeBtnEl = closeBtnEl;
    this.backdropEl = backdropEl;
    this.currentKind = null;
    this.lastFocused = null;
    this.onCloseCallback = null;

    this.closeBtnEl?.addEventListener('click', () => this.close());
    this.backdropEl?.addEventListener('click', () => this.close());
    this.backdropEl?.addEventListener('touchend', e => {
      if (e.cancelable) e.preventDefault();
      this.close();
    });
    document.addEventListener('keydown', this.#handleKeydown.bind(this));
    this.#bindSheetSwipeToDismiss();
  }

  #bindSheetSwipeToDismiss() {
    if (!this.drawerEl) return;
    const handleZone = e =>
      e.target?.closest?.('.drawer-grab-handle, .drawer-header') &&
      !e.target?.closest?.('button');

    this.drawerEl.addEventListener(
      'touchstart',
      e => {
        if (!this.isOpen || !handleZone(e) || e.touches.length !== 1) return;
        const t = e.changedTouches[0];
        this.#sheetDrag = {
          startY: t.screenY,
          dy: 0,
          startTime: e.timeStamp || performance.now(),
        };
        this.drawerEl.style.transition = 'none';
      },
      { passive: true },
    );

    this.drawerEl.addEventListener(
      'touchmove',
      e => {
        if (!this.#sheetDrag || e.touches.length !== 1) return;
        const t = e.changedTouches[0];
        const dy = Math.max(0, t.screenY - this.#sheetDrag.startY);
        this.#sheetDrag.dy = dy;
        if (dy > 0) {
          if (e.cancelable) e.preventDefault();
          this.drawerEl.style.transform = `translateY(${dy}px)`;
        }
      },
      { passive: false },
    );

    const finishSheetDrag = e => {
      if (!this.#sheetDrag) return;
      const { dy, startTime } = this.#sheetDrag;
      this.#sheetDrag = null;
      this.drawerEl.style.transition = '';
      this.drawerEl.style.transform = '';
      const dt = Math.max(1, (e?.timeStamp || performance.now()) - startTime);
      const vy = dy / dt;
      if (dy > 56 || (dy > 24 && vy > 0.45)) {
        this.close();
      }
    };

    this.drawerEl.addEventListener('touchend', finishSheetDrag, { passive: true });
    this.drawerEl.addEventListener('touchcancel', finishSheetDrag, { passive: true });
  }

  get isOpen() {
    return Boolean(this.drawerEl && !this.drawerEl.hidden);
  }

  open(kind, title, renderFn, { onClose, triggerEl } = {}) {
    if (!this.isOpen) {
      this.lastFocused =
        triggerEl ||
        (document.activeElement && document.activeElement !== document.body
          ? document.activeElement
          : null);
    } else if (this.onCloseCallback) {
      this.onCloseCallback();
      if (triggerEl) this.lastFocused = triggerEl;
    }

    this.currentKind = kind;
    this.onCloseCallback = onClose || null;
    if (this.titleEl) {
      this.titleEl.textContent = title;
    }

    this.drawerEl.style.transform = '';
    this.drawerEl.style.transition = '';
    this.backdropEl.hidden = false;
    this.drawerEl.hidden = false;

    Promise.resolve(renderFn?.(this.contentEl)).then(() => {
      if (!this.isOpen) return;
      const autoFocusEl =
        this.contentEl.querySelector('[autofocus]') ||
        this.contentEl.querySelector('.current') ||
        this.closeBtnEl ||
        this.drawerEl;
      autoFocusEl?.focus?.();
    });
  }

  close() {
    if (!this.isOpen) return;
    this.#sheetDrag = null;
    this.drawerEl.style.transform = '';
    this.drawerEl.style.transition = '';
    this.drawerEl.hidden = true;
    this.backdropEl.hidden = true;
    this.currentKind = null;

    if (this.onCloseCallback) {
      const cb = this.onCloseCallback;
      this.onCloseCallback = null;
      cb();
    }

    const toFocus = this.lastFocused;
    this.lastFocused = null;
    if (toFocus && typeof toFocus.focus === 'function') {
      try {
        toFocus.focus();
      } catch {
        // Ignore focus errors if element was detached
      }
    }
  }

  #handleKeydown(event) {
    if (!this.isOpen) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }

    if (event.key === 'Tab') {
      const focusables = Array.from(
        this.drawerEl.querySelectorAll(FOCUSABLE_SELECTOR),
      ).filter(el => !el.hidden && el.offsetParent !== null);

      if (focusables.length === 0) {
        event.preventDefault();
        this.drawerEl.focus();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      if (event.shiftKey) {
        if (active === first || !this.drawerEl.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !this.drawerEl.contains(active)) {
          event.preventDefault();
          first.focus();
        }
      }
    }
  }
}

/**
 * Flatten a nested TOC tree into an array of { label, href, depth }.
 */
function flattenToc(items, depth = 0) {
  if (!Array.isArray(items)) return [];
  const result = [];
  for (const item of items) {
    if (!item) continue;
    result.push({
      label: item.label || '',
      href: item.href || '',
      depth,
    });
    if (Array.isArray(item.subitems) && item.subitems.length > 0) {
      result.push(...flattenToc(item.subitems, depth + 1));
    }
  }
  return result;
}

/**
 * Render the Table of Contents (TOC) drawer.
 */
export function renderTocDrawer(container, {
  book,
  currentLocation,
  bookDir = 'rtl',
  onSelectTarget,
}) {
  const flatItems = flattenToc(book?.toc || []);
  const currentHref = currentLocation?.tocItem?.href || '';
  const currentLabel = currentLocation?.tocItem?.label || '';
  const currentSectionIndex = currentLocation?.section?.current ?? 0;

  container.dir = bookDir;

  if (flatItems.length === 0) {
    // Fallback to spine sections if book has no explicit TOC
    const sections = book?.sections || [];
    if (sections.length === 0) {
      container.innerHTML = `<p class="empty-drawer-note">${STRINGS.emptyToc}</p>`;
      return;
    }

    container.innerHTML = `
      <nav aria-label="${STRINGS.tocTitle}" class="toc-list">
        ${sections
          .map((sec, idx) => {
            const isCurrent = idx === currentSectionIndex;
            const label = STRINGS.chapterFallback(idx);
            return `
              <button
                type="button"
                class="drawer-row toc-item ${isCurrent ? 'current' : ''}"
                ${isCurrent ? 'aria-current="location"' : ''}
                data-section-index="${idx}"
              >
                <span class="toc-label">${escapeHTML(label)}</span>
              </button>
            `;
          })
          .join('')}
      </nav>
    `;

    for (const btn of container.querySelectorAll('[data-section-index]')) {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.sectionIndex);
        onSelectTarget?.(idx);
      });
    }
    return;
  }

  let matchedCurrent = false;
  const rowsHtml = flatItems
    .map(item => {
      const isMatch =
        !matchedCurrent &&
        ((currentHref && item.href === currentHref) ||
          (currentLabel && item.label === currentLabel));
      if (isMatch) matchedCurrent = true;
      const indentPx = item.depth * 18 + 6;
      return `
        <button
          type="button"
          class="drawer-row toc-item ${isMatch ? 'current' : ''}"
          ${isMatch ? 'aria-current="location"' : ''}
          style="padding-inline-start: ${indentPx}px"
          data-href="${encodeURIComponent(item.href)}"
        >
          <span class="toc-label">${escapeHTML(item.label)}</span>
        </button>
      `;
    })
    .join('');

  container.innerHTML = `<nav aria-label="${STRINGS.tocTitle}" class="toc-list">${rowsHtml}</nav>`;

  for (const btn of container.querySelectorAll('[data-href]')) {
    btn.addEventListener('click', () => {
      const href = decodeURIComponent(btn.dataset.href || '');
      if (href) {
        onSelectTarget?.(href);
      }
    });
  }
}
