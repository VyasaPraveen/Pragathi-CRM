// ============================================================================
// Data primitives — same signatures as the old Firestore helpers, but backed
// by the Hostinger PHP/MySQL API. Realtime onSnapshot is emulated with light
// polling (+ refresh on window focus). Pages that used these keep working
// unchanged.
// ============================================================================

import { apiGet, apiPost, apiPatch, apiDelete, getMe } from './api';

const POLL_MS = 15000;

// After a write, ask listeners for the affected collection to refetch now, so
// changes appear immediately instead of waiting for the next poll tick.
function pingRefresh(col) {
  try { window.dispatchEvent(new CustomEvent('pps:refresh', { detail: { col } })); } catch { /* ignore */ }
}

// ── string sanitisation (defensive, ported from the old layer) ───────────────
function sanitizeString(str) {
  return str
    .trim()
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<embed[^>]*>/gi, '')
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/data\s*:\s*text\/html/gi, '')
    .replace(/vbscript\s*:/gi, '');
}
function trimStrings(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') out[k] = sanitizeString(v);
    else if (Array.isArray(v)) out[k] = v.map(item => (typeof item === 'object' && item !== null) ? trimStrings(item) : (typeof item === 'string' ? sanitizeString(item) : item));
    else if (typeof v === 'object' && v !== null) out[k] = trimStrings(v);
    else out[k] = v;
  }
  return out;
}

// ── client-side sort to preserve the old orderBy contract ────────────────────
function sortDocs(docs, ob = 'createdAt', dir = 'desc') {
  const mul = dir === 'asc' ? 1 : -1;
  return [...docs].sort((a, b) => {
    const av = a[ob], bv = b[ob];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av < bv) return -1 * mul;
    if (av > bv) return 1 * mul;
    return 0;
  });
}

// Poll a collection; cb(docs, err). Returns an unsubscribe function.
export function listenCollection(col, cb, ob = 'createdAt', dir = 'desc') {
  let stopped = false;
  let timer = null;

  const tick = async () => {
    try {
      // 'users' is a special table exposed via /auth/users (admin-only); everything
      // else is a generic document collection.
      let docs;
      if (col === 'users') {
        const res = await apiGet('/auth/directory');
        docs = res && Array.isArray(res.users) ? res.users : [];
      } else {
        docs = await apiGet('/collections/' + encodeURIComponent(col));
      }
      if (!stopped) cb(sortDocs(Array.isArray(docs) ? docs : [], ob, dir), null);
    } catch (err) {
      if (!stopped) cb([], err);
    } finally {
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    }
  };

  const onFocus = () => { if (!stopped) tick(); };
  const onRefresh = (e) => { if (!stopped && (!e.detail || e.detail.col === col)) tick(); };
  window.addEventListener('focus', onFocus);
  window.addEventListener('pps:refresh', onRefresh);
  tick();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('pps:refresh', onRefresh);
  };
}

export async function addDocument(col, data) {
  const res = await apiPost('/collections/' + encodeURIComponent(col), trimStrings(data));
  pingRefresh(col);
  logActivity('Created', col, data.name || data.customerName || data.title || data.type || res.id);
  return res.id;
}

export async function updateDocument(col, id, data) {
  await apiPatch('/collections/' + encodeURIComponent(col) + '/' + encodeURIComponent(id), trimStrings(data));
  pingRefresh(col);
  logActivity('Updated', col, data.name || data.customerName || data.title || data.status || id);
}

export async function deleteDocument(col, id) {
  await apiDelete('/collections/' + encodeURIComponent(col) + '/' + encodeURIComponent(id));
  pingRefresh(col);
  logActivity('Deleted', col, id);
}

// ── Notifications (stored in the notifications collection) ────────────────────
export async function createNotification({ forUser, title, message, type = 'info', module = '', relatedId = '' }) {
  try {
    const me = getMe();
    await apiPost('/collections/notifications', {
      forUser, title, message, type, module, relatedId,
      read: false,
      fromUser: me?.displayName || me?.email || 'System',
    });
  } catch (e) { /* non-critical */ }
}

export async function notifyAdmins(users, { title, message, type = 'info', module = '', relatedId = '' }) {
  const admins = (users || []).filter(u => u.role === 'admin' || u.role === 'super_admin' || u.role === 'management');
  for (const admin of admins) {
    await createNotification({ forUser: admin.displayName || admin.email, title, message, type, module, relatedId });
  }
}

export async function logActivity(action, module, details = '') {
  try {
    const me = getMe();
    await apiPost('/collections/activityLog', {
      action, module, details,
      user: me?.displayName || me?.email || 'unknown',
      userEmail: me?.email || '',
      timestamp: new Date().toISOString(),
    });
  } catch (e) { /* non-critical */ }
}
