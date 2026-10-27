// FundFlow Service Worker - Real-Time Notifications & PWA
// Version: 3.0.0

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Real Notifications: Handle Notification Click Event on Mobile & Desktop
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(targetUrl) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// Handle direct message from page to display notification (essential for Android Chrome)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, options } = event.data;
    event.waitUntil(
      self.registration.showNotification(title, {
        ...options,
        icon: options?.icon || '/icon.png',
        badge: options?.badge || '/icon.png',
        vibrate: options?.vibrate || [200, 100, 200],
      })
    );
  }
});

// Web Push Event Handler
self.addEventListener('push', (event) => {
  if (!event.data) return;
  try {
    const payload = event.data.json();
    const title = payload.title || 'FundFlow Notification';
    const options = {
      body: payload.body || 'New transaction activity in FundFlow.',
      icon: '/icon.png',
      badge: '/icon.png',
      data: { url: payload.url || '/' },
      vibrate: [200, 100, 200],
    };
    event.waitUntil(self.registration.showNotification(title, options));
  } catch {
    const text = event.data.text();
    event.waitUntil(
      self.registration.showNotification('FundFlow Alert', {
        body: text,
        icon: '/icon.png',
        vibrate: [200, 100, 200],
      })
    );
  }
});
