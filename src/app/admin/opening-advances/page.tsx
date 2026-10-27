import React from 'react';
import { createServerClient } from '@/lib/supabase/server-client';
import { createAdminClient } from '@/lib/supabase/admin-client';
import { OpeningAdvancesClient } from './opening-advances-client';

export const revalidate = 0; // Live real-time admin view

export default async function OpeningAdvancesAdminPage() {
  const supabase = createServerClient();
  const adminSupabase = createAdminClient();

  const [
    { data: factories },
    { data: workers }
  ] = await Promise.all([
    supabase
      .from('factories')
      .select('id, name')
      .order('name'),
    adminSupabase
      .from('worker_balances')
      .select('*')
      .eq('active', true)
      .order('worker_name', { ascending: true }),
  ]);

  const activeWorkers = (workers || []).filter(
    (w: any) => w.active && w.worker_name !== 'Deleted Worker'
  );

  return (
    <OpeningAdvancesClient
      factories={factories || []}
      initialWorkers={activeWorkers}
    />
  );
}
