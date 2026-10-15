// ============================================================================
// Pragathi CRM — REST API client (replaces the Firebase SDK).
// Talks to the PHP backend at /api (same origin as the CRM), with a JWT stored
// in localStorage. Kept intentionally small; higher-level helpers live in
// firestore.js (same signatures as before) so pages don't change.
// ============================================================================

const BASE = process.env.REACT_APP_API_BASE || '/api';
const TOKEN_KEY = 'pps_crm_token';

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}
export function setToken(t) {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}

// Lightweight current-user holder so non-React modules (firestore.js) can stamp
// createdBy / notification author without importing React context.
let _me = null;
export function setMe(u) { _me = u; }
export function getMe() { return _me; }

// Called when an authenticated request comes back 401 (expired/invalid token),
// so the app can log the user out instead of silently showing empty data.
let _onUnauthorized = null;
export function setUnauthorizedHandler(fn) { _onUnauthorized = fn; }

async function request(path, { method = 'GET', body, auth = true, isForm = false, skipAuthHandler = false } = {}) {
  const headers = {};
  if (!isForm) headers['Content-Type'] = 'application/json';
  if (auth) {
    const t = getToken();
    if (t) headers['Authorization'] = 'Bearer ' + t;
  }
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers,
      body: isForm ? body : (body != null ? JSON.stringify(body) : undefined),
    });
  } catch (e) {
    throw new Error('Network error — please check your connection.');
  }
  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { data = { error: text }; } }
  if (!res.ok) {
    // An authenticated request came back 401. Hand it to the app to decide
    // whether the session is really dead (it verifies before logging out) — but
    // never for the verification call itself (skipAuthHandler), to avoid a loop.
    if (res.status === 401 && auth && _onUnauthorized && !skipAuthHandler) _onUnauthorized();
    const msg = (data && data.error) ? data.error : `Request failed (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const apiGet    = (path, opts)       => request(path, { ...opts, method: 'GET' });
export const apiPost   = (path, body, opts) => request(path, { ...opts, method: 'POST', body });
export const apiPut    = (path, body, opts) => request(path, { ...opts, method: 'PUT', body });
export const apiPatch  = (path, body, opts) => request(path, { ...opts, method: 'PATCH', body });
export const apiDelete = (path, opts)       => request(path, { ...opts, method: 'DELETE' });

// Multipart file upload → { url, name }
export async function apiUpload(file, folder = 'files') {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('folder', folder);
  return request('/upload', { method: 'POST', body: fd, isForm: true });
}
