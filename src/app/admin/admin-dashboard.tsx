'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { createOfficeDisbursement } from '@/app/actions/admin';
import { AdminAIChat } from './admin-ai-chat';
import { NotificationBanner } from '@/components/notification-banner';
import { getCashRequests, updateCashRequestStatus, CashRequest } from '@/app/actions/cash-requests';
import { playAlertSound, sendFundFlowNotification } from '@/lib/notifications';
import { createBrowserClient } from '@/lib/supabase/browser-client';
import { HandCoins, Coins } from 'lucide-react';
import { formatINR, parseHandoverNote } from '@/lib/utils';
import { 
  Building2, 
  ArrowUpRight, 
  AlertTriangle, 
  Download, 
  RefreshCw, 
  Plus, 
  TrendingUp, 
  Activity,
  History,
  Calendar,
  CalendarDays,
  Search,
  ChevronDown,
  ChevronUp,
  Camera,
  Clock,
  User,
  X
} from 'lucide-react';

interface Factory {
  id: string;
  name: string;
  location: string;
  active: boolean;
}

interface Supervisor {
  id: string;
  name: string;
  factory_id: string;
  phone: string;
  active: boolean;
  factories?: { name: string };
}

interface Transaction {
  id: string;
  type: 'office_to_supervisor' | 'supervisor_to_supervisor' | 'supervisor_to_worker';
  from_supervisor_id: string | null;
  to_supervisor_id: string | null;
  to_worker_id: string | null;
  amount: number;
  status: 'pending' | 'confirmed' | 'disputed';
  confirmed_at: string | null;
  confirmed_by: string | null;
  note: string | null;
  created_by: string;
  created_at: string;
  from?: { name: string } | null;
  to_sup?: { name: string; factory_id: string } | null;
  to_work?: { name: string; factory_id: string; active?: boolean } | null;
}

interface Expense {
  id: string;
  supervisor_id: string;
  factory_id: string;
  amount: number;
  category: string;
  note: string;
  photo_url: string | null;
  created_at: string;
  supervisors?: { name: string } | null;
  factories?: { name: string } | null;
}

interface WorkerBalance {
  worker_id: string;
  worker_name: string;
  worker_phone: string | null;
  worker_photo_url: string | null;
  factory_id: string;
  supervisor_id: string;
  opening_advance: number;
  total_cash_disbursed: number;
  running_advance: number;
  active: boolean;
}

interface AdminDashboardProps {
  factories: Factory[];
  supervisors: Supervisor[];
  transactions: Transaction[];
  expenses: Expense[];
  workers: WorkerBalance[];
}

