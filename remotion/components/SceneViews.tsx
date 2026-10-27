import React from 'react';
import { RameshAvatar, HandoverCashGraphic, SmsNotificationBox } from './SvgGraphics';

// 1. Scene: Dashboard Overview
export function SceneIntroView() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Banner */}
      <div style={{ backgroundColor: '#0284C7', color: '#FFF', padding: '16px 20px', borderRadius: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, opacity: 0.9 }}>
          SUPERVISOR PORTAL
        </div>
        <div style={{ fontSize: 22, fontWeight: 900, marginTop: 4 }}>
          Rama Vihar Factory Desk
        </div>
        <div style={{ fontSize: 13, marginTop: 4, opacity: 0.9 }}>
          Yahan se aap factory ka sara cash, worker payments aur expenses manage karenge.
        </div>
      </div>

      {/* Cash Summary Card */}
      <div style={{ backgroundColor: '#FFFFFF', border: '1.5px solid #CBD5E1', borderRadius: 16, padding: 18, boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 12, color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>Current Balance</div>
            <div style={{ fontSize: 32, fontWeight: 900, color: '#0F172A', marginTop: 2 }}>₹25,000</div>
          </div>
          <div style={{ backgroundColor: '#DCFCE7', color: '#15803D', padding: '8px 16px', borderRadius: 12, fontWeight: 800, fontSize: 14 }}>
            ● Active In-Hand
          </div>
        </div>
      </div>

      {/* Quick Action Navigation Preview */}
      <div style={{ backgroundColor: '#FFFFFF', border: '1.5px solid #CBD5E1', borderRadius: 16, padding: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: '#475569', textTransform: 'uppercase', marginBottom: 12 }}>
          Teeno Quick Actions:
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 10, backgroundColor: '#F1F5F9', borderRadius: 10 }}>
            <span style={{ fontSize: 20 }}>💵</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#0F172A' }}>1. Disburse Cash</div>
              <div style={{ fontSize: 12, color: '#64748B' }}>Worker ko advance ya payment dein + Photo proof</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 10, backgroundColor: '#F1F5F9', borderRadius: 10 }}>
            <span style={{ fontSize: 20 }}>🧾</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#0F172A' }}>2. Log Expense</div>
              <div style={{ fontSize: 12, color: '#64748B' }}>Tempo, petrol, chai aur factory ke daily kharche</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 10, backgroundColor: '#F1F5F9', borderRadius: 10 }}>
            <span style={{ fontSize: 20 }}>🔁</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#0F172A' }}>3. Transfer to Supervisor</div>
              <div style={{ fontSize: 12, color: '#64748B' }}>Dusri factory ke supervisor ko cash bhejna</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// 2. Scene: Confirm Incoming Cash
export function SceneConfirmCashView({ isConfirmed = false }: { isConfirmed?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: '#0F172A', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Pending Incoming Transactions (1)
      </div>

      <div
        style={{
          backgroundColor: '#FFFFFF',
          border: isConfirmed ? '2px solid #22C55E' : '2px solid #F59E0B',
          borderRadius: 16,
          padding: 20,
          boxShadow: '0 10px 15px -3px rgba(0,0,0,0.08)',
          position: 'relative',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 18 }}>🏦</span>
              <span style={{ fontSize: 15, fontWeight: 800, color: '#0F172A' }}>Office ➔ Sunil (You)</span>
            </div>
            <div style={{ fontSize: 12, color: '#64748B', marginTop: 4 }}>
              Note: "Morning cash replenishment for Rama Vihar"
            </div>
            <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>Today at 09:15 AM</div>
          </div>

          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 24, fontWeight: 900, color: '#0F172A' }}>₹15,000</div>
            <span style={{
              fontSize: 10,
              fontWeight: 800,
              backgroundColor: isConfirmed ? '#DCFCE7' : '#FEF3C7',
              color: isConfirmed ? '#166534' : '#92400E',
              padding: '2px 8px',
              borderRadius: 6,
            }}>
              {isConfirmed ? '✓ CONFIRMED' : '⏳ AWAITING YOU'}
            </span>
          </div>
        </div>

        {/* Action Button */}
        <div style={{ marginTop: 18 }}>
          {isConfirmed ? (
            <div style={{
              backgroundColor: '#DCFCE7',
              border: '1.5px solid #86EFAC',
              color: '#166534',
              padding: '12px',
              borderRadius: 12,
              textAlign: 'center',
              fontWeight: 800,
              fontSize: 14,
            }}>
              ✓ Cash Received & Added to Available Balance!
            </div>
          ) : (
            <div style={{
              backgroundColor: '#0F172A',
              color: '#FFFFFF',
              padding: '14px',
              borderRadius: 12,
              textAlign: 'center',
              fontWeight: 800,
              fontSize: 15,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              boxShadow: '0 4px 12px rgba(15,23,42,0.3)',
            }}>
              <span>✓</span>
              <span>Confirm Cash Receipt (Tap Here)</span>
            </div>
          )}
        </div>
      </div>

      <div style={{ backgroundColor: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 12, padding: 14, color: '#166534', fontSize: 13, lineHeight: 1.4 }}>
        <strong>Zaroori Baat:</strong> Jab tak aap Confirm nahi karenge, yeh paisa aapke Available Balance me nahi judega aur aap aage advance nahi baant sakte.
      </div>
    </div>
  );
}

