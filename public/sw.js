const CACHE_NAME = "watch-with-me-v3";

function appBase() {
  return new URL(self.registration.scope).pathname;
}

self.addEventListener("install", (event) => {
  const base = appBase();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll([
      base,
      `${base}manifest.webmanifest`,
      `${base}favicon.svg`,
      `${base}icon-192.png`,
      `${base}icon-512.png`,
    ])),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(appBase(), copy));
          return response;
        })
        .catch(() => caches.match(appBase())),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
      return cached ?? network;
    }),
  );
});
