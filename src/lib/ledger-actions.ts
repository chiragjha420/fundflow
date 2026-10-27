import { createBrowserClient } from '@/lib/supabase/browser-client';
import { addToSyncQueue } from '@/lib/offline-db';
import { updateWorkerPhoneServer, updateWorkerServer, createWorkerServer } from '@/app/actions/workers';
import { broadcastNotificationAction } from '@/lib/realtime-broadcaster';
import { sendSupervisorTransferPushAction } from '@/app/actions/push-actions';

const supabase = createBrowserClient();

// Helper to check online status
function isAppOnline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine;
}

// Fast helper to get current user ID without remote 950ms HTTP auth roundtrip
async function getFastCurrentUserId(): Promise<string | undefined> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user?.id) return session.user.id;
  } catch {}
  try {
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id;
  } catch {
    return undefined;
  }
}

export async function disburseToWorkerAction(
  workerId: string,
  supervisorId: string,
  amount: number,
  note?: string
) {
  const cleanNote = note?.trim() || 'Cash Advance';

  const payload = {
    p_worker_id: workerId,
    p_supervisor_id: supervisorId,
    p_amount: amount,
    p_note: cleanNote,
  };

  if (isAppOnline()) {
    const userId = await getFastCurrentUserId();
    const { data, error } = await supabase.rpc('disburse_to_worker', {
      ...payload,
      p_created_by: userId,
    });
    if (error) {
      // If it's a network error, queue it
      if (error.message.includes('fetch') || error.message.includes('network')) {
        await queueAction('disburse_to_worker', payload);
        return { queued: true };
      }
      throw new Error(error.message);
    }

    return { success: true, id: data };
  } else {
    await queueAction('disburse_to_worker', payload);
    return { queued: true };
  }
}

export async function transferToSupervisorAction(
  toSupervisorId: string,
  fromSupervisorId: string,
  amount: number,
  note: string
) {
  const cleanNote = note?.trim();
  if (!cleanNote) {
    throw new Error('Notes/remarks are required for supervisor transfer.');
  }

  const payload = {
    p_to_supervisor_id: toSupervisorId,
    p_from_supervisor_id: fromSupervisorId,
    p_amount: amount,
    p_note: cleanNote,
  };

  if (isAppOnline()) {
    const userId = await getFastCurrentUserId();
    const { data, error } = await supabase.rpc('transfer_to_supervisor', {
      ...payload,
      p_created_by: userId,
    });
    if (error) {
      if (error.message.includes('fetch') || error.message.includes('network')) {
        await queueAction('transfer_to_supervisor', payload);
        return { queued: true };
      }
      throw new Error(error.message);
    }

    // Send real OS Web Push to recipient supervisor
    sendSupervisorTransferPushAction(toSupervisorId, amount, 'A Supervisor').catch(() => {});

    // Broadcast instant alert to recipient supervisor's phone
    broadcastNotificationAction({
      type: 'supervisor_transfer',
      from_supervisor_id: fromSupervisorId,
      from_supervisor_name: 'A Supervisor',
      to_supervisor_id: toSupervisorId,
      amount,
      note: cleanNote,
    }).catch(() => {});

    return { success: true, id: data };
  } else {
    await queueAction('transfer_to_supervisor', payload);
    return { queued: true };
  }
}

export async function logExpenseAction(
  supervisorId: string,
  factoryId: string,
  amount: number,
  category: string,
  note: string,
  photoUrl: string | null
) {
  const cleanNote = note?.trim();
  if (!cleanNote) {
    throw new Error('Notes/remarks are required for expense entry.');
  }

  const payload = {
    p_supervisor_id: supervisorId,
    p_factory_id: factoryId,
    p_amount: amount,
    p_category: category,
    p_note: cleanNote,
    p_photo_url: photoUrl,
  };

  if (isAppOnline()) {
    const userId = await getFastCurrentUserId();
    const { data, error } = await supabase.rpc('log_expense', {
      ...payload,
      p_created_by: userId,
    });
    if (error) {
      if (error.message.includes('fetch') || error.message.includes('network')) {
        await queueAction('log_expense', payload);
        return { queued: true };
      }
      throw new Error(error.message);
    }

    return { success: true, id: data };
  } else {
    await queueAction('log_expense', payload);
    return { queued: true };
  }
}

