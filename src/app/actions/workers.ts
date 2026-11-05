'use server';

import { createAdminClient } from '@/lib/supabase/admin-client';
import { createServerClient } from '@/lib/supabase/server-client';
import { revalidatePath } from 'next/cache';
import { parseHandoverNote } from '@/lib/utils';

export interface FactoryWorkerBalance {
  worker_id: string;
  worker_name: string;
  worker_phone: string | null;
  worker_photo_url: string | null;
  factory_id: string;
  supervisor_id: string;
  opening_advance: number;
  opening_unpaid_salary: number;
  monthly_salary: number;
  total_cash_disbursed: number;
  // Advance tracking
  total_advance_given: number;
  total_advance_recovered: number;
  running_advance: number; // outstanding advance
  // Salary tracking
  total_salary_earned: number;
  total_salary_paid: number;
  unpaid_salary: number; // accumulated unpaid salary
  // Net Position (unpaid_salary - running_advance)
  net_payable: number;
  // Bonus tracking (separate from advance and salary)
  total_bonus_paid?: number;
  cash_bonus_paid?: number;
  online_bonus_paid?: number;
  active: boolean;
}

export interface WorkerSalaryLedgerEntry {
  id: string;
  worker_id: string;
  factory_id: string;
  type: 'salary_earned' | 'advance_recovery';
  amount: number;
  period_month?: string | null;
  note?: string | null;
  created_at: string;
  created_by?: string | null;
}

export interface FullWorkerLedgerEntry {
  id: string;
  date: string;
  type: 'opening_advance' | 'opening_salary' | 'advance_given' | 'salary_payment' | 'salary_earned' | 'advance_recovery' | 'refund';
  title: string;
  label: string;
  amount: number;
  note?: string | null;
  isCash: boolean;
  supervisorName?: string;
  photoUrl?: string | null;
  runningUnpaidSalary?: number;
  runningAdvance?: number;
  runningNetPayable?: number;
  effectOnAdvance?: number;
  effectOnSalary?: number;
  refunded?: boolean;
}

/**
 * Fetch non-cash salary ledger entries (Salary Earned & Advance Recoveries).
 * Reads from worker_salary_ledger table, and seamlessly merges with audit_log fallback.
 */
export async function getSalaryLedgerEntries(factoryId?: string, workerId?: string): Promise<WorkerSalaryLedgerEntry[]> {
  const admin = createAdminClient();
  const entries: WorkerSalaryLedgerEntry[] = [];
  const seenIds = new Set<string>();

  // 1. Try querying worker_salary_ledger table
  try {
    let query = admin.from('worker_salary_ledger').select('*').order('created_at', { ascending: false });
    if (factoryId && factoryId !== 'all') query = query.eq('factory_id', factoryId);
    if (workerId) query = query.eq('worker_id', workerId);
    const { data, error } = await query;
    if (!error && data) {
      data.forEach(item => {
        seenIds.add(item.id);
        entries.push({
          id: item.id,
          worker_id: item.worker_id,
          factory_id: item.factory_id,
          type: item.type,
          amount: Number(item.amount || 0),
          period_month: item.period_month,
          note: item.note,
          created_at: item.created_at,
          created_by: item.created_by,
        });
      });
    }
  } catch (err) {
    // Table not created yet; rely on audit_log
  }

  // 2. Query audit_log fallback store
  try {
    const { data: auditRows } = await admin
      .from('audit_log')
      .select('row_id, new_data, changed_at, changed_by')
      .eq('table_name', 'worker_salary_ledger');

    (auditRows || []).forEach(row => {
      const payload = row.new_data as any;
      if (payload && payload.worker_id) {
        const rowId = payload.id || row.row_id;
        if (seenIds.has(rowId)) return;
        if (factoryId && factoryId !== 'all' && payload.factory_id !== factoryId) return;
        if (workerId && payload.worker_id !== workerId) return;

        seenIds.add(rowId);
        entries.push({
          id: rowId,
          worker_id: payload.worker_id,
          factory_id: payload.factory_id,
          type: payload.type,
          amount: Number(payload.amount || 0),
          period_month: payload.period_month,
          note: payload.note,
          created_at: payload.created_at || row.changed_at,
          created_by: payload.created_by || row.changed_by,
        });
      }
    });
  } catch (err) {
    console.warn('Error fetching salary entries from audit_log:', err);
  }

  return entries.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

/**
 * Record a non-cash salary ledger entry (Salary Earned or Advance Recovery).
 * Inserts into worker_salary_ledger with automatic fallback to audit_log.
 */
export async function insertSalaryLedgerEntry(entry: {
  worker_id: string;
  factory_id: string;
  type: 'salary_earned' | 'advance_recovery';
  amount: number;
  period_month?: string | null;
  note?: string | null;
  created_by?: string | null;
}): Promise<{ success: boolean; id: string }> {
  const admin = createAdminClient();
  const id = crypto.randomUUID();
  const cleanAmount = Math.max(1, Math.round(Number(entry.amount) || 0));
  const fullEntry = {
    id,
    worker_id: entry.worker_id,
    factory_id: entry.factory_id,
    type: entry.type,
    amount: cleanAmount,
    period_month: entry.period_month || null,
    note: entry.note?.trim() || null,
    created_by: entry.created_by || null,
    created_at: new Date().toISOString(),
  };

  let inserted = false;
  try {
    const { error } = await admin.from('worker_salary_ledger').insert(fullEntry);
    if (!error) {
      inserted = true;
    }
  } catch (e) {
    // Silent fallback
  }

  if (!inserted) {
    await admin.from('audit_log').insert({
      table_name: 'worker_salary_ledger',
      action: 'INSERT',
      row_id: id,
      new_data: fullEntry,
      changed_by: entry.created_by || null,
      changed_at: new Date().toISOString(),
    });
  }

  return { success: true, id };
}

/**
 * Fetch map of transaction reclassifications (txId -> 'advance' | 'salary_payment')
 */
export async function getReclassifiedTransactions(): Promise<Record<string, 'advance' | 'salary_payment'>> {
  const admin = createAdminClient();
  const reclassMap: Record<string, 'advance' | 'salary_payment'> = {};

  try {
    const { data } = await admin
      .from('audit_log')
      .select('row_id, new_data, changed_at')
      .eq('table_name', 'cash_transactions')
      .eq('action', 'reclassify')
      .order('changed_at', { ascending: true });

    (data || []).forEach(item => {
      const payload = item.new_data as any;
      if (item.row_id && payload?.payment_type) {
        reclassMap[item.row_id] = payload.payment_type;
      }
    });
  } catch (e) {
    console.warn('getReclassifiedTransactions warning:', e);
  }

  return reclassMap;
}

/**
 * Reclassify a single transaction as either 'advance' or 'salary_payment'.
 * Accessible by Admin to fix misclassified transactions.
 */
export async function reclassifyWorkerTransactionAction(
  transactionId: string,
  newType: 'advance' | 'salary_payment'
): Promise<{ success: boolean; error?: string }> {
  try {
    const admin = createAdminClient();

    // 1. Try updating payment_type column
    try {
      await admin
        .from('cash_transactions')
        .update({ payment_type: newType })
        .eq('id', transactionId);
    } catch (e) {
      // Column might not exist yet before migration
    }

    // 2. Insert into audit_log for permanent tracking
    const { error } = await admin.from('audit_log').insert({
      table_name: 'cash_transactions',
      action: 'reclassify',
      row_id: transactionId,
      new_data: { payment_type: newType, reclassified_at: new Date().toISOString() },
      changed_at: new Date().toISOString(),
    });

    if (error) {
      console.error('Error logging reclassification to audit_log:', error);
    }

    revalidatePath('/admin');
    revalidatePath('/supervisor');
    revalidatePath('/supervisor/workers');

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to reclassify transaction.' };
  }
}

/**
 * Credit earned salary to a worker.
 * Increases the worker's accumulated unpaid salary. Does NOT move cash.
 */
export async function creditWorkerSalaryAction(
  workerId: string,
  factoryIdOrAmount: string | number,
  amountOrPeriod?: number | string,
  periodMonth?: string,
  note?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    let factoryId: string = '';
    let amount: number = 0;
    let period: string | null = null;
    let remarks: string | null = null;

    if (typeof factoryIdOrAmount === 'number') {
      amount = factoryIdOrAmount;
      period = (typeof amountOrPeriod === 'string' ? amountOrPeriod : null) || periodMonth || null;
      remarks = note || null;
    } else {
      factoryId = factoryIdOrAmount;
      amount = Number(amountOrPeriod) || 0;
      period = periodMonth?.trim() || null;
      remarks = note?.trim() || null;
    }

    if (!workerId || !amount || amount <= 0) {
      return { success: false, error: 'Please enter a valid worker and positive salary amount.' };
    }

    if (!factoryId) {
      const admin = createAdminClient();
      const { data: w } = await admin.from('workers').select('factory_id').eq('id', workerId).single();
      factoryId = w?.factory_id || '';
    }

    const cleanAmount = Math.round(Number(amount));
    await insertSalaryLedgerEntry({
      worker_id: workerId,
      factory_id: factoryId,
      type: 'salary_earned',
      amount: cleanAmount,
      period_month: period,
      note: remarks || `Salary Credited for ${period || 'Period'}`,
    });

    revalidatePath('/admin');
    revalidatePath('/supervisor');
    revalidatePath('/supervisor/workers');

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to credit salary.' };
  }
}

/**
 * Add / Credit salary for a worker with optional advance deduction.
 * - Records salary earned (increases unpaid salary).
 * - If advanceDeductAmount > 0, deducts that amount from outstanding advance (advance recovery).
 * - Net salary remaining increases the worker's accumulated unpaid salary.
 * - Zero physical cash movement.
 */
