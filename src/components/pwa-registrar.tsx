'use client';

import { useEffect } from 'react';

export function PWARegistrar() {
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      // Register service worker for real-time mobile push & OS notification banners
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((reg) => {
          console.log('[FundFlow] Service Worker registered for notifications:', reg.scope);
          if (reg.waiting) {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          }
        })
        .catch((err) => {
          console.warn('[FundFlow] Service Worker registration failed:', err);
        });
    }
  }, []);

  return null;
}
