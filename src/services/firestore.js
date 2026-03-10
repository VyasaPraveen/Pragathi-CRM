import { db, auth } from './firebase';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot,
  query, orderBy, serverTimestamp
} from 'firebase/firestore';

export function listenCollection(col, cb, ob = 'createdAt', dir = 'desc') {
  let q;
  try {
    q = query(collection(db, col), orderBy(ob, dir));
  } catch (e) {
    // Fallback to unordered if index missing
    q = collection(db, col);
  }
  return onSnapshot(q, snap => {
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() })), null);
  }, err => cb([], err));
}

function trimStrings(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}

export async function addDocument(col, data) {
  const ref = await addDoc(collection(db, col), {
    ...trimStrings(data),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: auth.currentUser?.email || 'unknown'
  });
  logActivity('Created', col, data.name || data.customerName || data.title || data.type || ref.id);
  return ref.id;
}

export async function updateDocument(col, id, data) {
  await updateDoc(doc(db, col, id), {
    ...trimStrings(data),
    updatedAt: serverTimestamp(),
    updatedBy: auth.currentUser?.email || 'unknown'
  });
  logActivity('Updated', col, data.name || data.customerName || data.title || data.status || id);
}

export async function deleteDocument(col, id) {
  await deleteDoc(doc(db, col, id));
  logActivity('Deleted', col, id);
}

// Notification helper — creates a notification for a specific user
export async function createNotification({ forUser, title, message, type = 'info', module = '', relatedId = '' }) {
  try {
    await addDoc(collection(db, 'notifications'), {
      forUser,       // team member name (matched to logged-in user displayName)
      title,
      message,
      type,          // 'lead', 'customer', 'task', 'status_update', 'info'
      module,
      relatedId,
      read: false,
      fromUser: auth.currentUser?.displayName || auth.currentUser?.email || 'System',
      createdAt: serverTimestamp()
    });
  } catch (e) {
    // Non-critical — swallow silently
  }
}

// Send notification to all admin/super_admin users
export async function notifyAdmins(users, { title, message, type = 'info', module = '', relatedId = '' }) {
  const admins = users.filter(u => u.role === 'admin' || u.role === 'super_admin');
  for (const admin of admins) {
    await createNotification({ forUser: admin.displayName || admin.email, title, message, type, module, relatedId });
  }
}

// Activity log helper
export async function logActivity(action, module, details = '') {
  try {
    await addDoc(collection(db, 'activityLog'), {
      action,
      module,
      details,
      user: auth.currentUser?.displayName || auth.currentUser?.email || 'unknown',
      userEmail: auth.currentUser?.email || '',
      timestamp: serverTimestamp(),
      createdAt: serverTimestamp()
    });
  } catch (e) {
    // Activity log write failed — non-critical, swallow silently
  }
}
