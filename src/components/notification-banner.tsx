'use client';

import React, { useState, useEffect } from 'react';
import { Bell, BellRing, X, Check } from 'lucide-react';
import { 
  getNotificationPermission, 
  requestNotificationPermission, 
  sendFundFlowNotification 
} from '@/lib/notifications';

interface NotificationBannerProps {
  role: 'admin' | 'supervisor';
  className?: string;
}

export function NotificationBanner({ role, className = '' }: NotificationBannerProps) {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [dismissed, setDismissed] = useState<boolean>(false);
  const [testingAlert, setTestingAlert] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const current = getNotificationPermission();
      setPermission(current);
      const isDismissed = sessionStorage.getItem('fundflow_notif_dismissed');
      if (isDismissed) setDismissed(true);
    }
  }, []);

  const handleEnable = async () => {
    const res = await requestNotificationPermission();
    setPermission(res);
    if (res === 'granted') {
      sendFundFlowNotification('FundFlow Notifications Active', {
        body: role === 'admin' 
          ? 'You will now receive alerts for supervisor cash requests and ledger updates.'
          : 'You will now receive alerts for incoming cash disbursements and transfers.',
        soundType: 'cash_in',
      });
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem('fundflow_notif_dismissed', 'true');
  };

  // If permission is already granted or dismissed, or unsupported, don't show prompt banner
  if (permission === 'granted' || permission === 'denied' || dismissed) {
    return null;
  }

  return (
    <div className={`bg-slate-900 text-white rounded-lg p-3.5 shadow-md flex items-center justify-between gap-3 border border-slate-800 ${className}`}>
      <div className="flex items-center gap-2.5">
        <div className="h-8 w-8 rounded-full bg-slate-800 flex items-center justify-center shrink-0 text-amber-400">
          <Bell className="h-4 w-4" />
        </div>
        <div>
          <p className="text-xs font-bold text-white">Turn on Real-Time Alerts</p>
          <p className="text-[11px] text-slate-300">
            {role === 'admin' 
              ? 'Receive instant alerts on PC & phone when supervisors request cash or log entries.'
              : 'Receive instant alerts on phone when cash is disbursed to you.'}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={handleEnable}
          className="px-3 py-1.5 rounded bg-white text-slate-950 font-bold text-xs hover:bg-slate-100 transition-colors shadow-sm min-h-[36px]"
        >
          Enable Alerts
        </button>
        <button
          onClick={handleDismiss}
          className="p-1 rounded text-slate-400 hover:text-white transition-colors"
          title="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
