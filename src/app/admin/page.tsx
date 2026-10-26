import React from 'react';
import { createServerClient } from '@/lib/supabase/server-client';
import { AdminDashboard } from './admin-dashboard';

export const revalidate = 0; // Disable caching for active dashboard

export default async function AdminDashboardPage() {
  const supabase = createServerClient();

  // Fetch all dashboard data concurrently in parallel
  const [
    { data: factories },
    { data: supervisors },
    { data: transactions },
    { data: expenses },
    { data: workers },
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
      .select('*, from:from_supervisor_id(name), to_sup:to_supervisor_id(name, factory_id), to_work:to_worker_id(name, factory_id)')
      .order('created_at', { ascending: false }),
    supabase
      .from('expenses')
      .select('*, supervisors(name), factories(name)')
      .order('created_at', { ascending: false }),
    supabase
      .from('worker_balances')
      .select('*')
      .order('running_advance', { ascending: false }),
  ]);

  return (
    <AdminDashboard
      factories={factories || []}
      supervisors={supervisors || []}
      transactions={transactions || []}
      expenses={expenses || []}
      workers={workers || []}
    />
  );
}
