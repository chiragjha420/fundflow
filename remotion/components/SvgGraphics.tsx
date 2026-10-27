import React from 'react';

export function RameshAvatar({ size = 80 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="48" fill="#E2E8F0" stroke="#0D9488" strokeWidth="4" />
      {/* Head */}
      <circle cx="50" cy="40" r="20" fill="#FBBF24" />
      {/* Hair */}
      <path d="M32 36 C32 24 68 24 68 36 C68 30 62 20 50 20 C38 20 32 30 32 36 Z" fill="#1E293B" />
      {/* Eyes & Smile */}
      <circle cx="43" cy="38" r="2.5" fill="#1E293B" />
      <circle cx="57" cy="38" r="2.5" fill="#1E293B" />
      <path d="M44 47 Q50 53 56 47" stroke="#1E293B" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      {/* Mustaches */}
      <path d="M42 44 Q50 46 58 44" stroke="#1E293B" strokeWidth="2" strokeLinecap="round" />
      {/* Body / Shirt */}
      <path d="M22 88 C22 66 35 62 50 62 C65 62 78 66 78 88 Z" fill="#0284C7" />
      {/* Shirt Collar */}
      <polygon points="50,72 40,62 60,62" fill="#E0F2FE" />
      {/* Hard Hat / Cap (Yellow) */}
      <path d="M30 32 C30 18 70 18 70 32 L75 35 L25 35 Z" fill="#F59E0B" />
      <rect x="23" y="33" width="54" height="4" rx="2" fill="#D97706" />
    </svg>
  );
}

export function HandoverCashGraphic({ width = 360, height = 240 }: { width?: number; height?: number }) {
  return (
    <svg width={width} height={height} viewBox="0 0 400 260" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0F172A" />
          <stop offset="100%" stopColor="#1E293B" />
        </linearGradient>
        <linearGradient id="noteGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#86EFAC" />
          <stop offset="100%" stopColor="#4ADE80" />
        </linearGradient>
      </defs>

      {/* Frame Container */}
      <rect width="400" height="260" rx="16" fill="url(#bgGrad)" stroke="#334155" strokeWidth="2" />

      {/* Grid Pattern in Background */}
      <path d="M 0 65 L 400 65 M 0 130 L 400 130 M 0 195 L 400 195" stroke="#1E293B" strokeWidth="1" />
      <path d="M 100 0 L 100 260 M 200 0 L 200 260 M 300 0 L 300 260" stroke="#1E293B" strokeWidth="1" />

      {/* Supervisor Hand (Left - Giving Cash) */}
      <g id="giver-hand">
        <path d="M 0 150 C 40 150 70 145 95 140 C 115 136 145 135 160 142 L 155 162 C 140 158 115 158 95 165 C 70 172 40 175 0 175 Z" fill="#FCD34D" stroke="#D97706" strokeWidth="2" />
        {/* Watch on Wrist */}
        <rect x="25" y="145" width="18" height="32" rx="3" fill="#0284C7" />
        <circle cx="34" cy="161" r="5" fill="#FFFFFF" />
        {/* Thumb */}
        <path d="M 115 137 C 125 125 140 125 150 132 C 153 135 145 142 135 142 Z" fill="#FCD34D" stroke="#D97706" strokeWidth="2" />
      </g>

      {/* Stack of Currency Notes (₹500 / ₹2,000 INR Style) */}
      <g id="currency-notes" transform="translate(145, 95) rotate(-5)">
        {/* Back note */}
        <rect x="-5" y="10" width="125" height="65" rx="4" fill="#BBF7D0" stroke="#16A34A" strokeWidth="1.5" />
        {/* Middle note */}
        <rect x="0" y="5" width="125" height="65" rx="4" fill="#86EFAC" stroke="#16A34A" strokeWidth="1.5" />
        {/* Front Note */}
        <rect x="5" y="0" width="125" height="65" rx="4" fill="url(#noteGrad)" stroke="#15803D" strokeWidth="2" />
        {/* Note Details */}
        <circle cx="67" cy="32" r="14" fill="#DCFCE7" stroke="#16A34A" strokeWidth="1" />
        <text x="67" y="37" textAnchor="middle" fill="#166534" fontSize="13" fontWeight="bold" fontFamily="sans-serif">₹500</text>
        <text x="15" y="20" fill="#166534" fontSize="10" fontWeight="bold" fontFamily="sans-serif">₹500</text>
        <text x="118" y="58" textAnchor="end" fill="#166534" fontSize="10" fontWeight="bold" fontFamily="sans-serif">₹500</text>
        <rect x="25" y="28" width="85" height="2" fill="#16A34A" opacity="0.4" />
      </g>

      {/* Worker Hand (Right - Receiving Cash) */}
      <g id="receiver-hand">
        <path d="M 400 155 C 360 155 330 152 305 145 C 285 140 255 138 240 148 L 245 168 C 260 162 285 162 305 170 C 330 178 360 180 400 180 Z" fill="#FBBF24" stroke="#D97706" strokeWidth="2" />
        {/* Worker Sleeve */}
        <rect x="365" y="150" width="35" height="34" fill="#D97706" />
        {/* Thumb */}
        <path d="M 285 142 C 275 130 260 130 250 138 C 248 142 255 148 265 148 Z" fill="#FBBF24" stroke="#D97706" strokeWidth="2" />
      </g>

      {/* Camera Viewfinder Reticle / Focus Brackets */}
      <path d="M 50 35 L 30 35 L 30 55" stroke="#22C55E" strokeWidth="3" strokeLinecap="round" />
      <path d="M 350 35 L 370 35 L 370 55" stroke="#22C55E" strokeWidth="3" strokeLinecap="round" />
      <path d="M 50 225 L 30 225 L 30 205" stroke="#22C55E" strokeWidth="3" strokeLinecap="round" />
      <path d="M 350 225 L 370 225 L 370 205" stroke="#22C55E" strokeWidth="3" strokeLinecap="round" />

      {/* Red Recording Dot / PROOF BADGE */}
      <circle cx="50" cy="55" r="5" fill="#EF4444" />
      <text x="62" y="59" fill="#F8FAFC" fontSize="11" fontWeight="bold" fontFamily="sans-serif">LIVE PROOF CAPTURE</text>
      
      {/* Bottom Cash Tag */}
      <rect x="135" y="210" width="130" height="28" rx="14" fill="#16A34A" />
      <text x="200" y="228" textAnchor="middle" fill="#FFFFFF" fontSize="12" fontWeight="bold" fontFamily="sans-serif">₹2,000 HANDOVER</text>
    </svg>
  );
}

