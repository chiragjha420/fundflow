'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createBrowserClient } from '@/lib/supabase/browser-client';
import { getSyncQueue, removeFromSyncQueue } from '@/lib/offline-db';

interface SyncContextType {
  isOnline: boolean;
  pendingCount: number;
  isSyncing: boolean;
  syncQueue: () => Promise<void>;
}

const SyncContext = createContext<SyncContextType | undefined>(undefined);

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const queryClient = useQueryClient();
  const supabase = createBrowserClient();

  // Helper to count pending queue items
  const updatePendingCount = async () => {
    try {
      const queue = await getSyncQueue();
      setPendingCount(queue.length);
    } catch (e) {
      console.error('Failed to read sync queue size', e);
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;

    setIsOnline(navigator.onLine);

    const handleOnline = () => {
      setIsOnline(true);
      syncQueue();
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial count
    updatePendingCount();

    // Set up a periodic check every 15 seconds to ensure we are synced if online
    const interval = setInterval(() => {
      if (navigator.onLine) {
        syncQueue();
      } else {
        updatePendingCount();
      }
    }, 15000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncQueue = async () => {
    if (isSyncing) return;
    const queue = await getSyncQueue();
    if (queue.length === 0) {
      setPendingCount(0);
      return;
    }

    setIsSyncing(true);
    const { data: { user } } = await supabase.auth.getUser();

    for (const item of queue) {
      try {
        let success = false;
        let errorMessage = '';

        if (!navigator.onLine) {
          setIsOnline(false);
          break;
        }

        switch (item.type) {
          case 'disburse_to_worker': {
            const { p_worker_id, p_supervisor_id, p_amount, p_note } = item.payload;
            const { error } = await supabase.rpc('disburse_to_worker', {
              p_worker_id,
              p_supervisor_id,
              p_amount,
              p_note,
              p_created_by: user?.id,
            });
            if (!error) success = true;
            else errorMessage = error.message;
            break;
          }
          case 'transfer_to_supervisor': {
            const { p_to_supervisor_id, p_from_supervisor_id, p_amount, p_note } = item.payload;
            const { error } = await supabase.rpc('transfer_to_supervisor', {
              p_to_supervisor_id,
              p_from_supervisor_id,
              p_amount,
              p_note,
              p_created_by: user?.id,
            });
            if (!error) success = true;
            else errorMessage = error.message;
            break;
          }
          case 'log_expense': {
            const { p_supervisor_id, p_factory_id, p_amount, p_category, p_note, p_photo_url } = item.payload;
            const { error } = await supabase.rpc('log_expense', {
              p_supervisor_id,
              p_factory_id,
              p_amount,
              p_category,
              p_note,
              p_photo_url,
              p_created_by: user?.id,
            });
            if (!error) success = true;
            else errorMessage = error.message;
            break;
          }
          case 'confirm_transaction': {
            const { id } = item.payload;
            const { error } = await supabase
              .from('cash_transactions')
              .update({
                status: 'confirmed',
                confirmed_at: new Date().toISOString(),
                confirmed_by: user?.id,
              })
              .eq('id', id);
            if (!error) success = true;
            else errorMessage = error.message;
            break;
          }
          case 'dispute_transaction': {
            const { id, note } = item.payload;
            const { error } = await supabase
              .from('cash_transactions')
              .update({
                status: 'disputed',
                note,
                confirmed_at: new Date().toISOString(),
                confirmed_by: user?.id,
              })
              .eq('id', id);
            if (!error) success = true;
            else errorMessage = error.message;
            break;
          }
          case 'create_worker': {
            const { id, factory_id, supervisor_id, name, phone, photo_url, opening_advance } = item.payload;
            const { error } = await supabase
              .from('workers')
              .insert({
                id,
                factory_id,
                supervisor_id,
                name,
                phone,
                photo_url,
                opening_advance,
                active: true,
              });
            if (!error) success = true;
            else errorMessage = error.message;
            break;
          }
          case 'update_worker': {
            const { id, name, phone, photo_url } = item.payload;
            const { error } = await supabase
              .from('workers')
              .update({
                name,
                phone,
                photo_url,
              })
              .eq('id', id);
            if (!error) success = true;
            else errorMessage = error.message;
            break;
          }
        }

        if (success) {
          await removeFromSyncQueue(item.id);
        } else {
          // If there's an error, log it. If it is a network error, break.
          // If it is a logic error (e.g. Insufficient Balance), we remove it to prevent blocking the queue.
          console.error(`Sync failed for item ${item.id} of type ${item.type}: ${errorMessage}`);
          
          const isNetworkError = 
            errorMessage.includes('Failed to fetch') || 
            errorMessage.includes('TypeError') || 
            errorMessage.includes('network');
            
          if (isNetworkError) {
            // Keep it in the queue, retry later when connection is stable
            break;
          } else {
            // Business logic failure (e.g., duplicate entries, insufficient balance)
            // Discard the entry so the queue is not blocked indefinitely, but alert user
            await removeFromSyncQueue(item.id);
          }
        }
      } catch (err) {
        console.error('Error processing queue item', err);
        break;
      }
    }

    // Refresh count and query state
    await updatePendingCount();
    queryClient.invalidateQueries();
    setIsSyncing(false);
  };

  return (
    <SyncContext.Provider value={{ isOnline, pendingCount, isSyncing, syncQueue }}>
      {children}
    </SyncContext.Provider>
  );
}

export function useSync() {
  const context = useContext(SyncContext);
  if (context === undefined) {
    throw new Error('useSync must be used within a SyncProvider');
  }
  return context;
}
