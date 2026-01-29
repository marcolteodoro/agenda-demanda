// sw.js
const CACHE_NAME = "agenda-demandas-v3"; // <-- troque o sufixo toda vez que publicar
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)));
      await self.clients.claim();
    })()
  );
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(req);
    cache.put(req, fresh.clone());
    return fresh;
  } catch (e) {
    const cached = await cache.match(req);
    if (cached) return cached;
    throw e;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  if (cached) return cached;
  const fresh = await fetch(req);
  cache.put(req, fresh.clone());
  return fresh;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // só GET e só do seu próprio domínio
  if (req.method !== "GET") return;
  if (url.origin !== self.location.origin) return;

  const isHTML = req.mode === "navigate";
  const isAsset = url.pathname.endsWith(".css") || url.pathname.endsWith(".js");

  // HTML/CSS/JS: pega da rede primeiro (pra não ficar velho no iPhone)
  if (isHTML || isAsset) {
    event.respondWith(networkFirst(req));
    return;
  }

  // resto: cache-first
  event.respondWith(cacheFirst(req));
});
