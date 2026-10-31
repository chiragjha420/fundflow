'use server';

import { createAdminClient } from '@/lib/supabase/admin-client';
import { createServerClient } from '@/lib/supabase/server-client';
import { revalidatePath } from 'next/cache';
import { broadcastNotificationAction } from '@/lib/realtime-broadcaster';
import { sendPushToRole } from '@/lib/web-push-sender';

export async function createFactory(state: any, formData: FormData) {
  const name = formData.get('name') as string;
  const location = formData.get('location') as string;

  if (!name || !location) {
    return { error: 'Please fill in all factory fields.' };
  }

  const supabase = createServerClient();
  const { error } = await supabase.from('factories').insert({
    name,
    location,
    active: true,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath('/admin/supervisors');
  revalidatePath('/admin');
  return { success: true };
}

export async function provisionSupervisor(state: any, formData: FormData) {
  const name = formData.get('name') as string;
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const phone = formData.get('phone') as string;
  const factoryId = formData.get('factoryId') as string;

  if (!name || !email || !password || !phone || !factoryId) {
    return { error: 'All fields are required.' };
  }

  const adminClient = createAdminClient();

  // 1. Create auth user with metadata
  const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { role: 'supervisor' },
  });

  if (authError) {
    return { error: authError.message };
  }

  const userId = authData.user?.id;
  if (!userId) {
    return { error: 'Failed to create auth user.' };
  }

  // 2. Insert into profiles & supervisors
  const userClient = createServerClient();

  const { error: profileError } = await userClient.from('profiles').insert({
    id: userId,
    role: 'supervisor',
  });

  if (profileError) {
    // Clean up auth user to prevent orphans
    await adminClient.auth.admin.deleteUser(userId);
    return { error: profileError.message };
  }

  const { error: supervisorError } = await userClient.from('supervisors').insert({
    user_id: userId,
    factory_id: factoryId,
    name,
    phone,
    active: true,
  });

  if (supervisorError) {
    // Clean up
    await userClient.from('profiles').delete().eq('id', userId);
    await adminClient.auth.admin.deleteUser(userId);
    return { error: supervisorError.message };
  }

  revalidatePath('/admin/supervisors');
  revalidatePath('/admin');
  return { success: true };
}

export async function toggleSupervisorActive(supervisorId: string, currentStatus: boolean) {
  const supabase = createServerClient();
  const { error } = await supabase
    .from('supervisors')
    .update({ active: !currentStatus })
    .eq('id', supervisorId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath('/admin/supervisors');
  return { success: true };
}

export async function createOfficeDisbursement(state: any, formData: FormData) {
  const supervisorId = formData.get('supervisorId') as string;
  const amountStr = formData.get('amount') as string;
  const note = (formData.get('note') as string)?.trim();

  if (!supervisorId || !amountStr || !note) {
    return { error: 'Please select a supervisor, specify amount, and provide notes/remarks.' };
  }

  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) {
    return { error: 'Amount must be a positive number.' };
  }

  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { error: 'Not authenticated.' };
  }

  const { error } = await supabase.from('cash_transactions').insert({
    type: 'office_to_supervisor',
    to_supervisor_id: supervisorId,
    amount,
    status: 'pending',
    note: note,
    created_by: user.id,
  });

  if (error) {
    return { error: error.message };
  }

  // 1. Send real OS Web Push to supervisor's phone (wakes phone up even when app is closed)
  sendPushToRole('supervisor', {
    title: '💵 Office Cash Received!',
    body: `Main Office sent ₹${amount.toLocaleString('en-IN')}: "${note}". Tap to confirm receipt on your dashboard.`,
    url: '/supervisor',
  }, supervisorId).catch((err) => console.warn('[WebPush] Error sending push to supervisor:', err));

  // 2. Broadcast real-time notification to supervisor's phone
  broadcastNotificationAction({
    type: 'office_disbursement',
    to_supervisor_id: supervisorId,
    amount,
    note: note,
  }).catch((err) => console.warn('Broadcast notification failed:', err));

  revalidatePath('/admin');
  return { success: true };
}

