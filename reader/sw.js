/**
 * Service Worker for epub.co.il PWA EPUB Reader.
 * - Scope: ./ (strictly confined to reader directory, plus optional demo book precache)
 * - Precaches full application shell, ES modules, foliate-js engine, icons, and fonts
 * - Navigation requests: network-first with offline fallback to ./index.html
 * - Static assets: cache-first with runtime cache populate for in-scope resources
 * - Never caches user books (which remain private Blobs in IndexedDB)
 */

// Bump VERSION on every deploy that changes any shell file (triggers the update prompt).
const VERSION = 'epubcoil-reader-v2-20261024-r4';

const SHELL_ASSETS = [
  './',
  './index.html',
  './reader.css',
  './manifest.webmanifest',
  './app.js',
  './storage.js',
  './js/app.js',
  './js/he.js',
  './js/errors.js',
  './js/storage.js',
  './js/settings.js',
  './js/library.js',
  './js/engine.js',
  './js/bookmarks.js',
  './js/search.js',
  './js/pwa.js',
  './js/ui/drawers.js',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './vendor/foliate-js/view.js',
  './vendor/foliate-js/epub.js',
  './vendor/foliate-js/epubcfi.js',
  './vendor/foliate-js/paginator.js',
  './vendor/foliate-js/fixed-layout.js',
  './vendor/foliate-js/progress.js',
  './vendor/foliate-js/overlayer.js',
  './vendor/foliate-js/text-walker.js',
  './vendor/foliate-js/search.js',
  './vendor/foliate-js/footnotes.js',
  './vendor/foliate-js/vendor/zip.js',
  './fonts/assistant-hebrew-400-normal.woff2',
  './fonts/assistant-hebrew-700-normal.woff2',
  './fonts/assistant-latin-400-normal.woff2',
  './fonts/assistant-latin-700-normal.woff2',
  './fonts/david-libre-hebrew-400-normal.woff2',
  './fonts/david-libre-hebrew-700-normal.woff2',
  './fonts/david-libre-latin-400-normal.woff2',
  './fonts/david-libre-latin-700-normal.woff2',
  './fonts/frank-ruhl-libre-hebrew-400-normal.woff2',
  './fonts/frank-ruhl-libre-hebrew-700-normal.woff2',
  './fonts/frank-ruhl-libre-latin-400-normal.woff2',
  './fonts/frank-ruhl-libre-latin-700-normal.woff2',
  './fonts/heebo-hebrew-400-normal.woff2',
  './fonts/heebo-hebrew-700-normal.woff2',
  './fonts/heebo-latin-400-normal.woff2',
  './fonts/heebo-latin-700-normal.woff2',
  './fonts/noto-serif-hebrew-hebrew-400-normal.woff2',
  './fonts/noto-serif-hebrew-hebrew-700-normal.woff2',
  './fonts/noto-serif-hebrew-latin-400-normal.woff2',
  './fonts/noto-serif-hebrew-latin-700-normal.woff2',
];

self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      // cache: 'reload' bypasses the HTTP cache so a new VERSION never precaches stale files.
      await cache.addAll(SHELL_ASSETS.map(url => new Request(url, { cache: 'reload' })));

      // Best-effort precache of the default demo book if reachable
      try {
        const demoUrl = new URL('../hebrew.epub', self.registration.scope).href;
        const res = await fetch(demoUrl);
        if (res.ok) {
          await cache.put(demoUrl, res);
        }
      } catch {
        // Ignore if demo book is unreachable at install time
      }
    })(),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter(key => key !== VERSION).map(key => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING' || event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);
  const scopeHref = self.registration.scope;
  const demoHref = new URL('../hebrew.epub', scopeHref).href;

  const isInScope = requestUrl.href.startsWith(scopeHref);
  const isDemoBook = requestUrl.href === demoHref;

  // Never intercept requests outside the reader scope (except the precached demo book)
  if (!isInScope && !isDemoBook) {
    return;
  }

  // Navigation requests within scope: network-first with cache fallback to ./index.html
  if (event.request.mode === 'navigate' && isInScope) {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetch(event.request);
          if (networkResponse && networkResponse.ok) {
            const cache = await caches.open(VERSION);
            cache.put('./index.html', networkResponse.clone());
          }
          return networkResponse;
        } catch {
          const cache = await caches.open(VERSION);
          return (
            (await cache.match('./index.html', { ignoreSearch: true })) ||
            (await cache.match('./', { ignoreSearch: true })) ||
            Response.error()
          );
        }
      })(),
    );
    return;
  }

  // Static assets & precached demo book: cache-first
  event.respondWith(
    (async () => {
      const cache = await caches.open(VERSION);
      const cached = await cache.match(event.request, { ignoreSearch: !isDemoBook });
      if (cached) {
        return cached;
      }

      const networkResponse = await fetch(event.request);
      if (networkResponse && networkResponse.ok && isInScope) {
        cache.put(event.request, networkResponse.clone());
      }
      return networkResponse;
    })(),
  );
});
