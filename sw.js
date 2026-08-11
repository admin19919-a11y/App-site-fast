// Service Worker — Карьер Пистали (Диспетчер)
// Стратегия: app-shell кэшируется сразу при установке (быстрый повторный запуск,
// работа при слабом/отсутствующем интернете); CDN-скрипты (React и т.д.) —
// stale-while-revalidate; API-запросы к бэкенду — network-first с кэшем как
// резервом на случай обрыва связи.

const CACHE_VERSION = 'pistali-dispatch-v1';
const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`;
const CDN_CACHE = `${CACHE_VERSION}-cdn`;
const API_CACHE = `${CACHE_VERSION}-api`;

const APP_SHELL_FILES = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

const API_HOST = 'mastertimati.infinityfree.io';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  const keepCaches = [APP_SHELL_CACHE, CDN_CACHE, API_CACHE];
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => !keepCaches.includes(key)).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // POST (обновления координат, экспорт) не кэшируем

  const url = new URL(request.url);

  // 1) Бэкенд API — сначала сеть, при обрыве связи отдаём последний успешный ответ.
  if (url.hostname === API_HOST) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  // 2) CDN-зависимости (esm.sh, шрифты Google) — stale-while-revalidate.
  if (url.hostname.includes('esm.sh') || url.hostname.includes('fonts.g')) {
    event.respondWith(staleWhileRevalidate(request, CDN_CACHE));
    return;
  }

  // 3) Свои файлы приложения (app-shell) — сначала кэш, сеть как резерв/обновление.
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, APP_SHELL_CACHE));
    return;
  }
});

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
    return response;
  } catch (e) {
    return cached || Response.error();
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then((response) => {
    cache.put(request, response.clone());
    return response;
  }).catch(() => cached);
  return cached || fetchPromise;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    cache.put(request, response.clone());
    return response;
  } catch (e) {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ offline: true }), {
      headers: { 'Content-Type': 'application/json' },
      status: 503,
    });
  }
}