export async function addWorkerSalaryWithDeductionAction(params: {
  workerId: string;
  factoryId?: string;
  salaryAmount: number;
  advanceDeductAmount?: number;
  periodMonth?: string;
  note?: string;
  supervisorId?: string;
}): Promise<{
  success: boolean;
  salaryEarnedId?: string;
  advanceRecoveryId?: string;
  netSalaryAdded?: number;
  advanceRemaining?: number;
  error?: string;
}> {
  try {
    const { workerId, salaryAmount } = params;
    let factoryId = params.factoryId || '';
    const cleanSalary = Math.round(Number(salaryAmount) || 0);
    const cleanDeduct = Math.max(0, Math.round(Number(params.advanceDeductAmount) || 0));

    if (!workerId) {
      return { success: false, error: 'Please select a valid worker.' };
    }
    if (cleanSalary <= 0) {
      return { success: false, error: 'Please enter a valid salary amount greater than zero.' };
    }

    const admin = createAdminClient();
    if (!factoryId) {
      const { data: w } = await admin.from('workers').select('factory_id').eq('id', workerId).single();
      factoryId = w?.factory_id || '';
    }

    // Fetch current balances to validate advance deduction
    const workers = await getAllWorkersWithSalaryBalancesAction(factoryId || undefined);
    const currentWorker = workers.find(w => w.worker_id === workerId);
    if (!currentWorker) {
      return { success: false, error: 'Worker not found.' };
    }

    if (cleanDeduct > 0) {
      if (cleanDeduct > currentWorker.running_advance) {
        return {
          success: false,
          error: `Deduction amount (₹${cleanDeduct.toLocaleString('en-IN')}) cannot exceed worker's current advance of ₹${currentWorker.running_advance.toLocaleString('en-IN')}.`,
        };
      }
      if (cleanDeduct > cleanSalary) {
        return {
          success: false,
          error: `Deduction amount (₹${cleanDeduct.toLocaleString('en-IN')}) cannot exceed the salary amount of ₹${cleanSalary.toLocaleString('en-IN')}.`,
        };
      }
    }

    const period = params.periodMonth?.trim() || null;
    const salaryNote = params.note?.trim() || `Salary Credited for ${period || 'Period'}`;

    // 1. Record Salary Earned
    const earnRes = await insertSalaryLedgerEntry({
      worker_id: workerId,
      factory_id: factoryId,
      type: 'salary_earned',
      amount: cleanSalary,
      period_month: period,
      note: salaryNote,
      created_by: params.supervisorId || null,
    });

    let recRes: { success: boolean; id: string } | undefined;
    // 2. Record Advance Recovery (if deduction > 0)
    if (cleanDeduct > 0) {
      recRes = await insertSalaryLedgerEntry({
        worker_id: workerId,
        factory_id: factoryId,
        type: 'advance_recovery',
        amount: cleanDeduct,
        period_month: period,
        note: `Advance deducted from ${period || 'earned'} salary`,
        created_by: params.supervisorId || null,
      });
    }

    revalidatePath('/admin');
    revalidatePath('/supervisor');
    revalidatePath('/supervisor/workers');

    return {
      success: true,
      salaryEarnedId: earnRes.id,
      advanceRecoveryId: recRes?.id,
      netSalaryAdded: cleanSalary - cleanDeduct,
      advanceRemaining: Math.max(0, currentWorker.running_advance - cleanDeduct),
    };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to process salary.' };
  }
}

export interface HisaabResult {
  success: boolean;
  hisaabId?: string;
  previousAdvance?: number;
  advanceDeducted?: number;
  newAdvanceRemaining?: number;
  extraAdvanceAdded?: number;
  netWages?: number;
  cashPaid?: number;
  onlinePaid?: number;
  unpaidRemaining?: number;
  error?: string;
}

/**
 * Record a worker Hisaab (settlement).
 * - Takes From & To date and Total Wages earned by the worker during that period.
 * - Deducts a chosen amount from the worker's outstanding advance.
 * - The advance balance is decreased by whatever deduction is made.
 * - Supports splitting the net wages into physical Cash handover and Online QR payment.
 * - Physical Cash is deducted from supervisor's balance.
 * - Online QR payment is NOT deducted from supervisor's balance, but is tracked in factory spends and analytics for Admin.
 */
