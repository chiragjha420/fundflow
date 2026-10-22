import React from 'react';
import { createServerClient } from '@/lib/supabase/server-client';
import { SupervisorClientPage } from './supervisor-client';

export const revalidate = 0; // Live real-time dashboard data on navigation

export default async function SupervisorDashboardPage() {
  const supabase = createServerClient();
  
  let initialSupervisor: any = null;
  let initialWorkers: any[] = [];
  let initialPendingTxs: any[] = [];
  let initialOtherSupervisors: any[] = [];

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

        // 2. Fetch Workers, Pending Receipts, and Other Supervisors in Parallel
        const [workersRes, pendingRes, otherSupsRes] = await Promise.all([
          supabase
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
        ]);

        initialWorkers = workersRes.data || [];
        initialPendingTxs = pendingRes.data || [];
        initialOtherSupervisors = otherSupsRes.data || [];
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
      }}
    />
  );
}
