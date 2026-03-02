import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: process.env.REACT_APP_FB_API_KEY || "AIzaSyDeOuW-3Al8FUHtJQ0LzUl1Wxo7IHCdTtE",
  authDomain: process.env.REACT_APP_FB_AUTH_DOMAIN || "pps-crm-new.firebaseapp.com",
  projectId: process.env.REACT_APP_FB_PROJECT_ID || "pps-crm-new",
  storageBucket: process.env.REACT_APP_FB_STORAGE_BUCKET || "pps-crm-new.firebasestorage.app",
  messagingSenderId: process.env.REACT_APP_FB_MESSAGING_ID || "730038815221",
  appId: process.env.REACT_APP_FB_APP_ID || "1:730038815221:web:658e7c6ad40cd3c671f8bc"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// B6 fix: replaced deprecated enableIndexedDbPersistence with modern persistence API
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

export const storage = getStorage(app);
export default app;
