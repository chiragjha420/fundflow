'use client';

import React, { useState, useRef, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { 
  Building2, 
  Coins, 
  Search, 
  Save, 
  RotateCcw, 
  Check, 
  AlertCircle, 
  Clipboard, 
  ArrowLeft, 
  IndianRupee, 
  Download, 
  Sparkles,
  Info,
  X
} from 'lucide-react';
import { formatINR } from '@/lib/utils';
import { 
  bulkUpdateOpeningAdvancesAction, 
  BulkWorkerOpeningAdvanceUpdate 
} from '@/app/actions/workers';

interface Factory {
  id: string;
  name: string;
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

interface OpeningAdvancesClientProps {
  factories: Factory[];
  initialWorkers: WorkerBalance[];
}

export function OpeningAdvancesClient({
  factories,
  initialWorkers,
}: OpeningAdvancesClientProps) {
  const searchParams = useSearchParams();
  const urlFactoryId = searchParams.get('factory');

  // Selected factory state (defaults to URL param, or first factory)
  const defaultFactoryId = (urlFactoryId && factories.some(f => f.id === urlFactoryId))
    ? urlFactoryId
    : (factories[0]?.id || '');

  const [selectedFactoryId, setSelectedFactoryId] = useState<string>(defaultFactoryId);
  const [workers, setWorkers] = useState<WorkerBalance[]>(initialWorkers);
  const [localValues, setLocalValues] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'with-advance' | 'zero-advance'>('all');
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Quick Paste from Excel / Clipboard modal state
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pasteContent, setPasteContent] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);

  // Input element refs for keyboard arrow / Enter navigation
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Active factory details
  const activeFactory = factories.find(f => f.id === selectedFactoryId);

  // Workers belonging to currently selected factory
  const factoryWorkers = useMemo(() => {
    return workers
      .filter(w => w.factory_id === selectedFactoryId)
      .sort((a, b) => a.worker_name.localeCompare(b.worker_name));
  }, [workers, selectedFactoryId]);

  // Filtered workers by search query and filter pills
  const filteredWorkers = useMemo(() => {
    return factoryWorkers.filter(w => {
      // 1. Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = w.worker_name.toLowerCase().includes(q);
        const matchesPhone = w.worker_phone && w.worker_phone.includes(q);
        if (!matchesName && !matchesPhone) return false;
      }

      // 2. Advance filter
      const currentVal = localValues[w.worker_id] !== undefined
        ? Number(localValues[w.worker_id]) || 0
        : w.opening_advance;

      if (filterMode === 'with-advance' && currentVal <= 0) return false;
      if (filterMode === 'zero-advance' && currentVal > 0) return false;

      return true;
    });
  }, [factoryWorkers, searchQuery, filterMode, localValues]);

  // Compute dirty (modified) workers across the current factory
  const dirtyUpdates = useMemo(() => {
    const updates: BulkWorkerOpeningAdvanceUpdate[] = [];
    for (const w of factoryWorkers) {
      if (localValues[w.worker_id] !== undefined) {
        const parsed = Math.max(0, Math.round(Number(localValues[w.worker_id]) || 0));
        if (parsed !== w.opening_advance) {
          updates.push({
            workerId: w.worker_id,
            openingAdvance: parsed,
          });
        }
      }
    }
    return updates;
  }, [factoryWorkers, localValues]);

  const hasUnsavedChanges = dirtyUpdates.length > 0;

  // Stats for the active factory
  const factoryStats = useMemo(() => {
    let totalOpening = 0;
    let totalRunning = 0;
    let countWithAdvance = 0;

    for (const w of factoryWorkers) {
      const opening = localValues[w.worker_id] !== undefined
        ? Math.max(0, Math.round(Number(localValues[w.worker_id]) || 0))
        : w.opening_advance;

      totalOpening += opening;
      totalRunning += opening + (w.total_cash_disbursed || 0);
      if (opening > 0) countWithAdvance++;
    }

    return {
      totalWorkers: factoryWorkers.length,
      countWithAdvance,
      totalOpening,
      totalRunning,
    };
  }, [factoryWorkers, localValues]);

  // Handle switching factory tab
  const handleSelectFactory = (factoryId: string) => {
    if (factoryId === selectedFactoryId) return;
    if (hasUnsavedChanges) {
      const confirmSwitch = window.confirm(
        `You have ${dirtyUpdates.length} unsaved changes in ${activeFactory?.name || 'this factory'}. Switch anyway and discard unsaved edits?`
      );
      if (!confirmSwitch) return;
    }
    // Clear local dirty values for previous factory
    setLocalValues({});
    setSearchQuery('');
    setSaveMessage(null);
    setSelectedFactoryId(factoryId);
  };

  // Handle individual opening advance input change
  const handleInputChange = (workerId: string, val: string) => {
    setLocalValues(prev => ({
      ...prev,
      [workerId]: val,
    }));
    if (saveMessage) setSaveMessage(null);
  };

  // Keyboard navigation: Enter or Down Arrow moves to next; Up Arrow moves to previous
  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    index: number,
    list: WorkerBalance[]
  ) => {
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next = list[index + 1];
      if (next && inputRefs.current[next.worker_id]) {
        inputRefs.current[next.worker_id]?.focus();
        inputRefs.current[next.worker_id]?.select();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = list[index - 1];
      if (prev && inputRefs.current[prev.worker_id]) {
        inputRefs.current[prev.worker_id]?.focus();
        inputRefs.current[prev.worker_id]?.select();
      }
    }
  };

  // Reset all unsaved modifications for the current factory
  const handleReset = () => {
    setLocalValues({});
    setSaveMessage(null);
  };

  // Quick fill all workers with 0
  const handleZeroOutAll = () => {
    const confirm = window.confirm(
      `Set opening advance to ₹0 for all ${factoryWorkers.length} workers in ${activeFactory?.name}?`
    );
    if (!confirm) return;

    const newValues: Record<string, string> = { ...localValues };
    for (const w of factoryWorkers) {
      newValues[w.worker_id] = '0';
    }
    setLocalValues(newValues);
  };

  // Save all modified opening advances to database
  const handleSaveAll = async () => {
    if (dirtyUpdates.length === 0) return;
    setIsSaving(true);
    setSaveMessage(null);

    try {
      const res = await bulkUpdateOpeningAdvancesAction(dirtyUpdates);
      if (!res.success) {
        throw new Error(res.error || 'Failed to update opening advances.');
      }

      // Optimistically update local workers state
      const updateMap = new Map<string, number>();
      for (const item of dirtyUpdates) {
        updateMap.set(item.workerId, item.openingAdvance);
      }

      setWorkers(prev =>
        prev.map(w => {
          if (updateMap.has(w.worker_id)) {
            const newOpening = updateMap.get(w.worker_id)!;
            return {
              ...w,
              opening_advance: newOpening,
              running_advance: newOpening + (w.total_cash_disbursed || 0),
            };
          }
          return w;
        })
      );

      // Clear local dirty edits for saved workers
      setLocalValues({});
      setSaveMessage({
        type: 'success',
        text: `Successfully saved opening advances for ${dirtyUpdates.length} worker(s) in ${activeFactory?.name || 'factory'}!`,
      });
    } catch (err: any) {
      console.error('Error in handleSaveAll:', err);
      setSaveMessage({
        type: 'error',
        text: err.message || 'An error occurred while saving advances.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Process pasted Excel/CSV data
  const handleApplyPaste = () => {
    setPasteError(null);
    if (!pasteContent.trim()) {
      setPasteError('Please paste some data first.');
      return;
    }

    const lines = pasteContent
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      setPasteError('No valid lines found in pasted text.');
      return;
    }

    const newValues: Record<string, string> = { ...localValues };
    let matchedCount = 0;

    // Check if the lines contain delimiter (comma, tab, semicolon) e.g., "Worker Name \t 5000"
    const hasDelimiter = lines.some(l => l.includes('\t') || l.includes(',') || l.includes(';'));

    if (hasDelimiter) {
      // Name-based matching
      const workerByName = new Map<string, WorkerBalance>();
      for (const w of factoryWorkers) {
        workerByName.set(w.worker_name.toLowerCase().trim(), w);
      }

      for (const line of lines) {
        const parts = line.split(/[\t,;]+/).map(p => p.trim());
        if (parts.length >= 2) {
          const namePart = parts[0].toLowerCase();
          const amountPart = parts[1].replace(/[^\d.]/g, '');
          const amount = Math.max(0, Math.round(Number(amountPart) || 0));

          // Try exact match or fuzzy contains
          let targetWorker = workerByName.get(namePart);
          if (!targetWorker) {
            targetWorker = factoryWorkers.find(w => 
              w.worker_name.toLowerCase().includes(namePart) || 
              namePart.includes(w.worker_name.toLowerCase())
            );
          }

          if (targetWorker) {
            newValues[targetWorker.worker_id] = String(amount);
            matchedCount++;
          }
        }
      }
    } else {
      // Sequential assignment to workers currently in view
      const targetList = filteredWorkers.length > 0 ? filteredWorkers : factoryWorkers;
      const count = Math.min(lines.length, targetList.length);

      for (let i = 0; i < count; i++) {
        const cleanAmount = lines[i].replace(/[^\d.]/g, '');
        const amount = Math.max(0, Math.round(Number(cleanAmount) || 0));
        const worker = targetList[i];
        if (worker) {
          newValues[worker.worker_id] = String(amount);
          matchedCount++;
        }
      }
    }

    if (matchedCount === 0) {
      setPasteError('Could not match any rows. Ensure you paste a column of numbers or "Name, Amount".');
      return;
    }

    setLocalValues(newValues);
    setShowPasteModal(false);
    setPasteContent('');
    setSaveMessage({
      type: 'success',
      text: `Applied pasted amounts to ${matchedCount} workers! Review the values below and click "Save All Changes".`,
    });
  };

  return (
    <div className="space-y-6 pb-20">
      {/* Top Breadcrumb & Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
            <Link 
              href="/admin" 
              className="inline-flex items-center gap-1 hover:text-slate-900 font-semibold"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Admin Dashboard</span>
            </Link>
            <span>/</span>
            <span className="text-slate-800 font-bold">Worker Opening Advances</span>
          </div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900 flex items-center gap-2">
            <Coins className="h-6 w-6 text-emerald-600" />
            <span>Set Worker Opening Advances</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Bulk-configure historical opening balances for every worker factory-wise at once.
          </p>
        </div>

        {/* Global Save / Discard Actions (Desktop Top) */}
        <div className="flex items-center gap-2.5">
          {hasUnsavedChanges && (
            <button
              onClick={handleReset}
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-xs transition-colors min-h-[40px]"
            >
              <RotateCcw className="h-3.5 w-3.5 text-slate-500" />
              <span>Reset</span>
            </button>
          )}

          <button
            onClick={() => setShowPasteModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-xs transition-colors min-h-[40px]"
          >
            <Clipboard className="h-3.5 w-3.5 text-indigo-600" />
            <span>Paste from Excel</span>
          </button>

          <button
            onClick={handleSaveAll}
            disabled={!hasUnsavedChanges || isSaving}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-black text-white shadow-sm transition-all min-h-[40px] ${
              hasUnsavedChanges
                ? 'bg-emerald-600 hover:bg-emerald-700 ring-2 ring-emerald-500/20 shadow-emerald-600/20'
                : 'bg-slate-400 cursor-not-allowed opacity-70'
            }`}
          >
            <Save className="h-4 w-4" />
            <span>
              {isSaving
                ? 'Saving Changes...'
                : hasUnsavedChanges
                ? `Save ${dirtyUpdates.length} Change${dirtyUpdates.length > 1 ? 's' : ''}`
                : 'All Saved'}
            </span>
          </button>
        </div>
      </div>

      {/* Notifications / Alerts */}
      {saveMessage && (
        <div
          className={`p-4 rounded-lg flex items-center justify-between text-xs font-bold ${
            saveMessage.type === 'success'
              ? 'bg-emerald-50 border border-emerald-200 text-emerald-900'
              : 'bg-red-50 border border-red-200 text-red-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {saveMessage.type === 'success' ? (
              <Check className="h-4 w-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
            )}
            <span>{saveMessage.text}</span>
          </div>
          <button
            onClick={() => setSaveMessage(null)}
            className="text-slate-400 hover:text-slate-600 p-1"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Factory Selection Tabs */}
      <div className="bg-white border border-slate-200 rounded-lg p-2 shadow-xs">
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-3 py-1 flex items-center gap-1.5">
          <Building2 className="h-3.5 w-3.5" />
          <span>Select Factory</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-1">
          {factories.map(f => {
            const isSelected = f.id === selectedFactoryId;
            const count = workers.filter(w => w.factory_id === f.id).length;
            return (
              <button
                key={f.id}
                onClick={() => handleSelectFactory(f.id)}
                className={`flex flex-col items-start px-3.5 py-2.5 rounded-lg border text-left transition-all ${
                  isSelected
                    ? 'bg-slate-900 border-slate-900 text-white shadow-xs'
                    : 'bg-white border-slate-200 text-slate-800 hover:bg-slate-50'
                }`}
              >
                <span className="text-xs font-black truncate w-full tracking-tight">
                  {f.name}
                </span>
                <span
                  className={`text-[10px] font-semibold mt-0.5 ${
                    isSelected ? 'text-slate-300' : 'text-slate-500'
                  }`}
                >
                  {count} workers
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Factory KPI Statistics Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-200 rounded-lg p-3.5 shadow-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
            Factory Workers
          </span>
          <span className="text-lg font-black text-slate-900 mt-0.5 block">
            {factoryStats.totalWorkers}
          </span>
          <span className="text-[10px] text-slate-400">Total in this unit</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-3.5 shadow-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
            Configured Advances
          </span>
          <span className="text-lg font-black text-indigo-600 mt-0.5 block">
            {factoryStats.countWithAdvance} / {factoryStats.totalWorkers}
          </span>
          <span className="text-[10px] text-slate-400">
            {Math.round((factoryStats.countWithAdvance / (factoryStats.totalWorkers || 1)) * 100)}% with old advance
          </span>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-3.5 shadow-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
            Total Opening Advance
          </span>
          <span className="text-lg font-black text-emerald-600 mt-0.5 block">
            {formatINR(factoryStats.totalOpening)}
          </span>
          <span className="text-[10px] text-slate-400">Combined base sum</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-3.5 shadow-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
            Effective Total Advance
          </span>
          <span className="text-lg font-black text-slate-900 mt-0.5 block">
            {formatINR(factoryStats.totalRunning)}
          </span>
          <span className="text-[10px] text-slate-400">Opening + Cash payouts</span>
        </div>
      </div>

      {/* Main Table Card with Search & Filters */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
        {/* Table Toolbar */}
        <div className="p-4 border-b border-slate-200 bg-slate-50/70 flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Search Box */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search worker by name or phone..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900 bg-white min-h-[38px]"
            />
          </div>

          {/* Filter Pills & Quick Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-bold shadow-xs">
              <button
                onClick={() => setFilterMode('all')}
                className={`px-3 py-1.5 rounded-md transition-all ${
                  filterMode === 'all'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All ({factoryWorkers.length})
              </button>
              <button
                onClick={() => setFilterMode('with-advance')}
                className={`px-3 py-1.5 rounded-md transition-all ${
                  filterMode === 'with-advance'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                With Advance ({factoryStats.countWithAdvance})
              </button>
              <button
                onClick={() => setFilterMode('zero-advance')}
                className={`px-3 py-1.5 rounded-md transition-all ${
                  filterMode === 'zero-advance'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                ₹0 ({factoryWorkers.length - factoryStats.countWithAdvance})
              </button>
            </div>

            <button
              onClick={handleZeroOutAll}
              className="text-[11px] font-bold text-slate-600 hover:text-red-600 px-2.5 py-1.5 rounded border border-slate-200 bg-white hover:bg-red-50 transition-colors"
            >
              Set All to ₹0
            </button>
          </div>
        </div>

        {/* Keyboard navigation tip */}
        <div className="px-4 py-2 bg-indigo-50/50 border-b border-indigo-100 flex items-center justify-between text-[11px] text-indigo-900">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
            <span>
              <strong>Tip:</strong> Press <strong>Enter</strong> or <strong>↓</strong> to jump to the next worker's advance, or <strong>↑</strong> to go back.
            </span>
          </div>
          {hasUnsavedChanges && (
            <span className="font-extrabold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full text-[10px]">
              ⚡ {dirtyUpdates.length} worker{dirtyUpdates.length > 1 ? 's' : ''} modified (Unsaved)
            </span>
          )}
        </div>

        {/* Worker List or Table */}
        {filteredWorkers.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-xs">
            No workers match your search or filter.
          </div>
        ) : (
          <>
            {/* Mobile Worker Cards (Zero Horizontal Scroll) */}
            <div className="md:hidden divide-y divide-slate-100 bg-white">
              {filteredWorkers.map((w, idx) => {
                const localVal = localValues[w.worker_id];
                const currentOpening = localVal !== undefined
                  ? Math.max(0, Math.round(Number(localVal) || 0))
                  : w.opening_advance;
                const isDirty = localVal !== undefined && currentOpening !== w.opening_advance;
                const runningTotal = currentOpening + (w.total_cash_disbursed || 0);

                return (
                  <div
                    key={w.worker_id}
                    className={`p-3.5 space-y-2.5 transition-colors ${
                      isDirty ? 'bg-amber-50/40' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <span className="text-[10px] font-bold text-slate-400 w-5">#{idx + 1}</span>
                        {w.worker_photo_url ? (
                          <img
                            src={w.worker_photo_url}
                            alt={w.worker_name}
                            className="h-8 w-8 rounded-full object-cover border border-slate-200 shrink-0"
                          />
                        ) : (
                          <div className="h-8 w-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 font-bold text-xs shrink-0">
                            {w.worker_name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div>
                          <span className="font-extrabold text-slate-900 block text-xs">
                            {w.worker_name}
                          </span>
                          {w.worker_phone && (
                            <span className="text-[10px] text-slate-500 block">
                              📱 {w.worker_phone}
                            </span>
                          )}
                        </div>
                      </div>

                      <div>
                        {isDirty ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                            Edited
                          </span>
                        ) : currentOpening > 0 ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-100 text-emerald-800">
                            Active
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-300 font-semibold">
                            ₹0
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 p-2.5 rounded-lg border border-slate-100 items-center">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                          Opening Advance
                        </label>
                        <div className="relative flex items-center w-full">
                          <IndianRupee className="absolute left-2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                          <input
                            ref={el => { inputRefs.current[w.worker_id] = el; }}
                            type="number"
                            min="0"
                            step="1"
                            value={localVal !== undefined ? localVal : (w.opening_advance || 0)}
                            onChange={e => handleInputChange(w.worker_id, e.target.value)}
                            onKeyDown={e => handleKeyDown(e, idx, filteredWorkers)}
                            onFocus={e => e.target.select()}
                            className={`w-full pl-6 pr-2 py-1.5 text-right font-black rounded-lg text-xs transition-all ${
                              isDirty
                                ? 'bg-amber-50 border-2 border-amber-500 text-amber-950 focus:ring-amber-500 shadow-xs'
                                : currentOpening > 0
                                ? 'bg-emerald-50/50 border border-emerald-300 text-emerald-950 focus:ring-emerald-500'
                                : 'bg-white border border-slate-300 text-slate-900 focus:ring-slate-900'
                            }`}
                          />
                        </div>
                      </div>

                      <div className="text-right space-y-0.5 pl-2 border-l border-slate-200">
                        <div className="text-[11px] text-slate-500">
                          Disbursed: <span className="font-semibold text-slate-700">{formatINR(w.total_cash_disbursed || 0)}</span>
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Total: <span className="font-black text-indigo-700">{formatINR(runningTotal)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="px-4 py-3 w-12 text-center">#</th>
                    <th className="px-4 py-3">Worker Name</th>
                    <th className="px-4 py-3">Phone</th>
                    <th className="px-4 py-3 w-48 text-right">Opening Advance (₹)</th>
                    <th className="px-4 py-3 text-right">Cash Disbursed</th>
                    <th className="px-4 py-3 text-right">Total Advance</th>
                    <th className="px-4 py-3 w-24 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filteredWorkers.map((w, idx) => {
                    const localVal = localValues[w.worker_id];
                    const currentOpening = localVal !== undefined
                      ? Math.max(0, Math.round(Number(localVal) || 0))
                      : w.opening_advance;
                    const isDirty = localVal !== undefined && currentOpening !== w.opening_advance;
                    const runningTotal = currentOpening + (w.total_cash_disbursed || 0);

                    return (
                      <tr
                        key={w.worker_id}
                        className={`hover:bg-slate-50/80 transition-colors ${
                          isDirty ? 'bg-amber-50/40' : ''
                        }`}
                      >
                        {/* Row Index */}
                        <td className="px-4 py-2.5 text-center font-bold text-slate-400 text-[11px]">
                          {idx + 1}
                        </td>

                        {/* Worker Name & Photo */}
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2.5">
                            {w.worker_photo_url ? (
                              <img
                                src={w.worker_photo_url}
                                alt={w.worker_name}
                                className="h-8 w-8 rounded-full object-cover border border-slate-200 shrink-0"
                              />
                            ) : (
                              <div className="h-8 w-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 font-bold text-xs shrink-0">
                                {w.worker_name.charAt(0).toUpperCase()}
                              </div>
                            )}
                            <div>
                              <span className="font-extrabold text-slate-900 block text-xs">
                                {w.worker_name}
                              </span>
                              <span className="text-[10px] text-slate-400 block">
                                ID: {w.worker_id.slice(0, 8)}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Phone */}
                        <td className="px-4 py-2.5 text-slate-600 font-medium">
                          {w.worker_phone || (
                            <span className="text-slate-300 italic">No phone</span>
                          )}
                        </td>

                        {/* Opening Advance Input (Fast Excel-like edit) */}
                        <td className="px-4 py-2.5 text-right">
                          <div className="relative inline-flex items-center justify-end w-40">
                            <IndianRupee className="absolute left-2.5 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                            <input
                              ref={el => { inputRefs.current[w.worker_id] = el; }}
                              type="number"
                              min="0"
                              step="1"
                              value={localVal !== undefined ? localVal : (w.opening_advance || 0)}
                              onChange={e => handleInputChange(w.worker_id, e.target.value)}
                              onKeyDown={e => handleKeyDown(e, idx, filteredWorkers)}
                              onFocus={e => e.target.select()}
                              className={`w-full pl-8 pr-2.5 py-1.5 text-right font-black rounded-lg text-xs transition-all ${
                                isDirty
                                  ? 'bg-amber-50 border-2 border-amber-500 text-amber-950 focus:ring-amber-500 shadow-xs'
                                  : currentOpening > 0
                                  ? 'bg-emerald-50/50 border border-emerald-300 text-emerald-950 focus:ring-emerald-500'
                                  : 'bg-white border border-slate-300 text-slate-900 focus:ring-slate-900'
                              }`}
                            />
                          </div>
                        </td>

                        {/* Cash Disbursed */}
                        <td className="px-4 py-2.5 text-right font-semibold text-slate-600">
                          {formatINR(w.total_cash_disbursed || 0)}
                        </td>

                        {/* Running Total Preview */}
                        <td className="px-4 py-2.5 text-right">
                          <span
                            className={`font-black text-xs ${
                              runningTotal > 0 ? 'text-indigo-700' : 'text-slate-400'
                            }`}
                          >
                            {formatINR(runningTotal)}
                          </span>
                        </td>

                        {/* Status Badge */}
                        <td className="px-4 py-2.5 text-center">
                          {isDirty ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                              Edited
                            </span>
                          ) : currentOpening > 0 ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-100 text-emerald-800">
                              Active
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-300 font-semibold">
                              ₹0
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Table Footer Summary */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-semibold text-slate-600">
          <div>
            Showing {filteredWorkers.length} of {factoryWorkers.length} workers in{' '}
            <strong className="text-slate-900">{activeFactory?.name}</strong>
          </div>
          <div className="flex items-center gap-4">
            <div>
              Total Factory Opening:{' '}
              <strong className="text-emerald-700 font-black">
                {formatINR(factoryStats.totalOpening)}
              </strong>
            </div>
            <div>
              Total Running Advance:{' '}
              <strong className="text-indigo-700 font-black">
                {formatINR(factoryStats.totalRunning)}
              </strong>
            </div>
          </div>
        </div>
      </div>

      {/* Floating Bottom Action Bar (When unsaved changes exist) */}
      {hasUnsavedChanges && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-slate-900 text-white px-5 py-3 rounded-xl shadow-2xl flex items-center gap-4 border border-slate-700 animate-in fade-in slide-in-from-bottom-3 duration-200">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-xs font-bold">
              {dirtyUpdates.length} worker{dirtyUpdates.length > 1 ? 's' : ''} modified in{' '}
              {activeFactory?.name}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleReset}
              disabled={isSaving}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
            >
              Discard
            </button>
            <button
              onClick={handleSaveAll}
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-black bg-emerald-500 hover:bg-emerald-600 text-slate-950 transition-colors shadow-sm"
            >
              <Save className="h-3.5 w-3.5" />
              <span>{isSaving ? 'Saving...' : 'Save All Changes'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Paste from Excel / Clipboard Modal */}
      {showPasteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-lg w-full p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Clipboard className="h-5 w-5 text-indigo-600" />
                  <span>Paste Amounts from Excel</span>
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Copy a single column of numbers from your Excel register, or copy two columns (<strong>Name, Amount</strong>).
                </p>
              </div>
              <button
                onClick={() => { setShowPasteModal(false); setPasteError(null); }}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 block">
                Paste clipboard text here:
              </label>
              <textarea
                rows={8}
                value={pasteContent}
                onChange={e => setPasteContent(e.target.value)}
                placeholder={`Example single column:\n5000\n2500\n10000\n0\n\nOr two columns:\nHARIOM SULTAN, 5000\nAJAY MOTA, 2500`}
                className="w-full p-3 text-xs font-mono rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900"
              />
            </div>

            {pasteError && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-800 text-xs font-semibold rounded-lg flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{pasteError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => { setShowPasteModal(false); setPasteError(null); }}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApplyPaste}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs"
              >
                Apply to Workers Table
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
