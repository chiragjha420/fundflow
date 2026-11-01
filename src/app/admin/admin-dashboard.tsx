'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { createOfficeDisbursement, refundWorkerAdvanceAction, adminUpdateWorkerPhoneAction } from '@/app/actions/admin';
import { AdminAIChat } from './admin-ai-chat';
import { NotificationBanner } from '@/components/notification-banner';
import { getCashRequests, updateCashRequestStatus, CashRequest } from '@/app/actions/cash-requests';
import { playAlertSound, sendFundFlowNotification } from '@/lib/notifications';
import { registerDeviceForWebPush } from '@/lib/push-client';
import { createBrowserClient } from '@/lib/supabase/browser-client';
import { HandCoins, Coins, Edit2, Phone } from 'lucide-react';
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
  X,
  RotateCcw,
  Zap,
  CheckCircle2,
  Users,
  ArrowRightLeft,
  Wrench,
  Bell,
  Banknote
} from 'lucide-react';
import { 
  FactoryWorkerBalance, 
  WorkerSalaryLedgerEntry, 
  creditWorkerSalaryAction, 
  recoverWorkerAdvanceAction, 
  batchCreditMonthlySalariesAction, 
  batchReclassifyKharchaAction, 
  getWorkerFullLedgerAction, 
  FullWorkerLedgerEntry,
  addWorkerSalaryWithDeductionAction,
  getAdvanceCorrectionRequestsAction,
  reviewAdvanceCorrectionAction,
  AdvanceCorrectionRequest,
  getAllWorkersWithSalaryBalancesAction
} from '@/app/actions/workers';

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

interface AdminDashboardProps {
  factories: Factory[];
  supervisors: Supervisor[];
  transactions: Transaction[];
  expenses: Expense[];
  workers: FactoryWorkerBalance[];
  refundedTransactions?: Record<string, { refundedAt: string; reason: string; amount: number; workerName: string }>;
  salaryLedgerEntries?: WorkerSalaryLedgerEntry[];
}