// 3. Scene: Add Worker Profile
export function SceneAddWorkerView({ step = 1 }: { step?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: '#0F172A', textTransform: 'uppercase' }}>Workers Registry</span>
        <span style={{ backgroundColor: '#0F172A', color: '#FFF', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 6 }}>
          + Add Worker
        </span>
      </div>

      {/* Form Container */}
      <div style={{ backgroundColor: '#FFFFFF', border: '2px solid #38BDF8', borderRadius: 16, padding: 18, boxShadow: '0 8px 16px rgba(0,0,0,0.06)' }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#0369A1', marginBottom: 12, textTransform: 'uppercase' }}>
          Add New Worker Profile
        </div>

        {/* Worker Avatar & Name Row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
          <RameshAvatar size={64} />
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>Worker Full Name</label>
            <div style={{
              border: '1.5px solid #94A3B8',
              borderRadius: 8,
              padding: '8px 12px',
              fontSize: 15,
              fontWeight: 800,
              color: '#0F172A',
              backgroundColor: '#F8FAFC',
              marginTop: 4,
            }}>
              Ramesh Kumar
            </div>
          </div>
        </div>

        {/* Phone Input */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>
              Mobile Number (SMS Alert Ke Liye)
            </label>
            <span style={{ fontSize: 10, color: '#059669', fontWeight: 700 }}>✓ Free Auto SMS</span>
          </div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            border: '2px solid #059669',
            borderRadius: 8,
            padding: '8px 12px',
            backgroundColor: '#F0FDF4',
            marginTop: 4,
            gap: 6,
          }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#059669' }}>+91</span>
            <span style={{ fontSize: 15, fontWeight: 800, color: '#0F172A' }}>98765 43210</span>
          </div>
        </div>

        {/* Opening Advance */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>Opening Advance (Purana Hisab)</label>
          <div style={{
            border: '1.5px solid #CBD5E1',
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 14,
            fontWeight: 700,
            color: '#64748B',
            backgroundColor: '#F8FAFC',
            marginTop: 4,
          }}>
            ₹0
          </div>
        </div>

        {/* Submit Button */}
        <div style={{
          backgroundColor: '#0F172A',
          color: '#FFF',
          padding: '12px',
          borderRadius: 10,
          textAlign: 'center',
          fontWeight: 800,
          fontSize: 14,
        }}>
          ✓ Submit Profile
        </div>
      </div>

      <div style={{ backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 12, padding: 12, fontSize: 12, color: '#1E40AF' }}>
        ℹ️ Phone number save karne se Ramesh ko har advance payment par text SMS raseed apne aap mil jayegi.
      </div>
    </div>
  );
}

