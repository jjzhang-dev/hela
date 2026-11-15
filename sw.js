/* 赫拉手帐 · Service Worker
 * 只缓存页面外壳与图标，不读取、不修改 localStorage。
 * localStorage 始终由页面本身管理，缓存清理不会触碰用户记录。
 */

const CACHE_VERSION = 'v6'; // [0.10] 提升版本号，激活时清掉旧外壳
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
const PAGE_TIMEOUT = 3000; // [0.10] 首屏网络等待上限，超时就交给缓存

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

function offlinePageResponse() {
  return new Response('赫拉手帐暂时离线，请重新打开页面。', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

async function networkFirstPage(request) {
  const cache = await caches.open(CACHE_NAME);
  // [0.10] 3 秒内拿不到新页面就先用缓存，避免弱网白屏
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), PAGE_TIMEOUT) : 0;
  try {
    const fresh = await fetch(request, controller ? { signal: controller.signal } : undefined);
    if (fresh && fresh.ok) {
      await cache.put(PAGE_URL, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (error) {
    return (await cache.match(PAGE_URL)) ||
      (await cache.match(request)) ||
      offlinePageResponse();
  } finally {
    clearTimeout(timer); // [0.10] 无论成功与否都清掉超时计时器
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

// [0.10] 先给缓存、后台顺手更新：wiki-data.json 更新后下次打开即生效
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.ok && new URL(request.url).origin === self.location.origin) {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    networkPromise; // 后台继续更新，不阻塞返回
    return cached;
  }

  const fresh = await networkPromise;
  if (fresh) return fresh;

  return new Response('离线状态，这个资源暂时不可用。', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
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

  // [0.10] 词典数据走「缓存优先 + 后台更新」，其余静态资源仍是纯缓存优先
  if (url.pathname.endsWith('/wiki-data.json')) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});
