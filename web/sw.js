/* Service Worker - cached nur das App-Shell (HTML/CSS/JS), keine Aufgabendaten.
   Server/SQLite ist die alleinige Datenquelle, /api/* wird nie gecacht. */

const VERSION = 'v3';
const SHELL_CACHE = `todo-shell-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './api.js',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // API-Aufrufe nie cachen - immer der aktuelle Server-Stand oder ein Fehler.
  if (url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // Netzwerk zuerst: die App wird noch aktiv weiterentwickelt, eine veraltete
  // gecachte app.js/styles.css soll nie länger als bis zum nächsten Laden
  // "kleben" bleiben. Cache dient nur als Offline-Fallback.
  event.respondWith(
    caches.open(SHELL_CACHE).then(async (cache) => {
      try {
        const res = await fetch(req);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        const hit = await cache.match(req);
        if (hit) return hit;
        throw new Error('offline und nicht im Cache');
      }
    })
  );
});
