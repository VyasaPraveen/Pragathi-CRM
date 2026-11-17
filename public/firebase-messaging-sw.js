/* ==========================================================================
 * Firebase Cloud Messaging service worker — handles PUSH notifications while
 * the CRM tab is in the background or closed. Runs on the Spark plan (messages
 * are sent from our own PHP backend, never Cloud Functions).
 *
 * The config values below are PUBLIC Firebase web identifiers (the same ones
 * shipped in the app bundle) — they are not secrets. The Web-Push VAPID key and
 * the service-account key are the sensitive parts, and neither lives here.
 * ========================================================================== */
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyDeOuW-3Al8FUHtJQ0LzUl1Wxo7IHCdTtE',
  authDomain: 'pps-crm-new.firebaseapp.com',
  projectId: 'pps-crm-new',
  storageBucket: 'pps-crm-new.firebasestorage.app',
  messagingSenderId: '730038815221',
  appId: '1:730038815221:web:658e7c6ad40cd3c671f8bc',
});

const messaging = firebase.messaging();

// A push arrived while the app is not in the foreground → show an OS notification.
messaging.onBackgroundMessage((payload) => {
  const n = payload.notification || {};
  const data = payload.data || {};
  self.registration.showNotification(n.title || 'Pragathi Power CRM', {
    body: n.body || '',
    icon: '/logo.png',
    badge: '/logo.png',
    tag: data.relatedId || undefined, // collapse duplicates for the same record
    data: { link: data.link || '/' },
  });
});

// Tapping the notification must land the employee on the screen it is about:
// focus an open tab and navigate it to the link, or open a new tab on the link.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/';
  const url = new URL(link, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (wins) => {
      for (const w of wins) {
        if (!('focus' in w)) continue;
        try {
          const focused = await w.focus();
          const target = focused || w;
          // Same-origin client → route it to the deep link. `navigate` is not
          // available in every browser, so fall back to telling the app to route.
          if (typeof target.navigate === 'function') {
            try { await target.navigate(url); return; } catch (e) { /* fall through */ }
          }
          if (typeof target.postMessage === 'function') target.postMessage({ type: 'pps:navigate', link });
          return;
        } catch (e) { /* try the next window */ }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
