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

// Web Push Event Handler (Wakes up mobile/PC even when app is closed!)
self.addEventListener('push', (event) => {
  let title = 'FundFlow Notification';
  let body = 'New transaction activity in FundFlow.';
  let url = '/';
  let tag = `fundflow-${Date.now()}`;

  if (event.data) {
    try {
      const payload = event.data.json();
      if (payload.title) title = payload.title;
      if (payload.body) body = payload.body;
      if (payload.url) url = payload.url;
      if (payload.tag) tag = payload.tag;
    } catch {
      body = event.data.text();
    }
  }

  const options = {
    body,
    icon: '/icon.png',
    badge: '/icon.png',
    tag,
    data: { url },
    vibrate: [300, 100, 300, 100, 300],
    renotify: true,
    requireInteraction: true,
    actions: [
      { action: 'open', title: 'Open FundFlow' }
    ]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});
