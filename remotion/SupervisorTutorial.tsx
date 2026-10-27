import React from 'react';
import { useCurrentFrame, interpolate, spring } from 'remotion';
import { HeaderBadge } from './components/HeaderBadge';
import { SubtitleCard } from './components/SubtitleCard';
import { PhoneShell } from './components/PhoneShell';
import {
  SceneIntroView,
  SceneConfirmCashView,
  SceneAddWorkerView,
  SceneDisburseView,
  SceneHandoverPhotoView,
  SceneSmsView,
  SceneExpenseView,
  SceneTransferView,
  SceneProofsAuditView,
  SceneOutroView,
} from './components/SceneViews';

export function SupervisorTutorial() {
  const frame = useCurrentFrame();
  const fps = 30;

  // Timeline Breakpoints (30 fps)
  // Scene 1: 0 - 240 (8s) Intro & Dashboard Overview
  // Scene 2: 240 - 570 (11s) Confirm Incoming Cash
  // Scene 3: 570 - 930 (12s) Add Worker (Ramesh)
  // Scene 4: 930 - 1350 (14s) Disburse Cash
  // Scene 5: 1350 - 1830 (16s) Cash Handover Photo Proof
  // Scene 6: 1830 - 2190 (12s) Automated SMS Received
  // Scene 7: 2190 - 2550 (12s) Log Factory Expense
  // Scene 8: 2550 - 2880 (11s) Transfer to Supervisor
  // Scene 9: 2880 - 3210 (11s) Proofs Audit & Controls
  // Scene 10: 3210 - 3450 (8s) Outro Summary

  let currentScene = 1;
  let stepNumber: number | undefined = undefined;
  let title = 'Supervisor Portal Guide';
  let hinglishText = '';
  let highlightTip: string | undefined = undefined;
  let activeTab: 'disburse' | 'expense' | 'transfer' = 'disburse';
  let availableCash = 25000;
  let sceneContent = <SceneIntroView />;

  if (frame < 240) {
    // Scene 1
    currentScene = 1;
    stepNumber = undefined;
    title = 'Supervisor Dashboard Overview';
    hinglishText = 'FundFlow me login karte hi sabse upar aapko apna Available Cash Balance aur Factory Name dikhega. Sara hisab yahin se handle hoga.';
    highlightTip = 'Har payment se pehle apna Available Balance zaroor check karein.';
    activeTab = 'disburse';
    availableCash = 25000;
    sceneContent = <SceneIntroView />;
  } else if (frame < 570) {
    // Scene 2
    currentScene = 2;
    stepNumber = 1;
    title = 'Office Se Aaya Cash Confirm Karein';
    const isConfirmed = frame >= 420;
    availableCash = isConfirmed ? 25000 : 10000;
    hinglishText = 'Jab bhi office ya dusra supervisor aapko cash bheje, "Confirm Receipt" dabayein. Cash turant aapke Available Balance me jud jayega!';
    highlightTip = 'Confirm dabaye bina paisa aapke balance me add nahi hoga aur aap advance nahi baant sakte.';
    activeTab = 'disburse';
    sceneContent = <SceneConfirmCashView isConfirmed={isConfirmed} />;
  } else if (frame < 930) {
    // Scene 3
    currentScene = 3;
    stepNumber = 2;
    title = 'Naya Worker Profile Jodein (Ramesh)';
    availableCash = 25000;
    hinglishText = 'Naye mazdoor ko jodte waqt "Add Worker" dabayein. Ramesh ka naam aur mobile number daalein taaki usey SMS raseed mil sake.';
    highlightTip = 'Phone number zaroor save karein taaki Ramesh ko automated SMS raseed milti rahe.';
    activeTab = 'disburse';
    sceneContent = <SceneAddWorkerView />;
  } else if (frame < 1350) {
    // Scene 4
    currentScene = 4;
    stepNumber = 3;
    title = 'Worker ko Advance / Cash Dena';
    availableCash = 25000;
    hinglishText = 'Mazdoor ko cash dete waqt "Disburse" tab me jayein, Ramesh ko chunein, amount daalein aur remarks likhein.';
    highlightTip = 'Agar worker ka phone number nahi hai toh screen par turant Add Phone popup aayega.';
    activeTab = 'disburse';
    sceneContent = <SceneDisburseView />;
  } else if (frame < 1830) {
    // Scene 5
    currentScene = 5;
    stepNumber = 4;
    title = 'SABSE ZAROORI: Handover Photo Khinchein';
    availableCash = 23000;
    hinglishText = 'Sabse zaroori step: Cash dete waqt phone ka camera khulega. Ramesh ko paise pakdate hue photo click karein! Yeh aapka 100% saboot hai.';
    highlightTip = 'Photo lene se kal ko koi bhi worker paise lene se mukar nahi sakta — yeh supervisor ka suraksha kavach hai.';
    activeTab = 'disburse';
    sceneContent = <SceneHandoverPhotoView />;
  } else if (frame < 2190) {
    // Scene 6
    currentScene = 6;
    stepNumber = 5;
    title = 'Worker ko Automatic SMS Raseed';
    availableCash = 23000;
    hinglishText = 'Payment hote hi Ramesh ke mobile par instant SMS raseed chali jayegi. Supervisor ko alag se koi message bhejne ki zaroorat nahi hai!';
    highlightTip = 'Yeh automated SMS TextBee gateway se bina supervisor ke jhanjhat ke turant chala jata hai.';
    activeTab = 'disburse';
    sceneContent = <SceneSmsView />;
  } else if (frame < 2550) {
    // Scene 7
    currentScene = 7;
    stepNumber = 6;
    title = 'Factory ke Daily Kharchon ka Hisab';
    availableCash = 22550;
    activeTab = 'expense';
    hinglishText = 'Factory ka koi bhi dainik kharcha ho — tempo bhada, diesel ya chai — "Log Expense" tab me category aur bill ki photo daal kar likhein.';
    highlightTip = 'Kharcha submit hote hi aapke cash balance se turant minus ho jayega.';
    sceneContent = <SceneExpenseView />;
  } else if (frame < 2880) {
    // Scene 8
    currentScene = 8;
    stepNumber = 7;
    title = 'Doosre Supervisor ko Cash Transfer';
    availableCash = 17550;
    activeTab = 'transfer';
    hinglishText = 'Agar kisi dusri factory ke supervisor ko cash transfer karna ho, "Transfer" tab me supervisor chunein aur amount bhejein. Wo confirm karega.';
    highlightTip = 'Jab saamne wala supervisor "Confirm" karega, tabhi transfer poora hoga aur balance adjust hoga.';
    sceneContent = <SceneTransferView />;
  } else if (frame < 3210) {
    // Scene 9
    currentScene = 9;
    stepNumber = 8;
    title = 'Proofs & Records Dashboard Controls';
    const showModal = frame >= 3000;
    availableCash = 17550;
    activeTab = 'disburse';
    hinglishText = 'Dashboard par "View Proof" dabakar aap kisi bhi payment ki handover photo dekh sakte hain, aur har worker ka running advance check kar sakte hain.';
    highlightTip = 'Admin aur supervisor dono ke paas har ek payment ki photo ka full record rehta hai.';
    sceneContent = <SceneProofsAuditView showModal={showModal} />;
  } else {
    // Scene 10: Outro
    currentScene = 10;
    stepNumber = undefined;
    title = 'FundFlow Complete Guide';
    availableCash = 17550;
    hinglishText = 'FundFlow ke sath aapka aur factory ka har rupaya 100% surakshit hai, bina kisi jhanjhat ke! Happy Working!';
    highlightTip = 'Teen baatein: Cash confirm karein • Phone number jodein • Handover photo khinchein!';
    sceneContent = <SceneOutroView />;
  }

  // Smooth entrance scale animation for scene change
  const sceneEntrance = spring({
    frame: frame % 300,
    fps,
    config: { damping: 15, stiffness: 120 },
  });

  return (
    <div
      style={{
        width: 1080,
        height: 1920,
        backgroundColor: '#030712',
        backgroundImage: 'radial-gradient(ellipse at 50% 0%, #1E293B 0%, #030712 70%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '24px 0 36px 0',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Top Header & Step Badge */}
      <div style={{ width: '100%' }}>
        <HeaderBadge
          stepNumber={stepNumber}
          stepTotal={8}
          title={title}
          tag={currentScene === 1 ? 'SUPERVISOR ONBOARDING' : currentScene === 10 ? 'SUMMARY' : 'STEP BY STEP'}
        />
      </div>

      {/* Center Phone Shell */}
      <div
        style={{
          transform: `scale(${0.96 + sceneEntrance * 0.04})`,
          transition: 'transform 0.2s ease',
        }}
      >
        <PhoneShell
          availableCash={availableCash}
          supervisorName="Sunil"
          factoryName="RAMA VIHAR FACTORY"
          activeTab={activeTab}
        >
          {sceneContent}
        </PhoneShell>
      </div>

      {/* Bottom Subtitle Card in Conversational Hinglish */}
      <div>
        <SubtitleCard
          hinglishText={hinglishText}
          highlightTip={highlightTip}
          icon={currentScene === 5 ? '📸' : currentScene === 6 ? '📱' : currentScene === 1 ? '👋' : '💡'}
        />
      </div>
    </div>
  );
}
