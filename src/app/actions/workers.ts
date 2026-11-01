'use server';

import { createAdminClient } from '@/lib/supabase/admin-client';
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

    // 2. Fetch all confirmed worker cash transactions, refunds, reclassifications, and salary ledger entries in parallel
    const [
      { data: cashTxs },
      { data: refundLogs },
      { data: refundNotes },
      reclassMap,
      salaryLedgerEntries,
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
    ]);

    // Build refund set
    const refundedTxIds = new Set<string>((refundLogs || []).map(r => r.row_id));
    (refundNotes || []).forEach(tx => {
      const match = tx.note?.match(/\[REFUND:([a-f0-9-]+)\]/);
      if (match && match[1]) refundedTxIds.add(match[1]);
    });

    // Aggregations per worker
    const workerAdvanceGiven: Record<string, number> = {};
    const workerSalaryPaid: Record<string, number> = {};
    const workerSalaryEarned: Record<string, number> = {};
    const workerAdvanceRecovered: Record<string, number> = {};

    // Process Cash Disbursements
    (cashTxs || []).forEach(tx => {
      if (!tx.to_worker_id || !workerIdSet.has(tx.to_worker_id)) return;
      if (refundedTxIds.has(tx.id)) return; // Exclude refunded

      const amount = Number(tx.amount || 0);
      const reclass = reclassMap[tx.id];

      // Check if this cash disbursement is a salary payment or advance
      const isSalaryPayment = reclass === 'salary_payment' || 
        (!reclass && (tx.note?.includes('[TYPE:salary_payment]') || false));

      if (isSalaryPayment) {
        workerSalaryPaid[tx.to_worker_id] = (workerSalaryPaid[tx.to_worker_id] || 0) + amount;
      } else {
        workerAdvanceGiven[tx.to_worker_id] = (workerAdvanceGiven[tx.to_worker_id] || 0) + amount;
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

      const advGiven = workerAdvanceGiven[w.id] || 0;
      const advRecovered = workerAdvanceRecovered[w.id] || 0;
      const salEarned = (workerSalaryEarned[w.id] || 0) + openingUnpaid;
      const salPaid = workerSalaryPaid[w.id] || 0;

      const totalAdvanceGiven = openingAdv + advGiven;
      const totalAdvanceRecovered = advRecovered;
      const runningAdvance = Math.max(0, totalAdvanceGiven - totalAdvanceRecovered);

      const totalSalaryEarned = salEarned;
      const totalSalaryPaid = salPaid;
      const unpaidSalary = Math.max(0, totalSalaryEarned - totalSalaryPaid - totalAdvanceRecovered);
      const netPayable = unpaidSalary - runningAdvance;
      const totalCashDisbursed = advGiven + salPaid;

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

    // 2. Fetch cash transactions, reclassifications, and non-cash salary ledger entries
    const [
      { data: txs, error },
      { data: refundLogs },
      reclassMap,
      salaryEntries,
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

    // 4. Augment cash transactions with calculated payment_type
    const augmentedCashTxs = (txs || []).map(tx => {
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
    const nonCashItems = salaryEntries.map(entry => {
      return {
        id: entry.id,
        type: 'salary_ledger_entry',
        worker_payment_type: entry.type, // 'salary_earned' | 'advance_recovery'
        amount: entry.amount,
        note: entry.note || (entry.type === 'salary_earned' ? `Salary Credited (${entry.period_month || 'Period'})` : 'Advance recovered from salary'),
        status: 'confirmed',
        created_at: entry.created_at,
        to_worker_id: entry.worker_id,
        from_supervisor_id: null,
        to_supervisor_id: null,
        is_non_cash: true,
      };
    });

    const allCombined = [...augmentedCashTxs, ...nonCashItems].sort(
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
