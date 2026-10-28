import React from 'react';
import Link from 'next/link';
import { logout } from '@/app/actions/auth';
import { OfflineStatusBar } from '@/components/offline-status-bar';
import { LogOut } from 'lucide-react';
import { AdminNav, AdminMobileNav } from './admin-nav';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-full flex flex-col bg-slate-50">
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200">
        <OfflineStatusBar />
        <div className="mx-auto max-w-7xl px-3 sm:px-6 lg:px-8">
          <div className="flex h-14 md:h-16 justify-between items-center">
            <div className="flex items-center gap-6">
              <Link href="/admin" className="flex items-center">
                <span className="font-black text-lg md:text-xl text-slate-900 tracking-tight">
                  JBB <span className="text-emerald-600 font-bold">FundFlow</span>
                </span>
              </Link>
              <AdminNav />
            </div>
            
            <div className="flex items-center gap-3">
              <span className="hidden sm:inline-block text-xs font-semibold uppercase bg-slate-100 text-slate-800 px-2.5 py-1 rounded">
                Office Admin
              </span>
              <form action={logout}>
                <button
                  type="submit"
                  title="Sign Out"
                  className="flex items-center justify-center h-9 md:h-10 px-2.5 md:px-3 text-slate-700 hover:text-slate-900 hover:bg-slate-50 rounded-md border border-slate-200 gap-1.5 md:gap-2 text-xs md:text-sm font-medium min-h-[38px] md:min-h-[44px]"
                >
                  <LogOut className="h-4 w-4" />
                  <span className="hidden sm:inline">Sign Out</span>
                </button>
              </form>
            </div>
          </div>
        </div>

        {/* Mobile Navigation Bar */}
        <AdminMobileNav />
      </header>

      <main className="flex-1 py-4 sm:py-6">
        <div className="mx-auto max-w-7xl px-3 sm:px-6 lg:px-8">
          {children}
        </div>
      </main>
    </div>
  );
}
