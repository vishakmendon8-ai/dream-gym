// Dream Gym Service Worker

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Receive encrypted Web Push messages from backend push service
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {
      title: 'Dream Gym',
      body: event.data ? event.data.text() : 'You have a new update from Dream Gym.',
    };
  }

  const title = data.title || 'Dream Gym';
  const options = {
    body: data.body || 'You have a new update from Dream Gym.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [200, 100, 200],
    tag: data.tag || 'dreamgym-notification',
    renotify: true,
    requireInteraction: true,
    data: {
      url: data.url || '/member',
      timestamp: data.timestamp || Date.now(),
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Open or focus Member App when notification is tapped
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl =
    (event.notification.data && event.notification.data.url) || '/member';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          client.postMessage({ type: 'NAVIGATE', url: targetUrl });
          return;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'SHOW_NOTIFICATION') {
    const { title, body, url, tag } = event.data;
    self.registration.showNotification(title || 'Dream Gym', {
      body: body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      vibrate: [200, 100, 200],
      tag: tag || 'dreamgym-notification',
      renotify: true,
      requireInteraction: true,
      data: { url: url || '/member', timestamp: Date.now() },
    });
  }
});
