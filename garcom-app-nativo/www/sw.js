const CACHE_NAME = 'garcom-cache-v3'; // Incrementado para forçar atualização
const urlsToCache = [
  'index.html',
  'style.css',
  'app.js',
  'favicon.svg',
  '../notificacao.mp3'
];

self.addEventListener('install', event => {
  self.skipWaiting(); // Força o novo service worker a assumir o controle imediatamente
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  // ESTRATÉGIA: Network First para arquivos da API, Cache First para estáticos
  if (event.request.url.includes('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});

// Limpar caches antigos e assumir abas abertas
self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (cacheName !== CACHE_NAME) {
              return caches.delete(cacheName);
            }
          })
        );
      })
    ])
  );
});

// --- WEB PUSH (BACKGROUND NOTIFICATIONS) ---
self.addEventListener('push', event => {
  if (event.data) {
    try {
      const data = event.data.json();
      const options = {
        body: data.body,
        icon: '/garcom/favicon.svg',
        badge: '/garcom/favicon.svg',
        vibrate: [200, 100, 200, 100, 200, 100, 200],
        requireInteraction: true,
        renotify: true,
        tag: data.event || 'push-notification',
        data: {
          url: self.registration.scope
        }
      };

      event.waitUntil(
        self.registration.showNotification(data.title || 'GarçomExpress', options)
      );
    } catch (e) {
      console.error('Erro ao processar push:', e);
    }
  }
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // Se houver uma janela aberta, foca nela
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url === event.notification.data.url && 'focus' in client) {
          return client.focus();
        }
      }
      // Se não, abre uma nova
      if (clients.openWindow) {
        return clients.openWindow(event.notification.data.url);
      }
    })
  );
});