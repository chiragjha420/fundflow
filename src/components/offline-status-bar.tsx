'use client';

import React from 'react';
import { useSync } from '@/providers/sync-provider';
import { WifiOff, RefreshCw } from 'lucide-react';

export function OfflineStatusBar() {
  const { isOnline, pendingCount, isSyncing } = useSync();

  if (!isOnline) {
    return (
      <div className="bg-amber-50 border-b border-amber-200 text-amber-900 py-2 px-4 text-sm font-medium flex items-center justify-between transition-all duration-300">
        <div className="flex items-center gap-2">
          <WifiOff className="h-4 w-4 text-amber-700 animate-pulse" />
          <span>Working offline</span>
        </div>
        {pendingCount > 0 && (
          <span className="text-xs bg-amber-200 text-amber-900 px-2 py-0.5 rounded-full">
            {pendingCount} {pendingCount === 1 ? 'transaction' : 'transactions'} pending sync
          </span>
        )}
      </div>
    );
  }

  if (pendingCount > 0 || isSyncing) {
    return (
      <div className="bg-slate-50 border-b border-slate-200 text-slate-700 py-2 px-4 text-sm font-medium flex items-center justify-between transition-all duration-300">
        <div className="flex items-center gap-2">
          <RefreshCw className="h-4 w-4 text-blue-600 animate-spin" />
          <span>Syncing cash ledger with office...</span>
        </div>
        <span className="text-xs bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full">
          {pendingCount} remaining
        </span>
      </div>
    );
  }

  return null;
}
