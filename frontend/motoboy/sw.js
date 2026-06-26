const CACHE_NAME = 'motoboy-cache-v3';
const urlsToCache = [
  'index.html',
  'style.css',
  'app.js',
  'favicon.svg',
  '../notificacao.mp3'
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
  if (event.request.method !== 'GET' || event.request.url.includes('/api/') || event.request.url.includes('pusher.com')) {
    return;
  }
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        return response || fetch(event.request).catch(err => {
          console.warn('Fetch failed in SW:', event.request.url, err);
          return new Response('', { status: 503, statusText: 'Offline' });
        });
      })
  );
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
