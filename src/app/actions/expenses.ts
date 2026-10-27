'use server';

import { createAdminClient } from '@/lib/supabase/admin-client';

export interface FactoryExpense {
  id: string;
  supervisor_id: string;
  factory_id: string;
  amount: number;
  category: string;
  note: string;
  photo_url: string | null;
  created_at: string;
  supervisors?: { name: string } | null;
}

/**
 * Fetch all factory expenses logged by any supervisor in this factory.
 * Enables co-supervisors (e.g. Deepak Bhai & Deepu Bhai, Ankit Bhai & Sanju Bhai)
 * to see the shared factory expense registry and receipts.
 */
export async function getFactoryExpensesAction(factoryId: string): Promise<FactoryExpense[]> {
  try {
    if (!factoryId) return [];
    const admin = createAdminClient();

    const { data, error } = await admin
      .from('expenses')
      .select('*, supervisors(name)')
      .eq('factory_id', factoryId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('getFactoryExpensesAction error:', error);
      return [];
    }

    return (data || []) as FactoryExpense[];
  } catch (err) {
    console.error('getFactoryExpensesAction exception:', err);
    return [];
  }
}
