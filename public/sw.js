// FundFlow Service Worker - Real OS Push Notifications
// Version: 4.0.0

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Handle Notification Click (Tapping the banner focuses or opens the app)
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

// Real OS Push Event: Wakes up phone lock screen & notification tray even when browser/app is completely closed!
self.addEventListener('push', (event) => {
  let title = 'FundFlow';
  let body = 'You have a new transaction update.';
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

  const origin = self.location.origin;
  const iconUrl = `${origin}/icon.png`;

  const options = {
    body,
    icon: iconUrl,
    badge: iconUrl,
    tag,
    data: { url },
    vibrate: [300, 100, 300, 100, 300],
    renotify: true,
    requireInteraction: true,
    silent: false,
  };

  event.waitUntil(
    self.registration.showNotification(title, options).catch(() => {
      return self.registration.showNotification(title, {
        body,
        icon: iconUrl,
        data: { url },
      });
    })
  );
});

// Handle in-page message
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, options } = event.data;
    const origin = self.location.origin;
    const iconUrl = `${origin}/icon.png`;
    event.waitUntil(
      self.registration.showNotification(title, {
        ...options,
        icon: iconUrl,
        badge: iconUrl,
        vibrate: [200, 100, 200],
        silent: false,
      })
    );
  }
});