export async function recordWorkerHisaabAction(params: {
  workerId: string;
  factoryId?: string;
  supervisorId?: string;
  fromDate: string;
  toDate: string;
  totalWages: number;
  advanceDeducted: number;
  cashPaid?: number;
  onlinePaid?: number;
  payNetCashNow?: boolean;
  note?: string;
  photoUrl?: string | null;
}): Promise<HisaabResult> {
  try {
    const { workerId } = params;
    let factoryId = params.factoryId || '';
    const cleanWages = Math.max(0, Math.round(Number(params.totalWages) || 0));
    const cleanDeduct = Math.max(0, Math.round(Number(params.advanceDeducted) || 0));

    if (!workerId) {
      return { success: false, error: 'Please select a worker for Hisaab.' };
    }
    if (!params.fromDate || !params.toDate) {
      return { success: false, error: 'Please specify both From and To dates.' };
    }
    if (cleanWages < 0) {
      return { success: false, error: 'Total wages earned cannot be negative.' };
    }

    const admin = createAdminClient();
    if (!factoryId) {
      const { data: w } = await admin.from('workers').select('factory_id').eq('id', workerId).single();
      factoryId = w?.factory_id || '';
    }

    const workers = await getAllWorkersWithSalaryBalancesAction(factoryId || undefined);
    const currentWorker = workers.find(w => w.worker_id === workerId);
    if (!currentWorker) {
      return { success: false, error: 'Worker not found.' };
    }

    const currentAdv = currentWorker.running_advance || 0;
    if (cleanDeduct > currentAdv) {
      return {
        success: false,
        error: `Cannot deduct ₹${cleanDeduct.toLocaleString('en-IN')}. Outstanding advance is only ₹${currentAdv.toLocaleString('en-IN')}.`,
      };
    }
    if (cleanDeduct > cleanWages) {
      return {
        success: false,
        error: `Cannot deduct ₹${cleanDeduct.toLocaleString('en-IN')}. Total wages made is ₹${cleanWages.toLocaleString('en-IN')}.`,
      };
    }

    const netWages = cleanWages - cleanDeduct;

    // Calculate cash and online portions
    let cleanCashPaid = 0;
    if (params.cashPaid !== undefined) {
      cleanCashPaid = Math.max(0, Math.round(Number(params.cashPaid) || 0));
    } else if (params.payNetCashNow) {
      cleanCashPaid = netWages;
    }

    const cleanOnlinePaid = Math.max(0, Math.round(Number(params.onlinePaid) || 0));
    const totalPayout = cleanCashPaid + cleanOnlinePaid;

    if (cleanWages === 0 && cleanDeduct === 0 && totalPayout === 0) {
      return {
        success: false,
        error: 'Please enter wages earned, advance deduction, or payout amount.',
      };
    }

    // Check supervisor balance for physical cash handover
    if (cleanCashPaid > 0 && params.supervisorId) {
      try {
        const { data: supBal } = await admin.rpc('get_supervisor_balance', { sub_id: params.supervisorId });
        if (typeof supBal === 'number' && cleanCashPaid > supBal) {
          return {
            success: false,
            error: `Cannot give ₹${cleanCashPaid.toLocaleString('en-IN')} in cash. Your available cash in hand balance is ₹${supBal.toLocaleString('en-IN')}.`,
          };
        }
      } catch (balErr) {
        console.warn('Supervisor balance RPC check failed, proceeding:', balErr);
      }
    }

    // Split payout into net wages settlement vs extra advance:
    // Any amount paid beyond netWages (or when netWages === 0) is added as advance to worker's running advance!
    const wagesPaidFromCash = Math.min(cleanCashPaid, netWages);
    const remainingNetWages = netWages - wagesPaidFromCash;
    const wagesPaidFromOnline = Math.min(cleanOnlinePaid, remainingNetWages);
    const totalWagesPaid = wagesPaidFromCash + wagesPaidFromOnline;
    const unpaidRemaining = Math.max(0, netWages - totalWagesPaid);

    const extraCashAdvance = cleanCashPaid - wagesPaidFromCash;
    const extraOnlineAdvance = cleanOnlinePaid - wagesPaidFromOnline;
    const totalExtraAdvance = extraCashAdvance + extraOnlineAdvance;

    const baseAdvanceRemaining = Math.max(0, currentAdv - cleanDeduct);
    const finalAdvance = baseAdvanceRemaining + totalExtraAdvance;

    // Get supervisor name and user_id for cash_transactions foreign key
    let supervisorName = 'Supervisor';
    let supervisorUserId: string | null = null;
    if (params.supervisorId) {
      const { data: sup } = await admin
        .from('supervisors')
        .select('name, user_id')
        .eq('id', params.supervisorId)
        .single();
      if (sup?.name) supervisorName = sup.name;
      if (sup?.user_id) supervisorUserId = sup.user_id;
    }

    if (!supervisorUserId && params.supervisorId) {
      try {
        const authClient = createServerClient();
        const { data: { user } } = await authClient.auth.getUser();
        if (user?.id) supervisorUserId = user.id;
      } catch {}
      if (!supervisorUserId) {
        const { data: profile } = await admin.from('profiles').select('id').limit(1).maybeSingle();
        if (profile?.id) supervisorUserId = profile.id;
      }
    }

    const hisaabId = crypto.randomUUID();
    const periodStr = `${params.fromDate} to ${params.toDate}`;
    const hisaabNote = params.note?.trim() || `Hisaab settlement for ${periodStr}`;

    // 1. Record Hisaab master entry in audit_log
    const hisaabPayload = {
      id: hisaabId,
      worker_id: workerId,
      worker_name: currentWorker.worker_name,
      factory_id: factoryId,
      supervisor_id: params.supervisorId || null,
      supervisor_name: supervisorName,
      from_date: params.fromDate,
      to_date: params.toDate,
      total_wages: cleanWages,
      advance_deducted: cleanDeduct,
      net_wages: netWages,
      cash_paid: cleanCashPaid,
      online_paid: cleanOnlinePaid,
      total_paid: totalPayout,
      wages_paid_cash: wagesPaidFromCash,
      wages_paid_online: wagesPaidFromOnline,
      extra_advance_added: totalExtraAdvance,
      extra_cash_advance: extraCashAdvance,
      extra_online_advance: extraOnlineAdvance,
      unpaid_remaining: unpaidRemaining,
      previous_advance: currentAdv,
      new_advance: finalAdvance,
      note: hisaabNote,
      photo_url: params.photoUrl || null,
      created_at: new Date().toISOString(),
    };

    await admin.from('audit_log').insert({
      table_name: 'worker_hisaab',
      action: 'HISAAB',
      row_id: hisaabId,
      new_data: hisaabPayload,
      changed_by: params.supervisorId || null,
      changed_at: new Date().toISOString(),
    });

    // 2. If advance deduction > 0, record advance_recovery to reduce running_advance
    if (cleanDeduct > 0) {
      let recoveryNote = `Advance deducted during Hisaab (${periodStr})`;
      if (params.photoUrl) {
        recoveryNote = `${recoveryNote} [handover_photo:${params.photoUrl}]`;
      }
      await insertSalaryLedgerEntry({
        worker_id: workerId,
        factory_id: factoryId,
        type: 'advance_recovery',
        amount: cleanDeduct,
        period_month: periodStr,
        note: recoveryNote,
        created_by: params.supervisorId || null,
      });
    }

    // 3. If supervisor paid cash portion now -> deduct from supervisor physical cash in hand
    if (cleanCashPaid > 0 && params.supervisorId) {
      // 3a. Wages salary payment portion
      if (wagesPaidFromCash > 0) {
        let cashTxNote = `[TYPE:salary_payment] [HISAAB_CASH_PAID] Cash Handed Over (Hisaab: ${periodStr})${params.note ? ` • ${params.note}` : ''}`;
        if (params.photoUrl) {
          cashTxNote = `${cashTxNote} [handover_photo:${params.photoUrl}]`;
        }

        const txInsert: any = {
          id: crypto.randomUUID(),
          type: 'supervisor_to_worker',
          from_supervisor_id: params.supervisorId,
          to_worker_id: workerId,
          amount: wagesPaidFromCash,
          status: 'confirmed',
          confirmed_at: new Date().toISOString(),
          note: cashTxNote,
          created_at: new Date().toISOString(),
        };
        if (supervisorUserId) {
          txInsert.created_by = supervisorUserId;
          txInsert.confirmed_by = supervisorUserId;
        }

        const { error: txErr } = await admin.from('cash_transactions').insert(txInsert);
        if (txErr) {
          console.error('Error inserting cash transaction for Hisaab salary payout:', txErr);
          throw new Error(`Failed to deduct physical cash from supervisor: ${txErr.message}`);
        }
      }

      // 3b. Extra advance portion (added to worker's running advance)
      if (extraCashAdvance > 0) {
        let advTxNote = `[TYPE:advance] [HISAAB_EXTRA_ADVANCE] Cash Advance Handed Over (Hisaab: ${periodStr})${params.note ? ` • ${params.note}` : ''}`;
        if (params.photoUrl) {
          advTxNote = `${advTxNote} [handover_photo:${params.photoUrl}]`;
        }

        const advTxInsert: any = {
          id: crypto.randomUUID(),
          type: 'supervisor_to_worker',
          from_supervisor_id: params.supervisorId,
          to_worker_id: workerId,
          amount: extraCashAdvance,
          status: 'confirmed',
          confirmed_at: new Date().toISOString(),
          note: advTxNote,
          created_at: new Date().toISOString(),
        };
        if (supervisorUserId) {
          advTxInsert.created_by = supervisorUserId;
          advTxInsert.confirmed_by = supervisorUserId;
        }

        const { error: advErr } = await admin.from('cash_transactions').insert(advTxInsert);
        if (advErr) {
          console.error('Error inserting cash transaction for Hisaab extra advance:', advErr);
          throw new Error(`Failed to deduct physical cash from supervisor: ${advErr.message}`);
        }
      }
    }

    // 4. Online QR payment portions
    if (cleanOnlinePaid > 0) {
      // 4a. Wages salary payment portion
      if (wagesPaidFromOnline > 0) {
        let onlineNote = `[HISAAB_ONLINE_PAID] Online QR Payment (Hisaab: ${periodStr})${params.note ? ` • ${params.note}` : ''}`;
        if (params.photoUrl) {
          onlineNote = `${onlineNote} [handover_photo:${params.photoUrl}]`;
        }

        await admin.from('audit_log').insert({
          table_name: 'worker_online_payments',
          action: 'ONLINE_QR_PAYOUT',
          row_id: crypto.randomUUID(),
          new_data: {
            id: crypto.randomUUID(),
            hisaab_id: hisaabId,
            worker_id: workerId,
            worker_name: currentWorker.worker_name,
            factory_id: factoryId,
            supervisor_id: params.supervisorId || null,
            supervisor_name: supervisorName,
            amount: wagesPaidFromOnline,
            period: periodStr,
            photo_url: params.photoUrl || null,
            note: onlineNote,
            created_at: new Date().toISOString(),
          },
          changed_by: params.supervisorId || null,
          changed_at: new Date().toISOString(),
        });
      }

      // 4b. Extra online advance portion (added to worker's running advance)
      if (extraOnlineAdvance > 0) {
        const advId = crypto.randomUUID();
        let advOnlineNote = `[HISAAB_ONLINE_ADVANCE] Online Advance (Hisaab: ${periodStr})${params.note ? ` • ${params.note}` : ''}`;
        if (params.photoUrl) {
          advOnlineNote = `${advOnlineNote} [handover_photo:${params.photoUrl}]`;
        }

        await admin.from('audit_log').insert({
          table_name: 'worker_online_advances',
          action: 'ONLINE_ADVANCE',
          row_id: advId,
          new_data: {
            id: advId,
            worker_id: workerId,
            worker_name: currentWorker.worker_name,
            factory_id: factoryId,
            supervisor_id: params.supervisorId || null,
            supervisor_name: supervisorName,
            amount: extraOnlineAdvance,
            period: periodStr,
            photo_url: params.photoUrl || null,
            note: advOnlineNote,
            payment_method: 'online',
            created_at: new Date().toISOString(),
          },
          changed_by: params.supervisorId || null,
          changed_at: new Date().toISOString(),
        });
      }
    }

    revalidatePath('/admin');
    revalidatePath('/supervisor');
    revalidatePath('/supervisor/workers');

    return {
      success: true,
      hisaabId,
      previousAdvance: currentAdv,
      advanceDeducted: cleanDeduct,
      newAdvanceRemaining: finalAdvance,
      extraAdvanceAdded: totalExtraAdvance,
      netWages,
      cashPaid: cleanCashPaid,
      onlinePaid: cleanOnlinePaid,
      unpaidRemaining,
    };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to record Hisaab.' };
  }
}

export async function getWorkerHisaabRecordsAction(factoryId?: string, workerId?: string) {
  try {
    const admin = createAdminClient();
    const { data: rows } = await admin
      .from('audit_log')
      .select('*')
      .eq('table_name', 'worker_hisaab')
      .order('changed_at', { ascending: false });

    return (rows || [])
      .map(r => r.new_data as any)
      .filter(item => {
        if (!item) return false;
        if (workerId && item.worker_id !== workerId) return false;
        if (factoryId && factoryId !== 'all' && item.factory_id !== factoryId) return false;
        return true;
      });
  } catch {
    return [];
  }
}

export interface WorkerOnlineAdvance {
  id: string;
  worker_id: string;
  worker_name: string;
  factory_id: string;
  supervisor_id: string | null;
  supervisor_name: string;
  amount: number;
  note: string;
  photo_url: string | null;
  payment_method: 'online';
  created_at: string;
}

export async function recordWorkerOnlineAdvanceAction(params: {
  workerId: string;
  supervisorId: string;
  factoryId?: string;
  amount: number;
  note?: string;
  photoUrl?: string | null;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const { workerId, supervisorId, amount, photoUrl } = params;
    const cleanAmount = Math.max(1, Math.round(Number(amount) || 0));
    if (!workerId) return { success: false, error: 'Worker is required.' };
    if (cleanAmount <= 0) return { success: false, error: 'Valid amount is required.' };

    const admin = createAdminClient();
    const [workerRes, supRes] = await Promise.all([
      admin.from('workers').select('name, factory_id').eq('id', workerId).single(),
      admin.from('supervisors').select('name').eq('id', supervisorId).single(),
    ]);

    const workerName = workerRes.data?.name || 'Worker';
    const supervisorName = supRes.data?.name || 'Supervisor';
    const effectiveFactoryId = params.factoryId || workerRes.data?.factory_id || '';

    const id = crypto.randomUUID();
    const cleanNote = params.note?.trim() || 'Online Advance (Bank/UPI)';

    const advancePayload: WorkerOnlineAdvance = {
      id,
      worker_id: workerId,
      worker_name: workerName,
      factory_id: effectiveFactoryId,
      supervisor_id: supervisorId,
      supervisor_name: supervisorName,
      amount: cleanAmount,
      note: cleanNote,
      photo_url: photoUrl || null,
      payment_method: 'online',
      created_at: new Date().toISOString(),
    };

    const { error } = await admin.from('audit_log').insert({
      table_name: 'worker_online_advances',
      action: 'ONLINE_ADVANCE',
      row_id: id,
      new_data: advancePayload,
      changed_by: supervisorId,
      changed_at: new Date().toISOString(),
    });

    if (error) {
      console.error('recordWorkerOnlineAdvanceAction error:', error);
      return { success: false, error: error.message };
    }

    revalidatePath('/admin');
    revalidatePath('/supervisor');
    revalidatePath('/supervisor/workers');

    return { success: true, id };
  } catch (err: any) {
    console.error('recordWorkerOnlineAdvanceAction exception:', err);
    return { success: false, error: err.message || 'Failed to record online advance.' };
  }
}

export async function getWorkerOnlineAdvancesAction(factoryId?: string, workerId?: string): Promise<WorkerOnlineAdvance[]> {
  try {
    const admin = createAdminClient();
    const { data: rows } = await admin
      .from('audit_log')
      .select('*')
      .eq('table_name', 'worker_online_advances')
      .eq('action', 'ONLINE_ADVANCE')
      .order('changed_at', { ascending: false });

    return (rows || [])
      .map(r => r.new_data as WorkerOnlineAdvance)
      .filter(item => {
        if (!item) return false;
        if (workerId && item.worker_id !== workerId) return false;
        if (factoryId && factoryId !== 'all' && item.factory_id !== factoryId) return false;
        return true;
      });
  } catch {
    return [];
  }
}

