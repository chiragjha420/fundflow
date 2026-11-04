import React from 'react';
import { createServerClient } from '@/lib/supabase/server-client';
import { 
  getAllWorkersWithSalaryBalancesAction, 
  getSalaryLedgerEntries, 
  getWorkerHisaabRecordsAction, 
  getWorkerOnlineAdvancesAction,
  getWorkerBonusesAction
} from '@/app/actions/workers';
import { getRefundedTransactionsAction } from '@/app/actions/admin';
import { AdminWorkersClient } from './admin-workers-client';

export const revalidate = 0;

export default async function AdminWorkersPage() {
  const supabase = createServerClient();

  const [
    { data: factories },
    { data: supervisors },
    { data: rawTransactions },
    workers,
    refundedTransactions,
    salaryLedgerEntries,
    hisaabRecords,
    onlineAdvances,
    bonuses,
  ] = await Promise.all([
    supabase
      .from('factories')
      .select('*')
      .order('name'),
    supabase
      .from('supervisors')
      .select('id, name, factory_id, active, factories(name)')
      .order('name'),
    supabase
      .from('cash_transactions')
      .select('id, type, amount, note, status, created_at, from_supervisor_id, to_worker_id, from:from_supervisor_id(name), to_work:to_worker_id(name, factory_id)')
      .eq('type', 'supervisor_to_worker')
      .order('created_at', { ascending: false }),
    getAllWorkersWithSalaryBalancesAction(),
    getRefundedTransactionsAction(),
    getSalaryLedgerEntries(),
    getWorkerHisaabRecordsAction(),
    getWorkerOnlineAdvancesAction(),
    getWorkerBonusesAction(),
  ]);

  return (
    <AdminWorkersClient
      factories={factories || []}
      supervisors={supervisors || []}
      workers={workers || []}
      transactions={rawTransactions || []}
      refundedTransactions={refundedTransactions || {}}
      salaryLedgerEntries={salaryLedgerEntries || []}
      hisaabRecords={hisaabRecords || []}
      onlineAdvances={onlineAdvances || []}
      bonuses={bonuses || []}
    />
  );
}
