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
  disputeTransactionAction,
  updateWorkerAction,
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
  Phone
} from 'lucide-react';
import { sendWorkerDisbursementSms } from '@/lib/sms';
import { createCashRequest } from '@/app/actions/cash-requests';
import { playAlertSound } from '@/lib/notifications';
import { NotificationBanner } from '@/components/notification-banner';

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

export interface SupervisorClientPageProps {
  initialData?: {
    supervisor?: Supervisor | null;
    workers?: Worker[];
    pendingTxs?: PendingTx[];
    otherSupervisors?: Supervisor[];
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

  // Form loading states
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmTx, setConfirmTx] = useState<{ id: string; amount: number; type: string } | null>(null);
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Quick Amount Preset state for Disbursal
  const [disburseAmount, setDisburseAmount] = useState<string>('');
  const [selectedWorkerId, setSelectedWorkerId] = useState<string>('');
  const [lastDisburseSms, setLastDisburseSms] = useState<{ workerName: string; smsUri: string } | null>(null);

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
        showToast('success', `Cash request for ${formatINR(numAmount)} sent to Main Office!`);
        playAlertSound('cash_in');
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
      try { localStorage.setItem(`fundflow_cached_workers_${factoryId}`, JSON.stringify(data)); } catch {}
      return data as Worker[];
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

  // Helper to execute disbursement and dispatch SMS
  const executeDisbursement = async (
    targetWorker: Worker,
    amount: number,
    note: string,
    overridePhone?: string
  ) => {
    const res = await disburseToWorkerAction(targetWorker.worker_id, supervisorId!, amount, note);
    if (res.queued) {
      setActionMessage({ type: 'success', text: 'Offline: Disbursement queued. Worker balance will sync later.' });
    } else {
      setActionMessage({ type: 'success', text: `Disbursement of ${formatINR(amount)} logged successfully.` });
      playAlertSound('cash_in');

      // Free Automated Text Message to Worker (strictly confirms amount received)
      const phoneToUse = overridePhone || targetWorker.worker_phone;
      if (phoneToUse) {
        sendWorkerDisbursementSms({
          workerPhone: phoneToUse,
          workerName: targetWorker.worker_name,
          amount,
          supervisorName: supervisor?.name,
          factoryName: (supervisor?.factories as any)?.name,
          note,
        }).then(smsRes => {
          if (smsRes.sentViaGateway) {
            showToast('success', `Free automated SMS sent to ${targetWorker.worker_name} (${phoneToUse})!`);
          } else if (smsRes.smsUri) {
            setLastDisburseSms({
              workerName: targetWorker.worker_name,
              smsUri: smsRes.smsUri,
            });
          }
        });
      }
    }
    queryClient.invalidateQueries();
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

      // If triggered during disbursement, complete the disbursement now
      if (phoneModalDisburseDetails) {
        await executeDisbursement(
          phoneModalWorker,
          phoneModalDisburseDetails.amount,
          phoneModalDisburseDetails.note,
          savedPhone
        );
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
        const note = (formData.get('note') as string)?.trim();

        if (!workerId || isNaN(amount) || amount <= 0 || !note) {
          throw new Error('Please select a worker, specify positive amount, and enter notes/remarks.');
        }

        const targetWorker = activeWorkers.find(w => w.worker_id === workerId);
        if (!targetWorker) {
          throw new Error('Selected worker not found in active list.');
        }

        // POPUP: If worker has no phone, prompt supervisor to add phone or skip
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

        await executeDisbursement(targetWorker, amount, note);
        setDisburseAmount('');
        setSelectedWorkerId('');
        form.reset();
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
                <div>
                  <div className="flex items-center justify-between">
                    <label htmlFor="workerId" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                      Select Worker
                    </label>
                    {selectedWorkerId && (
                      <span className="text-[11px] text-slate-500 font-medium">
                        {activeWorkers.find(w => w.worker_id === selectedWorkerId)?.worker_name}
                      </span>
                    )}
                  </div>
                  <select
                    id="workerId"
                    name="workerId"
                    required
                    disabled={actionLoading}
                    value={selectedWorkerId}
                    onChange={(e) => setSelectedWorkerId(e.target.value)}
                    className="mt-1 block w-full rounded border-slate-300 px-3 py-2 text-slate-950 text-sm min-h-[44px] bg-white font-medium"
                  >
                    <option value="">Choose worker...</option>
                    {activeWorkers.map((w) => (
                      <option key={w.worker_id} value={w.worker_id}>
                        {w.worker_name} ({formatINR(w.running_advance)} advance){!w.worker_phone ? ' — ⚠️ No Phone' : ''}
                      </option>
                    ))}
                  </select>

                  {/* Selected Worker Phone Status Indicator */}
                  {(() => {
                    const target = activeWorkers.find(w => w.worker_id === selectedWorkerId);
                    if (!target) return null;

                    if (target.worker_phone) {
                      return (
                        <div className="mt-2 flex items-center gap-1.5 text-xs text-emerald-800 bg-emerald-50/80 border border-emerald-200/80 px-2.5 py-1.5 rounded">
                          <Smartphone className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                          <span>SMS alerts active: <strong>{target.worker_phone}</strong></span>
                        </div>
                      );
                    } else {
                      return (
                        <div className="mt-2 flex items-center justify-between text-xs text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1.5 rounded">
                          <div className="flex items-center gap-1.5">
                            <AlertCircle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                            <span>No phone saved (SMS receipt won't be sent)</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setPhoneModalWorker(target);
                              setPhoneModalDisburseDetails(null);
                              setPhoneModalInput('');
                              setPhoneModalError('');
                              setShowPhoneModal(true);
                            }}
                            className="font-bold text-amber-900 underline hover:text-amber-950 ml-2"
                          >
                            + Add Phone
                          </button>
                        </div>
                      );
                    }
                  })()}
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
                    placeholder="e.g. Weekly advance pay"
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
              <li key={w.worker_id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="relative h-12 w-12 rounded-full border border-slate-200 bg-slate-100 overflow-hidden flex items-center justify-center shrink-0">
                    {w.worker_photo_url ? (
                      <img src={w.worker_photo_url} alt={w.worker_name} className="object-cover h-full w-full" />
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
    </div>
  );
}
