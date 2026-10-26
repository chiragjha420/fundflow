import React from 'react';

export default function AdminLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Title & subtitle skeleton */}
      <div className="space-y-2">
        <div className="h-8 w-64 bg-slate-200 rounded-md" />
        <div className="h-4 w-96 bg-slate-100 rounded-md" />
      </div>

      {/* KPI Cards skeleton */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-white p-5 rounded-xl border border-slate-200 space-y-3 shadow-xs">
            <div className="h-4 w-28 bg-slate-100 rounded" />
            <div className="h-7 w-36 bg-slate-200 rounded" />
            <div className="h-3 w-20 bg-slate-100 rounded" />
          </div>
        ))}
      </div>

      {/* Content area skeleton */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4 shadow-xs">
        <div className="h-5 w-48 bg-slate-200 rounded" />
        <div className="space-y-3 pt-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-12 bg-slate-50 rounded-lg border border-slate-100" />
          ))}
        </div>
      </div>
    </div>
  );
}