export interface WorkerBonus {
  id: string;
  worker_id: string;
  worker_name: string;
  factory_id: string;
  supervisor_id: string | null;
  supervisor_name: string;
  amount: number;
  note: string;
  photo_url: string | null;
  payment_method: 'cash' | 'online';
  cash_tx_id?: string | null;
  created_at: string;
}

export async function recordWorkerBonusAction(params: {
  workerId: string;
  supervisorId: string;
  factoryId?: string;
  amount: number;
  paymentMethod: 'cash' | 'online';
  note?: string;
  photoUrl?: string | null;
  cashTxId?: string | null;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const { workerId, supervisorId, amount, paymentMethod, photoUrl, cashTxId } = params;
    const cleanAmount = Math.max(1, Math.round(Number(amount) || 0));
    if (!workerId) return { success: false, error: 'Worker is required.' };
    if (cleanAmount <= 0) return { success: false, error: 'Valid amount is required.' };

    const admin = createAdminClient();
    const [workerRes, supRes] = await Promise.all([
      admin.from('workers').select('name, factory_id').eq('id', workerId).single(),
      admin.from('supervisors').select('name').eq('id', supervisorId).single(),
    ]);

    const workerName = workerRes.data?.name || 'Worker';
    const supervisorName = supRes.data?.name || 'Supervisor';
    const effectiveFactoryId = params.factoryId || workerRes.data?.factory_id || '';

    const id = crypto.randomUUID();
    const cleanNote = params.note?.trim() || `Bonus (${paymentMethod === 'online' ? 'Online' : 'Cash'})`;

    const bonusPayload: WorkerBonus = {
      id,
      worker_id: workerId,
      worker_name: workerName,
      factory_id: effectiveFactoryId,
      supervisor_id: supervisorId,
      supervisor_name: supervisorName,
      amount: cleanAmount,
      note: cleanNote,
      photo_url: photoUrl || null,
      payment_method: paymentMethod,
      cash_tx_id: cashTxId || null,
      created_at: new Date().toISOString(),
    };

    const { error } = await admin.from('audit_log').insert({
      table_name: 'worker_bonuses',
      action: 'BONUS',
      row_id: id,
      new_data: bonusPayload,
      changed_by: supervisorId,
      changed_at: new Date().toISOString(),
    });

    if (error) {
      console.error('recordWorkerBonusAction error:', error);
      return { success: false, error: error.message };
    }

    revalidatePath('/admin');
    revalidatePath('/supervisor');
    revalidatePath('/supervisor/workers');

    return { success: true, id };
  } catch (err: any) {
    console.error('recordWorkerBonusAction exception:', err);
    return { success: false, error: err.message || 'Failed to record worker bonus.' };
  }
}

export async function getWorkerBonusesAction(factoryId?: string, workerId?: string): Promise<WorkerBonus[]> {
  try {
    const admin = createAdminClient();
    const { data: rows } = await admin
      .from('audit_log')
      .select('*')
      .eq('table_name', 'worker_bonuses')
      .eq('action', 'BONUS')
      .order('changed_at', { ascending: false });

    return (rows || [])
      .map(r => r.new_data as WorkerBonus)
      .filter(item => {
        if (!item) return false;
        if (workerId && item.worker_id !== workerId) return false;
        if (factoryId && factoryId !== 'all' && item.factory_id !== factoryId) return false;
        return true;
      });
  } catch {
    return [];
  }
}

export interface AdvanceCorrectionRequest {
  id: string;
  worker_id: string;
  worker_name?: string;
  worker_phone?: string | null;
  factory_id: string;
  factory_name?: string;
  supervisor_id: string;
  supervisor_name?: string;
  current_advance: number;
  requested_advance: number;
  difference: number;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  created_at: string;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  admin_note?: string | null;
}

/**
 * Supervisor requests an advance correction from admin.
 */
export async function createAdvanceCorrectionRequestAction(params: {
  workerId: string;
  supervisorId: string;
  currentAdvance: number;
  requestedAdvance: number;
  reason: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { workerId, supervisorId, reason } = params;
    const currentAdv = Math.max(0, Math.round(Number(params.currentAdvance) || 0));
    const requestedAdv = Math.max(0, Math.round(Number(params.requestedAdvance) || 0));

    if (!workerId) return { success: false, error: 'Worker is required.' };
    if (!reason?.trim()) return { success: false, error: 'Reason for correction is required.' };

    const admin = createAdminClient();
    const { data: worker } = await admin
      .from('workers')
      .select('id, name, factory_id')
      .eq('id', workerId)
      .single();

    if (!worker) return { success: false, error: 'Worker not found.' };

    const id = crypto.randomUUID();
    const payload = {
      id,
      worker_id: workerId,
      factory_id: worker.factory_id,
      supervisor_id: supervisorId,
      current_advance: currentAdv,
      requested_advance: requestedAdv,
      difference: requestedAdv - currentAdv,
      reason: reason.trim(),
      status: 'PENDING',
      created_at: new Date().toISOString(),
    };

    const { error } = await admin.from('audit_log').insert({
      table_name: 'advance_correction_requests',
      action: 'PENDING',
      row_id: id,
      new_data: payload,
      changed_by: supervisorId,
      changed_at: new Date().toISOString(),
    });

    if (error) throw error;

    revalidatePath('/admin');
    revalidatePath('/supervisor');
    revalidatePath('/supervisor/workers');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to submit correction request.' };
  }
}

/**
 * Fetch all advance correction requests for Admin Dashboard.
 */
export async function getAdvanceCorrectionRequestsAction(): Promise<AdvanceCorrectionRequest[]> {
  try {
    const admin = createAdminClient();
    const [
      { data: rows, error },
      { data: workers },
      { data: supervisors },
      { data: factories },
    ] = await Promise.all([
      admin
        .from('audit_log')
        .select('*')
        .eq('table_name', 'advance_correction_requests')
        .order('changed_at', { ascending: false }),
      admin.from('workers').select('id, name, phone'),
      admin.from('supervisors').select('id, name'),
      admin.from('factories').select('id, name'),
    ]);

    if (error || !rows) return [];

    const workerMap = new Map((workers || []).map(w => [w.id, w]));
    const supMap = new Map((supervisors || []).map(s => [s.id, s.name]));
    const facMap = new Map((factories || []).map(f => [f.id, f.name]));

    return rows.map(r => {
      const payload = r.new_data as any;
      const worker = workerMap.get(payload.worker_id);
      return {
        id: payload.id || r.row_id,
        worker_id: payload.worker_id,
        worker_name: worker?.name || 'Worker',
        worker_phone: worker?.phone || null,
        factory_id: payload.factory_id,
        factory_name: facMap.get(payload.factory_id) || 'Factory',
        supervisor_id: payload.supervisor_id,
        supervisor_name: supMap.get(payload.supervisor_id) || 'Supervisor',
        current_advance: Number(payload.current_advance || 0),
        requested_advance: Number(payload.requested_advance || 0),
        difference: Number(payload.difference !== undefined ? payload.difference : (Number(payload.requested_advance) - Number(payload.current_advance))),
        reason: payload.reason || '',
        status: (r.action as any) || payload.status || 'PENDING',
        created_at: payload.created_at || r.changed_at,
        reviewed_by: payload.reviewed_by || null,
        reviewed_at: payload.reviewed_at || null,
        admin_note: payload.admin_note || null,
      };
    });
  } catch (err) {
    console.error('getAdvanceCorrectionRequestsAction error:', err);
    return [];
  }
}

/**
 * Admin reviews (Approve / Reject) an advance correction request.
 * If approved, adjusts the worker advance to match the target figure.
 */
export async function reviewAdvanceCorrectionAction(params: {
  requestId: string;
  decision: 'approve' | 'reject';
  adminId?: string;
  adjustedAdvance?: number;
  adminNote?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const admin = createAdminClient();
    const { requestId, decision } = params;

    const { data: requestRow } = await admin
      .from('audit_log')
      .select('*')
      .eq('table_name', 'advance_correction_requests')
      .eq('row_id', requestId)
      .single();

    if (!requestRow) return { success: false, error: 'Request not found.' };

    const payload = requestRow.new_data as any;
    const workerId = payload.worker_id;
    const factoryId = payload.factory_id;

    if (decision === 'approve') {
      const targetAdvance = params.adjustedAdvance !== undefined
        ? Math.max(0, Math.round(Number(params.adjustedAdvance)))
        : Number(payload.requested_advance);

      const workers = await getAllWorkersWithSalaryBalancesAction(factoryId);
      const currentWorker = workers.find(w => w.worker_id === workerId);
      const currentAdvance = currentWorker ? currentWorker.running_advance : Number(payload.current_advance);

      const diff = targetAdvance - currentAdvance;
      if (diff !== 0) {
        if (diff > 0) {
          let creatorId = params.adminId;
          if (!creatorId) {
            const { data: prof } = await admin.from('profiles').select('id').limit(1).maybeSingle();
            if (prof?.id) creatorId = prof.id;
          }
          const txRow: any = {
            id: crypto.randomUUID(),
            type: 'supervisor_to_worker',
            from_supervisor_id: payload.supervisor_id,
            to_worker_id: workerId,
            amount: diff,
            status: 'confirmed',
            confirmed_at: new Date().toISOString(),
            note: `[ADVANCE_ADJUSTMENT:ADD] Admin corrected advance by +₹${diff.toLocaleString('en-IN')}: ${params.adminNote || payload.reason}`,
            created_at: new Date().toISOString(),
          };
          if (creatorId) {
            txRow.created_by = creatorId;
            txRow.confirmed_by = creatorId;
          }
          await admin.from('cash_transactions').insert(txRow);
        } else {
          const reduceAmount = Math.abs(diff);
          await insertSalaryLedgerEntry({
            worker_id: workerId,
            factory_id: factoryId,
            type: 'advance_recovery',
            amount: reduceAmount,
            period_month: 'Correction',
            note: `Admin corrected advance by -₹${reduceAmount.toLocaleString('en-IN')}: ${params.adminNote || payload.reason}`,
            created_by: params.adminId || null,
          });
        }
      }

      await admin
        .from('audit_log')
        .update({
          action: 'APPROVED',
          new_data: {
            ...payload,
            status: 'APPROVED',
            approved_advance: targetAdvance,
            reviewed_by: params.adminId || 'Admin',
            reviewed_at: new Date().toISOString(),
            admin_note: params.adminNote?.trim() || null,
          },
        })
        .eq('table_name', 'advance_correction_requests')
        .eq('row_id', requestId);
    } else {
      await admin
        .from('audit_log')
        .update({
          action: 'REJECTED',
          new_data: {
            ...payload,
            status: 'REJECTED',
            reviewed_by: params.adminId || 'Admin',
            reviewed_at: new Date().toISOString(),
            admin_note: params.adminNote?.trim() || 'Rejected by Admin',
          },
        })
        .eq('table_name', 'advance_correction_requests')
        .eq('row_id', requestId);
    }

    revalidatePath('/admin');
    revalidatePath('/supervisor');
    revalidatePath('/supervisor/workers');

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to review request.' };
  }
}

