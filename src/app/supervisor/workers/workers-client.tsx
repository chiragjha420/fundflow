'use client';

import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createBrowserClient } from '@/lib/supabase/browser-client';
import { getOfflineCache, setOfflineCache } from '@/lib/offline-db';
import { formatINR, parseHandoverNote } from '@/lib/utils';
import { updateWorkerAction } from '@/lib/ledger-actions';
import { uploadWorkerPhotoAction } from '@/app/actions/upload-actions';
import { 
  getFactoryWorkersAction, 
  getFactoryWorkerDisbursementsAction,
  getWorkerDisbursementsAction, 
  deleteWorkerServer,
  creditWorkerSalaryAction,
  recoverWorkerAdvanceAction,
  addWorkerSalaryWithDeductionAction,
  recordWorkerHisaabAction,
  createAdvanceCorrectionRequestAction
} from '@/app/actions/workers';
import { compressImage } from '@/lib/image-compressor';
import { CameraCaptureModal } from '@/components/camera-capture-modal';
import { 
  Search, 
  Camera, 
  User, 
  Edit2, 
  X, 
  Check, 
  RefreshCw, 
  AlertCircle, 
  Trash2,
  CalendarDays,
  Clock,
  Upload,
  Phone,
  Coins,
  Calculator,
  Plus,
  QrCode,
  CreditCard
} from 'lucide-react';

interface Worker {
  worker_id: string;
  worker_name: string;
  worker_phone: string | null;
  worker_photo_url: string | null;
  factory_id: string;
  supervisor_id: string;
  opening_advance: number;
  monthly_salary?: number;
  running_advance: number;
  unpaid_salary?: number;
  total_salary_earned?: number;
  total_salary_paid?: number;
  net_payable?: number;
  total_advance_given?: number;
  total_advance_recovered?: number;
  active: boolean;
}

interface WorkerPayment {
  id: string;
  amount: number;
  note: string | null;
  created_at: string;
  status: string;
  to_worker_id?: string | null;
}

