/* KnowFacts Factory — Service Worker
   - precache app shell เพื่อเปิดแบบ offline ได้ + Add to Home Screen
   - cache-first สำหรับไฟล์ static (same-origin GET) + อัปเดตเบื้องหลัง
   - ไม่ยุ่งกับการเรียก API (POST / cross-origin) — ปล่อยผ่านเครือข่ายตรง
   ** เพิ่มเลขเวอร์ชันทุกครั้งที่แก้ app shell เพื่อบังคับอัปเดต cache ** */
const CACHE = 'knowfacts-v1-0';

const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './manifest.webmanifest',
  './icon.svg',
  './js/kf.providers.js',
  './js/kf.core.js',
  './js/kf.app.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(APP_SHELL.map((u) =>
        c.add(new Request(u, { cache: 'reload' })).catch(() => {})
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('./index.html').then((r) => r || caches.match('./'))));
    return;
  }
  if (sameOrigin) {
    e.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req).then((res) => {
          if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); }
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.ok && (res.type === 'basic' || res.type === 'cors')) {
          const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
