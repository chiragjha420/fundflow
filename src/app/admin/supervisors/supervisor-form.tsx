'use client';

import React, { useState, useRef } from 'react';
import { provisionSupervisor } from '@/app/actions/admin';
import { RefreshCw } from 'lucide-react';

interface Factory {
  id: string;
  name: string;
  location: string;
  active: boolean;
}

export function SupervisorForm({ factories }: { factories: Factory[] }) {
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
    const result = await provisionSupervisor(null, formData);

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

  const activeFactories = factories.filter(f => f.active);

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="name" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
          Supervisor Name
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
        <label htmlFor="email" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
          Email Address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          disabled={loading}
          className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-slate-950 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-slate-500 text-sm min-h-[44px]"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
          Initial Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          disabled={loading}
          className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-slate-950 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-slate-500 text-sm min-h-[44px]"
        />
      </div>

      <div>
        <label htmlFor="phone" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
          Phone Number
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          required
          disabled={loading}
          className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-slate-950 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-slate-500 text-sm min-h-[44px]"
        />
      </div>

      <div>
        <label htmlFor="factoryId" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
          Assign Factory
        </label>
        <select
          id="factoryId"
          name="factoryId"
          required
          disabled={loading}
          className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-slate-950 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-slate-500 text-sm min-h-[44px]"
        >
          <option value="">Select a factory...</option>
          {activeFactories.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name} ({f.location})
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-3 border border-red-200">
          <p className="text-xs font-semibold text-red-800">{error}</p>
        </div>
      )}

      {success && (
        <div className="rounded-md bg-emerald-50 p-3 border border-emerald-200">
          <p className="text-xs font-semibold text-emerald-800">Supervisor provisioned successfully.</p>
        </div>
      )}

      <button
        type="submit"
        disabled={loading || activeFactories.length === 0}
        className="w-full flex justify-center items-center rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50 min-h-[44px] gap-2"
      >
        {loading ? (
          <>
            <RefreshCw className="h-4 w-4 animate-spin" />
            <span>Provisioning...</span>
          </>
        ) : (
          <span>Provision Supervisor</span>
        )}
      </button>
      
      {activeFactories.length === 0 && (
        <p className="text-[11px] text-slate-500 text-center">
          You must create at least one factory to provision a supervisor.
        </p>
      )}
    </form>
  );
}
