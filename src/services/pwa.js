// ============================================================================
// The app on the phone (28-Oct, PWA): installing it, and the service worker
// that makes it load fast and open offline.
//
// Nothing here changes what the app does. The data still comes from the
// Hostinger API on every load and every 15 seconds, so every user on every
// device sees the same record; the service worker caches only the app's own
// files (never /api/ or /uploads/), and index.html is always fetched from
// the network first so a new deploy is picked up at once.
// ============================================================================

let deferredPrompt = null;
const listeners = new Set();
const tell = () => listeners.forEach(fn => { try { fn(canInstall()); } catch (e) { /* a listener's problem */ } });

// Is the app running as the installed app rather than in a browser tab?
export function isStandalone() {
  try {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  } catch (e) { return false; }
}
// iPhone / iPad (where the browser never offers an install prompt — the
// person uses Share → "Add to Home Screen").
export const isIOS = (ua) => {
  const s = ua || (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  return /iPad|iPhone|iPod/.test(s) || (/Macintosh/.test(s) && typeof document !== 'undefined' && 'ontouchend' in document);
};
// The browser has offered to install and the app is not installed yet.
export const canInstall = () => !!deferredPrompt && !isStandalone();

// Call once, as early as possible: the browser fires `beforeinstallprompt`
// only once per page load, and only after the page qualifies.
export function watchInstall() {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; tell(); });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; tell(); });
}
export function onInstallChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// Show the browser's install dialog. 'accepted' | 'dismissed' | 'unavailable'.
export async function promptInstall() {
  if (!deferredPrompt) return 'unavailable';
  const p = deferredPrompt;
  deferredPrompt = null;
  tell();
  try {
    p.prompt();
    const r = await p.userChoice;
    return r && r.outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch (e) { return 'dismissed'; }
}

// "Not now" on the install banner is remembered for a week.
const DISMISS_KEY = 'pps:install-dismissed';
const DISMISS_FOR = 7 * 24 * 60 * 60 * 1000;
export function installDismissed(now = Date.now()) {
  try { const t = Number(localStorage.getItem(DISMISS_KEY) || 0); return t > 0 && now - t < DISMISS_FOR; } catch (e) { return false; }
}
export function dismissInstall(now = Date.now()) {
  try { localStorage.setItem(DISMISS_KEY, String(now)); } catch (e) { /* private mode */ }
}

// What the install banner shows: 'prompt' (a button that installs), 'ios'
// (the Share → Add to Home Screen hint) or '' (nothing).
export function installHint({ installable, standalone, ios, dismissed }) {
  if (standalone || dismissed) return '';
  if (installable) return 'prompt';
  if (ios) return 'ios';
  return '';
}

// Register the app-shell worker (production only). `onUpdated` fires when a
// newer version has taken over an already-open app, so the person can reload
// when convenient; nothing reloads by itself under a half-filled form.
export function registerServiceWorker(onUpdated) {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  if (process.env.NODE_ENV !== 'production') return;
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      const hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hadController && typeof onUpdated === 'function') onUpdated();
      });
      // Look for a newer version each time the app comes back to the front.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    } catch (e) { /* the app works without it */ }
  });
}

// Is the device online? (navigator.onLine is a hint, not a guarantee, so the
// app also refetches when the browser says the connection is back.)
export const isOnline = () => (typeof navigator === 'undefined' || navigator.onLine !== false);
