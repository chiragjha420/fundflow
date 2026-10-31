'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createBrowserClient } from '@/lib/supabase/browser-client';
import { getOfflineCache, setOfflineCache } from '@/lib/offline-db';
import { formatINR, parseHandoverNote } from '@/lib/utils';
import { 
  disburseToWorkerAction, 
  transferToSupervisorAction, 
  logExpenseAction, 
  confirmTransactionAction, 
  createWorkerAction,
  disputeTransactionAction,
  updateWorkerPhoneAction
} from '@/lib/ledger-actions';
import { 
  Check, 
  X, 
  UserPlus, 
  Send, 
  IndianRupee, 
  ArrowRightLeft,
  Search, 
  Camera, 
  User, 
  AlertCircle,
  RefreshCw,
  HandCoins,
  MessageSquare,
  Smartphone,
  Phone,
  Upload,
  History,
  Truck,
  Wrench,
  Package,
  Tag,
  Briefcase,
  ArrowUpRight,
  ArrowDownLeft,
  RotateCcw,
  Building2
} from 'lucide-react';
import { sendWorkerDisbursementSms } from '@/lib/sms';
import { createCashRequest } from '@/app/actions/cash-requests';
import { playAlertSound, sendFundFlowNotification } from '@/lib/notifications';
import { registerDeviceForWebPush } from '@/lib/push-client';
import { NotificationBanner } from '@/components/notification-banner';
import { compressImage } from '@/lib/image-compressor';
import { CameraCaptureModal } from '@/components/camera-capture-modal';
import { uploadHandoverPhotoAction, uploadWorkerPhotoAction, uploadExpensePhotoAction } from '@/app/actions/upload-actions';
import { getFactoryWorkersAction, getSupervisorAllTransactionsAction } from '@/app/actions/workers';
import { getFactoryExpensesAction, FactoryExpense } from '@/app/actions/expenses';

interface Worker {
  worker_id: string;
  worker_name: string;
  worker_phone: string | null;
  worker_photo_url: string | null;
  factory_id: string;
  supervisor_id: string;
  opening_advance: number;
  total_cash_disbursed?: number;
  running_advance: number;
  active: boolean;
}

interface Supervisor {
  id: string;
  name: string;
  factory_id: string;
  active: boolean;
  factories?: { name: string };
}

interface PendingTx {
  id: string;
  type: string;
  amount: number;
  note: string | null;
  created_at: string;
  from?: { name: string } | null;
}

export interface SupervisorClientPageProps {
  initialData?: {
    supervisor?: Supervisor | null;
    workers?: Worker[];
    pendingTxs?: PendingTx[];
    otherSupervisors?: Supervisor[];
    expenses?: FactoryExpense[];
    allTransactions?: {
      transactions: any[];
      refundedTxIds: string[];
    };
  };
}

