const CACHE_NAME = 'motoboy-cache-v5';
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
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      let isVisible = false;
      for (let i = 0; i < windowClients.length; i++) {
        if (windowClients[i].visibilityState === 'visible') {
          isVisible = true;
          break;
        }
      }
      if (isVisible) {
        console.log("Ignorando push notification no foreground (PWA) para evitar som duplo.");
        return;
      }
      return self.registration.showNotification(data.title || 'Motoboy Express', options);
    })
  );
});
