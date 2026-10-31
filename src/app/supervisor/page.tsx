import React from 'react';
import { createServerClient } from '@/lib/supabase/server-client';
import { createAdminClient } from '@/lib/supabase/admin-client';
import { getSupervisorAllTransactionsAction } from '@/app/actions/workers';
import { SupervisorClientPage } from './supervisor-client';

export const revalidate = 0; // Live real-time dashboard data on navigation

export default async function SupervisorDashboardPage() {
  const supabase = createServerClient();
  const adminSupabase = createAdminClient();
  
  let initialSupervisor: any = null;
  let initialWorkers: any[] = [];
  let initialPendingTxs: any[] = [];
  let initialOtherSupervisors: any[] = [];
  let initialExpenses: any[] = [];
  let initialAllTransactions: { transactions: any[]; refundedTxIds: string[] } = { transactions: [], refundedTxIds: [] };

  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;

    if (userId) {
      // 1. Fetch Supervisor Profile
      const { data: sup } = await supabase
        .from('supervisors')
        .select('id, name, factory_id, factories(name)')
        .eq('user_id', userId)
        .single();

      if (sup) {
        initialSupervisor = sup;

        // 2. Fetch Workers (via Admin to unify co-supervisors), Pending Receipts, Other Supervisors, Expenses, and All Transactions
        const [workersRes, pendingRes, otherSupsRes, expensesRes, allTxsRes] = await Promise.all([
          adminSupabase
            .from('worker_balances')
            .select('*')
            .eq('factory_id', sup.factory_id)
            .eq('active', true),
          supabase
            .from('cash_transactions')
            .select('id, type, amount, note, created_at, from:from_supervisor_id(name)')
            .eq('to_supervisor_id', sup.id)
            .eq('status', 'pending'),
          supabase
            .from('supervisors')
            .select('id, name, factory_id, active, factories(name)')
            .eq('active', true),
          adminSupabase
            .from('expenses')
            .select('*, supervisors(name)')
            .eq('factory_id', sup.factory_id)
            .order('created_at', { ascending: false })
            .limit(50),
          getSupervisorAllTransactionsAction(sup.id, sup.factory_id),
        ]);

        initialWorkers = (workersRes.data || []).filter((w: any) => w.active && w.worker_name !== 'Deleted Worker');
        initialPendingTxs = pendingRes.data || [];
        initialOtherSupervisors = otherSupsRes.data || [];
        initialExpenses = expensesRes.data || [];
        initialAllTransactions = allTxsRes || { transactions: [], refundedTxIds: [] };
      }
    }
  } catch (e) {
    console.warn('Server prefetch error for supervisor dashboard:', e);
  }

  return (
    <SupervisorClientPage
      initialData={{
        supervisor: initialSupervisor,
        workers: initialWorkers,
        pendingTxs: initialPendingTxs,
        otherSupervisors: initialOtherSupervisors,
        expenses: initialExpenses,
        allTransactions: initialAllTransactions,
      }}
    />
  );
}
