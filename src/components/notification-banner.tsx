'use client';

import { useEffect } from 'react';
import { requestNotificationPermission, getNotificationPermission } from '@/lib/notifications';

interface NotificationBannerProps {
  role?: 'admin' | 'supervisor';
  className?: string;
}

export function NotificationBanner(props?: NotificationBannerProps) {
  void props;
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (getNotificationPermission() === 'default') {
        requestNotificationPermission().catch(() => {});
      }
    }
  }, []);

  return null;
}
