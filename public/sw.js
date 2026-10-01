// Hand-written service worker: no build plugin, so it works with Turbopack.
// Bump CACHE_VERSION whenever the precache list changes.
const CACHE_VERSION = 'tornado-v1';
const PRECACHE_URLS = [
  '/',
  '/manifest.json',
  '/tornado-icon-192.png',
  '/tornado-icon-512.png',
];

const isStaticAsset = (url) =>
  url.pathname.startsWith('/_next/static/') ||
  /\.(png|svg|ico|woff2?|wav|mp3)$/.test(url.pathname);

const putIfOk = (request, response) =>
  response.ok && response.status === 200
    ? caches.open(CACHE_VERSION).then((cache) => cache.put(request, response.clone()))
    : Promise.resolve();

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Navigations: network first, falling back to the cached shell when offline.
const networkFirst = (request) =>
  fetch(request)
    .then((response) => putIfOk(request, response).then(() => response))
    .catch(() => caches.match(request).then((hit) => hit || caches.match('/')));

// Static assets: cache first, filling the cache on first use.
const cacheFirst = (request) =>
  caches.match(request).then(
    (hit) => hit || fetch(request).then((response) => putIfOk(request, response).then(() => response)),
  );

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // Audio uses Range requests (206 responses), which cannot be cached; let them pass through.
  if (request.method !== 'GET' || url.origin !== self.location.origin || request.headers.has('range')) return;
  if (request.mode === 'navigate') event.respondWith(networkFirst(request));
  else if (isStaticAsset(url)) event.respondWith(cacheFirst(request));
});
