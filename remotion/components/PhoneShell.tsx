import React from 'react';

export function PhoneShell({
  children,
  availableCash = 25000,
  supervisorName = 'Sunil',
  factoryName = 'RAMA VIHAR FACTORY',
  activeTab = 'disburse',
}: {
  children: React.ReactNode;
  availableCash?: number;
  supervisorName?: string;
  factoryName?: string;
  activeTab?: 'disburse' | 'expense' | 'transfer';
}) {
  return (
    <div
      style={{
        width: 820,
        height: 1220,
        backgroundColor: '#090D16',
        borderRadius: 48,
        border: '10px solid #1E293B',
        boxShadow: '0 30px 60px -12px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.1)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {/* Phone Top Notch / Dynamic Island */}
      <div
        style={{
          height: 38,
          backgroundColor: '#090D16',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 28px',
          color: '#94A3B8',
          fontSize: 13,
          fontWeight: 600,
          zIndex: 40,
        }}
      >
        <span>10:30 AM</span>
        {/* Dynamic Island pill */}
        <div
          style={{
            width: 140,
            height: 22,
            backgroundColor: '#000000',
            borderRadius: 12,
            border: '1px solid #1E293B',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>5G</span>
          <span>100% 🔋</span>
        </div>
      </div>

      {/* FundFlow App Header */}
      <div
        style={{
          backgroundColor: '#0F172A',
          borderBottom: '1px solid #1E293B',
          padding: '16px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          color: '#FFFFFF',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18, fontWeight: 900, letterSpacing: -0.5, color: '#38BDF8' }}>FundFlow</span>
            <span style={{ fontSize: 10, backgroundColor: '#0284C7', color: '#FFF', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>
              SUPERVISOR
            </span>
          </div>
          <div style={{ fontSize: 13, color: '#94A3B8', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>🏢 {factoryName}</span>
            <span>•</span>
            <span>👤 {supervisorName}</span>
          </div>
        </div>

        {/* Live Available Cash Pill */}
        <div
          style={{
            backgroundColor: '#064E3B',
            border: '1.5px solid #059669',
            padding: '6px 14px',
            borderRadius: 12,
            textAlign: 'right',
          }}
        >
          <div style={{ fontSize: 10, textTransform: 'uppercase', color: '#A7F3D0', fontWeight: 700, letterSpacing: 0.5 }}>
            Available Cash
          </div>
          <div style={{ fontSize: 18, fontWeight: 900, color: '#34D399' }}>
            ₹{availableCash.toLocaleString('en-IN')}
          </div>
        </div>
      </div>

      {/* App Quick Tabs (Disburse | Expense | Transfer) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          backgroundColor: '#1E293B',
          padding: 6,
          gap: 6,
          borderBottom: '1px solid #334155',
        }}
      >
        {[
          { key: 'disburse', label: '💵 Disburse Cash' },
          { key: 'expense', label: '🧾 Log Expense' },
          { key: 'transfer', label: '🔁 Transfer' },
        ].map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <div
              key={tab.key}
              style={{
                padding: '10px 4px',
                textAlign: 'center',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 700,
                backgroundColor: isActive ? '#38BDF8' : 'transparent',
                color: isActive ? '#0F172A' : '#94A3B8',
                transition: 'all 0.2s ease',
              }}
            >
              {tab.label}
            </div>
          );
        })}
      </div>

      {/* Main App Content Viewport */}
      <div
        style={{
          flex: 1,
          backgroundColor: '#F8FAFC',
          overflow: 'hidden',
          position: 'relative',
          padding: 20,
          color: '#0F172A',
        }}
      >
        {children}
      </div>

      {/* Phone Bottom Home Bar */}
      <div
        style={{
          height: 24,
          backgroundColor: '#0F172A',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div style={{ width: 140, height: 4, backgroundColor: '#475569', borderRadius: 2 }} />
      </div>
    </div>
  );
}
