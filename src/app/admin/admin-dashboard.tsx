'use client';

import React, { useState } from 'react';
import { createOfficeDisbursement } from '@/app/actions/admin';
import { formatINR } from '@/lib/utils';
import { 
  Building2, 
  ArrowUpRight, 
  AlertTriangle, 
  Download, 
  RefreshCw, 
  Plus, 
  TrendingUp, 
  Activity,
  History
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
  to_work?: { name: string; factory_id: string } | null;
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
  const [formLoading, setFormLoading] = useState(false);

  // Filters State
  const [selectedFactoryId, setSelectedFactoryId] = useState<string>('all');
  const [selectedSupervisorId, setSelectedSupervisorId] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedPurpose, setSelectedPurpose] = useState<string>('all');

  // Handle office disbursement submission
  const handleDisbursementSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    setFormError(null);
    setFormSuccess(false);
    setFormLoading(true);

    const formData = new FormData(form);
    const result = await createOfficeDisbursement(null, formData);

    if (result && result.error) {
      setFormError(result.error);
      setFormLoading(false);
    } else {
      setFormSuccess(true);
      setFormLoading(false);
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

    // Office Sent (Total, confirmed or pending)
    const sent = transactions
      .filter(t => t.type === 'office_to_supervisor' && t.to_supervisor_id && factorySupIds.includes(t.to_supervisor_id))
      .reduce((sum, t) => sum + Number(t.amount), 0);

    // Office Confirmed
    const confirmed = transactions
      .filter(t => t.type === 'office_to_supervisor' && t.to_supervisor_id && factorySupIds.includes(t.to_supervisor_id) && t.status === 'confirmed')
      .reduce((sum, t) => sum + Number(t.amount), 0);

    // Disbursed to workers
    const disbursed = transactions
      .filter(t => t.type === 'supervisor_to_worker' && t.from_supervisor_id && factorySupIds.includes(t.from_supervisor_id) && t.status === 'confirmed')
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
        .filter(t => t.type === 'supervisor_to_worker' && t.from_supervisor_id === supId && t.status === 'confirmed')
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
    ...transactions.map(tx => {
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

    return true;
  }).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

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

  const activeSupervisors = supervisors.filter(s => s.active);

  return (
    <div className="space-y-6">
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

      {/* Grid: Disbursement Form & Cash positions */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left Column: Office Disbursement Form */}
        <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm lg:col-span-1">
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
                  disabled={formLoading}
                  placeholder="0"
                  className="block w-full rounded-md border border-slate-300 pl-7 pr-3 py-2 text-slate-950 focus:border-slate-500 focus:outline-none focus:ring-slate-500 text-sm min-h-[44px]"
                />
              </div>
            </div>

            <div>
              <label htmlFor="note" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                Note / Description
              </label>
              <textarea
                id="note"
                name="note"
                rows={2}
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
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3 mb-4">
            <Activity className="h-5 w-5 text-slate-600" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900">Workers Outstanding Advance</h2>
          </div>
          {workers.length === 0 ? (
            <div className="text-center py-6 text-sm text-slate-500">No workers configured yet</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {workers.slice(0, 5).map((w, idx) => (
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

      {/* Transaction Feed Section with Filters */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
        {/* Header and filters */}
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 space-y-4">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-slate-600" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900">Ledger Transactions Log</h2>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
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
                      <td className="px-6 py-4 text-slate-500 text-xs italic max-w-xs truncate">
                        {entry.note || '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
