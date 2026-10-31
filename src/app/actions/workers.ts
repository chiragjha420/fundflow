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
    const workers = ((data || []) as FactoryWorkerBalance[]).filter(
      w => w.active && w.worker_name !== 'Deleted Worker'
    );

    // Subtract refunded advances so running advances always reflect ledger reality
    const { data: refundLogs } = await admin
      .from('audit_log')
      .select('row_id')
      .eq('table_name', 'cash_transactions')
      .eq('action', 'refund');

    const refundedTxIds = new Set<string>((refundLogs || []).map(r => r.row_id));

    const { data: refundNotes } = await admin
      .from('cash_transactions')
      .select('note')
      .eq('type', 'office_to_supervisor')
      .ilike('note', '%[REFUND:%');

    (refundNotes || []).forEach(tx => {
      const match = tx.note?.match(/\[REFUND:([a-f0-9-]+)\]/);
      if (match && match[1]) {
        refundedTxIds.add(match[1]);
      }
    });

    if (refundedTxIds.size > 0) {
      const { data: refundedAdvances } = await admin
        .from('cash_transactions')
        .select('id, to_worker_id, amount')
        .in('id', Array.from(refundedTxIds));

      if (refundedAdvances && refundedAdvances.length > 0) {
        const workerRefundTotal: Record<string, number> = {};
        refundedAdvances.forEach(tx => {
          if (tx.to_worker_id) {
            workerRefundTotal[tx.to_worker_id] = (workerRefundTotal[tx.to_worker_id] || 0) + Number(tx.amount || 0);
          }
        });

        return workers.map(w => {
          const refunded = workerRefundTotal[w.worker_id] || 0;
          return {
            ...w,
            total_cash_disbursed: Math.max(0, Number(w.total_cash_disbursed || 0) - refunded),
            running_advance: Math.max(0, Number(w.running_advance || 0) - refunded),
          };
        });
      }
    }

    return workers;
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
      .select('id, amount, note, created_at, status, to_worker_id, from_supervisor_id, to_work:to_worker_id(name, active)')
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
 * Fetch all disbursements for a single worker using admin client.
 * Allows co-supervisors to view each other's historical payments to the same worker.
 */
export async function getWorkerDisbursementsAction(workerId: string): Promise<any[]> {
  try {
    if (!workerId) return [];
    const admin = createAdminClient();

    const { data: txs, error } = await admin
      .from('cash_transactions')
      .select('id, amount, note, created_at, status, to_worker_id, from_supervisor_id')
      .eq('type', 'supervisor_to_worker')
      .eq('to_worker_id', workerId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('getWorkerDisbursementsAction error:', error);
      return [];
    }

    return txs || [];
  } catch (err) {
    console.error('getWorkerDisbursementsAction exception:', err);
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

export interface BulkWorkerOpeningAdvanceUpdate {
  workerId: string;
  openingAdvance: number;
}

/**
 * Bulk update opening advances for workers in a factory.
 * Executes in concurrent batches using admin client to update workers table.
 * Revalidates /admin and /supervisor pages.
 */
export async function bulkUpdateOpeningAdvancesAction(
  updates: BulkWorkerOpeningAdvanceUpdate[]
): Promise<{ success: boolean; updatedCount: number; error?: string }> {
  try {
    if (!updates || updates.length === 0) {
      return { success: true, updatedCount: 0 };
    }

    const admin = createAdminClient();

    // Process in chunks of 25 to respect DB pool limits
    const CHUNK_SIZE = 25;
    for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
      const chunk = updates.slice(i, i + CHUNK_SIZE);
      const results = await Promise.all(
        chunk.map(item =>
          admin
            .from('workers')
            .update({ opening_advance: Math.max(0, Math.round(Number(item.openingAdvance) || 0)) })
            .eq('id', item.workerId)
        )
      );

      const failed = results.find(r => r.error);
      if (failed && failed.error) {
        console.error('Failed chunk update in bulkUpdateOpeningAdvancesAction:', failed.error);
        return { success: false, updatedCount: i, error: failed.error.message };
      }
    }

    revalidatePath('/admin');
    revalidatePath('/admin/opening-advances');
    revalidatePath('/supervisor');
    revalidatePath('/supervisor/workers');

    return { success: true, updatedCount: updates.length };
  } catch (err: any) {
    console.error('bulkUpdateOpeningAdvancesAction exception:', err);
    return { success: false, updatedCount: 0, error: err.message || 'Failed to update opening advances.' };
  }
}


/**
 * Fetch all transactions associated with a supervisor's account and factory:
 * 1. Worker advances (supervisor_to_worker)
 * 2. Transfers sent & received (supervisor_to_supervisor)
 * 3. Office cash receipts & refunds (office_to_supervisor)
 * 4. Refunded transaction IDs from audit_log
 */
export async function getSupervisorAllTransactionsAction(
  supervisorId: string, 
  factoryId: string
): Promise<{
  transactions: any[];
  refundedTxIds: string[];
}> {
  try {
    if (!supervisorId && !factoryId) return { transactions: [], refundedTxIds: [] };
    const admin = createAdminClient();

    // 1. Get supervisor IDs for this factory
    let supIds = [supervisorId];
    if (factoryId) {
      const { data: sups } = await admin
        .from('supervisors')
        .select('id')
        .eq('factory_id', factoryId);
      if (sups && sups.length > 0) {
        supIds = Array.from(new Set([supervisorId, ...sups.map(s => s.id)].filter(Boolean)));
      }
    }

    // 2. Fetch all transactions involving these supervisors
    const { data: txs, error } = await admin
      .from('cash_transactions')
      .select(`
        id,
        type,
        amount,
        note,
        status,
        created_at,
        from_supervisor_id,
        to_supervisor_id,
        to_worker_id,
        from:from_supervisor_id(id, name),
        to_sup:to_supervisor_id(id, name),
        to_work:to_worker_id(id, name, active)
      `)
      .or(`from_supervisor_id.in.(${supIds.join(',')}),to_supervisor_id.in.(${supIds.join(',')})`)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('getSupervisorAllTransactionsAction error:', error);
      return { transactions: [], refundedTxIds: [] };
    }

    // 3. Fetch refunded transaction IDs
    const { data: refundLogs } = await admin
      .from('audit_log')
      .select('row_id')
      .eq('table_name', 'cash_transactions')
      .eq('action', 'refund');

    const refundedTxIds = new Set<string>((refundLogs || []).map(r => r.row_id));

    // Also check notes for [REFUND:<id>]
    (txs || []).forEach(tx => {
      if (tx.type === 'office_to_supervisor' && tx.note) {
        const match = tx.note.match(/\[REFUND:([a-f0-9-]+)\]/);
        if (match && match[1]) {
          refundedTxIds.add(match[1]);
        }
      }
    });

    return {
      transactions: txs || [],
      refundedTxIds: Array.from(refundedTxIds),
    };
  } catch (err) {
    console.error('getSupervisorAllTransactionsAction exception:', err);
    return { transactions: [], refundedTxIds: [] };
  }
}
