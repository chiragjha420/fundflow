'use client';

import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createBrowserClient } from '@/lib/supabase/browser-client';
import { getOfflineCache, setOfflineCache } from '@/lib/offline-db';
import { formatINR } from '@/lib/utils';
import { 
  disburseToWorkerAction, 
  transferToSupervisorAction, 
  logExpenseAction, 
  confirmTransactionAction, 
  createWorkerAction,
  disputeTransactionAction
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
  RefreshCw
} from 'lucide-react';

interface Worker {
  worker_id: string;
  worker_name: string;
  worker_phone: string | null;
  worker_photo_url: string | null;
  factory_id: string;
  supervisor_id: string;
  opening_advance: number;
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

export function SupervisorClientPage() {
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

  // Form loading states
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmTx, setConfirmTx] = useState<{ id: string; amount: number; type: string } | null>(null);
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const showToast = (type: 'success' | 'error', text: string) => {
    setToastMessage({ type, text });
    setTimeout(() => {
      setToastMessage(null);
    }, 5000);
  };

  // 1. Get Supervisor Info
  const { data: supervisor } = useQuery({
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
        await setOfflineCache('supervisor-info', data);
        return data;
      } catch (e) {
        console.warn('Network query failed, trying local cache for supervisor info:', e);
        const cached = await getOfflineCache<any>('supervisor-info');
        if (cached) return cached;
        throw e;
      }
    },
    staleTime: 5 * 60 * 1000,
  });

  const supervisorId = supervisor?.id;
  const factoryId = supervisor?.factory_id;

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
      return data as unknown as PendingTx[];
    },
    placeholderData: () => {
      return [] as any;
    },
    enabled: !!supervisorId,
  });

  const [cachedPending, setCachedPending] = useState<PendingTx[]>([]);
  useEffect(() => {
    if (supervisorId) {
      getOfflineCache<PendingTx[]>(`incoming-pending-${supervisorId}`).then(data => {
        if (data) setCachedPending(data);
      });
    }
  }, [supervisorId, pendingTxs]);

  const activePending = pendingTxs !== undefined ? pendingTxs : cachedPending;

  // 3. Fetch Workers List
  const { data: workers, isLoading: workersLoading } = useQuery({
    queryKey: ['workers', factoryId],
    queryFn: async () => {
      if (!factoryId) return [];
      const { data, error } = await supabase
        .from('worker_balances')
        .select('*')
        .eq('factory_id', factoryId)
        .eq('active', true);

      if (error) throw error;
      
      await setOfflineCache(`workers-${factoryId}`, data);
      return data as Worker[];
    },
    placeholderData: () => {
      return [] as any;
    },
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
      return data as unknown as Supervisor[];
    },
    placeholderData: () => {
      return [] as any;
    },
  });

  const [cachedSups, setCachedSups] = useState<Supervisor[]>([]);
  useEffect(() => {
    getOfflineCache<Supervisor[]>('supervisors-list').then(data => {
      if (data) setCachedSups(data);
    });
  }, [otherSupervisors]);

  const activeOtherSups = (otherSupervisors !== undefined ? otherSupervisors : cachedSups)
    .filter(s => s.id !== supervisorId);

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

  // Quick Action Forms Submission
  const handleActionSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setActionLoading(true);
    setActionMessage(null);

    const formData = new FormData(e.currentTarget);
    const form = e.currentTarget;

    try {
      if (activeTab === 'disburse') {
        const workerId = formData.get('workerId') as string;
        const amount = parseFloat(formData.get('amount') as string);
        const note = formData.get('note') as string;

        if (!workerId || isNaN(amount) || amount <= 0) {
          throw new Error('Please select a worker and specify positive amount.');
        }

        const res = await disburseToWorkerAction(workerId, supervisorId!, amount, note);
        if (res.queued) {
          setActionMessage({ type: 'success', text: 'Offline: Disbursement queued. Worker balance will sync later.' });
        } else {
          setActionMessage({ type: 'success', text: 'Disbursement logged successfully.' });
        }
        form.reset();
      } else if (activeTab === 'transfer') {
        const toSupervisorId = formData.get('toSupervisorId') as string;
        const amount = parseFloat(formData.get('amount') as string);
        const note = formData.get('note') as string;

        if (!toSupervisorId || isNaN(amount) || amount <= 0) {
          throw new Error('Please select a supervisor and specify positive amount.');
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
        const note = formData.get('note') as string;

        if (isNaN(amount) || amount <= 0 || !category || !note) {
          throw new Error('Amount, Category, and Notes are required.');
        }

        // Handle Photo Upload (for now standard storage if online)
        let photoUrl: string | null = null;
        if (photoFile && navigator.onLine) {
          const fileExt = photoFile.name.split('.').pop();
          const fileName = `${supervisorId}-${Date.now()}.${fileExt}`;
          const { data, error } = await supabase.storage
            .from('worker-photos') // Using existing bucket
            .upload(`receipts/${fileName}`, photoFile);
          
          if (!error && data) {
            const { data: { publicUrl } } = supabase.storage
              .from('worker-photos')
              .getPublicUrl(data.path);
            photoUrl = publicUrl;
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

      // Image upload
      let photoUrl: string | null = null;
      if (photoFile && navigator.onLine) {
        const fileExt = photoFile.name.split('.').pop();
        const fileName = `${Date.now()}.${fileExt}`;
        const { data, error } = await supabase.storage
          .from('worker-photos')
          .upload(`workers/${fileName}`, photoFile);

        if (!error && data) {
          const { data: { publicUrl } } = supabase.storage
            .from('worker-photos')
            .getPublicUrl(data.path);
          photoUrl = publicUrl;
        }
      } else if (photoFile && !navigator.onLine) {
        const reader = new FileReader();
        photoUrl = await new Promise((resolve) => {
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(photoFile);
        });
      }

      const res = await createWorkerAction(factoryId!, supervisorId!, name, phone, photoUrl, openingAdvance);
      if (res.queued) {
        setActionMessage({ type: 'success', text: 'Offline: Worker created locally. Will sync with server.' });
      } else {
        setActionMessage({ type: 'success', text: 'Worker profile created successfully.' });
      }

      form.reset();
      setPhotoFile(null);
      setPhotoPreview(null);
      setShowAddWorker(false);
      queryClient.invalidateQueries();
    } catch (e: any) {
      setActionMessage({ type: 'error', text: e.message });
    } finally {
      setActionLoading(false);
    }
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setPhotoFile(file);
      setPhotoPreview(URL.createObjectURL(file));
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
            onClick={() => { setActiveTab('disburse'); setActionMessage(null); }}
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
                <div>
                  <label htmlFor="workerId" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Select Worker
                  </label>
                  <select
                    id="workerId"
                    name="workerId"
                    required
                    disabled={actionLoading}
                    className="mt-1 block w-full rounded border-slate-300 px-3 py-2 text-slate-950 text-sm min-h-[44px] bg-white"
                  >
                    <option value="">Choose worker...</option>
                    {activeWorkers.map((w) => (
                      <option key={w.worker_id} value={w.worker_id}>
                        {w.worker_name} ({formatINR(w.running_advance)} advance)
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
                    Notes
                  </label>
                  <input
                    id="note"
                    name="note"
                    type="text"
                    disabled={actionLoading}
                    placeholder="Weekly advance pay"
                    className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-slate-950 text-sm min-h-[44px]"
                  />
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
                    Notes
                  </label>
                  <input
                    id="note"
                    name="note"
                    type="text"
                    required
                    disabled={actionLoading}
                    placeholder="Wages for temporary laborers"
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
                        capture="environment"
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
                    Notes
                  </label>
                  <input
                    id="note"
                    name="note"
                    type="text"
                    disabled={actionLoading}
                    placeholder="Short cash transfer"
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

            <button
              type="submit"
              disabled={actionLoading}
              className="w-full flex justify-center items-center rounded-md bg-slate-900 py-3 text-sm font-semibold text-white shadow hover:bg-slate-800 disabled:opacity-50 min-h-[44px] gap-2"
            >
              {actionLoading ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <span>Submit Entry</span>
              )}
            </button>
          </form>
        </div>
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
                    Phone (Optional)
                  </label>
                  <input
                    id="phone"
                    name="phone"
                    type="tel"
                    disabled={actionLoading}
                    className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-slate-950 text-sm min-h-[44px] bg-white"
                  />
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
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  Worker Photo (Optional)
                </label>
                <div className="mt-1 flex items-center gap-4">
                  <label className="flex items-center justify-center border border-dashed border-slate-300 rounded-md p-3 bg-white hover:bg-slate-50 cursor-pointer min-h-[44px] flex-1">
                    <Camera className="h-4 w-4 text-slate-400 mr-2" />
                    <span className="text-xs text-slate-600 font-semibold">Take Photo / Upload</span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="user"
                      onChange={handlePhotoChange}
                      className="hidden"
                    />
                  </label>
                  {photoPreview && (
                    <div className="relative h-12 w-12 border border-slate-200 rounded overflow-hidden">
                      <img src={photoPreview} alt="Worker preview" className="object-cover h-full w-full" />
                    </div>
                  )}
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
              <li key={w.worker_id} className="p-4 flex items-center justify-between hover:bg-slate-50">
                <div className="flex items-center gap-3">
                  <div className="relative h-12 w-12 rounded-full border border-slate-200 bg-slate-100 overflow-hidden flex items-center justify-center">
                    {w.worker_photo_url ? (
                      <img src={w.worker_photo_url} alt={w.worker_name} className="object-cover h-full w-full" />
                    ) : (
                      <User className="h-6 w-6 text-slate-400" />
                    )}
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">{w.worker_name}</h4>
                    {w.worker_phone && <p className="text-xs text-slate-500">{w.worker_phone}</p>}
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
    </div>
  );
}
