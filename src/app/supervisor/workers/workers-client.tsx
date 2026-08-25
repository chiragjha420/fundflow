'use client';

import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createBrowserClient } from '@/lib/supabase/browser-client';
import { getOfflineCache, setOfflineCache } from '@/lib/offline-db';
import { formatINR } from '@/lib/utils';
import { updateWorkerAction } from '@/lib/ledger-actions';
import { 
  Search, 
  Camera, 
  User, 
  Edit2, 
  X, 
  Check, 
  RefreshCw,
  AlertCircle
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
}

export function SupervisorWorkersClientPage() {
  const supabase = createBrowserClient();
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState('');
  const [editingWorker, setEditingWorker] = useState<Worker | null>(null);
  const [expandedWorkerId, setExpandedWorkerId] = useState<string | null>(null);
  
  // Edit Form States
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 1. Get Supervisor Info
  const { data: supervisor } = useQuery({
    queryKey: ['supervisor-info'],
    queryFn: async () => {
      const cached = await getOfflineCache<any>('supervisor-info');
      return cached;
    },
    staleTime: Infinity,
  });

  const factoryId = supervisor?.factory_id;

  // 2. Fetch Workers
  const { data: workers, isLoading } = useQuery({
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

  // 3. Fetch Worker Payment History
  const { data: paymentHistory, isLoading: historyLoading } = useQuery({
    queryKey: ['worker-payments', editingWorker?.worker_id],
    queryFn: async () => {
      if (!editingWorker?.worker_id) return [];
      const { data, error } = await supabase
        .from('cash_transactions')
        .select('id, amount, note, created_at, status')
        .eq('to_worker_id', editingWorker.worker_id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as WorkerPayment[];
    },
    enabled: !!editingWorker?.worker_id,
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

  // Handle Edit click
  const handleEditClick = (worker: Worker) => {
    setEditingWorker(worker);
    setEditName(worker.worker_name);
    setEditPhone(worker.worker_phone || '');
    setPhotoFile(null);
    setPhotoPreview(worker.worker_photo_url);
    setActionMessage(null);
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setPhotoFile(file);
      setPhotoPreview(URL.createObjectURL(file));
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

      // Handle Image Upload if new image was picked
      if (photoFile && navigator.onLine) {
        const fileExt = photoFile.name.split('.').pop();
        const fileName = `${editingWorker.worker_id}-${Date.now()}.${fileExt}`;
        const { data, error } = await supabase.storage
          .from('worker-photos')
          .upload(`workers/${fileName}`, photoFile);

        if (!error && data) {
          const { data: { publicUrl } } = supabase.storage
            .from('worker-photos')
            .getPublicUrl(data.path);
          finalPhotoUrl = publicUrl;
        }
      } else if (photoFile && !navigator.onLine) {
        // Base64 storage
        const reader = new FileReader();
        finalPhotoUrl = await new Promise((resolve) => {
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(photoFile);
        });
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

  const filteredWorkers = activeWorkers.filter(w => 
    w.worker_name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    (w.worker_phone && w.worker_phone.includes(searchQuery))
  );

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
                  Phone Number
                </label>
                <input
                  id="editPhone"
                  type="tel"
                  disabled={actionLoading}
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-slate-950 text-sm min-h-[44px] bg-white"
                />
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
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  Update Photo
                </label>
                <div className="mt-1 flex items-center gap-4">
                  <label className="flex items-center justify-center border border-dashed border-slate-300 rounded-md p-3 bg-slate-50 hover:bg-slate-100 cursor-pointer min-h-[44px] flex-1">
                    <Camera className="h-4 w-4 text-slate-400 mr-2" />
                    <span className="text-xs text-slate-600 font-semibold">Change Photo</span>
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
                  <>
                    <Check className="h-4 w-4" />
                    <span>Save Profile</span>
                  </>
                )}
              </button>
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
        {/* Search */}
        <div className="p-3 bg-white border-b border-slate-200 flex items-center relative">
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
        {isLoading && activeWorkers.length === 0 ? (
          <div className="p-8 text-center">
            <RefreshCw className="h-6 w-6 animate-spin text-slate-400 mx-auto" />
            <p className="text-xs text-slate-500 mt-2">Loading worker profiles...</p>
          </div>
        ) : filteredWorkers.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No workers found. Add workers on the Dashboard.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 bg-white">
            {filteredWorkers.map((w) => (
              <li key={w.worker_id} className="border-b border-slate-100 flex flex-col bg-white">
                {/* Collapsible header container */}
                <div 
                  onClick={() => setExpandedWorkerId(prev => prev === w.worker_id ? null : w.worker_id)}
                  className="p-4 flex items-center justify-between hover:bg-slate-50 cursor-pointer transition-colors duration-150"
                >
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
                      <p className="text-xs text-slate-500">
                        {w.worker_phone ? w.worker_phone : 'No phone linked'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <span className="text-xs text-slate-400 block">Advance</span>
                      <span className="text-sm font-black text-red-600">{formatINR(w.running_advance)}</span>
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
                    <WorkerInlineHistory workerId={w.worker_id} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// Compact on-demand query component for displaying history inside lists
function WorkerInlineHistory({ workerId }: { workerId: string }) {
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

  if (!payments || payments.length === 0) {
    return (
      <p className="text-xs text-slate-500 py-2 text-center">
        No payment history recorded for this worker.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <h5 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
        Disbursement Ledger
      </h5>
      <div className="divide-y divide-slate-100 border border-slate-200/80 rounded bg-white overflow-hidden max-h-[220px] overflow-y-auto">
        {payments.map((pmt) => (
          <div key={pmt.id} className="p-2.5 text-xs flex justify-between items-start gap-3 hover:bg-slate-50">
            <div>
              <span className="font-extrabold text-slate-900 block">{formatINR(pmt.amount)}</span>
              <span className="text-[9px] text-slate-400">
                {new Date(pmt.created_at).toLocaleDateString(undefined, { dateStyle: 'medium' })}
              </span>
              {pmt.note && (
                <span className="text-[9px] text-slate-500 italic block mt-0.5 bg-slate-50/50 border border-slate-100 rounded px-1.5 py-0.5 w-max max-w-full truncate">
                  "{pmt.note}"
                </span>
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
        ))}
      </div>
    </div>
  );
}
