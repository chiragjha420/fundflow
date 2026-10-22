'use server';

import { createAdminClient } from '@/lib/supabase/admin-client';
import { revalidatePath } from 'next/cache';

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
