/* ==========================================================================
 * Pragathi Power CRM — the app-shell service worker (28-Oct, PWA).
 *
 * What it does, and deliberately no more:
 *   - page loads ("navigations"): network first, so a new deploy is picked up
 *     at once; the cached shell only when the network is gone
 *   - /static/* (fingerprinted by the build, never changes under one name):
 *     cache first, then the network
 *   - the small root assets (manifest, logos, icons): cached, refreshed in
 *     the background
 *   - /api/* and /uploads/*: never touched. The data is always the server's,
 *     so what everyone sees is the same live record.
 *   - anything cross-origin (fonts, Firebase): left to the browser
 *
 * Push notifications are handled by firebase-messaging-sw.js, imported here
 * so one worker serves both; if that script cannot be fetched (offline on
 * first install) the shell still installs and push joins at the next update.
 * ========================================================================== */
const SHELL_CACHE = 'pps-shell-v1';
const STATIC_CACHE = 'pps-static-v1';
const SHELL = ['/', '/manifest.json', '/logo.png', '/logo-full.png', '/icon-192.png'];
const ROOT_ASSET = /^\/(manifest\.json|logo\.png|logo-full\.png|icon-[a-z0-9-]+\.png|apple-touch-icon\.png|favicon(-32)?\.(png|ico))$/;

try { importScripts('/firebase-messaging-sw.js'); } catch (e) { /* push joins at the next update */ }

// Which of the strategies above a request gets. 'none' = not handled here.
function strategyFor(request) {
  if (!request || request.method !== 'GET') return 'none';
  let url;
  try { url = new URL(request.url); } catch (e) { return 'none'; }
  if (url.origin !== self.location.origin) return 'none';
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) return 'none';
  if (request.mode === 'navigate') return 'shell';
  if (url.pathname.startsWith('/static/')) return 'static';
  if (ROOT_ASSET.test(url.pathname)) return 'asset';
  return 'none';
}

const okToCache = (res) => !!res && res.ok && (res.type === 'basic' || res.type === 'default');

async function fromNetworkThenShell(request) {
  try {
    const res = await fetch(request);
    if (okToCache(res)) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put('/', res.clone());
    }
    return res;
  } catch (e) {
    const cached = await caches.match('/');
    if (cached) return cached;
    throw e;
  }
}
async function fromCacheThenNetwork(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (okToCache(res)) await cache.put(request, res.clone());
  return res;
}
async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(request);
  const refresh = fetch(request).then(async (res) => { if (okToCache(res)) await cache.put(request, res.clone()); return res; }).catch(() => null);
  if (hit) { refresh.catch(() => {}); return hit; }
  const res = await refresh;
  if (res) return res;
  throw new Error('offline');
}
function handle(request) {
  switch (strategyFor(request)) {
    case 'shell': return fromNetworkThenShell(request);
    case 'static': return fromCacheThenNetwork(request);
    case 'asset': return staleWhileRevalidate(request);
    default: return null;
  }
}

// Drop the fingerprinted files a newer build no longer ships.
async function pruneStatic() {
  try {
    const res = await fetch('/asset-manifest.json', { cache: 'no-store' });
    if (!res.ok) return;
    const m = await res.json();
    const live = new Set(Object.values(m.files || {}).map(p => new URL(p, self.location.origin).pathname));
    const cache = await caches.open(STATIC_CACHE);
    for (const req of await cache.keys()) {
      const p = new URL(req.url).pathname;
      if (!live.has(p)) await cache.delete(req);
    }
  } catch (e) { /* next activation */ }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = [SHELL_CACHE, STATIC_CACHE];
    for (const k of await caches.keys()) if (!keep.includes(k)) await caches.delete(k);
    await pruneStatic();
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (event) => {
  const p = handle(event.request);
  if (p) event.respondWith(p);
});
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// For the unit harness only.
self.__pps = { strategyFor, handle, pruneStatic, SHELL_CACHE, STATIC_CACHE, SHELL };
