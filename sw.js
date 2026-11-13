// Uygulamayı internetsiz çalıştırmak için dosyaları önbelleğe alır.
// Yeni sürüm yayınlarken VERSION değerini artırın.
const VERSION = 'v1.0.1';
const CACHE = 'muhasebe-' + VERSION;
const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/util.js',
  'js/store.js',
  'js/model.js',
  'js/excel.js',
  'js/rates.js',
  'js/ui.js',
  'js/router.js',
  'js/components.js',
  'js/views/home.js',
  'js/views/entries.js',
  'js/views/entryForm.js',
  'js/views/payments.js',
  'js/views/cari.js',
  'js/views/reports.js',
  'js/views/settings.js',
  'js/views/lock.js',
  'vendor/preact-htm.js',
  'vendor/exceljs.min.js',
  'vendor/chart.umd.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/icon-180.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('muhasebe-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // kur servisleri doğrudan internetten
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => (req.mode === 'navigate' ? caches.match('index.html') : Response.error()));
    })
  );
});
