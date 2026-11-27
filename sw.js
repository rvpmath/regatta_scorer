// Offline support: keeps a copy of every file the app needs on the device.
// When you change any app file, bump VERSION so iPads pick up the new copy.

const VERSION = '1.0.0';
const CACHE = `regatta-scorer-${VERSION}`;
const FILES = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/scoring.js',
  './js/store.js',
  './js/export.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      const cached = await caches.match(request, { ignoreSearch: true });
      if (cached) return cached;
      try {
        return await fetch(request);
      } catch (err) {
        if (request.mode === 'navigate') {
          const page = await caches.match('./index.html');
          if (page) return page;
        }
        throw err;
      }
    })()
  );
});
