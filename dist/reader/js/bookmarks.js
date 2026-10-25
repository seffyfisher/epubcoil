import { STRINGS, escapeHTML } from './he.js';

/**
 * Check if the current location CFI is bookmarked in state.
 */
export function isCurrentPageBookmarked(state, currentCfi) {
  if (!currentCfi || !Array.isArray(state?.bookmarks)) return false;
  return state.bookmarks.some(b => b.cfi === currentCfi);
}

/**
 * Update the topbar bookmark toggle button's visual and ARIA state.
 */
export function updateBookmarkButton(buttonEl, state, currentCfi) {
  if (!buttonEl) return;
  const active = isCurrentPageBookmarked(state, currentCfi);
  buttonEl.setAttribute('aria-pressed', active ? 'true' : 'false');
  buttonEl.setAttribute(
    'aria-label',
    active ? STRINGS.bookmarkRemove : STRINGS.bookmarkAdd,
  );
  buttonEl.classList.toggle('is-active', active);
  buttonEl.innerHTML = active
    ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg><span class="sr-only">★</span>`
    : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg><span class="sr-only">☆</span>`;
}

/**
 * Toggle bookmark for the current reading location.
 * Returns true if added, false if removed.
 */
export function toggleBookmarkAtCurrentLocation(state, { cfi, label, fraction }) {
  if (!cfi) return false;
  if (!Array.isArray(state.bookmarks)) {
    state.bookmarks = [];
  }
  const existingIdx = state.bookmarks.findIndex(b => b.cfi === cfi);
  if (existingIdx >= 0) {
    state.bookmarks.splice(existingIdx, 1);
    return false;
  }

  const pct = Math.round(Math.max(0, Math.min(1, Number(fraction) || 0)) * 100);
  const displayLabel = label ? `${label} (${pct}%)` : `${STRINGS.defaultBookmarkLabel} (${pct}%)`;

  state.bookmarks.push({
    cfi,
    label: displayLabel,
    fraction: Number(fraction) || 0,
    createdAt: Date.now(),
  });
  return true;
}

/**
 * Render the Bookmarks list inside the drawer container.
 */
export function renderBookmarksDrawer(container, {
  state,
  onSelectBookmark,
  onDeleteBookmark,
}) {
  const bookmarks = Array.isArray(state?.bookmarks) ? state.bookmarks : [];

  if (bookmarks.length === 0) {
    container.innerHTML = `<p class="empty-drawer-note">${STRINGS.emptyBookmarks}</p>`;
    return;
  }

  const listHtml = bookmarks
    .map((bm, index) => {
      const label = bm.label || STRINGS.defaultBookmarkLabel;
      const pct = Math.round(Math.max(0, Math.min(1, Number(bm.fraction) || 0)) * 100);
      return `
        <div class="bookmark-item book-card" data-bookmark-index="${index}">
          <button type="button" class="drawer-row bm" data-i="${index}">
            <b>${escapeHTML(label)}</b>
            <small>${pct}%</small>
          </button>
          <button
            type="button"
            class="icon danger del"
            data-i="${index}"
            aria-label="${STRINGS.deleteBookmarkAria} — ${escapeHTML(label)}"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
      `;
    })
    .join('');

  container.innerHTML = `<div class="bookmarks-list">${listHtml}</div>`;

  for (const jumpBtn of container.querySelectorAll('.bm')) {
    jumpBtn.addEventListener('click', () => {
      const idx = Number(jumpBtn.dataset.i);
      const item = bookmarks[idx];
      if (item?.cfi) {
        onSelectBookmark?.(item.cfi);
      }
    });
  }

  for (const delBtn of container.querySelectorAll('.del')) {
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      const idx = Number(delBtn.dataset.i);
      onDeleteBookmark?.(idx);
    });
  }
}
