/**
 * Halqa Service Worker
 * ─────────────────────────────────────────────────────────────────────────────
 * Minimal service worker that handles:
 *   1. Offline fallback — serves /offline when a navigation request fails
 *   2. Network-first caching for navigation requests
 *   3. Cache-first for static assets (_next/static/*)
 *
 * Replaces the auto-generated Workbox bundle previously created by next-pwa@5.
 * Written to be dependency-free — no Workbox, no build step required.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const CACHE_NAME = 'halqa-v1';
const OFFLINE_URL = '/offline';
const STATIC_CACHE_NAME = 'halqa-static-v1';

// Assets to precache on install (the offline page and its minimal dependencies)
const PRECACHE_URLS = [OFFLINE_URL];

// ── Install ───────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  // Take control immediately — don't wait for old SW to expire
  self.skipWaiting();
});

// ── Activate ──────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && key !== STATIC_CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  // Take control of all pages immediately
  self.clients.claim();
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only intercept same-origin requests
  if (url.origin !== self.location.origin) return;

  // Static assets (_next/static/*): cache-first
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(STATIC_CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Navigation requests (HTML pages): network-first, fall back to /offline
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE_URL).then((cached) => cached || new Response('Offline', { status: 503 }))
      )
    );
    return;
  }
});
