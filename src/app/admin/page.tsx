import React from 'react';
import { createServerClient } from '@/lib/supabase/server-client';
import { AdminDashboard } from './admin-dashboard';
import { getRefundedTransactionsAction } from '@/app/actions/admin';
import { 
  getAllWorkersWithSalaryBalancesAction, 
  getSalaryLedgerEntries, 
  getWorkerHisaabRecordsAction, 
  getWorkerOnlineAdvancesAction,
  getWorkerBonusesAction
} from '@/app/actions/workers';
import { getFactoryExpensesAction } from '@/app/actions/expenses';

export const revalidate = 0; // Disable caching for active dashboard

export default async function AdminDashboardPage() {
  const supabase = createServerClient();

  // Fetch all dashboard data concurrently in parallel
  const [
    { data: factories },
    { data: supervisors },
    { data: transactions },
    expenses,
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
      .select('*, factories(name)')
      .order('name'),
    supabase
      .from('cash_transactions')
      .select('*, from:from_supervisor_id(name), to_sup:to_supervisor_id(name, factory_id), to_work:to_worker_id(name, factory_id, active)')
      .order('created_at', { ascending: false }),
    getFactoryExpensesAction(),
    getAllWorkersWithSalaryBalancesAction(),
    getRefundedTransactionsAction(),
    getSalaryLedgerEntries(),
    getWorkerHisaabRecordsAction(),
    getWorkerOnlineAdvancesAction(),
    getWorkerBonusesAction(),
  ]);

  return (
    <AdminDashboard
      factories={factories || []}
      supervisors={supervisors || []}
      transactions={transactions || []}
      expenses={expenses || []}
      workers={workers || []}
      refundedTransactions={refundedTransactions || {}}
      salaryLedgerEntries={salaryLedgerEntries || []}
      hisaabRecords={hisaabRecords || []}
      onlineAdvances={onlineAdvances || []}
      bonuses={bonuses || []}
    />
  );
}