export function AdminDashboard({
  factories,
  supervisors,
  transactions,
  expenses,
  workers,
  refundedTransactions = {},
  salaryLedgerEntries = [],
}: AdminDashboardProps) {
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState(false);

  // Refund Advance States
  const [localRefundedMap, setLocalRefundedMap] = useState<Record<string, { refundedAt: string; reason: string; amount: number; workerName: string }>>(refundedTransactions || {});
  const [refundTargetTx, setRefundTargetTx] = useState<{ id: string; amount: number; workerName: string; supervisorName: string } | null>(null);
  const [refundReason, setRefundReason] = useState<string>('');
  const [refundLoading, setRefundLoading] = useState<boolean>(false);
  const [refundSuccessMessage, setRefundSuccessMessage] = useState<string | null>(null);

  // Cash Replenishment Requests from Supervisors
  const [cashRequests, setCashRequests] = useState<CashRequest[]>([]);
  const [disburseSupervisorId, setDisburseSupervisorId] = useState<string>('');
  const [disburseAmount, setDisburseAmount] = useState<string>('');
  const [disburseNote, setDisburseNote] = useState<string>('');
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [adminViewingPhotoUrl, setAdminViewingPhotoUrl] = useState<string | null>(null);

  const supabase = createBrowserClient();
  const knownRequestIds = React.useRef<Set<string> | null>(null);
  const [inAppAlert, setInAppAlert] = useState<{ title: string; body: string } | null>(null);

  // Advance Correction Requests from Supervisors
  const [advanceCorrectionRequests, setAdvanceCorrectionRequests] = useState<AdvanceCorrectionRequest[]>([]);
  const [reviewCorrectionLoadingId, setReviewCorrectionLoadingId] = useState<string | null>(null);

  const fetchCorrectionRequests = async () => {
    try {
      const reqs = await getAdvanceCorrectionRequestsAction();
      setAdvanceCorrectionRequests(reqs);
    } catch (e) {
      console.warn('Failed to fetch correction requests:', e);
    }
  };

  useEffect(() => {
    fetchCorrectionRequests();
    const interval = setInterval(fetchCorrectionRequests, 6000);
    return () => clearInterval(interval);
  }, []);

  const handleReviewCorrection = async (requestId: string, action: 'APPROVED' | 'REJECTED') => {
    setReviewCorrectionLoadingId(requestId);
    try {
      const res = await reviewAdvanceCorrectionAction({
        requestId,
        decision: action === 'APPROVED' ? 'approve' : 'reject',
      });
      if (!res.success) {
        alert(res.error || `Failed to ${action.toLowerCase()} request.`);
        return;
      }
      playAlertSound('success');
      await fetchCorrectionRequests();
      if (action === 'APPROVED') {
        const updatedWorkers = await getAllWorkersWithSalaryBalancesAction();
        if (updatedWorkers) {
          setLocalWorkers(updatedWorkers);
        }
      }
    } catch (err: any) {
      alert(err.message || 'Error processing request.');
    } finally {
      setReviewCorrectionLoadingId(null);
    }
  };

  const executeRefund = async () => {
    if (!refundTargetTx) return;
    setRefundLoading(true);
    try {
      const res = await refundWorkerAdvanceAction(refundTargetTx.id, refundReason);
      if (!res.success) {
        alert(res.error || 'Failed to refund advance.');
        return;
      }

      setLocalRefundedMap(prev => ({
        ...prev,
        [refundTargetTx.id]: {
          refundedAt: new Date().toISOString(),
          reason: refundReason || 'Refunded by Admin',
          amount: refundTargetTx.amount,
          workerName: refundTargetTx.workerName,
        }
      }));

      playAlertSound('cash_in');
      setRefundSuccessMessage(res.message || 'Advance successfully refunded!');
      setRefundTargetTx(null);
      setRefundReason('');

      setTimeout(() => setRefundSuccessMessage(null), 4000);
    } catch (e: any) {
      alert(e.message || 'Error executing refund.');
    } finally {
      setRefundLoading(false);
    }
  };

  // Admin Edit Worker Phone States
  const [editingWorkerPhone, setEditingWorkerPhone] = useState<{
    workerId: string;
    workerName: string;
    currentPhone: string;
  } | null>(null);
  const [phoneEditInput, setPhoneEditInput] = useState<string>('');
  const [phoneEditLoading, setPhoneEditLoading] = useState<boolean>(false);
  const [phoneEditError, setPhoneEditError] = useState<string>('');
  const [phoneEditSuccess, setPhoneEditSuccess] = useState<string | null>(null);
  const [localWorkerPhoneOverrides, setLocalWorkerPhoneOverrides] = useState<Record<string, string | null>>({});

  const handleAdminSaveWorkerPhone = async () => {
    if (!editingWorkerPhone) return;
    setPhoneEditLoading(true);
    setPhoneEditError('');
    try {
      const res = await adminUpdateWorkerPhoneAction(
        editingWorkerPhone.workerId,
        phoneEditInput.trim() || null
      );
      if (!res.success) {
        setPhoneEditError(res.error || 'Failed to update phone number.');
        return;
      }
      setLocalWorkerPhoneOverrides(prev => ({
        ...prev,
        [editingWorkerPhone.workerId]: res.formattedPhone || null,
      }));
      setPhoneEditSuccess(`Phone updated for ${editingWorkerPhone.workerName}`);
      setTimeout(() => setPhoneEditSuccess(null), 3500);
      setEditingWorkerPhone(null);
    } catch (err: any) {
      setPhoneEditError(err.message || 'Failed to update phone number.');
    } finally {
      setPhoneEditLoading(false);
    }
  };

  // Load cash requests on mount, active 3s watcher & subscribe to real-time broadcast alerts
  useEffect(() => {
    // Register device for Real OS Web Push (works even when tab/browser is closed)
    registerDeviceForWebPush('admin').catch(() => {});

    // Helper to process alerts
    const handleNewRequestAlert = (req: CashRequest) => {
      playAlertSound('alert');
      if ('vibrate' in navigator) {
        try { navigator.vibrate([200, 100, 200]); } catch {}
      }
      sendFundFlowNotification(`New Cash Request: ${formatINR(req.amount)}`, {
        body: `${req.supervisor_name} (${req.factory_name}) requested ${formatINR(req.amount)}: "${req.note}"`,
        soundType: 'alert',
        url: '/admin#cash-requests-section',
      });
      setInAppAlert({
        title: `New Cash Request: ${formatINR(req.amount)}`,
        body: `${req.supervisor_name} (${req.factory_name}) requested cash: "${req.note}"`,
      });
      setTimeout(() => setInAppAlert(null), 8000);
    };

    // 1. Initial fetch
    getCashRequests().then((reqs) => {
      setCashRequests(reqs);
      if (knownRequestIds.current === null) {
        knownRequestIds.current = new Set(reqs.map((r) => r.id));
      }
    });

    // 2. High-reliability 3-second state watcher
    const interval = setInterval(async () => {
      try {
        const reqs = await getCashRequests();
        setCashRequests(reqs);
        if (knownRequestIds.current !== null) {
          const newPending = reqs.filter(
            (r) => r.status === 'pending' && !knownRequestIds.current!.has(r.id)
          );
          if (newPending.length > 0) {
            for (const r of newPending) {
              knownRequestIds.current.add(r.id);
              handleNewRequestAlert(r);
            }
          }
        }
      } catch {}
    }, 3000);

    // 3. Real-time Supabase Broadcast Channel Listener
    const channel = supabase.channel('fundflow-notifications');
    channel
      .on('broadcast', { event: 'fundflow_alert' }, (msg: any) => {
        const payload = msg?.payload;
        if (!payload) return;

        // A. Supervisor submitted a Cash Request
        if (payload.type === 'cash_request') {
          if (payload.id && knownRequestIds.current?.has(payload.id)) {
            return; // Already processed
          }
          if (payload.id && knownRequestIds.current) {
            knownRequestIds.current.add(payload.id);
          }
          playAlertSound('alert');
          if ('vibrate' in navigator) {
            try { navigator.vibrate([200, 100, 200]); } catch {}
          }
          sendFundFlowNotification(`New Cash Request: ${formatINR(payload.amount)}`, {
            body: `${payload.supervisor_name} (${payload.factory_name}) requested ${formatINR(payload.amount)}: "${payload.note}"`,
            soundType: 'alert',
            url: '/admin#cash-requests-section',
          });
          setInAppAlert({
            title: `New Cash Request: ${formatINR(payload.amount)}`,
            body: `${payload.supervisor_name} (${payload.factory_name}) requested cash: "${payload.note}"`,
          });
          setTimeout(() => setInAppAlert(null), 8000);
          getCashRequests().then(setCashRequests);
        }

        // B. Supervisor confirmed an office disbursement
        if (payload.type === 'receipt_confirmed' && payload.from_type === 'office') {
          playAlertSound('success');
          sendFundFlowNotification('Cash Receipt Confirmed', {
            body: `${payload.to_supervisor_name} confirmed receipt of ${formatINR(payload.amount)}.`,
            soundType: 'success',
            url: '/admin',
          });
        }

        // C. Supervisor disputed a transaction
        if (payload.type === 'receipt_disputed') {
          playAlertSound('alert');
          sendFundFlowNotification('Transaction Disputed', {
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
  const [isWorkerAdvancesCollapsed, setIsWorkerAdvancesCollapsed] = useState<boolean>(true);

  // Local Workers state for instantaneous optimistic updates
  const [localWorkers, setLocalWorkers] = useState<FactoryWorkerBalance[]>(workers);
  useEffect(() => {
    setLocalWorkers(workers);
  }, [workers]);

  // Modals for Worker Accounts & Payroll
  const [showCreditSalaryModal, setShowCreditSalaryModal] = useState(false);
  const [creditSalaryWorker, setCreditSalaryWorker] = useState<FactoryWorkerBalance | null>(null);
  const [creditSalaryWorkerId, setCreditSalaryWorkerId] = useState<string>('');
  const [creditSalaryAmount, setCreditSalaryAmount] = useState('');
  const [creditSalaryDeduction, setCreditSalaryDeduction] = useState('0');
  const [creditSalaryMonth, setCreditSalaryMonth] = useState('');
  const [creditSalaryNote, setCreditSalaryNote] = useState('');
  const [creditSalaryLoading, setCreditSalaryLoading] = useState(false);
  const [creditSalaryError, setCreditSalaryError] = useState('');

  // Batch Monthly Salary Accrual Modal
  const [showBatchSalaryModal, setShowBatchSalaryModal] = useState(false);
  const [batchSalaryFactoryId, setBatchSalaryFactoryId] = useState('all');
  const [batchSalaryMonth, setBatchSalaryMonth] = useState('');
  const [batchSalaryNote, setBatchSalaryNote] = useState('');
  const [batchSalaryLoading, setBatchSalaryLoading] = useState(false);
  const [batchSalaryError, setBatchSalaryError] = useState('');
  const [batchSalarySuccess, setBatchSalarySuccess] = useState('');

  // Settle Advance from Salary Modal
  const [showSettleAdvanceModal, setShowSettleAdvanceModal] = useState(false);
  const [settleAdvanceWorker, setSettleAdvanceWorker] = useState<FactoryWorkerBalance | null>(null);
  const [settleAdvanceAmount, setSettleAdvanceAmount] = useState('');
  const [settleAdvanceNote, setSettleAdvanceNote] = useState('');
  const [settleAdvanceLoading, setSettleAdvanceLoading] = useState(false);
  const [settleAdvanceError, setSettleAdvanceError] = useState('');

  // Reclassify Kharcha Modal
  const [showReclassifyModal, setShowReclassifyModal] = useState(false);
  const [reclassifyLoading, setReclassifyLoading] = useState(false);
  const [reclassifySuccess, setReclassifySuccess] = useState<{ count: number; totalAmount: number } | null>(null);

  // Worker Full Ledger Drawer
  const [expandedLedgerWorkerId, setExpandedLedgerWorkerId] = useState<string | null>(null);
  const [workerFullLedgerData, setWorkerFullLedgerData] = useState<Record<string, FullWorkerLedgerEntry[]>>({});
  const [loadingLedgerWorkerId, setLoadingLedgerWorkerId] = useState<string | null>(null);

  const toggleWorkerFullLedger = async (workerId: string) => {
    if (expandedLedgerWorkerId === workerId) {
      setExpandedLedgerWorkerId(null);
      return;
    }
    setExpandedLedgerWorkerId(workerId);
    if (!workerFullLedgerData[workerId]) {
      setLoadingLedgerWorkerId(workerId);
      try {
        const res = await getWorkerFullLedgerAction(workerId);
        setWorkerFullLedgerData(prev => ({ ...prev, [workerId]: res.ledgerEntries || [] }));
      } catch (err) {
        console.error('Error fetching worker ledger:', err);
      } finally {
        setLoadingLedgerWorkerId(null);
      }
    }
  };

  const handleExecuteCreditSalary = async () => {
    const targetWorker = creditSalaryWorker || localWorkers.find(w => w.worker_id === creditSalaryWorkerId);
    if (!targetWorker) {
      setCreditSalaryError('Please select a worker.');
      return;
    }
    const amt = parseFloat(creditSalaryAmount);
    const deductAmt = Math.max(0, parseFloat(creditSalaryDeduction || '0'));
    if (!amt || amt <= 0) {
      setCreditSalaryError('Please enter a valid salary amount.');
      return;
    }
    if (deductAmt > targetWorker.running_advance) {
      setCreditSalaryError(`Deduction cannot exceed worker advance of ${formatINR(targetWorker.running_advance)}.`);
      return;
    }
    if (deductAmt > amt) {
      setCreditSalaryError(`Deduction cannot exceed salary amount of ${formatINR(amt)}.`);
      return;
    }
    setCreditSalaryLoading(true);
    setCreditSalaryError('');
    try {
      const res = await addWorkerSalaryWithDeductionAction({
        workerId: targetWorker.worker_id,
        salaryAmount: amt,
        advanceDeductAmount: deductAmt,
        periodMonth: creditSalaryMonth || undefined,
        note: creditSalaryNote || undefined,
      });
      if (!res.success) {
        setCreditSalaryError(res.error || 'Failed to credit salary.');
        return;
      }
      setLocalWorkers(prev => prev.map(w => {
        if (w.worker_id === targetWorker.worker_id) {
          const newEarned = (w.total_salary_earned || 0) + amt;
          const newAdvRecovered = (w.total_advance_recovered || 0) + deductAmt;
          const newAdv = Math.max(0, (w.running_advance || 0) - deductAmt);
          const newUnpaid = Math.max(0, (w.unpaid_salary || 0) + amt - deductAmt);
          return {
            ...w,
            total_salary_earned: newEarned,
            total_advance_recovered: newAdvRecovered,
            running_advance: newAdv,
            unpaid_salary: newUnpaid,
            net_payable: newUnpaid - newAdv,
          };
        }
        return w;
      }));
      setWorkerFullLedgerData(prev => {
        const copy = { ...prev };
        delete copy[targetWorker.worker_id];
        return copy;
      });
      setShowCreditSalaryModal(false);
      setCreditSalaryWorker(null);
      setCreditSalaryWorkerId('');
      setCreditSalaryAmount('');
      setCreditSalaryDeduction('0');
      setCreditSalaryMonth('');
      setCreditSalaryNote('');
      alert(`₹${amt.toLocaleString('en-IN')} earned salary credited successfully to ${targetWorker.worker_name}.${deductAmt > 0 ? ` ₹${deductAmt.toLocaleString('en-IN')} deducted from advance.` : ''}`);
    } catch (err: any) {
      setCreditSalaryError(err.message || 'Error executing salary credit.');
    } finally {
      setCreditSalaryLoading(false);
    }
  };

  const handleExecuteBatchSalary = async () => {
    setBatchSalaryLoading(true);
    setBatchSalaryError('');
    setBatchSalarySuccess('');
    try {
      const factoryId = batchSalaryFactoryId === 'all' ? undefined : batchSalaryFactoryId;
      const res = await batchCreditMonthlySalariesAction(
        factoryId,
        batchSalaryMonth || undefined,
        batchSalaryNote || undefined
      );
      if (!res.success) {
        setBatchSalaryError(res.error || 'Failed to execute batch monthly credit.');
        return;
      }
      setBatchSalarySuccess(`Successfully credited monthly salaries to ${res.creditedCount} workers (Total: ₹${(res.totalCredited || 0).toLocaleString('en-IN')})!`);
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (err: any) {
      setBatchSalaryError(err.message || 'Error processing batch credit.');
    } finally {
      setBatchSalaryLoading(false);
    }
  };

  const handleExecuteSettleAdvance = async () => {
    if (!settleAdvanceWorker) return;
    const amt = parseFloat(settleAdvanceAmount);
    if (!amt || amt <= 0) {
      setSettleAdvanceError('Please enter a valid adjustment amount.');
      return;
    }
    const maxAllowed = Math.min(settleAdvanceWorker.unpaid_salary || 0, settleAdvanceWorker.running_advance || 0);
    if (amt > maxAllowed) {
      setSettleAdvanceError(`Amount exceeds allowable deduction limit (₹${maxAllowed.toLocaleString('en-IN')}).`);
      return;
    }
    setSettleAdvanceLoading(true);
    setSettleAdvanceError('');
    try {
      const res = await recoverWorkerAdvanceAction(
        settleAdvanceWorker.worker_id,
        amt,
        settleAdvanceNote || undefined
      );
      if (!res.success) {
        setSettleAdvanceError(res.error || 'Failed to settle advance.');
        return;
      }
      setLocalWorkers(prev => prev.map(w => {
        if (w.worker_id === settleAdvanceWorker.worker_id) {
          const newUnpaid = Math.max(0, (w.unpaid_salary || 0) - amt);
          const newAdvance = Math.max(0, (w.running_advance || 0) - amt);
          const newRecovered = (w.total_advance_recovered || 0) + amt;
          return {
            ...w,
            unpaid_salary: newUnpaid,
            running_advance: newAdvance,
            total_advance_recovered: newRecovered,
            net_payable: newUnpaid - newAdvance,
          };
        }
        return w;
      }));
      setWorkerFullLedgerData(prev => {
        const copy = { ...prev };
        delete copy[settleAdvanceWorker.worker_id];
        return copy;
      });
      setShowSettleAdvanceModal(false);
      setSettleAdvanceWorker(null);
      setSettleAdvanceAmount('');
      setSettleAdvanceNote('');
      alert(`₹${amt.toLocaleString('en-IN')} settled from salary for ${settleAdvanceWorker.worker_name}. No physical cash moved.`);
    } catch (err: any) {
      setSettleAdvanceError(err.message || 'Error executing advance settlement.');
    } finally {
      setSettleAdvanceLoading(false);
    }
  };

  const handleExecuteReclassifyKharcha = async () => {
    setReclassifyLoading(true);
    try {
      const res = await batchReclassifyKharchaAction();
      if (!res.success) {
        alert(res.error || 'Failed to reclassify Kharcha disbursements.');
        return;
      }
      setReclassifySuccess({ count: res.convertedCount, totalAmount: res.totalConvertedAmount });
      setTimeout(() => {
        window.location.reload();
      }, 1800);
    } catch (err: any) {
      alert(err.message || 'Error executing reclassification.');
    } finally {
      setReclassifyLoading(false);
    }
  };

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
        // Exclude disputed / cancelled transactions from ledger log (only keep confirmed and pending)
        if (tx.status === 'disputed') {
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

      const isRefunded = !!localRefundedMap[tx.id];
      const refundInfo = localRefundedMap[tx.id];

      return {
        id: tx.id,
        created_at: tx.created_at,
        amount: Number(tx.amount),
        status: isRefunded ? ('refunded' as any) : tx.status,
        note: isRefunded && refundInfo?.reason ? `[Refunded] ${refundInfo.reason}${tx.note ? ` • ${tx.note}` : ''}` : tx.note,
        type: tx.type,
        purpose,
        fromLabel: tx.type === 'office_to_supervisor' ? 'Office' : tx.from?.name || 'Supervisor',
        toLabel: tx.type === 'supervisor_to_worker' ? tx.to_work?.name || 'Worker' : tx.to_sup?.name || 'Supervisor',
        factoryId,
        supervisorId: tx.from_supervisor_id || tx.to_supervisor_id,
        isFlagged: tx.status === 'pending' && isOlderThan24Hours(tx.created_at),
        isRefunded,
        refundInfo,
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

  const activeWorkers = localWorkers.filter(w => w.active !== false && w.worker_name !== 'Deleted Worker');

  const workerReports = activeWorkers.map(w => {
    // Total refunded for this worker
    const workerRefundedAmt = transactions
      .filter(t => t.type === 'supervisor_to_worker' && t.to_worker_id === w.worker_id && localRefundedMap[t.id])
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);

    const adjustedRunningAdvance = Math.max(0, Number(w.running_advance || 0) - workerRefundedAmt);
    const adjustedTotalDisbursed = Math.max(0, Number(w.total_cash_disbursed || 0) - workerRefundedAmt);
    const adjustedUnpaidSalary = Math.max(0, Number(w.unpaid_salary || 0));
    const adjustedNetPayable = adjustedUnpaidSalary - adjustedRunningAdvance;

    const allDisbursements = transactions.filter(
      t => t.type === 'supervisor_to_worker' && t.to_worker_id === w.worker_id && t.status === 'confirmed'
    );
    const periodDisbursements = allDisbursements.filter(t => 
      isWithinDateRange(t.created_at, workerFromDate, workerToDate)
    );
    const validPeriodDisbursements = periodDisbursements.filter(t => !localRefundedMap[t.id]);
    
    // Split period disbursements
    const periodSalaryPaid = validPeriodDisbursements
      .filter(t => (t as any).payment_type === 'salary_payment' || t.note?.includes('[TYPE:salary_payment]'))
      .reduce((sum, t) => sum + Number(t.amount), 0);
    const periodAdvanceGiven = validPeriodDisbursements
      .filter(t => (t as any).payment_type !== 'salary_payment' && !t.note?.includes('[TYPE:salary_payment]'))
      .reduce((sum, t) => sum + Number(t.amount), 0);
    const periodAdvance = validPeriodDisbursements.reduce((sum, t) => sum + Number(t.amount), 0);
    const periodCount = validPeriodDisbursements.length;

    const factoryName = factories.find(f => f.id === w.factory_id)?.name || 'Unknown Factory';
    const supervisorName = supervisors.find(s => s.id === w.supervisor_id)?.name || 'Unknown Supervisor';
    const effectivePhone = localWorkerPhoneOverrides[w.worker_id] !== undefined
      ? localWorkerPhoneOverrides[w.worker_id]
      : w.worker_phone;

    return {
      worker: {
        ...w,
        worker_phone: effectivePhone,
        running_advance: adjustedRunningAdvance,
        total_cash_disbursed: adjustedTotalDisbursed,
        unpaid_salary: adjustedUnpaidSalary,
        net_payable: adjustedNetPayable,
      },
      periodAdvance,
      periodSalaryPaid,
      periodAdvanceGiven,
      periodCount,
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

  const totalUnpaidSalaryAll = filteredWorkerReports.reduce((sum, item) => sum + Number(item.worker.unpaid_salary || 0), 0);
  const totalAdvancesOwedAll = filteredWorkerReports.reduce((sum, item) => sum + Number(item.worker.running_advance || 0), 0);
  const netWorkerPositionAll = totalUnpaidSalaryAll - totalAdvancesOwedAll;

  const exportWorkerAdvancesToCSV = () => {
    const headers = [
      'Worker Name',
      'Phone',
      'Factory',
      'Supervisor',
      'Monthly Salary (Wage)',
      'Total Salary Earned (INR)',
      'Total Salary Paid (INR)',
      'Current Unpaid Salary (INR)',
      'Total Advance Given (INR)',
      'Advance Recovered (INR)',
      'Current Advance Owed (INR)',
      'Net Payable to Worker (INR)',
      'Period Cash Disbursed (INR)',
      'Period Disbursements Count',
      'Period From',
      'Period To',
    ];
    const rows = filteredWorkerReports.map(item => [
      item.worker.worker_name,
      item.worker.worker_phone || 'N/A',
      item.factoryName,
      item.supervisorName,
      item.worker.monthly_salary || 0,
      item.worker.total_salary_earned || 0,
      item.worker.total_salary_paid || 0,
      item.worker.unpaid_salary || 0,
      item.worker.total_advance_given || 0,
      item.worker.total_advance_recovered || 0,
      item.worker.running_advance || 0,
      item.worker.net_payable || 0,
      item.periodAdvance,
      item.periodCount,
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
    link.setAttribute('download', `fundflow_worker_payroll_statement_${workerFromDate || 'all'}_to_${workerToDate || 'all'}.csv`);
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

      {/* Floating In-App Real-Time Alert Card */}
      {inAppAlert && (
        <div className="fixed top-4 right-4 z-50 max-w-md bg-slate-900 border-2 border-emerald-500 text-white p-4 rounded-xl shadow-2xl flex items-start gap-3 transition-all">
          <div className="h-9 w-9 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
            <Bell className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="flex-1">
            <h4 className="text-sm font-black text-white">{inAppAlert.title}</h4>
            <p className="text-xs text-slate-300 mt-0.5">{inAppAlert.body}</p>
          </div>
          <button
            onClick={() => setInAppAlert(null)}
            className="text-slate-400 hover:text-white p-1"
            title="Dismiss notification"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

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

          {/* Pending Advance Correction Requests from Supervisors */}
          {advanceCorrectionRequests.filter(r => r.status === 'PENDING').length > 0 && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-900">
                  <RotateCcw className="h-4 w-4 text-indigo-600" />
                  <span>Advance Correction Requests ({advanceCorrectionRequests.filter(r => r.status === 'PENDING').length})</span>
                </div>
              </div>

              <div className="space-y-2">
                {advanceCorrectionRequests.filter(r => r.status === 'PENDING').map(req => (
                  <div key={req.id} className="bg-white border border-indigo-200 rounded p-2.5 shadow-xs text-xs space-y-1.5">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="font-bold text-slate-900">{req.worker_name}</span>
                        <span className="text-[10px] text-slate-500 block">{req.factory_name} • By {req.supervisor_name}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-slate-400 block line-through">{formatINR(req.current_advance)}</span>
                        <span className="font-extrabold text-indigo-950 text-sm">{formatINR(req.requested_advance)}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] bg-indigo-50/60 rounded px-2 py-1 border border-indigo-100">
                      <span className="text-slate-600">Correction:</span>
                      <span className={`font-bold ${req.difference > 0 ? 'text-amber-800' : 'text-emerald-700'}`}>
                        {req.difference > 0 ? `+${formatINR(req.difference)} (Increase)` : `${formatINR(req.difference)} (Decrease)`}
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-600 italic bg-slate-50 rounded p-1.5 border border-slate-100">
                      "{req.reason}"
                    </p>

                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        disabled={reviewCorrectionLoadingId === req.id}
                        onClick={() => handleReviewCorrection(req.id, 'APPROVED')}
                        className="flex-1 py-1.5 px-2 rounded bg-indigo-600 text-white text-[11px] font-bold hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-1 shadow-xs"
                      >
                        {reviewCorrectionLoadingId === req.id ? (
                          <RefreshCw className="h-3 w-3 animate-spin" />
                        ) : (
                          <>
                            <CheckCircle2 className="h-3 w-3" />
                            <span>Approve & Update Advance</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        disabled={reviewCorrectionLoadingId === req.id}
                        onClick={() => handleReviewCorrection(req.id, 'REJECTED')}
                        className="py-1.5 px-2.5 rounded border border-slate-200 text-slate-500 text-[11px] font-medium hover:bg-slate-50 disabled:opacity-50"
                      >
                        Reject
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
            <>
              {/* Mobile Factory Cards (Zero Horizontal Scroll) */}
              <div className="md:hidden divide-y divide-slate-100 bg-white">
                {factoryCashPositions.map((pos) => (
                  <div key={pos.id} className="p-4 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-bold text-slate-900 text-sm">{pos.name}</h3>
                        <p className="text-xs text-slate-500">{pos.location}</p>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Cash On Hand</span>
                        <span className="text-base font-black text-emerald-600">{formatINR(pos.remaining)}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                      <div>
                        <span className="text-slate-500 block text-[11px]">Sent:</span>
                        <span className="font-semibold text-slate-700">{formatINR(pos.sent)}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[11px]">Confirmed:</span>
                        <span className="font-semibold text-slate-800">{formatINR(pos.confirmed)}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[11px]">Net Transfers:</span>
                        <span className={`font-semibold ${pos.transfers > 0 ? 'text-emerald-600' : pos.transfers < 0 ? 'text-amber-600' : 'text-slate-600'}`}>
                          {pos.transfers > 0 ? `+${formatINR(pos.transfers)}` : formatINR(pos.transfers)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[11px]">Disbursed:</span>
                        <span className="font-semibold text-slate-700">{formatINR(pos.disbursed)}</span>
                      </div>
                      <div className="col-span-2 pt-1 border-t border-slate-200/60 flex justify-between items-center">
                        <span className="text-slate-500 text-[11px]">Expenses:</span>
                        <span className="font-bold text-red-600">{formatINR(pos.expenses)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop Table View */}
              <div className="hidden md:block overflow-x-auto">
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
            </>
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
        <div 
          onClick={() => setIsWorkerAdvancesCollapsed(!isWorkerAdvancesCollapsed)}
          className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-slate-200 bg-slate-50 flex flex-col xl:flex-row xl:items-center justify-between gap-3 cursor-pointer hover:bg-slate-100/70 transition-colors select-none"
        >
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-lg bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-700 shrink-0">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm sm:text-base font-bold text-slate-900 tracking-tight">
                  Worker Accounts &amp; Payroll Statement
                </h2>
                {(workerFromDate || workerToDate) && (
                  <span className="text-[10px] bg-indigo-100 text-indigo-800 font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                    Date Filter Active
                  </span>
                )}
                {isWorkerAdvancesCollapsed && (
                  <span className="text-[11px] bg-slate-200 text-slate-700 font-semibold px-2 py-0.5 rounded-full">
                    {filteredWorkerReports.length} workers • Unpaid: {formatINR(totalUnpaidSalaryAll)} • Advance Owed: {formatINR(totalAdvancesOwedAll)}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">
                {isWorkerAdvancesCollapsed 
                  ? 'Tap to expand statement, credit wages & settle advances from salary' 
                  : 'Track earned wages, cash disbursements, accumulated unpaid salary, and advance recoveries'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start xl:self-auto" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => {
                setCreditSalaryWorker(null);
                setCreditSalaryWorkerId(filteredWorkerReports[0]?.worker.worker_id || '');
                setCreditSalaryAmount('');
                setCreditSalaryMonth('');
                setCreditSalaryNote('');
                setCreditSalaryError('');
                setShowCreditSalaryModal(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 sm:py-2 text-xs font-bold text-white shadow-xs hover:bg-slate-800 transition-colors min-h-[36px]"
              title="Credit earned salary/wages to a worker"
            >
              <Coins className="h-3.5 w-3.5" />
              <span>+ Credit Salary</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setBatchSalaryMonth('');
                setBatchSalaryNote('');
                setBatchSalaryError('');
                setBatchSalarySuccess('');
                setShowBatchSalaryModal(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 sm:py-2 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 hover:text-slate-900 transition-colors min-h-[36px]"
              title="Accrue monthly wages for all workers in 1-click"
            >
              <Users className="h-3.5 w-3.5 text-slate-500" />
              <span>Batch Monthly</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const candidates = filteredWorkerReports.filter(w => (w.worker.unpaid_salary || 0) > 0 && (w.worker.running_advance || 0) > 0);
                if (candidates.length === 0) {
                  alert('No workers currently have both unpaid salary and outstanding advance.');
                  return;
                }
                const first = candidates[0].worker;
                setSettleAdvanceWorker(first);
                setSettleAdvanceAmount(String(Math.min(first.unpaid_salary || 0, first.running_advance || 0)));
                setSettleAdvanceError('');
                setShowSettleAdvanceModal(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 sm:py-2 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 hover:text-slate-900 transition-colors min-h-[36px]"
              title="Deduct advance from accumulated salary with zero cash movement"
            >
              <ArrowRightLeft className="h-3.5 w-3.5 text-slate-500" />
              <span>Settle Advance</span>
            </button>

            <button
              type="button"
              onClick={() => setShowReclassifyModal(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 sm:py-2 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 hover:text-slate-900 transition-colors min-h-[36px]"
              title="Audit and reclassify legacy Kharcha/weekly advance entries"
            >
              <Wrench className="h-3.5 w-3.5 text-slate-500" />
              <span>Fix Kharcha</span>
            </button>

            <Link
              href={workerFactoryId !== 'all' ? `/admin/opening-advances?factory=${workerFactoryId}` : '/admin/opening-advances'}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 sm:py-2 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 hover:text-slate-900 transition-colors min-h-[36px]"
            >
              <Coins className="h-3.5 w-3.5 text-slate-500" />
              <span>Opening Balances</span>
            </Link>

            {!isWorkerAdvancesCollapsed && (
              <button
                type="button"
                onClick={exportWorkerAdvancesToCSV}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 sm:py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors min-h-[36px]"
              >
                <Download className="h-3.5 w-3.5 text-slate-500" />
                <span>Export CSV</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsWorkerAdvancesCollapsed(!isWorkerAdvancesCollapsed)}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 sm:py-2 text-xs font-bold text-slate-700 shadow-xs hover:bg-slate-50 transition-colors min-h-[36px]"
            >
              {isWorkerAdvancesCollapsed ? (
                <>
                  <ChevronDown className="h-4 w-4 text-slate-500" />
                  <span>Expand</span>
                </>
              ) : (
                <>
                  <ChevronUp className="h-4 w-4 text-slate-500" />
                  <span>Collapse</span>
                </>
              )}
            </button>
          </div>
        </div>

        {!isWorkerAdvancesCollapsed && (
          <>
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

              {/* Metric Summary Banner (4 Cards) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
                <div className="bg-emerald-50/60 border border-emerald-200/80 rounded-lg p-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 block">
                    Accumulated Unpaid Salary
                  </span>
                  <span className="text-xl font-black text-emerald-700">
                    {formatINR(totalUnpaidSalaryAll)}
                  </span>
                  <span className="text-[10px] text-emerald-600 block mt-0.5">
                    Owed by factory across workers
                  </span>
                </div>

                <div className="bg-amber-50/60 border border-amber-200/80 rounded-lg p-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800 block">
                    Outstanding Advances
                  </span>
                  <span className="text-xl font-black text-amber-700">
                    {formatINR(totalAdvancesOwedAll)}
                  </span>
                  <span className="text-[10px] text-amber-600 block mt-0.5">
                    Owed by workers back to factory
                  </span>
                </div>

                <div className={`border rounded-lg p-3 ${
                  netWorkerPositionAll >= 0 
                    ? 'bg-blue-50/60 border-blue-200 text-blue-900' 
                    : 'bg-orange-50/60 border-orange-200 text-orange-900'
                }`}>
                  <span className="text-[10px] font-bold uppercase tracking-wider block opacity-80">
                    Net Worker Position
                  </span>
                  <span className="text-xl font-black">
                    {netWorkerPositionAll >= 0 ? '+' : '-'}{formatINR(Math.abs(netWorkerPositionAll))}
                  </span>
                  <span className="text-[10px] block mt-0.5 opacity-75">
                    {netWorkerPositionAll >= 0 ? 'Factory owes workers net' : 'Workers owe factory net'}
                  </span>
                </div>

                <div className="bg-slate-50 border border-slate-200/80 rounded-lg p-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                    {workerFromDate || workerToDate ? 'Period Cash Disbursed' : 'Total Cash Disbursed'}
                  </span>
                  <span className="text-xl font-black text-slate-900">
                    {formatINR(totalWorkerPeriodAdvance)}
                  </span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">
                    {totalWorkerPeriodTxCount} cash transactions in timeframe
                  </span>
                </div>
              </div>
            </div>

            {/* Worker Table or Mobile Cards */}
            {filteredWorkerReports.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                No workers match the selected timeframe and filter criteria.
              </div>
            ) : (
              <>
                {/* Mobile Worker Cards (Zero Horizontal Scroll) */}
                <div className="md:hidden divide-y divide-slate-100 bg-white">
                  {filteredWorkerReports.map((item) => {
                    const isLedgerOpen = expandedLedgerWorkerId === item.worker.worker_id;
                    const ledgerEntries = workerFullLedgerData[item.worker.worker_id] || [];
                    const isLedgerLoading = loadingLedgerWorkerId === item.worker.worker_id;

                    return (
                      <div key={item.worker.worker_id} className="p-3.5 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2.5">
                            <div className="h-10 w-10 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
                              {item.worker.worker_photo_url ? (
                                <img src={item.worker.worker_photo_url} alt="" className="h-full w-full object-cover" />
                              ) : (
                                <User className="h-5 w-5 text-slate-400" />
                              )}
                            </div>
                            <div>
                              <h4 className="text-xs font-bold text-slate-900">{item.worker.worker_name}</h4>
                              <p className="text-[11px] text-slate-500">{item.factoryName} • {item.supervisorName}</p>
                              {item.worker.monthly_salary && item.worker.monthly_salary > 0 && (
                                <span className="text-[10px] text-purple-700 font-semibold bg-purple-50 px-1.5 py-0.2 rounded border border-purple-200 inline-block mt-0.5">
                                  Wage: {formatINR(item.worker.monthly_salary)}/mo
                                </span>
                              )}
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <p className="text-[10px] text-slate-500 font-medium">
                                  {item.worker.worker_phone || 'No phone'}
                                </p>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingWorkerPhone({
                                      workerId: item.worker.worker_id,
                                      workerName: item.worker.worker_name,
                                      currentPhone: item.worker.worker_phone || '',
                                    });
                                    setPhoneEditInput(item.worker.worker_phone || '');
                                    setPhoneEditError('');
                                  }}
                                  className="text-slate-400 hover:text-indigo-600 transition-colors p-0.5 rounded"
                                  title="Edit Worker Phone (Admin)"
                                >
                                  <Edit2 className="h-2.5 w-2.5" />
                                </button>
                              </div>
                            </div>
                          </div>

                          <div className="text-right">
                            <span className="text-[9px] uppercase font-bold text-slate-400 block tracking-wider">Net Position</span>
                            <span className={`text-xs font-black ${
                              (item.worker.net_payable || 0) >= 0 ? 'text-emerald-700' : 'text-amber-700'
                            }`}>
                              {(item.worker.net_payable || 0) >= 0 ? '+' : ''}{formatINR(item.worker.net_payable || 0)}
                            </span>
                            <span className="text-[9px] text-slate-400 block">
                              {(item.worker.net_payable || 0) >= 0 ? 'Payable' : 'Advance Owed'}
                            </span>
                          </div>
                        </div>

                        {/* 3-stat pill row */}
                        <div className="grid grid-cols-3 gap-1.5 text-center bg-slate-50 p-2 rounded-lg border border-slate-100">
                          <div className="bg-white p-1.5 rounded border border-slate-100">
                            <span className="text-[9px] uppercase font-bold text-slate-400 block">Unpaid Salary</span>
                            <span className="text-xs font-black text-emerald-700">{formatINR(item.worker.unpaid_salary || 0)}</span>
                          </div>
                          <div className="bg-white p-1.5 rounded border border-slate-100">
                            <span className="text-[9px] uppercase font-bold text-slate-400 block">Advance Owed</span>
                            <span className="text-xs font-black text-amber-700">{formatINR(item.worker.running_advance || 0)}</span>
                          </div>
                          <div className="bg-white p-1.5 rounded border border-slate-100">
                            <span className="text-[9px] uppercase font-bold text-slate-400 block">Cash Given</span>
                            <span className="text-xs font-bold text-slate-700">{formatINR(item.periodAdvance)}</span>
                          </div>
                        </div>

                        {/* Actions Row */}
                        <div className="flex items-center gap-1.5 pt-0.5">
                          <button
                            type="button"
                            onClick={() => {
                              setCreditSalaryWorker(item.worker);
                              setCreditSalaryWorkerId(item.worker.worker_id);
                              setCreditSalaryAmount(item.worker.monthly_salary ? String(item.worker.monthly_salary) : '');
                              setCreditSalaryMonth('');
                              setCreditSalaryNote('');
                              setCreditSalaryError('');
                              setShowCreditSalaryModal(true);
                            }}
                            className="flex-1 py-1.5 px-2 rounded bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center justify-center gap-1 min-h-[34px]"
                          >
                            <Coins className="h-3 w-3" />
                            <span>Salary</span>
                          </button>

                          <button
                            type="button"
                            disabled={(item.worker.unpaid_salary || 0) <= 0 || (item.worker.running_advance || 0) <= 0}
                            onClick={() => {
                              setSettleAdvanceWorker(item.worker);
                              const maxSettle = Math.min(item.worker.unpaid_salary || 0, item.worker.running_advance || 0);
                              setSettleAdvanceAmount(String(maxSettle));
                              setSettleAdvanceNote('');
                              setSettleAdvanceError('');
                              setShowSettleAdvanceModal(true);
                            }}
                            className="flex-1 py-1.5 px-2 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center justify-center gap-1 min-h-[34px] disabled:opacity-40"
                          >
                            <ArrowRightLeft className="h-3 w-3" />
                            <span>Settle</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => toggleWorkerFullLedger(item.worker.worker_id)}
                            className="py-1.5 px-2.5 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center justify-center gap-1 min-h-[34px]"
                          >
                            <span>{isLedgerOpen ? 'Close' : 'Statement'}</span>
                            {isLedgerOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          </button>
                        </div>

                        {/* Full Itemized Chronological Ledger Drawer on Mobile */}
                        {isLedgerOpen && (
                          <div className="p-3 bg-slate-50/80 rounded-lg border border-slate-200 text-xs space-y-2">
                            <div className="flex justify-between items-center text-[11px] font-bold text-slate-800">
                              <span>Full Ledger Statement</span>
                              <span className="text-slate-500 font-normal">All chronological records</span>
                            </div>

                            {isLedgerLoading ? (
                              <div className="py-4 text-center">
                                <RefreshCw className="h-4 w-4 animate-spin text-slate-400 mx-auto" />
                                <span className="text-slate-400 text-[10px] mt-1 block">Loading statement...</span>
                              </div>
                            ) : ledgerEntries.length === 0 ? (
                              <p className="text-slate-500 text-[11px] py-2 text-center bg-white rounded border border-slate-200">
                                No statement records logged for this worker.
                              </p>
                            ) : (
                              <div className="space-y-2">
                                {ledgerEntries.map((entry) => {
                                  const isRefunded = !!localRefundedMap[entry.id];
                                  return (
                                    <div key={entry.id} className={`p-2.5 bg-white rounded border space-y-1 text-[11px] ${
                                      entry.type === 'salary_earned' ? 'border-purple-200 bg-purple-50/20' :
                                      entry.type === 'advance_recovery' ? 'border-blue-200 bg-blue-50/20' :
                                      entry.type === 'salary_payment' ? 'border-emerald-200 bg-emerald-50/20' :
                                      'border-slate-200'
                                    }`}>
                                      <div className="flex justify-between items-center">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <span className={`font-black ${isRefunded ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                                            {formatINR(entry.amount)}
                                          </span>
                                          <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold uppercase tracking-wider ${
                                            entry.type === 'salary_earned' ? 'bg-purple-100 text-purple-800' :
                                            entry.type === 'advance_recovery' ? 'bg-blue-100 text-blue-800' :
                                            entry.type === 'salary_payment' ? 'bg-emerald-100 text-emerald-800' :
                                            'bg-amber-100 text-amber-800'
                                          }`}>
                                            {entry.label}
                                          </span>
                                          {!entry.isCash && (
                                            <span className="text-[8px] bg-slate-100 text-slate-600 px-1 py-0.2 rounded font-semibold">
                                              No Cash Outflow
                                            </span>
                                          )}
                                          {isRefunded && (
                                            <span className="px-1.5 py-0.2 rounded text-[9px] font-black uppercase bg-amber-100 text-amber-800 border border-amber-300">
                                              Refunded
                                            </span>
                                          )}
                                        </div>
                                        <span className="text-[10px] text-slate-400">
                                          {new Date(entry.date).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                                        </span>
                                      </div>

                                      <div className="flex justify-between items-center text-[10px] text-slate-500 pt-0.5">
                                        <span>By {entry.supervisorName || 'Supervisor'}</span>
                                        <div className="flex items-center gap-2">
                                          {entry.photoUrl && (
                                            <button
                                              type="button"
                                              onClick={() => setAdminViewingPhotoUrl(entry.photoUrl || null)}
                                              className="text-emerald-700 font-semibold underline flex items-center gap-0.5"
                                            >
                                              <Camera className="h-2.5 w-2.5" />
                                              <span>Photo</span>
                                            </button>
                                          )}
                                          {entry.isCash && !isRefunded && (
                                            <button
                                              type="button"
                                              onClick={() => setRefundTargetTx({
                                                id: entry.id,
                                                amount: Number(entry.amount),
                                                workerName: item.worker.worker_name,
                                                supervisorName: entry.supervisorName || 'Supervisor',
                                              })}
                                              className="text-red-600 hover:text-red-800 font-bold flex items-center gap-0.5 bg-red-50 hover:bg-red-100 px-1.5 py-0.5 rounded border border-red-200 transition-colors"
                                              title="Refund money back to supervisor balance"
                                            >
                                              <RotateCcw className="h-2.5 w-2.5" />
                                              <span>Refund</span>
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                      {entry.note && (
                                        <p className="text-[10px] text-slate-600 italic">"{entry.note}"</p>
                                      )}
                                      <div className="flex justify-between items-center pt-1 border-t border-slate-100 text-[9px] text-slate-400 font-medium">
                                        <span>Running Unpaid: {formatINR(entry.runningUnpaidSalary || 0)}</span>
                                        <span>Advance Owed: {formatINR(entry.runningAdvance || 0)}</span>
                                        <span className="font-bold text-slate-600">Net: {formatINR(entry.runningNetPayable || 0)}</span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Desktop Table View */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                    <thead className="bg-slate-50 text-slate-700 font-semibold uppercase tracking-wider">
                      <tr>
                        <th className="px-4 py-3">Worker</th>
                        <th className="px-4 py-3">Factory / Sup</th>
                        <th className="px-3 py-3 text-right">Monthly Wage</th>
                        <th className="px-3 py-3 text-right">Salary Earned</th>
                        <th className="px-3 py-3 text-right">Salary Paid</th>
                        <th className="px-3 py-3 text-right">Unpaid Salary</th>
                        <th className="px-3 py-3 text-right">Advance Given</th>
                        <th className="px-3 py-3 text-right">Advance Settled</th>
                        <th className="px-3 py-3 text-right">Advance Owed</th>
                        <th className="px-4 py-3 text-right">Net Payable</th>
                        <th className="px-4 py-3 text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {filteredWorkerReports.map((item) => {
                        const isLedgerOpen = expandedLedgerWorkerId === item.worker.worker_id;
                        const ledgerEntries = workerFullLedgerData[item.worker.worker_id] || [];
                        const isLedgerLoading = loadingLedgerWorkerId === item.worker.worker_id;

                        return (
                          <React.Fragment key={item.worker.worker_id}>
                            <tr className="hover:bg-slate-50/80 transition-colors">
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2.5">
                                  <div className="h-8 w-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
                                    {item.worker.worker_photo_url ? (
                                      <img src={item.worker.worker_photo_url} alt="" className="h-full w-full object-cover" />
                                    ) : (
                                      <User className="h-4 w-4 text-slate-400" />
                                    )}
                                  </div>
                                  <div>
                                    <div className="font-bold text-slate-900">{item.worker.worker_name}</div>
                                    <div className="flex items-center gap-1 text-[11px] text-slate-500">
                                      <span>{item.worker.worker_phone || 'No phone'}</span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingWorkerPhone({
                                            workerId: item.worker.worker_id,
                                            workerName: item.worker.worker_name,
                                            currentPhone: item.worker.worker_phone || '',
                                          });
                                          setPhoneEditInput(item.worker.worker_phone || '');
                                          setPhoneEditError('');
                                        }}
                                        className="text-slate-400 hover:text-indigo-600 transition-colors p-0.5 rounded"
                                        title="Edit Worker Phone (Admin)"
                                      >
                                        <Edit2 className="h-2.5 w-2.5" />
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </td>

                              <td className="px-4 py-3">
                                <div>
                                  <div className="font-semibold text-slate-800">{item.factoryName}</div>
                                  <div className="text-[10px] text-slate-500">{item.supervisorName}</div>
                                </div>
                              </td>

                              <td className="px-3 py-3 text-right font-medium text-slate-600">
                                {item.worker.monthly_salary ? formatINR(item.worker.monthly_salary) : '-'}
                              </td>

                              <td className="px-3 py-3 text-right font-semibold text-purple-700">
                                {formatINR(item.worker.total_salary_earned || 0)}
                              </td>

                              <td className="px-3 py-3 text-right font-medium text-slate-700">
                                {formatINR(item.worker.total_salary_paid || 0)}
                              </td>

                              <td className="px-3 py-3 text-right font-black">
                                <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded border border-emerald-200">
                                  {formatINR(item.worker.unpaid_salary || 0)}
                                </span>
                              </td>

                              <td className="px-3 py-3 text-right font-medium text-slate-700">
                                {formatINR(item.worker.total_advance_given || 0)}
                              </td>

                              <td className="px-3 py-3 text-right font-medium text-blue-700">
                                {formatINR(item.worker.total_advance_recovered || 0)}
                              </td>

                              <td className="px-3 py-3 text-right font-black">
                                <span className="bg-amber-50 text-amber-700 px-2 py-0.5 rounded border border-amber-200">
                                  {formatINR(item.worker.running_advance || 0)}
                                </span>
                              </td>

                              <td className="px-4 py-3 text-right whitespace-nowrap">
                                {(item.worker.net_payable || 0) > 0 ? (
                                  <div className="inline-flex flex-col items-end">
                                    <span className="inline-block text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded whitespace-nowrap">
                                      {formatINR(item.worker.net_payable || 0)}
                                    </span>
                                    <span className="text-[9px] text-emerald-600 font-semibold mt-0.5">Payable</span>
                                  </div>
                                ) : (item.worker.net_payable || 0) < 0 ? (
                                  <div className="inline-flex flex-col items-end">
                                    <span className="inline-block text-xs font-bold text-amber-900 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded whitespace-nowrap">
                                      {formatINR(Math.abs(item.worker.net_payable || 0))}
                                    </span>
                                    <span className="text-[9px] text-amber-700 font-semibold mt-0.5">Advance Owed</span>
                                  </div>
                                ) : (
                                  <div className="inline-flex flex-col items-end">
                                    <span className="inline-block text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded whitespace-nowrap">
                                      ₹0
                                    </span>
                                    <span className="text-[9px] text-slate-400 mt-0.5">Settled</span>
                                  </div>
                                )}
                              </td>

                              <td className="px-4 py-3 text-center">
                                <div className="flex items-center justify-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setCreditSalaryWorker(item.worker);
                                      setCreditSalaryWorkerId(item.worker.worker_id);
                                      setCreditSalaryAmount(item.worker.monthly_salary ? String(item.worker.monthly_salary) : '');
                                      setCreditSalaryMonth('');
                                      setCreditSalaryNote('');
                                      setCreditSalaryError('');
                                      setShowCreditSalaryModal(true);
                                    }}
                                    className="p-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 transition-colors"
                                    title="Credit Earned Salary"
                                  >
                                    <Coins className="h-3.5 w-3.5" />
                                  </button>

                                  <button
                                    type="button"
                                    disabled={(item.worker.unpaid_salary || 0) <= 0 || (item.worker.running_advance || 0) <= 0}
                                    onClick={() => {
                                      setSettleAdvanceWorker(item.worker);
                                      const maxSettle = Math.min(item.worker.unpaid_salary || 0, item.worker.running_advance || 0);
                                      setSettleAdvanceAmount(String(maxSettle));
                                      setSettleAdvanceNote('');
                                      setSettleAdvanceError('');
                                      setShowSettleAdvanceModal(true);
                                    }}
                                    className="p-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 disabled:opacity-30 transition-colors"
                                    title="Settle Advance from Salary"
                                  >
                                    <ArrowRightLeft className="h-3.5 w-3.5" />
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => toggleWorkerFullLedger(item.worker.worker_id)}
                                    className="px-2 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-100 flex items-center gap-1 font-semibold text-[11px] transition-colors"
                                  >
                                    <span>{isLedgerOpen ? 'Hide' : 'Ledger'}</span>
                                    {isLedgerOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                  </button>
                                </div>
                              </td>
                            </tr>

                            {/* Full Chronological Ledger Drawer */}
                            {isLedgerOpen && (
                              <tr>
                                <td colSpan={11} className="bg-slate-50/80 p-4 border-t border-b border-slate-200">
                                  <div className="space-y-3">
                                    <div className="flex justify-between items-center">
                                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                                        <Clock className="h-3.5 w-3.5 text-slate-500" />
                                        <span>Complete Chronological Statement • {item.worker.worker_name}</span>
                                      </h4>
                                      <span className="text-xs font-semibold text-slate-600">
                                        Unpaid: <strong className="text-emerald-700">{formatINR(item.worker.unpaid_salary || 0)}</strong> • Advance Owed: <strong className="text-amber-700">{formatINR(item.worker.running_advance || 0)}</strong> • Net Payable: <strong className="text-slate-900">{formatINR(item.worker.net_payable || 0)}</strong>
                                      </span>
                                    </div>

                                    {isLedgerLoading ? (
                                      <div className="py-6 text-center bg-white rounded border border-slate-200">
                                        <RefreshCw className="h-4 w-4 animate-spin text-slate-400 mx-auto" />
                                        <span className="text-xs text-slate-500 mt-1 block">Loading statement ledger...</span>
                                      </div>
                                    ) : ledgerEntries.length === 0 ? (
                                      <p className="text-xs text-slate-500 py-3 text-center bg-white rounded border border-slate-200">
                                        No financial entries found for this worker.
                                      </p>
                                    ) : (
                                      <div className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white overflow-hidden shadow-sm">
                                        <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-slate-100 text-[10px] font-bold text-slate-600 uppercase tracking-wider">
                                          <div className="col-span-2">Date</div>
                                          <div className="col-span-3">Type &amp; Purpose</div>
                                          <div className="col-span-2 text-right">Amount</div>
                                          <div className="col-span-2">Recorded By</div>
                                          <div className="col-span-2 text-right">Running Net</div>
                                          <div className="col-span-1 text-center">Action</div>
                                        </div>

                                        {ledgerEntries.map((entry) => {
                                          const isRefunded = !!localRefundedMap[entry.id];
                                          return (
                                            <div key={entry.id} className={`grid grid-cols-12 gap-2 px-3 py-2.5 items-center text-xs hover:bg-slate-50 transition-colors ${
                                              entry.type === 'salary_earned' ? 'bg-purple-50/10' :
                                              entry.type === 'advance_recovery' ? 'bg-blue-50/10' :
                                              entry.type === 'salary_payment' ? 'bg-emerald-50/10' :
                                              ''
                                            }`}>
                                              <div className="col-span-2 text-[11px] text-slate-600">
                                                {new Date(entry.date).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                                              </div>

                                              <div className="col-span-3 space-y-0.5">
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                  <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold uppercase tracking-wider ${
                                                    entry.type === 'salary_earned' ? 'bg-purple-100 text-purple-800' :
                                                    entry.type === 'advance_recovery' ? 'bg-blue-100 text-blue-800' :
                                                    entry.type === 'salary_payment' ? 'bg-emerald-100 text-emerald-800' :
                                                    'bg-amber-100 text-amber-800'
                                                  }`}>
                                                    {entry.label}
                                                  </span>
                                                  {!entry.isCash && (
                                                    <span className="text-[8px] bg-slate-100 text-slate-500 px-1 py-0.2 rounded">
                                                      ₹0 Cash
                                                    </span>
                                                  )}
                                                  {isRefunded && (
                                                    <span className="px-1.5 py-0.2 rounded text-[8px] font-black uppercase bg-amber-100 text-amber-800 border border-amber-300">
                                                      Refunded
                                                    </span>
                                                  )}
                                                </div>
                                                {entry.note && (
                                                  <p className="text-[10px] text-slate-500 italic truncate max-w-xs">"{entry.note}"</p>
                                                )}
                                              </div>

                                              <div className="col-span-2 text-right">
                                                <span className={`font-black text-xs ${isRefunded ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                                                  {formatINR(entry.amount)}
                                                </span>
                                              </div>

                                              <div className="col-span-2 text-[11px] text-slate-600 truncate">
                                                {entry.supervisorName || 'Supervisor'}
                                              </div>

                                              <div className="col-span-2 text-right text-[11px] font-bold text-slate-700">
                                                {formatINR(entry.runningNetPayable || 0)}
                                              </div>

                                              <div className="col-span-1 text-center flex items-center justify-center gap-1">
                                                {entry.photoUrl && (
                                                  <button
                                                    type="button"
                                                    onClick={() => setAdminViewingPhotoUrl(entry.photoUrl || null)}
                                                    className="text-emerald-700 hover:text-emerald-800 p-1"
                                                    title="View Handover Photo"
                                                  >
                                                    <Camera className="h-3.5 w-3.5" />
                                                  </button>
                                                )}
                                                {entry.isCash && !isRefunded && (
                                                  <button
                                                    type="button"
                                                    onClick={() => setRefundTargetTx({
                                                      id: entry.id,
                                                      amount: Number(entry.amount),
                                                      workerName: item.worker.worker_name,
                                                      supervisorName: entry.supervisorName || 'Supervisor',
                                                    })}
                                                    className="text-red-600 hover:text-red-800 p-1"
                                                    title="Refund transaction"
                                                  >
                                                    <RotateCcw className="h-3.5 w-3.5" />
                                                  </button>
                                                )}
                                              </div>
                                            </div>
                                          );
                                        })}
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
              </>
            )}
          </>
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
          <>
            {/* Mobile Cards View (Zero Horizontal Scroll) */}
            <div className="md:hidden divide-y divide-slate-100 bg-white">
              {filteredLedger.map((entry) => {
                const parsed = parseHandoverNote(entry.note);
                return (
                  <div key={entry.id} className={`p-4 space-y-2.5 ${entry.isFlagged ? 'bg-red-50/30' : ''}`}>
                    {/* Top Row: Purpose, Status, Date */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold border ${
                          entry.purpose === 'Wages' 
                            ? 'bg-blue-50 text-blue-700 border-blue-100' 
                            : entry.purpose === 'Expenses' 
                            ? 'bg-red-50 text-red-700 border-red-100' 
                            : 'bg-purple-50 text-purple-700 border-purple-100'
                        }`}>
                          {entry.purpose}
                        </span>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          entry.status === 'confirmed'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                            : entry.status === 'disputed'
                            ? 'bg-red-50 text-red-700 border border-red-100'
                            : 'bg-amber-50 text-amber-700 border border-amber-100'
                        }`}>
                          {entry.status.toUpperCase()}
                        </span>
                        {entry.isFlagged && (
                          <span className="flex items-center gap-0.5 text-[9px] font-bold text-red-600 uppercase">
                            <AlertTriangle className="h-2.5 w-2.5" />
                            <span>&gt;24h</span>
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-slate-400 font-medium">
                        {new Date(entry.created_at).toLocaleString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>

                    {/* Middle Row: Parties & Amount */}
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="text-xs text-slate-700 font-medium">
                        <span className="text-slate-400">From </span>
                        <span className="font-semibold text-slate-900">{entry.fromLabel}</span>
                        <span className="text-slate-400"> → </span>
                        <span className="font-semibold text-slate-900">{entry.toLabel}</span>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-base font-black text-slate-900">{formatINR(entry.amount)}</span>
                      </div>
                    </div>

                    {/* Bottom Row: Note & Handover Photo Proof */}
                    {(parsed.note || parsed.photoUrl) && (
                      <div className="flex items-center justify-between gap-2 text-xs text-slate-500 pt-1.5 border-t border-slate-50">
                        <div className="italic truncate text-[11px] max-w-[200px]">
                          {parsed.note || 'Cash handover'}
                        </div>
                        {parsed.photoUrl && (
                          <button
                            type="button"
                            onClick={() => setAdminViewingPhotoUrl(parsed.photoUrl)}
                            className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded cursor-pointer transition-colors shadow-xs shrink-0"
                          >
                            <Camera className="h-3 w-3" />
                            <span>View Proof</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto">
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
                              <div className="flex items-center justify-between gap-2 flex-wrap">
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
                                {entry.purpose === 'Wages' && !entry.isRefunded && (
                                  <button
                                    type="button"
                                    onClick={() => setRefundTargetTx({
                                      id: entry.id,
                                      amount: entry.amount,
                                      workerName: entry.toLabel,
                                      supervisorName: entry.fromLabel,
                                    })}
                                    className="text-red-600 hover:text-red-800 font-bold text-[11px] flex items-center gap-1 bg-red-50 hover:bg-red-100 px-2 py-0.5 rounded border border-red-200 transition-colors shadow-2xs ml-auto shrink-0"
                                    title="Refund this advance back to supervisor's balance"
                                  >
                                    <RotateCcw className="h-2.5 w-2.5" />
                                    <span>Refund</span>
                                  </button>
                                )}
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
          </>
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
    
      {/* Refund Success Banner */}
      {refundSuccessMessage && (
        <div className="fixed top-5 right-5 z-50 bg-emerald-900 text-white px-4 py-3 rounded-lg shadow-xl border border-emerald-700 flex items-center gap-3 animate-in fade-in duration-200">
          <RotateCcw className="h-5 w-5 text-emerald-400 shrink-0" />
          <span className="text-xs font-bold">{refundSuccessMessage}</span>
          <button type="button" onClick={() => setRefundSuccessMessage(null)} className="text-emerald-300 hover:text-white ml-2">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Refund Confirmation Modal */}
      {refundTargetTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="h-9 w-9 rounded-full bg-red-100 flex items-center justify-center text-red-600">
                  <RotateCcw className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Refund Cash Advance</h3>
                  <p className="text-[11px] text-slate-500">Correct mistaken payment to wrong worker</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setRefundTargetTx(null); setRefundReason(''); }}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-2.5 bg-slate-50 p-3.5 rounded-lg border border-slate-200 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Worker:</span>
                <span className="font-bold text-slate-900 text-sm">{refundTargetTx.workerName}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Advance Amount:</span>
                <span className="font-black text-red-600 text-base">{formatINR(refundTargetTx.amount)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Refund To:</span>
                <span className="font-bold text-slate-900">{refundTargetTx.supervisorName}'s Balance</span>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-[11px] text-amber-900 space-y-1">
              <p className="font-bold">What will happen:</p>
              <ul className="list-disc pl-4 space-y-0.5 text-amber-800">
                <li><strong>{formatINR(refundTargetTx.amount)}</strong> will be credited back to <strong>{refundTargetTx.supervisorName}</strong>'s available balance.</li>
                <li><strong>{formatINR(refundTargetTx.amount)}</strong> will be deducted from <strong>{refundTargetTx.workerName}</strong>'s running advance.</li>
                <li>A push notification will be sent to <strong>{refundTargetTx.supervisorName}</strong>.</li>
                <li>This transaction will be marked as <strong>Refunded</strong> in history.</li>
              </ul>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                Reason / Remark (Optional)
              </label>
              <input
                type="text"
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                placeholder="e.g. Supervisor selected wrong worker by mistake"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:ring-1 focus:ring-slate-900"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                disabled={refundLoading}
                onClick={() => { setRefundTargetTx(null); setRefundReason(''); }}
                className="flex-1 py-2 px-3 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 min-h-[40px]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={refundLoading}
                onClick={executeRefund}
                className="flex-1 py-2 px-3 rounded-lg bg-red-600 hover:bg-red-700 text-xs font-bold text-white flex items-center justify-center gap-1.5 min-h-[40px] shadow-sm disabled:opacity-50"
              >
                {refundLoading ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Refunding...</span>
                  </>
                ) : (
                  <>
                    <RotateCcw className="h-4 w-4" />
                    <span>Confirm Refund</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Edit Worker Phone Modal */}
      {editingWorkerPhone && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600">
                  <Phone className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                    Edit Worker Phone
                  </h3>
                  <span className="text-[10px] text-slate-500">Admin Only Access</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setEditingWorkerPhone(null); setPhoneEditError(''); }}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="bg-slate-50 border border-slate-100 rounded-lg p-3 text-xs space-y-1">
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Worker:</span>
                <span className="font-bold text-slate-900">{editingWorkerPhone.workerName}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Current Phone:</span>
                <span className="font-semibold text-slate-700">{editingWorkerPhone.currentPhone || 'None'}</span>
              </div>
            </div>

            {phoneEditError && (
              <div className="rounded-lg bg-red-50 p-2.5 text-xs text-red-700 border border-red-200">
                {phoneEditError}
              </div>
            )}

            <div>
              <label htmlFor="adminPhoneInput" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                Mobile Number
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 text-xs font-bold pointer-events-none">+91</span>
                <input
                  id="adminPhoneInput"
                  type="tel"
                  disabled={phoneEditLoading}
                  value={phoneEditInput.replace(/^\+91/, '')}
                  onChange={(e) => setPhoneEditInput(e.target.value)}
                  placeholder="10-digit number (or blank to clear)"
                  maxLength={14}
                  className="block w-full rounded-lg border border-slate-300 pl-11 pr-3 py-2 text-slate-950 text-sm focus:ring-2 focus:ring-slate-900 min-h-[44px]"
                />
              </div>
              <p className="text-[10px] text-slate-400 mt-1">
                Enter 10-digit number, or leave blank to remove the phone.
              </p>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                disabled={phoneEditLoading}
                onClick={() => { setEditingWorkerPhone(null); setPhoneEditError(''); }}
                className="flex-1 py-2 px-3 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 min-h-[40px]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={phoneEditLoading}
                onClick={handleAdminSaveWorkerPhone}
                className="flex-1 py-2 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold min-h-[40px] flex items-center justify-center gap-1.5 shadow-sm"
              >
                {phoneEditLoading ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <span>Save Phone</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Credit Salary Modal */}
      {showCreditSalaryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full bg-purple-100 flex items-center justify-center text-purple-700">
                  <Coins className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                    Credit Earned Salary
                  </h3>
                  <span className="text-[10px] text-slate-500">Accrue wages • ₹0 physical cash movement</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setShowCreditSalaryModal(false); setCreditSalaryWorker(null); setCreditSalaryError(''); }}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Worker Selector if not preselected */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                Select Worker
              </label>
              {creditSalaryWorker ? (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 font-medium">Worker:</span>
                    <span className="font-bold text-slate-900">{creditSalaryWorker.worker_name}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 font-medium">Current Unpaid:</span>
                    <span className="font-bold text-emerald-700">{formatINR(creditSalaryWorker.unpaid_salary || 0)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 font-medium">Advance Owed:</span>
                    <span className={`font-bold ${(creditSalaryWorker.running_advance || 0) > 0 ? 'text-amber-800 font-black' : 'text-slate-700'}`}>
                      {formatINR(creditSalaryWorker.running_advance || 0)}
                    </span>
                  </div>
                  {creditSalaryWorker.monthly_salary && (
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500 font-medium">Monthly Wage:</span>
                      <span className="font-bold text-slate-800">{formatINR(creditSalaryWorker.monthly_salary)}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <select
                    value={creditSalaryWorkerId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setCreditSalaryWorkerId(id);
                      const w = localWorkers.find(x => x.worker_id === id);
                      if (w && w.monthly_salary) {
                        setCreditSalaryAmount(String(w.monthly_salary));
                        if (w.running_advance > 0) {
                          setCreditSalaryDeduction(String(Math.min(w.monthly_salary, w.running_advance)));
                        }
                      }
                    }}
                    className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 text-xs min-h-[40px] bg-white font-bold"
                  >
                    <option value="">-- Choose Worker --</option>
                    {localWorkers.filter(w => w.active !== false).map(w => (
                      <option key={w.worker_id} value={w.worker_id}>
                        {w.worker_name} (Unpaid: {formatINR(w.unpaid_salary || 0)} | Adv: {formatINR(w.running_advance || 0)})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {creditSalaryError && (
              <div className="rounded-lg bg-red-50 p-2.5 text-xs text-red-700 border border-red-200">
                {creditSalaryError}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label htmlFor="adminCreditSalaryAmount" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Salary / Wage Amount (INR) <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 text-sm font-bold pointer-events-none">₹</span>
                  <input
                    id="adminCreditSalaryAmount"
                    type="number"
                    min="1"
                    disabled={creditSalaryLoading}
                    value={creditSalaryAmount}
                    onChange={(e) => {
                      const val = e.target.value;
                      setCreditSalaryAmount(val);
                      const target = creditSalaryWorker || localWorkers.find(w => w.worker_id === creditSalaryWorkerId);
                      if (target && target.running_advance > 0) {
                        const salNum = parseFloat(val) || 0;
                        const curDeduct = parseFloat(creditSalaryDeduction) || 0;
                        if (curDeduct > salNum) {
                          setCreditSalaryDeduction(String(Math.min(salNum, target.running_advance)));
                        }
                      }
                    }}
                    placeholder="e.g. 20000"
                    className="block w-full rounded-lg border border-slate-300 pl-8 pr-3 py-2 text-slate-950 text-sm font-bold focus:ring-2 focus:ring-slate-900 min-h-[44px]"
                  />
                </div>
              </div>

              {/* Advance Deduction Section */}
              {(() => {
                const target = creditSalaryWorker || localWorkers.find(w => w.worker_id === creditSalaryWorkerId);
                if (!target) return null;
                const workerAdv = target.running_advance || 0;
                const salNum = parseFloat(creditSalaryAmount) || 0;

                if (workerAdv === 0) {
                  return (
                    <div className="rounded-lg p-2.5 bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-center justify-between">
                      <span>Worker has ₹0 advance owed.</span>
                      <span className="font-semibold text-emerald-700">Advance Settled</span>
                    </div>
                  );
                }

                const maxDeduct = Math.min(workerAdv, salNum > 0 ? salNum : workerAdv);

                return (
                  <div className="rounded-lg p-3 bg-amber-50/70 border border-amber-200 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <label htmlFor="adminSalaryDeduct" className="block text-xs font-bold text-amber-950 uppercase tracking-wider">
                          Deduct from Advance
                        </label>
                        <span className="text-[11px] text-amber-800">
                          Advance owed: <strong className="font-bold">{formatINR(workerAdv)}</strong>
                        </span>
                      </div>
                      <span className="text-[10px] bg-amber-100 text-amber-900 font-bold px-2 py-0.5 rounded border border-amber-300">
                        Subtracted from Advance
                      </span>
                    </div>

                    <div className="relative">
                      <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 text-sm font-bold pointer-events-none">₹</span>
                      <input
                        id="adminSalaryDeduct"
                        type="number"
                        min="0"
                        max={maxDeduct}
                        disabled={creditSalaryLoading}
                        value={creditSalaryDeduction}
                        onChange={(e) => setCreditSalaryDeduction(e.target.value)}
                        placeholder="0"
                        className="block w-full rounded-lg border border-amber-300 pl-8 pr-3 py-2 text-slate-950 text-sm font-bold bg-white focus:ring-2 focus:ring-amber-500 min-h-[42px]"
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      <button
                        type="button"
                        onClick={() => setCreditSalaryDeduction('0')}
                        className="text-xs px-2 py-1 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors"
                      >
                        Deduct ₹0
                      </button>
                      {workerAdv > 0 && salNum > 0 && (
                        <>
                          <button
                            type="button"
                            onClick={() => setCreditSalaryDeduction(String(maxDeduct))}
                            className="text-xs px-2 py-1 rounded border border-amber-300 bg-amber-100 text-amber-900 font-bold hover:bg-amber-200 transition-colors"
                          >
                            Deduct Max ({formatINR(maxDeduct)})
                          </button>
                          {maxDeduct > 1000 && (
                            <button
                              type="button"
                              onClick={() => setCreditSalaryDeduction(String(Math.round(maxDeduct / 2)))}
                              className="text-xs px-2 py-1 rounded border border-amber-200 bg-white text-amber-900 font-medium hover:bg-amber-50 transition-colors"
                            >
                              Deduct Half ({formatINR(Math.round(maxDeduct / 2))})
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Live Preview Breakdown */}
              {(() => {
                const target = creditSalaryWorker || localWorkers.find(w => w.worker_id === creditSalaryWorkerId);
                const salNum = parseFloat(creditSalaryAmount) || 0;
                const deductNum = Math.max(0, parseFloat(creditSalaryDeduction) || 0);
                const curAdv = target?.running_advance || 0;

                if (salNum <= 0) return null;

                const netAdded = Math.max(0, salNum - deductNum);
                const remainingAdv = Math.max(0, curAdv - deductNum);

                return (
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 space-y-1 text-xs">
                    <div className="flex justify-between items-center text-slate-700">
                      <span>Gross Salary Added:</span>
                      <span className="font-bold text-slate-900">+{formatINR(salNum)}</span>
                    </div>
                    {curAdv > 0 && (
                      <div className="flex justify-between items-center text-amber-800">
                        <span>Advance Deducted:</span>
                        <span className="font-bold">-{formatINR(deductNum)}</span>
                      </div>
                    )}
                    <div className="border-t border-slate-200 pt-1 flex justify-between items-center">
                      <span className="font-semibold text-slate-800">Net Added to Unpaid Salary:</span>
                      <span className="font-bold text-emerald-700">+{formatINR(netAdded)}</span>
                    </div>
                    {curAdv > 0 && (
                      <div className="flex justify-between items-center text-[11px] text-slate-600">
                        <span>Remaining Advance Owed:</span>
                        <span className="font-bold text-slate-900">{formatINR(remainingAdv)}</span>
                      </div>
                    )}
                  </div>
                );
              })()}

              <div>
                <label htmlFor="adminCreditSalaryMonth" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Period / Month (Optional)
                </label>
                <input
                  id="adminCreditSalaryMonth"
                  type="text"
                  disabled={creditSalaryLoading}
                  value={creditSalaryMonth}
                  onChange={(e) => setCreditSalaryMonth(e.target.value)}
                  placeholder="e.g. October 2026"
                  className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-950 text-xs min-h-[40px]"
                />
              </div>

              <div>
                <label htmlFor="adminCreditSalaryNote" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Notes / Remarks (Optional)
                </label>
                <input
                  id="adminCreditSalaryNote"
                  type="text"
                  disabled={creditSalaryLoading}
                  value={creditSalaryNote}
                  onChange={(e) => setCreditSalaryNote(e.target.value)}
                  placeholder="e.g. Monthly wage accrual"
                  className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-950 text-xs min-h-[40px]"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                disabled={creditSalaryLoading}
                onClick={() => { setShowCreditSalaryModal(false); setCreditSalaryWorker(null); setCreditSalaryError(''); }}
                className="flex-1 py-2 px-3 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 min-h-[40px]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={creditSalaryLoading || !creditSalaryAmount || parseFloat(creditSalaryAmount) <= 0}
                onClick={handleExecuteCreditSalary}
                className="flex-1 py-2 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold min-h-[40px] flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50"
              >
                {creditSalaryLoading ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <span>
                    Credit Salary
                    {parseFloat(creditSalaryDeduction) > 0 ? ` & Deduct ${formatINR(parseFloat(creditSalaryDeduction))}` : ''}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch Monthly Salary Accrual Modal */}
      {showBatchSalaryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700">
                  <Building2 className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                    Batch Credit Monthly Wages
                  </h3>
                  <span className="text-[10px] text-slate-500">Accrues fixed monthly wage for all active workers</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setShowBatchSalaryModal(false); setBatchSalaryError(''); setBatchSalarySuccess(''); }}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {batchSalarySuccess && (
              <div className="rounded-lg bg-emerald-50 p-2.5 text-xs text-emerald-800 border border-emerald-200">
                {batchSalarySuccess}
              </div>
            )}

            {batchSalaryError && (
              <div className="rounded-lg bg-red-50 p-2.5 text-xs text-red-700 border border-red-200">
                {batchSalaryError}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Target Factory
                </label>
                <select
                  value={batchSalaryFactoryId}
                  onChange={(e) => setBatchSalaryFactoryId(e.target.value)}
                  className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 text-xs min-h-[40px] bg-white"
                >
                  <option value="all">All Factories (All Workers with Monthly Wage)</option>
                  {factories.map(f => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="batchSalaryMonth" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Payroll Month / Period
                </label>
                <input
                  id="batchSalaryMonth"
                  type="text"
                  disabled={batchSalaryLoading}
                  value={batchSalaryMonth}
                  onChange={(e) => setBatchSalaryMonth(e.target.value)}
                  placeholder="e.g. October 2026"
                  className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-950 text-xs min-h-[40px]"
                />
              </div>

              <div>
                <label htmlFor="batchSalaryNote" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Remarks / Note
                </label>
                <input
                  id="batchSalaryNote"
                  type="text"
                  disabled={batchSalaryLoading}
                  value={batchSalaryNote}
                  onChange={(e) => setBatchSalaryNote(e.target.value)}
                  placeholder="e.g. Regular monthly wages accrual"
                  className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-950 text-xs min-h-[40px]"
                />
              </div>
            </div>

            <p className="text-[10px] text-slate-500 bg-slate-50 p-2 rounded border border-slate-100">
              Only workers who have a registered monthly wage rate (&gt; ₹0) will receive an accrual. Workers with ₹0 rate will be skipped safely.
            </p>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                disabled={batchSalaryLoading}
                onClick={() => { setShowBatchSalaryModal(false); setBatchSalaryError(''); }}
                className="flex-1 py-2 px-3 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 min-h-[40px]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={batchSalaryLoading}
                onClick={handleExecuteBatchSalary}
                className="flex-1 py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold min-h-[40px] flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50"
              >
                {batchSalaryLoading ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <span>Run Accrual</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settle Advance from Salary Modal */}
      {showSettleAdvanceModal && settleAdvanceWorker && (
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
                  <span className="text-[10px] text-slate-500">Internal adjustment • ₹0 physical cash movement</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setShowSettleAdvanceModal(false); setSettleAdvanceWorker(null); setSettleAdvanceError(''); }}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="bg-slate-50 border border-slate-100 rounded-lg p-3 text-xs space-y-1.5">
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Worker:</span>
                <span className="font-bold text-slate-900">{settleAdvanceWorker.worker_name}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Accumulated Unpaid Salary:</span>
                <span className="font-bold text-emerald-700">{formatINR(settleAdvanceWorker.unpaid_salary || 0)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Outstanding Advance Owed:</span>
                <span className="font-bold text-amber-700">{formatINR(settleAdvanceWorker.running_advance || 0)}</span>
              </div>
            </div>

            {settleAdvanceError && (
              <div className="rounded-lg bg-red-50 p-2.5 text-xs text-red-700 border border-red-200">
                {settleAdvanceError}
              </div>
            )}

            <div>
              <label htmlFor="adminSettleAmount" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                Amount to Deduct from Salary (INR) <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 text-sm font-bold pointer-events-none">₹</span>
                <input
                  id="adminSettleAmount"
                  type="number"
                  min="1"
                  max={Math.min(settleAdvanceWorker.unpaid_salary || 0, settleAdvanceWorker.running_advance || 0)}
                  disabled={settleAdvanceLoading}
                  value={settleAdvanceAmount}
                  onChange={(e) => setSettleAdvanceAmount(e.target.value)}
                  placeholder="0"
                  className="block w-full rounded-lg border border-slate-300 pl-8 pr-3 py-2 text-slate-950 text-sm font-bold focus:ring-2 focus:ring-blue-600 min-h-[44px]"
                />
              </div>
              <p className="text-[10px] text-slate-400 mt-1">
                Max allowable deduction: {formatINR(Math.min(settleAdvanceWorker.unpaid_salary || 0, settleAdvanceWorker.running_advance || 0))}
              </p>
            </div>

            <div>
              <label htmlFor="adminSettleNote" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                Note / Remarks (Optional)
              </label>
              <input
                id="adminSettleNote"
                type="text"
                disabled={settleAdvanceLoading}
                value={settleAdvanceNote}
                onChange={(e) => setSettleAdvanceNote(e.target.value)}
                placeholder="e.g. Salary advance recovery deduction"
                className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-950 text-xs min-h-[40px]"
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                disabled={settleAdvanceLoading}
                onClick={() => { setShowSettleAdvanceModal(false); setSettleAdvanceWorker(null); setSettleAdvanceError(''); }}
                className="flex-1 py-2 px-3 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 min-h-[40px]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={settleAdvanceLoading || !settleAdvanceAmount || parseFloat(settleAdvanceAmount) <= 0}
                onClick={handleExecuteSettleAdvance}
                className="flex-1 py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold min-h-[40px] flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50"
              >
                {settleAdvanceLoading ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <span>Settle Advance</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reclassify Kharcha Modal */}
      {showReclassifyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full bg-amber-100 flex items-center justify-center text-amber-700">
                  <Zap className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                    Fix Legacy Kharcha Records
                  </h3>
                  <span className="text-[10px] text-slate-500">1-Click Historical Reclassification</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setShowReclassifyModal(false); setReclassifySuccess(null); }}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {reclassifySuccess ? (
              <div className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800 border border-emerald-200 space-y-1">
                <div className="flex items-center gap-1.5 font-bold">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>Reclassification Complete!</span>
                </div>
                <p>Converted {reclassifySuccess.count} disbursements (Total: {formatINR(reclassifySuccess.totalAmount)}) from advances to salary payments.</p>
              </div>
            ) : (
              <div className="space-y-3 text-xs text-slate-600">
                <p>
                  In the past, regular weekly wages or living allowances entered with notes like <strong>"Kharcha"</strong>, <strong>"Hafta"</strong>, or <strong>"Weekly"</strong> were mistakenly recorded as worker advances.
                </p>
                <div className="bg-amber-50 p-3 rounded-lg border border-amber-200 space-y-1 text-amber-900 text-[11px]">
                  <p className="font-bold">What this tool does:</p>
                  <ul className="list-disc pl-4 space-y-0.5">
                    <li>Finds all past transactions with wage keywords.</li>
                    <li>Reclassifies them as <strong>Salary Payments</strong> instead of Advances.</li>
                    <li>Instantly removes the artificial advance debt from workers.</li>
                  </ul>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                disabled={reclassifyLoading}
                onClick={() => { setShowReclassifyModal(false); setReclassifySuccess(null); }}
                className="flex-1 py-2 px-3 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 min-h-[40px]"
              >
                Close
              </button>
              {!reclassifySuccess && (
                <button
                  type="button"
                  disabled={reclassifyLoading}
                  onClick={handleExecuteReclassifyKharcha}
                  className="flex-1 py-2 px-3 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold min-h-[40px] flex items-center justify-center gap-1.5 shadow-sm"
                >
                  {reclassifyLoading ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <span>Convert Now</span>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Success Banner for Phone Edit */}
      {phoneEditSuccess && (
        <div className="fixed bottom-5 right-5 z-50 rounded-lg bg-emerald-600 px-4 py-3 text-white text-xs font-bold shadow-lg flex items-center gap-2 animate-in slide-in-from-bottom duration-200">
          <Phone className="h-4 w-4" />
          <span>{phoneEditSuccess}</span>
        </div>
      )}
    </div>
  );
}
