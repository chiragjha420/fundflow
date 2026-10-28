'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Users, Coins } from 'lucide-react';

export function AdminNav() {
  const pathname = usePathname();

  const isDashboard = pathname === '/admin';
  const isSupervisors = pathname.startsWith('/admin/supervisors');
  const isOpeningAdvances = pathname.startsWith('/admin/opening-advances');

  return (
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
      <Link
        href="/admin/opening-advances"
        prefetch={true}
        className={`flex items-center gap-2 py-2 px-3 rounded-lg text-sm font-semibold transition-all ${
          isOpeningAdvances
            ? 'bg-slate-900 text-white shadow-xs'
            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
        }`}
      >
        <Coins className="h-4 w-4" />
        <span>Opening Advances</span>
      </Link>
    </nav>
  );
}

export function AdminMobileNav() {
  const pathname = usePathname();

  const isDashboard = pathname === '/admin';
  const isSupervisors = pathname.startsWith('/admin/supervisors');
  const isOpeningAdvances = pathname.startsWith('/admin/opening-advances');

  return (
    <nav className="md:hidden border-t border-slate-200 bg-white grid grid-cols-3 divide-x divide-slate-100">
      <Link
        href="/admin"
        prefetch={true}
        className={`py-2 px-1 text-center text-[11px] font-bold flex flex-col items-center justify-center gap-1 transition-colors min-h-[44px] ${
          isDashboard
            ? 'text-emerald-700 bg-emerald-50/70 border-b-2 border-emerald-600'
            : 'text-slate-600 hover:bg-slate-50'
        }`}
      >
        <LayoutDashboard className="h-4 w-4 shrink-0" />
        <span className="truncate">Dashboard</span>
      </Link>
      <Link
        href="/admin/supervisors"
        prefetch={true}
        className={`py-2 px-1 text-center text-[11px] font-bold flex flex-col items-center justify-center gap-1 transition-colors min-h-[44px] ${
          isSupervisors
            ? 'text-emerald-700 bg-emerald-50/70 border-b-2 border-emerald-600'
            : 'text-slate-600 hover:bg-slate-50'
        }`}
      >
        <Users className="h-4 w-4 shrink-0" />
        <span className="truncate">Supervisors</span>
      </Link>
      <Link
        href="/admin/opening-advances"
        prefetch={true}
        className={`py-2 px-1 text-center text-[11px] font-bold flex flex-col items-center justify-center gap-1 transition-colors min-h-[44px] ${
          isOpeningAdvances
            ? 'text-emerald-700 bg-emerald-50/70 border-b-2 border-emerald-600'
            : 'text-slate-600 hover:bg-slate-50'
        }`}
      >
        <Coins className="h-4 w-4 shrink-0" />
        <span className="truncate">Advances</span>
      </Link>
    </nav>
  );
}
