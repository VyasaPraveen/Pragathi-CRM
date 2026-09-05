// ============================================================================
// Web push registration (Firebase Cloud Messaging, Spark plan).
// Registers the service worker, obtains an FCM device token and stores it on the
// Hostinger backend (/push/register) so the PHP sender can target this device.
// Fully inert until REACT_APP_FCM_VAPID_KEY is set — no permission prompt, no
// token request — so it is safe to ship before FCM is switched on.
// ============================================================================

import { initMessaging, getToken, onMessage, VAPID_KEY } from './firebase';
import { apiPost } from './api';

let currentToken = null;
let started = false;

// Call once, after the user is authenticated. onForeground(title, body) fires
// for messages received while the tab is focused.
export async function registerPush(onForeground) {
  try {
    if (started) return;                 // idempotent
    if (!VAPID_KEY) return;              // FCM not configured yet → do nothing
    if (!('serviceWorker' in navigator) || !('Notification' in window)) return;

    const messaging = await initMessaging();
    if (!messaging) return;

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    const swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg });
    if (!token) return;

    started = true;
    currentToken = token;
    await apiPost('/push/register', { token, platform: 'web' });

    // Foreground messages don't raise an OS notification automatically — surface them.
    onMessage(messaging, (payload) => {
      const n = payload.notification || {};
      if (typeof onForeground === 'function') onForeground(n.title || 'Notification', n.body || '');
    });
  } catch {
    /* non-fatal: the app works without push */
  }
}

// Call on logout so a signed-out device stops receiving this user's pushes.
export async function unregisterPush() {
  try {
    if (currentToken) {
      await apiPost('/push/unregister', { token: currentToken });
      currentToken = null;
      started = false;
    }
  } catch {
    /* ignore */
  }
}