// 4. Scene: Disburse Cash to Ramesh
export function SceneDisburseView() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ backgroundColor: '#FFFFFF', border: '2px solid #CBD5E1', borderRadius: 16, padding: 18, boxShadow: '0 6px 12px rgba(0,0,0,0.06)' }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#0F172A', textTransform: 'uppercase', marginBottom: 14 }}>
          Disburse Cash To Worker
        </div>

        {/* Worker Dropdown */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>Select Worker</label>
          <div style={{
            border: '2px solid #0284C7',
            borderRadius: 8,
            padding: '10px 12px',
            fontSize: 14,
            fontWeight: 800,
            color: '#0F172A',
            backgroundColor: '#F0F9FF',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 4,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <RameshAvatar size={24} />
              <span>Ramesh Kumar (₹0 advance)</span>
            </div>
            <span>▼</span>
          </div>
          {/* Active Phone Indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 11, color: '#059669', fontWeight: 700, backgroundColor: '#DCFCE7', padding: '4px 8px', borderRadius: 6 }}>
            <span>📱</span>
            <span>SMS Alert Active: +91 9876543210</span>
          </div>
        </div>

        {/* Amount Input */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>Amount (INR)</label>
          <div style={{
            border: '2px solid #0F172A',
            borderRadius: 8,
            padding: '10px 12px',
            fontSize: 22,
            fontWeight: 900,
            color: '#0F172A',
            backgroundColor: '#FFFFFF',
            marginTop: 4,
          }}>
            ₹ 2,000
          </div>
          {/* Quick preset chips */}
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            {['+₹500', '+₹1,000', '+₹2,000', '+₹5,000'].map((chip, i) => (
              <span key={i} style={{ fontSize: 11, fontWeight: 700, backgroundColor: i === 2 ? '#0F172A' : '#E2E8F0', color: i === 2 ? '#FFF' : '#334155', padding: '4px 8px', borderRadius: 6 }}>
                {chip}
              </span>
            ))}
          </div>
        </div>

        {/* Remarks Input */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>Notes / Remarks *</label>
          <div style={{
            border: '1.5px solid #CBD5E1',
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 13,
            color: '#0F172A',
            backgroundColor: '#F8FAFC',
            marginTop: 4,
            fontWeight: 600,
          }}>
            Weekly rashan aur kharcha advance
          </div>
        </div>

        {/* Submit Button */}
        <div style={{
          backgroundColor: '#0F172A',
          color: '#FFF',
          padding: '14px',
          borderRadius: 10,
          textAlign: 'center',
          fontWeight: 800,
          fontSize: 15,
        }}>
          Next: Cash Handover Photo Proof ➔
        </div>
      </div>
    </div>
  );
}

// 5. Scene: Handover Photo Prompt
export function SceneHandoverPhotoView() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
      <div style={{ width: '100%', backgroundColor: '#0F172A', color: '#FFF', padding: '12px 16px', borderRadius: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#38BDF8', textTransform: 'uppercase' }}>Cash Handover Proof</div>
          <div style={{ fontSize: 11, color: '#94A3B8' }}>Handing ₹2,000 to Ramesh Kumar</div>
        </div>
        <span style={{ fontSize: 12, backgroundColor: '#EF4444', color: '#FFF', padding: '3px 8px', borderRadius: 6, fontWeight: 800 }}>
          CAMERA ACTIVE
        </span>
      </div>

      {/* 2D Handover Graphic */}
      <HandoverCashGraphic width={740} height={420} />

      {/* Shutter Capture Button */}
      <div style={{ display: 'flex', gap: 12, width: '100%' }}>
        <div style={{
          flex: 1,
          backgroundColor: '#10B981',
          color: '#FFF',
          padding: '14px',
          borderRadius: 12,
          textAlign: 'center',
          fontWeight: 800,
          fontSize: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          boxShadow: '0 4px 14px rgba(16,185,129,0.4)',
        }}>
          <span>📷</span>
          <span>CLICK PHOTO (Proof Save Karein)</span>
        </div>
      </div>

      <div style={{ backgroundColor: '#FEF3C7', border: '1.5px solid #F59E0B', borderRadius: 12, padding: 12, color: '#92400E', fontSize: 12, fontWeight: 600, width: '100%' }}>
        ⚠️ <strong>Supervisor Safety Rule:</strong> Photo me worker ka chehra aur uske haath me cash dikhna chahiye taaki baad me koi mukar na sake.
      </div>
    </div>
  );
}

// 6. Scene: Automated Worker SMS
export function SceneSmsView() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Supervisor Side Toast */}
      <div style={{
        backgroundColor: '#DCFCE7',
        border: '2px solid #22C55E',
        borderRadius: 14,
        padding: '14px 18px',
        color: '#15803D',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}>
        <span style={{ fontSize: 24 }}>✅</span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800 }}>Payment Successful & Logged!</div>
          <div style={{ fontSize: 12 }}>Free automated SMS sent to Ramesh Kumar (+91 9876543210)!</div>
        </div>
      </div>

      {/* Worker Mobile Phone Frame */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 800, color: '#475569', textTransform: 'uppercase', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>📱</span>
          <span>Ramesh Kumar Ke Mobile Par Aane Wali Raseed:</span>
        </div>
        <SmsNotificationBox
          amount={2000}
          workerName="Ramesh Kumar"
          factory="RAMA VIHAR FACTORY"
          date="27 Oct"
        />
      </div>

      <div style={{ backgroundColor: '#F8FAFC', border: '1.5px solid #CBD5E1', borderRadius: 14, padding: 14, fontSize: 13, color: '#334155', lineHeight: 1.5 }}>
        🎯 <strong>Supervisor ko koi message nahi bhejna:</strong> FundFlow TextBee Gateway se apne aap message bhej deta hai. Supervisor ko koi manual button dabane ki zaroorat nahi hai.
      </div>
    </div>
  );
}

