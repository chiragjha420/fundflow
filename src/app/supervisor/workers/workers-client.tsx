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
  deleteWorkerServer 
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
  Upload
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
    setEditPhone(worker.worker_phone || '');
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

      const res = await updateWorkerAction(
        editingWorker.worker_id,
        editName,
        editPhone || null,
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

              <div>
                <label htmlFor="editPhone" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  Mobile Number (For Free SMS Receipts)
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
                  Worker will automatically receive text confirmations whenever cash is disbursed.
                </p>
              </div>

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
              placeholder="Search workers by name or phone..."
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
                        <div className="text-xs text-slate-500 mt-0.5">
                          {w.worker_phone ? (
                            <span className="text-emerald-700 font-medium flex items-center gap-1">
                              <span>📱</span> {w.worker_phone}
                            </span>
                          ) : (
                            <span className="inline-flex items-center text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded font-semibold border border-amber-200">
                              ⚠️ No phone linked
                            </span>
                          )}
                        </div>
                        {fromDate || toDate ? (
                          <span className="text-[10px] text-indigo-600 font-semibold block mt-0.5">
                            {periodCount > 0 ? `${periodCount} advance payment${periodCount > 1 ? 's' : ''} in period` : 'No advance in period'}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        {fromDate || toDate ? (
                          <>
                            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 block">
                              Period Advance
                            </span>
                            <span className={`text-sm font-black ${periodAdvance > 0 ? 'text-red-600' : 'text-slate-400'}`}>
                              {formatINR(periodAdvance)}
                            </span>
                            <span className="text-[10px] text-slate-400 block">
                              All-Time: {formatINR(w.running_advance)}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="text-xs text-slate-400 block">Advance</span>
                            <span className="text-sm font-black text-red-600">{formatINR(w.running_advance)}</span>
                          </>
                        )}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation(); // Avoid expanding/collapsing row when edit is clicked
                          handleEditClick(w);
                        }}
                        className="flex h-11 w-11 items-center justify-center rounded border border-slate-200 text-slate-500 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 min-h-[44px] min-w-[44px]"
                        title="Edit Profile"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
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