export function SupervisorClientPage({ initialData }: SupervisorClientPageProps = {}) {
  const supabase = createBrowserClient();
  const queryClient = useQueryClient();

  // Active Tab for Quick Actions
  const [activeTab, setActiveTab] = useState<'disburse' | 'expense' | 'transfer'>('disburse');

  // Search state
  const [searchQuery, setSearchQuery] = useState('');

  // Dialog/Form states
  const [disputeTxId, setDisputeTxId] = useState<string | null>(null);
  const [disputeNote, setDisputeNote] = useState('');
  const [showAddWorker, setShowAddWorker] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [showCameraModal, setShowCameraModal] = useState<boolean>(false);

  // Cash Handover Photo Prompt States
  const [showHandoverModal, setShowHandoverModal] = useState<boolean>(false);
  const [pendingDisburse, setPendingDisburse] = useState<{
    targetWorker: Worker;
    amount: number;
    note: string;
    overridePhone?: string;
  } | null>(null);
  const [viewingPhotoUrl, setViewingPhotoUrl] = useState<string | null>(null);
  const [viewingPhotoTitle, setViewingPhotoTitle] = useState<string>('Proof of Handover');

  // Unified Transaction History States (All Transactions: Advances, Transfers, Expenses, Refunds)
  const [historySearchQuery, setHistorySearchQuery] = useState<string>('');
  const [historyTypeFilter, setHistoryTypeFilter] = useState<'all' | 'advances' | 'transfers' | 'expenses' | 'refunds'>('all');
  const [historySupervisorFilter, setHistorySupervisorFilter] = useState<'all' | 'my'>('all');
  const [isHistoryExpanded, setIsHistoryExpanded] = useState<boolean>(false);

  // Form loading states
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmTx, setConfirmTx] = useState<{ id: string; amount: number; type: string } | null>(null);
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Quick Amount Preset state for Disbursal
  const [disburseAmount, setDisburseAmount] = useState<string>('');
  const [selectedWorkerId, setSelectedWorkerId] = useState<string>('');
  const [disburseNote, setDisburseNote] = useState<string>('');
  const [lastDisburseSms, setLastDisburseSms] = useState<{ workerName: string; smsUri: string } | null>(null);

  // Worker Search & Quick Add States
  const [workerSearchTerm, setWorkerSearchTerm] = useState<string>('');
  const [isQuickAddingWorker, setIsQuickAddingWorker] = useState<boolean>(false);

  // Missing Worker Phone Modal (Prompts supervisor when giving money to worker without phone)
  const [showPhoneModal, setShowPhoneModal] = useState<boolean>(false);
  const [phoneModalWorker, setPhoneModalWorker] = useState<Worker | null>(null);
  const [phoneModalDisburseDetails, setPhoneModalDisburseDetails] = useState<{
    workerId: string;
    amount: number;
    note: string;
  } | null>(null);
  const [phoneModalInput, setPhoneModalInput] = useState<string>('');
  const [phoneModalError, setPhoneModalError] = useState<string>('');
  const [phoneModalLoading, setPhoneModalLoading] = useState<boolean>(false);

  // Cash Replenishment Request states
  const [showCashRequestModal, setShowCashRequestModal] = useState<boolean>(false);
  const [requestAmount, setRequestAmount] = useState<string>('');
  const [requestNote, setRequestNote] = useState<string>('');
  const [requestLoading, setRequestLoading] = useState<boolean>(false);

  const handleCashRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const numAmount = parseFloat(requestAmount);
    if (isNaN(numAmount) || numAmount <= 0 || !requestNote.trim()) return;

    setRequestLoading(true);
    try {
      const res = await createCashRequest(supervisorId!, factoryId!, numAmount, requestNote);
      if (res.success) {
        // Direct broadcast over active WebSocket
        try {
          supabase.channel('fundflow-notifications').send({
            type: 'broadcast',
            event: 'fundflow_alert',
            payload: {
              type: 'cash_request',
              supervisor_id: supervisorId,
              supervisor_name: supervisor?.name || 'Supervisor',
              factory_name: (supervisor as any)?.factories?.name || 'Factory',
              amount: numAmount,
              note: requestNote,
            }
          }).catch(() => {});
        } catch {}

        showToast('success', `Cash request for ${formatINR(numAmount)} sent to Main Office!`);
        setShowCashRequestModal(false);
        setRequestAmount('');
        setRequestNote('');
      } else {
        showToast('error', res.error || 'Failed to submit request.');
      }
    } catch (e: any) {
      showToast('error', e.message || 'Error submitting request.');
    } finally {
      setRequestLoading(false);
    }
  };

  const showToast = (type: 'success' | 'error', text: string) => {
    setToastMessage({ type, text });
    setTimeout(() => {
      setToastMessage(null);
    }, 5000);
  };

  // Helper to read localStorage synchronously
  const getStoredJson = <T,>(key: string, fallback: T): T => {
    if (typeof window === 'undefined') return fallback;
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : fallback;
    } catch {
      return fallback;
    }
  };

  // 1. Get Supervisor Info
  const { data: supervisor } = useQuery({
    queryKey: ['supervisor-info'],
    queryFn: async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        let userId = session?.user?.id;
        if (!userId) {
          const { data: { user } } = await supabase.auth.getUser();
          userId = user?.id;
        }
        if (!userId) throw new Error('Not authenticated');

        const { data, error } = await supabase
          .from('supervisors')
          .select('id, name, factory_id, factories(name)')
          .eq('user_id', userId)
          .single();

        if (error) throw error;
        await setOfflineCache('supervisor-info', data);
        try { localStorage.setItem('fundflow_cached_supervisor', JSON.stringify(data)); } catch {}
        return data as unknown as Supervisor;
      } catch (e) {
        console.warn('Network query failed, trying local cache for supervisor info:', e);
        const cached = await getOfflineCache<any>('supervisor-info');
        if (cached) return cached;
        throw e;
      }
    },
    initialData: initialData?.supervisor || getStoredJson<Supervisor | null>('fundflow_cached_supervisor', null) || undefined,
    staleTime: 5 * 60 * 1000,
  });

  const supervisorId = supervisor?.id;
  const factoryId = supervisor?.factory_id;

  // Register device for Real OS Web Push (wakes phone up even when closed)
  useEffect(() => {
    if (supervisorId) {
      registerDeviceForWebPush('supervisor', supervisorId).catch(() => {});
    }
  }, [supervisorId]);

  // 2. Fetch Incoming Pending Transactions
  const { data: pendingTxs } = useQuery({
    queryKey: ['incoming-pending', supervisorId],
    queryFn: async () => {
      if (!supervisorId) return [];
      const { data, error } = await supabase
        .from('cash_transactions')
        .select('id, type, amount, note, created_at, from:from_supervisor_id(name)')
        .eq('to_supervisor_id', supervisorId)
        .eq('status', 'pending');

      if (error) throw error;
      
      await setOfflineCache(`incoming-pending-${supervisorId}`, data);
      try { localStorage.setItem(`fundflow_cached_pending_${supervisorId}`, JSON.stringify(data)); } catch {}
      return data as unknown as PendingTx[];
    },
    initialData: (initialData?.pendingTxs && initialData.pendingTxs.length > 0)
      ? initialData.pendingTxs
      : (supervisorId ? getStoredJson<PendingTx[]>(`fundflow_cached_pending_${supervisorId}`, []) : []),
    enabled: !!supervisorId,
    refetchInterval: 3000,
  });

  const knownPendingTxIds = useRef<Set<string> | null>(null);

  // High-reliability watcher: Triggers sound, vibration and alert if incoming cash appears
  useEffect(() => {
    if (!pendingTxs) return;
    if (knownPendingTxIds.current === null) {
      knownPendingTxIds.current = new Set(pendingTxs.map((t) => t.id));
      return;
    }

    const newTxs = pendingTxs.filter((t) => !knownPendingTxIds.current!.has(t.id));
    if (newTxs.length > 0) {
      for (const t of newTxs) {
        knownPendingTxIds.current.add(t.id);
        playAlertSound('cash_in');
        if ('vibrate' in navigator) {
          try { navigator.vibrate([200, 100, 200]); } catch {}
        }
        sendFundFlowNotification('💵 Office Cash Received!', {
          body: `Main Office sent ${formatINR(t.amount)}. Tap to confirm on your dashboard.`,
          soundType: 'cash_in',
          url: '/supervisor',
        });
        showToast('success', `💵 Main Office sent ${formatINR(t.amount)}! Please confirm receipt below.`);
      }
    }
  }, [pendingTxs]);

  const [cachedPending, setCachedPending] = useState<PendingTx[]>([]);
  useEffect(() => {
    if (supervisorId) {
      getOfflineCache<PendingTx[]>(`incoming-pending-${supervisorId}`).then(data => {
        if (data) setCachedPending(data);
      });
    }
  }, [supervisorId, pendingTxs]);

  // Real-Time Broadcast Notification Listener (triggers phone vibration, chime & OS banner)
  useEffect(() => {
    if (!supervisorId) return;

    const channel = supabase.channel('fundflow-notifications');

    channel
      .on('broadcast', { event: 'fundflow_alert' }, (msg: any) => {
        const payload = msg?.payload;
        if (!payload) return;

        // 1. Office Disbursed Cash to this Supervisor!
        if (payload.type === 'office_disbursement' && payload.to_supervisor_id === supervisorId) {
          sendFundFlowNotification('💵 Office Cash Received!', {
            body: `Main Office sent ${formatINR(payload.amount)}. Tap to confirm receipt on your dashboard.`,
            soundType: 'cash_in',
            url: '/supervisor',
          });
          showToast('success', `💵 Main Office sent ${formatINR(payload.amount)}!`);
          queryClient.invalidateQueries({ queryKey: ['incoming-pending', supervisorId] });
          queryClient.invalidateQueries({ queryKey: ['supervisor-balance', supervisorId] });
        }

        // 2. Peer Supervisor Transferred Cash to this Supervisor!
        if (payload.type === 'supervisor_transfer' && payload.to_supervisor_id === supervisorId) {
          sendFundFlowNotification('💸 Cash Transfer Received!', {
            body: `${payload.from_supervisor_name || 'A supervisor'} transferred ${formatINR(payload.amount)}. Tap to confirm.`,
            soundType: 'cash_in',
            url: '/supervisor',
          });
          showToast('success', `💸 Transfer of ${formatINR(payload.amount)} received!`);
          queryClient.invalidateQueries({ queryKey: ['incoming-pending', supervisorId] });
          queryClient.invalidateQueries({ queryKey: ['supervisor-balance', supervisorId] });
        }

        // 3. Peer Supervisor Confirmed a Transfer sent by this Supervisor!
        if (payload.type === 'receipt_confirmed' && payload.from_supervisor_id === supervisorId) {
          sendFundFlowNotification('✅ Transfer Confirmed!', {
            body: `${payload.to_supervisor_name || 'Supervisor'} confirmed receipt of ${formatINR(payload.amount)}.`,
            soundType: 'success',
            url: '/supervisor',
          });
          queryClient.invalidateQueries({ queryKey: ['supervisor-balance', supervisorId] });
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supervisorId, supabase, queryClient]);

  const activePending = pendingTxs !== undefined ? pendingTxs : cachedPending;

  // 3. Fetch Workers List (via Server Action for complete multi-supervisor sync)
  const { data: workers, isLoading: workersLoading } = useQuery({
    queryKey: ['workers', factoryId],
    queryFn: async () => {
      if (!factoryId) return [];
      try {
        const data = await getFactoryWorkersAction(factoryId);
        await setOfflineCache(`workers-${factoryId}`, data);
        try { localStorage.setItem(`fundflow_cached_workers_${factoryId}`, JSON.stringify(data)); } catch {}
        return data as Worker[];
      } catch (err) {
        const cached = await getOfflineCache<Worker[]>(`workers-${factoryId}`);
        if (cached) return cached;
        throw err;
      }
    },
    initialData: (initialData?.workers && initialData.workers.length > 0)
      ? initialData.workers
      : (factoryId ? getStoredJson<Worker[]>(`fundflow_cached_workers_${factoryId}`, []) : []),
    enabled: !!factoryId,
  });

  const [cachedWorkers, setCachedWorkers] = useState<Worker[]>([]);
  useEffect(() => {
    if (factoryId) {
      getOfflineCache<Worker[]>(`workers-${factoryId}`).then(data => {
        if (data) setCachedWorkers(data);
      });
    }
  }, [factoryId, workers]);

  const activeWorkers = workers !== undefined ? workers : cachedWorkers;

  // Real-time worker filtering for the Disburse selector
  const filteredSelectWorkers = activeWorkers.filter(w => {
    if (!workerSearchTerm.trim()) return true;
    const q = workerSearchTerm.toLowerCase();
    return w.worker_name.toLowerCase().includes(q) || (w.worker_phone && w.worker_phone.includes(q));
  });

  const selectedWorker = activeWorkers.find(w => w.worker_id === selectedWorkerId);

  // 4. Fetch Active Supervisors (for transfer selection)
  const { data: otherSupervisors } = useQuery({
    queryKey: ['supervisors-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('supervisors')
        .select('id, name, factory_id, active, factories(name)')
        .eq('active', true);

      if (error) throw error;

      await setOfflineCache('supervisors-list', data);
      try { localStorage.setItem('fundflow_cached_other_sups', JSON.stringify(data)); } catch {}
      return data as unknown as Supervisor[];
    },
    initialData: (initialData?.otherSupervisors && initialData.otherSupervisors.length > 0)
      ? initialData.otherSupervisors
      : getStoredJson<Supervisor[]>('fundflow_cached_other_sups', []),
  });

  const [cachedSups, setCachedSups] = useState<Supervisor[]>([]);
  useEffect(() => {
    getOfflineCache<Supervisor[]>('supervisors-list').then(data => {
      if (data) setCachedSups(data);
    });
  }, [otherSupervisors]);

  const activeOtherSups = (otherSupervisors !== undefined ? otherSupervisors : cachedSups)
    .filter(s => s.id !== supervisorId);

  // 5. Fetch all cash transactions involving this supervisor / factory (transfers, advances, office receipts & refunds)
  const { data: allTxsData } = useQuery({
    queryKey: ['supervisor-all-transactions', supervisorId, factoryId],
    queryFn: async () => {
      if (!supervisorId && !factoryId) return { transactions: [], refundedTxIds: [] };
      try {
        const res = await getSupervisorAllTransactionsAction(supervisorId, factoryId);
        await setOfflineCache(`sup-all-txs-${supervisorId || factoryId}`, res);
        return res;
      } catch (err) {
        console.warn('Failed to fetch supervisor transactions, falling back to offline cache:', err);
        const cached = await getOfflineCache<{ transactions: any[]; refundedTxIds: string[] }>(`sup-all-txs-${supervisorId || factoryId}`);
        return cached || { transactions: [], refundedTxIds: [] };
      }
    },
    initialData: initialData?.allTransactions,
    enabled: !!(supervisorId || factoryId),
  });

  const [cachedAllTxs, setCachedAllTxs] = useState<{ transactions: any[]; refundedTxIds: string[] }>(
    initialData?.allTransactions || { transactions: [], refundedTxIds: [] }
  );
  useEffect(() => {
    if (supervisorId || factoryId) {
      getOfflineCache<{ transactions: any[]; refundedTxIds: string[] }>(`sup-all-txs-${supervisorId || factoryId}`).then(data => {
        if (data) setCachedAllTxs(data);
      });
    }
  }, [supervisorId, factoryId, allTxsData]);

  const activeAllTxs = allTxsData !== undefined ? allTxsData : cachedAllTxs;

  // 6. Fetch Expenses list for this factory (unified across co-supervisors)
  const { data: expenses } = useQuery({
    queryKey: ['factory-expenses', factoryId],
    queryFn: async () => {
      if (!factoryId) return [];
      try {
        const data = await getFactoryExpensesAction(factoryId);
        await setOfflineCache(`factory-expenses-${factoryId}`, data);
        return data;
      } catch (err) {
        console.warn('Failed to fetch factory expenses, falling back to offline cache:', err);
        const cached = await getOfflineCache<FactoryExpense[]>(`factory-expenses-${factoryId}`);
        return cached || [];
      }
    },
    initialData: initialData?.expenses,
    enabled: !!factoryId,
  });

  const [cachedExpenses, setCachedExpenses] = useState<FactoryExpense[]>(initialData?.expenses || []);
  useEffect(() => {
    if (factoryId) {
      getOfflineCache<FactoryExpense[]>(`factory-expenses-${factoryId}`).then(data => {
        if (data) setCachedExpenses(data);
      });
    }
  }, [factoryId, expenses]);

  const activeExpenses = expenses !== undefined ? expenses : cachedExpenses;

  const hasCoSupervisors = (otherSupervisors || []).some(s => s.factory_id === factoryId && s.id !== supervisorId);

  const getCategoryBadge = (category: string) => {
    const cat = (category || 'other').toLowerCase();
    switch (cat) {
      case 'materials':
        return {
          label: 'Materials',
          icon: <Package className="h-3 w-3" />,
          className: 'bg-blue-50 text-blue-700 border-blue-200',
        };
      case 'transport':
        return {
          label: 'Transport',
          icon: <Truck className="h-3 w-3" />,
          className: 'bg-amber-50 text-amber-700 border-amber-200',
        };
      case 'maintenance':
        return {
          label: 'Maintenance',
          icon: <Wrench className="h-3 w-3" />,
          className: 'bg-purple-50 text-purple-700 border-purple-200',
        };
      case 'wages':
        return {
          label: 'Wages / Labour',
          icon: <Briefcase className="h-3 w-3" />,
          className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        };
      default:
        return {
          label: category ? category.charAt(0).toUpperCase() + category.slice(1) : 'Other',
          icon: <Tag className="h-3 w-3" />,
          className: 'bg-slate-100 text-slate-700 border-slate-200',
        };
    }
  };

  // Unified transactions list (All Expenses, Worker Advances, S2S Transfers, Office Cash, and Refunds)
  const combinedTransactions = useMemo(() => {
    // Helper to resolve supervisor display name
    const getSupervisorDisplayName = (supId: string) => {
      if (supId === supervisorId) return 'You';
      const match = (otherSupervisors || []).find(s => s.id === supId);
      return match?.name || 'Supervisor';
    };

    const refundedSet = new Set<string>(activeAllTxs?.refundedTxIds || []);

    const list: Array<{
      id: string;
      kind: 'expense' | 'advance' | 'transfer_sent' | 'transfer_received' | 'office_cash' | 'advance_refund';
      direction: 'inflow' | 'outflow';
      amount: number;
      title: string;
      subtitle?: string;
      status?: string;
      isRefunded?: boolean;
      categoryKey: string;
      categoryLabel: string;
      badgeClass: string;
      badgeIcon: React.ReactNode;
      note: string;
      photoUrl: string | null;
      photoTitle: string;
      photoButtonLabel: string;
      created_at: string;
      supervisorId: string;
      supervisorName: string;
      isOwn: boolean;
    }> = [];

    // 1. Map expenses
    (activeExpenses || []).forEach((exp) => {
      const badge = getCategoryBadge(exp.category);
      const supName = exp.supervisors?.name || getSupervisorDisplayName(exp.supervisor_id);
      list.push({
        id: `exp-${exp.id}`,
        kind: 'expense',
        direction: 'outflow',
        amount: Number(exp.amount || 0),
        title: exp.note || badge.label,
        subtitle: exp.note ? badge.label : undefined,
        categoryKey: (exp.category || 'other').toLowerCase(),
        categoryLabel: `Expense: ${badge.label}`,
        badgeClass: badge.className,
        badgeIcon: badge.icon,
        note: exp.note || '',
        photoUrl: exp.photo_url || null,
        photoTitle: `Receipt: ${exp.note || badge.label}`,
        photoButtonLabel: 'View Receipt',
        created_at: exp.created_at,
        supervisorId: exp.supervisor_id,
        supervisorName: supName,
        isOwn: exp.supervisor_id === supervisorId,
      });
    });

    // 2. Map all transactions from activeAllTxs
    (activeAllTxs?.transactions || []).forEach((tx: any) => {
      // (a) Worker Advance (supervisor_to_worker)
      if (tx.type === 'supervisor_to_worker') {
        const { note: cleanNote, photoUrl } = parseHandoverNote(tx.note);
        const workerName = tx.to_work?.name || 'Worker';
        const supName = tx.from?.name || getSupervisorDisplayName(tx.from_supervisor_id);
        const isRefunded = refundedSet.has(tx.id);

        list.push({
          id: `adv-${tx.id}`,
          kind: 'advance',
          direction: 'outflow',
          amount: Number(tx.amount || 0),
          isRefunded,
          title: workerName,
          subtitle: isRefunded 
            ? 'Refunded by Admin (money credited back)' 
            : (cleanNote || 'Cash Advance'),
          categoryKey: isRefunded ? 'refund' : 'advance',
          categoryLabel: isRefunded ? 'Advance Refunded' : 'Worker Advance',
          badgeClass: isRefunded 
            ? 'bg-amber-100 text-amber-800 border-amber-300' 
            : 'bg-emerald-50 text-emerald-800 border-emerald-200',
          badgeIcon: isRefunded 
            ? <RotateCcw className="h-3 w-3 text-amber-700" />
            : <HandCoins className="h-3 w-3 text-emerald-600" />,
          note: cleanNote || '',
          photoUrl: photoUrl || null,
          photoTitle: `Handover Proof: ${workerName}`,
          photoButtonLabel: 'View Proof',
          created_at: tx.created_at,
          supervisorId: tx.from_supervisor_id,
          supervisorName: supName,
          isOwn: tx.from_supervisor_id === supervisorId,
        });
      }
      // (b) Supervisor Transfer (Sent by this supervisor)
      else if (tx.type === 'supervisor_to_supervisor' && tx.from_supervisor_id === supervisorId) {
        const recipientName = tx.to_sup?.name || getSupervisorDisplayName(tx.to_supervisor_id);
        const statusLabel = tx.status === 'pending' ? ' (Pending)' : tx.status === 'disputed' ? ' (Disputed)' : '';
        const badgeClass = tx.status === 'pending' 
          ? 'bg-amber-50 text-amber-700 border-amber-200' 
          : tx.status === 'disputed' 
          ? 'bg-rose-50 text-rose-700 border-rose-200' 
          : 'bg-purple-50 text-purple-700 border-purple-200';

        list.push({
          id: `tx-sent-${tx.id}`,
          kind: 'transfer_sent',
          direction: 'outflow',
          amount: Number(tx.amount || 0),
          status: tx.status,
          title: `Transfer to ${recipientName}`,
          subtitle: tx.note ? `"${tx.note}"` : 'Supervisor Transfer',
          categoryKey: 'transfer',
          categoryLabel: `Transfer: Sent${statusLabel}`,
          badgeClass,
          badgeIcon: <ArrowUpRight className="h-3 w-3" />,
          note: tx.note || '',
          photoUrl: null,
          photoTitle: `Transfer to ${recipientName}`,
          photoButtonLabel: '',
          created_at: tx.created_at,
          supervisorId: tx.from_supervisor_id,
          supervisorName: 'You',
          isOwn: true,
        });
      }
      // (c) Supervisor Transfer (Received by this supervisor)
      else if (tx.type === 'supervisor_to_supervisor' && tx.to_supervisor_id === supervisorId) {
        const senderName = tx.from?.name || getSupervisorDisplayName(tx.from_supervisor_id);
        const statusLabel = tx.status === 'pending' ? ' (Pending)' : tx.status === 'disputed' ? ' (Disputed)' : '';
        const badgeClass = tx.status === 'pending' 
          ? 'bg-amber-50 text-amber-700 border-amber-200' 
          : 'bg-emerald-50 text-emerald-700 border-emerald-200';

        list.push({
          id: `tx-recv-${tx.id}`,
          kind: 'transfer_received',
          direction: 'inflow',
          amount: Number(tx.amount || 0),
          status: tx.status,
          title: `Transfer from ${senderName}`,
          subtitle: tx.note ? `"${tx.note}"` : 'Supervisor Transfer Received',
          categoryKey: 'transfer',
          categoryLabel: `Transfer: Received${statusLabel}`,
          badgeClass,
          badgeIcon: <ArrowDownLeft className="h-3 w-3" />,
          note: tx.note || '',
          photoUrl: null,
          photoTitle: `Transfer from ${senderName}`,
          photoButtonLabel: '',
          created_at: tx.created_at,
          supervisorId: tx.to_supervisor_id,
          supervisorName: 'You',
          isOwn: true,
        });
      }
      // (d) Supervisor Transfer (Between co-supervisors in same factory)
      else if (tx.type === 'supervisor_to_supervisor') {
        const senderName = tx.from?.name || getSupervisorDisplayName(tx.from_supervisor_id);
        const recipientName = tx.to_sup?.name || getSupervisorDisplayName(tx.to_supervisor_id);
        list.push({
          id: `tx-sup-${tx.id}`,
          kind: 'transfer_sent',
          direction: 'outflow',
          amount: Number(tx.amount || 0),
          status: tx.status,
          title: `${senderName} → ${recipientName}`,
          subtitle: tx.note ? `"${tx.note}"` : 'Co-supervisor Transfer',
          categoryKey: 'transfer',
          categoryLabel: 'Transfer: S2S',
          badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
          badgeIcon: <ArrowRightLeft className="h-3 w-3" />,
          note: tx.note || '',
          photoUrl: null,
          photoTitle: `${senderName} to ${recipientName}`,
          photoButtonLabel: '',
          created_at: tx.created_at,
          supervisorId: tx.from_supervisor_id,
          supervisorName: senderName,
          isOwn: false,
        });
      }
      // (e) Office Cash / Refund Credit (office_to_supervisor)
      else if (tx.type === 'office_to_supervisor' && tx.to_supervisor_id === supervisorId) {
        const isRefund = tx.note?.includes('[REFUND:');
        const cleanNote = tx.note ? tx.note.replace(/\[REFUND:[a-f0-9-]+\]\s*/i, '').trim() : '';

        if (isRefund) {
          list.push({
            id: `refund-${tx.id}`,
            kind: 'advance_refund',
            direction: 'inflow',
            amount: Number(tx.amount || 0),
            status: tx.status,
            title: 'Advance Refund Credited',
            subtitle: cleanNote || 'Refund credited back to your balance by Admin',
            categoryKey: 'refund',
            categoryLabel: 'Refund from Office',
            badgeClass: 'bg-teal-50 text-teal-800 border-teal-200',
            badgeIcon: <RotateCcw className="h-3 w-3 text-teal-700" />,
            note: cleanNote || '',
            photoUrl: null,
            photoTitle: 'Refund Credit',
            photoButtonLabel: '',
            created_at: tx.created_at,
            supervisorId: tx.to_supervisor_id,
            supervisorName: 'You',
            isOwn: true,
          });
        } else {
          list.push({
            id: `office-${tx.id}`,
            kind: 'office_cash',
            direction: 'inflow',
            amount: Number(tx.amount || 0),
            status: tx.status,
            title: 'Office Cash Received',
            subtitle: cleanNote || 'Cash disbursed from Office',
            categoryKey: 'office',
            categoryLabel: tx.status === 'pending' ? 'Office Cash (Pending Confirmation)' : 'Office Cash',
            badgeClass: tx.status === 'pending' 
              ? 'bg-amber-50 text-amber-700 border-amber-200' 
              : 'bg-blue-50 text-blue-700 border-blue-200',
            badgeIcon: <Building2 className="h-3 w-3" />,
            note: cleanNote || '',
            photoUrl: null,
            photoTitle: 'Office Cash',
            photoButtonLabel: '',
            created_at: tx.created_at,
            supervisorId: tx.to_supervisor_id,
            supervisorName: 'You',
            isOwn: true,
          });
        }
      }
    });

    // Sort chronologically (newest first)
    return list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [activeExpenses, activeAllTxs, supervisorId, otherSupervisors]);

  // Filtered transactions based on supervisor toggle, type pill, and search
  const filteredTransactions = useMemo(() => {
    return combinedTransactions.filter((tx) => {
      if (historySupervisorFilter === 'my' && !tx.isOwn) {
        return false;
      }
      if (historyTypeFilter === 'advances' && tx.kind !== 'advance') {
        return false;
      }
      if (historyTypeFilter === 'transfers' && tx.kind !== 'transfer_sent' && tx.kind !== 'transfer_received') {
        return false;
      }
      if (historyTypeFilter === 'expenses' && tx.kind !== 'expense') {
        return false;
      }
      if (historyTypeFilter === 'refunds' && tx.kind !== 'advance_refund' && !tx.isRefunded) {
        return false;
      }
      if (historySearchQuery.trim()) {
        const q = historySearchQuery.toLowerCase().trim();
        const matchTitle = tx.title.toLowerCase().includes(q);
        const matchNote = tx.note.toLowerCase().includes(q);
        const matchSubtitle = (tx.subtitle || '').toLowerCase().includes(q);
        const matchCategory = tx.categoryLabel.toLowerCase().includes(q);
        const matchSup = tx.supervisorName.toLowerCase().includes(q);
        const matchAmt = tx.amount.toString().includes(q);
        if (!matchTitle && !matchNote && !matchSubtitle && !matchCategory && !matchSup && !matchAmt) {
          return false;
        }
      }
      return true;
    });
  }, [combinedTransactions, historySupervisorFilter, historyTypeFilter, historySearchQuery]);

  const totalSpendingAmount = useMemo(() => {
    return combinedTransactions
      .filter((tx) => (historySupervisorFilter === 'all' || tx.isOwn) && tx.direction === 'outflow' && !tx.isRefunded)
      .reduce((sum, tx) => sum + tx.amount, 0);
  }, [combinedTransactions, historySupervisorFilter]);

  // Handle Receipt Confirmation
  const handleConfirmClick = (txId: string, amount: number, type: string) => {
    setConfirmTx({ id: txId, amount, type });
  };

  const executeConfirmReceipt = async () => {
    if (!confirmTx) return;
    setActionLoading(true);
    try {
      const res = await confirmTransactionAction(confirmTx.id);
      if (res.queued) {
        showToast('success', 'Offline: Receipt confirmation queued. Available balance will update when synced.');
      } else {
        showToast('success', 'Cash receipt confirmed successfully!');
      }
      setConfirmTx(null);
      queryClient.invalidateQueries();
    } catch (e: any) {
      showToast('error', e.message || 'Failed to confirm receipt.');
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Dispute Submission
  const handleDisputeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!disputeTxId || !disputeNote.trim()) return;

    setActionLoading(true);
    try {
      const res = await disputeTransactionAction(disputeTxId, disputeNote);
      if (res.queued) {
        showToast('success', 'Offline: Dispute queued. Ledger will reconcile when synced.');
      } else {
        showToast('success', 'Dispute submitted successfully.');
      }
      setDisputeTxId(null);
      setDisputeNote('');
      queryClient.invalidateQueries();
    } catch (e: any) {
      showToast('error', e.message || 'Failed to submit dispute.');
    } finally {
      setActionLoading(false);
    }
  };

  // 1-Tap Quick Add Worker right inside the Disburse selector
  const handleQuickAddWorker = async (name: string) => {
    const cleanName = name.trim();
    if (!cleanName || !factoryId || !supervisorId) return;
    setIsQuickAddingWorker(true);
    const newId = crypto.randomUUID();
    const newWorker: Worker = {
      worker_id: newId,
      worker_name: cleanName,
      worker_phone: null,
      worker_photo_url: null,
      factory_id: factoryId,
      supervisor_id: supervisorId,
      opening_advance: 0,
      running_advance: 0,
      active: true,
    };

    // Optimistically add to workers query data immediately (0ms)
    queryClient.setQueryData(['workers', factoryId], (old: Worker[] | undefined) => {
      return [newWorker, ...(old || [])];
    });

    // Select this new worker immediately
    setSelectedWorkerId(newId);
    setWorkerSearchTerm('');
    setIsQuickAddingWorker(false);
    showToast('success', `Worker "${cleanName}" created! Enter amount to disburse.`);

    // Background DB insert
    createWorkerAction(factoryId, supervisorId, cleanName, null, null, 0)
      .catch((err) => {
        console.warn('Background worker creation failed:', err);
        showToast('error', `Failed to save worker to server: ${err.message}`);
      });
  };

  // Handler for Cash Handover Photo Capture or Skip (Optimistic 0ms UI)
  const handleHandoverCapture = async (file: File | null) => {
    if (!pendingDisburse) return;
    const { targetWorker, amount, note, overridePhone } = pendingDisburse;
    
    // 1. Immediately close modal, unblock UI, and reset form inputs (0ms)
    setShowHandoverModal(false);
    setPendingDisburse(null);
    setDisburseAmount('');
    setSelectedWorkerId('');
    setDisburseNote('');
    setWorkerSearchTerm('');
    setActionLoading(false);
    setLastDisburseSms(null);

    // 2. OPTIMISTIC CACHE UPDATE: Deduct supervisor available balance
    queryClient.setQueryData(['supervisor-balance', supervisorId], (old: number | undefined) => {
      if (typeof old === 'number') return Math.max(0, old - amount);
      return old;
    });

    // 4. OPTIMISTIC CACHE UPDATE: Update worker running advance
    queryClient.setQueryData(['workers', factoryId], (old: Worker[] | undefined) => {
      if (!old) return old;
      return old.map(w => w.worker_id === targetWorker.worker_id ? {
        ...w,
        running_advance: Number(w.running_advance) + amount,
        total_cash_disbursed: (Number(w.total_cash_disbursed) || 0) + amount,
      } : w);
    });

    // 5. OPTIMISTIC CACHE UPDATE: Prepend to recent disbursements
    const tempTxId = `temp-${Date.now()}`;
    const cleanNoteBase = note?.trim() || 'Cash Advance';
    queryClient.setQueryData(['recent-disbursements', factoryId], (old: any[] | undefined) => {
      const optimisticTx = {
        id: tempTxId,
        amount,
        note: cleanNoteBase,
        created_at: new Date().toISOString(),
        to_worker_id: targetWorker.worker_id,
        to_work: { name: targetWorker.worker_name, active: true },
        from_supervisor_id: supervisorId,
      };
      return [optimisticTx, ...(old || [])].slice(0, 50);
    });

    // 6. INSTANT AUDIO & TOAST CONFIRMATION (0ms)
    playAlertSound('cash_in');
    showToast('success', `₹${amount.toLocaleString('en-IN')} paid to ${targetWorker.worker_name}!`);

    // 7. ASYNCHRONOUS BACKGROUND WORK (Photo Upload + RPC + SMS + Silent Invalidation)
    (async () => {
      try {
        let finalNote = cleanNoteBase;

        // Background photo upload if file was captured
        if (file && navigator.onLine) {
          try {
            const formData = new FormData();
            formData.append('file', file);
            const uploadRes = await uploadHandoverPhotoAction(formData);
            if (uploadRes.success && uploadRes.publicUrl) {
              finalNote = `${finalNote} [handover_photo:${uploadRes.publicUrl}]`;
            }
          } catch (uploadErr) {
            console.warn('Background photo upload warning:', uploadErr);
          }
        }

        // Background Ledger RPC
        await disburseToWorkerAction(targetWorker.worker_id, supervisorId!, amount, finalNote);

        // Background Free SMS Dispatch (Fire-and-forget)
        const phoneToUse = overridePhone || targetWorker.worker_phone;
        if (phoneToUse) {
          const cleanNoteOnly = parseHandoverNote(finalNote).note;
          sendWorkerDisbursementSms({
            workerPhone: phoneToUse,
            workerName: targetWorker.worker_name,
            amount,
            supervisorName: supervisor?.name,
            factoryName: (supervisor?.factories as any)?.name,
            note: cleanNoteOnly,
          }).then((smsRes) => {
            if (smsRes.sentViaGateway) {
              showToast('success', `Free SMS sent to ${targetWorker.worker_name} (${phoneToUse})!`);
            } else if (smsRes.smsUri) {
              setLastDisburseSms({
                workerName: targetWorker.worker_name,
                smsUri: smsRes.smsUri,
              });
            }
          }).catch(console.warn);
        }

        // Silent cache reconciliation after 2.5 seconds
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ['recent-disbursements', factoryId] });
          queryClient.invalidateQueries({ queryKey: ['workers', factoryId] });
          queryClient.invalidateQueries({ queryKey: ['supervisor-balance', supervisorId] });
        }, 2500);

      } catch (e: any) {
        console.error('Background disbursement failed:', e);
        showToast('error', e.message || 'Failed to sync disbursement to server.');
        // Revert optimistic cache on hard failure
        queryClient.invalidateQueries({ queryKey: ['supervisor-balance', supervisorId] });
        queryClient.invalidateQueries({ queryKey: ['workers', factoryId] });
        queryClient.invalidateQueries({ queryKey: ['recent-disbursements', factoryId] });
      }
    })();
  };

  // Handler for Missing Phone Modal (Save phone & disburse, or skip)
  const handlePhoneModalAction = async (skip: boolean) => {
    if (!phoneModalWorker) return;
    setPhoneModalLoading(true);
    setPhoneModalError('');

    try {
      let savedPhone: string | undefined = undefined;

      if (!skip) {
        const clean = phoneModalInput.trim().replace(/[^\d+]/g, '');
        if (clean.length < 10) {
          setPhoneModalError('Please enter a valid 10-digit mobile number, or tap "Disburse Without Phone".');
          setPhoneModalLoading(false);
          return;
        }

        const updateRes = await updateWorkerPhoneAction(
          phoneModalWorker.worker_id,
          clean,
          phoneModalWorker.worker_name,
          phoneModalWorker.worker_photo_url
        );
        savedPhone = updateRes.formattedPhone;

        // Optimistically update query data
        queryClient.setQueryData(['workers', factoryId], (old: Worker[] | undefined) => {
          if (!old) return old;
          return old.map(w => w.worker_id === phoneModalWorker.worker_id ? { ...w, worker_phone: savedPhone! } : w);
        });
        showToast('success', `Mobile number saved for ${phoneModalWorker.worker_name}!`);
      }

      // If triggered during disbursement, prompt for handover photo now
      if (phoneModalDisburseDetails) {
        setPendingDisburse({
          targetWorker: phoneModalWorker,
          amount: phoneModalDisburseDetails.amount,
          note: phoneModalDisburseDetails.note,
          overridePhone: savedPhone,
        });
        setShowHandoverModal(true);
        setDisburseAmount('');
        setSelectedWorkerId('');
        setPhoneModalDisburseDetails(null);
      }

      setShowPhoneModal(false);
      setPhoneModalWorker(null);
      setPhoneModalInput('');
      queryClient.invalidateQueries();
    } catch (e: any) {
      setPhoneModalError(e.message || 'Failed to update phone number.');
    } finally {
      setPhoneModalLoading(false);
    }
  };

  // Quick Action Forms Submission
  const handleActionSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setActionLoading(true);
    setActionMessage(null);

    const formData = new FormData(e.currentTarget);
    const form = e.currentTarget;

    try {
      if (activeTab === 'disburse') {
        const workerId = selectedWorkerId || (formData.get('workerId') as string);
        const amount = parseFloat(formData.get('amount') as string);
        const note = (formData.get('note') as string)?.trim() || disburseNote.trim() || 'Cash Advance';

        if (!workerId) {
          throw new Error('Please choose a worker to disburse cash to.');
        }

        if (isNaN(amount) || amount <= 0) {
          throw new Error('Please enter a valid disbursement amount.');
        }

        const targetWorker = activeWorkers.find(w => w.worker_id === workerId);
        if (!targetWorker) {
          throw new Error('Selected worker not found in active list.');
        }

        // If worker doesn't have a phone saved yet, prompt supervisor to enter it for SMS receipts
        if (!targetWorker.worker_phone || targetWorker.worker_phone.trim() === '') {
          setPhoneModalWorker(targetWorker);
          setPhoneModalDisburseDetails({
            workerId,
            amount,
            note,
          });
          setPhoneModalInput('');
          setPhoneModalError('');
          setShowPhoneModal(true);
          setActionLoading(false);
          return;
        }

        // Prompt supervisor for Cash Handover Photo proof
        setPendingDisburse({
          targetWorker,
          amount,
          note,
        });
        setShowHandoverModal(true);
        setActionLoading(false);
      } else if (activeTab === 'transfer') {
        const toSupervisorId = formData.get('toSupervisorId') as string;
        const amount = parseFloat(formData.get('amount') as string);
        const note = (formData.get('note') as string)?.trim();

        if (!toSupervisorId || isNaN(amount) || amount <= 0 || !note) {
          throw new Error('Please select a supervisor, specify positive amount, and enter notes/remarks.');
        }

        const res = await transferToSupervisorAction(toSupervisorId, supervisorId!, amount, note);
        if (res.queued) {
          setActionMessage({ type: 'success', text: 'Offline: Transfer queued. Recipient will receive it once synced.' });
        } else {
          setActionMessage({ type: 'success', text: 'Transfer request sent successfully.' });
        }
        form.reset();
      } else if (activeTab === 'expense') {
        const amount = parseFloat(formData.get('amount') as string);
        const category = formData.get('category') as string;
        const note = (formData.get('note') as string)?.trim();

        if (isNaN(amount) || amount <= 0 || !category || !note) {
          throw new Error('Amount, Category, and Notes/Remarks are required.');
        }

        // Handle Photo Upload (server action bypasses storage RLS)
        let photoUrl: string | null = null;
        if (photoFile && navigator.onLine) {
          try {
            const uploadData = new FormData();
            uploadData.append('file', photoFile);
            const uploadRes = await uploadExpensePhotoAction(uploadData);
            if (uploadRes.success && uploadRes.publicUrl) {
              photoUrl = uploadRes.publicUrl;
            } else {
              const reader = new FileReader();
              photoUrl = await new Promise((resolve) => {
                reader.onloadend = () => resolve(reader.result as string);
                reader.readAsDataURL(photoFile);
              });
            }
          } catch {
            const reader = new FileReader();
            photoUrl = await new Promise((resolve) => {
              reader.onloadend = () => resolve(reader.result as string);
              reader.readAsDataURL(photoFile);
            });
          }
        } else if (photoFile && !navigator.onLine) {
          // If offline, converting file to base64 for storage queue
          const reader = new FileReader();
          photoUrl = await new Promise((resolve) => {
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(photoFile);
          });
        }

        const res = await logExpenseAction(supervisorId!, factoryId!, amount, category, note, photoUrl);
        if (res.queued) {
          setActionMessage({ type: 'success', text: 'Offline: Expense queued. Available balance updated locally.' });
        } else {
          setActionMessage({ type: 'success', text: 'Expense logged successfully.' });
        }
        setPhotoFile(null);
        setPhotoPreview(null);
        form.reset();
        queryClient.invalidateQueries({ queryKey: ['factory-expenses', factoryId] });
      }
      
      queryClient.invalidateQueries();
    } catch (e: any) {
      setActionMessage({ type: 'error', text: e.message });
    } finally {
      setActionLoading(false);
    }
  };

  // Quick Create Worker
  const handleAddWorkerSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setActionLoading(true);
    setActionMessage(null);

    const formData = new FormData(e.currentTarget);
    const form = e.currentTarget;

    try {
      const name = formData.get('name') as string;
      const phone = formData.get('phone') as string || null;
      const openingAdvance = parseFloat(formData.get('openingAdvance') as string || '0');

      if (!name) throw new Error('Worker Name is required.');

      // Image upload via Server Action (bypasses storage RLS)
      let photoUrl: string | null = null;
      if (photoFile) {
        if (navigator.onLine) {
          try {
            const uploadData = new FormData();
            uploadData.append('file', photoFile);
            const uploadRes = await uploadWorkerPhotoAction(uploadData);
            if (uploadRes.success && uploadRes.publicUrl) {
              photoUrl = uploadRes.publicUrl;
            } else {
              console.warn('Worker photo upload failed, falling back to base64:', uploadRes.error);
              const reader = new FileReader();
              photoUrl = await new Promise((resolve) => {
                reader.onloadend = () => resolve(reader.result as string);
                reader.readAsDataURL(photoFile);
              });
            }
          } catch (storageErr) {
            console.warn('Storage upload exception, falling back to base64:', storageErr);
            const reader = new FileReader();
            photoUrl = await new Promise((resolve) => {
              reader.onloadend = () => resolve(reader.result as string);
              reader.readAsDataURL(photoFile);
            });
          }
        } else {
          // Offline fallback
          try {
            const reader = new FileReader();
            photoUrl = await new Promise((resolve) => {
              reader.onloadend = () => resolve(reader.result as string);
              reader.readAsDataURL(photoFile);
            });
          } catch {}
        }
      }

      const res = await createWorkerAction(factoryId!, supervisorId!, name, phone, photoUrl, openingAdvance);
      if (res.queued) {
        setActionMessage({ type: 'success', text: 'Offline: Worker created locally. Will sync with server.' });
      } else {
        setActionMessage({ type: 'success', text: 'Worker profile created successfully.' });
        if (openingAdvance > 0 && phone) {
          sendWorkerDisbursementSms({
            workerPhone: phone,
            workerName: name,
            amount: openingAdvance,
            supervisorName: supervisor?.name,
            factoryName: (supervisor?.factories as any)?.name,
            note: 'Opening advance',
          }).then((smsRes) => {
            if (smsRes.sentViaGateway) {
              showToast('success', `Free SMS alert sent to ${name} (${phone})!`);
            }
          }).catch(() => {});
        }
      }

      // Optimistically add to workers query data
      const newWorker: Worker = {
        worker_id: res.id || crypto.randomUUID(),
        worker_name: name,
        worker_phone: phone,
        worker_photo_url: photoUrl,
        factory_id: factoryId!,
        supervisor_id: supervisorId!,
        opening_advance: openingAdvance,
        running_advance: openingAdvance,
        active: true,
      };
      queryClient.setQueryData(['workers', factoryId], (old: Worker[] | undefined) => {
        return [newWorker, ...(old || [])];
      });

      form.reset();
      setPhotoFile(null);
      setPhotoPreview(null);
      setShowAddWorker(false);
      queryClient.invalidateQueries({ queryKey: ['workers', factoryId] });
    } catch (e: any) {
      setActionMessage({ type: 'error', text: e.message });
    } finally {
      setActionLoading(false);
    }
  };

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const originalFile = e.target.files[0];
      try {
        const compressed = await compressImage(originalFile, {
          maxWidth: 480,
          maxHeight: 480,
          quality: 0.75,
        });
        setPhotoFile(compressed);
        setPhotoPreview((prev) => {
          if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
          return URL.createObjectURL(compressed);
        });
      } catch (err) {
        console.warn('Image compression error, using original:', err);
        setPhotoFile(originalFile);
        setPhotoPreview((prev) => {
          if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
          return URL.createObjectURL(originalFile);
        });
      }
    }
  };

  // Filter workers based on search query
  const filteredWorkers = activeWorkers.filter(w => 
    w.worker_name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    (w.worker_phone && w.worker_phone.includes(searchQuery))
  );

  return (
    <div className="space-y-6">
      {/* Toast Alert Banner */}
      {toastMessage && (
        <div className={`p-4 rounded-lg border text-xs font-semibold flex items-start gap-2 shadow-sm animate-fadeIn ${
          toastMessage.type === 'success' 
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
            : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          <AlertCircle className={`h-4 w-4 shrink-0 ${toastMessage.type === 'success' ? 'text-emerald-500' : 'text-red-500'}`} />
          <div>{toastMessage.text}</div>
        </div>
      )}

{/* Cash Replenishment Request Modal */}
      {showCashRequestModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-lg border border-slate-200 shadow-xl max-w-sm w-full p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <div className="flex items-center gap-2">
                <HandCoins className="h-4 w-4 text-slate-700" />
                <h3 className="text-sm font-bold text-slate-900">Request Cash from Office</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCashRequestModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCashRequestSubmit} className="space-y-3">
              <div>
                <label htmlFor="reqAmount" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  Amount Needed (INR) <span className="text-red-500">*</span>
                </label>
                <div className="relative mt-1">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500 text-sm">₹</span>
                  <input
                    id="reqAmount"
                    type="number"
                    required
                    min="100"
                    value={requestAmount}
                    onChange={(e) => setRequestAmount(e.target.value)}
                    placeholder="0"
                    className="block w-full rounded border border-slate-300 pl-7 pr-3 py-2 text-slate-950 text-sm min-h-[44px]"
                  />
                </div>
                {/* Quick preset chips for request */}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {[10000, 25000, 50000, 100000].map(val => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setRequestAmount(String(val))}
                      className="px-2 py-1 text-xs font-semibold rounded bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200"
                    >
                      ₹{(val / 1000)}k
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor="reqNote" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  Reason / Notes <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="reqNote"
                  required
                  rows={2}
                  value={requestNote}
                  onChange={(e) => setRequestNote(e.target.value)}
                  placeholder="e.g. Need cash for weekly worker advances & raw materials"
                  className="mt-1 block w-full rounded border border-slate-300 p-2 text-xs text-slate-950 focus:border-slate-500 focus:outline-none"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCashRequestModal(false)}
                  className="flex-1 rounded border border-slate-300 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 min-h-[40px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={requestLoading || !requestAmount || !requestNote.trim()}
                  className="flex-1 rounded bg-slate-900 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-50 min-h-[40px] flex items-center justify-center gap-1"
                >
                  {requestLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <span>Send Request</span>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Missing Worker Phone Modal (Prompt when disbursing or adding phone) */}
      {showPhoneModal && phoneModalWorker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-sm w-full p-5 space-y-4 relative">
            <button
              type="button"
              onClick={() => {
                if (!phoneModalLoading) {
                  setShowPhoneModal(false);
                  setPhoneModalWorker(null);
                  setPhoneModalDisburseDetails(null);
                }
              }}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 p-1"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 text-emerald-600">
                <Smartphone className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {phoneModalDisburseDetails ? 'Worker Has No Phone Saved' : 'Add Mobile Number'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  <strong>{phoneModalWorker.worker_name}</strong> needs a mobile number to receive free automated SMS payment receipts.
                </p>
              </div>
            </div>

            {phoneModalDisburseDetails && (
              <div className="p-3 bg-slate-50 rounded border border-slate-200 text-xs space-y-1">
                <div className="flex justify-between text-slate-600">
                  <span>Disbursing Amount:</span>
                  <span className="font-black text-slate-950 text-sm">{formatINR(phoneModalDisburseDetails.amount)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Remark:</span>
                  <span className="text-slate-800 font-medium">{phoneModalDisburseDetails.note}</span>
                </div>
              </div>
            )}

            <div>
              <label htmlFor="modalPhoneInput" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                Mobile Number <span className="text-emerald-600 font-bold">(10 Digits)</span>
              </label>
              <div className="relative mt-1">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500 text-sm font-semibold pointer-events-none">
                  +91
                </span>
                <input
                  id="modalPhoneInput"
                  type="tel"
                  autoFocus
                  maxLength={14}
                  value={phoneModalInput}
                  onChange={(e) => setPhoneModalInput(e.target.value)}
                  placeholder="e.g. 9876543210"
                  disabled={phoneModalLoading}
                  className="block w-full rounded border border-slate-300 pl-12 pr-3 py-2.5 text-slate-950 text-base font-medium min-h-[44px] bg-white focus:ring-2 focus:ring-slate-900 focus:border-slate-900"
                />
              </div>
              <p className="text-[11px] text-slate-500 mt-1.5">
                ✓ Saved permanently to {phoneModalWorker.worker_name}'s profile for future text receipts.
              </p>
            </div>

            {phoneModalError && (
              <div className="p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-700 font-medium">
                {phoneModalError}
              </div>
            )}

            <div className="space-y-2 pt-2">
              <button
                type="button"
                disabled={phoneModalLoading}
                onClick={() => handlePhoneModalAction(false)}
                className="w-full flex items-center justify-center gap-2 rounded bg-slate-900 hover:bg-slate-800 text-white font-semibold py-3 text-sm min-h-[46px] shadow transition-colors disabled:opacity-50"
              >
                {phoneModalLoading ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    <span>{phoneModalDisburseDetails ? 'Save Phone & Send SMS' : 'Save Mobile Number'}</span>
                  </>
                )}
              </button>

              {phoneModalDisburseDetails && (
                <button
                  type="button"
                  disabled={phoneModalLoading}
                  onClick={() => handlePhoneModalAction(true)}
                  className="w-full py-2.5 text-xs text-slate-600 hover:text-slate-900 font-semibold border border-slate-200 hover:bg-slate-50 rounded min-h-[42px] transition-colors"
                >
                  Disburse Without Phone (Skip SMS)
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Custom Confirmation Modal Overlay */}
      {confirmTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-lg border border-slate-200 shadow-xl max-w-sm w-full p-6 space-y-4">
            <div className="text-center space-y-2">
              <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-amber-50 border border-amber-200 text-amber-500">
                <AlertCircle className="h-6 w-6" />
              </div>
              <h3 className="text-base font-bold text-slate-900">Confirm Cash Receipt</h3>
              <p className="text-xs text-slate-500 leading-normal">
                Please verify that you have physically received the cash of{' '}
                <span className="font-extrabold text-slate-955">{formatINR(confirmTx.amount)}</span> from the Office.
              </p>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setConfirmTx(null)}
                disabled={actionLoading}
                className="flex-1 py-2.5 rounded border border-slate-300 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 min-h-[44px]"
              >
                Cancel
              </button>
              <button
                onClick={() => executeConfirmReceipt()}
                disabled={actionLoading}
                className="flex-1 py-2.5 rounded bg-emerald-600 hover:bg-emerald-700 text-xs font-semibold text-white min-h-[44px] flex items-center justify-center gap-1.5"
              >
                {actionLoading ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <span>Yes, Confirm</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Real-time Notifications Banner */}
      <NotificationBanner role="supervisor" />

      {/* Cash Replenishment Request Button */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-800 rounded-lg p-3.5 text-white flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-full bg-slate-800 flex items-center justify-center text-emerald-400 shrink-0">
            <HandCoins className="h-4 w-4" />
          </div>
          <div>
            <p className="text-xs font-bold text-white">Need Factory Cash?</p>
            <p className="text-[11px] text-slate-300">Request cash replenishment from Main Office</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowCashRequestModal(true)}
          className="px-3 py-1.5 rounded bg-white text-slate-950 text-xs font-bold hover:bg-slate-100 transition-colors shrink-0 shadow-sm min-h-[36px]"
        >
          Request Cash
        </button>
      </div>

      {/* 1. Pending Confirmations Alert */}
      {activePending.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <AlertCircle className="h-4 w-4 text-amber-500" />
            <span>Awaiting Your Confirmation</span>
          </h2>
          <div className="space-y-2">
            {activePending.map((tx) => (
              <div key={tx.id} className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex justify-between items-center shadow-sm">
                <div>
                  <p className="text-xs text-amber-700 font-bold uppercase">
                    {tx.type === 'office_to_supervisor' ? 'Office Disbursement' : 'Supervisor Transfer'}
                  </p>
                  <p className="text-sm font-black text-amber-950 mt-0.5">
                    {formatINR(tx.amount)}
                  </p>
                  <p className="text-[10px] text-amber-700 mt-1">
                    From: {tx.type === 'office_to_supervisor' ? 'Main Office' : tx.from?.name || 'Supervisor'}
                  </p>
                  {tx.note && <p className="text-xs text-amber-800 italic mt-0.5">"{tx.note}"</p>}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleConfirmClick(tx.id, tx.amount, tx.type)}
                    disabled={actionLoading}
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-600 hover:bg-emerald-700 text-white min-h-[44px] min-w-[44px]"
                  >
                    <Check className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => setDisputeTxId(tx.id)}
                    disabled={actionLoading}
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-red-600 hover:bg-red-700 text-white min-h-[44px] min-w-[44px]"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dispute Modal/Form */}
      {disputeTxId && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-bold text-red-950">Dispute Disbursement</h3>
          <form onSubmit={handleDisputeSubmit} className="space-y-3">
            <div>
              <label htmlFor="disputeNote" className="block text-xs font-semibold text-red-800 uppercase tracking-wider">
                Reason for dispute (Required)
              </label>
              <textarea
                id="disputeNote"
                required
                value={disputeNote}
                onChange={(e) => setDisputeNote(e.target.value)}
                placeholder="Explain why you are disputing the amount (e.g. incorrect cash count)..."
                className="mt-1 block w-full rounded border-red-300 p-2 text-xs focus:ring-red-500 focus:border-red-500 text-slate-900 bg-white"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setDisputeTxId(null); setDisputeNote(''); }}
                className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded min-h-[44px] min-w-[60px]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={actionLoading}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-red-600 rounded hover:bg-red-700 min-h-[44px] min-w-[60px]"
              >
                Submit Dispute
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 2. Quick Actions Tab Container */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
        {/* Tabs */}
        <div className="flex border-b border-slate-200 bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-600">
          <button
            onClick={() => { setActiveTab('disburse'); setActionMessage(null); setLastDisburseSms(null); }}
            className={`flex-1 py-3 text-center border-b-2 min-h-[44px] flex items-center justify-center gap-1.5 ${
              activeTab === 'disburse'
                ? 'border-slate-900 text-slate-900 bg-white'
                : 'border-transparent hover:bg-slate-100'
            }`}
          >
            <Send className="h-3.5 w-3.5" />
            <span>Disburse</span>
          </button>
          <button
            onClick={() => { setActiveTab('expense'); setActionMessage(null); }}
            className={`flex-1 py-3 text-center border-b-2 min-h-[44px] flex items-center justify-center gap-1.5 ${
              activeTab === 'expense'
                ? 'border-slate-900 text-slate-900 bg-white'
                : 'border-transparent hover:bg-slate-100'
            }`}
          >
            <IndianRupee className="h-3.5 w-3.5" />
            <span>Expense</span>
          </button>
          <button
            onClick={() => { setActiveTab('transfer'); setActionMessage(null); }}
            className={`flex-1 py-3 text-center border-b-2 min-h-[44px] flex items-center justify-center gap-1.5 ${
              activeTab === 'transfer'
                ? 'border-slate-900 text-slate-900 bg-white'
                : 'border-transparent hover:bg-slate-100'
            }`}
          >
            <ArrowRightLeft className="h-3.5 w-3.5" />
            <span>Transfer</span>
          </button>
        </div>

        {/* Tab content forms */}
        <div className="p-4">
          <form onSubmit={handleActionSubmit} className="space-y-4">
            
            {/* DISBURSE FORM */}
            {activeTab === 'disburse' && (
              <>
                {/* Worker Selector with Live Search & 1-Tap Quick Add */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                      Select Worker
                    </label>
                    {selectedWorkerId && (
                      <button
                        type="button"
                        onClick={() => { setSelectedWorkerId(''); setWorkerSearchTerm(''); }}
                        className="text-[11px] text-indigo-600 hover:text-indigo-800 font-bold"
                      >
                        Change Worker
                      </button>
                    )}
                  </div>

                  {!selectedWorkerId ? (
                    <div className="space-y-2">
                      {/* Search / Filter Input */}
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                        <input
                          type="text"
                          value={workerSearchTerm}
                          onChange={(e) => setWorkerSearchTerm(e.target.value)}
                          placeholder="Search worker name to pay..."
                          className="w-full pl-9 pr-3 py-2.5 rounded border border-slate-300 text-sm min-h-[44px] text-slate-950 bg-white focus:ring-2 focus:ring-slate-900 focus:border-slate-900 placeholder:text-slate-400"
                        />
                      </div>

                      {/* Filtered Dropdown / Quick List - Only shown when supervisor types */}
                      {workerSearchTerm.trim().length > 0 && (
                        <div className="border border-slate-200 rounded-lg max-h-56 overflow-y-auto divide-y divide-slate-100 bg-white shadow-lg">
                          {/* 1-Tap Quick Add Button if typed name isn't an exact match */}
                          {workerSearchTerm.trim().length > 1 && !activeWorkers.some(w => w.worker_name.toLowerCase() === workerSearchTerm.trim().toLowerCase()) && (
                            <div className="p-2 bg-indigo-50/70 border-b border-indigo-100">
                              <button
                                type="button"
                                onClick={() => handleQuickAddWorker(workerSearchTerm.trim())}
                                disabled={isQuickAddingWorker}
                                className="w-full py-2 px-3 rounded bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-xs font-bold flex items-center justify-between transition-colors shadow-xs"
                              >
                                <span className="flex items-center gap-1.5">
                                  <UserPlus className="h-4 w-4" />
                                  <span>Quick Add & Pay "{workerSearchTerm.trim()}"</span>
                                </span>
                                <span className="text-[10px] bg-white/20 px-1.5 py-0.5 rounded uppercase tracking-wider">1-Tap</span>
                              </button>
                            </div>
                          )}

                          {filteredSelectWorkers.length === 0 ? (
                            <div className="p-4 text-center text-xs text-slate-500">
                              No worker found matching "{workerSearchTerm}". Tap Quick Add above.
                            </div>
                          ) : (
                            filteredSelectWorkers.map((w) => (
                              <button
                                key={w.worker_id}
                                type="button"
                                onClick={() => {
                                  setSelectedWorkerId(w.worker_id);
                                  setWorkerSearchTerm('');
                                }}
                                className="w-full p-2.5 text-left flex items-center justify-between hover:bg-slate-50 active:bg-slate-100 transition-colors"
                              >
                                <div className="flex items-center gap-2.5">
                                  <div className="h-8 w-8 rounded-full bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
                                    {w.worker_photo_url ? (
                                      <img src={w.worker_photo_url} alt="" className="h-full w-full object-cover" />
                                    ) : (
                                      <User className="h-4 w-4 text-slate-400" />
                                    )}
                                  </div>
                                  <div>
                                    <p className="text-xs font-bold text-slate-900">{w.worker_name}</p>
                                    {w.worker_phone && (
                                      <p className="text-[11px] text-slate-500">
                                        {w.worker_phone}
                                      </p>
                                    )}
                                  </div>
                                </div>
                                <span className="text-xs font-bold text-red-600">
                                  {formatINR(w.running_advance)} adv
                                </span>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Selected Worker Card */
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="h-9 w-9 rounded-full bg-white border border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
                          {selectedWorker?.worker_photo_url ? (
                            <img src={selectedWorker.worker_photo_url} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <User className="h-5 w-5 text-slate-400" />
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-900">{selectedWorker?.worker_name}</p>
                          <p className="text-xs text-slate-500">
                            Current Advance: <span className="font-bold text-red-600">{formatINR(selectedWorker?.running_advance || 0)}</span>
                            {selectedWorker?.worker_phone && <span className="ml-1.5 text-emerald-600 font-semibold">✓ SMS Active</span>}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setSelectedWorkerId(''); setWorkerSearchTerm(''); }}
                        className="px-2.5 py-1 text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-100 transition-colors"
                      >
                        Change
                      </button>
                    </div>
                  )}
                </div>

                {/* Amount Input with Quick Preset Chips */}
                <div>
                  <label htmlFor="amount" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Amount (INR)
                  </label>
                  <div className="relative mt-1 rounded shadow-sm">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                      <span className="text-slate-500 text-sm">₹</span>
                    </div>
                    <input
                      id="amount"
                      name="amount"
                      type="number"
                      required
                      min="1"
                      value={disburseAmount}
                      onChange={(e) => setDisburseAmount(e.target.value)}
                      disabled={actionLoading}
                      placeholder="0"
                      className="block w-full rounded border border-slate-300 pl-7 pr-3 py-2 text-slate-950 text-sm min-h-[44px]"
                    />
                  </div>
                  {/* Quick Preset Amount Chips */}
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    {[500, 1000, 2000, 5000].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setDisburseAmount(prev => String((Number(prev) || 0) + val))}
                        className="px-2.5 py-1 text-xs font-semibold rounded bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 transition-colors"
                      >
                        +₹{val.toLocaleString('en-IN')}
                      </button>
                    ))}
                    {disburseAmount && (
                      <button
                        type="button"
                        onClick={() => setDisburseAmount('')}
                        className="px-2 py-1 text-xs font-semibold text-slate-400 hover:text-slate-600 ml-auto"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>

                {/* Notes / Remarks Input with 1-Tap Preset Remark Chips */}
                <div>
                  <div className="flex items-center justify-between">
                    <label htmlFor="note" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                      Notes / Remarks <span className="text-slate-400 font-normal">(Optional)</span>
                    </label>
                    {disburseNote && (
                      <button
                        type="button"
                        onClick={() => setDisburseNote('')}
                        className="text-[11px] text-slate-400 hover:text-slate-600 font-semibold"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <input
                    id="note"
                    name="note"
                    type="text"
                    value={disburseNote}
                    onChange={(e) => setDisburseNote(e.target.value)}
                    disabled={actionLoading}
                    placeholder="e.g. Cash Advance (default)"
                    className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-slate-950 text-sm min-h-[44px]"
                  />
                  {/* 1-Tap Preset Remark Chips */}
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    {['Hafta', 'Kharcha', 'Advance', 'Khuraki', 'Bonus', 'Emergency'].map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => setDisburseNote(chip)}
                        className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors ${
                          disburseNote === chip
                            ? 'bg-slate-900 text-white'
                            : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200'
                        }`}
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* EXPENSE FORM */}
            {activeTab === 'expense' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="amount" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                      Amount
                    </label>
                    <div className="relative mt-1 rounded shadow-sm">
                      <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                        <span className="text-slate-500 text-sm">₹</span>
                      </div>
                      <input
                        id="amount"
                        name="amount"
                        type="number"
                        required
                        min="1"
                        disabled={actionLoading}
                        placeholder="0"
                        className="block w-full rounded border border-slate-300 pl-7 pr-3 py-2 text-slate-950 text-sm min-h-[44px]"
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="category" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                      Category
                    </label>
                    <select
                      id="category"
                      name="category"
                      required
                      disabled={actionLoading}
                      className="mt-1 block w-full rounded border-slate-300 px-3 py-2 text-slate-950 text-sm min-h-[44px] bg-white"
                    >
                      <option value="wages">Wages</option>
                      <option value="materials">Materials</option>
                      <option value="transport">Transport</option>
                      <option value="maintenance">Maintenance</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label htmlFor="note" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Notes / Remarks <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="note"
                    name="note"
                    type="text"
                    required
                    disabled={actionLoading}
                    placeholder="e.g. Wages for temporary laborers"
                    className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-slate-950 text-sm min-h-[44px]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Receipt Photo (Optional)
                  </label>
                  <div className="mt-1 flex items-center gap-4">
                    <label className="flex items-center justify-center border border-dashed border-slate-300 rounded-md p-4 bg-slate-50 hover:bg-slate-100 cursor-pointer min-h-[48px] min-w-[120px] flex-1">
                      <Camera className="h-5 w-5 text-slate-400 mr-2" />
                      <span className="text-xs text-slate-600 font-semibold">Take Photo / Upload</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handlePhotoChange}
                        className="hidden"
                      />
                    </label>
                    {photoPreview && (
                      <div className="relative h-12 w-12 border border-slate-200 rounded overflow-hidden">
                        <img src={photoPreview} alt="Receipt preview" className="object-cover h-full w-full" />
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* TRANSFER FORM */}
            {activeTab === 'transfer' && (
              <>
                <div>
                  <label htmlFor="toSupervisorId" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Recipient Supervisor
                  </label>
                  <select
                    id="toSupervisorId"
                    name="toSupervisorId"
                    required
                    disabled={actionLoading}
                    className="mt-1 block w-full rounded border-slate-300 px-3 py-2 text-slate-950 text-sm min-h-[44px] bg-white"
                  >
                    <option value="">Choose supervisor...</option>
                    {activeOtherSups.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.factories?.name})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="amount" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Amount (INR)
                  </label>
                  <div className="relative mt-1 rounded shadow-sm">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                      <span className="text-slate-500 text-sm">₹</span>
                    </div>
                    <input
                      id="amount"
                      name="amount"
                      type="number"
                      required
                      min="1"
                      disabled={actionLoading}
                      placeholder="0"
                      className="block w-full rounded border border-slate-300 pl-7 pr-3 py-2 text-slate-950 text-sm min-h-[44px]"
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="note" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Notes / Remarks <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="note"
                    name="note"
                    type="text"
                    required
                    disabled={actionLoading}
                    placeholder="e.g. Short cash transfer"
                    className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-slate-950 text-sm min-h-[44px]"
                  />
                </div>
              </>
            )}

            {actionMessage && (
              <div className={`rounded p-3 border text-xs font-semibold ${
                actionMessage.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'
              }`}>
                {actionMessage.text}
              </div>
            )}

            {/* Free SMS 1-Tap Mobile Dispatch Pill */}
            {lastDisburseSms && activeTab === 'disburse' && (
              <div className="rounded-lg p-3 bg-emerald-50 border border-emerald-300 flex items-center justify-between gap-2 shadow-xs animate-fadeIn">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-emerald-600 shrink-0" />
                  <div>
                    <p className="text-xs font-bold text-emerald-950">Send Worker SMS Confirmation</p>
                    <p className="text-[11px] text-emerald-700">Pre-filled text receipt for {lastDisburseSms.workerName}</p>
                  </div>
                </div>
                <a
                  href={lastDisburseSms.smsUri}
                  className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shrink-0 shadow-sm transition-colors flex items-center gap-1"
                >
                  <span>Dispatch SMS</span>
                </a>
              </div>
            )}

            <button
              type="submit"
              disabled={actionLoading || (activeTab === 'disburse' && (!selectedWorkerId || !disburseAmount))}
              className="w-full flex justify-center items-center rounded-md bg-slate-900 py-3 text-sm font-semibold text-white shadow hover:bg-slate-800 disabled:opacity-50 min-h-[46px] gap-2 transition-all"
            >
              {actionLoading ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : activeTab === 'disburse' ? (
                <span>Disburse {disburseAmount ? formatINR(Number(disburseAmount)) : 'Cash'}</span>
              ) : (
                <span>Submit Entry</span>
              )}
            </button>
          </form>
        </div>
      </div>

      {/* 3. Unified Transaction History Section (All Cash Spending: Expenses & Worker Advances) */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-slate-800" />
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                Transaction History
              </h2>
              <p className="text-[11px] text-slate-500">
                Unified record of every cash expense & worker advance
              </p>
            </div>
          </div>

          <span className="text-[11px] font-black text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full shrink-0">
            {formatINR(totalSpendingAmount)} spent
          </span>
        </div>

        {/* Search & Filter Controls */}
        <div className="p-3 bg-white border-b border-slate-100 space-y-2.5">
          {/* Co-Supervisor Filter (Only if multiple supervisors exist in the factory) */}
          {hasCoSupervisors && (
            <div className="flex items-center justify-between pb-1 text-xs">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Show:</span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setHistorySupervisorFilter('all')}
                  className={`px-2.5 py-0.5 rounded text-[11px] font-bold transition-colors ${
                    historySupervisorFilter === 'all'
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  All Factory ({combinedTransactions.length})
                </button>
                <button
                  type="button"
                  onClick={() => setHistorySupervisorFilter('my')}
                  className={`px-2.5 py-0.5 rounded text-[11px] font-bold transition-colors ${
                    historySupervisorFilter === 'my'
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  My Account ({combinedTransactions.filter(t => t.isOwn).length})
                </button>
              </div>
            </div>
          )}

          {/* Live Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={historySearchQuery}
              onChange={(e) => setHistorySearchQuery(e.target.value)}
              placeholder="Search transactions (worker, transfer, expense, note)..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-xs min-h-[38px] text-slate-950 bg-white placeholder:text-slate-400 focus:ring-2 focus:ring-slate-900 focus:border-slate-900"
            />
          </div>

          {/* Type Filter Pills: All, Worker Advances, Transfers, Cash Expenses, Refunds */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
            {[
              { id: 'all', label: `All (${combinedTransactions.length})` },
              { id: 'advances', label: `Advances (${combinedTransactions.filter(t => t.kind === 'advance').length})` },
              { id: 'transfers', label: `Transfers (${combinedTransactions.filter(t => t.kind === 'transfer_sent' || t.kind === 'transfer_received').length})` },
              { id: 'expenses', label: `Expenses (${combinedTransactions.filter(t => t.kind === 'expense').length})` },
              { id: 'refunds', label: `Refunds (${combinedTransactions.filter(t => t.kind === 'advance_refund' || t.isRefunded).length})` },
            ].map((pill) => (
              <button
                key={pill.id}
                type="button"
                onClick={() => setHistoryTypeFilter(pill.id as any)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-bold shrink-0 transition-colors ${
                  historyTypeFilter === pill.id
                    ? 'bg-slate-900 text-white shadow-2xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {pill.label}
              </button>
            ))}
          </div>
        </div>

        {/* Unified Transaction History List */}
        {filteredTransactions.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            {historySearchQuery || historyTypeFilter !== 'all'
              ? 'No transactions matching your search or filter.'
              : 'No transactions recorded yet for this factory or account.'}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 bg-white">
            {(isHistoryExpanded ? filteredTransactions : filteredTransactions.slice(0, 8)).map((tx) => {
              const dateObj = new Date(tx.created_at);
              const dateStr = dateObj.toLocaleDateString([], { month: 'short', day: 'numeric' });
              const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

              return (
                <li key={tx.id} className="p-3.5 space-y-2 hover:bg-slate-50/70 transition-colors">
                  {/* Top Row: Type/Category Badge & Amount */}
                  <div className="flex items-center justify-between gap-2">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border uppercase tracking-wider ${tx.badgeClass}`}>
                      {tx.badgeIcon}
                      <span>{tx.categoryLabel}</span>
                    </span>
                    <div className="text-right">
                      {tx.isRefunded ? (
                        <div className="flex items-center gap-1.5 justify-end">
                          <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded font-bold uppercase">
                            Refunded
                          </span>
                          <span className="text-sm font-black line-through text-slate-400">
                            {formatINR(tx.amount)}
                          </span>
                        </div>
                      ) : tx.direction === 'inflow' ? (
                        <div className="flex items-center gap-1 justify-end">
                          <span className="text-[10px] text-emerald-600 font-bold uppercase mr-1">
                            {tx.kind === 'advance_refund' ? 'Credited' : 'Received'}
                          </span>
                          <span className="text-sm font-black text-emerald-600">
                            +{formatINR(tx.amount)}
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 justify-end">
                          <span className="text-xs text-slate-400 font-semibold uppercase mr-1">
                            {tx.kind === 'transfer_sent' ? 'Sent' : 'Spent'}
                          </span>
                          <span className="text-sm font-black text-red-600">
                            -{formatINR(tx.amount)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Middle Row: Title & Subtitle */}
                  <div>
                    <p className="text-xs font-bold text-slate-900 leading-snug">
                      {tx.title}
                    </p>
                    {tx.subtitle && tx.subtitle !== tx.title && (
                      <p className="text-[11px] text-slate-500 line-clamp-1 mt-0.5">
                        {tx.subtitle}
                      </p>
                    )}
                  </div>

                  {/* Bottom Row: Timestamp, Supervisor Attribution, and Proof/Receipt Button */}
                  <div className="flex items-center justify-between pt-1 text-[11px] text-slate-400 border-t border-slate-50">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span>
                        {dateStr} at {timeStr}
                      </span>
                      {tx.supervisorName && (
                        <span className="text-[10px] font-semibold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
                          {tx.isOwn ? 'By You' : `By ${tx.supervisorName}`}
                        </span>
                      )}
                    </div>

                    {tx.photoUrl ? (
                      <button
                        type="button"
                        onClick={() => {
                          setViewingPhotoUrl(tx.photoUrl);
                          setViewingPhotoTitle(tx.photoTitle);
                        }}
                        className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded cursor-pointer transition-colors shadow-2xs"
                      >
                        <Camera className="h-3 w-3 text-emerald-600" />
                        <span>{tx.photoButtonLabel}</span>
                      </button>
                    ) : tx.kind === 'advance' ? (
                      <span className="text-[10px] text-slate-400 italic">No photo</span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* View All / Collapse Button if > 8 entries */}
        {filteredTransactions.length > 8 && (
          <div className="p-2.5 bg-slate-50 text-center border-t border-slate-100">
            <button
              type="button"
              onClick={() => setIsHistoryExpanded(!isHistoryExpanded)}
              className="text-xs font-bold text-indigo-600 hover:text-indigo-800 transition-colors"
            >
              {isHistoryExpanded
                ? '▲ Show Recent (8)'
                : `▼ View All (${filteredTransactions.length}) Transactions`}
            </button>
          </div>
        )}
      </div>

      {/* 3. Workers List Panel */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-900">Workers Registry</h2>
          <button
            onClick={() => { setShowAddWorker(!showAddWorker); setActionMessage(null); }}
            className="flex items-center gap-1 text-slate-800 font-bold text-xs border border-slate-200 bg-white rounded px-2.5 py-1 hover:bg-slate-50 min-h-[36px]"
          >
            <UserPlus className="h-3.5 w-3.5" />
            <span>{showAddWorker ? 'Cancel' : 'Add Worker'}</span>
          </button>
        </div>

        {/* Add Worker Inline Form */}
        {showAddWorker && (
          <div className="p-4 border-b border-slate-200 bg-slate-50">
            <h3 className="text-xs font-bold text-slate-900 uppercase mb-3">Add Worker Profile</h3>
            <form onSubmit={handleAddWorkerSubmit} className="space-y-4">
              <div>
                <label htmlFor="name" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  Worker Name
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  required
                  disabled={actionLoading}
                  className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-slate-950 text-sm min-h-[44px] bg-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="phone" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Mobile Number (SMS Alert)
                  </label>
                  <div className="relative mt-1">
                    <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center text-slate-400 text-xs font-bold pointer-events-none">+91</span>
                    <input
                      id="phone"
                      name="phone"
                      type="tel"
                      placeholder="10-digit mobile"
                      maxLength={14}
                      disabled={actionLoading}
                      className="block w-full rounded border border-slate-300 pl-10 pr-2 py-2 text-slate-950 text-sm min-h-[44px] bg-white"
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="openingAdvance" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Opening Advance
                  </label>
                  <input
                    id="openingAdvance"
                    name="openingAdvance"
                    type="number"
                    min="0"
                    disabled={actionLoading}
                    placeholder="0"
                    className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-slate-950 text-sm min-h-[44px] bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Worker Photo (Optional)
                </label>
                <div className="flex items-center gap-3">
                  {photoPreview && (
                    <div className="relative h-14 w-14 rounded-full border-2 border-emerald-500 overflow-hidden shrink-0 shadow-sm bg-slate-100">
                      <img src={photoPreview} alt="Worker preview" className="object-cover h-full w-full" />
                      <button
                        type="button"
                        onClick={() => {
                          if (photoPreview.startsWith('blob:')) URL.revokeObjectURL(photoPreview);
                          setPhotoFile(null);
                          setPhotoPreview(null);
                        }}
                        className="absolute top-0 right-0 bg-slate-900/80 text-white rounded-full p-1 hover:bg-red-600 transition-colors"
                        title="Remove photo"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )}

                  <div className="flex-1 flex items-center gap-2">
                    {/* 1-Tap In-App Camera Viewfinder */}
                    <button
                      type="button"
                      onClick={() => setShowCameraModal(true)}
                      disabled={actionLoading}
                      className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-800 text-xs font-semibold py-2.5 px-3 min-h-[44px] shadow-sm transition-all"
                    >
                      <Camera className="h-4 w-4 text-emerald-600" />
                      <span>{photoPreview ? 'Retake Photo' : 'Take Photo'}</span>
                    </button>

                    {/* Secondary Gallery Upload */}
                    <label
                      className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-white hover:bg-slate-50 text-slate-600 text-xs font-medium py-2.5 px-3 min-h-[44px] cursor-pointer shadow-sm transition-all"
                      title="Upload from gallery"
                    >
                      <Upload className="h-3.5 w-3.5 text-slate-400" />
                      <span>Gallery</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handlePhotoChange}
                        disabled={actionLoading}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={actionLoading}
                className="w-full flex justify-center items-center rounded bg-slate-900 py-2.5 text-sm font-semibold text-white shadow hover:bg-slate-800 disabled:opacity-50 min-h-[44px] gap-2"
              >
                {actionLoading ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <span>Add to Registry</span>
                )}
              </button>
            </form>
          </div>
        )}

        {/* Search */}
        <div className="p-3 bg-white border-b border-slate-100 flex items-center relative">
          <Search className="absolute left-6 h-4 w-4 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search workers by name or phone..."
            className="w-full pl-9 pr-3 py-2 rounded border border-slate-300 text-xs focus:ring-slate-500 focus:border-slate-500 text-slate-950 min-h-[44px]"
          />
        </div>

        {/* Workers List */}
        {workersLoading && activeWorkers.length === 0 ? (
          <div className="p-8 text-center">
            <RefreshCw className="h-6 w-6 animate-spin text-slate-400 mx-auto" />
            <p className="text-xs text-slate-500 mt-2">Loading worker registry...</p>
          </div>
        ) : filteredWorkers.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No workers found. Tap "Add Worker" above to add one.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 bg-white">
            {filteredWorkers.map((w) => (
              <li key={w.worker_id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="relative h-12 w-12 rounded-full border border-slate-200 bg-slate-100 overflow-hidden flex items-center justify-center shrink-0">
                    {w.worker_photo_url ? (
                      <img src={w.worker_photo_url} alt={w.worker_name} loading="lazy" decoding="async" className="object-cover h-full w-full" />
                    ) : (
                      <User className="h-6 w-6 text-slate-400" />
                    )}
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">{w.worker_name}</h4>
                    {w.worker_phone ? (
                      <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                        <Phone className="h-3 w-3 text-emerald-600 shrink-0" />
                        <span>{w.worker_phone}</span>
                      </p>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setPhoneModalWorker(w);
                          setPhoneModalDisburseDetails(null);
                          setPhoneModalInput('');
                          setPhoneModalError('');
                          setShowPhoneModal(true);
                        }}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-2 py-0.5 rounded mt-1 transition-colors"
                      >
                        <Phone className="h-3 w-3" />
                        <span>+ Add Phone</span>
                      </button>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-xs text-slate-400 block">Advance Balance</span>
                  <span className="text-sm font-black text-red-600">{formatINR(w.running_advance)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 1-Tap In-App Camera Viewfinder */}
      <CameraCaptureModal
        isOpen={showCameraModal}
        onClose={() => setShowCameraModal(false)}
        onCapture={(file, previewUrl) => {
          setPhotoFile(file);
          setPhotoPreview((prev) => {
            if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
            return previewUrl;
          });
        }}
        title="Take Worker Photo"
        defaultFacingMode="environment"
      />

      {/* 1-Tap Cash Handover Photo Viewfinder */}
      <CameraCaptureModal
        isOpen={showHandoverModal}
        onClose={() => {
          setShowHandoverModal(false);
          setPendingDisburse(null);
        }}
        onCapture={(file) => handleHandoverCapture(file)}
        onSkip={() => handleHandoverCapture(null)}
        skipLabel="Skip Photo"
        title="Cash Handover Photo"
        subtitle={pendingDisburse ? `Handing ${formatINR(pendingDisburse.amount)} to ${pendingDisburse.targetWorker.worker_name}` : undefined}
        defaultFacingMode="environment"
      />

      {/* Full-Screen Photo Viewer Modal */}
      {viewingPhotoUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full overflow-hidden flex flex-col shadow-2xl">
            <div className="p-3 flex items-center justify-between border-b border-slate-800">
              <span className="text-xs font-bold text-slate-100 uppercase tracking-wider truncate mr-2">
                {viewingPhotoTitle || 'Proof of Handover'}
              </span>
              <button
                type="button"
                onClick={() => {
                  setViewingPhotoUrl(null);
                  setViewingPhotoTitle('Proof of Handover');
                }}
                className="text-slate-400 hover:text-white p-1 rounded-full hover:bg-slate-800 min-h-[36px] min-w-[36px] flex items-center justify-center shrink-0"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="aspect-square w-full bg-black flex items-center justify-center overflow-hidden">
              <img
                src={viewingPhotoUrl}
                alt="Document Attachment"
                className="w-full h-full object-contain"
              />
            </div>
            <div className="p-3 bg-slate-900 border-t border-slate-800 text-center">
              <button
                type="button"
                onClick={() => {
                  setViewingPhotoUrl(null);
                  setViewingPhotoTitle('Proof of Handover');
                }}
                className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
