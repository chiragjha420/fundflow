'use client';

import { useEffect } from 'react';

export function PWARegistrar() {
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      // Unregister any active service worker completely in all environments
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) {
          registration.unregister().then((success) => {
            if (success) {
              console.log('Service worker unregistered successfully.');
            }
          });
        }
      });

      // Clear all Cache Storage cache names to avoid static asset cache conflicts
      if ('caches' in window) {
        caches.keys().then((names) => {
          for (const name of names) {
            caches.delete(name).then(() => {
              console.log('Cache storage database deleted:', name);
            });
          }
        });
      }
    }
  }, []);

  return null;
}
