'use client';

import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createBrowserClient } from '@/lib/supabase/browser-client';
import { getOfflineCache, setOfflineCache } from '@/lib/offline-db';
import { formatINR } from '@/lib/utils';
import { 
  Search, 
  Calendar, 
  RefreshCw,
  ArrowUpRight,
  ArrowDownLeft
} from 'lucide-react';

interface Transfer {
  id: string;
  type: string;
  from_supervisor_id: string | null;
  to_supervisor_id: string | null;
  amount: number;
  status: string;
  note: string | null;
  created_at: string;
  from?: { name: string } | null;
  to?: { name: string } | null;
}

export function SupervisorTransfersClientPage() {
  const supabase = createBrowserClient();
  const [searchQuery, setSearchQuery] = useState('');

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
        console.warn('Transfers page: Network query failed, trying local cache for supervisor info:', e);
        const cached = await getOfflineCache<any>('supervisor-info');
        if (cached) return cached;
        throw e;
      }
    },
    staleTime: 5 * 60 * 1000,
  });

  const supervisorId = supervisor?.id;

  // 2. Fetch Transfers list (S2S transfers involving this supervisor)
  const { data: transfers, isLoading } = useQuery({
    queryKey: ['supervisor-transfers-history', supervisorId],
    queryFn: async () => {
      if (!supervisorId) return [];
      const { data, error } = await supabase
        .from('cash_transactions')
        .select(`
          id,
          type,
          from_supervisor_id,
          to_supervisor_id,
          amount,
          status,
          note,
          created_at,
          from:from_supervisor_id(name),
          to:to_supervisor_id(name)
        `)
        .eq('type', 'supervisor_to_supervisor')
        .or(`from_supervisor_id.eq.${supervisorId},to_supervisor_id.eq.${supervisorId}`)
        .order('created_at', { ascending: false });

      if (error) throw error;
      await setOfflineCache(`transfers-${supervisorId}`, data);
      return data as unknown as Transfer[];
    },
    enabled: !!supervisorId,
  });

  const [cachedTransfers, setCachedTransfers] = useState<Transfer[]>([]);
  useEffect(() => {
    if (supervisorId) {
      getOfflineCache<Transfer[]>(`transfers-${supervisorId}`).then(data => {
        if (data) setCachedTransfers(data);
      });
    }
  }, [supervisorId, transfers]);

  const activeTransfers = transfers !== undefined ? transfers : cachedTransfers;

  const filteredTransfers = activeTransfers.filter(tx => {
    const fromName = tx.from?.name || '';
    const toName = tx.to?.name || '';
    const note = tx.note || '';
    return (
      fromName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      toName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      note.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Supervisor Cash Transfers</h1>
        <p className="text-xs text-slate-500 mt-0.5">View incoming and outgoing transfers to other supervisors.</p>
      </div>

      {/* Transfers List Panel */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
        {/* Search */}
        <div className="p-3 bg-white border-b border-slate-200 flex items-center relative">
          <Search className="absolute left-6 h-4 w-4 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search transfers by supervisor name or note..."
            className="w-full pl-9 pr-3 py-2 rounded border border-slate-300 text-xs focus:ring-slate-500 focus:border-slate-500 text-slate-950 min-h-[44px]"
          />
        </div>

        {/* Transfers List */}
        {isLoading && activeTransfers.length === 0 ? (
          <div className="p-8 text-center">
            <RefreshCw className="h-6 w-6 animate-spin text-slate-400 mx-auto" />
            <p className="text-xs text-slate-500 mt-2">Loading transfer logs...</p>
          </div>
        ) : filteredTransfers.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No transfers recorded yet.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 bg-white">
            {filteredTransfers.map((tx) => {
              const isOutgoing = tx.from_supervisor_id === supervisorId;
              const otherSupervisorName = isOutgoing ? tx.to?.name || 'Supervisor' : tx.from?.name || 'Supervisor';
              
              return (
                <li key={tx.id} className="p-4 flex flex-col gap-3 hover:bg-slate-50">
                  <div className="flex items-start justify-between">
                    <div className="flex gap-3">
                      <div className={`h-10 w-10 rounded-lg flex items-center justify-center border shrink-0 ${
                        isOutgoing 
                          ? 'bg-amber-50 border-amber-100 text-amber-600' 
                          : 'bg-emerald-50 border-emerald-100 text-emerald-600'
                      }`}>
                        {isOutgoing ? (
                          <ArrowUpRight className="h-5 w-5" />
                        ) : (
                          <ArrowDownLeft className="h-5 w-5" />
                        )}
                      </div>
                      <div>
                        <h4 className="text-sm font-extrabold text-slate-900">
                          {isOutgoing ? 'Transferred Out' : 'Received Transfer'}
                        </h4>
                        <p className="text-xs text-slate-600 mt-0.5">
                          {isOutgoing ? 'To: ' : 'From: '}
                          <span className="font-bold text-slate-900">{otherSupervisorName}</span>
                        </p>
                        {tx.note && <p className="text-xs text-slate-500 italic mt-1 bg-slate-50 border border-slate-100 rounded px-1.5 py-0.5">"{tx.note}"</p>}
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-xs text-slate-400 block font-semibold uppercase tracking-wider">Amount</span>
                      <span className={`text-sm font-black ${
                        isOutgoing ? 'text-red-600' : 'text-emerald-600'
                      }`}>
                        {isOutgoing ? '-' : '+'}{formatINR(tx.amount)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-slate-400 border-t border-slate-100/50 pt-2">
                    <div className="flex items-center gap-1 font-semibold">
                      <Calendar className="h-3 w-3 text-slate-400" />
                      <span>
                        {new Date(tx.created_at).toLocaleDateString(undefined, { 
                          day: 'numeric', 
                          month: 'short', 
                          year: 'numeric' 
                        })}
                      </span>
                    </div>
                    
                    <div>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold border ${
                        tx.status === 'confirmed'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : tx.status === 'disputed'
                          ? 'bg-red-50 text-red-700 border-red-200'
                          : 'bg-amber-50 text-amber-700 border-amber-200 animate-pulse'
                      }`}>
                        {tx.status.toUpperCase()}
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