export async function confirmTransactionAction(txId: string) {
  const payload = { id: txId };

  if (isAppOnline()) {
    const userId = await getFastCurrentUserId();
    const { error } = await supabase
      .from('cash_transactions')
      .update({
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        confirmed_by: userId,
      })
      .eq('id', txId);

    if (error) {
      if (error.message.includes('fetch') || error.message.includes('network')) {
        await queueAction('confirm_transaction', payload);
        return { queued: true };
      }
      throw new Error(error.message);
    }
    return { success: true };
  } else {
    await queueAction('confirm_transaction', payload);
    return { queued: true };
  }
}

export async function disputeTransactionAction(txId: string, note: string) {
  const payload = { id: txId, note };

  if (isAppOnline()) {
    const userId = await getFastCurrentUserId();
    const { error } = await supabase
      .from('cash_transactions')
      .update({
        status: 'disputed',
        note,
        confirmed_at: new Date().toISOString(),
        confirmed_by: userId,
      })
      .eq('id', txId);

    if (error) {
      if (error.message.includes('fetch') || error.message.includes('network')) {
        await queueAction('dispute_transaction', payload);
        return { queued: true };
      }
      throw new Error(error.message);
    }
    return { success: true };
  } else {
    await queueAction('dispute_transaction', payload);
    return { queued: true };
  }
}

export async function createWorkerAction(
  factoryId: string,
  supervisorId: string,
  name: string,
  phone: string | null,
  photoUrl: string | null,
  openingAdvance: number
) {
  const id = crypto.randomUUID();
  const payload = {
    id,
    factory_id: factoryId,
    supervisor_id: supervisorId,
    name,
    phone,
    photo_url: photoUrl,
    opening_advance: openingAdvance,
  };

  if (isAppOnline()) {
    try {
      const res = await createWorkerServer(factoryId, supervisorId, name, phone, photoUrl, openingAdvance);
      if (!res.success) {
        throw new Error(res.error || 'Failed to create worker.');
      }
      return { success: true, id: res.id || id };
    } catch (err: any) {
      if (err.message && (err.message.includes('fetch') || err.message.includes('network'))) {
        await queueAction('create_worker', payload);
        return { queued: true, id };
      }
      throw err;
    }
  } else {
    await queueAction('create_worker', payload);
    return { queued: true, id };
  }
}

export async function updateWorkerAction(
  workerId: string,
  name: string,
  phone: string | null,
  photoUrl: string | null
) {
  const payload = {
    id: workerId,
    name,
    phone,
    photo_url: photoUrl,
  };

  if (isAppOnline()) {
    try {
      const res = await updateWorkerServer(workerId, name, phone, photoUrl);
      if (!res.success) {
        throw new Error(res.error || 'Failed to update worker.');
      }
      return { success: true };
    } catch (err: any) {
      if (err.message && (err.message.includes('fetch') || err.message.includes('network'))) {
        await queueAction('update_worker', payload);
        return { queued: true };
      }
      throw err;
    }
  } else {
    await queueAction('update_worker', payload);
    return { queued: true };
  }
}

/**
 * Convenient helper to update a worker's mobile number,
 * using admin server action when online to bypass RLS restrictions,
 * and offline sync queue when offline.
 */
export async function updateWorkerPhoneAction(
  workerId: string,
  phone: string,
  currentName: string = 'Worker',
  currentPhotoUrl: string | null = null
) {
  const cleanPhone = phone.trim().replace(/[^\d+]/g, '');
  if (!cleanPhone || cleanPhone.length < 10) {
    throw new Error('Please enter a valid 10-digit mobile number.');
  }
  const formattedPhone = cleanPhone.length === 10 ? `+91${cleanPhone}` : cleanPhone;

  if (isAppOnline()) {
    const res = await updateWorkerPhoneServer(workerId, formattedPhone);
    if (!res.success) {
      throw new Error(res.error || 'Failed to update phone number.');
    }
    return { success: true, formattedPhone };
  } else {
    await queueAction('update_worker', {
      id: workerId,
      name: currentName,
      phone: formattedPhone,
      photo_url: currentPhotoUrl,
    });
    return { queued: true, formattedPhone };
  }
}

// Helper to queue an action to IndexedDB
async function queueAction(type: any, payload: any) {
  const id = crypto.randomUUID();
  await addToSyncQueue({
    id,
    type,
    payload,
  });
}