/**
 * Recover an advance from a worker's accumulated salary balance.
 * Reduces both Outstanding Advance and Unpaid Salary with ZERO cash outflow.
 */
export async function recoverWorkerAdvanceAction(
  workerId: string,
  factoryIdOrAmount: string | number,
  amountOrNote?: number | string,
  note?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    let factoryId: string = '';
    let amount: number = 0;
    let remarks: string | null = null;

    if (typeof factoryIdOrAmount === 'number') {
      amount = factoryIdOrAmount;
      remarks = (typeof amountOrNote === 'string' ? amountOrNote : null) || note || null;
    } else {
      factoryId = factoryIdOrAmount;
      amount = Number(amountOrNote) || 0;
      remarks = note || null;
    }

    if (!workerId || !amount || amount <= 0) {
      return { success: false, error: 'Please enter a valid recovery amount.' };
    }

    const cleanAmount = Math.round(Number(amount));

    if (!factoryId) {
      const admin = createAdminClient();
      const { data: w } = await admin.from('workers').select('factory_id').eq('id', workerId).single();
      factoryId = w?.factory_id || '';
    }

    // Verify current balances to prevent over-recovery
    const workers = await getAllWorkersWithSalaryBalancesAction(factoryId || undefined);
    const worker = workers.find(w => w.worker_id === workerId);
    if (!worker) {
      return { success: false, error: 'Worker not found.' };
    }

    if (cleanAmount > worker.running_advance) {
      return { 
        success: false, 
        error: `Cannot recover ₹${cleanAmount.toLocaleString('en-IN')}. Outstanding advance is only ₹${worker.running_advance.toLocaleString('en-IN')}.` 
      };
    }

    if (cleanAmount > worker.unpaid_salary) {
      return {
        success: false,
        error: `Cannot recover ₹${cleanAmount.toLocaleString('en-IN')}. Available unpaid salary is only ₹${worker.unpaid_salary.toLocaleString('en-IN')}.`
      };
    }

    await insertSalaryLedgerEntry({
      worker_id: workerId,
      factory_id: factoryId,
      type: 'advance_recovery',
      amount: cleanAmount,
      note: remarks?.trim() || 'Advance recovered from earned salary balance',
    });

    revalidatePath('/admin');
    revalidatePath('/supervisor');
    revalidatePath('/supervisor/workers');

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to recover advance.' };
  }
}

/**
 * Batch credit monthly salaries for workers in a factory.
 */
export async function batchCreditMonthlySalariesAction(
  factoryId?: string,
  periodMonth?: string,
  entriesOrNote?: { workerId: string; amount: number }[] | string
): Promise<{ success: boolean; creditedCount: number; totalCredited?: number; error?: string }> {
  try {
    const period = periodMonth || new Date().toLocaleString('en-IN', { month: 'long', year: 'numeric' });
    let entries: { workerId: string; factoryId: string; amount: number }[] = [];

    if (Array.isArray(entriesOrNote)) {
      entries = entriesOrNote.map(e => ({ workerId: e.workerId, factoryId: factoryId || '', amount: e.amount }));
    } else {
      // Auto-fetch all active workers with monthly_salary > 0
      const workers = await getAllWorkersWithSalaryBalancesAction(factoryId);
      entries = workers
        .filter(w => (w.monthly_salary || 0) > 0)
        .map(w => ({ workerId: w.worker_id, factoryId: w.factory_id, amount: w.monthly_salary }));
    }

    if (entries.length === 0) {
      return { success: false, creditedCount: 0, error: 'No workers with configured monthly wages were found.' };
    }

    let count = 0;
    let total = 0;
    for (const item of entries) {
      if (item.amount > 0) {
        await insertSalaryLedgerEntry({
          worker_id: item.workerId,
          factory_id: item.factoryId,
          type: 'salary_earned',
          amount: Math.round(Number(item.amount)),
          period_month: period,
          note: `Monthly Salary Credit (${period})`,
        });
        count++;
        total += item.amount;
      }
    }

    revalidatePath('/admin');
    revalidatePath('/supervisor');
    revalidatePath('/supervisor/workers');

    return { success: true, creditedCount: count, totalCredited: total };
  } catch (err: any) {
    return { success: false, creditedCount: 0, error: err.message || 'Failed to batch credit salaries.' };
  }
}

/**
 * Convert legacy "Kharcha" / "Hafta" transactions to Salary Payments in 1 click.
 */
export async function batchReclassifyKharchaAction(
  factoryId?: string
): Promise<{ success: boolean; count: number; convertedCount: number; totalAmount: number; totalConvertedAmount: number; error?: string }> {
  try {
    const admin = createAdminClient();
    const query = admin
      .from('cash_transactions')
      .select('id, amount, note, to_worker_id')
      .eq('type', 'supervisor_to_worker')
      .or('note.ilike.%kharcha%,note.ilike.%hafta%');

    const { data: txs, error } = await query;
    if (error) throw error;

    let updated = 0;
    let totalAmt = 0;
    for (const tx of txs || []) {
      await reclassifyWorkerTransactionAction(tx.id, 'salary_payment');
      updated++;
      totalAmt += Number(tx.amount || 0);
    }

    revalidatePath('/admin');
    revalidatePath('/supervisor');
    revalidatePath('/supervisor/workers');

    return { 
      success: true, 
      count: updated, 
      convertedCount: updated, 
      totalAmount: totalAmt, 
      totalConvertedAmount: totalAmt 
    };
  } catch (err: any) {
    return { 
      success: false, 
      count: 0, 
      convertedCount: 0, 
      totalAmount: 0, 
      totalConvertedAmount: 0, 
      error: err.message || 'Failed to reclassify Kharcha transactions.' 
    };
  }
}

/**
 * Fetch all active workers and compute comprehensive salary & advance balances.
 * Used uniformly across Admin Dashboard, Supervisor Dashboard, and Worker Directory.
 */
