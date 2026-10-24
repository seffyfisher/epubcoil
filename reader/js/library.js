import { STRINGS, escapeHTML } from './he.js';
import { listBooks, getState } from './storage.js';

const activeCoverObjectUrls = new Set();

function revokeActiveCoverUrls() {
  for (const url of activeCoverObjectUrls) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Ignore revoke errors
    }
  }
  activeCoverObjectUrls.clear();
}

/**
 * Extract first meaningful letter/character from a book title for the typographic cover fallback.
 */
export function getTitleInitial(title) {
  const clean = String(title || '').trim();
  if (!clean) return 'א';
  const match = clean.match(/[\p{L}\p{N}]/u);
  return match ? match[0].toUpperCase() : clean[0];
}

/**
 * Generate a resized (~200px wide) WebP/JPEG cover thumbnail Blob from `book.getCover()`.
 * Returns null if the book has no cover image or decoding fails.
 */
export async function generateCoverThumbnail(book) {
  try {
    if (!book || typeof book.getCover !== 'function') return null;
    const coverBlob = await book.getCover();
    if (!coverBlob || !(coverBlob instanceof Blob) || coverBlob.size === 0) {
      return null;
    }

    let source = null;
    let width = 0;
    let height = 0;
    let tempUrl = null;

    try {
      if (typeof createImageBitmap === 'function') {
        source = await createImageBitmap(coverBlob);
        width = source.width;
        height = source.height;
      }
    } catch {
      source = null;
    }

    if (!source) {
      tempUrl = URL.createObjectURL(coverBlob);
      source = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = tempUrl;
      });
      width = source.naturalWidth || source.width || 200;
      height = source.naturalHeight || source.height || 300;
    }

    const targetWidth = Math.min(200, Math.max(1, width || 200));
    const aspect = (height || 300) / (width || 200);
    const targetHeight = Math.max(1, Math.round(targetWidth * aspect));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      source.close?.();
      if (tempUrl) URL.revokeObjectURL(tempUrl);
      return coverBlob;
    }

    ctx.drawImage(source, 0, 0, targetWidth, targetHeight);
    source.close?.();
    if (tempUrl) URL.revokeObjectURL(tempUrl);

    let thumbBlob = await new Promise(resolve =>
      canvas.toBlob(resolve, 'image/webp', 0.82),
    );
    if (!thumbBlob || thumbBlob.size === 0) {
      thumbBlob = await new Promise(resolve =>
        canvas.toBlob(resolve, 'image/jpeg', 0.85),
      );
    }

    return thumbBlob && thumbBlob.size > 0 ? thumbBlob : coverBlob;
  } catch {
    return null;
  }
}

/**
 * Format a timestamp into a concise Hebrew date string.
 */
function formatLastOpened(timestamp) {
  if (!timestamp) return '';
  try {
    return new Intl.DateTimeFormat('he-IL', {
      day: 'numeric',
      month: 'short',
    }).format(new Date(timestamp));
  } catch {
    return '';
  }
}

/**
 * Render the saved books list in the library view.
 */
export async function renderLibraryList(listContainer, {
  onOpenSaved,
  onRemoveSaved,
}) {
  if (!listContainer) return;

  revokeActiveCoverUrls();

  let books = [];
  try {
    books = await listBooks();
  } catch {
    books = [];
  }

  if (books.length === 0) {
    listContainer.innerHTML = `<p id="empty-library" class="empty-library">${STRINGS.emptyLibrary}</p>`;
    return;
  }

  const cardsHtml = books
    .map(book => {
      const title = book.meta?.title || book.meta?.name || STRINGS.untitledBook;
      const author = book.meta?.author || STRINGS.unknownAuthor;
      const bookState = getState(book.id);
      const rawFraction = Number(bookState.fraction) || 0;
      const displayFraction = rawFraction >= 0.995 ? 1 : Math.max(0, Math.min(1, rawFraction));
      const percent = Math.round(displayFraction * 100);
      const dateStr = formatLastOpened(bookState.updatedAt || book.meta?.openedAt);

      let coverMarkup;
      if (book.coverBlob instanceof Blob && book.coverBlob.size > 0) {
        const coverUrl = URL.createObjectURL(book.coverBlob);
        activeCoverObjectUrls.add(coverUrl);
        coverMarkup = `
          <div class="cover has-image">
            <img class="cover-img" src="${escapeHTML(coverUrl)}" alt="${escapeHTML(title)}">
          </div>
        `;
      } else {
        const initial = getTitleInitial(title);
        coverMarkup = `
          <div class="cover cover-typo" aria-hidden="true">
            <span>${escapeHTML(initial)}</span>
          </div>
        `;
      }

      const metaParts = [escapeHTML(author), `${percent}%`];
      if (dateStr) metaParts.push(escapeHTML(dateStr));

      return `
        <article class="book-card" data-book-id="${escapeHTML(book.id)}">
          ${coverMarkup}
          <div class="book-info">
            <button type="button" class="book-title-btn open-saved" data-id="${escapeHTML(book.id)}">
              <b dir="auto">${escapeHTML(title)}</b>
              <small>${metaParts.join(' · ')}</small>
            </button>
            <div class="book-progress-track" aria-hidden="true">
              <div class="book-progress-fill" style="width: ${percent}%"></div>
            </div>
          </div>
          <div class="book-card-actions">
            <button type="button" class="icon open-saved" data-id="${escapeHTML(book.id)}" aria-label="${STRINGS.openBookAria} — ${escapeHTML(title)}">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
            </button>
            <button type="button" class="icon remove-saved danger" data-id="${escapeHTML(book.id)}" aria-label="${STRINGS.removeBookAria} — ${escapeHTML(title)}">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </article>
      `;
    })
    .join('');

  listContainer.innerHTML = cardsHtml;

  for (const btn of listContainer.querySelectorAll('.open-saved')) {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (id && onOpenSaved) onOpenSaved(id);
    });
  }

  for (const btn of listContainer.querySelectorAll('.remove-saved')) {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (!id) return;
      if (globalThis.confirm(STRINGS.confirmRemoveBook)) {
        await onRemoveSaved?.(id);
      }
    });
  }
}
