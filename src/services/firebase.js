// ============================================================================
// Firebase is now used ONLY for Cloud Messaging (push notifications), which is
// free on the Spark plan. All data + auth + storage moved to the Hostinger API.
// Messaging is initialised lazily so the app works even where it's unsupported.
// ============================================================================

// The Firebase SDK is loaded on demand (PWA, 28-Oct): it is the largest
// library in the app and only push registration needs it, so it stays out
// of the bundle the phone downloads to show the first screen.
let sdk = null;
async function load() {
  if (!sdk) {
    const [app, messaging] = await Promise.all([import('firebase/app'), import('firebase/messaging')]);
    sdk = { initializeApp: app.initializeApp, getMessaging: messaging.getMessaging, getToken: messaging.getToken, onMessage: messaging.onMessage, isSupported: messaging.isSupported };
  }
  return sdk;
}

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
    if (!firebaseConfig.apiKey || !firebaseConfig.messagingSenderId) return null;
    const { isSupported, initializeApp, getMessaging } = await load();
    if (!(await isSupported())) return null;
    if (!app) app = initializeApp(firebaseConfig);
    if (!messaging) messaging = getMessaging(app);
    return messaging;
  } catch {
    return null;
  }
}

export const getToken = async (...args) => (await load()).getToken(...args);
export const onMessage = async (...args) => (await load()).onMessage(...args);
