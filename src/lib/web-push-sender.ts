'use server';

import webpush from 'web-push';
import { createAdminClient } from '@/lib/supabase/admin-client';

const DEFAULT_VAPID_PUBLIC_KEY = 'BOZNO3EpgZ43q6066SBLi__en5vgE7WPBmIYsKcq_0eit-VJD-NErEIR4gRTKkYwHt6InbvXTxlU38ztCLaszSQ';
const DEFAULT_VAPID_PRIVATE_KEY = 'SlEc-JIgSW23CrS5fH18nqlT9lQJ9QyVJ83oBkHUHzc';

// Configure VAPID details once
const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || DEFAULT_VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || DEFAULT_VAPID_PRIVATE_KEY;
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@fundflow.local';

if (vapidPublicKey && vapidPrivateKey) {
  try {
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  } catch (err) {
    console.error('[WebPush] Error configuring VAPID details:', err);
  }
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

interface StoredPushSub {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  role: 'admin' | 'supervisor';
  supervisorId?: string;
  userId?: string;
  updatedAt?: string;
}

/**
 * Send real Web Push to a specific role ('admin' or 'supervisor') or target supervisor.
 * Wakes up mobile phones and laptops via OS push service (FCM / APNs / WNS) even when browser/app is closed!
 */
export async function sendPushToRole(
  role: 'admin' | 'supervisor',
  payload: PushNotificationPayload,
  targetSupervisorId?: string
) {
  if (!vapidPublicKey || !vapidPrivateKey) {
    console.warn('[WebPush] Cannot send push: VAPID keys not configured.');
    return;
  }

  try {
    const admin = createAdminClient();
    const { data: rows, error } = await admin
      .from('audit_log')
      .select('id, row_id, new_data')
      .eq('table_name', 'push_subscriptions')
      .eq('action', 'SUBSCRIBE');

    if (error || !rows || rows.length === 0) {
      console.log(`[WebPush] No push subscriptions found in database for role: ${role}`);
      return;
    }

    const pushPayloadString = JSON.stringify({
      title: payload.title,
      body: payload.body,
      url: payload.url || (role === 'admin' ? '/admin' : '/supervisor'),
      tag: payload.tag || `fundflow-${Date.now()}`,
    });

    const pushPromises = rows.map(async (row) => {
      const sub = row.new_data as StoredPushSub;
      if (!sub || !sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
        return;
      }

      // Check role match
      if (sub.role !== role) {
        return;
      }

      // Check supervisorId match if target supervisor is specified
      if (role === 'supervisor' && targetSupervisorId && sub.supervisorId !== targetSupervisorId) {
        return;
      }

      const pushSub = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.keys.p256dh,
          auth: sub.keys.auth,
        },
      };

      try {
        await webpush.sendNotification(pushSub, pushPayloadString, {
          TTL: 86400, // 24 hours
          urgency: 'high',
        });
        console.log(`[WebPush] Successfully delivered push to ${role} device (${sub.endpoint.slice(0, 35)}...)`);
      } catch (pushErr: any) {
        // If subscription is expired or unsubscribed, remove it
        if (pushErr?.statusCode === 404 || pushErr?.statusCode === 410) {
          console.log(`[WebPush] Subscription expired (${pushErr.statusCode}), removing: ${sub.endpoint.slice(0, 35)}...`);
          await admin.from('audit_log').delete().eq('id', row.id);
        } else {
          console.warn(`[WebPush] Failed to deliver push to device:`, pushErr?.message || pushErr);
        }
      }
    });

    await Promise.allSettled(pushPromises);
  } catch (err) {
    console.error('[WebPush] Error in sendPushToRole:', err);
  }
}
