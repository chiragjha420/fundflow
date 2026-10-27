'use server';

import { createAdminClient } from '@/lib/supabase/admin-client';

export type NotificationBroadcastPayload = 
  | {
      type: 'office_disbursement';
      to_supervisor_id: string;
      supervisor_name?: string;
      amount: number;
      note?: string;
    }
  | {
      type: 'supervisor_transfer';
      from_supervisor_id: string;
      from_supervisor_name: string;
      to_supervisor_id: string;
      amount: number;
      note?: string;
    }
  | {
      type: 'cash_request';
      supervisor_id: string;
      supervisor_name: string;
      factory_name: string;
      amount: number;
      note: string;
    }
  | {
      type: 'receipt_confirmed';
      from_type: 'office' | 'supervisor';
      from_supervisor_id?: string;
      to_supervisor_name: string;
      amount: number;
    }
  | {
      type: 'receipt_disputed';
      from_type: 'office' | 'supervisor';
      from_supervisor_id?: string;
      to_supervisor_name: string;
      amount: number;
      note?: string;
    };

/**
 * Broadcast an instant real-time notification across all connected FundFlow devices (PC & Phone).
 * Uses Supabase Realtime broadcast channels (<50ms delivery).
 */
export async function broadcastNotificationAction(payload: NotificationBroadcastPayload) {
  try {
    const admin = createAdminClient();
    const channel = admin.channel('fundflow-notifications');
    await channel.subscribe();
    await channel.send({
      type: 'broadcast',
      event: 'fundflow_alert',
      payload,
    });
    admin.removeChannel(channel);
  } catch (err) {
    console.error('Failed to broadcast notification:', err);
  }
}
