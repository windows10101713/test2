const SHELL_CACHE = 'lmn-shell-v1';
const RUNTIME_TILE_CACHE = 'lmn-tiles-v1';
const RUNTIME_DATA_CACHE = 'lmn-data-v1';

const SHELL_FILES = [
  './',
  'index.html',
  'desktop-main.html',
  'mobile-main.html',
  'mobile-results.html',
  'mobile-search.html',
  'mobile-saved.html',
  'mobile-profile.html',
  'lmn-core.js',
  'manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => ![SHELL_CACHE, RUNTIME_TILE_CACHE, RUNTIME_DATA_CACHE].includes(key))
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkFetch = fetch(request)
    .then((response) => {
      if (response && response.status === 200) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  return cached || networkFetch || new Response('', { status: 504, statusText: 'Offline' });
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') {
    return;
  }

  // App shell and same-origin static files
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(event.request, SHELL_CACHE));
    return;
  }

  // OSM tiles: cache first for offline usability
  if (url.hostname.includes('tile.openstreetmap.org')) {
    event.respondWith(cacheFirst(event.request, RUNTIME_TILE_CACHE));
    return;
  }

  // Geocoding/POI data: stale-while-revalidate
  if (
    url.hostname.includes('nominatim.openstreetmap.org') ||
    url.hostname.includes('overpass-api.de')
  ) {
    event.respondWith(staleWhileRevalidate(event.request, RUNTIME_DATA_CACHE));
  }
});
