/* 赫拉手帐 · Service Worker
 * 只缓存页面外壳与图标，不读取、不修改 localStorage。
 * localStorage 始终由页面本身管理，缓存清理不会触碰用户记录。
 */

const CACHE_VERSION = 'v2';
const CACHE_NAME = `hera-journal-shell-${CACHE_VERSION}`;
const APP_SHELL = [
  './index.html',
  './wiki-data.json',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];
const PAGE_URL = new URL('./index.html', self.location.href).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('hera-journal-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (data === 'SKIP_WAITING' || (data && data.type === 'SKIP_WAITING')) {
    self.skipWaiting();
  }
});

async function networkFirstPage(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      await cache.put(PAGE_URL, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (error) {
    return (await cache.match(PAGE_URL)) ||
      (await cache.match(request)) ||
      new Response('赫拉手帐暂时离线，请重新打开页面。', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok && new URL(request.url).origin === self.location.origin) {
      await cache.put(request, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (error) {
    return new Response('离线状态，这个资源暂时不可用。', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});