export async function deleteSupervisor(supervisorId: string) {
  const supabase = createServerClient();
  
  // 1. Get supervisor details to retrieve their user_id
  const { data: supervisor, error: fetchError } = await supabase
    .from('supervisors')
    .select('user_id, name')
    .eq('id', supervisorId)
    .single();

  if (fetchError || !supervisor) {
    return { error: 'Supervisor not found.' };
  }

  // 2. Check if they have any ledger transactions or expenses
  const { count: txCount, error: txError } = await supabase
    .from('cash_transactions')
    .select('*', { count: 'exact', head: true })
    .or(`from_supervisor_id.eq.${supervisorId},to_supervisor_id.eq.${supervisorId}`);

  const { count: expCount, error: expError } = await supabase
    .from('expenses')
    .select('*', { count: 'exact', head: true })
    .eq('supervisor_id', supervisorId);

  if (txError || expError) {
    return { error: 'Error checking supervisor history.' };
  }

  // If there are transactions or expenses, they CANNOT be deleted.
  // We deactivate them instead and notify the admin.
  if ((txCount && txCount > 0) || (expCount && expCount > 0)) {
    const { error: updateError } = await supabase
      .from('supervisors')
      .update({ active: false })
      .eq('id', supervisorId);

    if (updateError) {
      return { error: updateError.message };
    }

    revalidatePath('/admin/supervisors');
    revalidatePath('/admin');
    return { 
      success: false, 
      warning: `This supervisor has transaction history. To protect the ledger's audit trail, they cannot be deleted, but they have been deactivated instead.`
    };
  }

  // 3. If NO transaction history, we can perform a hard delete
  // Delete supervisor record
  const { error: deleteSupError } = await supabase
    .from('supervisors')
    .delete()
    .eq('id', supervisorId);

  if (deleteSupError) {
    return { error: deleteSupError.message };
  }

  // Delete profile record
  await supabase.from('profiles').delete().eq('id', supervisor.user_id);

  // Delete Auth user using admin client
  const adminClient = createAdminClient();
  await adminClient.auth.admin.deleteUser(supervisor.user_id);

  revalidatePath('/admin/supervisors');
  revalidatePath('/admin');
  return { success: true };
}


/**
 * Refund an erroneous cash advance given to a worker by a supervisor.
 * 1. Verifies the advance transaction exists.
 * 2. Writes an immutable refund record in audit_log.
 * 3. Credits the supervisor's available balance back with an office_to_supervisor ledger entry.
 * 4. Sends a real Web Push and broadcast notification to the supervisor's phone.
 * 5. Revalidates admin and supervisor paths so worker advance and balances update instantly.
 */
