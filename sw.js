/* NovelTrans Pro — Service Worker
   - precache app shell (HTML/CSS/JS/manifest/icon) เพื่อให้เปิดแบบ offline ได้
   - cache-first สำหรับไฟล์ static ของแอพ (same-origin GET) + อัปเดตเบื้องหลัง
   - ไม่ยุ่งกับการเรียก API (POST / cross-origin) — ปล่อยผ่านเครือข่ายตรง
   ** เพิ่มเลขเวอร์ชันทุกครั้งที่แก้ไฟล์ app shell เพื่อบังคับอัปเดต cache ** */
const CACHE = 'noveltrans-v12-1';

const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './manifest.webmanifest',
  './icon.svg',
  './js/app.core.js',
  './js/app.providers.js',
  './js/app.workspace.js',
  './js/app.chapters-glossary.js',
  './js/app.translate.js',
  './js/app.review-batch.js',
  './js/app.tools.js',
  './js/app.reader-presets.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // ใช้ {cache:'reload'} ให้ดึงไฟล์สดตอนติดตั้ง · addAll fail ถ้าไฟล์ใดโหลดไม่ได้ จึง map ทีละไฟล์กัน fail ทั้งชุด
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
  if (req.method !== 'GET') return;                       // ปล่อยผ่าน POST (เรียก API ฯลฯ)

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // navigation (เปิดหน้า) → network-first แล้ว fallback เป็น index.html ที่ cache ไว้ (offline)
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // ไฟล์ static ของแอพ (same-origin) → cache-first + อัปเดตเบื้องหลัง
  if (sameOrigin) {
    e.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // cross-origin (เช่น Google Fonts) → stale-while-revalidate; เจ้าอื่น (API) ที่ fail ก็ปล่อย error ปกติ
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.ok && (res.type === 'basic' || res.type === 'cors')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
