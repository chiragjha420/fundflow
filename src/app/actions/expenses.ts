'use server';

import { createAdminClient } from '@/lib/supabase/admin-client';
import { revalidatePath } from 'next/cache';
import { parseHandoverNote } from '@/lib/utils';

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
  factories?: { name: string } | null;
  payment_method?: 'cash' | 'online';
}

/**
 * Fetch all factory expenses logged by any supervisor in this factory (or all factories if factoryId is omitted/all).
 * Combines physical cash expenses from expenses table with online bank expenses from audit_log.
 */
export async function getFactoryExpensesAction(factoryId?: string): Promise<FactoryExpense[]> {
  try {
    const admin = createAdminClient();

    // 1. Fetch physical cash expenses from expenses table
    let query = admin
      .from('expenses')
      .select('*, supervisors(name), factories(name)')
      .order('created_at', { ascending: false });

    if (factoryId && factoryId !== 'all') {
      query = query.eq('factory_id', factoryId);
    }

    const [dbRes, auditRes] = await Promise.all([
      query,
      admin
        .from('audit_log')
        .select('*')
        .eq('table_name', 'expenses')
        .eq('action', 'LOG_ONLINE_EXPENSE')
        .order('changed_at', { ascending: false }),
    ]);

    const cashExpenses: FactoryExpense[] = (dbRes.data || []).map((e: any) => {
      let cat = e.category;
      let cleanNote = e.note;
      if (e.note && (e.note.includes('[CATEGORY:') || e.note.includes('[handover_photo:'))) {
        const parsed = parseHandoverNote(e.note);
        if (parsed.category) {
          cat = parsed.category.toLowerCase();
        }
        cleanNote = parsed.note;
      }
      return {
        id: e.id,
        supervisor_id: e.supervisor_id,
        factory_id: e.factory_id,
        amount: Number(e.amount || 0),
        category: cat,
        note: cleanNote,
        photo_url: e.photo_url || null,
        created_at: e.created_at,
        supervisors: e.supervisors || null,
        factories: e.factories || null,
        payment_method: 'cash' as const,
      };
    });

    const onlineExpenses: FactoryExpense[] = (auditRes.data || [])
      .map((r: any) => r.new_data as any)
      .filter((e: any) => {
        if (!e) return false;
        if (factoryId && factoryId !== 'all' && e.factory_id !== factoryId) return false;
        return true;
      })
      .map((e: any) => ({
        id: e.id,
        supervisor_id: e.supervisor_id,
        factory_id: e.factory_id,
        amount: Number(e.amount || 0),
        category: e.category,
        note: e.note,
        photo_url: e.photo_url || null,
        created_at: e.created_at,
        supervisors: e.supervisors || { name: e.supervisor_name || 'Supervisor' },
        factories: e.factories || { name: e.factory_name || '' },
        payment_method: 'online' as const,
      }));

    return [...cashExpenses, ...onlineExpenses].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  } catch (err) {
    console.error('getFactoryExpensesAction exception:', err);
    return [];
  }
}

/**
 * Log an expense paid online from the supervisor's bank account / UPI.
 * - Recorded in audit_log so admin and supervisors see it in factory spends.
 * - Does NOT deduct from the supervisor's physical cash in hand balance (get_supervisor_balance).
 */
export async function logOnlineExpenseAction(params: {
  supervisorId: string;
  factoryId: string;
  amount: number;
  category: string;
  note: string;
  photoUrl: string | null;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const { supervisorId, factoryId, category, photoUrl } = params;
    const cleanAmount = Math.max(1, Math.round(Number(params.amount) || 0));
    const cleanNote = params.note?.trim();

    if (!cleanNote) {
      return { success: false, error: 'Notes/remarks are required for expense entry.' };
    }
    if (cleanAmount <= 0) {
      return { success: false, error: 'Please enter a valid expense amount.' };
    }

    const admin = createAdminClient();
    const id = crypto.randomUUID();

    let supervisorName = 'Supervisor';
    const { data: sup } = await admin.from('supervisors').select('name').eq('id', supervisorId).single();
    if (sup?.name) supervisorName = sup.name;

    let factoryName = '';
    const { data: fact } = await admin.from('factories').select('name').eq('id', factoryId).single();
    if (fact?.name) factoryName = fact.name;

    const payload = {
      id,
      supervisor_id: supervisorId,
      supervisor_name: supervisorName,
      factory_id: factoryId,
      factory_name: factoryName,
      amount: cleanAmount,
      category,
      note: cleanNote,
      photo_url: photoUrl,
      payment_method: 'online',
      created_at: new Date().toISOString(),
      supervisors: { name: supervisorName },
      factories: { name: factoryName },
    };

    await admin.from('audit_log').insert({
      table_name: 'expenses',
      action: 'LOG_ONLINE_EXPENSE',
      row_id: id,
      new_data: payload,
      changed_by: supervisorId,
      changed_at: new Date().toISOString(),
    });

    revalidatePath('/admin');
    revalidatePath('/supervisor');
    revalidatePath('/supervisor/expenses');

    return { success: true, id };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to log online expense.' };
  }
}
