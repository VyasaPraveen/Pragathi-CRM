export function formatCurrency(n) {
  return n == null || isNaN(n) ? '₹0' : '₹' + Number(n).toLocaleString('en-IN');
}

export function formatDate(d) {
  if (!d) return '-';
  const dt = d.toDate ? d.toDate() : new Date(d);
  return isNaN(dt) ? String(d) : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function getInitials(name) {
  return name ? name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) : '?';
}

export function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function sendWhatsApp(phone, msg) {
  if (!phone) return;
  const cleaned = String(phone).replace(/\D/g, '');
  if (cleaned.length < 10) return;
  const num = cleaned.length === 10 ? '91' + cleaned : cleaned;
  const w = window.open('https://wa.me/' + num + '?text=' + encodeURIComponent(msg), '_blank');
  if (!w) alert('Popup blocked — please allow popups for WhatsApp sharing.');
}

export const statusClass = (s) => {
  const m = {
    'Interested': 'st-b', 'Not Interested': 'st-r', 'Converted': 'st-g', 'Not Converted': 'st-x',
    'Active': 'st-g', 'Pending': 'st-o', 'Completed': 'st-g', 'In Progress': 'st-o', 'Delayed': 'st-r',
    'Approved': 'st-g', 'Sent': 'st-g', 'On Leave': 'st-o', 'Not Applied': 'st-x', 'Done': 'st-g',
    'Rejected': 'st-r', 'Released': 'st-g', 'New Lead': 'st-b', 'Follow-up': 'st-o',
    'Negotiating': 'st-p', 'No Response': 'st-r',
    'On Hold': 'st-x', 'Included': 'st-g', 'Paid': 'st-g',
    'Hot': 'st-r', 'Warm': 'st-o', 'Cold': 'st-b',
    'Draft': 'st-x', 'Partial': 'st-o', 'Received': 'st-g', 'Cancelled': 'st-r',
    'Dealer': 'st-b', 'Distributor': 'st-p', 'Channel Partner': 'st-o',
    'Overdue': 'st-r', 'High': 'st-r', 'Medium': 'st-o', 'Low': 'st-g',
    'Inactive': 'st-x',
    'Unapproved': 'st-o', 'Recommended': 'st-b'
  };
  return m[s] || 'st-x';
};

// D1/D3 fix: safe number conversion to prevent NaN in Firestore
export function toNumber(val, fallback = 0) {
  const n = Number(val);
  return isNaN(n) ? fallback : n;
}

// B4 fix: null-safe string for search filters
export function safeStr(val) {
  return val ? String(val) : '';
}

export function daysSince(dateVal) {
  if (!dateVal) return null;
  const dt = typeof dateVal === 'string' ? new Date(dateVal) : (dateVal.toDate ? dateVal.toDate() : new Date(dateVal));
  if (isNaN(dt)) return null;
  const diff = Math.floor((new Date() - dt) / (1000 * 60 * 60 * 24));
  return diff >= 0 ? diff : 0;
}

export const priorityClass = (p) => {
  const m = { 'Hot': 'st-r', 'Warm': 'st-o', 'Cold': 'st-b', 'High': 'st-r', 'Medium': 'st-o', 'Low': 'st-g' };
  return m[p] || 'st-x';
};

// Role hierarchy levels — higher number = more access
export const ROLE_LEVELS = {
  super_admin: 6, admin: 5, manager: 4, coordinator: 3, engineer: 2, staff: 1
};

// Check if user's role meets minimum required access level
export function hasAccess(userRole, minRole) {
  return (ROLE_LEVELS[userRole] || 0) >= (ROLE_LEVELS[minRole] || 0);
}

// Designations config — maps display titles to access levels (role)
export const DESIGNATIONS = [
  { label: 'Super Admin', role: 'super_admin' },
  { label: 'Admin', role: 'admin' },
  { label: 'Technical Manager', role: 'manager' },
  { label: 'Operations Manager', role: 'manager' },
  { label: 'Sales Manager', role: 'manager' },
  { label: 'Admin Manager', role: 'manager' },
  { label: 'Business Coordinator', role: 'coordinator' },
  { label: 'Quality Coordinator', role: 'coordinator' },
  { label: 'Accountant', role: 'coordinator' },
  { label: 'Senior Engineer', role: 'engineer' },
  { label: 'Engineer', role: 'engineer' },
  { label: 'Staff', role: 'staff' },
];

export function getRoleFromDesignation(designation) {
  const found = DESIGNATIONS.find(d => d.label === designation);
  return found ? found.role : 'staff';
}

// Make a phone call via tel: link
export function makeCall(phone) {
  if (!phone) return;
  const cleaned = String(phone).replace(/\D/g, '');
  if (cleaned.length < 10) return;
  window.open('tel:+91' + (cleaned.length === 10 ? cleaned : cleaned.slice(-10)), '_self');
}

// Security: validate URL is safe (blocks javascript:, data:text/html, vbscript:, etc.)
export function isSafeUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim().toLowerCase();
  const blocked = ['javascript', 'vbscript'];
  if (blocked.some(proto => trimmed.startsWith(proto + ':'))) return false;
  if (trimmed.startsWith('data:') && !trimmed.startsWith('data:image/')) return false;
  try { const parsed = new URL(url); return ['http:', 'https:'].includes(parsed.protocol); }
  catch { return false; }
}

// Security: safe HTML print — uses Blob URL instead of document.write to prevent DOM injection
export function openHtmlSafely(html, shouldPrint = false) {
  const blob = new Blob([html], { type: 'text/html; charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (!w) { alert('Popup blocked — please allow popups.'); URL.revokeObjectURL(url); return; }
  w.addEventListener('afterprint', () => URL.revokeObjectURL(url));
  if (shouldPrint) w.addEventListener('load', () => w.print());
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Q5 fix: dynamic days-in-month instead of hardcoded 30
export function getDaysInMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}
