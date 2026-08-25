import { createBrowserClient } from '@/lib/supabase/browser-client';
import { addToSyncQueue } from '@/lib/offline-db';

const supabase = createBrowserClient();

// Helper to check online status
function isAppOnline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine;
}

export async function disburseToWorkerAction(
  workerId: string,
  supervisorId: string,
  amount: number,
  note: string
) {
  const payload = {
    p_worker_id: workerId,
    p_supervisor_id: supervisorId,
    p_amount: amount,
    p_note: note,
  };

  if (isAppOnline()) {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.rpc('disburse_to_worker', {
      ...payload,
      p_created_by: user?.id,
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
  const payload = {
    p_to_supervisor_id: toSupervisorId,
    p_from_supervisor_id: fromSupervisorId,
    p_amount: amount,
    p_note: note,
  };

  if (isAppOnline()) {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.rpc('transfer_to_supervisor', {
      ...payload,
      p_created_by: user?.id,
    });
    if (error) {
      if (error.message.includes('fetch') || error.message.includes('network')) {
        await queueAction('transfer_to_supervisor', payload);
        return { queued: true };
      }
      throw new Error(error.message);
    }
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
  const payload = {
    p_supervisor_id: supervisorId,
    p_factory_id: factoryId,
    p_amount: amount,
    p_category: category,
    p_note: note,
    p_photo_url: photoUrl,
  };

  if (isAppOnline()) {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.rpc('log_expense', {
      ...payload,
      p_created_by: user?.id,
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
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('cash_transactions')
      .update({
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        confirmed_by: user?.id,
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
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('cash_transactions')
      .update({
        status: 'disputed',
        note,
        confirmed_at: new Date().toISOString(),
        confirmed_by: user?.id,
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
    const { error } = await supabase
      .from('workers')
      .insert({
        ...payload,
        active: true,
      });

    if (error) {
      if (error.message.includes('fetch') || error.message.includes('network')) {
        await queueAction('create_worker', payload);
        return { queued: true, id };
      }
      throw new Error(error.message);
    }
    return { success: true, id };
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
    const { error } = await supabase
      .from('workers')
      .update({
        name,
        phone,
        photo_url: photoUrl,
      })
      .eq('id', workerId);

    if (error) {
      if (error.message.includes('fetch') || error.message.includes('network')) {
        await queueAction('update_worker', payload);
        return { queued: true };
      }
      throw new Error(error.message);
    }
    return { success: true };
  } else {
    await queueAction('update_worker', payload);
    return { queued: true };
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