export async function getAllWorkersWithSalaryBalancesAction(factoryId?: string): Promise<FactoryWorkerBalance[]> {
  try {
    const admin = createAdminClient();

    // 1. Fetch active workers from workers table
    let workersQuery = admin.from('workers').select('*').eq('active', true).order('name');
    if (factoryId && factoryId !== 'all') {
      workersQuery = workersQuery.eq('factory_id', factoryId);
    }

    const { data: rawWorkers, error: workersError } = await workersQuery;
    if (workersError || !rawWorkers) {
      console.error('getAllWorkersWithSalaryBalancesAction error fetching workers:', workersError);
      return [];
    }

    const workers = rawWorkers.filter(w => w.name !== 'Deleted Worker');
    if (workers.length === 0) return [];

    const workerIds = workers.map(w => w.id);
    const workerIdSet = new Set(workerIds);

    // 2. Fetch all confirmed worker cash transactions, refunds, reclassifications, salary ledger entries, online advances, and bonuses in parallel
    const [
      { data: cashTxs },
      { data: refundLogs },
      { data: refundNotes },
      reclassMap,
      salaryLedgerEntries,
      onlineAdvances,
      bonuses,
    ] = await Promise.all([
      admin
        .from('cash_transactions')
        .select('id, amount, note, status, to_worker_id, created_at')
        .eq('type', 'supervisor_to_worker')
        .eq('status', 'confirmed')
        .in('to_worker_id', workerIds),
      admin
        .from('audit_log')
        .select('row_id')
        .eq('table_name', 'cash_transactions')
        .eq('action', 'refund'),
      admin
        .from('cash_transactions')
        .select('note')
        .eq('type', 'office_to_supervisor')
        .ilike('note', '%[REFUND:%'),
      getReclassifiedTransactions(),
      getSalaryLedgerEntries(factoryId),
      getWorkerOnlineAdvancesAction(factoryId),
      getWorkerBonusesAction(factoryId),
    ]);

    // Build refund set
    const refundedTxIds = new Set<string>((refundLogs || []).map(r => r.row_id));
    (refundNotes || []).forEach(tx => {
      const match = tx.note?.match(/\[REFUND:([a-f0-9-]+)\]/);
      if (match && match[1]) refundedTxIds.add(match[1]);
    });

    // Aggregations per worker
    const workerCashAdvanceGiven: Record<string, number> = {};
    const workerOnlineAdvanceGiven: Record<string, number> = {};
    const workerCashBonusGiven: Record<string, number> = {};
    const workerOnlineBonusGiven: Record<string, number> = {};
    const workerSalaryPaid: Record<string, number> = {};
    const workerSalaryEarned: Record<string, number> = {};
    const workerAdvanceRecovered: Record<string, number> = {};

    // Process Cash Disbursements
    (cashTxs || []).forEach(tx => {
      if (!tx.to_worker_id || !workerIdSet.has(tx.to_worker_id)) return;
      if (refundedTxIds.has(tx.id)) return; // Exclude refunded

      const amount = Number(tx.amount || 0);
      const reclass = reclassMap[tx.id];

      // Check if this cash disbursement is a bonus, salary payment or advance
      const isBonusPayment = (!reclass && (tx.note?.includes('[TYPE:bonus]') || false));
      const isSalaryPayment = reclass === 'salary_payment' || 
        (!reclass && (tx.note?.includes('[TYPE:salary_payment]') || false));

      if (isBonusPayment) {
        workerCashBonusGiven[tx.to_worker_id] = (workerCashBonusGiven[tx.to_worker_id] || 0) + amount;
      } else if (isSalaryPayment) {
        workerSalaryPaid[tx.to_worker_id] = (workerSalaryPaid[tx.to_worker_id] || 0) + amount;
      } else {
        workerCashAdvanceGiven[tx.to_worker_id] = (workerCashAdvanceGiven[tx.to_worker_id] || 0) + amount;
      }
    });

    // Process Online Advances (Bank / UPI QR payments to workers)
    (onlineAdvances || []).forEach(adv => {
      if (!adv.worker_id || !workerIdSet.has(adv.worker_id)) return;
      if (refundedTxIds.has(adv.id)) return;
      const amount = Number(adv.amount || 0);
      workerOnlineAdvanceGiven[adv.worker_id] = (workerOnlineAdvanceGiven[adv.worker_id] || 0) + amount;
    });

    // Process Worker Bonuses (Cash & Online)
    (bonuses || []).forEach(b => {
      if (!b.worker_id || !workerIdSet.has(b.worker_id)) return;
      if (refundedTxIds.has(b.id) || (b.cash_tx_id && refundedTxIds.has(b.cash_tx_id))) return;
      const amount = Number(b.amount || 0);
      if (b.payment_method === 'online') {
        workerOnlineBonusGiven[b.worker_id] = (workerOnlineBonusGiven[b.worker_id] || 0) + amount;
      } else {
        // If not already recorded via cash_transactions
        if (!b.cash_tx_id || !cashTxs?.some(t => t.id === b.cash_tx_id)) {
          workerCashBonusGiven[b.worker_id] = (workerCashBonusGiven[b.worker_id] || 0) + amount;
        }
      }
    });

    // Process Non-Cash Salary Ledger Entries (Accruals & Recoveries)
    salaryLedgerEntries.forEach(entry => {
      if (!workerIdSet.has(entry.worker_id)) return;
      const amount = Number(entry.amount || 0);

      if (entry.type === 'salary_earned') {
        workerSalaryEarned[entry.worker_id] = (workerSalaryEarned[entry.worker_id] || 0) + amount;
      } else if (entry.type === 'advance_recovery') {
        workerAdvanceRecovered[entry.worker_id] = (workerAdvanceRecovered[entry.worker_id] || 0) + amount;
      }
    });

    // Build finalized balances
    return workers.map(w => {
      const openingAdv = Number(w.opening_advance || 0);
      const openingUnpaid = Number(w.opening_unpaid_salary || 0);
      const monthlyWage = Number(w.monthly_salary || 0);

      const cashAdv = workerCashAdvanceGiven[w.id] || 0;
      const onlineAdv = workerOnlineAdvanceGiven[w.id] || 0;
      const advGiven = cashAdv + onlineAdv;
      const advRecovered = workerAdvanceRecovered[w.id] || 0;
      const salEarned = (workerSalaryEarned[w.id] || 0) + openingUnpaid;
      const salPaid = workerSalaryPaid[w.id] || 0;

      const cashBonus = workerCashBonusGiven[w.id] || 0;
      const onlineBonus = workerOnlineBonusGiven[w.id] || 0;
      const totalBonusPaid = cashBonus + onlineBonus;

      const totalAdvanceGiven = openingAdv + advGiven;
      const totalAdvanceRecovered = advRecovered;
      const runningAdvance = Math.max(0, totalAdvanceGiven - totalAdvanceRecovered);

      const totalSalaryEarned = salEarned;
      const totalSalaryPaid = salPaid;
      const unpaidSalary = Math.max(0, totalSalaryEarned - totalSalaryPaid - totalAdvanceRecovered);
      const netPayable = unpaidSalary - runningAdvance;
      const totalCashDisbursed = cashAdv + salPaid + cashBonus;

      return {
        worker_id: w.id,
        worker_name: w.name,
        worker_phone: w.phone,
        worker_photo_url: w.photo_url,
        factory_id: w.factory_id,
        supervisor_id: w.supervisor_id,
        opening_advance: openingAdv,
        opening_unpaid_salary: openingUnpaid,
        monthly_salary: monthlyWage,
        total_cash_disbursed: totalCashDisbursed,
        running_advance: runningAdvance,
        total_advance_given: totalAdvanceGiven,
        total_advance_recovered: totalAdvanceRecovered,
        total_salary_earned: totalSalaryEarned,
        total_salary_paid: totalSalaryPaid,
        unpaid_salary: unpaidSalary,
        net_payable: netPayable,
        total_bonus_paid: totalBonusPaid,
        cash_bonus_paid: cashBonus,
        online_bonus_paid: onlineBonus,
        active: w.active !== false,
      };
    });
  } catch (err) {
    console.error('getAllWorkersWithSalaryBalancesAction exception:', err);
    return [];
  }
}

/**
 * Legacy wrapper: alias for getAllWorkersWithSalaryBalancesAction
 */
export async function getFactoryWorkersAction(factoryId: string): Promise<FactoryWorkerBalance[]> {
  return getAllWorkersWithSalaryBalancesAction(factoryId);
}

/**
 * Fetch full chronological ledger for a specific worker:
 * Includes opening balances, cash advances, cash salary payments, salary earned, advance recoveries, and refunds.
 */
