'use client';

import React, { useState, useMemo, useRef } from 'react';
import Link from 'next/link';
import { 
  FactoryWorkerBalance, 
  WorkerBonus, 
  WorkerSalaryLedgerEntry,
  adminUpdateWorkerProfileAction,
  createWorkerServer
} from '@/app/actions/workers';
import { uploadWorkerPhotoAction } from '@/app/actions/upload-actions';
import { compressImage } from '@/lib/image-compressor';
import { CameraCaptureModal } from '@/components/camera-capture-modal';
import { formatINR, parseHandoverNote } from '@/lib/utils';
import { 
  Search, 
  User, 
  Phone, 
  Camera, 
  Upload, 
  Trash2, 
  Edit2, 
  Coins, 
  HandCoins, 
  Gift, 
  Calculator, 
  FileText, 
  Check, 
  X, 
  Building2, 
  RefreshCw, 
  Plus, 
  ChevronRight, 
  AlertCircle,
  Clock,
  ShieldCheck,
  CheckCircle2
} from 'lucide-react';

interface AdminWorkersClientProps {
  factories: Array<{ id: string; name: string }>;
  supervisors: any[];
  workers: FactoryWorkerBalance[];
  transactions: any[];
  refundedTransactions: Record<string, any>;
  salaryLedgerEntries: WorkerSalaryLedgerEntry[];
  hisaabRecords: any[];
  onlineAdvances: any[];
  bonuses: WorkerBonus[];
}

