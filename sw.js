const CACHE = 'elegant-timer-v32';
const ASSETS = [
  './',
  './index.html',
  './app.html',
  './about.html',
  './faq.html',
  './contact.html',
  './privacy.html',
  './terms.html',
  './cookies.html',
  './style.css',
  './site.css',
  './script.js',
  './site.js',
  './manifest.json',
  './robots.txt',
  './sitemap.xml',
  './favicon.ico',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// network-first: always try the live version, fall back to cache when offline.
// IMPORTANT: only fall back to index.html for page navigations — never for CSS/JS/assets.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  e.respondWith(
    fetch(req)
      .then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return resp;
      })
      .catch(() =>
        caches.match(req).then((cached) => {
          if (cached) return cached;
          if (req.mode === 'navigate') {
            // app client-routes fall back to the SPA shell; everything else to the landing
            const p = new URL(req.url).pathname.replace(/\/+$/, '');
            const appRoutes = ['/welcome', '/timer', '/pomodoro', '/timebox'];
            return caches.match(appRoutes.includes(p) ? './app.html' : './index.html');
          }
          return Response.error();
        })
      )
  );
});
