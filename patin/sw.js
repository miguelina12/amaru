// Guarda la app del patín para abrirla sin conexión (red primero para recibir actualizaciones).
const VERSION = 'patin-v1';
const SHELL = ['./', 'index.html', 'css/patin.css', 'js/app.js', 'js/ble.js', 'js/protocols.js', 'manifest.webmanifest', 'icon.svg'];

self.addEventListener('install', (e) => e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('patin-') && k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()),
));
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(fetch(e.request, { cache: 'no-cache' })
    .then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); return res; })
    .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))));
});