export function AdminWorkersClient({
  factories,
  supervisors,
  workers: initialWorkers,
  transactions,
  refundedTransactions,
  salaryLedgerEntries,
  hisaabRecords,
  onlineAdvances,
  bonuses: initialBonuses,
}: AdminWorkersClientProps) {
  // Local Workers and Bonuses state for instantaneous optimistic updates
  const [localWorkers, setLocalWorkers] = useState<FactoryWorkerBalance[]>(initialWorkers);
  const [localBonuses, setLocalBonuses] = useState<WorkerBonus[]>(initialBonuses);

  // Filters State
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [factoryFilter, setFactoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('active');

  // Selected Worker for Detail/History Drawer Modal
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
  const [historyTab, setHistoryTab] = useState<'advances' | 'hisaab' | 'bonus' | 'ledger'>('advances');

  // Edit Worker Profile Modal State
  const [editingWorker, setEditingWorker] = useState<FactoryWorkerBalance | null>(null);
  const [editName, setEditName] = useState<string>('');
  const [editPhone, setEditPhone] = useState<string>('');
  const [editPhotoUrl, setEditPhotoUrl] = useState<string | null>(null);
  const [editActive, setEditActive] = useState<boolean>(true);
  const [editLoading, setEditLoading] = useState<boolean>(false);
  const [editError, setEditError] = useState<string>('');
  const [editSuccess, setEditSuccess] = useState<string>('');

  // Add Worker Modal State
  const [showAddWorkerModal, setShowAddWorkerModal] = useState<boolean>(false);
  const [newWorkerName, setNewWorkerName] = useState<string>('');
  const [newWorkerPhone, setNewWorkerPhone] = useState<string>('');
  const [newWorkerFactoryId, setNewWorkerFactoryId] = useState<string>(factories[0]?.id || '');
  const [newWorkerSupervisorId, setNewWorkerSupervisorId] = useState<string>('');
  const [newWorkerOpeningAdvance, setNewWorkerOpeningAdvance] = useState<string>('0');
  const [addWorkerLoading, setAddWorkerLoading] = useState<boolean>(false);
  const [addWorkerError, setAddWorkerError] = useState<string>('');

  // Camera & Photo State
  const [showCameraModal, setShowCameraModal] = useState<boolean>(false);
  const [uploadingPhoto, setUploadingPhoto] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Full Screen Proof Photo Viewer
  const [viewingProofUrl, setViewingProofUrl] = useState<string | null>(null);
  const [viewingProofTitle, setViewingProofTitle] = useState<string>('Photo Proof');

  // Factory lookup map
  const factoryMap = useMemo(() => {
    const map = new Map<string, string>();
    factories.forEach(f => map.set(f.id, f.name));
    return map;
  }, [factories]);

  // Supervisor lookup map
  const supervisorMap = useMemo(() => {
    const map = new Map<string, string>();
    supervisors.forEach(s => map.set(s.id, s.name));
    return map;
  }, [supervisors]);

  // Filtered Workers list
  const filteredWorkers = useMemo(() => {
    return localWorkers.filter(w => {
      if (factoryFilter !== 'all' && w.factory_id !== factoryFilter) return false;
      if (statusFilter === 'active' && !w.active) return false;
      if (statusFilter === 'inactive' && w.active) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = w.worker_name.toLowerCase().includes(q);
        const matchPhone = (w.worker_phone || '').toLowerCase().includes(q);
        if (!matchName && !matchPhone) return false;
      }

      return true;
    }).sort((a, b) => a.worker_name.localeCompare(b.worker_name));
  }, [localWorkers, factoryFilter, statusFilter, searchQuery]);

  // Overall Metrics for filtered workers
  const metrics = useMemo(() => {
    const totalWorkers = filteredWorkers.length;
    const activeWorkers = filteredWorkers.filter(w => w.active).length;
    const totalAdvancesOwed = filteredWorkers.reduce((sum, w) => sum + Number(w.running_advance || 0), 0);
    const totalUnpaidSalary = filteredWorkers.reduce((sum, w) => sum + Number(w.unpaid_salary || 0), 0);
    const totalBonusesGiven = filteredWorkers.reduce((sum, w) => sum + Number(w.total_bonus_paid || 0), 0);
    return { totalWorkers, activeWorkers, totalAdvancesOwed, totalUnpaidSalary, totalBonusesGiven };
  }, [filteredWorkers]);

  // Selected Worker Object
  const selectedWorker = useMemo(() => {
    if (!selectedWorkerId) return null;
    return localWorkers.find(w => w.worker_id === selectedWorkerId) || null;
  }, [localWorkers, selectedWorkerId]);

  // History data for the selected worker
  const selectedWorkerHistory = useMemo(() => {
    if (!selectedWorkerId) {
      return { advances: [], hisaabs: [], bonuses: [], ledger: [] };
    }

    const wid = selectedWorkerId;

    // 1. Worker Advances (Cash & Online)
    const workerAdvancesList: Array<{
      id: string;
      date: string;
      amount: number;
      isCash: boolean;
      paymentMethodLabel: string;
      note: string;
      photoUrl: string | null;
      supervisorName: string;
      status: string;
      isRefunded: boolean;
    }> = [];

    // Cash advances from transactions
    transactions.forEach((tx: any) => {
      if (tx.to_worker_id !== wid) return;
      if (tx.note?.includes('[TYPE:salary_payment]') || tx.note?.includes('[TYPE:bonus]')) return;
      const isRefunded = !!refundedTransactions[tx.id] || tx.status === 'refunded';
      const parsed = parseHandoverNote(tx.note);
      const supName = tx.from?.name || supervisorMap.get(tx.from_supervisor_id) || 'Supervisor';

      workerAdvancesList.push({
        id: tx.id,
        date: tx.created_at,
        amount: Number(tx.amount || 0),
        isCash: true,
        paymentMethodLabel: 'Cash in Hand',
        note: parsed.note || 'Cash Advance',
        photoUrl: parsed.photoUrl || null,
        supervisorName: supName,
        status: isRefunded ? 'Refunded' : 'Confirmed',
        isRefunded,
      });
    });

    // Online advances
    onlineAdvances.forEach((adv: any) => {
      if (adv.worker_id !== wid) return;
      const isRefunded = !!refundedTransactions[adv.id] || adv.status === 'refunded';
      const parsed = parseHandoverNote(adv.note);
      const supName = adv.supervisor_name || supervisorMap.get(adv.supervisor_id) || 'Supervisor';

      workerAdvancesList.push({
        id: adv.id,
        date: adv.created_at,
        amount: Number(adv.amount || 0),
        isCash: false,
        paymentMethodLabel: 'Online (Bank / UPI)',
        note: parsed.note || 'Online Advance',
        photoUrl: parsed.photoUrl || adv.photo_url || null,
        supervisorName: supName,
        status: isRefunded ? 'Refunded' : 'Confirmed',
        isRefunded,
      });
    });

    workerAdvancesList.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // 2. Worker Hisaab Settlements
    const workerHisaabList: Array<{
      id: string;
      date: string;
      fromDate: string;
      toDate: string;
      totalWages: number;
      advanceDeducted: number;
      cashPaid: number;
      onlinePaid: number;
      netWages: number;
      note: string;
      supervisorName: string;
    }> = [];

    hisaabRecords.forEach((h: any) => {
      if (h.worker_id !== wid) return;
      const wages = Number(h.total_wages || 0);
      const deduct = Number(h.advance_deducted || 0);
      const cash = Number(h.cash_paid || 0);
      const online = Number(h.online_paid || 0);
      const net = Math.max(0, wages - deduct);
      const supName = h.supervisor_name || supervisorMap.get(h.supervisor_id) || 'Supervisor';

      workerHisaabList.push({
        id: h.id,
        date: h.created_at,
        fromDate: h.from_date || '',
        toDate: h.to_date || '',
        totalWages: wages,
        advanceDeducted: deduct,
        cashPaid: cash,
        onlinePaid: online,
        netWages: net,
        note: h.note || '',
        supervisorName: supName,
      });
    });

    workerHisaabList.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // 3. Worker Bonuses
    const workerBonusesList = localBonuses.filter(b => b.worker_id === wid)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    // 4. Combined Chronological Ledger
    const combinedLedger: Array<{
      id: string;
      date: string;
      type: 'advance' | 'hisaab' | 'bonus' | 'salary_earned' | 'recovery';
      title: string;
      badge: string;
      amount: number;
      note: string;
      photoUrl: string | null;
      actor: string;
    }> = [];

    workerAdvancesList.forEach(adv => {
      combinedLedger.push({
        id: `adv-${adv.id}`,
        date: adv.date,
        type: 'advance',
        title: adv.isRefunded ? 'Advance (Refunded)' : (adv.isCash ? 'Cash Advance' : 'Online Advance'),
        badge: adv.isRefunded ? 'bg-amber-100 text-amber-900 border-amber-300' : (adv.isCash ? 'bg-slate-100 text-slate-800 border-slate-200' : 'bg-indigo-50 text-indigo-700 border-indigo-200'),
        amount: adv.amount,
        note: adv.note,
        photoUrl: adv.photoUrl,
        actor: adv.supervisorName,
      });
    });

    workerHisaabList.forEach(h => {
      combinedLedger.push({
        id: `his-${h.id}`,
        date: h.date,
        type: 'hisaab',
        title: `Hisaab Settlement (${h.fromDate} to ${h.toDate})`,
        badge: 'bg-emerald-50 text-emerald-800 border-emerald-200',
        amount: h.totalWages,
        note: `Wages: ${formatINR(h.totalWages)}, Deducted: ${formatINR(h.advanceDeducted)}, Paid Cash: ${formatINR(h.cashPaid)}, Paid Online: ${formatINR(h.onlinePaid)}${h.note ? ` • ${h.note}` : ''}`,
        photoUrl: null,
        actor: h.supervisorName,
      });
    });

    workerBonusesList.forEach(b => {
      const isOnline = b.payment_method === 'online';
      combinedLedger.push({
        id: `bon-${b.id}`,
        date: b.created_at,
        type: 'bonus',
        title: isOnline ? 'Online Bonus' : 'Cash Bonus',
        badge: 'bg-purple-50 text-purple-800 border-purple-200',
        amount: Number(b.amount || 0),
        note: b.note || 'Bonus',
        photoUrl: b.photo_url || null,
        actor: b.supervisor_name || 'Supervisor',
      });
    });

    combinedLedger.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return {
      advances: workerAdvancesList,
      hisaabs: workerHisaabList,
      bonuses: workerBonusesList,
      ledger: combinedLedger,
    };
  }, [selectedWorkerId, transactions, onlineAdvances, hisaabRecords, localBonuses, refundedTransactions, supervisorMap]);

  // Open Edit Profile Modal
  const handleOpenEdit = (worker: FactoryWorkerBalance) => {
    setEditingWorker(worker);
    setEditName(worker.worker_name);
    setEditPhone(worker.worker_phone || '');
    setEditPhotoUrl(worker.worker_photo_url || null);
    setEditActive(worker.active);
    setEditError('');
    setEditSuccess('');
  };

  // Handle Photo File Upload
  const handlePhotoUpload = async (file: File) => {
    setUploadingPhoto(true);
    setEditError('');
    try {
      const compressed = await compressImage(file, { maxWidth: 800, quality: 0.85 });
      const formData = new FormData();
      formData.append('file', compressed);

      const res = await uploadWorkerPhotoAction(formData);
      if (!res.success || !res.publicUrl) {
        throw new Error(res.error || 'Failed to upload photo.');
      }

      setEditPhotoUrl(res.publicUrl);
    } catch (err: any) {
      setEditError(err.message || 'Error processing photo.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  // Handle Camera Capture
  const handleCameraCapture = (file: File) => {
    setShowCameraModal(false);
    handlePhotoUpload(file);
  };

  // Handle Save Worker Profile
  const handleSaveWorkerProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingWorker) return;

    const cleanName = editName.trim();
    if (!cleanName) {
      setEditError('Worker name cannot be empty.');
      return;
    }

    setEditLoading(true);
    setEditError('');
    setEditSuccess('');

    try {
      const res = await adminUpdateWorkerProfileAction({
        workerId: editingWorker.worker_id,
        name: cleanName,
        phone: editPhone.trim() || null,
        photoUrl: editPhotoUrl,
        active: editActive,
      });

      if (!res.success) {
        throw new Error(res.error || 'Failed to save changes.');
      }

      // Optimistically update local state immediately
      setLocalWorkers(prev => prev.map(w => {
        if (w.worker_id !== editingWorker.worker_id) return w;
        return {
          ...w,
          worker_name: cleanName,
          worker_phone: res.formattedPhone || (editPhone.trim() ? editPhone.trim() : null),
          worker_photo_url: editPhotoUrl,
          active: editActive,
        };
      }));

      setEditSuccess('Worker profile updated successfully!');
      setTimeout(() => {
        setEditingWorker(null);
      }, 700);
    } catch (err: any) {
      setEditError(err.message || 'Failed to update profile.');
    } finally {
      setEditLoading(false);
    }
  };

  // Handle Create New Worker
  const handleCreateNewWorker = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newWorkerName.trim();
    if (!cleanName || !newWorkerFactoryId) {
      setAddWorkerError('Please enter a worker name and choose a factory.');
      return;
    }

    setAddWorkerLoading(true);
    setAddWorkerError('');

    try {
      const openingAdv = Math.max(0, parseFloat(newWorkerOpeningAdvance) || 0);
      const cleanPhone = newWorkerPhone.trim() || null;
      const supId = newWorkerSupervisorId || (supervisors.find(s => s.factory_id === newWorkerFactoryId)?.id || '');

      const res = await createWorkerServer(
        newWorkerFactoryId,
        supId,
        cleanName,
        cleanPhone,
        null,
        openingAdv
      );

      if (!res.success) {
        throw new Error(res.error || 'Failed to create worker.');
      }

      const newId = res.id || crypto.randomUUID();

      // Optimistically add to local state
      const createdWorker: FactoryWorkerBalance = {
        worker_id: newId,
        worker_name: cleanName,
        worker_phone: cleanPhone,
        worker_photo_url: null,
        factory_id: newWorkerFactoryId,
        supervisor_id: supId,
        opening_advance: openingAdv,
        opening_unpaid_salary: 0,
        monthly_salary: 0,
        total_cash_disbursed: 0,
        total_advance_given: openingAdv,
        total_advance_recovered: 0,
        running_advance: openingAdv,
        total_salary_earned: 0,
        total_salary_paid: 0,
        unpaid_salary: 0,
        net_payable: -openingAdv,
        total_bonus_paid: 0,
        active: true,
      };

      setLocalWorkers(prev => [createdWorker, ...prev]);
      setShowAddWorkerModal(false);
      setNewWorkerName('');
      setNewWorkerPhone('');
      setNewWorkerOpeningAdvance('0');
    } catch (err: any) {
      setAddWorkerError(err.message || 'Failed to create worker.');
    } finally {
      setAddWorkerLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <h1 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">
                Worker Profiles &amp; Management Hub
              </h1>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Manage worker profiles, phone numbers, and profile photos across all factories. Inspect full history of advances, hisaab settlements, and bonuses.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setNewWorkerName('');
                setNewWorkerPhone('');
                setNewWorkerOpeningAdvance('0');
                setAddWorkerError('');
                setShowAddWorkerModal(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-slate-800 transition-colors min-h-[38px]"
            >
              <Plus className="h-4 w-4" />
              <span>Add Worker</span>
            </button>
          </div>
        </div>

        {/* KPI Metrics Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-4 pt-4 border-t border-slate-100">
          <div className="bg-slate-50/70 border border-slate-200/80 rounded-lg p-2.5 text-center">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Total Workers</span>
            <p className="text-base font-black text-slate-900 mt-0.5">{metrics.totalWorkers}</p>
          </div>
          <div className="bg-emerald-50/70 border border-emerald-200/80 rounded-lg p-2.5 text-center">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">Active Workers</span>
            <p className="text-base font-black text-emerald-950 mt-0.5">{metrics.activeWorkers}</p>
          </div>
          <div className="bg-amber-50/70 border border-amber-200/80 rounded-lg p-2.5 text-center">
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800">Advances Owed</span>
            <p className="text-base font-black text-amber-950 mt-0.5">{formatINR(metrics.totalAdvancesOwed)}</p>
          </div>
          <div className="bg-purple-50/70 border border-purple-200/80 rounded-lg p-2.5 text-center">
            <span className="text-[10px] font-bold uppercase tracking-wider text-purple-800">Total Bonuses</span>
            <p className="text-base font-black text-purple-950 mt-0.5">{formatINR(metrics.totalBonusesGiven)}</p>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 sm:p-4 shadow-xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
          {/* Live Search */}
          <div className="sm:col-span-6 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by worker name or mobile number..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 min-h-[38px]"
            />
          </div>

          {/* Factory Selector */}
          <div className="sm:col-span-3">
            <select
              value={factoryFilter}
              onChange={(e) => setFactoryFilter(e.target.value)}
              className="w-full rounded-lg border border-slate-300 text-xs py-2 px-3 text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 min-h-[38px]"
            >
              <option value="all">All Factories ({factories.length})</option>
              {factories.map(f => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>

          {/* Status Toggle */}
          <div className="sm:col-span-3">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="w-full rounded-lg border border-slate-300 text-xs py-2 px-3 text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 min-h-[38px]"
            >
              <option value="active">Active Only</option>
              <option value="all">All Statuses</option>
              <option value="inactive">Inactive Only</option>
            </select>
          </div>
        </div>
      </div>

      {/* Workers Grid */}
      {filteredWorkers.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-xs text-slate-500 shadow-xs">
          No worker profiles match your search criteria.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {filteredWorkers.map((w) => {
            const factoryName = factoryMap.get(w.factory_id) || 'Factory';
            const hasPhone = !!w.worker_phone && w.worker_phone.trim() !== '';

            return (
              <div
                key={w.worker_id}
                className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs hover:border-slate-300 hover:shadow-sm transition-all flex flex-col justify-between"
              >
                {/* Top Section: Photo, Name, Phone, Factory */}
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="flex items-center gap-3">
                      {/* Avatar */}
                      <div className="relative h-12 w-12 rounded-full border border-slate-200 bg-slate-100 flex items-center justify-center shrink-0 overflow-hidden">
                        {w.worker_photo_url ? (
                          <img
                            src={w.worker_photo_url}
                            alt={w.worker_name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <User className="h-6 w-6 text-slate-400" />
                        )}
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(w)}
                          title="Update Profile Picture"
                          className="absolute inset-0 bg-black/40 text-white opacity-0 hover:opacity-100 flex items-center justify-center transition-opacity"
                        >
                          <Camera className="h-4 w-4" />
                        </button>
                      </div>

                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h3 className="text-sm font-bold text-slate-900 leading-snug">
                            {w.worker_name}
                          </h3>
                          <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                            w.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                          }`}>
                            {w.active ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                          <Building2 className="h-3 w-3 text-slate-400 shrink-0" />
                          <span>{factoryName}</span>
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleOpenEdit(w)}
                      className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition-colors shrink-0"
                      title="Edit Profile"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Phone Number Pill */}
                  <div className="rounded-lg bg-slate-50 border border-slate-200/80 p-2 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <Phone className={`h-3.5 w-3.5 ${hasPhone ? 'text-emerald-600' : 'text-slate-400'}`} />
                      <span className={`font-medium ${hasPhone ? 'text-slate-800' : 'text-slate-400 italic'}`}>
                        {hasPhone ? w.worker_phone : 'No phone linked'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(w)}
                      className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 transition-colors"
                    >
                      {hasPhone ? 'Change' : 'Add Phone'}
                    </button>
                  </div>

                  {/* Financial Balance Pills */}
                  <div className="grid grid-cols-3 gap-1.5 text-center pt-0.5">
                    <div className="p-1.5 rounded-lg bg-amber-50/70 border border-amber-200/60">
                      <span className="text-[9px] font-bold uppercase text-amber-800 block">Advance</span>
                      <span className="text-xs font-black text-amber-950 mt-0.5 block">
                        {formatINR(w.running_advance || 0)}
                      </span>
                    </div>
                    <div className="p-1.5 rounded-lg bg-emerald-50/70 border border-emerald-200/60">
                      <span className="text-[9px] font-bold uppercase text-emerald-800 block">Salary</span>
                      <span className="text-xs font-black text-emerald-950 mt-0.5 block">
                        {formatINR(w.unpaid_salary || 0)}
                      </span>
                    </div>
                    <div className="p-1.5 rounded-lg bg-purple-50/70 border border-purple-200/60">
                      <span className="text-[9px] font-bold uppercase text-purple-800 block">Bonus</span>
                      <span className="text-xs font-black text-purple-950 mt-0.5 block">
                        {formatINR(w.total_bonus_paid || 0)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Primary Card Action: Open History & Ledger */}
                <div className="pt-3 mt-3 border-t border-slate-100 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedWorkerId(w.worker_id);
                      setHistoryTab('advances');
                    }}
                    className="w-full py-2 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-2xs"
                  >
                    <span>View History &amp; Balances</span>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ========================================================================= */}
      {/* WORKER DETAIL & HISTORY MODAL WITH 4-WAY TOGGLES                          */}
      {/* ========================================================================= */}
      {selectedWorker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/75 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-full border border-slate-200 bg-white overflow-hidden flex items-center justify-center shrink-0">
                  {selectedWorker.worker_photo_url ? (
                    <img
                      src={selectedWorker.worker_photo_url}
                      alt={selectedWorker.worker_name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <User className="h-6 w-6 text-slate-400" />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-base font-bold text-slate-900">{selectedWorker.worker_name}</h2>
                    <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                      selectedWorker.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {selectedWorker.active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {factoryMap.get(selectedWorker.factory_id) || 'Factory'} • {selectedWorker.worker_phone || 'No phone linked'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleOpenEdit(selectedWorker)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-1"
                >
                  <Edit2 className="h-3.5 w-3.5" />
                  <span>Edit Profile</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedWorkerId(null)}
                  className="text-slate-400 hover:text-slate-900 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Quick Balances Row */}
            <div className="bg-slate-100/70 border-b border-slate-200 px-4 py-2.5 grid grid-cols-3 gap-2 text-center text-xs shrink-0">
              <div>
                <span className="text-[10px] font-bold uppercase text-slate-500 block">Outstanding Advance</span>
                <span className="font-black text-amber-900 text-sm">{formatINR(selectedWorker.running_advance || 0)}</span>
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase text-slate-500 block">Unpaid Salary</span>
                <span className="font-black text-emerald-800 text-sm">{formatINR(selectedWorker.unpaid_salary || 0)}</span>
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase text-slate-500 block">Total Bonuses Paid</span>
                <span className="font-black text-purple-800 text-sm">{formatINR(selectedWorker.total_bonus_paid || 0)}</span>
              </div>
            </div>

            {/* 4-Way History Toggles (Advances, Hisaab, Bonus, Ledger) */}
            <div className="p-2 border-b border-slate-200 bg-white shrink-0">
              <div className="grid grid-cols-4 gap-1 bg-slate-100 p-1 rounded-xl text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setHistoryTab('advances')}
                  className={`py-2 px-1 text-center rounded-lg transition-all min-h-[36px] flex items-center justify-center gap-1.5 ${
                    historyTab === 'advances'
                      ? 'bg-white text-slate-950 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <HandCoins className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                  <span>Advances ({selectedWorkerHistory.advances.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryTab('hisaab')}
                  className={`py-2 px-1 text-center rounded-lg transition-all min-h-[36px] flex items-center justify-center gap-1.5 ${
                    historyTab === 'hisaab'
                      ? 'bg-white text-slate-950 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Calculator className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                  <span>Hisaab ({selectedWorkerHistory.hisaabs.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryTab('bonus')}
                  className={`py-2 px-1 text-center rounded-lg transition-all min-h-[36px] flex items-center justify-center gap-1.5 ${
                    historyTab === 'bonus'
                      ? 'bg-white text-slate-950 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Gift className="h-3.5 w-3.5 text-purple-600 shrink-0" />
                  <span>Bonus ({selectedWorkerHistory.bonuses.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryTab('ledger')}
                  className={`py-2 px-1 text-center rounded-lg transition-all min-h-[36px] flex items-center justify-center gap-1.5 ${
                    historyTab === 'ledger'
                      ? 'bg-white text-slate-950 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <FileText className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                  <span>Ledger ({selectedWorkerHistory.ledger.length})</span>
                </button>
              </div>
            </div>

            {/* Scrollable Tab Content */}
            <div className="p-4 overflow-y-auto space-y-3 flex-1 min-h-[260px]">
              {/* 1. ADVANCES TAB */}
              {historyTab === 'advances' && (
                <>
                  {selectedWorkerHistory.advances.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-500">
                      No advances recorded for this worker.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden bg-white">
                      {selectedWorkerHistory.advances.map((adv) => (
                        <div key={adv.id} className="p-3 flex items-center justify-between hover:bg-slate-50 transition-colors">
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded border ${
                                adv.isCash ? 'bg-slate-100 text-slate-700 border-slate-200' : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                              }`}>
                                {adv.paymentMethodLabel}
                              </span>
                              {adv.isRefunded && (
                                <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-amber-100 text-amber-800">
                                  Refunded
                                </span>
                              )}
                              <span className="text-xs text-slate-500 font-medium">{adv.supervisorName}</span>
                            </div>
                            <p className="text-xs font-semibold text-slate-800">{adv.note}</p>
                            <p className="text-[10px] text-slate-400">
                              {new Date(adv.date).toLocaleDateString('en-IN', {
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </p>
                          </div>
                          <div className="text-right space-y-1">
                            <span className={`text-xs font-black block ${adv.isRefunded ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                              {formatINR(adv.amount)}
                            </span>
                            {adv.photoUrl && (
                              <button
                                type="button"
                                onClick={() => {
                                  setViewingProofUrl(adv.photoUrl!);
                                  setViewingProofTitle(`Advance Proof: ${selectedWorker.worker_name}`);
                                }}
                                className="text-[10px] text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2 py-0.5 rounded font-semibold transition-colors"
                              >
                                View Proof
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* 2. HISAAB TAB */}
              {historyTab === 'hisaab' && (
                <>
                  {selectedWorkerHistory.hisaabs.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-500">
                      No Hisaab settlements recorded for this worker.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden bg-white">
                      {selectedWorkerHistory.hisaabs.map((h) => (
                        <div key={h.id} className="p-3.5 space-y-2 hover:bg-slate-50 transition-colors">
                          <div className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-900">Period: {h.fromDate} to {h.toDate}</span>
                              <span className="text-[10px] text-slate-500">by {h.supervisorName}</span>
                            </div>
                            <span className="text-[10px] text-slate-400">
                              {new Date(h.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </span>
                          </div>

                          {/* Hisaab Details Breakdown Grid */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-50 p-2.5 rounded-lg border border-slate-200/70 text-xs">
                            <div>
                              <span className="text-[10px] text-slate-500 block uppercase">Wages Earned</span>
                              <span className="font-bold text-slate-900">{formatINR(h.totalWages)}</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-amber-700 block uppercase">Advance Deducted</span>
                              <span className="font-bold text-amber-900">-{formatINR(h.advanceDeducted)}</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-emerald-700 block uppercase">Cash Paid</span>
                              <span className="font-bold text-emerald-900">{formatINR(h.cashPaid)}</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-indigo-700 block uppercase">Online QR Paid</span>
                              <span className="font-bold text-indigo-900">{formatINR(h.onlinePaid)}</span>
                            </div>
                          </div>

                          {h.note && (
                            <p className="text-[11px] text-slate-600 italic">"{h.note}"</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* 3. BONUS TAB */}
              {historyTab === 'bonus' && (
                <>
                  {selectedWorkerHistory.bonuses.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-500">
                      No bonuses recorded for this worker yet.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden bg-white">
                      {selectedWorkerHistory.bonuses.map((b) => {
                        const isOnline = b.payment_method === 'online';
                        return (
                          <div key={b.id} className="p-3 flex items-center justify-between hover:bg-slate-50 transition-colors">
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2">
                                <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded border ${
                                  isOnline ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                }`}>
                                  {isOnline ? 'Online (Bank / UPI)' : 'Cash in Hand'}
                                </span>
                                <span className="text-xs text-slate-500 font-medium">{b.supervisor_name || 'Supervisor'}</span>
                              </div>
                              <p className="text-xs font-semibold text-slate-800">{b.note || 'Festival / Performance Bonus'}</p>
                              <p className="text-[10px] text-slate-400">
                                {new Date(b.created_at).toLocaleDateString('en-IN', {
                                  day: 'numeric',
                                  month: 'short',
                                  year: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </p>
                            </div>
                            <div className="text-right space-y-1">
                              <span className="text-xs font-black text-purple-700 block">
                                +{formatINR(Number(b.amount || 0))}
                              </span>
                              {b.photo_url && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setViewingProofUrl(b.photo_url!);
                                    setViewingProofTitle(`Bonus Proof: ${selectedWorker.worker_name}`);
                                  }}
                                  className="text-[10px] text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2 py-0.5 rounded font-semibold transition-colors"
                                >
                                  View Proof
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {/* 4. COMBINED LEDGER TAB */}
              {historyTab === 'ledger' && (
                <>
                  {selectedWorkerHistory.ledger.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-500">
                      No ledger history for this worker yet.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden bg-white">
                      {selectedWorkerHistory.ledger.map((item) => (
                        <div key={item.id} className="p-3 flex items-center justify-between hover:bg-slate-50 transition-colors">
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded border ${item.badge}`}>
                                {item.title}
                              </span>
                              <span className="text-xs text-slate-500 font-medium">{item.actor}</span>
                            </div>
                            <p className="text-xs text-slate-800">{item.note}</p>
                            <p className="text-[10px] text-slate-400">
                              {new Date(item.date).toLocaleDateString('en-IN', {
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </p>
                          </div>
                          <div className="text-right space-y-1">
                            <span className="text-xs font-black text-slate-900 block">
                              {formatINR(item.amount)}
                            </span>
                            {item.photoUrl && (
                              <button
                                type="button"
                                onClick={() => {
                                  setViewingProofUrl(item.photoUrl!);
                                  setViewingProofTitle(`Document Proof: ${selectedWorker.worker_name}`);
                                }}
                                className="text-[10px] text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2 py-0.5 rounded font-semibold transition-colors"
                              >
                                View Proof
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* EDIT WORKER PROFILE MODAL (Name, Phone, PFP, Active)                      */}
      {/* ========================================================================= */}
      {editingWorker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/75 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full overflow-hidden flex flex-col shadow-2xl">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Edit2 className="h-4 w-4 text-slate-700" />
                <h3 className="text-sm font-bold text-slate-900">Edit Worker Profile</h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingWorker(null)}
                className="text-slate-400 hover:text-slate-900 p-1 rounded-lg hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveWorkerProfile} className="p-4 space-y-4">
              {/* Profile Photo Editor */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                  Profile Photo (PFP)
                </label>
                <div className="flex items-center gap-4">
                  <div className="relative h-16 w-16 rounded-full border border-slate-200 bg-slate-100 overflow-hidden flex items-center justify-center shrink-0">
                    {uploadingPhoto ? (
                      <RefreshCw className="h-6 w-6 text-slate-400 animate-spin" />
                    ) : editPhotoUrl ? (
                      <img src={editPhotoUrl} alt="Preview" className="h-full w-full object-cover" />
                    ) : (
                      <User className="h-8 w-8 text-slate-400" />
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="file"
                      ref={fileInputRef}
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handlePhotoUpload(file);
                      }}
                    />
                    <button
                      type="button"
                      disabled={uploadingPhoto}
                      onClick={() => fileInputRef.current?.click()}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-1.5 transition-colors"
                    >
                      <Upload className="h-3.5 w-3.5 text-slate-500" />
                      <span>Upload</span>
                    </button>
                    <button
                      type="button"
                      disabled={uploadingPhoto}
                      onClick={() => setShowCameraModal(true)}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-1.5 transition-colors"
                    >
                      <Camera className="h-3.5 w-3.5 text-slate-500" />
                      <span>Camera</span>
                    </button>
                    {editPhotoUrl && (
                      <button
                        type="button"
                        onClick={() => setEditPhotoUrl(null)}
                        className="px-2 py-1.5 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-xs font-semibold text-red-700 flex items-center gap-1 transition-colors"
                        title="Remove Photo"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Name Input */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Worker Name
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="e.g. Ramesh Kumar"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-950 focus:ring-2 focus:ring-slate-900 focus:outline-none min-h-[42px]"
                />
              </div>

              {/* Phone Input */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Mobile Number
                </label>
                <div className="relative rounded-lg shadow-xs">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <Phone className="h-4 w-4 text-slate-400" />
                  </div>
                  <input
                    type="tel"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    placeholder="10-digit mobile number"
                    className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm text-slate-950 focus:ring-2 focus:ring-slate-900 focus:outline-none min-h-[42px]"
                  />
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Only Admins can update or reassign mobile numbers.
                </p>
              </div>

              {/* Active / Inactive Status */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Employment Status
                </label>
                <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-lg text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => setEditActive(true)}
                    className={`py-2 text-center rounded-md transition-all ${
                      editActive ? 'bg-white text-emerald-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Active Worker
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditActive(false)}
                    className={`py-2 text-center rounded-md transition-all ${
                      !editActive ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Inactive / Left
                  </button>
                </div>
              </div>

              {editError && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 text-xs text-red-700 font-medium">
                  {editError}
                </div>
              )}

              {editSuccess && (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-2.5 text-xs text-emerald-800 font-bold flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>{editSuccess}</span>
                </div>
              )}

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditingWorker(null)}
                  disabled={editLoading}
                  className="w-1/2 py-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 transition-colors min-h-[42px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editLoading}
                  className="w-1/2 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-all flex items-center justify-center gap-1.5 min-h-[42px]"
                >
                  {editLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <span>Save Changes</span>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ADD NEW WORKER MODAL                                                      */}
      {/* ========================================================================= */}
      {showAddWorkerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/75 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full overflow-hidden flex flex-col shadow-2xl">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Plus className="h-4 w-4 text-slate-700" />
                <h3 className="text-sm font-bold text-slate-900">Add New Worker</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAddWorkerModal(false)}
                className="text-slate-400 hover:text-slate-900 p-1 rounded-lg hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateNewWorker} className="p-4 space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Worker Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={newWorkerName}
                  onChange={(e) => setNewWorkerName(e.target.value)}
                  placeholder="e.g. Sanjay Verma"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-950 focus:ring-2 focus:ring-slate-900 focus:outline-none min-h-[42px]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Factory *
                </label>
                <select
                  required
                  value={newWorkerFactoryId}
                  onChange={(e) => {
                    setNewWorkerFactoryId(e.target.value);
                    const matchingSup = supervisors.find(s => s.factory_id === e.target.value);
                    if (matchingSup) setNewWorkerSupervisorId(matchingSup.id);
                  }}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-950 focus:ring-2 focus:ring-slate-900 focus:outline-none min-h-[42px] bg-white"
                >
                  {factories.map(f => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Supervisor (Optional)
                </label>
                <select
                  value={newWorkerSupervisorId}
                  onChange={(e) => setNewWorkerSupervisorId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-950 focus:ring-2 focus:ring-slate-900 focus:outline-none min-h-[42px] bg-white"
                >
                  <option value="">Default Supervisor</option>
                  {supervisors
                    .filter(s => !newWorkerFactoryId || s.factory_id === newWorkerFactoryId)
                    .map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Mobile Number (Optional)
                </label>
                <input
                  type="tel"
                  value={newWorkerPhone}
                  onChange={(e) => setNewWorkerPhone(e.target.value)}
                  placeholder="10-digit mobile number"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-950 focus:ring-2 focus:ring-slate-900 focus:outline-none min-h-[42px]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Opening Advance Balance (INR)
                </label>
                <input
                  type="number"
                  min="0"
                  value={newWorkerOpeningAdvance}
                  onChange={(e) => setNewWorkerOpeningAdvance(e.target.value)}
                  placeholder="0"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-950 focus:ring-2 focus:ring-slate-900 focus:outline-none min-h-[42px]"
                />
              </div>

              {addWorkerError && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 text-xs text-red-700 font-medium">
                  {addWorkerError}
                </div>
              )}

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddWorkerModal(false)}
                  disabled={addWorkerLoading}
                  className="w-1/2 py-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 transition-colors min-h-[42px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addWorkerLoading}
                  className="w-1/2 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-all flex items-center justify-center gap-1.5 min-h-[42px]"
                >
                  {addWorkerLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <span>Create Worker</span>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* FULL-SCREEN PROOF PHOTO VIEWER MODAL                                      */}
      {/* ========================================================================= */}
      {viewingProofUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full overflow-hidden flex flex-col shadow-2xl">
            <div className="p-3.5 flex items-center justify-between border-b border-slate-800 text-white">
              <span className="text-xs font-bold uppercase tracking-wider">{viewingProofTitle}</span>
              <button
                type="button"
                onClick={() => setViewingProofUrl(null)}
                className="text-slate-400 hover:text-white p-1 rounded-full hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="aspect-square w-full bg-black flex items-center justify-center overflow-hidden">
              <img src={viewingProofUrl} alt="Proof" className="w-full h-full object-contain" />
            </div>
            <div className="p-3 bg-slate-900 border-t border-slate-800 text-center">
              <button
                type="button"
                onClick={() => setViewingProofUrl(null)}
                className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-lg"
              >
                Close Viewer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Camera Capture Modal */}
      <CameraCaptureModal
        isOpen={showCameraModal}
        onClose={() => setShowCameraModal(false)}
        onCapture={handleCameraCapture}
        title="Capture Worker Profile Photo"
      />
    </div>
  );
}
