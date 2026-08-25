const SHELL_CACHE = "pistali-shell-v2";
const DATA_CACHE = "pistali-data-v2";

const SHELL_FILES = [
  "./index.html",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-192-maskable.png",
  "./icons/icon-512-maskable.png"
];

// GET-запросы к бэкенду, чьи ответы стоит кэшировать, чтобы приложение
// могло показать последнее известное состояние без интернета.
const BACKEND_GET_PATTERNS = [
  "/gps-backend/api/state_load.php",
  "/gps-backend/api/live.php",
  "/gps-backend/api/history.php"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== DATA_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

function isBackendGet(request) {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  return BACKEND_GET_PATTERNS.some((p) => url.pathname.endsWith(p));
}

function isShellRequest(request) {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  return url.origin === self.location.origin;
}

self.addEventListener("push", (event) => {
  let data = { title: "Пистали", body: "Новое уведомление" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (e) { /* если payload не JSON — покажем дефолтный текст */ }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "./icons/icon-192.png",
      badge: "./icons/icon-192.png",
      tag: data.tag || "pistali-notification",
      renotify: true,
      data: { url: data.url || "./index.html" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "./index.html";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(targetUrl.replace("./", "")) && "focus" in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // POST (state_save, update) не кэшируем — только сеть

  if (isBackendGet(request)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(DATA_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  if (isShellRequest(request)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("./index.html")))
    );
  }
});
