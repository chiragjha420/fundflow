'use client';

import { savePushSubscriptionAction, PushSubscriptionData } from '@/app/actions/push-actions';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Register device for Real OS Web Push notifications.
 * Works even when app/browser is completely closed!
 */
export async function registerDeviceForWebPush(
  role: 'admin' | 'supervisor',
  supervisorId?: string
): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('[WebPush] Push messaging is not supported in this browser.');
    return false;
  }

  const DEFAULT_VAPID_PUBLIC_KEY = 'BOZNO3EpgZ43q6066SBLi__en5vgE7WPBmIYsKcq_0eit-VJD-NErEIR4gRTKkYwHt6InbvXTxlU38ztCLaszSQ';
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || DEFAULT_VAPID_PUBLIC_KEY;

  try {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();

    // If no existing subscription, prompt and subscribe
    if (!subscription) {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        console.warn('[WebPush] Notification permission not granted.');
        return false;
      }

      const convertedKey = urlBase64ToUint8Array(vapidPublicKey);
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedKey,
      });
    }

    const rawSub = subscription.toJSON();
    if (rawSub.endpoint && rawSub.keys) {
      const subData: PushSubscriptionData = {
        endpoint: rawSub.endpoint,
        expirationTime: rawSub.expirationTime,
        keys: {
          p256dh: rawSub.keys.p256dh!,
          auth: rawSub.keys.auth!,
        },
      };

      await savePushSubscriptionAction(subData, role, supervisorId);
      console.log(`[WebPush] Device successfully registered for ${role} OS push notifications!`);
      return true;
    }

    return false;
  } catch (err) {
    console.warn('[WebPush] Error registering for Web Push:', err);
    return false;
  }
}
