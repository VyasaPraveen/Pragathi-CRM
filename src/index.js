import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { watchInstall, registerServiceWorker } from './services/pwa';

// The app on the phone (PWA): remember the browser's install offer, and run
// the app-shell service worker. A newer version taking over an open app is
// announced inside the app (AppLayout listens for this event).
watchInstall();
registerServiceWorker(() => { try { window.dispatchEvent(new CustomEvent('pps:updated')); } catch (e) { /* ignore */ } });

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
