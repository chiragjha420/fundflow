'use client';

import { useEffect } from 'react';
import { requestNotificationPermission, getNotificationPermission } from '@/lib/notifications';

export function PWARegistrar() {
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      // Register service worker for real-time mobile push & OS notification banners
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((reg) => {
          reg.update().catch(() => {});
          console.log('[FundFlow] Service Worker registered for notifications:', reg.scope);
          if (reg.waiting) {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          }
        })
        .catch((err) => {
          console.warn('[FundFlow] Service Worker registration failed:', err);
        });

      // Request browser notification permission on first user tap/click
      const requestOnGesture = () => {
        if ('Notification' in window && getNotificationPermission() === 'default') {
          requestNotificationPermission().catch(() => {});
        }
      };
      window.addEventListener('click', requestOnGesture, { once: true, passive: true });
      window.addEventListener('touchstart', requestOnGesture, { once: true, passive: true });
    }
  }, []);

  return null;
}
