import React from 'react';

export function HeaderBadge({
  stepNumber,
  stepTotal = 8,
  title,
  tag = 'SUPERVISOR FLOW',
}: {
  stepNumber?: number;
  stepTotal?: number;
  title: string;
  tag?: string;
}) {
  return (
    <div
      style={{
        width: '100%',
        padding: '36px 48px 16px 48px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {/* Top Tag & Progress */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <span
          style={{
            backgroundColor: '#0284C7',
            color: '#FFFFFF',
            fontSize: 14,
            fontWeight: 800,
            padding: '4px 14px',
            borderRadius: 20,
            letterSpacing: 1,
            textTransform: 'uppercase',
          }}
        >
          {tag}
        </span>
        {stepNumber !== undefined && (
          <span
            style={{
              backgroundColor: '#1E293B',
              color: '#38BDF8',
              border: '1px solid #334155',
              fontSize: 14,
              fontWeight: 800,
              padding: '4px 12px',
              borderRadius: 20,
            }}
          >
            STEP {stepNumber} / {stepTotal}
          </span>
        )}
      </div>

      {/* Main Step Title */}
      <h1
        style={{
          fontSize: 34,
          fontWeight: 900,
          color: '#F8FAFC',
          margin: 0,
          letterSpacing: -0.5,
          textShadow: '0 2px 10px rgba(0,0,0,0.5)',
        }}
      >
        {title}
      </h1>
    </div>
  );
}
