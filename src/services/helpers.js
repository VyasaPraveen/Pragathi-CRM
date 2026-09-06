export function formatCurrency(n) {
  return n == null || isNaN(n) ? '₹0' : '₹' + Number(n).toLocaleString('en-IN');
}

// All dates display as Date-Month-Year (DD-MM-YYYY) for consistency across the app.
export function formatDate(d) {
  if (!d) return '-';
  const dt = d.toDate ? d.toDate() : new Date(d);
  if (isNaN(dt)) return String(d);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yyyy = dt.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
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
    'Unapproved': 'st-o', 'Recommended': 'st-b',
    'Requested': 'st-o', 'Verified': 'st-b', 'Management Approved': 'st-p'
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

// Role hierarchy levels — higher number = more access.
// The 9 business roles sit alongside the legacy roles (kept for backward
// compatibility with existing user documents). See permissions.js for the
// action-level matrix that governs specific workflow steps.
export const ROLE_LEVELS = {
  super_admin: 7,
  management: 6,
  admin: 5,
  // Manager-tier (level 4)
  manager: 4, operation_manager: 4, technical_manager: 4, sales_manager: 4, warehouse_admin: 4,
  // Coordinator-tier (level 3)
  coordinator: 3, accountant: 3, bco: 3,
  // Field/operational-tier (level 2)
  engineer: 2, executive: 2, technician: 2,
  staff: 1
};

// Check if user's role meets minimum required access level
export function hasAccess(userRole, minRole) {
  return (ROLE_LEVELS[userRole] || 0) >= (ROLE_LEVELS[minRole] || 0);
}

// Designations config — the 9 official roles (+ Super Admin owner account).
// Each maps to its canonical role key used throughout the app.
export const DESIGNATIONS = [
  { label: 'Super Admin', role: 'super_admin' },
  { label: 'Management', role: 'management' },
  { label: 'Admin', role: 'admin' },
  { label: 'Operation Manager', role: 'operation_manager' },
  { label: 'Technical Manager', role: 'technical_manager' },
  { label: 'Sales Manager', role: 'sales_manager' },
  { label: 'Accountant', role: 'accountant' },
  { label: 'BCO', role: 'bco' },
  { label: 'Executive', role: 'executive' },
  { label: 'Technician', role: 'technician' },
  { label: 'Warehouse Admin', role: 'warehouse_admin' },
];

// Legacy designation labels → nearest new role (so re-assigning an old
// designation still resolves to a valid role instead of dropping to staff).
const LEGACY_DESIGNATION_ALIASES = {
  'Operations Manager': 'operation_manager',
  'Admin Manager': 'admin',
  'Business Coordinator': 'bco',
  'Quality Coordinator': 'operation_manager',
  'Senior Engineer': 'technician',
  'Engineer': 'technician',
  'Staff': 'executive',
};

export function getRoleFromDesignation(designation) {
  const found = DESIGNATIONS.find(d => d.label === designation);
  if (found) return found.role;
  if (LEGACY_DESIGNATION_ALIASES[designation]) return LEGACY_DESIGNATION_ALIASES[designation];
  return 'staff';
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
