'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Users } from 'lucide-react';

export function AdminNav() {
  const pathname = usePathname();

  const isDashboard = pathname === '/admin';
  const isSupervisors = pathname.startsWith('/admin/supervisors');

  return (
    <>
      {/* Desktop Navigation */}
      <nav className="hidden md:flex space-x-2 text-sm font-medium">
        <Link
          href="/admin"
          prefetch={true}
          className={`flex items-center gap-2 py-2 px-3 rounded-lg text-sm font-semibold transition-all ${
            isDashboard
              ? 'bg-slate-900 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <LayoutDashboard className="h-4 w-4" />
          <span>Dashboard</span>
        </Link>
        <Link
          href="/admin/supervisors"
          prefetch={true}
          className={`flex items-center gap-2 py-2 px-3 rounded-lg text-sm font-semibold transition-all ${
            isSupervisors
              ? 'bg-slate-900 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Users className="h-4 w-4" />
          <span>Supervisors</span>
        </Link>
      </nav>

      {/* Mobile Navigation */}
      <div className="md:hidden flex border-t border-slate-200 bg-white">
        <Link
          href="/admin"
          prefetch={true}
          className={`flex-1 py-3 text-center text-xs font-semibold flex flex-col items-center gap-1 transition-colors ${
            isDashboard
              ? 'text-emerald-700 bg-emerald-50/70 border-b-2 border-emerald-600'
              : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          <LayoutDashboard className="h-4 w-4 mx-auto" />
          <span>Dashboard</span>
        </Link>
        <Link
          href="/admin/supervisors"
          prefetch={true}
          className={`flex-1 py-3 text-center text-xs font-semibold flex flex-col items-center gap-1 transition-colors ${
            isSupervisors
              ? 'text-emerald-700 bg-emerald-50/70 border-b-2 border-emerald-600'
              : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          <Users className="h-4 w-4 mx-auto" />
          <span>Supervisors</span>
        </Link>
      </div>
    </>
  );
}
