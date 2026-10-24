import { STRINGS, escapeHTML } from './he.js';

/**
 * Format a foliate search excerpt ({ pre, match, post } or plain string) into safe HTML.
 */
function formatExcerptHtml(excerpt) {
  if (!excerpt) return '';
  if (typeof excerpt === 'object') {
    const pre = escapeHTML(excerpt.pre || '');
    const match = escapeHTML(excerpt.match || '');
    const post = escapeHTML(excerpt.post || '');
    return `${pre}<mark>${match}</mark>${post}`;
  }
  return escapeHTML(String(excerpt));
}

/**
 * Render the in-book Search drawer and manage async search iteration + cancellation.
 */
export function renderSearchDrawer(container, {
  view,
  bookDir = 'rtl',
  onSelectResult,
}) {
  let cancelled = false;
  let activeSearchId = 0;

  container.dir = bookDir;
  container.innerHTML = `
    <form id="search-form" class="search-form" role="search">
      <div class="search-input-row">
        <input
          id="search-input"
          type="search"
          autofocus
          aria-label="${STRINGS.searchTitle}"
          placeholder="${STRINGS.searchPlaceholder}"
        >
        <button type="submit" class="button primary" id="search-submit-btn">${STRINGS.searchSubmit}</button>
        <button type="button" class="button" id="search-cancel-btn" hidden>${STRINGS.searchCancel}</button>
      </div>
    </form>
    <div id="search-status" class="search-status" aria-live="polite"></div>
    <div id="search-results" class="search-results"></div>
  `;

  const form = container.querySelector('#search-form');
  const input = container.querySelector('#search-input');
  const cancelBtn = container.querySelector('#search-cancel-btn');
  const statusEl = container.querySelector('#search-status');
  const resultsEl = container.querySelector('#search-results');

  const cancelSearch = () => {
    cancelled = true;
    activeSearchId++;
    if (cancelBtn) cancelBtn.hidden = true;
  };

  cancelBtn?.addEventListener('click', () => {
    cancelSearch();
    if (statusEl) statusEl.textContent = STRINGS.searchCancelled;
  });

  form?.addEventListener('submit', async e => {
    e.preventDefault();
    const query = input?.value?.trim() || '';
    if (!query || !view?.search) return;

    cancelled = false;
    const mySearchId = ++activeSearchId;
    resultsEl.innerHTML = '';
    statusEl.textContent = STRINGS.searchingStatus;
    cancelBtn.hidden = false;

    let totalMatches = 0;

    try {
      const iterator = view.search({
        query,
        ignoreDiacritics: true,
        matchDiacritics: false,
        matchCase: false,
      });

      for await (const result of iterator) {
        if (cancelled || mySearchId !== activeSearchId) {
          break;
        }

        if (result === 'done') {
          break;
        }

        if (Array.isArray(result.subitems) && result.subitems.length > 0) {
          const sectionLabel = result.label || '';
          const fragment = document.createDocumentFragment();

          for (const sub of result.subitems) {
            totalMatches++;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'drawer-row result search-result-item';
            btn.dataset.cfi = encodeURIComponent(sub.cfi || '');
            btn.innerHTML = `
              ${sectionLabel ? `<small class="result-chapter">${escapeHTML(sectionLabel)}</small>` : ''}
              <span class="result-excerpt">${formatExcerptHtml(sub.excerpt)}</span>
            `;
            btn.addEventListener('click', () => {
              const targetCfi = decodeURIComponent(btn.dataset.cfi || '');
              if (targetCfi) {
                onSelectResult?.(targetCfi);
              }
            });
            fragment.appendChild(btn);
          }

          resultsEl.appendChild(fragment);
          statusEl.textContent = STRINGS.searchResultsCount(totalMatches);
        }
      }

      if (!cancelled && mySearchId === activeSearchId) {
        cancelBtn.hidden = true;
        statusEl.textContent =
          totalMatches > 0
            ? STRINGS.searchResultsCount(totalMatches)
            : STRINGS.searchNoResults;
      }
    } catch (err) {
      console.error('Search error:', err);
      if (mySearchId === activeSearchId) {
        cancelBtn.hidden = true;
        statusEl.textContent = STRINGS.searchFailed;
      }
    }
  });

  return cancelSearch;
}
