'use server';

import { createAdminClient } from '@/lib/supabase/admin-client';
import { createServerClient } from '@/lib/supabase/server-client';
import { revalidatePath } from 'next/cache';

export interface CashRequest {
  id: string;
  supervisor_id: string;
  supervisor_name: string;
  factory_id: string;
  factory_name: string;
  amount: number;
  note: string;
  status: 'pending' | 'approved' | 'dismissed';
  created_at: string;
  reviewed_at?: string;
}

// 1. Supervisor submits a Cash Replenishment Request
export async function createCashRequest(
  supervisorId: string,
  factoryId: string,
  amount: number,
  note: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const cleanNote = note?.trim();
    if (!cleanNote) {
      return { success: false, error: 'Reason/Notes are required for cash requests.' };
    }
    if (isNaN(amount) || amount <= 0) {
      return { success: false, error: 'Please enter a valid amount.' };
    }

    const adminClient = createAdminClient();

    // Get supervisor & factory name for clean admin display
    const { data: sup } = await adminClient
      .from('supervisors')
      .select('name, factories(name)')
      .eq('id', supervisorId)
      .single();

    const supervisorName = sup?.name || 'Supervisor';
    const factoryName = (sup?.factories as any)?.name || 'Factory';
    const requestId = crypto.randomUUID();

    const requestPayload: CashRequest = {
      id: requestId,
      supervisor_id: supervisorId,
      supervisor_name: supervisorName,
      factory_id: factoryId,
      factory_name: factoryName,
      amount,
      note: cleanNote,
      status: 'pending',
      created_at: new Date().toISOString(),
    };

    const { error } = await adminClient.from('audit_log').insert({
      table_name: 'cash_requests',
      action: 'PENDING',
      row_id: requestId,
      new_data: requestPayload,
      changed_at: new Date().toISOString(),
    });

    if (error) {
      console.error('Error creating cash request:', error);
      return { success: false, error: error.message };
    }

    revalidatePath('/admin');
    revalidatePath('/supervisor');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to submit cash request.' };
  }
}

// 2. Fetch Cash Requests (for Admin & Supervisor)
export async function getCashRequests(supervisorId?: string): Promise<CashRequest[]> {
  try {
    const adminClient = createAdminClient();
    const { data, error } = await adminClient
      .from('audit_log')
      .select('*')
      .eq('table_name', 'cash_requests')
      .order('changed_at', { ascending: false })
      .limit(20);

    if (error || !data) return [];

    const requests: CashRequest[] = data
      .map(row => row.new_data as CashRequest)
      .filter(Boolean);

    if (supervisorId) {
      return requests.filter(r => r.supervisor_id === supervisorId);
    }

    return requests;
  } catch {
    return [];
  }
}

// 3. Admin Updates Status (Approve or Dismiss)
export async function updateCashRequestStatus(
  requestId: string,
  newStatus: 'approved' | 'dismissed'
): Promise<{ success: boolean; error?: string }> {
  try {
    const adminClient = createAdminClient();
    const { data: existingRows } = await adminClient
      .from('audit_log')
      .select('*')
      .eq('table_name', 'cash_requests')
      .eq('row_id', requestId)
      .order('changed_at', { ascending: false })
      .limit(1);

    if (!existingRows || existingRows.length === 0) {
      return { success: false, error: 'Request not found.' };
    }

    const currentData = existingRows[0].new_data as CashRequest;
    const updatedPayload: CashRequest = {
      ...currentData,
      status: newStatus,
      reviewed_at: new Date().toISOString(),
    };

    const { error } = await adminClient
      .from('audit_log')
      .update({
        action: newStatus.toUpperCase(),
        new_data: updatedPayload,
        changed_at: new Date().toISOString(),
      })
      .eq('id', existingRows[0].id);

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath('/admin');
    revalidatePath('/supervisor');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to update request.' };
  }
}
