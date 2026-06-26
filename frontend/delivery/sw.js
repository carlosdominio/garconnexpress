
const CACHE_NAME = 'delivery-cache-v1';
const urlsToCache = [
  '/delivery/',
  '/delivery/index.html'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  // O navegador fará o fetch nativamente, sem Service Worker interferindo
});
