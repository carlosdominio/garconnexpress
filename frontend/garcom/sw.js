const CACHE_NAME = 'garcom-cache-v9'; // Incrementado para forçar atualização
const urlsToCache = [
  'index.html',
  'style.css',
  'app.js',
  'favicon.svg'
];

self.addEventListener('install', event => {
  self.skipWaiting(); // Força o novo service worker a assumir o controle imediatamente
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
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
  let data = { title: '🚨 GarçomExpress', body: 'Nova atualização recebida.' };
  
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      console.error('Erro ao converter JSON do Push:', e);
      data.body = event.data.text();
    }
  }

  // Criamos um 'tag' único para cada mensagem baseado no tempo se não houver um,
  // ou usamos o evento. Isso FORÇA o Android a tratar como uma nova notificação.
  const uniqueTag = data.tag || `${data.event || 'push'}-${Date.now()}`;
  
  const options = {
    body: data.body,
    icon: '/garcom/favicon.svg', // Ideal seria um PNG
    badge: '/garcom/favicon.svg',
    // Padrão de vibração "SOS/Emergência" ultra-agressivo
    vibrate: [1000, 200, 1000, 200, 1000, 200, 500, 100, 500, 100, 500, 100, 1000, 200, 1000, 200, 1000],
    requireInteraction: true,
    renotify: true,
    silent: false,
    tag: uniqueTag, 
    data: {
      url: self.registration.scope
    }
  };

  // Tenta adicionar ações apenas se suportado (evita quebra em navegadores antigos)
  if ('actions' in Notification.prototype) {
    options.actions = [{ action: 'open', title: '✅ VER AGORA' }];
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
        console.log("Ignorando notificação Push no foreground (PWA) para evitar som duplo.");
        return;
      }
      return self.registration.showNotification(data.title || '🚨 GarçomExpress', options);
    })
  );
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