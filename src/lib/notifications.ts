// FundFlow Real Web App Notifications System (PC & Mobile)

// Play subtle, clean audio chime using Web Audio API (no external MP3 file needed)
export function playAlertSound(type: 'cash_in' | 'alert' | 'success' = 'cash_in') {
  if (typeof window === 'undefined') return;
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();

    if (type === 'cash_in') {
      // Pleasant dual-tone chime (coin / payment received)
      const now = ctx.currentTime;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, now); // D5
      osc1.frequency.exponentialRampToValueAtTime(880, now + 0.15); // A5

      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(880, now + 0.15);
      osc2.frequency.exponentialRampToValueAtTime(1174.66, now + 0.35); // D6

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now);
      osc1.stop(now + 0.2);
      osc2.start(now + 0.15);
      osc2.stop(now + 0.5);
    } else if (type === 'alert') {
      // Attention alert (urgent request or dispute)
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.setValueAtTime(659.25, now + 0.12);

      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.4);
    }
  } catch (e) {
    // Ignore audio autoplay restrictions
  }
}

// Request Browser Notification Permission
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'denied';
  }

  try {
    const permission = await Notification.requestPermission();
    return permission;
  } catch (e) {
    console.error('Error requesting notification permission:', e);
    return 'denied';
  }
}

// Check current permission state
export function getNotificationPermission(): NotificationPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'denied';
  }
  return Notification.permission;
}

// Send Real Notification (triggers OS notification banner on Windows, Mac, Android, and iOS PWA)
export async function sendFundFlowNotification(
  title: string,
  options: {
    body: string;
    tag?: string;
    url?: string;
    soundType?: 'cash_in' | 'alert' | 'success';
  }
) {
  if (typeof window === 'undefined') return;

  // 1. Play in-app audio chime
  if (options.soundType) {
    playAlertSound(options.soundType);
  }

  // 2. Mobile vibration pattern (200ms pulse, 100ms pause, 200ms pulse)
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate([200, 100, 200]);
    } catch {}
  }

  // 3. Native OS notification if permission granted
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      // Use Service Worker registration if available (works on mobile background & lockscreen)
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.ready;
        if (registration && registration.showNotification) {
          await registration.showNotification(title, {
            body: options.body,
            icon: '/icon.png',
            badge: '/icon.png',
            tag: options.tag || 'fundflow-alert',
            data: { url: options.url || '/' },
          });
          return;
        }
      }

      // Fallback for standard desktop Notification API
      new Notification(title, {
        body: options.body,
        icon: '/icon.png',
        tag: options.tag || 'fundflow-alert',
      });
    } catch (e) {
      console.warn('Could not display system notification:', e);
    }
  }
}
