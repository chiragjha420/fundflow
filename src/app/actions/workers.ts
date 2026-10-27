'use server';

import { createAdminClient } from '@/lib/supabase/admin-client';
import { revalidatePath } from 'next/cache';

export interface FactoryWorkerBalance {
  worker_id: string;
  worker_name: string;
  worker_phone: string | null;
  worker_photo_url: string | null;
  factory_id: string;
  supervisor_id: string;
  opening_advance: number;
  total_cash_disbursed: number;
  running_advance: number;
  active: boolean;
}

/**
 * Fetch all active workers and their aggregate balances for a factory.
 * Uses service role to ensure all supervisors assigned to the same factory
 * (e.g. Ankit Bhai & Sanju Bhai at Rama Vihar) have 100% unified, synced worker profiles and advances.
 */
export async function getFactoryWorkersAction(factoryId: string): Promise<FactoryWorkerBalance[]> {
  try {
    if (!factoryId) return [];
    const admin = createAdminClient();

    const { data, error } = await admin
      .from('worker_balances')
      .select('*')
      .eq('factory_id', factoryId)
      .eq('active', true);

    if (error) {
      console.error('getFactoryWorkersAction error:', error);
      return [];
    }

    // Filter out any soft-deleted / sanitized worker placeholder rows
    return ((data || []) as FactoryWorkerBalance[]).filter(
      w => w.active && w.worker_name !== 'Deleted Worker'
    );
  } catch (err) {
    console.error('getFactoryWorkersAction exception:', err);
    return [];
  }
}

/**
 * Fetch all worker disbursement transactions for workers in a factory.
 * Ensures co-supervisors can view full advance history across the factory.
 */
export async function getFactoryWorkerDisbursementsAction(factoryId: string): Promise<any[]> {
  try {
    if (!factoryId) return [];
    const admin = createAdminClient();

    // 1. Get all active worker IDs in this factory
    const { data: workers } = await admin
      .from('workers')
      .select('id')
      .eq('factory_id', factoryId)
      .eq('active', true);

    if (!workers || workers.length === 0) return [];
    const workerIds = workers.map(w => w.id);

    // 2. Fetch all disbursements to these workers
    const { data: txs, error } = await admin
      .from('cash_transactions')
      .select('id, amount, note, created_at, status, to_worker_id, from_supervisor_id')
      .eq('type', 'supervisor_to_worker')
      .in('to_worker_id', workerIds)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('getFactoryWorkerDisbursementsAction error:', error);
      return [];
    }

    return txs || [];
  } catch (err) {
    console.error('getFactoryWorkerDisbursementsAction exception:', err);
    return [];
  }
}

/**
 * Create a new worker in a factory using admin client.
 */
export async function createWorkerServer(
  factoryId: string,
  supervisorId: string,
  name: string,
  phone: string | null,
  photoUrl: string | null,
  openingAdvance: number
): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const admin = createAdminClient();
    const id = crypto.randomUUID();

    const { error } = await admin
      .from('workers')
      .insert({
        id,
        factory_id: factoryId,
        supervisor_id: supervisorId,
        name: name.trim(),
        phone: phone?.trim() || null,
        photo_url: photoUrl || null,
        opening_advance: openingAdvance || 0,
        active: true,
      });

    if (error) {
      console.error('createWorkerServer DB error:', error);
      return { success: false, error: error.message };
    }

    revalidatePath('/supervisor');
    revalidatePath('/supervisor/workers');
    revalidatePath('/admin');

    return { success: true, id };
  } catch (err: any) {
    console.error('createWorkerServer exception:', err);
    return { success: false, error: err.message || 'Failed to create worker.' };
  }
}

/**
 * Update worker details (name, phone, photo) using admin client.
 * Allows co-supervisors in the same factory to edit profiles seamlessly.
 */
export async function updateWorkerServer(
  workerId: string,
  name: string,
  phone: string | null,
  photoUrl: string | null
): Promise<{ success: boolean; error?: string }> {
  try {
    const admin = createAdminClient();

    const { error } = await admin
      .from('workers')
      .update({
        name: name.trim(),
        phone: phone?.trim() || null,
        photo_url: photoUrl || null,
      })
      .eq('id', workerId);

    if (error) {
      console.error('updateWorkerServer DB error:', error);
      return { success: false, error: error.message };
    }

    revalidatePath('/supervisor');
    revalidatePath('/supervisor/workers');
    revalidatePath('/admin');

    return { success: true };
  } catch (err: any) {
    console.error('updateWorkerServer exception:', err);
    return { success: false, error: err.message || 'Failed to update worker.' };
  }
}

/**
 * Reliably remove/soft-delete a worker using admin privileges.
 */
export async function deleteWorkerServer(
  workerId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const admin = createAdminClient();

    // 1. Try to hard delete
    const { error: deleteError } = await admin
      .from('workers')
      .delete()
      .eq('id', workerId);

    if (deleteError) {
      // If foreign key constraint prevents hard delete, soft delete & sanitize
      const { error: updateError } = await admin
        .from('workers')
        .update({
          active: false,
          name: 'Deleted Worker',
          phone: null,
          photo_url: null,
          opening_advance: 0
        })
        .eq('id', workerId);

      if (updateError) {
        return { success: false, error: updateError.message };
      }
    }

    revalidatePath('/supervisor');
    revalidatePath('/supervisor/workers');
    revalidatePath('/admin');

    return { success: true };
  } catch (err: any) {
    console.error('deleteWorkerServer exception:', err);
    return { success: false, error: err.message || 'Failed to remove worker.' };
  }
}

/**
 * Server action to reliably update a worker's mobile number.
 * Uses admin privileges to ensure supervisors aren't blocked by RLS
 * if another supervisor originally created the worker profile.
 */
export async function updateWorkerPhoneServer(
  workerId: string,
  rawPhone: string
): Promise<{ success: boolean; formattedPhone?: string; error?: string }> {
  try {
    const cleanPhone = rawPhone?.trim().replace(/[^\d+]/g, '');
    if (!cleanPhone || cleanPhone.length < 10) {
      return { success: false, error: 'Please enter a valid 10-digit mobile number.' };
    }

    const formattedPhone = cleanPhone.length === 10 ? `+91${cleanPhone}` : cleanPhone;
    const admin = createAdminClient();

    const { error } = await admin
      .from('workers')
      .update({ phone: formattedPhone })
      .eq('id', workerId);

    if (error) {
      console.error('Error updating worker phone in DB:', error);
      return { success: false, error: error.message };
    }

    revalidatePath('/supervisor');
    revalidatePath('/supervisor/workers');
    revalidatePath('/admin');

    return { success: true, formattedPhone };
  } catch (err: any) {
    console.error('updateWorkerPhoneServer exception:', err);
    return { success: false, error: err.message || 'Failed to update phone number.' };
  }
}
