'use client';

import React, { useState, useRef } from 'react';
import { createFactory } from '@/app/actions/admin';
import { RefreshCw } from 'lucide-react';

export function FactoryForm() {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const result = await createFactory(null, formData);

    if (result && result.error) {
      setError(result.error);
      setLoading(false);
    } else {
      setSuccess(true);
      formRef.current?.reset();
      setLoading(false);
      setTimeout(() => setSuccess(false), 5000);
    }
  };

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="name" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
          Factory Name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          disabled={loading}
          className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-slate-950 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-slate-500 text-sm min-h-[44px]"
        />
      </div>

      <div>
        <label htmlFor="location" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
          Location
        </label>
        <input
          id="location"
          name="location"
          type="text"
          required
          disabled={loading}
          className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-slate-950 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-slate-500 text-sm min-h-[44px]"
        />
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-3 border border-red-200">
          <p className="text-xs font-semibold text-red-800">{error}</p>
        </div>
      )}

      {success && (
        <div className="rounded-md bg-emerald-50 p-3 border border-emerald-200">
          <p className="text-xs font-semibold text-emerald-800">Factory added successfully.</p>
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full flex justify-center items-center rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50 min-h-[44px] gap-2"
      >
        {loading ? (
          <>
            <RefreshCw className="h-4 w-4 animate-spin" />
            <span>Adding...</span>
          </>
        ) : (
          <span>Add Factory</span>
        )}
      </button>
    </form>
  );
}
