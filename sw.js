// Service worker: guarda la app y el detector en el teléfono para que funcione sin conexión.
const VERSION = 'faro-v5';
const MODELS = 'faro-models-v2'; // aparte, para no volver a descargar el modelo al actualizar la app
const SHELL = [
  './', 'index.html', 'css/styles.css', 'manifest.webmanifest', 'icons/icon.svg',
  'js/app.js', 'js/voice.js', 'js/audio.js', 'js/sensors.js', 'js/store.js', 'js/navigator.js',
  'js/vision.js', 'js/detector.js', 'js/safety.js', 'js/plausibility.js', 'js/map.js', 'js/vocab.js', 'js/intents.js', 'js/labels.js', 'js/geo.js', 'js/brain.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('faro-') && k !== VERSION && k !== MODELS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (sameOrigin && url.pathname.includes('/models/')) {
    // modelo: caché primero (pesa ~20 MB)
    e.respondWith(
      caches.open(MODELS).then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) c.put(req, res.clone());
        return res;
      }))),
    );
  } else if (sameOrigin) {
    // red primero (para recibir actualizaciones), caché si no hay conexión
    e.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); return res; })
        .catch(() => caches.match(req).then((r) => r || caches.match('index.html'))),
    );
  } else {
    // librerías y pesos del modelo: caché primero
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      })),
    );
  }
});
