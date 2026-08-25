import React from 'react';
import { createServerClient } from '@/lib/supabase/server-client';
import { FactoryForm } from './factory-form';
import { SupervisorForm } from './supervisor-form';
import { ToggleSupervisorButton } from './toggle-button';
import { DeleteSupervisorButton } from './delete-button';

export const revalidate = 0; // Disable static caching for real-time admin view

export default async function SupervisorsAdminPage() {
  const supabase = createServerClient();

  const { data: factories } = await supabase
    .from('factories')
    .select('*')
    .order('name');

  const { data: supervisors } = await supabase
    .from('supervisors')
    .select('*, factories(name)')
    .order('name');

  return (
    <div className="space-y-8">
      {/* Page Title */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Manage Factories & Supervisors</h1>
        <p className="text-sm text-slate-500 mt-1">
          Create factories and provision secure supervisor credentials.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Left Column: Management Forms */}
        <div className="space-y-6 lg:col-span-1">
          {/* Add Factory Card */}
          <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
            <h2 className="text-base font-bold text-slate-950 mb-4">Add New Factory</h2>
            <FactoryForm />
          </div>

          {/* Provision Supervisor Card */}
          <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
            <h2 className="text-base font-bold text-slate-950 mb-4">Provision Supervisor</h2>
            <SupervisorForm factories={factories || []} />
          </div>
        </div>

        {/* Right Column: Supervisors List */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 bg-slate-50">
              <h2 className="text-sm font-bold text-slate-900">All Provisioned Supervisors</h2>
            </div>
            
            {!supervisors || supervisors.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                No supervisors provisioned yet. Create a factory first, then add a supervisor.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                  <thead className="bg-slate-50 text-slate-700 font-medium text-xs uppercase tracking-wider">
                    <tr>
                      <th className="px-6 py-3">Name</th>
                      <th className="px-6 py-3">Factory</th>
                      <th className="px-6 py-3">Phone</th>
                      <th className="px-6 py-3">Status</th>
                      <th className="px-6 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white text-slate-900">
                    {supervisors.map((sub) => (
                      <tr key={sub.id} className="hover:bg-slate-50">
                        <td className="px-6 py-4 font-semibold">{sub.name}</td>
                        <td className="px-6 py-4">{sub.factories?.name}</td>
                        <td className="px-6 py-4">{sub.phone}</td>
                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                              sub.active
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-red-50 text-red-700 border border-red-200'
                            }`}
                          >
                            {sub.active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right flex items-center justify-end gap-2">
                          <ToggleSupervisorButton id={sub.id} active={sub.active} />
                          <DeleteSupervisorButton id={sub.id} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
