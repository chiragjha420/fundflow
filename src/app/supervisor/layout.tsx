'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { createBrowserClient } from '@/lib/supabase/browser-client';
import { logout } from '@/app/actions/auth';
import { OfflineStatusBar } from '@/components/offline-status-bar';
import { formatINR } from '@/lib/utils';
import { LogOut, Home, Users, Receipt, ArrowLeftRight } from 'lucide-react';
import { getOfflineCache, setOfflineCache } from '@/lib/offline-db';

export default function SupervisorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createBrowserClient();

  // 1. Fetch Supervisor details (with local IndexedDB cache fallback)
  const { data: supervisor, isLoading: isSupLoading, error: supError } = useQuery({
    queryKey: ['supervisor-info'],
    queryFn: async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not authenticated');

        const { data, error } = await supabase
          .from('supervisors')
          .select('id, name, factory_id, factories(name)')
          .eq('user_id', user.id)
          .single();

        if (error) throw error;
        
        // Store in cache for offline
        await setOfflineCache('supervisor-info', data);
        return data;
      } catch (e) {
        console.warn('Layout: Network query failed, trying local cache for supervisor info:', e);
        const cached = await getOfflineCache<any>('supervisor-info');
        if (cached) return cached;
        throw e;
      }
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  // Local state for cached offline supervisor info if React Query hasn't resolved it
  const [cachedSup, setCachedSup] = React.useState<any>(null);
  const [currentUserEmail, setCurrentUserEmail] = React.useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUserEmail(user.email || null);
    });
  }, [supabase]);

  useEffect(() => {
    getOfflineCache('supervisor-info').then(data => {
      if (data) setCachedSup(data);
    });
  }, [supervisor]);

  const activeSup = supervisor || cachedSup;

  // 2. Fetch Supervisor Balance (with local IndexedDB cache fallback)
  const { data: balanceData, isLoading: isBalanceLoading } = useQuery({
    queryKey: ['supervisor-balance', activeSup?.id],
    queryFn: async () => {
      if (!activeSup?.id) return 0;
      const { data, error } = await supabase.rpc('get_supervisor_balance', {
        sub_id: activeSup.id,
      });
      if (error) throw error;
      
      await setOfflineCache(`balance-${activeSup.id}`, data);
      return data as number;
    },
    enabled: !!activeSup?.id,
  });

  const [cachedBalance, setCachedBalance] = React.useState<number | null>(null);
  useEffect(() => {
    if (activeSup?.id) {
      getOfflineCache<number>(`balance-${activeSup.id}`).then(data => {
        if (data !== null) setCachedBalance(data);
      });
    }
  }, [activeSup?.id, balanceData]);

  const balance = balanceData !== undefined ? balanceData : (cachedBalance || 0);

  return (
    <div className="min-h-full flex flex-col bg-slate-50">
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-sm">
        <OfflineStatusBar />
        <div className="px-4 py-3 flex flex-col gap-2">
          {/* Logo & Logout Row */}
          <div className="flex justify-between items-center">
            <div className="flex items-center">
              <span className="font-black text-lg text-slate-900 tracking-tight">
                JBB <span className="text-emerald-600 font-bold">FundFlow</span>
              </span>
            </div>
            
            <form action={logout}>
              <button
                type="submit"
                className="flex items-center justify-center h-10 w-10 text-slate-500 hover:text-slate-900 hover:bg-slate-50 rounded-md border border-slate-200 min-h-[44px] min-w-[44px]"
              >
                <LogOut className="h-5 w-5" />
              </button>
            </form>
          </div>

          {/* Supervisor Information and Balance Card */}
          <div className="bg-slate-900 text-white rounded-lg p-4 mt-1 shadow-md">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs text-slate-400 font-medium">Supervisor</p>
                <h2 className="text-base font-bold leading-tight">
                  {isSupLoading && !activeSup ? (
                    <span className="inline-block bg-slate-800 animate-pulse h-4 w-32 rounded"></span>
                  ) : supError ? (
                    `Not Found (Unassigned: ${currentUserEmail || '...'})`
                  ) : (
                    activeSup?.name || 'Loading...'
                  )}
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {isSupLoading && !activeSup ? (
                    <span className="inline-block bg-slate-800 animate-pulse h-3 w-40 rounded"></span>
                  ) : supError ? (
                    'Please contact admin to link account'
                  ) : (
                    activeSup?.factories?.name || 'Loading Factory...'
                  )}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-400 font-medium">Available Cash</p>
                <h3 className="text-xl font-black text-emerald-400 mt-0.5">
                  {isBalanceLoading && balanceData === undefined ? (
                    <span className="inline-block bg-slate-800 animate-pulse h-6 w-24 rounded"></span>
                  ) : (
                    formatINR(balance)
                  )}
                </h3>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Single Column for touch screen mobile layout */}
      <main className="flex-1 py-4 px-4 max-w-lg mx-auto w-full pb-20">
        {children}
      </main>

      {/* Mobile Footer Sticky Tab Bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-slate-200 flex h-16 shadow-lg">
        <Link
          href="/supervisor"
          className="flex-1 flex flex-col items-center justify-center text-slate-600 hover:text-slate-900 border-r border-slate-100 min-h-[44px]"
        >
          <Home className="h-5 w-5" />
          <span className="text-[10px] font-semibold mt-1">Dashboard</span>
        </Link>
        <Link
          href="/supervisor/workers"
          className="flex-1 flex flex-col items-center justify-center text-slate-600 hover:text-slate-900 border-r border-slate-100 min-h-[44px]"
        >
          <Users className="h-5 w-5" />
          <span className="text-[10px] font-semibold mt-1">Workers</span>
        </Link>
        <Link
          href="/supervisor/expenses"
          className="flex-1 flex flex-col items-center justify-center text-slate-600 hover:text-slate-900 border-r border-slate-100 min-h-[44px]"
        >
          <Receipt className="h-5 w-5" />
          <span className="text-[10px] font-semibold mt-1">Expenses</span>
        </Link>
        <Link
          href="/supervisor/transfers"
          className="flex-1 flex flex-col items-center justify-center text-slate-600 hover:text-slate-900 min-h-[44px]"
        >
          <ArrowLeftRight className="h-5 w-5" />
          <span className="text-[10px] font-semibold mt-1">Transfers</span>
        </Link>
      </nav>
    </div>
  );
}
