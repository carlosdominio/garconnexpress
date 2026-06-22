const CACHE_NAME = 'cardapio-cache-v2';
const urlsToCache = [
  '/cardapio/',
  '/cardapio/index.html'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || event.request.url.includes('/api/') || event.request.url.includes('pusher')) {
    return;
  }

  if (event.request.mode === 'navigate' || event.request.url.includes('index.html')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match(event.request).then(res => res || new Response("Offline", { status: 503, statusText: "Offline" }));
      })
    );
    return;
  }
  
  event.respondWith(
    caches.match(event.request).then(response => {
      if (response) return response;
      return fetch(event.request).catch(() => new Response("Offline", { status: 503, statusText: "Offline" }));
    })
  );
});
