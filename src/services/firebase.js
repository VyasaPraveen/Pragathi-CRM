import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDeOuW-3Al8FUHtJQ0LzUl1Wxo7IHCdTtE",
  authDomain: "pps-crm-new.firebaseapp.com",
  projectId: "pps-crm-new",
  storageBucket: "pps-crm-new.firebasestorage.app",
  messagingSenderId: "730038815221",
  appId: "1:730038815221:web:658e7c6ad40cd3c671f8bc"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// B6 fix: replaced deprecated enableIndexedDbPersistence with modern persistence API
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

export default app;