// 7. Scene: Log Factory Expense
export function SceneExpenseView() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ backgroundColor: '#FFFFFF', border: '2px solid #CBD5E1', borderRadius: 16, padding: 18, boxShadow: '0 6px 12px rgba(0,0,0,0.06)' }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#0F172A', textTransform: 'uppercase', marginBottom: 14 }}>
          Log Factory Expense (Dainik Kharcha)
        </div>

        {/* Category */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>Expense Category</label>
          <div style={{
            border: '1.5px solid #0284C7',
            borderRadius: 8,
            padding: '10px 12px',
            fontSize: 14,
            fontWeight: 800,
            color: '#0F172A',
            backgroundColor: '#F0F9FF',
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 4,
          }}>
            <span>🚚 Logistics / Tempo / Cartage</span>
            <span>▼</span>
          </div>
        </div>

        {/* Amount */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>Amount (INR)</label>
          <div style={{
            border: '2px solid #0F172A',
            borderRadius: 8,
            padding: '10px 12px',
            fontSize: 22,
            fontWeight: 900,
            color: '#0F172A',
            backgroundColor: '#FFFFFF',
            marginTop: 4,
          }}>
            ₹ 450
          </div>
        </div>

        {/* Notes */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>Notes / Remarks *</label>
          <div style={{
            border: '1.5px solid #CBD5E1',
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 13,
            color: '#0F172A',
            backgroundColor: '#F8FAFC',
            marginTop: 4,
            fontWeight: 600,
          }}>
            Raw material factory delivery tempo bhada
          </div>
        </div>

        {/* Receipt Upload Mock */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>Bill / Receipt Photo (Optional)</label>
          <div style={{
            border: '2px dashed #94A3B8',
            borderRadius: 8,
            padding: '12px',
            textAlign: 'center',
            backgroundColor: '#F1F5F9',
            fontSize: 12,
            fontWeight: 700,
            color: '#0369A1',
            marginTop: 4,
          }}>
            📷 Bill ya Parchi Ki Photo Attached (tempo_receipt.jpg)
          </div>
        </div>

        {/* Submit */}
        <div style={{
          backgroundColor: '#0F172A',
          color: '#FFF',
          padding: '14px',
          borderRadius: 10,
          textAlign: 'center',
          fontWeight: 800,
          fontSize: 15,
        }}>
          Submit Expense (₹450 Deduct Hoga)
        </div>
      </div>
    </div>
  );
}

// 8. Scene: Transfer to Another Supervisor
export function SceneTransferView() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ backgroundColor: '#FFFFFF', border: '2px solid #CBD5E1', borderRadius: 16, padding: 18, boxShadow: '0 6px 12px rgba(0,0,0,0.06)' }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#0F172A', textTransform: 'uppercase', marginBottom: 14 }}>
          Transfer Cash To Another Supervisor
        </div>

        {/* Recipient */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>Recipient Supervisor</label>
          <div style={{
            border: '1.5px solid #0284C7',
            borderRadius: 8,
            padding: '10px 12px',
            fontSize: 14,
            fontWeight: 800,
            color: '#0F172A',
            backgroundColor: '#F0F9FF',
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 4,
          }}>
            <span>👤 Vikram (2100 GAJ FACTORY)</span>
            <span>▼</span>
          </div>
        </div>

        {/* Amount */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>Amount (INR)</label>
          <div style={{
            border: '2px solid #0F172A',
            borderRadius: 8,
            padding: '10px 12px',
            fontSize: 22,
            fontWeight: 900,
            color: '#0F172A',
            backgroundColor: '#FFFFFF',
            marginTop: 4,
          }}>
            ₹ 5,000
          </div>
        </div>

        {/* Notes */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>Notes / Reason *</label>
          <div style={{
            border: '1.5px solid #CBD5E1',
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 13,
            color: '#0F172A',
            backgroundColor: '#F8FAFC',
            marginTop: 4,
            fontWeight: 600,
          }}>
            Emergency worker payment support
          </div>
        </div>

        {/* Submit */}
        <div style={{
          backgroundColor: '#0F172A',
          color: '#FFF',
          padding: '14px',
          borderRadius: 10,
          textAlign: 'center',
          fontWeight: 800,
          fontSize: 15,
        }}>
          Send Transfer Request
        </div>
      </div>

      <div style={{ backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 12, padding: 12, fontSize: 12, color: '#1E40AF' }}>
        ℹ️ Vikram jab apne dashboard par "Confirm" karega, tabhi uske paas cash transfer complete hoga.
      </div>
    </div>
  );
}

// 9. Scene: Proofs & Audit Controls
export function SceneProofsAuditView({ showModal = false }: { showModal?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, position: 'relative' }}>
      {/* Recent Disbursements & Proofs Card */}
      <div style={{ backgroundColor: '#FFFFFF', border: '2px solid #CBD5E1', borderRadius: 16, overflow: 'hidden' }}>
        <div style={{ backgroundColor: '#0F172A', color: '#FFF', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5 }}>Recent Disbursements & Proofs</span>
          <span style={{ fontSize: 11, color: '#94A3B8' }}>Last 5 entries</span>
        </div>

        <div style={{ padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #E2E8F0', backgroundColor: '#F8FAFC' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <RameshAvatar size={40} />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 800, color: '#0F172A' }}>Ramesh Kumar</span>
                <span style={{ fontSize: 12, fontWeight: 900, color: '#15803D' }}>₹2,000</span>
              </div>
              <div style={{ fontSize: 11, color: '#64748B' }}>Weekly rashan aur kharcha advance</div>
              <div style={{ fontSize: 10, color: '#94A3B8' }}>Today at 10:25 AM</div>
            </div>
          </div>

          {/* View Proof Button */}
          <div style={{
            backgroundColor: '#DCFCE7',
            border: '1.5px solid #22C55E',
            color: '#15803D',
            padding: '6px 12px',
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 800,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            cursor: 'pointer',
          }}>
            <span>📷</span>
            <span>View Proof</span>
          </div>
        </div>
      </div>

      {/* Workers Ledger Card */}
      <div style={{ backgroundColor: '#FFFFFF', border: '1.5px solid #CBD5E1', borderRadius: 16, padding: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: '#475569', textTransform: 'uppercase', marginBottom: 10 }}>
          Worker Running Advance Ledger
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 10, backgroundColor: '#F1F5F9', borderRadius: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <RameshAvatar size={34} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#0F172A' }}>Ramesh Kumar</div>
              <div style={{ fontSize: 11, color: '#64748B' }}>Total Advance Taken</div>
            </div>
          </div>
          <div style={{ fontSize: 16, fontWeight: 900, color: '#DC2626' }}>
            ₹2,000
          </div>
        </div>
      </div>

      {/* Full-Screen Proof Viewer Modal Popup */}
      {showModal && (
        <div style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.92)',
          borderRadius: 16,
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 50,
          gap: 12,
        }}>
          <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#FFF' }}>
            <span style={{ fontSize: 13, fontWeight: 800, textTransform: 'uppercase', color: '#38BDF8' }}>Handover Proof Viewer</span>
            <span style={{ backgroundColor: '#334155', padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>✕ Close</span>
          </div>

          <HandoverCashGraphic width={680} height={380} />

          <div style={{ fontSize: 12, color: '#CBD5E1', textAlign: 'center' }}>
            Handover to: <strong>Ramesh Kumar</strong> • Amount: <strong>₹2,000</strong>
          </div>
        </div>
      )}
    </div>
  );
}

// 10. Scene: Outro / Summary
export function SceneOutroView() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, alignItems: 'center', justifyContent: 'center', height: '100%', textAlign: 'center', padding: 20 }}>
      <div style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: '#0284C7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40 }}>
        🛡️
      </div>

      <div>
        <div style={{ fontSize: 28, fontWeight: 900, color: '#0F172A' }}>FundFlow Ready!</div>
        <div style={{ fontSize: 15, color: '#64748B', marginTop: 6, fontWeight: 600 }}>
          Pura hisab 100% transparent, automated aur safe.
        </div>
      </div>

      <div style={{ backgroundColor: '#F0FDF4', border: '2px solid #86EFAC', borderRadius: 16, padding: 18, width: '100%', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#166534', textTransform: 'uppercase' }}>
          Teen Zaroori Baatein Yaad Rakhein:
        </div>
        <div style={{ fontSize: 13, color: '#1E293B', fontWeight: 600 }}>1. Cash aate hi <strong>Confirm</strong> karein.</div>
        <div style={{ fontSize: 13, color: '#1E293B', fontWeight: 600 }}>2. Mazdoor ka phone number zaroor save karein (Free SMS alert).</div>
        <div style={{ fontSize: 13, color: '#1E293B', fontWeight: 600 }}>3. Cash dete waqt <strong>Handover Photo</strong> hamesha khinchein.</div>
      </div>
    </div>
  );
}
