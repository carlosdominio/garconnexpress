const CACHE_NAME = 'motoboy-cache-v4';
const urlsToCache = [
  'index.html',
  'style.css',
  'app.js',
  'favicon.svg'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  // Deixa o navegador fazer o fetch nativo.
  // Evita bugs de CORS e falhas no Capacitor WebView (503 Service Unavailable).
});

self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : { title: 'Motoboy Express', body: 'Nova atualização!' };
  const options = {
    body: data.body,
    icon: 'favicon.svg',
    badge: 'favicon.svg',
    vibrate: [200, 100, 200],
    data: { url: '/motoboy/index.html' }
  };
  event.waitUntil(self.registration.showNotification(data.title, options));
});