export async function getWorkerFullLedgerAction(workerId: string): Promise<{
  worker: any;
  ledgerEntries: FullWorkerLedgerEntry[];
}> {
  try {
    const admin = createAdminClient();

    // 1. Worker Profile
    const { data: worker } = await admin
      .from('workers')
      .select('*, factories(name), supervisors(name)')
      .eq('id', workerId)
      .single();

    if (!worker) return { worker: null, ledgerEntries: [] };

    // 2. Parallel data fetch
    const [
      { data: cashTxs },
      { data: refundLogs },
      { data: refundNotes },
      reclassMap,
      salaryEntries,
      hisaabRecords,
      onlineAdvances,
      bonuses,
    ] = await Promise.all([
      admin
        .from('cash_transactions')
        .select('id, amount, note, status, created_at, from:from_supervisor_id(name)')
        .eq('type', 'supervisor_to_worker')
        .eq('to_worker_id', workerId)
        .order('created_at', { ascending: false }),
      admin
        .from('audit_log')
        .select('row_id, changed_at, new_data')
        .eq('table_name', 'cash_transactions')
        .eq('action', 'refund'),
      admin
        .from('cash_transactions')
        .select('note')
        .eq('type', 'office_to_supervisor')
        .ilike('note', '%[REFUND:%'),
      getReclassifiedTransactions(),
      getSalaryLedgerEntries(undefined, workerId),
      getWorkerHisaabRecordsAction(undefined, workerId),
      getWorkerOnlineAdvancesAction(undefined, workerId),
      getWorkerBonusesAction(undefined, workerId),
    ]);

    const refundedMap: Record<string, string> = {};
    (refundLogs || []).forEach(r => {
      if (r.row_id) refundedMap[r.row_id] = (r.new_data as any)?.refunded_at || r.changed_at;
    });
    (refundNotes || []).forEach(tx => {
      const match = tx.note?.match(/\[REFUND:([a-f0-9-]+)\]/);
      if (match && match[1]) refundedMap[match[1]] = tx.note || 'Refunded';
    });

    const ledger: FullWorkerLedgerEntry[] = [];

    // Opening Advance
    if (Number(worker.opening_advance || 0) > 0) {
      ledger.push({
        id: `opening-adv-${worker.id}`,
        date: worker.created_at,
        type: 'opening_advance',
        title: 'Opening Advance Balance',
        label: 'Opening Advance',
        amount: Number(worker.opening_advance),
        note: 'Carried forward balance',
        isCash: false,
        supervisorName: 'Office / Opening',
        photoUrl: null,
        effectOnAdvance: Number(worker.opening_advance),
        effectOnSalary: 0,
      });
    }

    // Opening Unpaid Salary
    if (Number(worker.opening_unpaid_salary || 0) > 0) {
      ledger.push({
        id: `opening-sal-${worker.id}`,
        date: worker.created_at,
        type: 'opening_salary',
        title: 'Opening Unpaid Salary Balance',
        label: 'Opening Salary',
        amount: Number(worker.opening_unpaid_salary),
        note: 'Carried forward unpaid salary',
        isCash: false,
        supervisorName: 'Office / Opening',
        photoUrl: null,
        effectOnAdvance: 0,
        effectOnSalary: Number(worker.opening_unpaid_salary),
      });
    }

    // Cash Disbursements
    (cashTxs || []).forEach(tx => {
      const amount = Number(tx.amount || 0);
      const isRefunded = !!refundedMap[tx.id];
      const reclass = reclassMap[tx.id];

      // Skip bonuses here: handled via bonuses mapping below
      const isBonus = (!reclass && (tx.note?.includes('[TYPE:bonus]') || false));
      if (isBonus) return;

      const isSalary = reclass === 'salary_payment' || 
        (!reclass && (tx.note?.includes('[TYPE:salary_payment]') || false));

      const parsed = parseHandoverNote(tx.note);
      const supervisorName = (tx.from as any)?.name ? `by ${(tx.from as any).name}` : 'Supervisor';

      if (isSalary) {
        ledger.push({
          id: tx.id,
          date: tx.created_at,
          type: 'salary_payment',
          title: `Salary Payment (${supervisorName})`.trim(),
          label: 'Salary Payment',
          amount,
          note: parsed.note || 'Cash Salary Withdrawal',
          isCash: true,
          supervisorName,
          photoUrl: parsed.photoUrl || null,
          effectOnAdvance: 0,
          effectOnSalary: isRefunded ? 0 : -amount,
          refunded: isRefunded,
        });
      } else {
        ledger.push({
          id: tx.id,
          date: tx.created_at,
          type: 'advance_given',
          title: `Cash Advance (${supervisorName})`.trim(),
          label: 'Cash Advance',
          amount,
          note: parsed.note || 'Advance given',
          isCash: true,
          supervisorName,
          photoUrl: parsed.photoUrl || null,
          effectOnAdvance: isRefunded ? 0 : amount,
          effectOnSalary: 0,
          refunded: isRefunded,
        });
      }
    });

    // Salary Ledger Entries
    salaryEntries.forEach(entry => {
      const amount = Number(entry.amount || 0);
      if (entry.type === 'salary_earned') {
        ledger.push({
          id: entry.id,
          date: entry.created_at,
          type: 'salary_earned',
          title: entry.period_month ? `Salary Earned (${entry.period_month})` : 'Salary Earned',
          label: 'Salary Earned',
          amount,
          note: entry.note || 'Wages credited',
          isCash: false,
          supervisorName: 'Office / Admin',
          photoUrl: null,
          effectOnAdvance: 0,
          effectOnSalary: amount,
        });
      } else if (entry.type === 'advance_recovery') {
        ledger.push({
          id: entry.id,
          date: entry.created_at,
          type: 'advance_recovery',
          title: 'Advance Recovered from Salary',
          label: 'Advance Recovered',
          amount,
          note: entry.note || 'Settled against salary balance',
          isCash: false,
          supervisorName: 'Adjustment',
          photoUrl: null,
          effectOnAdvance: -amount,
          effectOnSalary: -amount,
        });
      }
    });

    // Online QR Payments (Hisaab)
    (hisaabRecords || []).forEach(h => {
      const onlineAmt = Number(h.online_paid || 0);
      if (onlineAmt > 0) {
        ledger.push({
          id: `hisaab-online-${h.id}`,
          date: h.created_at,
          type: 'salary_payment',
          title: `Online QR Payment (${h.supervisor_name ? `by ${h.supervisor_name}` : 'Supervisor'})`,
          label: 'Online QR Payment',
          amount: onlineAmt,
          note: `Paid online via QR code (${h.from_date || ''} to ${h.to_date || ''})${h.note ? ` • ${h.note}` : ''}`,
          isCash: false,
          supervisorName: h.supervisor_name || 'Supervisor',
          photoUrl: null,
          effectOnAdvance: 0,
          effectOnSalary: -onlineAmt,
          refunded: false,
        });
      }
    });

    // Online Advances (Bank / UPI)
    (onlineAdvances || []).forEach(adv => {
      const amount = Number(adv.amount || 0);
      const isRefunded = !!refundedMap[adv.id];
      const parsed = parseHandoverNote(adv.note);
      const supervisorName = adv.supervisor_name ? `by ${adv.supervisor_name}` : 'Supervisor';

      ledger.push({
        id: `online-adv-${adv.id}`,
        date: adv.created_at,
        type: 'advance_given',
        title: `Online Advance (${supervisorName})`.trim(),
        label: 'Online Advance',
        amount,
        note: parsed.note || 'Paid via Bank/UPI',
        isCash: false,
        supervisorName,
        photoUrl: parsed.photoUrl || adv.photo_url || null,
        effectOnAdvance: isRefunded ? 0 : amount,
        effectOnSalary: 0,
        refunded: isRefunded,
      });
    });

    // Worker Bonuses (Cash & Online)
    (bonuses || []).forEach(b => {
      const amount = Number(b.amount || 0);
      const isRefunded = Boolean(refundedMap[b.id] || (b.cash_tx_id && refundedMap[b.cash_tx_id]));
      const parsed = parseHandoverNote(b.note);
      const supervisorName = b.supervisor_name ? `by ${b.supervisor_name}` : 'Supervisor';
      const isCash = b.payment_method === 'cash';

      ledger.push({
        id: `bonus-${b.id}`,
        date: b.created_at,
        type: 'bonus_given' as any,
        title: `Bonus (${supervisorName})`.trim(),
        label: isCash ? 'Cash Bonus' : 'Online Bonus',
        amount,
        note: parsed.note || (isCash ? 'Bonus Paid in Cash' : 'Paid via Bank/UPI'),
        isCash,
        supervisorName,
        photoUrl: parsed.photoUrl || b.photo_url || null,
        effectOnAdvance: 0, // DOES NOT TOUCH WORKER ADVANCE
        effectOnSalary: 0, // DOES NOT TOUCH WORKER SALARY
        refunded: isRefunded,
      });
    });

    // Sort ascending, calculate running balances, then sort descending
    let runningUnpaid = 0;
    let runningAdv = 0;
    const sortedAsc = ledger.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    for (const entry of sortedAsc) {
      runningUnpaid += (entry.effectOnSalary || 0);
      runningAdv += (entry.effectOnAdvance || 0);
      entry.runningUnpaidSalary = Math.max(0, runningUnpaid);
      entry.runningAdvance = Math.max(0, runningAdv);
      entry.runningNetPayable = entry.runningUnpaidSalary - entry.runningAdvance;
    }

    const finalLedger = sortedAsc.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return {
      worker,
      ledgerEntries: finalLedger,
    };
  } catch (err) {
    console.error('getWorkerFullLedgerAction error:', err);
    return { worker: null, ledgerEntries: [] };
  }
}

/**
 * Fetch all worker disbursement transactions for workers in a factory.
 */
export async function getFactoryWorkerDisbursementsAction(factoryId: string): Promise<any[]> {
  try {
    if (!factoryId) return [];
    const admin = createAdminClient();

    const { data: workers } = await admin
      .from('workers')
      .select('id')
      .eq('factory_id', factoryId)
      .eq('active', true);

    if (!workers || workers.length === 0) return [];
    const workerIds = workers.map(w => w.id);

    const [{ data: txs, error }, onlineAdvances, bonuses] = await Promise.all([
      admin
        .from('cash_transactions')
        .select('id, amount, note, created_at, status, to_worker_id, from_supervisor_id, to_work:to_worker_id(name, active)')
        .eq('type', 'supervisor_to_worker')
        .in('to_worker_id', workerIds)
        .order('created_at', { ascending: false }),
      getWorkerOnlineAdvancesAction(factoryId),
      getWorkerBonusesAction(factoryId),
    ]);

    if (error) {
      console.error('getFactoryWorkerDisbursementsAction error:', error);
      return [];
    }

    const filteredCashTxs = (txs || []).filter(tx => !tx.note?.includes('[TYPE:bonus]'));

    const onlineItems = (onlineAdvances || []).map(adv => ({
      id: `online-adv-${adv.id}`,
      amount: adv.amount,
      note: adv.note || 'Online Advance (Bank/UPI)',
      created_at: adv.created_at,
      status: 'confirmed',
      to_worker_id: adv.worker_id,
      from_supervisor_id: adv.supervisor_id,
      to_work: { name: adv.worker_name, active: true },
      is_online: true,
    }));

    const bonusItems = (bonuses || []).map(b => ({
      id: `bonus-${b.id}`,
      amount: b.amount,
      note: b.note || `Bonus (${b.payment_method === 'online' ? 'Online' : 'Cash'})`,
      created_at: b.created_at,
      status: 'confirmed',
      to_worker_id: b.worker_id,
      from_supervisor_id: b.supervisor_id,
      to_work: { name: b.worker_name, active: true },
      is_online: b.payment_method === 'online',
      is_bonus: true,
    }));

    return [...filteredCashTxs, ...onlineItems, ...bonusItems].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  } catch (err) {
    console.error('getFactoryWorkerDisbursementsAction exception:', err);
    return [];
  }
}

/**
 * Fetch all disbursements for a single worker using admin client.
 */