export function SmsNotificationBox({
  amount = 2000,
  workerName = 'Ramesh Kumar',
  factory = 'RAMA VIHAR FACTORY',
  date = '27 Oct',
}: {
  amount?: number;
  workerName?: string;
  factory?: string;
  date?: string;
}) {
  return (
    <div style={{
      backgroundColor: '#0F172A',
      border: '2px solid #10B981',
      borderRadius: 16,
      padding: 16,
      boxShadow: '0 20px 25px -5px rgba(0,0,0,0.5)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      color: '#F8FAFC',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#10B981', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 16 }}>💬</span>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 'bold', color: '#F1F5F9' }}>Messages • TextBee SMS</div>
            <div style={{ fontSize: 11, color: '#94A3B8' }}>To: +91 98765 43210 ({workerName})</div>
          </div>
        </div>
        <span style={{ fontSize: 11, color: '#10B981', fontWeight: 'bold', backgroundColor: '#064E3B', padding: '2px 8px', borderRadius: 8 }}>
          ✓ DELIVERED
        </span>
      </div>

      <div style={{
        backgroundColor: '#1E293B',
        borderRadius: 12,
        padding: 14,
        borderLeft: '4px solid #10B981',
        fontSize: 14,
        lineHeight: 1.5,
        color: '#E2E8F0',
      }}>
        <div style={{ fontWeight: 'bold', color: '#34D399', marginBottom: 4 }}>JBB FundFlow Alert:</div>
        <div>Received <strong>₹{amount.toLocaleString('en-IN')}</strong> on {date} from <strong>{factory}</strong>.</div>
      </div>

      <div style={{ marginTop: 10, fontSize: 11, color: '#64748B', display: 'flex', justifyContent: 'space-between' }}>
        <span>Free Gateway SIM Dispatch</span>
        <span>Auto-confirmed</span>
      </div>
    </div>
  );
}
