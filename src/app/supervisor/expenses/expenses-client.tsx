'use client';

import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createBrowserClient } from '@/lib/supabase/browser-client';
import { getOfflineCache, setOfflineCache } from '@/lib/offline-db';
import { formatINR } from '@/lib/utils';
import { 
  Search, 
  IndianRupee, 
  Calendar, 
  X, 
  RefreshCw,
  Eye
} from 'lucide-react';

interface Expense {
  id: string;
  supervisor_id: string;
  factory_id: string;
  amount: number;
  category: string;
  note: string;
  photo_url: string | null;
  created_at: string;
}

export function SupervisorExpensesClientPage() {
  const supabase = createBrowserClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);

  // 1. Get Supervisor Info to find supervisorId
  const { data: supervisor } = useQuery({
    queryKey: ['supervisor-info'],
    queryFn: async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not authenticated');

        const { data, error } = await supabase
          .from('supervisors')
          .select('id, name, factory_id')
          .eq('user_id', user.id)
          .single();

        if (error) throw error;
        await setOfflineCache('supervisor-info', data);
        return data;
      } catch (e) {
        console.warn('Expenses page: Network query failed, trying local cache for supervisor info:', e);
        const cached = await getOfflineCache<any>('supervisor-info');
        if (cached) return cached;
        throw e;
      }
    },
    staleTime: 5 * 60 * 1000,
  });

  const supervisorId = supervisor?.id;

  // 2. Fetch Expenses list
  const { data: expenses, isLoading } = useQuery({
    queryKey: ['supervisor-expenses', supervisorId],
    queryFn: async () => {
      if (!supervisorId) return [];
      const { data, error } = await supabase
        .from('expenses')
        .select('*')
        .eq('supervisor_id', supervisorId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      await setOfflineCache(`expenses-${supervisorId}`, data);
      return data as Expense[];
    },
    enabled: !!supervisorId,
  });

  const [cachedExpenses, setCachedExpenses] = useState<Expense[]>([]);
  useEffect(() => {
    if (supervisorId) {
      getOfflineCache<Expense[]>(`expenses-${supervisorId}`).then(data => {
        if (data) setCachedExpenses(data);
      });
    }
  }, [supervisorId, expenses]);

  const activeExpenses = expenses !== undefined ? expenses : cachedExpenses;

  const filteredExpenses = activeExpenses.filter(exp => 
    exp.category.toLowerCase().includes(searchQuery.toLowerCase()) || 
    (exp.note && exp.note.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Logged Expenses Log</h1>
        <p className="text-xs text-slate-500 mt-0.5">View your previously submitted expenses and receipts.</p>
      </div>

      {/* Expenses List Panel */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
        {/* Search */}
        <div className="p-3 bg-white border-b border-slate-200 flex items-center relative">
          <Search className="absolute left-6 h-4 w-4 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search expenses by category or description..."
            className="w-full pl-9 pr-3 py-2 rounded border border-slate-300 text-xs focus:ring-slate-500 focus:border-slate-500 text-slate-950 min-h-[44px]"
          />
        </div>

        {/* Expenses List */}
        {isLoading && activeExpenses.length === 0 ? (
          <div className="p-8 text-center">
            <RefreshCw className="h-6 w-6 animate-spin text-slate-400 mx-auto" />
            <p className="text-xs text-slate-500 mt-2">Loading expense history...</p>
          </div>
        ) : filteredExpenses.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No expenses found.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 bg-white">
            {filteredExpenses.map((exp) => (
              <li key={exp.id} className="p-4 flex flex-col gap-3 hover:bg-slate-50">
                <div className="flex items-start justify-between">
                  <div className="flex gap-3">
                    <div className="h-10 w-10 rounded-lg bg-red-50 border border-red-100 flex items-center justify-center text-red-500 shrink-0">
                      <IndianRupee className="h-5 w-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-extrabold text-slate-900 uppercase tracking-wide">{exp.category}</h4>
                      <p className="text-xs text-slate-600 mt-0.5">{exp.note || 'No description provided'}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-slate-400 block font-semibold uppercase tracking-wider">Amount</span>
                    <span className="text-sm font-black text-red-600">{formatINR(exp.amount)}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[10px] text-slate-400 border-t border-slate-100/50 pt-2">
                  <div className="flex items-center gap-1 font-semibold">
                    <Calendar className="h-3 w-3 text-slate-400" />
                    <span>
                      {new Date(exp.created_at).toLocaleDateString(undefined, { 
                        day: 'numeric', 
                        month: 'short', 
                        year: 'numeric' 
                      })}
                    </span>
                  </div>

                  {exp.photo_url ? (
                    <button
                      onClick={() => setSelectedPhoto(exp.photo_url)}
                      className="flex items-center gap-1 font-black text-emerald-600 hover:text-emerald-700 min-h-[30px]"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      <span>View Receipt</span>
                    </button>
                  ) : (
                    <span className="text-slate-400 italic">No receipt attached</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Full Photo Modal Overlay */}
      {selectedPhoto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm">
          <div className="bg-white rounded-lg overflow-hidden border border-slate-200 shadow-2xl max-w-md w-full relative flex flex-col">
            <button
              onClick={() => setSelectedPhoto(null)}
              className="absolute top-3 right-3 z-10 bg-slate-900/50 hover:bg-slate-900/80 text-white rounded-full p-2 min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="relative w-full aspect-square bg-slate-950 flex items-center justify-center">
              <img 
                src={selectedPhoto} 
                alt="Receipt receipt attachment" 
                className="max-h-full max-w-full object-contain"
              />
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-200 text-center">
              <p className="text-xs font-semibold text-slate-500">Expense Receipt Document</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
