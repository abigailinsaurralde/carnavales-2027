// ---------------------------------------------------------------------------
// Service Worker — Votaciones Carnavales 2027
//
// Hand-rolled, sin dependencias.
//
// Estrategias:
//   /api/*             → network-only (jamás cachear datos electorales)
//   Navegación (SPA)   → network-first, fallback a index.html cacheado
//   Assets estáticos   → stale-while-revalidate (Vite hashes en /assets/)
//   Iconos / manifest  → cache-first (no cambian entre deploys)
// ---------------------------------------------------------------------------

const CACHE_VERSION = "v1";
const CACHE_STATIC = `static-${CACHE_VERSION}`;
const CACHE_ASSETS = `assets-${CACHE_VERSION}`;
const NAVIGATION_FALLBACK = "/index.html";

// Assets estáticos del shell (precache en install)
const SHELL_ASSETS = ["/", NAVIGATION_FALLBACK, "/icon.svg", "/manifest.webmanifest"];

// ----- Install: precache del shell + skipWaiting inmediato -----

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_STATIC)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

// ----- Activate: limpiar caches de versiones anteriores -----

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => {
              // Eliminar caches que no sean de la versión actual
              return (
                key !== CACHE_STATIC &&
                key !== CACHE_ASSETS
              );
            })
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// ----- Message: skip waiting para actualización inmediata -----

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// ----- Fetch: estrategia por tipo de request -----

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Solo interceptar requests GET (POST/PUT/etc van directo a red)
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Ignorar requests de origen diferente (solo same-origin)
  if (url.origin !== self.location.origin) return;

  // /api/* → network-only, nunca cachear datos electorales
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(request));
    return;
  }

  // Navegación SPA → network-first con fallback a index.html
  if (request.mode === "navigate") {
    event.respondWith(networkFirstWithFallback(request));
    return;
  }

  // Assets Vite (/assets/*.js, *.css, etc.) → stale-while-revalidate
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(staleWhileRevalidate(request, CACHE_ASSETS));
    return;
  }

  // Shell estático (iconos, manifest) → cache-first
  event.respondWith(cacheFirst(request, CACHE_STATIC));
});

// ----- Estrategias -----

async function networkFirstWithFallback(request) {
  try {
    const response = await fetch(request);
    // Guardar una copia del shell para uso offline
    if (response.ok) {
      const cache = await caches.open(CACHE_STATIC);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline: intentar servir desde cache, o fallback a index.html
    const cached = await caches.match(request);
    if (cached !== undefined) return cached;
    const fallback = await caches.match(NAVIGATION_FALLBACK);
    return fallback ?? new Response("Offline", { status: 503, headers: { "content-type": "text/plain" } });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached);

  // Si hay cache, devolverlo inmediatamente; si no, esperar a red
  return cached ?? networkPromise;
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached !== undefined) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response("Offline", { status: 503, headers: { "content-type": "text/plain" } });
  }
}
