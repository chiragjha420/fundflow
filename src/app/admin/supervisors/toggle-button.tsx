'use client';

import React, { useState } from 'react';
import { toggleSupervisorActive } from '@/app/actions/admin';
import { RefreshCw } from 'lucide-react';

interface ToggleSupervisorButtonProps {
  id: string;
  active: boolean;
}

export function ToggleSupervisorButton({ id, active }: ToggleSupervisorButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleToggle = async () => {
    if (confirm(`Are you sure you want to ${active ? 'deactivate' : 'activate'} this supervisor?`)) {
      setLoading(true);
      const result = await toggleSupervisorActive(id, active);
      if (result && result.error) {
        alert(result.error);
      }
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleToggle}
      disabled={loading}
      className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-semibold shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 min-h-[36px] ${
        active
          ? 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
          : 'bg-slate-900 text-white hover:bg-slate-800'
      }`}
    >
      {loading ? (
        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
      ) : active ? (
        'Deactivate'
      ) : (
        'Activate'
      )}
    </button>
  );
}