export async function getWorkerDisbursementsAction(workerId: string): Promise<any[]> {
  try {
    if (!workerId) return [];
    const admin = createAdminClient();

    const [{ data: txs, error }, onlineAdvances, bonuses] = await Promise.all([
      admin
        .from('cash_transactions')
        .select('id, amount, note, created_at, status, to_worker_id, from_supervisor_id')
        .eq('type', 'supervisor_to_worker')
        .eq('to_worker_id', workerId)
        .order('created_at', { ascending: false }),
      getWorkerOnlineAdvancesAction(undefined, workerId),
      getWorkerBonusesAction(undefined, workerId),
    ]);

    if (error) {
      console.error('getWorkerDisbursementsAction error:', error);
      return [];
    }

    const filteredCashTxs = (txs || []).filter(tx => !tx.note?.includes('[TYPE:bonus]'));

    const onlineItems = (onlineAdvances || []).map(adv => ({
      id: `online-adv-${adv.id}`,
      amount: adv.amount,
      note: adv.note || 'Online Advance (Bank/UPI)',
      created_at: adv.created_at,
      status: 'confirmed',
      to_worker_id: adv.worker_id,
      from_supervisor_id: adv.supervisor_id,
      is_online: true,
    }));

    const bonusItems = (bonuses || []).map(b => ({
      id: `bonus-${b.id}`,
      amount: b.amount,
      note: b.note || `Bonus (${b.payment_method === 'online' ? 'Online' : 'Cash'})`,
      created_at: b.created_at,
      status: 'confirmed',
      to_worker_id: b.worker_id,
      from_supervisor_id: b.supervisor_id,
      is_online: b.payment_method === 'online',
      is_bonus: true,
    }));

    return [...filteredCashTxs, ...onlineItems, ...bonusItems].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
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
  openingAdvance: number,
  openingUnpaidSalary: number = 0,
  monthlySalary: number = 0
): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const admin = createAdminClient();
    const id = crypto.randomUUID();

    const insertPayload: any = {
      id,
      factory_id: factoryId,
      supervisor_id: supervisorId,
      name: name.trim(),
      phone: phone?.trim() || null,
      photo_url: photoUrl || null,
      opening_advance: Math.max(0, openingAdvance || 0),
      active: true,
    };

    // Try including extended salary fields
    if (openingUnpaidSalary > 0) insertPayload.opening_unpaid_salary = openingUnpaidSalary;
    if (monthlySalary > 0) insertPayload.monthly_salary = monthlySalary;

    let { error } = await admin.from('workers').insert(insertPayload);

    if (error && error.message.includes('column')) {
      // Fallback if extended columns not migrated yet
      delete insertPayload.opening_unpaid_salary;
      delete insertPayload.monthly_salary;
      const res = await admin.from('workers').insert(insertPayload);
      error = res.error;
    }

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
 */
export async function updateWorkerServer(
  workerId: string,
  name: string,
  phone: string | null,
  photoUrl: string | null
): Promise<{ success: boolean; error?: string }> {
  try {
    const admin = createAdminClient();

    // Check if worker already has a phone number - only admin can modify existing numbers
    const { data: currentWorker } = await admin
      .from('workers')
      .select('phone')
      .eq('id', workerId)
      .single();

    let finalPhone = phone?.trim() || null;
    if (currentWorker?.phone) {
      // Preserve existing locked phone number
      finalPhone = currentWorker.phone;
    } else if (finalPhone) {
      // Adding phone for the first time
      const clean = finalPhone.replace(/[^\d+]/g, '');
      if (clean.length === 10) {
        finalPhone = `+91${clean}`;
      }
    }

    const { error } = await admin
      .from('workers')
      .update({
        name: name.trim(),
        phone: finalPhone,
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
    revalidatePath('/admin/workers');

    return { success: true };
  } catch (err: any) {
    console.error('updateWorkerServer exception:', err);
    return { success: false, error: err.message || 'Failed to update worker.' };
  }
}

/**
 * Update worker details with full Admin authority.
 * Admin can freely change/set phone numbers, profile photos, names, and active status.
 */
export async function adminUpdateWorkerProfileAction(params: {
  workerId: string;
  name: string;
  phone?: string | null;
  photoUrl?: string | null;
  active?: boolean;
}): Promise<{ success: boolean; formattedPhone?: string | null; error?: string }> {
  try {
    const admin = createAdminClient();
    const cleanName = params.name.trim();
    if (!cleanName) return { success: false, error: 'Worker name is required.' };

    let finalPhone: string | null = null;
    if (params.phone !== undefined) {
      if (params.phone && params.phone.trim()) {
        const clean = params.phone.trim().replace(/[^\d+]/g, '');
        if (clean.length === 10) {
          finalPhone = `+91${clean}`;
        } else if (clean.length > 10) {
          finalPhone = clean.startsWith('+') ? clean : `+${clean}`;
        } else {
          return { success: false, error: 'Mobile number must be at least 10 digits.' };
        }
      } else {
        finalPhone = null;
      }
    }

    const updatePayload: Record<string, any> = {
      name: cleanName,
    };
    if (params.phone !== undefined) {
      updatePayload.phone = finalPhone;
    }
    if (params.photoUrl !== undefined) {
      updatePayload.photo_url = params.photoUrl || null;
    }
    if (params.active !== undefined) {
      updatePayload.active = params.active;
    }

    const { error } = await admin
      .from('workers')
      .update(updatePayload)
      .eq('id', params.workerId);

    if (error) {
      console.error('adminUpdateWorkerProfileAction error:', error);
      return { success: false, error: error.message };
    }

    revalidatePath('/admin');
    revalidatePath('/admin/workers');
    revalidatePath('/supervisor');
    revalidatePath('/supervisor/workers');

    return { success: true, formattedPhone: finalPhone };
  } catch (err: any) {
    console.error('adminUpdateWorkerProfileAction exception:', err);
    return { success: false, error: err.message || 'Failed to update worker profile.' };
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
 * Server action to update a worker's mobile number.
 */
export async function updateWorkerPhoneServer(
  workerId: string,
  rawPhone: string
): Promise<{ success: boolean; formattedPhone?: string; error?: string }> {
  try {
    const admin = createAdminClient();

    const { data: currentWorker } = await admin
      .from('workers')
      .select('phone')
      .eq('id', workerId)
      .single();

    if (currentWorker?.phone) {
      return { success: false, error: 'Worker already has a phone number linked. Only admin can modify existing numbers.' };
    }

    const cleanPhone = rawPhone?.trim().replace(/[^\d+]/g, '');
    if (!cleanPhone || cleanPhone.length < 10) {
      return { success: false, error: 'Please enter a valid 10-digit mobile number.' };
    }

    const formattedPhone = cleanPhone.length === 10 ? `+91${cleanPhone}` : cleanPhone;

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
 */
export async function bulkUpdateOpeningAdvancesAction(
  updates: BulkWorkerOpeningAdvanceUpdate[]
): Promise<{ success: boolean; updatedCount: number; error?: string }> {
  try {
    if (!updates || updates.length === 0) {
      return { success: true, updatedCount: 0 };
    }

    const admin = createAdminClient();
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
 * Fetch all transactions associated with a supervisor's account and factory.
 * Includes payment type tagging (advance vs salary_payment) and non-cash salary events.
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

    // 2. Fetch cash transactions, reclassifications, non-cash salary ledger entries, hisaab records, online advances, and bonuses
    const [
      { data: txs, error },
      { data: refundLogs },
      reclassMap,
      salaryEntries,
      hisaabRecords,
      onlineAdvances,
      bonuses,
    ] = await Promise.all([
      admin
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
        .order('created_at', { ascending: false }),
      admin
        .from('audit_log')
        .select('row_id')
        .eq('table_name', 'cash_transactions')
        .eq('action', 'refund'),
      getReclassifiedTransactions(),
      getSalaryLedgerEntries(factoryId),
      getWorkerHisaabRecordsAction(factoryId),
      getWorkerOnlineAdvancesAction(factoryId),
      getWorkerBonusesAction(factoryId),
    ]);

    if (error) {
      console.error('getSupervisorAllTransactionsAction error:', error);
      return { transactions: [], refundedTxIds: [] };
    }

    // 3. Fetch refunded transaction IDs
    const refundedTxIds = new Set<string>((refundLogs || []).map(r => r.row_id));
    (txs || []).forEach(tx => {
      if (tx.type === 'office_to_supervisor' && tx.note) {
        const match = tx.note.match(/\[REFUND:([a-f0-9-]+)\]/);
        if (match && match[1]) {
          refundedTxIds.add(match[1]);
        }
      }
    });

    // 4. Augment cash transactions with calculated payment_type (filter out bonuses handled below)
    const augmentedCashTxs = (txs || [])
      .filter(tx => !tx.note?.includes('[TYPE:bonus]'))
      .map(tx => {
        if (tx.type === 'supervisor_to_worker') {
          const reclass = reclassMap[tx.id];
          const isSalary = reclass === 'salary_payment' || 
            (!reclass && (tx.note?.includes('[TYPE:salary_payment]') || false));
          return {
            ...tx,
            worker_payment_type: isSalary ? 'salary_payment' : 'advance',
          };
        }
        return tx;
      });

    // 5. Convert non-cash salary ledger events to transaction-like items for the unified feed
    // Exclude advance_recovery completely so it NEVER appears in supervisor transaction feed
    const nonCashItems = salaryEntries
      .filter(entry => entry.type !== 'advance_recovery')
      .map(entry => {
        return {
          id: entry.id,
          type: 'salary_ledger_entry',
          worker_payment_type: entry.type, // 'salary_earned'
          amount: entry.amount,
          note: entry.note || `Salary Credited (${entry.period_month || 'Period'})`,
          status: 'confirmed',
          created_at: entry.created_at,
          to_worker_id: entry.worker_id,
          from_supervisor_id: null,
          to_supervisor_id: null,
          is_non_cash: true,
        };
      });

    // 6. Convert Hisaab online QR payments to transaction items for unified feed
    const onlineHisaabItems = (hisaabRecords || [])
      .filter(h => Number(h.online_paid || 0) > 0)
      .map(h => ({
        id: `hisaab-online-${h.id}`,
        type: 'online_qr_payout',
        worker_payment_type: 'online_qr_payment',
        amount: Number(h.online_paid),
        note: `[HISAAB_ONLINE_PAID] Online QR Payment (${h.from_date || ''} to ${h.to_date || ''})${h.note ? ` • ${h.note}` : ''}${h.photo_url ? ` [handover_photo:${h.photo_url}]` : ''}`,
        photo_url: h.photo_url || null,
        status: 'confirmed',
        created_at: h.created_at,
        to_worker_id: h.worker_id,
        to_work: { name: h.worker_name || 'Worker', active: true },
        from_supervisor_id: h.supervisor_id,
        from: { name: h.supervisor_name || 'Supervisor' },
        is_online: true,
      }));

    // 7. Convert Online Advances to transaction items for unified feed
    const onlineAdvanceItems = (onlineAdvances || []).map(adv => {
      const isRefunded = refundedTxIds.has(adv.id);
      return {
        id: `online-adv-${adv.id}`,
        type: 'online_advance',
        worker_payment_type: 'online_advance',
        amount: Number(adv.amount || 0),
        note: adv.note || 'Online Advance (Bank/UPI)',
        status: isRefunded ? 'refunded' : 'confirmed',
        created_at: adv.created_at,
        to_worker_id: adv.worker_id,
        to_work: { name: adv.worker_name || 'Worker', active: true },
        from_supervisor_id: adv.supervisor_id,
        from: { name: adv.supervisor_name || 'Supervisor' },
        is_online: true,
      };
    });

    // 8. Convert Worker Bonuses to transaction items for unified feed
    const bonusItems = (bonuses || []).map(b => {
      const isRefunded = refundedTxIds.has(b.id) || (b.cash_tx_id && refundedTxIds.has(b.cash_tx_id));
      const isOnline = b.payment_method === 'online';
      return {
        id: `bonus-${b.id}`,
        type: 'worker_bonus',
        worker_payment_type: 'bonus',
        amount: Number(b.amount || 0),
        note: b.note || `Worker Bonus (${isOnline ? 'Online' : 'Cash'})`,
        status: isRefunded ? 'refunded' : 'confirmed',
        created_at: b.created_at,
        to_worker_id: b.worker_id,
        to_work: { name: b.worker_name || 'Worker', active: true },
        from_supervisor_id: b.supervisor_id,
        from: { name: b.supervisor_name || 'Supervisor' },
        is_online: isOnline,
        photo_url: b.photo_url,
      };
    });

    const allCombined = [...augmentedCashTxs, ...nonCashItems, ...onlineHisaabItems, ...onlineAdvanceItems, ...bonusItems].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    return {
      transactions: allCombined,
      refundedTxIds: Array.from(refundedTxIds),
    };
  } catch (err) {
    console.error('getSupervisorAllTransactionsAction exception:', err);
    return { transactions: [], refundedTxIds: [] };
  }
}
