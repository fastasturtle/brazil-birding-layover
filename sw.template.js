/* Service worker for the São Paulo layover guide. Version: __VERSION__
   Two caches with fixed names; the offline package (offline-manifest.json) drives updates,
   renaming a cache is the emergency reset. The worker only serves; downloading is done by the page. */
const VERSION = '__VERSION__';
const PAGES = 'pages-v1';
const MEDIA = 'media-v1';
const BASE = new URL(self.registration.scope).pathname; // e.g. /brazil-birding-layover/
const INDEX = BASE + 'index.html';
const SERVICE = /(^|\/)(sw\.js|version\.json|offline-manifest[^/]*\.json)$/;
const CORE = ['index.html', 'offline.js', 'manifest.webmanifest', 'vendor/leaflet/leaflet.css', 'vendor/leaflet/leaflet.js',
  'vendor/leaflet/images/marker-icon.png', 'vendor/leaflet/images/marker-icon-2x.png', 'vendor/leaflet/images/marker-shadow.png'];

const stub = () => new Response(
  '<!doctype html><meta charset="utf-8"><title>Офлайн</title><body style="font-family:system-ui;padding:24px"><h1>Нет сети</h1><p>Страница ещё не сохранена. Откройте её один раз с интернетом, затем на странице в разделе «Офлайн» скачайте пакет.</p>',
  { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

const keyOf = (url) => { const u = new URL(url); u.search = ''; u.hash = ''; return u.href; };
const isNav = (req) => req.mode === 'navigate' || (req.destination === 'document');

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(PAGES);
    await Promise.all(CORE.map(async (p) => {
      try {
        const res = await fetch(BASE + p, { cache: 'no-cache' });
        if (res.ok && res.type === 'basic' && !res.redirected) await cache.put(keyOf(res.url), res);
      } catch { /* best effort */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name !== PAGES && name !== MEDIA) await caches.delete(name);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'version') event.source?.postMessage({ type: 'version', version: VERSION });
});

async function revalidate(cache, url) {
  try {
    const res = await fetch(url, { cache: 'no-cache', redirect: 'manual' });
    if (res.ok && res.type === 'basic' && !res.redirected) await cache.put(keyOf(url), res);
  } catch { /* offline */ }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;
  const nav = isNav(req);
  // The package downloader bypasses the worker with cache:'no-cache'; user reloads are navigations and must work offline.
  if (!nav && ['no-cache', 'reload', 'no-store'].includes(req.cache)) return;
  if (same && SERVICE.test(url.pathname)) return;

  if (nav || (same && (url.pathname === BASE || url.pathname === INDEX))) {
    event.respondWith((async () => {
      const cache = await caches.open(PAGES);
      const hit = await cache.match(INDEX);
      if (hit) { event.waitUntil(revalidate(cache, INDEX)); return hit; }
      try {
        const res = await fetch(req);
        if (res.ok && res.type === 'basic' && !res.redirected) await cache.put(INDEX, res.clone());
        return res;
      } catch { return (await cache.match(INDEX)) || stub(); }
    })());
    return;
  }

  if (same) {
    event.respondWith((async () => {
      const cache = await caches.open(PAGES);
      const hit = await cache.match(keyOf(req.url));
      const image = req.destination === 'image' || /\.(png|jpe?g|svg|webp)$/i.test(url.pathname);
      if (hit) { if (!image) event.waitUntil(revalidate(cache, req.url)); return hit; }
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') await cache.put(keyOf(req.url), res.clone());
      return res;
    })());
    return;
  }

  // Cross-origin: map tiles, fonts. Cache first, then network; nothing to fall back to.
  event.respondWith((async () => {
    const cache = await caches.open(MEDIA);
    const hit = await cache.match(keyOf(req.url));
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok) await cache.put(keyOf(req.url), res.clone());
    return res;
  })());
});
