'use server';

import { createAdminClient } from '@/lib/supabase/admin-client';

export interface PushSubscriptionData {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

/**
 * Save or update a Web Push subscription in the database.
 */
export async function savePushSubscriptionAction(
  subscription: PushSubscriptionData,
  role: 'admin' | 'supervisor',
  supervisorId?: string,
  userId?: string
) {
  if (!subscription || !subscription.endpoint || !subscription.keys) {
    return { success: false, error: 'Invalid subscription data.' };
  }

  try {
    const admin = createAdminClient();

    // Check if subscription with this endpoint already exists
    const { data: existing } = await admin
      .from('audit_log')
      .select('id, row_id, new_data')
      .eq('table_name', 'push_subscriptions')
      .limit(100);

    const match = existing?.find(
      (row) => (row.new_data as any)?.endpoint === subscription.endpoint
    );

    const payload = {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
      role,
      supervisorId: supervisorId || null,
      userId: userId || null,
      updatedAt: new Date().toISOString(),
    };

    if (match) {
      await admin
        .from('audit_log')
        .update({
          new_data: payload,
          changed_at: new Date().toISOString(),
        })
        .eq('id', match.id);
    } else {
      await admin.from('audit_log').insert({
        table_name: 'push_subscriptions',
        action: 'SUBSCRIBE',
        row_id: crypto.randomUUID(),
        new_data: payload,
        changed_at: new Date().toISOString(),
      });
    }

    return { success: true };
  } catch (err: any) {
    console.error('[WebPush] Error saving push subscription:', err);
    return { success: false, error: err?.message || 'Failed to save subscription' };
  }
}

/**
 * Trigger Web Push to a recipient supervisor for cash transfer.
 */
export async function sendSupervisorTransferPushAction(
  toSupervisorId: string,
  amount: number,
  fromSupervisorName: string
) {
  try {
    const { sendPushToRole } = await import('@/lib/web-push-sender');
    await sendPushToRole('supervisor', {
      title: '💸 Cash Transfer Received!',
      body: `${fromSupervisorName || 'A supervisor'} sent you ₹${amount.toLocaleString('en-IN')}. Tap to confirm on your dashboard.`,
      url: '/supervisor',
    }, toSupervisorId);
    return { success: true };
  } catch (err: any) {
    console.error('[WebPush] Failed to send supervisor transfer push:', err);
    return { success: false };
  }
}
