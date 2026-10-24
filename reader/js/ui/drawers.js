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
    document.addEventListener('keydown', this.#handleKeydown.bind(this));
  }

  get isOpen() {
    return Boolean(this.drawerEl && !this.drawerEl.hidden);
  }

  open(kind, title, renderFn, { onClose } = {}) {
    if (!this.isOpen) {
      this.lastFocused = document.activeElement;
    } else if (this.onCloseCallback) {
      this.onCloseCallback();
    }

    this.currentKind = kind;
    this.onCloseCallback = onClose || null;
    if (this.titleEl) {
      this.titleEl.textContent = title;
    }

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
    this.drawerEl.hidden = true;
    this.backdropEl.hidden = true;
    this.currentKind = null;

    if (this.onCloseCallback) {
      const cb = this.onCloseCallback;
      this.onCloseCallback = null;
      cb();
    }

    if (this.lastFocused && typeof this.lastFocused.focus === 'function') {
      try {
        this.lastFocused.focus();
      } catch {
        // Ignore focus errors if element was detached
      }
    }
    this.lastFocused = null;
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
