// Offline support for the installed reader (PWA). Scope: /reader/.
// Network-first for everything it caches, so updates arrive when online;
// falls back to the cached copy offline. Book files the user opens stay local
// in the page (File API) and are never sent anywhere or cached here.
const CACHE = 'epubcoil-reader-v1';
const SHELL = [
  '/reader/',
  '/vendor/jszip.min.js',
  '/vendor/epub.min.js',
  '/hebrew.epub',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/favicon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const path = url.pathname === '/reader/index.html' ? '/reader/' : url.pathname;
  if (!SHELL.includes(path)) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(path, copy));
        }
        return response;
      })
      .catch(() => caches.match(path))
  );
});
