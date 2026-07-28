const CACHE_NAME = 'churrasqueiro-cache-v1';
const urlsToCache = [
  'index.html',
  'style.css',
  'app.js',
  'favicon.svg',
  'notificacao.mp3'
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

// --- WEB PUSH (NOTIFICAÇÕES EM BACKGROUND) ---
self.addEventListener('push', event => {
  let data = { title: '🔥 ChurrasqueiroExpress', body: 'Novo pedido recebido!' };

  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const uniqueTag = data.tag || `${data.event || 'push'}-${Date.now()}`;

  const options = {
    body: data.body,
    icon: '/churrasqueiro/favicon.svg',
    badge: '/churrasqueiro/favicon.svg',
    vibrate: [1000, 200, 1000, 200, 1000, 200, 500, 100, 500, 100, 500, 100, 1000, 200, 1000, 200, 1000],
    requireInteraction: true,
    renotify: true,
    silent: false,
    tag: uniqueTag,
    data: {
      url: self.registration.scope
    }
  };

  if ('actions' in Notification.prototype) {
    options.actions = [{ action: 'open', title: '🔥 VER AGORA' }];
  }

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
        console.log('Ignorando Push no foreground para evitar som duplo.');
        return;
      }
      return self.registration.showNotification(data.title || '🔥 ChurrasqueiroExpress', options);
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url === event.notification.data.url && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(event.notification.data.url);
      }
    })
  );
});

// --- CACHE STRATEGY ---
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || event.request.url.includes('/api/') || event.request.url.includes('pusher')) {
    return;
  }

  // Network-First para página principal
  if (event.request.mode === 'navigate' || event.request.url.includes('index.html')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match(event.request).then(res => res || new Response("", { status: 200, statusText: "OK" }));
      })
    );
    return;
  }

  // Cache-First para assets estáticos
  event.respondWith(
    caches.match(event.request).then(response => {
      if (response) return response;
      return fetch(event.request).catch(() => new Response("", { status: 200, statusText: "OK" }));
    })
  );
});
