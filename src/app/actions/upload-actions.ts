'use server';

import { createClient } from '@supabase/supabase-js';

// Environment credentials loaded securely from server environment
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getAdminClient() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error('Supabase configuration or SUPABASE_SERVICE_ROLE_KEY is missing.');
  }
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
}

/**
 * Server action to upload Cash Handover photo proof directly using admin service role.
 * Completely bypasses storage RLS so mobile browser supervisors never encounter 403 Forbidden.
 */
export async function uploadHandoverPhotoAction(formData: FormData): Promise<{
  success: boolean;
  publicUrl?: string;
  error?: string;
}> {
  try {
    const file = formData.get('file') as File;
    if (!file) {
      return { success: false, error: 'No photo provided.' };
    }

    const adminSupabase = getAdminClient();

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const fileName = `handover-${Date.now()}-${Math.random().toString(36).substring(2, 7)}.jpg`;
    const storagePath = `handovers/${fileName}`;

    const { data, error } = await adminSupabase.storage
      .from('receipt-photos')
      .upload(storagePath, buffer, {
        contentType: 'image/jpeg',
        upsert: true,
      });

    if (error) {
      console.error('[Upload Handover] Storage error:', error);
      return { success: false, error: error.message };
    }

    const { data: { publicUrl } } = adminSupabase.storage
      .from('receipt-photos')
      .getPublicUrl(storagePath);

    return {
      success: true,
      publicUrl,
    };
  } catch (err: any) {
    console.error('[Upload Handover] Exception:', err);
    return { success: false, error: err?.message || 'Failed to upload photo proof.' };
  }
}

/**
 * Server action to upload worker profile photos using admin service role.
 */
export async function uploadWorkerPhotoAction(formData: FormData): Promise<{
  success: boolean;
  publicUrl?: string;
  error?: string;
}> {
  try {
    const file = formData.get('file') as File;
    if (!file) {
      return { success: false, error: 'No photo provided.' };
    }

    const adminSupabase = getAdminClient();

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const fileName = `worker-${Date.now()}-${Math.random().toString(36).substring(2, 7)}.jpg`;
    const storagePath = `workers/${fileName}`;

    const { data, error } = await adminSupabase.storage
      .from('worker-photos')
      .upload(storagePath, buffer, {
        contentType: file.type || 'image/jpeg',
        upsert: true,
      });

    if (error) {
      console.error('[Upload Worker] Storage error:', error);
      return { success: false, error: error.message };
    }

    const { data: { publicUrl } } = adminSupabase.storage
      .from('worker-photos')
      .getPublicUrl(storagePath);

    return {
      success: true,
      publicUrl,
    };
  } catch (err: any) {
    console.error('[Upload Worker] Exception:', err);
    return { success: false, error: err?.message || 'Failed to upload worker photo.' };
  }
}

/**
 * Server action to upload expense receipts using admin service role.
 */
export async function uploadExpensePhotoAction(formData: FormData): Promise<{
  success: boolean;
  publicUrl?: string;
  error?: string;
}> {
  try {
    const file = formData.get('file') as File;
    if (!file) {
      return { success: false, error: 'No photo provided.' };
    }

    const adminSupabase = getAdminClient();

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const fileName = `expense-${Date.now()}-${Math.random().toString(36).substring(2, 7)}.jpg`;
    const storagePath = `receipts/${fileName}`;

    const { data, error } = await adminSupabase.storage
      .from('receipt-photos')
      .upload(storagePath, buffer, {
        contentType: file.type || 'image/jpeg',
        upsert: true,
      });

    if (error) {
      console.error('[Upload Expense] Storage error:', error);
      return { success: false, error: error.message };
    }

    const { data: { publicUrl } } = adminSupabase.storage
      .from('receipt-photos')
      .getPublicUrl(storagePath);

    return {
      success: true,
      publicUrl,
    };
  } catch (err: any) {
    console.error('[Upload Expense] Exception:', err);
    return { success: false, error: err?.message || 'Failed to upload expense receipt.' };
  }
}