export function SupervisorWorkersClientPage() {
  const supabase = createBrowserClient();
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [editingWorker, setEditingWorker] = useState<Worker | null>(null);
  const [expandedWorkerId, setExpandedWorkerId] = useState<string | null>(null);
  
  // Edit Form States
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [showCameraModal, setShowCameraModal] = useState<boolean>(false);
  const [viewingPhotoUrl, setViewingPhotoUrl] = useState<string | null>(null);

  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Hisaab Settlement Modal States
  const [showHisaabModal, setShowHisaabModal] = useState<boolean>(false);
  const [hisaabWorker, setHisaabWorker] = useState<Worker | null>(null);
  const [hisaabFromDate, setHisaabFromDate] = useState<string>(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
  });
  const [hisaabToDate, setHisaabToDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [hisaabTotalWages, setHisaabTotalWages] = useState<string>('');
  const [hisaabAdvanceDeduct, setHisaabAdvanceDeduct] = useState<string>('0');
  const [hisaabCashAmount, setHisaabCashAmount] = useState<string>('');
  const [hisaabOnlineAmount, setHisaabOnlineAmount] = useState<string>('');
  const [hisaabNote, setHisaabNote] = useState<string>('');
  const [hisaabLoading, setHisaabLoading] = useState<boolean>(false);
  const [hisaabError, setHisaabError] = useState<string>('');

  // Advance Correction Modal States (Supervisor -> Admin)
  const [showCorrectionModal, setShowCorrectionModal] = useState<boolean>(false);
  const [correctionWorker, setCorrectionWorker] = useState<Worker | null>(null);
  const [correctionRequestedAmount, setCorrectionRequestedAmount] = useState<string>('');
  const [correctionReason, setCorrectionReason] = useState<string>('');
  const [correctionLoading, setCorrectionLoading] = useState<boolean>(false);
  const [correctionError, setCorrectionError] = useState<string>('');

  // Settle Advance Modal States
  const [showSettleModal, setShowSettleModal] = useState<boolean>(false);
  const [settleWorker, setSettleWorker] = useState<Worker | null>(null);
  const [settleAmount, setSettleAmount] = useState<string>('');
  const [settleLoading, setSettleLoading] = useState<boolean>(false);
  const [settleError, setSettleError] = useState<string>('');

  const handleExecuteHisaab = async () => {
    if (!hisaabWorker || !factoryId) return;
    const wagesNum = parseFloat(hisaabTotalWages);
    const deductNum = Math.max(0, parseFloat(hisaabAdvanceDeduct || '0'));
    if (isNaN(wagesNum) || wagesNum <= 0) {
      setHisaabError('Please enter valid total wages earned.');
      return;
    }
    if (!hisaabFromDate || !hisaabToDate) {
      setHisaabError('Please specify both From and To dates.');
      return;
    }
    const currentAdv = hisaabWorker.running_advance || 0;
    if (deductNum > currentAdv) {
      setHisaabError(`Deduction cannot exceed worker advance of ${formatINR(currentAdv)}.`);
      return;
    }
    if (deductNum > wagesNum) {
      setHisaabError(`Deduction cannot exceed wages earned of ${formatINR(wagesNum)}.`);
      return;
    }

    const netWages = Math.max(0, wagesNum - deductNum);
    const cashNum = Math.max(0, parseFloat(hisaabCashAmount || '0'));
    const onlineNum = Math.max(0, parseFloat(hisaabOnlineAmount || '0'));

    if (cashNum + onlineNum > netWages) {
      setHisaabError(`Total payout (Cash: ₹${cashNum.toLocaleString('en-IN')} + Online: ₹${onlineNum.toLocaleString('en-IN')}) cannot exceed net wages of ₹${netWages.toLocaleString('en-IN')}.`);
      return;
    }

    setHisaabLoading(true);
    setHisaabError('');
    try {
      const res = await recordWorkerHisaabAction({
        workerId: hisaabWorker.worker_id,
        factoryId,
        supervisorId: supervisor?.id,
        fromDate: hisaabFromDate,
        toDate: hisaabToDate,
        totalWages: wagesNum,
        advanceDeducted: deductNum,
        cashPaid: cashNum,
        onlinePaid: onlineNum,
        note: hisaabNote || undefined,
      });

      if (!res.success) {
        setHisaabError(res.error || 'Failed to record Hisaab.');
        return;
      }

      setShowHisaabModal(false);
      setHisaabWorker(null);
      setHisaabTotalWages('');
      setHisaabAdvanceDeduct('0');
      setHisaabCashAmount('');
      setHisaabOnlineAmount('');
      setHisaabNote('');
      queryClient.invalidateQueries();
    } catch (err: any) {
      setHisaabError(err.message || 'Error recording Hisaab.');
    } finally {
      setHisaabLoading(false);
    }
  };

  const handleExecuteAdvanceCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!correctionWorker || !supervisor?.id) return;
    const requestedNum = parseFloat(correctionRequestedAmount);
    if (isNaN(requestedNum) || requestedNum < 0) {
      setCorrectionError('Please enter a valid requested advance amount (0 or positive).');
      return;
    }
    if (!correctionReason.trim()) {
      setCorrectionError('Please provide a reason for the correction.');
      return;
    }

    setCorrectionLoading(true);
    setCorrectionError('');
    try {
      const res = await createAdvanceCorrectionRequestAction({
        workerId: correctionWorker.worker_id,
        supervisorId: supervisor.id,
        currentAdvance: correctionWorker.running_advance || 0,
        requestedAdvance: requestedNum,
        reason: correctionReason.trim(),
      });

      if (!res.success) {
        setCorrectionError(res.error || 'Failed to submit correction request.');
        return;
      }

      setShowCorrectionModal(false);
      setCorrectionWorker(null);
      setCorrectionRequestedAmount('');
      setCorrectionReason('');
      queryClient.invalidateQueries();
    } catch (err: any) {
      setCorrectionError(err.message || 'Error submitting correction request.');
    } finally {
      setCorrectionLoading(false);
    }
  };

  const handleExecuteSettleAdvance = async () => {
    if (!settleWorker || !factoryId) return;
    const amountNum = parseFloat(settleAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setSettleError('Please enter a valid amount.');
      return;
    }
    setSettleLoading(true);
    setSettleError('');
    try {
      const res = await recoverWorkerAdvanceAction(
        settleWorker.worker_id,
        factoryId,
        amountNum,
        `Advance settled from ${settleWorker.worker_name} salary`
      );
      if (!res.success) {
        setSettleError(res.error || 'Failed to settle advance.');
        return;
      }

      queryClient.setQueryData(['workers', factoryId], (old: Worker[] | undefined) => {
        if (!old) return old;
        return old.map(w => {
          if (w.worker_id !== settleWorker.worker_id) return w;
          const newAdv = Math.max(0, (w.running_advance || 0) - amountNum);
          const newSal = Math.max(0, (w.unpaid_salary || 0) - amountNum);
          return {
            ...w,
            running_advance: newAdv,
            unpaid_salary: newSal,
            total_advance_recovered: (w.total_advance_recovered || 0) + amountNum,
            net_payable: newSal - newAdv,
          };
        });
      });

      setShowSettleModal(false);
      setSettleWorker(null);
      setSettleAmount('');
      queryClient.invalidateQueries();
    } catch (err: any) {
      setSettleError(err.message || 'Failed to settle advance.');
    } finally {
      setSettleLoading(false);
    }
  };

  const handleDeleteWorker = async () => {
    if (!editingWorker) return;
    setActionLoading(true);
    setActionMessage(null);
    setConfirmDelete(false);

    try {
      const res = await deleteWorkerServer(editingWorker.worker_id);
      if (!res.success) {
        throw new Error(res.error || 'Failed to remove worker.');
      }

      setActionMessage({ type: 'success', text: 'Worker successfully removed.' });
      setEditingWorker(null);
      queryClient.invalidateQueries({ queryKey: ['workers'] });
    } catch (e: any) {
      console.error('Delete worker failed:', e);
      setActionMessage({ type: 'error', text: e.message || 'Failed to remove worker.' });
    } finally {
      setActionLoading(false);
    }
  };

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
      const cached = await getOfflineCache<any>('supervisor-info');
      if (cached) return cached;
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) return null;
      const { data } = await supabase.from('supervisors').select('id, name, factory_id').eq('user_id', session.user.id).single();
      return data;
    },
    initialData: getStoredJson<any>('fundflow_cached_supervisor', null) || undefined,
    staleTime: Infinity,
  });

  const factoryId = supervisor?.factory_id;

  // 2. Fetch Workers (Unified across all supervisors in the factory)
  const { data: workers, isLoading } = useQuery({
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
    initialData: factoryId ? getStoredJson<Worker[]>(`fundflow_cached_workers_${factoryId}`, []) : [],
    enabled: !!factoryId,
  });

  // 3. Fetch Worker Payment History (via Server Action for co-supervisor sync)
  const { data: paymentHistory, isLoading: historyLoading } = useQuery({
    queryKey: ['worker-payments', editingWorker?.worker_id],
    queryFn: async () => {
      if (!editingWorker?.worker_id) return [];
      try {
        const data = await getWorkerDisbursementsAction(editingWorker.worker_id);
        return data as WorkerPayment[];
      } catch (err) {
        console.error('Failed to fetch worker payments:', err);
        return [];
      }
    },
    enabled: !!editingWorker?.worker_id,
  });

  // 4. Fetch All Worker Transactions for this factory for date filtering (Unified)
  const { data: allWorkerDisbursements } = useQuery({
    queryKey: ['factory-worker-disbursements', factoryId],
    queryFn: async () => {
      if (!factoryId) return [];
      try {
        const data = await getFactoryWorkerDisbursementsAction(factoryId);
        return (data || []) as WorkerPayment[];
      } catch (err) {
        return [];
      }
    },
    enabled: !!factoryId,
  });

  const isWithinDateRange = (isoStr: string, from?: string, to?: string) => {
    if (!from && !to) return true;
    const d = new Date(isoStr);
    if (from) {
      const start = new Date(from + 'T00:00:00');
      if (d < start) return false;
    }
    if (to) {
      const end = new Date(to + 'T23:59:59.999');
      if (d > end) return false;
    }
    return true;
  };

  const setDatePreset = (preset: 'today' | 'this_week' | 'this_month' | 'all') => {
    const now = new Date();
    if (preset === 'today') {
      const today = now.toISOString().split('T')[0];
      setFromDate(today);
      setToDate(today);
    } else if (preset === 'this_week') {
      const d = new Date();
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(d.setDate(diff)).toISOString().split('T')[0];
      const today = now.toISOString().split('T')[0];
      setFromDate(monday);
      setToDate(today);
    } else if (preset === 'this_month') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const today = now.toISOString().split('T')[0];
      setFromDate(firstDay);
      setToDate(today);
    } else if (preset === 'all') {
      setFromDate('');
      setToDate('');
    }
  };

  const getWorkerPeriodAdvance = (workerId: string) => {
    if (!allWorkerDisbursements) return 0;
    return allWorkerDisbursements
      .filter(tx => tx.to_worker_id === workerId && tx.status === 'confirmed' && isWithinDateRange(tx.created_at, fromDate, toDate))
      .reduce((sum, tx) => sum + Number(tx.amount), 0);
  };

  const getWorkerPeriodCount = (workerId: string) => {
    if (!allWorkerDisbursements) return 0;
    return allWorkerDisbursements
      .filter(tx => tx.to_worker_id === workerId && tx.status === 'confirmed' && isWithinDateRange(tx.created_at, fromDate, toDate))
      .length;
  };

  const [cachedWorkers, setCachedWorkers] = useState<Worker[]>([]);
  useEffect(() => {
    if (factoryId) {
      getOfflineCache<Worker[]>(`workers-${factoryId}`).then(data => {
        if (data) setCachedWorkers(data);
      });
    }
  }, [factoryId, workers]);

  const activeWorkers = workers !== undefined ? workers : cachedWorkers;

  // Handle Edit click
  const handleEditClick = (worker: Worker) => {
    setEditingWorker(worker);
    setEditName(worker.worker_name);
    setEditPhone(''); // Protect worker privacy - do not expose phone to supervisor
    setPhotoFile(null);
    setPhotoPreview(worker.worker_photo_url);
    setActionMessage(null);
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

  // Submit Edit Form
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingWorker) return;

    setActionLoading(true);
    setActionMessage(null);

    try {
      let finalPhotoUrl = editingWorker.worker_photo_url;

      // Handle Image Upload via Server Action (bypassing storage RLS)
      if (photoFile) {
        if (navigator.onLine) {
          try {
            const uploadData = new FormData();
            uploadData.append('file', photoFile);
            const uploadRes = await uploadWorkerPhotoAction(uploadData);
            if (uploadRes.success && uploadRes.publicUrl) {
              finalPhotoUrl = uploadRes.publicUrl;
            } else {
              console.warn('Worker photo upload failed, falling back to base64:', uploadRes.error);
              const reader = new FileReader();
              finalPhotoUrl = await new Promise((resolve) => {
                reader.onloadend = () => resolve(reader.result as string);
                reader.readAsDataURL(photoFile);
              });
            }
          } catch (storageErr) {
            console.warn('Storage exception, falling back to base64:', storageErr);
            try {
              const reader = new FileReader();
              finalPhotoUrl = await new Promise((resolve) => {
                reader.onloadend = () => resolve(reader.result as string);
                reader.readAsDataURL(photoFile);
              });
            } catch {}
          }
        } else {
          // Base64 storage offline
          try {
            const reader = new FileReader();
            finalPhotoUrl = await new Promise((resolve) => {
              reader.onloadend = () => resolve(reader.result as string);
              reader.readAsDataURL(photoFile);
            });
          } catch {}
        }
      }

      // If worker already has a phone, keep it locked. If adding for first time, save new phone.
      const phoneToSave = editingWorker.worker_phone 
        ? editingWorker.worker_phone 
        : (editPhone.trim() ? (editPhone.trim().length === 10 ? `+91${editPhone.trim()}` : editPhone.trim()) : null);

      const res = await updateWorkerAction(
        editingWorker.worker_id,
        editName,
        phoneToSave,
        finalPhotoUrl
      );

      if (res.queued) {
        setActionMessage({ type: 'success', text: 'Offline: Changes queued. Profile will update when synced.' });
      } else {
        setActionMessage({ type: 'success', text: 'Worker profile updated successfully.' });
      }

      queryClient.invalidateQueries();
      
      // Close form on success
      setTimeout(() => {
        setEditingWorker(null);
      }, 1500);

    } catch (e: any) {
      setActionMessage({ type: 'error', text: e.message });
    } finally {
      setActionLoading(false);
    }
  };

  const filteredWorkers = activeWorkers
    .filter(w => 
      w.worker_name.toLowerCase().includes(searchQuery.toLowerCase()) || 
      (w.worker_phone && w.worker_phone.includes(searchQuery))
    )
    .sort((a, b) => {
      if (fromDate || toDate) {
        const periodDiff = getWorkerPeriodAdvance(b.worker_id) - getWorkerPeriodAdvance(a.worker_id);
        if (periodDiff !== 0) return periodDiff;
      }
      return Number(b.running_advance) - Number(a.running_advance);
    });

  const totalPeriodSum = filteredWorkers.reduce((sum, w) => sum + getWorkerPeriodAdvance(w.worker_id), 0);
  const workersWithPeriodAdvanceCount = filteredWorkers.filter(w => getWorkerPeriodAdvance(w.worker_id) > 0).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Workers Profile Management</h1>
        <p className="text-xs text-slate-500 mt-0.5">Edit worker credentials. Cash advances must be modified via disbursements.</p>
      </div>

      {/* Edit Worker Section */}
      {editingWorker && (
        <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm space-y-4">
          <div className="flex justify-between items-center border-b border-slate-100 pb-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
              <Edit2 className="h-4 w-4 text-slate-600" />
              <span>Edit Worker: {editingWorker.worker_name}</span>
            </h3>
            <button
              onClick={() => setEditingWorker(null)}
              className="text-slate-400 hover:text-slate-600 min-h-[36px]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Profile Edit Form */}
            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div>
                <label htmlFor="editName" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  Full Name
                </label>
                <input
                  id="editName"
                  type="text"
                  required
                  disabled={actionLoading}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-slate-950 text-sm min-h-[44px] bg-white"
                />
              </div>

              {editingWorker.worker_phone ? (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Mobile Number
                  </label>
                  <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-md">
                    <div className="flex items-center gap-2">
                      <Phone className="h-4 w-4 text-emerald-600" />
                      <div>
                        <span className="text-xs font-bold text-slate-800 block">Phone Number Linked</span>
                        <span className="text-[10px] text-emerald-600 font-semibold">SMS confirmations active</span>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold text-slate-500 bg-white border border-slate-200 px-2.5 py-1 rounded shadow-2xs">
                      Admin Only Edit
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Worker phone numbers are protected. Only Admin can view or edit numbers once added.
                  </p>
                </div>
              ) : (
                <div>
                  <label htmlFor="editPhone" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Add Mobile Number (10 Digits)
                  </label>
                  <div className="relative mt-1">
                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 text-xs font-bold pointer-events-none">+91</span>
                    <input
                      id="editPhone"
                      type="tel"
                      disabled={actionLoading}
                      value={editPhone.replace(/^\+91/, '')}
                      onChange={(e) => setEditPhone(e.target.value)}
                      placeholder="10-digit mobile number"
                      maxLength={14}
                      className="block w-full rounded border border-slate-300 pl-11 pr-3 py-2 text-slate-950 text-sm min-h-[44px] bg-white font-medium"
                    />
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Once added, this phone number will be locked and can only be viewed or modified by Admin.
                  </p>
                </div>
              )}

              {/* Read-only advance display */}
              <div className="bg-slate-50 border border-slate-200 rounded p-3">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold text-slate-500 uppercase">Outstanding Advance</span>
                  <span className="font-black text-red-600 text-sm">{formatINR(editingWorker.running_advance)}</span>
                </div>
                <p className="text-[10px] text-slate-500 mt-2 flex items-start gap-1">
                  <AlertCircle className="h-3 w-3 text-slate-400 mt-0.5 shrink-0" />
                  <span>Financial balances are immutable and can only be altered through a ledger disbursement transaction.</span>
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Update Photo
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
                    {/* 1-Tap In-App Camera Button */}
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

              {actionMessage && (
                <div className={`rounded p-3 border text-xs font-semibold ${
                  actionMessage.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'
                }`}>
                  {actionMessage.text}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="flex-1 flex justify-center items-center rounded-md bg-slate-900 py-3 text-sm font-semibold text-white shadow hover:bg-slate-800 disabled:opacity-50 min-h-[44px] gap-2"
                >
                  {actionLoading ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Check className="h-4 w-4" />
                      <span>Save Profile</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={() => setConfirmDelete(true)}
                  className="px-4 flex justify-center items-center rounded-md bg-red-50 hover:bg-red-100 border border-red-200 text-sm font-bold text-red-600 disabled:opacity-50 min-h-[44px]"
                  title="Remove Worker"
                >
                  <Trash2 className="h-4.5 w-4.5" />
                </button>
              </div>
            </form>

            {/* Worker Payment History */}
            <div className="flex flex-col h-full min-h-[250px]">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 border-b border-slate-100 pb-2 mb-3">
                Disbursement History
              </h4>
              {historyLoading ? (
                <div className="flex flex-1 justify-center items-center py-8">
                  <RefreshCw className="h-5 w-5 animate-spin text-slate-400" />
                </div>
              ) : !paymentHistory || paymentHistory.length === 0 ? (
                <div className="flex flex-1 justify-center items-center border border-dashed border-slate-200 rounded-lg p-6 bg-slate-50/50">
                  <p className="text-xs text-slate-500 text-center">No payment history recorded for this worker.</p>
                </div>
              ) : (
                <div className="overflow-y-auto max-h-[350px] divide-y divide-slate-100 border border-slate-200 rounded-lg bg-white">
                  {paymentHistory.map((pmt) => (
                    <div key={pmt.id} className="p-3 text-xs flex justify-between items-start gap-3 hover:bg-slate-50">
                      <div>
                        <span className="font-extrabold text-slate-900 block text-sm">{formatINR(pmt.amount)}</span>
                        <span className="text-[10px] text-slate-500">{new Date(pmt.created_at).toLocaleDateString(undefined, { dateStyle: 'medium' })}</span>
                        {pmt.note && (
                          <span className="text-[10px] text-slate-600 italic block mt-1 bg-slate-50 border border-slate-100 rounded px-1.5 py-0.5">
                            "{pmt.note}"
                          </span>
                        )}
                      </div>
                      <div>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold border ${
                          pmt.status === 'confirmed'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : pmt.status === 'disputed'
                            ? 'bg-red-50 text-red-700 border-red-200'
                            : 'bg-amber-50 text-amber-700 border-amber-200'
                        }`}>
                          {pmt.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Workers List Panel */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
        {/* Search & Date Filter Bar */}
        <div className="p-4 bg-slate-50/70 border-b border-slate-200 space-y-3">
          {/* Search Row */}
          <div className="flex items-center relative">
            <Search className="absolute left-3.5 h-4 w-4 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search workers by name..."
              className="w-full pl-9 pr-3 py-2 rounded border border-slate-300 text-xs focus:ring-slate-500 focus:border-slate-500 text-slate-950 min-h-[42px] bg-white shadow-sm"
            />
          </div>

          {/* Date Range Inputs & Presets */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
                Date Range:
              </span>
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-900 bg-white min-h-[36px]"
                  title="Start Date"
                />
                <span className="text-xs text-slate-400">to</span>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-900 bg-white min-h-[36px]"
                  title="End Date"
                />
              </div>
            </div>

            {/* Quick Presets */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
              <button
                type="button"
                onClick={() => setDatePreset('all')}
                className={`px-2.5 py-1 rounded text-[11px] font-semibold border transition-colors ${
                  !fromDate && !toDate
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                All Time
              </button>
              <button
                type="button"
                onClick={() => setDatePreset('today')}
                className="px-2.5 py-1 rounded text-[11px] font-semibold bg-white text-slate-600 border border-slate-200 hover:bg-slate-100 transition-colors"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => setDatePreset('this_week')}
                className="px-2.5 py-1 rounded text-[11px] font-semibold bg-white text-slate-600 border border-slate-200 hover:bg-slate-100 transition-colors"
              >
                This Week
              </button>
              <button
                type="button"
                onClick={() => setDatePreset('this_month')}
                className="px-2.5 py-1 rounded text-[11px] font-semibold bg-white text-slate-600 border border-slate-200 hover:bg-slate-100 transition-colors"
              >
                This Month
              </button>
            </div>
          </div>

          {/* Active Filter Period Indicator Banner */}
          {(fromDate || toDate) && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-md p-2.5 text-xs flex items-center justify-between gap-2 animate-fadeIn">
              <div className="flex items-center gap-2 text-indigo-900 font-medium">
                <Clock className="h-4 w-4 text-indigo-600 shrink-0" />
                <span>
                  Showing advances from{' '}
                  <strong>{fromDate ? new Date(fromDate + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Start'}</strong>{' '}
                  to{' '}
                  <strong>{toDate ? new Date(toDate + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Today'}</strong>
                  : Total <strong className="text-indigo-950 font-black">{formatINR(totalPeriodSum)}</strong> ({workersWithPeriodAdvanceCount} workers)
                </span>
              </div>
              <button
                type="button"
                onClick={() => { setFromDate(''); setToDate(''); }}
                className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 underline shrink-0"
              >
                Clear Filter
              </button>
            </div>
          )}
        </div>

        {/* Workers List */}
        {isLoading && activeWorkers.length === 0 ? (
          <div className="p-8 text-center">
            <RefreshCw className="h-6 w-6 animate-spin text-slate-400 mx-auto" />
            <p className="text-xs text-slate-500 mt-2">Loading worker profiles...</p>
          </div>
        ) : filteredWorkers.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No workers found matching the search.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 bg-white">
            {filteredWorkers.map((w) => {
              const periodAdvance = getWorkerPeriodAdvance(w.worker_id);
              const periodCount = getWorkerPeriodCount(w.worker_id);

              return (
                <li key={w.worker_id} className="border-b border-slate-100 flex flex-col bg-white">
                  {/* Collapsible header container */}
                  <div 
                    onClick={() => setExpandedWorkerId(prev => prev === w.worker_id ? null : w.worker_id)}
                    className="p-4 flex items-center justify-between hover:bg-slate-50 cursor-pointer transition-colors duration-150"
                  >
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
                          <div className="text-xs text-slate-500 mt-0.5">
                            <span className="text-emerald-700 font-medium inline-flex items-center gap-1 text-[11px] bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
                              <Phone className="h-3 w-3 text-emerald-600" />
                              <span>Phone Linked</span>
                            </span>
                          </div>
                        ) : (
                          <div className="text-xs text-slate-400 mt-0.5">
                            <span className="text-[10px] text-slate-400 italic">No phone linked</span>
                          </div>
                        )}
                        {fromDate || toDate ? (
                          <span className="text-[10px] text-indigo-600 font-semibold block mt-0.5">
                            {periodCount > 0 ? `${periodCount} advance payment${periodCount > 1 ? 's' : ''} in period` : 'No advance in period'}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right space-y-1">
                        {(w.unpaid_salary || 0) > 0 ? (
                          <div className="text-[11px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                            Salary: {formatINR(w.unpaid_salary || 0)}
                          </div>
                        ) : null}
                        <div className={`text-[11px] font-bold px-2 py-0.5 rounded flex items-center gap-1.5 ${
                          (w.running_advance || 0) > 0 
                            ? 'text-amber-900 bg-amber-50 border border-amber-200' 
                            : 'text-slate-500 bg-slate-50 border border-slate-200'
                        }`}>
                          <span>Adv: {formatINR(w.running_advance || 0)}</span>
                          {(w.running_advance || 0) > 0 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setCorrectionWorker(w);
                                setCorrectionRequestedAmount(String(w.running_advance || 0));
                                setCorrectionReason('');
                                setCorrectionError('');
                                setShowCorrectionModal(true);
                              }}
                              className="text-[10px] text-amber-950 underline hover:text-black font-semibold ml-0.5"
                              title="Request correction from Admin if wrong"
                            >
                              Report
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Quick Actions Menu */}
                      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => {
                            setHisaabWorker(w);
                            setHisaabTotalWages('');
                            setHisaabAdvanceDeduct(w.running_advance > 0 ? String(w.running_advance) : '0');
                            const d = new Date();
                            setHisaabFromDate(new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0]);
                            setHisaabToDate(new Date().toISOString().split('T')[0]);
                            setHisaabNote('');
                            setHisaabError('');
                            setShowHisaabModal(true);
                          }}
                          className="px-2.5 py-1.5 rounded bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-colors flex items-center gap-1 shadow-2xs"
                          title="Record Hisaab Settlement"
                        >
                          <Calculator className="h-3 w-3" />
                          <span>Hisaab</span>
                        </button>

                        {(w.unpaid_salary || 0) > 0 && (w.running_advance || 0) > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setSettleWorker(w);
                              const maxS = Math.min(w.unpaid_salary || 0, w.running_advance || 0);
                              setSettleAmount(String(maxS));
                              setShowSettleModal(true);
                            }}
                            className="px-2.5 py-1.5 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors"
                            title="Settle Advance from Salary"
                          >
                            Settle
                          </button>
                        )}

                        <button
                          onClick={() => handleEditClick(w)}
                          className="flex h-9 w-9 items-center justify-center rounded border border-slate-200 text-slate-500 hover:text-slate-900 bg-white hover:bg-slate-50"
                          title="Edit Profile"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Collapsible body showing payment history */}
                  {expandedWorkerId === w.worker_id && (
                    <div className="bg-slate-50 px-4 py-3 border-t border-b border-slate-100/80 animate-fadeIn">
                      <WorkerInlineHistory 
                        workerId={w.worker_id} 
                        fromDate={fromDate}
                        toDate={toDate}
                        onPhotoClick={setViewingPhotoUrl}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Delete Confirmation Modal Overlay */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white border border-slate-200 rounded-lg shadow-2xl p-6 max-w-sm w-full space-y-4">
            <h3 className="text-base font-bold text-slate-900">Remove Worker?</h3>
            <p className="text-xs text-slate-600">
              Are you sure you want to remove <span className="font-extrabold">{editingWorker?.worker_name}</span>? 
              This worker will be deactivated and removed from the active registry.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="flex-1 rounded-md border border-slate-300 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 min-h-[44px]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteWorker}
                className="flex-1 rounded-md bg-red-600 py-2.5 text-xs font-bold text-white hover:bg-red-700 min-h-[44px]"
              >
                Yes, Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 1-Tap In-App Camera Viewfinder */}
      <CameraCaptureModal
        isOpen={showCameraModal}
        onClose={() => setShowCameraModal(false)}
        onCapture={(file, previewUrl) => {
          setPhotoFile(file);
          setPhotoPreview((prev: string | null) => {
            if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
            return previewUrl;
          });
        }}
        title="Take Worker Photo"
        defaultFacingMode="environment"
      />

      {/* Full-Screen Photo Viewer Modal */}
      {viewingPhotoUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full overflow-hidden flex flex-col shadow-2xl">
            <div className="p-3 flex items-center justify-between border-b border-slate-800">
              <span className="text-xs font-bold text-slate-100 uppercase tracking-wider">Proof of Handover</span>
              <button
                type="button"
                onClick={() => setViewingPhotoUrl(null)}
                className="text-slate-400 hover:text-white p-1 rounded-full hover:bg-slate-800 min-h-[36px] min-w-[36px] flex items-center justify-center"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="aspect-square w-full bg-black flex items-center justify-center overflow-hidden">
              <img
                src={viewingPhotoUrl}
                alt="Cash Handover Proof"
                className="w-full h-full object-contain"
              />
            </div>
            <div className="p-3 bg-slate-900 border-t border-slate-800 text-center">
              <button
                type="button"
                onClick={() => setViewingPhotoUrl(null)}
                className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Hisaab Settlement Modal */}
      {showHisaabModal && hisaabWorker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-800 border border-slate-200">
                  <Calculator className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                    Hisaab Settlement
                  </h3>
                  <span className="text-[10px] text-slate-500">Calculate wages & deduct advance</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setShowHisaabModal(false); setHisaabWorker(null); setHisaabError(''); }}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs space-y-1.5">
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Worker:</span>
                <span className="font-bold text-slate-900">{hisaabWorker.worker_name}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Current Advance:</span>
                <span className={`font-bold ${(hisaabWorker.running_advance || 0) > 0 ? 'text-amber-800 font-black' : 'text-slate-700'}`}>
                  {formatINR(hisaabWorker.running_advance || 0)}
                </span>
              </div>
              <div className="flex justify-end pt-0.5">
                <button
                  type="button"
                  onClick={() => {
                    const w = hisaabWorker;
                    setShowHisaabModal(false);
                    setCorrectionWorker(w);
                    setCorrectionRequestedAmount(String(w.running_advance || 0));
                    setCorrectionReason('');
                    setCorrectionError('');
                    setShowCorrectionModal(true);
                  }}
                  className="text-[10px] text-indigo-700 font-bold underline hover:text-indigo-900"
                >
                  Advance incorrect? Request correction
                </button>
              </div>
            </div>

            {hisaabError && (
              <div className="rounded-lg bg-red-50 p-2.5 text-xs text-red-700 border border-red-200">
                {hisaabError}
              </div>
            )}

            <div className="space-y-3">
              {/* Date Range: From & To */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="hisaabFromDateModal" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    From Date
                  </label>
                  <input
                    id="hisaabFromDateModal"
                    type="date"
                    required
                    disabled={hisaabLoading}
                    value={hisaabFromDate}
                    onChange={(e) => setHisaabFromDate(e.target.value)}
                    className="block w-full rounded-lg border border-slate-300 px-2 py-1.5 text-slate-950 text-xs min-h-[38px] bg-white font-medium"
                  />
                </div>
                <div>
                  <label htmlFor="hisaabToDateModal" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    To Date
                  </label>
                  <input
                    id="hisaabToDateModal"
                    type="date"
                    required
                    disabled={hisaabLoading}
                    value={hisaabToDate}
                    onChange={(e) => setHisaabToDate(e.target.value)}
                    className="block w-full rounded-lg border border-slate-300 px-2 py-1.5 text-slate-950 text-xs min-h-[38px] bg-white font-medium"
                  />
                </div>
              </div>

              {/* Total Wages Made */}
              <div>
                <label htmlFor="hisaabTotalWagesModal" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Total Wages Made (INR)
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 text-sm font-bold pointer-events-none">₹</span>
                  <input
                    id="hisaabTotalWagesModal"
                    type="number"
                    min="1"
                    disabled={hisaabLoading}
                    value={hisaabTotalWages}
                    onChange={(e) => {
                      const val = e.target.value;
                      setHisaabTotalWages(val);
                      if (hisaabWorker && hisaabWorker.running_advance > 0) {
                        const wagesNum = parseFloat(val) || 0;
                        const currentDeduct = parseFloat(hisaabAdvanceDeduct) || 0;
                        if (currentDeduct > wagesNum) {
                          setHisaabAdvanceDeduct(String(Math.min(wagesNum, hisaabWorker.running_advance)));
                        }
                      }
                    }}
                    placeholder="e.g. 10000"
                    className="block w-full rounded-lg border border-slate-300 pl-8 pr-3 py-2 text-slate-950 text-sm font-bold focus:ring-2 focus:ring-slate-900 min-h-[44px]"
                  />
                </div>
              </div>

              {/* Deduct from Advance */}
              {(hisaabWorker.running_advance || 0) > 0 ? (
                <div className="rounded-lg p-2.5 bg-amber-50/70 border border-amber-200 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label htmlFor="hisaabAdvanceDeductModal" className="block text-xs font-bold text-amber-950 uppercase tracking-wider">
                      Deduct from Advance
                    </label>
                    <span className="text-[10px] text-amber-800 font-bold">
                      Advance: {formatINR(hisaabWorker.running_advance || 0)}
                    </span>
                  </div>

                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 text-sm font-bold pointer-events-none">₹</span>
                    <input
                      id="hisaabAdvanceDeductModal"
                      type="number"
                      min="0"
                      max={Math.min(hisaabWorker.running_advance || 0, parseFloat(hisaabTotalWages) || 0)}
                      disabled={hisaabLoading}
                      value={hisaabAdvanceDeduct}
                      onChange={(e) => setHisaabAdvanceDeduct(e.target.value)}
                      placeholder="0"
                      className="block w-full rounded border border-amber-300 pl-8 pr-3 py-1.5 text-slate-950 text-sm font-bold bg-white focus:ring-2 focus:ring-amber-500 min-h-[40px]"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-1 pt-0.5">
                    <button
                      type="button"
                      onClick={() => setHisaabAdvanceDeduct('0')}
                      className="text-[11px] px-2 py-0.5 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors"
                    >
                      Deduct ₹0
                    </button>
                    {(() => {
                      const wagesNum = parseFloat(hisaabTotalWages) || 0;
                      const maxD = Math.min(hisaabWorker.running_advance || 0, wagesNum > 0 ? wagesNum : (hisaabWorker.running_advance || 0));
                      if (maxD <= 0) return null;
                      return (
                        <>
                          <button
                            type="button"
                            onClick={() => setHisaabAdvanceDeduct(String(maxD))}
                            className="text-[11px] px-2 py-0.5 rounded border border-amber-300 bg-amber-100 text-amber-900 font-bold hover:bg-amber-200 transition-colors"
                          >
                            Full ({formatINR(maxD)})
                          </button>
                          {maxD > 1000 && (
                            <button
                              type="button"
                              onClick={() => setHisaabAdvanceDeduct(String(Math.round(maxD / 2)))}
                              className="text-[11px] px-2 py-0.5 rounded border border-amber-200 bg-white text-amber-900 font-medium hover:bg-amber-50 transition-colors"
                            >
                              Half ({formatINR(Math.round(maxD / 2))})
                            </button>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg p-2.5 bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-center justify-between">
                  <span>Worker owes ₹0 advance. No advance deduction.</span>
                  <span className="font-semibold text-emerald-700">Clear</span>
                </div>
              )}

              {/* Live Hisaab Breakdown */}
              {(() => {
                const wagesNum = parseFloat(hisaabTotalWages) || 0;
                const deductNum = Math.max(0, parseFloat(hisaabAdvanceDeduct) || 0);
                const curAdv = hisaabWorker.running_advance || 0;

                if (wagesNum <= 0) return null;

                const netRemaining = Math.max(0, wagesNum - deductNum);
                const remainingAdv = Math.max(0, curAdv - deductNum);

                return (
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 space-y-1 text-xs">
                    <div className="flex justify-between items-center text-slate-700">
                      <span>Total Wages Made:</span>
                      <span className="font-bold text-slate-900">{formatINR(wagesNum)}</span>
                    </div>
                    {curAdv > 0 && (
                      <div className="flex justify-between items-center text-amber-800">
                        <span>Advance Deducted:</span>
                        <span className="font-bold">-{formatINR(deductNum)}</span>
                      </div>
                    )}
                    <div className="border-t border-slate-200 pt-1 flex justify-between items-center">
                      <span className="font-semibold text-slate-800">Net Wages Remaining for Worker:</span>
                      <span className="font-bold text-emerald-700">{formatINR(netRemaining)}</span>
                    </div>
                    <div className="flex justify-between items-center text-[11px] text-slate-600">
                      <span>Advance Remaining After Hisaab:</span>
                      <span className="font-bold text-slate-900">{formatINR(remainingAdv)}</span>
                    </div>
                  </div>
                );
              })()}

              {/* Worker Payout Distribution (Cash vs Online QR) */}
              {(() => {
                const wagesNum = parseFloat(hisaabTotalWages) || 0;
                const deductNum = Math.max(0, parseFloat(hisaabAdvanceDeduct) || 0);
                const netPayable = Math.max(0, wagesNum - deductNum);

                if (wagesNum <= 0) return null;

                const cashNum = parseFloat(hisaabCashAmount) || 0;
                const onlineNum = parseFloat(hisaabOnlineAmount) || 0;
                const totalPayout = cashNum + onlineNum;
                const remainingUnpaid = Math.max(0, netPayable - totalPayout);
                const isOver = totalPayout > netPayable;

                return (
                  <div className="rounded-lg p-3 bg-slate-50 border border-slate-200 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <label className="block text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                          <CreditCard className="h-4 w-4 text-indigo-600" />
                          <span>Payout Distribution</span>
                        </label>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          Specify cash handed over vs money paid online to their QR code.
                        </p>
                      </div>
                      <span className="text-xs font-black text-slate-900 shrink-0">
                        Net: {formatINR(netPayable)}
                      </span>
                    </div>

                    {/* 1-Tap Preset Chips */}
                    {netPayable > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setHisaabCashAmount(String(netPayable));
                            setHisaabOnlineAmount('0');
                          }}
                          className="text-xs px-2.5 py-1 rounded border border-emerald-300 bg-emerald-50 text-emerald-900 font-bold hover:bg-emerald-100 transition-colors"
                        >
                          All in Cash ({formatINR(netPayable)})
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setHisaabCashAmount('0');
                            setHisaabOnlineAmount(String(netPayable));
                          }}
                          className="text-xs px-2.5 py-1 rounded border border-indigo-300 bg-indigo-50 text-indigo-900 font-bold hover:bg-indigo-100 transition-colors"
                        >
                          All Online QR ({formatINR(netPayable)})
                        </button>
                        {netPayable > 1000 && (
                          <button
                            type="button"
                            onClick={() => {
                              const half = Math.floor(netPayable / 2);
                              setHisaabCashAmount(String(half));
                              setHisaabOnlineAmount(String(netPayable - half));
                            }}
                            className="text-xs px-2.5 py-1 rounded border border-slate-300 bg-white text-slate-700 font-medium hover:bg-slate-50 transition-colors"
                          >
                            Split Half
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setHisaabCashAmount('0');
                            setHisaabOnlineAmount('0');
                          }}
                          className="text-xs px-2.5 py-1 rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors"
                        >
                          No Payout Now (₹0)
                        </button>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-0.5">
                      {/* Cash Handover Input */}
                      <div className="space-y-1">
                        <label htmlFor="hisaabCashAmountModal" className="block text-xs font-bold text-slate-800">
                          Cash Handover (INR)
                        </label>
                        <div className="relative rounded shadow-xs">
                          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                            <span className="text-slate-500 text-sm font-bold">₹</span>
                          </div>
                          <input
                            id="hisaabCashAmountModal"
                            type="number"
                            min="0"
                            max={netPayable}
                            value={hisaabCashAmount}
                            onChange={(e) => setHisaabCashAmount(e.target.value)}
                            disabled={hisaabLoading}
                            placeholder="0"
                            className="block w-full rounded-lg border border-slate-300 pl-7 pr-3 py-2 text-slate-950 text-sm font-bold bg-white focus:ring-2 focus:ring-slate-500 min-h-[44px]"
                          />
                        </div>
                        <p className="text-[10px] text-slate-500">
                          Deducted from your cash in hand balance.
                        </p>
                      </div>

                      {/* Online QR Payment Input */}
                      <div className="space-y-1">
                        <label htmlFor="hisaabOnlineAmountModal" className="block text-xs font-bold text-indigo-950 flex items-center gap-1">
                          <QrCode className="h-3.5 w-3.5 text-indigo-600" />
                          <span>Online / QR Transfer (INR)</span>
                        </label>
                        <div className="relative rounded shadow-xs">
                          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                            <span className="text-indigo-500 text-sm font-bold">₹</span>
                          </div>
                          <input
                            id="hisaabOnlineAmountModal"
                            type="number"
                            min="0"
                            max={netPayable}
                            value={hisaabOnlineAmount}
                            onChange={(e) => setHisaabOnlineAmount(e.target.value)}
                            disabled={hisaabLoading}
                            placeholder="0"
                            className="block w-full rounded-lg border border-indigo-300 pl-7 pr-3 py-2 text-slate-950 text-sm font-bold bg-white focus:ring-2 focus:ring-indigo-500 min-h-[44px]"
                          />
                        </div>
                        <p className="text-[10px] text-indigo-700 font-medium">
                          Paid via QR code. Not deducted from your balance.
                        </p>
                      </div>
                    </div>

                    {/* Summary Row */}
                    <div className="bg-white rounded border border-slate-200 p-2.5 text-xs space-y-1">
                      <div className="flex justify-between items-center text-slate-600">
                        <span>Physical Cash Handover:</span>
                        <span className="font-bold text-slate-900">{formatINR(cashNum)}</span>
                      </div>
                      <div className="flex justify-between items-center text-indigo-700">
                        <span>Online QR Payment:</span>
                        <span className="font-bold">{formatINR(onlineNum)}</span>
                      </div>
                      <div className="border-t border-slate-100 pt-1 flex justify-between items-center font-bold">
                        <span className="text-slate-800">Total Payout Now:</span>
                        <span className={isOver ? 'text-red-600 font-black' : 'text-slate-950'}>{formatINR(totalPayout)}</span>
                      </div>
                      {remainingUnpaid > 0 && !isOver && (
                        <div className="flex justify-between items-center text-[11px] text-amber-700">
                          <span>Remaining Unpaid (Accumulates):</span>
                          <span className="font-semibold">{formatINR(remainingUnpaid)}</span>
                        </div>
                      )}
                    </div>

                    {isOver && (
                      <div className="rounded p-2 bg-red-50 border border-red-200 text-xs text-red-700 font-semibold flex items-center gap-1.5">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                        <span>Total payout ({formatINR(totalPayout)}) exceeds net wages ({formatINR(netPayable)}).</span>
                      </div>
                    )}
                  </div>
                );
              })()}

              <div>
                <label htmlFor="hisaabNoteModal" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Notes / Remarks (Optional)
                </label>
                <input
                  id="hisaabNoteModal"
                  type="text"
                  disabled={hisaabLoading}
                  value={hisaabNote}
                  onChange={(e) => setHisaabNote(e.target.value)}
                  placeholder="e.g. Weekly settlement"
                  className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-950 text-xs min-h-[40px]"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                disabled={hisaabLoading}
                onClick={() => { setShowHisaabModal(false); setHisaabWorker(null); setHisaabError(''); }}
                className="flex-1 py-2 px-3 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 min-h-[40px]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={hisaabLoading || !hisaabTotalWages || parseFloat(hisaabTotalWages) <= 0}
                onClick={handleExecuteHisaab}
                className="flex-1 py-2 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold min-h-[40px] flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50"
              >
                {hisaabLoading ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <span>
                    Save Hisaab
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Advance Correction Request Modal (Supervisor -> Admin) */}
      {showCorrectionModal && correctionWorker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-sm w-full p-5 space-y-4 relative">
            <button
              type="button"
              onClick={() => {
                if (!correctionLoading) {
                  setShowCorrectionModal(false);
                  setCorrectionWorker(null);
                  setCorrectionError('');
                }
              }}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 p-1"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0 text-amber-700">
                <AlertCircle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Request Advance Correction</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Submit a correction request to Admin for <strong>{correctionWorker.worker_name}</strong>.
                </p>
              </div>
            </div>

            <form onSubmit={handleExecuteAdvanceCorrection} className="space-y-3">
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-1">
                <div className="flex justify-between text-slate-600">
                  <span>Current Recorded Advance:</span>
                  <span className="font-bold text-slate-900">{formatINR(correctionWorker.running_advance || 0)}</span>
                </div>
              </div>

              <div>
                <label htmlFor="modalCorrectionAmt" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  Correct Advance Amount (INR) <span className="text-red-500">*</span>
                </label>
                <div className="relative mt-1">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 text-sm font-bold pointer-events-none">₹</span>
                  <input
                    id="modalCorrectionAmt"
                    type="number"
                    min="0"
                    required
                    disabled={correctionLoading}
                    value={correctionRequestedAmount}
                    onChange={(e) => setCorrectionRequestedAmount(e.target.value)}
                    placeholder="0"
                    className="block w-full rounded border border-slate-300 pl-8 pr-3 py-2 text-slate-950 text-sm font-bold focus:ring-2 focus:ring-slate-900 min-h-[44px]"
                  />
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Enter what the advance balance should be (e.g. 0 if fully clear).
                </p>
              </div>

              <div>
                <label htmlFor="modalCorrectionReason" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  Reason for Correction <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="modalCorrectionReason"
                  required
                  rows={2}
                  disabled={correctionLoading}
                  value={correctionReason}
                  onChange={(e) => setCorrectionReason(e.target.value)}
                  placeholder="e.g. Worker returned cash in person, or prior duplicate entry"
                  className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-slate-950 text-xs min-h-[60px]"
                />
              </div>

              {correctionError && (
                <div className="p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-700 font-medium">
                  {correctionError}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  disabled={correctionLoading}
                  onClick={() => {
                    setShowCorrectionModal(false);
                    setCorrectionWorker(null);
                    setCorrectionError('');
                  }}
                  className="flex-1 rounded border border-slate-300 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 min-h-[42px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={correctionLoading || !correctionRequestedAmount || !correctionReason.trim()}
                  className="flex-1 rounded bg-slate-900 py-2.5 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-50 min-h-[42px] flex items-center justify-center gap-1"
                >
                  {correctionLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <span>Send to Admin</span>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Settle Advance from Salary Modal */}
      {showSettleModal && settleWorker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700">
                  <Coins className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                    Settle Advance from Salary
                  </h3>
                  <span className="text-[10px] text-slate-500">Internal adjustment • ₹0 cash moves</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setShowSettleModal(false); setSettleWorker(null); setSettleError(''); }}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="bg-slate-50 border border-slate-100 rounded-lg p-3 text-xs space-y-1.5">
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Worker:</span>
                <span className="font-bold text-slate-900">{settleWorker.worker_name}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Unpaid Salary Balance:</span>
                <span className="font-bold text-emerald-700">{formatINR(settleWorker.unpaid_salary || 0)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Outstanding Advance Owed:</span>
                <span className="font-bold text-amber-700">{formatINR(settleWorker.running_advance || 0)}</span>
              </div>
            </div>

            {settleError && (
              <div className="rounded-lg bg-red-50 p-2.5 text-xs text-red-700 border border-red-200">
                {settleError}
              </div>
            )}

            <div>
              <label htmlFor="settleAmount" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                Amount to Deduct from Salary (INR)
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 text-sm font-bold pointer-events-none">₹</span>
                <input
                  id="settleAmount"
                  type="number"
                  min="1"
                  max={Math.min(settleWorker.unpaid_salary || 0, settleWorker.running_advance || 0)}
                  disabled={settleLoading}
                  value={settleAmount}
                  onChange={(e) => setSettleAmount(e.target.value)}
                  placeholder="0"
                  className="block w-full rounded-lg border border-slate-300 pl-8 pr-3 py-2 text-slate-950 text-sm font-bold focus:ring-2 focus:ring-blue-600 min-h-[44px]"
                />
              </div>
              <p className="text-[10px] text-slate-400 mt-1">
                Max available: {formatINR(Math.min(settleWorker.unpaid_salary || 0, settleWorker.running_advance || 0))}
              </p>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                disabled={settleLoading}
                onClick={() => { setShowSettleModal(false); setSettleWorker(null); setSettleError(''); }}
                className="flex-1 py-2 px-3 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 min-h-[40px]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={settleLoading || !settleAmount || parseFloat(settleAmount) <= 0}
                onClick={handleExecuteSettleAdvance}
                className="flex-1 py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold min-h-[40px] flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50"
              >
                {settleLoading ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <span>Settle Advance</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Compact on-demand query component for displaying history inside lists
function WorkerInlineHistory({ 
  workerId, 
  fromDate, 
  toDate,
  onPhotoClick,
}: { 
  workerId: string; 
  fromDate?: string; 
  toDate?: string; 
  onPhotoClick?: (url: string) => void;
}) {
  const supabase = createBrowserClient();
  
  const { data: payments, isLoading } = useQuery({
    queryKey: ['worker-payments', workerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cash_transactions')
        .select('id, amount, note, created_at, status')
        .eq('to_worker_id', workerId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as WorkerPayment[];
    },
    staleTime: 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <RefreshCw className="h-4 w-4 animate-spin text-slate-400" />
        <span className="text-xs text-slate-500 ml-2">Loading payment history...</span>
      </div>
    );
  }

  const isWithinDate = (isoStr: string) => {
    if (!fromDate && !toDate) return true;
    const d = new Date(isoStr);
    if (fromDate) {
      const start = new Date(fromDate + 'T00:00:00');
      if (d < start) return false;
    }
    if (toDate) {
      const end = new Date(toDate + 'T23:59:59.999');
      if (d > end) return false;
    }
    return true;
  };

  const filteredPayments = payments?.filter(pmt => isWithinDate(pmt.created_at)) || [];
  const periodTotal = filteredPayments
    .filter(p => p.status === 'confirmed')
    .reduce((sum, p) => sum + Number(p.amount), 0);

  if (!payments || payments.length === 0) {
    return (
      <p className="text-xs text-slate-500 py-2 text-center">
        No payment history recorded for this worker.
      </p>
    );
  }

  if (filteredPayments.length === 0) {
    return (
      <div className="py-3 text-center text-xs text-slate-500 bg-white rounded border border-slate-200">
        No disbursements recorded in the selected date range ({fromDate || 'Start'} to {toDate || 'Today'}).
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <h5 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
          Disbursement Ledger
        </h5>
        {(fromDate || toDate) && (
          <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded">
            Period Total: {formatINR(periodTotal)} ({filteredPayments.length} payment{filteredPayments.length > 1 ? 's' : ''})
          </span>
        )}
      </div>
      <div className="divide-y divide-slate-100 border border-slate-200/80 rounded bg-white overflow-hidden max-h-[220px] overflow-y-auto">
        {filteredPayments.map((pmt) => {
          const parsed = parseHandoverNote(pmt.note);
          return (
            <div key={pmt.id} className="p-2.5 text-xs flex justify-between items-start gap-3 hover:bg-slate-50">
              <div>
                <span className="font-extrabold text-slate-900 block">{formatINR(pmt.amount)}</span>
                <span className="text-[9px] text-slate-400">
                  {new Date(pmt.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
                {(parsed.note || parsed.photoUrl) && (
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    {parsed.note && (
                      <span className="text-[9px] text-slate-500 italic bg-slate-50/50 border border-slate-100 rounded px-1.5 py-0.5 w-max max-w-full truncate">
                        "{parsed.note}"
                      </span>
                    )}
                    {parsed.photoUrl && (
                      <button
                        type="button"
                        onClick={() => onPhotoClick?.(parsed.photoUrl!)}
                        className="inline-flex items-center gap-1 text-[9px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-1.5 py-0.5 rounded cursor-pointer transition-colors"
                        title="View Cash Handover Proof"
                      >
                        <Camera className="h-2.5 w-2.5" />
                        <span>Handover Photo</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div>
                <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[8px] font-semibold border ${
                  pmt.status === 'confirmed'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : pmt.status === 'disputed'
                    ? 'bg-red-50 text-red-700 border-red-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200'
                }`}>
                  {pmt.status}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
