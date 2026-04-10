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

// Security: strip dangerous HTML/script patterns from all string fields before Firestore write
function sanitizeString(str) {
  return str
    .trim()
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')  // strip <script> tags
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')  // strip <iframe> tags
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '') // strip <object> tags
    .replace(/<embed[^>]*>/gi, '')                                       // strip <embed> tags
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')                        // strip inline event handlers (onerror=, onclick=, etc.)
    .replace(/javascript\s*:/gi, '')                                     // strip javascript: URIs
    .replace(/data\s*:\s*text\/html/gi, '')                              // strip data:text/html URIs
    .replace(/vbscript\s*:/gi, '');                                      // strip vbscript: URIs
}

function trimStrings(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') {
      out[k] = sanitizeString(v);
    } else if (Array.isArray(v)) {
      out[k] = v.map(item => (typeof item === 'object' && item !== null) ? trimStrings(item) : (typeof item === 'string' ? sanitizeString(item) : item));
    } else if (typeof v === 'object' && v !== null && typeof v.toDate !== 'function') {
      out[k] = trimStrings(v);  // recurse into nested objects (but not Firestore Timestamps)
    } else {
      out[k] = v;
    }
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
