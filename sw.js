// Service Worker：把網頁檔案存在手機裡，第二次以後打開不用重新下載；沒網路也能看上次的資料。（做法同教全區的 sw.js）
//   - 網頁本身（index.html）：先向網路拿最新的，3 秒拿不到才用手機裡的（確保程式更新時大家拿到新版）。
//   - 帶版本號的 js／css（?v=…）、固定版本的外部函式庫：版本不變內容就不變，直接用手機裡的。同一個檔案有新版本時，舊版本自動刪掉。
//   - 其他（圖示、截圖、字型）：先用手機裡的，同時在背景更新。
//   - 資料 API 一律不經過這裡，永遠向伺服器拿。
'use strict';

// 同一個網域（bailixiao.github.io）底下有好幾個網站（教全區、書槑子⋯），手機裡的快取是共用的：
// 快取名稱帶上這個網站的路徑，清舊快取時只清自己的，不會清掉別的網站的。
const PREFIX = 'fentan-calendar:' + new URL('./', self.location).pathname + ':';
const CACHE = PREFIX + 'v3'; // 2026-10-15 改版：清掉第一版的檔案
const CDN_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (ev) => {
  ev.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.indexOf(PREFIX) === 0 && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && CDN_HOSTS.indexOf(url.hostname) === -1) return; // API 等其他網址：不處理
  if (sameOrigin && !url.pathname.startsWith(new URL('./', self.location).pathname)) return; // 同網域的別的網站：不處理

  if (req.mode === 'navigate') {
    ev.respondWith(networkFirst(req));
  } else if ((sameOrigin && url.searchParams.has('v')) || url.hostname === 'cdn.jsdelivr.net') {
    ev.respondWith(cacheFirst(req, sameOrigin ? url : null));
  } else {
    ev.respondWith(staleWhileRevalidate(req, ev));
  }
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const key = new URL('./', self.location).href; // 網頁本身只存一份（不分 #／?）
  try {
    // no-cache：每次都問伺服器有沒有新版（GitHub Pages 會讓瀏覽器暫存網頁 10 分鐘，不這樣更新後要等很久）
    const res = await withTimeout(fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }), 3000);
    if (res.ok) cache.put(key, res.clone());
    return res;
  } catch (e) {
    const cached = await cache.match(key);
    if (cached) return cached;
    return fetch(req);
  }
}

async function cacheFirst(req, versionedUrl) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok) {
    await cache.put(req, res.clone());
    if (versionedUrl) pruneOldVersions(cache, versionedUrl);
  }
  return res;
}

async function staleWhileRevalidate(req, ev) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  const update = fetch(req).then((res) => {
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
    return res;
  });
  if (cached) {
    ev.waitUntil(update.catch(() => {}));
    return cached;
  }
  return update;
}

/** 同一個檔案（同路徑）只留目前這個版本 */
async function pruneOldVersions(cache, url) {
  const keys = await cache.keys();
  await Promise.all(keys.map((k) => {
    const u = new URL(k.url);
    return u.origin === url.origin && u.pathname === url.pathname && u.search !== url.search ? cache.delete(k) : null;
  }));
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((r) => { clearTimeout(t); resolve(r); }, (e) => { clearTimeout(t); reject(e); });
  });
}

// ---------- 手機提醒（規格第 10-1 節） ----------
// 推播本身不帶內容：收到後用這支手機的代號（推播網址 SHA-256 前 16 碼）回伺服器問要顯示什麼。

self.window = self; // site.js、config.js 寫的是 window.SITE、window.APP_CONFIG
try { importScripts('js/site.js', 'js/config.js'); } catch (e) { /* 讀不到就用通用通知 */ }

async function pushId(endpoint) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

async function buildNotification() {
  const fallback = { title: '🙏 ' + ((self.SITE && self.SITE.name) || '行事曆'), body: '有新的提醒，點開看看 😊', url: '#/' };
  try {
    const sub = await self.registration.pushManager.getSubscription();
    const api = self.APP_CONFIG && self.APP_CONFIG.API_URL;
    if (!sub || !api) return fallback;
    const res = await fetch(api + (api.indexOf('?') === -1 ? '?' : '&') + 'action=pushSummary&id=' + await pushId(sub.endpoint));
    const json = await res.json();
    return json.ok && json.data.message ? json.data.message : fallback;
  } catch (e) {
    return fallback;
  }
}

self.addEventListener('push', (ev) => {
  ev.waitUntil(buildNotification().then((n) => self.registration.showNotification(n.title, {
    body: n.body,
    icon: 'icons/icon-192.png',
    badge: 'icons/favicon-32.png',
    tag: 'fentan-' + Date.now(),
    data: { url: n.url || '#/' }
  })));
});

self.addEventListener('notificationclick', (ev) => {
  ev.notification.close();
  const url = new URL((ev.notification.data && ev.notification.data.url) || '#/', self.registration.scope).href;
  ev.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((w) => w.url.startsWith(self.registration.scope));
    if (win) {
      await win.focus();
      return win.navigate ? win.navigate(url) : null;
    }
    return self.clients.openWindow(url);
  })());
});
