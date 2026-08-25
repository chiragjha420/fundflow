'use client';

import { useEffect } from 'react';

export function PWARegistrar() {
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      // Unregister service worker on localhost to avoid development caching and HMR loops
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        navigator.serviceWorker.getRegistrations().then((registrations) => {
          for (const registration of registrations) {
            registration.unregister().then((success) => {
              if (success) {
                console.log('Development mode: Service worker unregistered.');
              }
            });
          }
        });

        // Clear all Cache Storage cache names to avoid static asset cache conflicts
        if ('caches' in window) {
          caches.keys().then((names) => {
            for (const name of names) {
              caches.delete(name).then(() => {
                console.log('Development mode: Cache deleted:', name);
              });
            }
          });
        }
        return;
      }

      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          console.log('Service worker registered:', reg.scope);
        })
        .catch((err) => {
          console.error('Service worker registration failed:', err);
        });
    }
  }, []);

  return null;
}