export function AdminDashboard({
  factories,
  supervisors,
  transactions,
  expenses,
  workers,
}: AdminDashboardProps) {
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState(false);

  // Cash Replenishment Requests from Supervisors
  const [cashRequests, setCashRequests] = useState<CashRequest[]>([]);
  const [disburseSupervisorId, setDisburseSupervisorId] = useState<string>('');
  const [disburseAmount, setDisburseAmount] = useState<string>('');
  const [disburseNote, setDisburseNote] = useState<string>('');
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [adminViewingPhotoUrl, setAdminViewingPhotoUrl] = useState<string | null>(null);

  const supabase = createBrowserClient();

  // Load cash requests on mount, poll fallback & subscribe to real-time broadcast alerts
  useEffect(() => {
    getCashRequests().then(setCashRequests);

    // 1. Periodic poll fallback
    const interval = setInterval(() => {
      getCashRequests().then(setCashRequests);
    }, 15000);

    // 2. Real-time Supabase Broadcast Channel Listener
    const channel = supabase.channel('fundflow-notifications');
    channel
      .on('broadcast', { event: 'fundflow_alert' }, (msg: any) => {
        const payload = msg?.payload;
        if (!payload) return;

        // A. Supervisor submitted a Cash Request
        if (payload.type === 'cash_request') {
          sendFundFlowNotification(`🔔 New Cash Request: ${formatINR(payload.amount)}`, {
            body: `${payload.supervisor_name} (${payload.factory_name}) requested ${formatINR(payload.amount)}: "${payload.note}"`,
            soundType: 'alert',
            url: '/admin#cash-requests-section',
          });
          getCashRequests().then(setCashRequests);
        }

        // B. Supervisor confirmed an office disbursement
        if (payload.type === 'receipt_confirmed' && payload.from_type === 'office') {
          sendFundFlowNotification('✅ Cash Receipt Confirmed', {
            body: `${payload.to_supervisor_name} confirmed receipt of ${formatINR(payload.amount)}.`,
            soundType: 'success',
            url: '/admin',
          });
        }

        // C. Supervisor disputed a transaction
        if (payload.type === 'receipt_disputed') {
          sendFundFlowNotification('⚠️ Transaction Disputed', {
            body: `${payload.to_supervisor_name} flagged an issue on a transaction: "${payload.note || 'Dispute raised'}"`,
            soundType: 'alert',
            url: '/admin',
          });
        }
      })
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  const handleApproveRequest = (req: CashRequest) => {
    setDisburseSupervisorId(req.supervisor_id);
    setDisburseAmount(String(req.amount));
    setDisburseNote(req.note ? `Approved Request: ${req.note}` : 'Factory cash replenishment');
    setActiveRequestId(req.id);

    // Scroll smoothly to disbursement form
    const formEl = document.getElementById('office-disbursement-form');
    if (formEl) {
      formEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const handleDismissRequest = async (requestId: string) => {
    await updateCashRequestStatus(requestId, 'dismissed');
    getCashRequests().then(setCashRequests);
  };
  const [formLoading, setFormLoading] = useState(false);

  // Ledger Filters State
  const [selectedFactoryId, setSelectedFactoryId] = useState<string>('all');
  const [selectedSupervisorId, setSelectedSupervisorId] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedPurpose, setSelectedPurpose] = useState<string>('all');
  const [ledgerFromDate, setLedgerFromDate] = useState<string>('');
  const [ledgerToDate, setLedgerToDate] = useState<string>('');

  // Worker Advances Filter State
  const [workerFromDate, setWorkerFromDate] = useState<string>('');
  const [workerToDate, setWorkerToDate] = useState<string>('');
  const [workerFactoryId, setWorkerFactoryId] = useState<string>('all');
  const [workerSupervisorId, setWorkerSupervisorId] = useState<string>('all');
  const [workerSearchQuery, setWorkerSearchQuery] = useState<string>('');
  const [expandedWorkerId, setExpandedWorkerId] = useState<string | null>(null);

  // Handle office disbursement submission
  const handleDisbursementSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    setFormError(null);
    setFormSuccess(false);
    setFormLoading(true);

    const formData = new FormData(form);
    const targetSupId = (formData.get('supervisor_id') as string) || disburseSupervisorId;
    const amountVal = parseFloat(formData.get('amount') as string) || parseFloat(disburseAmount) || 0;
    const noteVal = (formData.get('note') as string) || disburseNote || '';

    const result = await createOfficeDisbursement(null, formData);

    if (result && result.error) {
      setFormError(result.error);
      setFormLoading(false);
    } else {
      // Direct WebSocket broadcast to supervisor's phone
      try {
        supabase.channel('fundflow-notifications').send({
          type: 'broadcast',
          event: 'fundflow_alert',
          payload: {
            type: 'office_disbursement',
            to_supervisor_id: targetSupId,
            amount: amountVal,
            note: noteVal,
          }
        }).catch(() => {});
      } catch {}

      setFormSuccess(true);
      setFormLoading(false);
      playAlertSound('cash_in');
      if (activeRequestId) {
        await updateCashRequestStatus(activeRequestId, 'approved');
        setActiveRequestId(null);
        getCashRequests().then(setCashRequests);
      }
      setDisburseSupervisorId('');
      setDisburseAmount('');
      setDisburseNote('');
      form.reset();
      // Auto fade success message
      setTimeout(() => setFormSuccess(false), 5000);
    }
  };

  // --- 1. Calculate Factory Cash Positions ---
  const factoryCashPositions = factories.map(factory => {
    // Supervisors in this factory
    const factorySupIds = supervisors
      .filter(s => s.factory_id === factory.id)
      .map(s => s.id);

    // Office Sent (Confirmed or pending, excluding cancelled/disputed)
    const sent = transactions
      .filter(t => t.type === 'office_to_supervisor' && t.to_supervisor_id && factorySupIds.includes(t.to_supervisor_id) && t.status !== 'disputed')
      .reduce((sum, t) => sum + Number(t.amount), 0);

    // Office Confirmed
    const confirmed = transactions
      .filter(t => t.type === 'office_to_supervisor' && t.to_supervisor_id && factorySupIds.includes(t.to_supervisor_id) && t.status === 'confirmed')
      .reduce((sum, t) => sum + Number(t.amount), 0);

    // Disbursed to workers
    const disbursed = transactions
      .filter(t => t.type === 'supervisor_to_worker' && t.from_supervisor_id && factorySupIds.includes(t.from_supervisor_id) && t.status === 'confirmed' && t.to_work?.active !== false && t.to_work?.name !== 'Deleted Worker')
      .reduce((sum, t) => sum + Number(t.amount), 0);

    // Calculate dynamic cash on hand for supervisors in this factory
    let remaining = 0;
    factorySupIds.forEach(supId => {
      // Incoming office confirmed
      const incOffice = transactions
        .filter(t => t.type === 'office_to_supervisor' && t.to_supervisor_id === supId && t.status === 'confirmed')
        .reduce((sum, t) => sum + Number(t.amount), 0);

      // Incoming supervisors confirmed
      const incSup = transactions
        .filter(t => t.type === 'supervisor_to_supervisor' && t.to_supervisor_id === supId && t.status === 'confirmed')
        .reduce((sum, t) => sum + Number(t.amount), 0);

      // Outgoing supervisors not disputed (meaning pending or confirmed)
      const outSup = transactions
        .filter(t => t.type === 'supervisor_to_supervisor' && t.from_supervisor_id === supId && t.status !== 'disputed')
        .reduce((sum, t) => sum + Number(t.amount), 0);

      // Outgoing workers confirmed
      const outWorker = transactions
        .filter(t => t.type === 'supervisor_to_worker' && t.from_supervisor_id === supId && t.status === 'confirmed' && t.to_work?.active !== false && t.to_work?.name !== 'Deleted Worker')
        .reduce((sum, t) => sum + Number(t.amount), 0);

      // Expenses by this supervisor
      const supExpenses = expenses
        .filter(e => e.supervisor_id === supId)
        .reduce((sum, e) => sum + Number(e.amount), 0);

      remaining += (incOffice + incSup - outSup - outWorker - supExpenses);
    });

    const factoryExpenses = expenses
      .filter(e => factorySupIds.includes(e.supervisor_id))
      .reduce((sum, e) => sum + Number(e.amount), 0);

    const transfersReceived = transactions
      .filter(t => t.type === 'supervisor_to_supervisor' && t.to_supervisor_id && factorySupIds.includes(t.to_supervisor_id) && t.status === 'confirmed')
      .reduce((sum, t) => sum + Number(t.amount), 0);

    const transfersSent = transactions
      .filter(t => t.type === 'supervisor_to_supervisor' && t.from_supervisor_id && factorySupIds.includes(t.from_supervisor_id) && t.status !== 'disputed')
      .reduce((sum, t) => sum + Number(t.amount), 0);

    const transfers = transfersReceived - transfersSent;

    return {
      id: factory.id,
      name: factory.name,
      location: factory.location,
      sent,
      confirmed,
      transfers,
      disbursed,
      expenses: factoryExpenses,
      remaining,
    };
  });

  // --- 2. Calculate Supervisor Leaderboard (by total cash handled) ---
  const supervisorLeaderboard = supervisors.map(sup => {
    // Total cash handled = confirmed office cash received + confirmed transfers received from other supervisors
    const officeRec = transactions
      .filter(t => t.type === 'office_to_supervisor' && t.to_supervisor_id === sup.id && t.status === 'confirmed')
      .reduce((sum, t) => sum + Number(t.amount), 0);

    const supRec = transactions
      .filter(t => t.type === 'supervisor_to_supervisor' && t.to_supervisor_id === sup.id && t.status === 'confirmed')
      .reduce((sum, t) => sum + Number(t.amount), 0);

    return {
      id: sup.id,
      name: sup.name,
      factory: sup.factories?.name || 'Unassigned',
      totalHandled: officeRec + supRec,
    };
  }).sort((a, b) => b.totalHandled - a.totalHandled);

  // Check if a transaction is pending and older than 24 hours
  const isOlderThan24Hours = (createdAt: string) => {
    const hours = (new Date().getTime() - new Date(createdAt).getTime()) / (1000 * 60 * 60);
    return hours >= 24;
  };

  // --- 3. Combine and Filter Ledger Entries (Transactions + Expenses) ---
  const filteredLedger = [
    ...transactions
      .filter(tx => {
        if (tx.type === 'supervisor_to_worker' && (tx.to_work?.active === false || tx.to_work?.name === 'Deleted Worker')) {
          return false;
        }
        return true;
      })
      .map(tx => {
      let purpose: 'Wages' | 'Expenses' | 'Transfers' = 'Transfers';
      if (tx.type === 'supervisor_to_worker') {
        purpose = 'Wages';
      }
      
      let factoryId: string | null = null;
      if (tx.to_sup) {
        factoryId = tx.to_sup.factory_id;
      } else if (tx.to_work) {
        factoryId = tx.to_work.factory_id;
      } else if (tx.from_supervisor_id) {
        factoryId = supervisors.find(s => s.id === tx.from_supervisor_id)?.factory_id || null;
      }

      return {
        id: tx.id,
        created_at: tx.created_at,
        amount: Number(tx.amount),
        status: tx.status,
        note: tx.note,
        type: tx.type,
        purpose,
        fromLabel: tx.type === 'office_to_supervisor' ? 'Office' : tx.from?.name || 'Supervisor',
        toLabel: tx.type === 'supervisor_to_worker' ? tx.to_work?.name || 'Worker' : tx.to_sup?.name || 'Supervisor',
        factoryId,
        supervisorId: tx.from_supervisor_id || tx.to_supervisor_id,
        isFlagged: tx.status === 'pending' && isOlderThan24Hours(tx.created_at),
      };
    }),
    ...expenses.map(exp => {
      return {
        id: exp.id,
        created_at: exp.created_at,
        amount: Number(exp.amount),
        status: 'confirmed',
        note: `${exp.category}${exp.note ? `: ${exp.note}` : ''}`,
        type: 'expense',
        purpose: 'Expenses' as const,
        fromLabel: exp.supervisors?.name || 'Supervisor',
        toLabel: 'Vendor / Shop',
        factoryId: exp.factory_id,
        supervisorId: exp.supervisor_id,
        isFlagged: false,
      };
    })
  ].filter(entry => {
    // Factory Filter
    if (selectedFactoryId !== 'all' && entry.factoryId !== selectedFactoryId) {
      return false;
    }

    // Supervisor Filter
    if (selectedSupervisorId !== 'all' && entry.supervisorId !== selectedSupervisorId) {
      return false;
    }

    // Status Filter
    if (selectedStatus !== 'all' && entry.status !== selectedStatus) {
      return false;
    }

    // Purpose Filter
    if (selectedPurpose !== 'all' && entry.purpose.toLowerCase() !== selectedPurpose.toLowerCase()) {
      return false;
    }

    // Ledger Date Range Filters
    if (ledgerFromDate && !isWithinDateRange(entry.created_at, ledgerFromDate, undefined)) {
      return false;
    }
    if (ledgerToDate && !isWithinDateRange(entry.created_at, undefined, ledgerToDate)) {
      return false;
    }

    return true;
  }).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  // Helper for date range checks
  function isWithinDateRange(isoStr: string, from?: string, to?: string) {
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
  }

  // --- 4. CSV Export ---
  const exportToCSV = () => {
    const headers = ['Record ID', 'Purpose', 'Type/Category', 'From', 'To/Vendor', 'Amount (INR)', 'Status', 'Notes', 'Created At'];
    const rows = filteredLedger.map(entry => {
      return [
        entry.id,
        entry.purpose,
        entry.type.replace(/_/g, ' ').toUpperCase(),
        entry.fromLabel,
        entry.toLabel,
        entry.amount,
        entry.status.toUpperCase(),
        entry.note || '',
        new Date(entry.created_at).toLocaleString(),
      ];
    });

    const csvContent = [headers, ...rows]
      .map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `fundflow_ledger_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // --- 5. Worker Advances Reporting by Date Range ---
  const setWorkerDatePreset = (preset: 'today' | 'this_week' | 'this_month' | 'last_month' | 'all') => {
    const now = new Date();
    if (preset === 'today') {
      const today = now.toISOString().split('T')[0];
      setWorkerFromDate(today);
      setWorkerToDate(today);
    } else if (preset === 'this_week') {
      const d = new Date();
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(d.setDate(diff)).toISOString().split('T')[0];
      const today = now.toISOString().split('T')[0];
      setWorkerFromDate(monday);
      setWorkerToDate(today);
    } else if (preset === 'this_month') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const today = now.toISOString().split('T')[0];
      setWorkerFromDate(firstDay);
      setWorkerToDate(today);
    } else if (preset === 'last_month') {
      const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0];
      const lastDay = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0];
      setWorkerFromDate(firstDay);
      setWorkerToDate(lastDay);
    } else if (preset === 'all') {
      setWorkerFromDate('');
      setWorkerToDate('');
    }
  };

  const activeWorkers = workers.filter(w => w.active !== false && w.worker_name !== 'Deleted Worker');

  const workerReports = activeWorkers.map(w => {
    const allDisbursements = transactions.filter(
      t => t.type === 'supervisor_to_worker' && t.to_worker_id === w.worker_id && t.status === 'confirmed'
    );
    const periodDisbursements = allDisbursements.filter(t => 
      isWithinDateRange(t.created_at, workerFromDate, workerToDate)
    );
    const periodAdvance = periodDisbursements.reduce((sum, t) => sum + Number(t.amount), 0);
    const factoryName = factories.find(f => f.id === w.factory_id)?.name || 'Unknown Factory';
    const supervisorName = supervisors.find(s => s.id === w.supervisor_id)?.name || 'Unknown Supervisor';

    return {
      worker: w,
      periodAdvance,
      periodCount: periodDisbursements.length,
      periodDisbursements,
      allDisbursements,
      factoryName,
      supervisorName,
    };
  });

  const filteredWorkerReports = workerReports.filter(item => {
    if (workerFactoryId !== 'all' && item.worker.factory_id !== workerFactoryId) return false;
    if (workerSupervisorId !== 'all' && item.worker.supervisor_id !== workerSupervisorId) return false;
    if (workerSearchQuery) {
      const q = workerSearchQuery.toLowerCase();
      const matchName = item.worker.worker_name.toLowerCase().includes(q);
      const matchPhone = item.worker.worker_phone && item.worker.worker_phone.includes(q);
      if (!matchName && !matchPhone) return false;
    }
    return true;
  }).sort((a, b) => {
    if (workerFromDate || workerToDate) {
      if (b.periodAdvance !== a.periodAdvance) return b.periodAdvance - a.periodAdvance;
    }
    return Number(b.worker.running_advance) - Number(a.worker.running_advance);
  });

  const totalWorkerPeriodAdvance = filteredWorkerReports.reduce((sum, item) => sum + item.periodAdvance, 0);
  const workersWithPeriodAdvance = filteredWorkerReports.filter(item => item.periodAdvance > 0).length;
  const totalWorkerPeriodTxCount = filteredWorkerReports.reduce((sum, item) => sum + item.periodCount, 0);

  const exportWorkerAdvancesToCSV = () => {
    const headers = [
      'Worker Name',
      'Phone',
      'Factory',
      'Supervisor',
      'Advances in Period (Count)',
      'Advance in Selected Period (INR)',
      'Total Running Advance (INR)',
      'Period From',
      'Period To',
    ];
    const rows = filteredWorkerReports.map(item => [
      item.worker.worker_name,
      item.worker.worker_phone || 'N/A',
      item.factoryName,
      item.supervisorName,
      item.periodCount,
      item.periodAdvance,
      item.worker.running_advance,
      workerFromDate || 'All Time',
      workerToDate || 'All Time',
    ]);

    const csvContent = [headers, ...rows]
      .map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `fundflow_worker_advances_${workerFromDate || 'all'}_to_${workerToDate || 'all'}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const activeSupervisors = supervisors.filter(s => s.active);

  return (
    <div className="space-y-6">
      {/* Real-time Notifications Banner */}
      <NotificationBanner role="admin" />

      {/* Overview stats */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Ledger Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">Real-time factory cash positions and disbursements feed.</p>
        </div>
        <button
          onClick={exportToCSV}
          className="flex items-center gap-2 rounded-md bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold px-4 py-2 text-sm shadow-sm min-h-[44px]"
        >
          <Download className="h-4 w-4" />
          <span>Export Feed to CSV</span>
        </button>
      </div>

      {/* AI Database Intelligence Assistant */}
      <AdminAIChat />

      {/* Grid: Disbursement Form & Cash positions */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left Column: Office Disbursement Form */}
        <div id="office-disbursement-form" className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm lg:col-span-1 space-y-4">
          {/* Pending Cash Replenishment Requests from Supervisors */}
          {cashRequests.filter(r => r.status === 'pending').length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold text-amber-900">
                  <HandCoins className="h-4 w-4 text-amber-600" />
                  <span>Cash Requests ({cashRequests.filter(r => r.status === 'pending').length})</span>
                </div>
              </div>

              <div className="space-y-2">
                {cashRequests.filter(r => r.status === 'pending').map(req => (
                  <div key={req.id} className="bg-white border border-amber-200 rounded p-2.5 shadow-xs text-xs space-y-1.5">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="font-bold text-slate-900">{req.supervisor_name}</span>
                        <span className="text-[10px] text-slate-500 block">{req.factory_name}</span>
                      </div>
                      <span className="font-extrabold text-slate-950 text-sm">₹{Number(req.amount).toLocaleString('en-IN')}</span>
                    </div>

                    <p className="text-[11px] text-slate-600 italic bg-slate-50 rounded p-1 border border-slate-100">
                      "{req.note}"
                    </p>

                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleApproveRequest(req)}
                        className="flex-1 py-1 px-2 rounded bg-slate-900 text-white text-[11px] font-bold hover:bg-slate-800 transition-colors"
                      >
                        Approve & Fill Form
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDismissRequest(req.id)}
                        className="py-1 px-2 rounded border border-slate-200 text-slate-500 text-[11px] font-medium hover:bg-slate-50"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3 mb-4">
            <ArrowUpRight className="h-5 w-5 text-slate-600" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900">Disburse Office Cash</h2>
          </div>

          <form onSubmit={handleDisbursementSubmit} className="space-y-4">
            <div>
              <label htmlFor="supervisorId" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                Select Supervisor
              </label>
              <select
                id="supervisorId"
                name="supervisorId"
                required
                value={disburseSupervisorId}
                onChange={(e) => setDisburseSupervisorId(e.target.value)}
                disabled={formLoading}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-slate-950 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-slate-500 text-sm min-h-[44px]"
              >
                <option value="">Choose active supervisor...</option>
                {activeSupervisors.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.factories?.name || 'Unassigned'})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="amount" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                Amount (INR)
              </label>
              <div className="relative mt-1 rounded-md shadow-sm">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <span className="text-slate-500 sm:text-sm">₹</span>
                </div>
                <input
                  id="amount"
                  name="amount"
                  type="number"
                  required
                  min="1"
                  value={disburseAmount}
                  onChange={(e) => setDisburseAmount(e.target.value)}
                  disabled={formLoading}
                  placeholder="0"
                  className="block w-full rounded-md border border-slate-300 pl-7 pr-3 py-2 text-slate-950 focus:border-slate-500 focus:outline-none focus:ring-slate-500 text-sm min-h-[44px]"
                />
              </div>
            </div>

            <div>
              <label htmlFor="note" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                Note / Remarks <span className="text-red-500">*</span>
              </label>
              <textarea
                id="note"
                name="note"
                required
                rows={2}
                value={disburseNote}
                onChange={(e) => setDisburseNote(e.target.value)}
                disabled={formLoading}
                placeholder="e.g. Weekly advance allocation"
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-slate-950 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-slate-500 text-sm"
              />
            </div>

            {formError && (
              <div className="rounded-md bg-red-50 p-3 border border-red-200">
                <p className="text-xs font-semibold text-red-800">{formError}</p>
              </div>
            )}

            {formSuccess && (
              <div className="rounded-md bg-emerald-50 p-3 border border-emerald-200">
                <p className="text-xs font-semibold text-emerald-800">Disbursement initiated successfully. Awaiting supervisor confirmation.</p>
              </div>
            )}

            <button
              type="submit"
              disabled={formLoading || activeSupervisors.length === 0}
              className="w-full flex justify-center items-center rounded-md bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50 min-h-[44px] gap-2"
            >
              {formLoading ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span>Submitting...</span>
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  <span>Send Cash</span>
                </>
              )}
            </button>
            {activeSupervisors.length === 0 && (
              <p className="text-[11px] text-slate-500 text-center">
                Please configure active supervisors first.
              </p>
            )}
          </form>
        </div>

        {/* Right Column: Factory Cash Positions table */}
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden lg:col-span-2">
          <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-slate-600" />
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900">Factory Cash Positions</h2>
            </div>
          </div>

          {factoryCashPositions.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              No factories configured. Create a factory under the Supervisors tab to see cash positions.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                <thead className="bg-slate-50 text-slate-700 font-medium text-xs uppercase tracking-wider">
                  <tr>
                    <th className="px-6 py-3">Factory</th>
                    <th className="px-6 py-3 text-right">Sent (Total)</th>
                    <th className="px-6 py-3 text-right">Confirmed Rec</th>
                    <th className="px-6 py-3 text-right">Transfers (Net)</th>
                    <th className="px-6 py-3 text-right">Disbursed (Workers)</th>
                    <th className="px-6 py-3 text-right">Expenses</th>
                    <th className="px-6 py-3 text-right">Cash On Hand</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white text-slate-900 font-semibold">
                  {factoryCashPositions.map((pos) => (
                    <tr key={pos.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4">
                        <div>
                          <div className="font-bold text-slate-900">{pos.name}</div>
                          <div className="text-xs text-slate-500 font-normal">{pos.location}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right text-slate-500">{formatINR(pos.sent)}</td>
                      <td className="px-6 py-4 text-right text-slate-800">{formatINR(pos.confirmed)}</td>
                      <td className={`px-6 py-4 text-right ${pos.transfers > 0 ? 'text-emerald-600' : pos.transfers < 0 ? 'text-amber-600' : 'text-slate-500'}`}>
                        {pos.transfers > 0 ? `+${formatINR(pos.transfers)}` : formatINR(pos.transfers)}
                      </td>
                      <td className="px-6 py-4 text-right text-slate-600">{formatINR(pos.disbursed)}</td>
                      <td className="px-6 py-4 text-right text-red-600">{formatINR(pos.expenses)}</td>
                      <td className="px-6 py-4 text-right font-bold text-emerald-600">{formatINR(pos.remaining)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Leaderboard Lists */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Supervisor Cash Handled Leaderboard */}
        <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3 mb-4">
            <TrendingUp className="h-5 w-5 text-slate-600" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900">Supervisors by Cash Handled</h2>
          </div>
          {supervisorLeaderboard.length === 0 ? (
            <div className="text-center py-6 text-sm text-slate-500">No data available</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {supervisorLeaderboard.slice(0, 5).map((sup, idx) => (
                <li key={sup.id} className="py-2.5 flex justify-between items-center text-sm">
                  <div className="flex items-center gap-3">
                    <span className="text-slate-400 font-bold w-4">#{idx + 1}</span>
                    <div>
                      <div className="font-semibold text-slate-900">{sup.name}</div>
                      <div className="text-xs text-slate-500">{sup.factory}</div>
                    </div>
                  </div>
                  <span className="font-bold text-slate-800">{formatINR(sup.totalHandled)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Worker Advances Leaderboard */}
        <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-slate-600" />
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900">Workers Outstanding Advance</h2>
            </div>
            <a href="#worker-advances-section" className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold">
              Filter by Date &darr;
            </a>
          </div>
          {activeWorkers.length === 0 ? (
            <div className="text-center py-6 text-sm text-slate-500">No workers configured yet</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {activeWorkers.slice(0, 5).map((w, idx) => (
                <li key={w.worker_id} className="py-2.5 flex justify-between items-center text-sm">
                  <div className="flex items-center gap-3">
                    <span className="text-slate-400 font-bold w-4">#{idx + 1}</span>
                    <span className="font-semibold text-slate-900">{w.worker_name}</span>
                  </div>
                  <span className="font-bold text-red-600">{formatINR(w.running_advance)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Worker Advances Statement & Date Range Filter */}
      <div id="worker-advances-section" className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden space-y-0">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-lg bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-700 shrink-0">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
                <span>Worker Advances Statement</span>
                {(workerFromDate || workerToDate) && (
                  <span className="text-[10px] bg-indigo-100 text-indigo-800 font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                    Date Filter Active
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-500">
                Audit cash advances disbursed to every worker across any timeframe
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
            <Link
              href={workerFactoryId !== 'all' ? `/admin/opening-advances?factory=${workerFactoryId}` : '/admin/opening-advances'}
              className="inline-flex items-center gap-1.5 rounded-md border border-emerald-600 bg-emerald-600 px-3 py-2 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 transition-colors min-h-[38px]"
            >
              <Coins className="h-4 w-4" />
              <span>Edit Opening Advances</span>
            </Link>
            <button
              onClick={exportWorkerAdvancesToCSV}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors min-h-[38px]"
            >
              <Download className="h-4 w-4 text-slate-500" />
              <span>Export Statement to CSV</span>
            </button>
          </div>
        </div>

        {/* Filter Controls Bar */}
        <div className="p-5 border-b border-slate-100 bg-white space-y-4">
          {/* Date Range Inputs and Quick Presets */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <Calendar className="h-4 w-4 text-slate-400" />
                Timeframe:
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={workerFromDate}
                  onChange={(e) => setWorkerFromDate(e.target.value)}
                  className="rounded border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900 bg-white min-h-[38px] focus:ring-slate-500 focus:border-slate-500 shadow-sm"
                  title="From Date"
                />
                <span className="text-xs text-slate-400 font-medium">to</span>
                <input
                  type="date"
                  value={workerToDate}
                  onChange={(e) => setWorkerToDate(e.target.value)}
                  className="rounded border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900 bg-white min-h-[38px] focus:ring-slate-500 focus:border-slate-500 shadow-sm"
                  title="To Date"
                />
              </div>
            </div>

            {/* Quick Presets Pills */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => setWorkerDatePreset('all')}
                className={`px-3 py-1.5 rounded text-xs font-semibold border transition-colors ${
                  !workerFromDate && !workerToDate
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                All Time
              </button>
              <button
                type="button"
                onClick={() => setWorkerDatePreset('today')}
                className="px-3 py-1.5 rounded text-xs font-semibold bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 transition-colors"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => setWorkerDatePreset('this_week')}
                className="px-3 py-1.5 rounded text-xs font-semibold bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 transition-colors"
              >
                This Week
              </button>
              <button
                type="button"
                onClick={() => setWorkerDatePreset('this_month')}
                className="px-3 py-1.5 rounded text-xs font-semibold bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 transition-colors"
              >
                This Month
              </button>
              <button
                type="button"
                onClick={() => setWorkerDatePreset('last_month')}
                className="px-3 py-1.5 rounded text-xs font-semibold bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 transition-colors"
              >
                Last Month
              </button>
            </div>
          </div>

          {/* Secondary Filters: Factory, Supervisor, Search Worker */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 pt-1">
            {/* Factory Filter */}
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Filter by Factory
              </label>
              <select
                value={workerFactoryId}
                onChange={(e) => setWorkerFactoryId(e.target.value)}
                className="block w-full rounded border border-slate-300 text-xs py-2 px-2.5 focus:border-slate-500 focus:outline-none focus:ring-slate-500 min-h-[38px] text-slate-900 bg-white"
              >
                <option value="all">All Factories</option>
                {factories.map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>

            {/* Supervisor Filter */}
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Filter by Supervisor
              </label>
              <select
                value={workerSupervisorId}
                onChange={(e) => setWorkerSupervisorId(e.target.value)}
                className="block w-full rounded border border-slate-300 text-xs py-2 px-2.5 focus:border-slate-500 focus:outline-none focus:ring-slate-500 min-h-[38px] text-slate-900 bg-white"
              >
                <option value="all">All Supervisors</option>
                {supervisors.map(s => (
                  <option key={s.id} value={s.id}>{s.name} ({s.factories?.name || 'Unassigned'})</option>
                ))}
              </select>
            </div>

            {/* Worker Name Search */}
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Search Worker
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  value={workerSearchQuery}
                  onChange={(e) => setWorkerSearchQuery(e.target.value)}
                  placeholder="Worker name or phone..."
                  className="block w-full rounded border border-slate-300 pl-9 pr-3 py-2 text-xs focus:border-slate-500 focus:outline-none focus:ring-slate-500 min-h-[38px] text-slate-900 bg-white"
                />
              </div>
            </div>
          </div>

          {/* Metric Summary Banner */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            <div className="bg-slate-50 border border-slate-200/80 rounded-lg p-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                {workerFromDate || workerToDate ? 'Period Advances Total' : 'All-Time Total Disbursed'}
              </span>
              <span className="text-lg font-black text-slate-900">
                {formatINR(totalWorkerPeriodAdvance)}
              </span>
              <span className="text-[10px] text-slate-400 block mt-0.5">
                Across {workersWithPeriodAdvance} workers with advances
              </span>
            </div>

            <div className="bg-slate-50 border border-slate-200/80 rounded-lg p-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                Advances in Period
              </span>
              <span className="text-lg font-black text-indigo-700">
                {totalWorkerPeriodTxCount}
              </span>
              <span className="text-[10px] text-slate-400 block mt-0.5">
                Disbursements recorded in timeframe
              </span>
            </div>

            <div className="bg-slate-50 border border-slate-200/80 rounded-lg p-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                Total Outstanding Balance
              </span>
              <span className="text-lg font-black text-red-600">
                {formatINR(filteredWorkerReports.reduce((sum, item) => sum + Number(item.worker.running_advance), 0))}
              </span>
              <span className="text-[10px] text-slate-400 block mt-0.5">
                Cumulative across {filteredWorkerReports.length} listed workers
              </span>
            </div>
          </div>
        </div>

        {/* Worker Table */}
        {filteredWorkerReports.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No workers match the selected timeframe and filter criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50 text-slate-700 font-semibold text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-5 py-3">Worker</th>
                  <th className="px-5 py-3">Factory / Supervisor</th>
                  <th className="px-5 py-3 text-right">
                    {workerFromDate || workerToDate ? 'Advance in Period' : 'Advance Disbursed'}
                  </th>
                  <th className="px-5 py-3 text-center">Advances Count</th>
                  <th className="px-5 py-3 text-right">All-Time Outstanding</th>
                  <th className="px-5 py-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredWorkerReports.map((item) => {
                  const isExpanded = expandedWorkerId === item.worker.worker_id;

                  return (
                    <React.Fragment key={item.worker.worker_id}>
                      <tr className={`hover:bg-slate-50/80 transition-colors ${item.periodAdvance > 0 && (workerFromDate || workerToDate) ? 'bg-indigo-50/20' : ''}`}>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <div className="h-9 w-9 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
                              {item.worker.worker_photo_url ? (
                                <img src={item.worker.worker_photo_url} alt={item.worker.worker_name} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                              ) : (
                                <User className="h-4 w-4 text-slate-400" />
                              )}
                            </div>
                            <div>
                              <div className="font-bold text-slate-900">{item.worker.worker_name}</div>
                              <div className="text-xs text-slate-500">{item.worker.worker_phone || 'No phone'}</div>
                            </div>
                          </div>
                        </td>

                        <td className="px-5 py-3.5">
                          <div>
                            <div className="font-semibold text-slate-800 text-xs">{item.factoryName}</div>
                            <div className="text-[11px] text-slate-500">{item.supervisorName}</div>
                          </div>
                        </td>

                        <td className="px-5 py-3.5 text-right font-bold">
                          {item.periodAdvance > 0 ? (
                            <span className="text-red-600 bg-red-50 border border-red-200/60 px-2 py-0.5 rounded text-xs font-black">
                              {formatINR(item.periodAdvance)}
                            </span>
                          ) : (
                            <span className="text-slate-400 text-xs font-normal">₹0</span>
                          )}
                        </td>

                        <td className="px-5 py-3.5 text-center">
                          {item.periodCount > 0 ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                              {item.periodCount} payment{item.periodCount > 1 ? 's' : ''}
                            </span>
                          ) : (
                            <span className="text-slate-400 text-xs">-</span>
                          )}
                        </td>

                        <td className="px-5 py-3.5 text-right font-black text-slate-900 text-xs">
                          {formatINR(item.worker.running_advance)}
                        </td>

                        <td className="px-5 py-3.5 text-center">
                          <button
                            type="button"
                            onClick={() => setExpandedWorkerId(isExpanded ? null : item.worker.worker_id)}
                            className="inline-flex items-center gap-1 rounded border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
                          >
                            <span>{isExpanded ? 'Hide' : 'Details'}</span>
                            {isExpanded ? (
                              <ChevronUp className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronDown className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </td>
                      </tr>

                      {/* Expanded Itemized Disbursement List */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={6} className="bg-slate-50/70 p-4 border-t border-b border-slate-200">
                            <div className="space-y-3">
                              <div className="flex justify-between items-center">
                                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                                  <Clock className="h-3.5 w-3.5 text-slate-500" />
                                  <span>
                                    Disbursements to {item.worker.worker_name}
                                    {(workerFromDate || workerToDate) ? ` (${workerFromDate || 'Start'} to ${workerToDate || 'Today'})` : ' (All-Time)'}
                                  </span>
                                </h4>
                                <span className="text-xs font-bold text-slate-600">
                                  Total in period: <strong className="text-red-600">{formatINR(item.periodAdvance)}</strong> ({item.periodDisbursements.length} payments)
                                </span>
                              </div>

                              {item.periodDisbursements.length === 0 ? (
                                <p className="text-xs text-slate-500 py-3 text-center bg-white rounded border border-slate-200">
                                  No disbursements recorded for this worker within the selected timeframe.
                                </p>
                              ) : (
                                <div className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white overflow-hidden shadow-sm">
                                  {item.periodDisbursements.map((tx) => (
                                    <div key={tx.id} className="p-3 text-xs flex justify-between items-center hover:bg-slate-50">
                                      <div>
                                        <div className="font-extrabold text-slate-900 text-sm">
                                          {formatINR(tx.amount)}
                                        </div>
                                        <div className="text-[10px] text-slate-500 mt-0.5">
                                          {new Date(tx.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                                        </div>
                                        {tx.note && (() => {
                                          const parsed = parseHandoverNote(tx.note);
                                          return (
                                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                              {parsed.note && (
                                                <div className="text-[11px] text-slate-600 italic bg-slate-50 border border-slate-100 rounded px-1.5 py-0.5 w-fit">
                                                  "{parsed.note}"
                                                </div>
                                              )}
                                              {parsed.photoUrl && (
                                                <button
                                                  type="button"
                                                  onClick={() => setAdminViewingPhotoUrl(parsed.photoUrl)}
                                                  className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-1.5 py-0.5 rounded cursor-pointer transition-colors"
                                                  title="View Cash Handover Proof"
                                                >
                                                  <Camera className="h-3 w-3" />
                                                  <span>Handover Photo</span>
                                                </button>
                                              )}
                                            </div>
                                          );
                                        })()}
                                      </div>
                                      <div className="text-right">
                                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                          {tx.status.toUpperCase()}
                                        </span>
                                        <span className="text-[10px] text-slate-500 block mt-1">
                                          Disbursed by {tx.from?.name || 'Supervisor'}
                                        </span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Transaction Feed Section with Filters */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
        {/* Header and filters */}
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 space-y-4">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-slate-600" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900">Ledger Transactions Log</h2>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {/* Factory Filter */}
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Factory</label>
              <select
                value={selectedFactoryId}
                onChange={(e) => setSelectedFactoryId(e.target.value)}
                className="mt-1 block w-full rounded border-slate-300 text-xs py-1.5 focus:border-slate-500 focus:outline-none focus:ring-slate-500 min-h-[38px] text-slate-900 bg-white"
              >
                <option value="all">All Factories</option>
                {factories.map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>

            {/* Supervisor Filter */}
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Supervisor</label>
              <select
                value={selectedSupervisorId}
                onChange={(e) => setSelectedSupervisorId(e.target.value)}
                className="mt-1 block w-full rounded border-slate-300 text-xs py-1.5 focus:border-slate-500 focus:outline-none focus:ring-slate-500 min-h-[38px] text-slate-900 bg-white"
              >
                <option value="all">All Supervisors</option>
                {supervisors.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            {/* Status Filter */}
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Status</label>
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="mt-1 block w-full rounded border-slate-300 text-xs py-1.5 focus:border-slate-500 focus:outline-none focus:ring-slate-500 min-h-[38px] text-slate-900 bg-white"
              >
                <option value="all">All Statuses</option>
                <option value="pending">Pending</option>
                <option value="confirmed">Confirmed</option>
                <option value="disputed">Disputed</option>
              </select>
            </div>

            {/* Purpose Filter */}
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Purpose</label>
              <select
                value={selectedPurpose}
                onChange={(e) => setSelectedPurpose(e.target.value)}
                className="mt-1 block w-full rounded border-slate-300 text-xs py-1.5 focus:border-slate-500 focus:outline-none focus:ring-slate-500 min-h-[38px] text-slate-900 bg-white"
              >
                <option value="all">All Purposes</option>
                <option value="wages">Wages</option>
                <option value="expenses">Expenses</option>
                <option value="transfers">Transfers</option>
              </select>
            </div>

            {/* From Date Filter */}
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">From Date</label>
              <input
                type="date"
                value={ledgerFromDate}
                onChange={(e) => setLedgerFromDate(e.target.value)}
                className="mt-1 block w-full rounded border-slate-300 text-xs py-1.5 focus:border-slate-500 focus:outline-none focus:ring-slate-500 min-h-[38px] text-slate-900 bg-white"
              />
            </div>

            {/* To Date Filter */}
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">To Date</label>
              <input
                type="date"
                value={ledgerToDate}
                onChange={(e) => setLedgerToDate(e.target.value)}
                className="mt-1 block w-full rounded border-slate-300 text-xs py-1.5 focus:border-slate-500 focus:outline-none focus:ring-slate-500 min-h-[38px] text-slate-900 bg-white"
              />
            </div>
          </div>
        </div>

        {/* Transactions Feed list */}
        {filteredLedger.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No transactions found matching the filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50 text-slate-700 font-medium text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-3">Timestamp</th>
                  <th className="px-6 py-3">Purpose</th>
                  <th className="px-6 py-3">Type/Category</th>
                  <th className="px-6 py-3">From</th>
                  <th className="px-6 py-3">To/Vendor</th>
                  <th className="px-6 py-3 text-right">Amount</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white text-slate-900">
                {filteredLedger.map((entry) => {
                  return (
                    <tr key={entry.id} className={`hover:bg-slate-50 ${entry.isFlagged ? 'bg-red-50/30' : ''}`}>
                      <td className="px-6 py-4 whitespace-nowrap text-slate-500 text-xs">
                        {new Date(entry.created_at).toLocaleString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-bold border ${
                          entry.purpose === 'Wages' 
                            ? 'bg-blue-50 text-blue-700 border-blue-100' 
                            : entry.purpose === 'Expenses' 
                            ? 'bg-red-50 text-red-700 border-red-100' 
                            : 'bg-purple-50 text-purple-700 border-purple-100'
                        }`}>
                          {entry.purpose}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-600">
                        {entry.type.replace(/_/g, ' ')}
                      </td>
                      <td className="px-6 py-4 text-slate-700">
                        {entry.fromLabel}
                      </td>
                      <td className="px-6 py-4 font-semibold">
                        {entry.toLabel}
                      </td>
                      <td className="px-6 py-4 text-right font-bold text-slate-800">
                        {formatINR(entry.amount)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex flex-col gap-1">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold ${
                              entry.status === 'confirmed'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                                : entry.status === 'disputed'
                                ? 'bg-red-50 text-red-700 border border-red-100'
                                : 'bg-amber-50 text-amber-700 border border-amber-100'
                            }`}
                          >
                            {entry.status.toUpperCase()}
                          </span>
                          
                          {entry.isFlagged && (
                            <span className="flex items-center gap-1 text-[10px] font-bold text-red-600 uppercase">
                              <AlertTriangle className="h-3 w-3" />
                              <span>Over 24h old</span>
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-slate-500 text-xs">
                        {(() => {
                          const parsed = parseHandoverNote(entry.note);
                          return (
                            <div className="flex items-center gap-2 flex-wrap">
                              {parsed.note && <span className="italic">{parsed.note}</span>}
                              {parsed.photoUrl && (
                                <button
                                  type="button"
                                  onClick={() => setAdminViewingPhotoUrl(parsed.photoUrl)}
                                  className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded cursor-pointer transition-colors shadow-xs"
                                  title="View Cash Handover Proof"
                                >
                                  <Camera className="h-3 w-3" />
                                  <span>Handover Photo</span>
                                </button>
                              )}
                              {!parsed.note && !parsed.photoUrl && <span className="text-slate-400">-</span>}
                            </div>
                          );
                        })()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Full-Screen Handover Photo Viewer Modal */}
      {adminViewingPhotoUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full overflow-hidden flex flex-col shadow-2xl">
            <div className="p-3 flex items-center justify-between border-b border-slate-800 text-white">
              <span className="text-xs font-bold uppercase tracking-wider">Proof of Cash Handover</span>
              <button
                type="button"
                onClick={() => setAdminViewingPhotoUrl(null)}
                className="text-slate-400 hover:text-white p-1 rounded-full hover:bg-slate-800 min-h-[36px] min-w-[36px] flex items-center justify-center"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="aspect-square w-full bg-black flex items-center justify-center overflow-hidden">
              <img
                src={adminViewingPhotoUrl}
                alt="Cash Handover Proof"
                className="w-full h-full object-contain"
              />
            </div>
            <div className="p-3 bg-slate-900 border-t border-slate-800 text-center">
              <button
                type="button"
                onClick={() => setAdminViewingPhotoUrl(null)}
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
