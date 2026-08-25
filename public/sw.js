const CACHE_NAME = 'fundflow-cache-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/login',
  '/manifest.json',
  '/icon.png',
  '/logo.png',
];

// Install Event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// Activate Event
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch Interception
self.addEventListener('fetch', (event) => {
  // Only handle standard GET requests
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Skip supabase database calls, next dev server internals, and local api calls to avoid dev-mode conflicts
  if (
    url.hostname.includes('supabase') || 
    url.pathname.startsWith('/_next') ||
    url.pathname.startsWith('/api')
  ) {
    return;
  }

  // Intercept and handle cache
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // Stale-while-revalidate strategy for cached static assets
      if (cachedResponse) {
        fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, networkResponse);
              });
            }
          })
          .catch(() => {});
        return cachedResponse;
      }

      // Network First strategy
      return fetch(event.request)
        .then((networkResponse) => {
          // Only cache successful basic requests
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(async () => {
          // Offline fallback
          if (event.request.mode === 'navigate') {
            const loginCache = await caches.match('/login');
            if (loginCache) return loginCache;
            const rootCache = await caches.match('/');
            if (rootCache) return rootCache;
          }
          // Fallback to a plain text response if offline and no cache matches
          return new Response('Offline: Connection lost.', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/plain' }
          });
        });
    })
  );
});
