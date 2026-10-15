// ============================================================================
// Firebase is now used ONLY for Cloud Messaging (push notifications), which is
// free on the Spark plan. All data + auth + storage moved to the Hostinger API.
// Messaging is initialised lazily so the app works even where it's unsupported.
// ============================================================================

import { initializeApp } from 'firebase/app';
import { getMessaging, getToken, onMessage, isSupported } from 'firebase/messaging';

const firebaseConfig = {
  apiKey: process.env.REACT_APP_FB_API_KEY,
  authDomain: process.env.REACT_APP_FB_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FB_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FB_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FB_MESSAGING_ID,
  appId: process.env.REACT_APP_FB_APP_ID,
};

export const VAPID_KEY = process.env.REACT_APP_FCM_VAPID_KEY || '';

let app = null;
let messaging = null;

// Returns a messaging instance, or null if unsupported / not configured.
export async function initMessaging() {
  try {
    if (!(await isSupported())) return null;
    if (!firebaseConfig.apiKey || !firebaseConfig.messagingSenderId) return null;
    if (!app) app = initializeApp(firebaseConfig);
    if (!messaging) messaging = getMessaging(app);
    return messaging;
  } catch {
    return null;
  }
}

export { getToken, onMessage };
