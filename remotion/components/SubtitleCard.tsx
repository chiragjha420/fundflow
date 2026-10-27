import React from 'react';

export function SubtitleCard({
  hinglishText,
  highlightTip,
  icon = '💡',
}: {
  hinglishText: string;
  highlightTip?: string;
  icon?: string;
}) {
  return (
    <div
      style={{
        width: 960,
        backgroundColor: '#0F172A',
        border: '2px solid #334155',
        borderRadius: 24,
        padding: '24px 32px',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {/* Subtitle Header / Label */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>{icon}</span>
          <span style={{ fontSize: 13, fontWeight: 800, color: '#38BDF8', letterSpacing: 1.5, textTransform: 'uppercase' }}>
            HINDI GUIDE • SAMJHO AUR SIKHO
          </span>
        </div>
        <span style={{ fontSize: 12, color: '#64748B', fontWeight: 600 }}>FundFlow Video Tutorial</span>
      </div>

      {/* Main Conversational Hinglish Subtitle */}
      <div
        style={{
          fontSize: 26,
          lineHeight: 1.45,
          fontWeight: 700,
          color: '#F8FAFC',
          textShadow: '0 1px 2px rgba(0,0,0,0.4)',
        }}
      >
        {hinglishText}
      </div>

      {/* Optional Pro-Tip Highlight Bar */}
      {highlightTip && (
        <div
          style={{
            backgroundColor: '#1E293B',
            borderLeft: '4px solid #10B981',
            borderRadius: 8,
            padding: '10px 16px',
            fontSize: 18,
            fontWeight: 700,
            color: '#A7F3D0',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span>⭐</span>
          <span>{highlightTip}</span>
        </div>
      )}
    </div>
  );
}