export async function refundWorkerAdvanceAction(transactionId: string, reason?: string): Promise<{ success: boolean; error?: string; message?: string }> {
  try {
    const adminClient = createAdminClient();

    // 1. Fetch transaction details
    const { data: tx, error: txError } = await adminClient
      .from('cash_transactions')
      .select('id, amount, note, from_supervisor_id, to_worker_id, status, created_at, to_work:to_worker_id(name), from:from_supervisor_id(name)')
      .eq('id', transactionId)
      .single();

    if (txError || !tx) {
      return { success: false, error: 'Transaction not found.' };
    }

    if (tx.status !== 'confirmed') {
      return { success: false, error: `Only confirmed transactions can be refunded. Current status: ${tx.status}` };
    }

    // 2. Check if already refunded and credited in cash_transactions
    const { data: existingCredit } = await adminClient
      .from('cash_transactions')
      .select('id')
      .eq('type', 'office_to_supervisor')
      .ilike('note', `%[REFUND:${transactionId}]%`)
      .limit(1);

    if (existingCredit && existingCredit.length > 0) {
      return { success: false, error: 'This transaction has already been refunded and credited back.' };
    }

    const workerName = (tx.to_work as any)?.name || 'Worker';
    const supervisorId = tx.from_supervisor_id;
    const supervisorName = (tx.from as any)?.name || 'Supervisor';
    const amount = Number(tx.amount);
    const refundReason = reason?.trim() || 'Advance added by mistake to wrong worker';

    // Safely resolve an auth.users ID for foreign key constraints (confirmed_by / created_by)
    const supabaseUser = createServerClient();
    const { data: { user } } = await supabaseUser.auth.getUser();
    let authUserId = user?.id;

    if (!authUserId) {
      // Fallback 1: Query admin user from profiles table
      const { data: adminProfile } = await adminClient
        .from('profiles')
        .select('id')
        .eq('role', 'admin')
        .limit(1)
        .single();
      authUserId = adminProfile?.id;
    }

    if (!authUserId && supervisorId) {
      // Fallback 2: Query supervisor's auth user_id (NOT supervisor table id)
      const { data: sup } = await adminClient
        .from('supervisors')
        .select('user_id')
        .eq('id', supervisorId)
        .single();
      authUserId = sup?.user_id;
    }

    if (!authUserId) {
      return { success: false, error: 'Could not resolve a valid authentication profile to authorize refund credit.' };
    }

    // 3. Insert refund credit transaction FIRST to supervisor's account (office_to_supervisor)
    // This immediately restores `amount` back to the supervisor's balance in get_supervisor_balance!
    const refundNote = `[REFUND:${transactionId}] Refund for wrong advance to ${workerName}: ₹${amount.toLocaleString('en-IN')} credited back to your balance. ${refundReason}`;

    const { error: creditError } = await adminClient
      .from('cash_transactions')
      .insert({
        type: 'office_to_supervisor',
        to_supervisor_id: supervisorId,
        amount,
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        confirmed_by: authUserId,
        note: refundNote,
        created_by: authUserId,
      });

    if (creditError) {
      console.error('Failed to credit supervisor balance:', creditError);
      return { success: false, error: 'Failed to credit supervisor balance: ' + creditError.message };
    }

    // 4. Insert audit log record for immutable refund tracking (only after credit succeeds)
    const { error: auditError } = await adminClient
      .from('audit_log')
      .insert({
        table_name: 'cash_transactions',
        action: 'refund',
        row_id: transactionId,
        old_data: {
          id: tx.id,
          amount,
          worker_id: tx.to_worker_id,
          worker_name: workerName,
          supervisor_id: supervisorId,
          supervisor_name: supervisorName,
          status: tx.status,
          note: tx.note,
        },
        new_data: {
          status: 'refunded',
          refund_reason: refundReason,
          refunded_at: new Date().toISOString(),
          refunded_by: authUserId,
        },
        changed_by: authUserId,
      });

    if (auditError) {
      console.warn('Audit log insert warning (credit was still applied):', auditError);
    }

    // 5. Send Real OS Web Push to supervisor's phone (works even when app/browser is closed)
    if (supervisorId) {
      sendPushToRole('supervisor', {
        title: '↩ Cash Advance Refunded',
        body: `₹${amount.toLocaleString('en-IN')} advance to ${workerName} has been refunded back to your balance by Admin.`,
        url: '/supervisor',
      }, supervisorId).catch(err => console.warn('[WebPush] Error sending refund push to supervisor:', err));

      // 6. Broadcast real-time notification
      broadcastNotificationAction({
        type: 'advance_refunded',
        to_supervisor_id: supervisorId,
        amount,
        note: `₹${amount.toLocaleString('en-IN')} advance to ${workerName} was refunded back to your balance by Admin.`,
      }).catch(err => console.warn('Broadcast refund notification failed:', err));
    }

    // 7. Revalidate Next.js cache across admin and supervisor pages
    revalidatePath('/admin');
    revalidatePath('/supervisor');
    revalidatePath('/supervisor/workers');

    return { 
      success: true, 
      message: `₹${amount.toLocaleString('en-IN')} successfully refunded to ${supervisorName}'s balance!` 
    };
  } catch (err: any) {
    console.error('refundWorkerAdvanceAction error:', err);
    return { success: false, error: err.message || 'Failed to refund advance.' };
  }
}

/**
 * Fetch all refunded transactions mapping: txId -> { refundedAt, reason, amount, workerName }
 */
export async function getRefundedTransactionsAction(): Promise<Record<string, { refundedAt: string; reason: string; amount: number; workerName: string }>> {
  try {
    const adminClient = createAdminClient();

    // 1. Fetch from audit_log
    const { data: logs } = await adminClient
      .from('audit_log')
      .select('row_id, changed_at, old_data, new_data')
      .eq('table_name', 'cash_transactions')
      .eq('action', 'refund');

    // 2. Fetch from office_to_supervisor notes matching [REFUND:
    const { data: refundTxs } = await adminClient
      .from('cash_transactions')
      .select('id, amount, note, created_at')
      .eq('type', 'office_to_supervisor')
      .like('note', '%[REFUND:%');

    const result: Record<string, { refundedAt: string; reason: string; amount: number; workerName: string }> = {};

    (logs || []).forEach(log => {
      if (log.row_id) {
        result[log.row_id] = {
          refundedAt: (log.new_data as any)?.refunded_at || log.changed_at,
          reason: (log.new_data as any)?.refund_reason || 'Refunded by Admin',
          amount: Number((log.old_data as any)?.amount || 0),
          workerName: (log.old_data as any)?.worker_name || 'Worker',
        };
      }
    });

    (refundTxs || []).forEach(tx => {
      const match = tx.note?.match(/\[REFUND:([a-f0-9-]+)\]/);
      if (match && match[1] && !result[match[1]]) {
        result[match[1]] = {
          refundedAt: tx.created_at,
          reason: tx.note || 'Refunded by Admin',
          amount: Number(tx.amount || 0),
          workerName: 'Worker',
        };
      }
    });

    return result;
  } catch (e) {
    console.error('getRefundedTransactionsAction error:', e);
    return {};
  }
}
