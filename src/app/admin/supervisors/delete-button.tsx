'use client';

import React, { useState } from 'react';
import { deleteSupervisor } from '@/app/actions/admin';
import { Trash2, RefreshCw } from 'lucide-react';

interface DeleteSupervisorButtonProps {
  id: string;
}

export function DeleteSupervisorButton({ id }: DeleteSupervisorButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    if (confirm('Are you sure you want to delete this supervisor? This will permanently delete their credentials if they have no transaction history.')) {
      setLoading(true);
      const result = await deleteSupervisor(id);
      if (result && result.error) {
        alert(result.error);
      } else if (result && result.warning) {
        alert(result.warning);
      } else {
        alert('Supervisor deleted successfully.');
      }
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleDelete}
      disabled={loading}
      className="inline-flex items-center justify-center rounded border border-red-200 bg-red-50 hover:bg-red-100 text-red-600 p-2 min-h-[36px] min-w-[36px] disabled:opacity-50"
      title="Delete Supervisor"
    >
      {loading ? (
        <RefreshCw className="h-4 w-4 animate-spin" />
      ) : (
        <Trash2 className="h-4 w-4" />
      )}
    </button>
  );
}
