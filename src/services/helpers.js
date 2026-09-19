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

// Today's date as YYYY-MM-DD, on the calendar the employee is actually living
// on. toISOString() gives the UTC day, and India runs 5:30 ahead of UTC, so
// between midnight and 05:30 the UTC day is still yesterday — an early-morning
// site check-in was being filed against the previous day, leaving that day with
// a check-in and no check-out, and the real day with only a check-out. The same
// slip dated leave, purchase orders, expenditures and follow-ups a day early.
export function todayStr(d = new Date()) {
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt)) return '';
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// The YYYY-MM key the dashboard and My Reports group by.
export const thisMonthStr = (d = new Date()) => todayStr(d).slice(0, 7);

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
    'Requested': 'st-o', 'Verified': 'st-b', 'Management Approved': 'st-p',
    'Proposal Submitted': 'st-b', 'Closed': 'st-g',
    'Awaiting Replacement': 'st-o', 'Awaiting Manager': 'st-b',
    // Quotation workflow
    'Pending Approval': 'st-o', 'Shared with Customer': 'st-b',
    'Accepted': 'st-g', 'Not Accepted': 'st-r', 'Pending Follow-up': 'st-o'
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
  coordinator: 3, accountant: 3, bco: 3, team_leader: 3,
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
  { label: 'Team Leader', role: 'team_leader' },
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

// Where a notification about `module` should take the user when it is tapped.
// Mirrors module_link() in server/api/routes/collections.php, which builds the
// deep link for push notifications — keep the two in step.
export const MODULE_ROUTES = {
  leads: '/leads', quotations: '/leads', customers: '/customers', employeeTasks: '/tasks',
  tasks: '/tasks', installations: '/installations', ongoingWork: '/ongoing',
  materials: '/materials', purchaseOrders: '/purchase-orders', leadPOs: '/purchase-orders',
  revenue: '/revenue', expenditure: '/expenditure', expenditures: '/expenditure',
  paymentRequests: '/payment-requests', reports: '/reports', team: '/team',
  attendance: '/attendance', tracking: '/tracking', leaveRequests: '/leave',
  leave: '/leave', reminders: '/reminders', retailers: '/retailers',
  influencers: '/influencers', gallery: '/gallery', users: '/user-management',
};

export const moduleRoute = (module) => MODULE_ROUTES[module] || '/';

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
  // An inline image (the workflow tab compresses stage photos to a data URL) is
  // allowed, but never SVG — that one can carry script. Everything else on a
  // data: URL is refused. These return early because the URL parse below only
  // recognises http/https, which used to reject every data: URL and made the
  // line above look like it permitted something it never did.
  if (trimmed.startsWith('data:')) {
    return trimmed.startsWith('data:image/') && !trimmed.startsWith('data:image/svg');
  }
  // Resolve against the current origin so same-origin RELATIVE URLs (e.g. our own
  // "/uploads/..." files from device uploads) are recognised as safe, not just
  // absolute http/https URLs. Falls back to a dummy base outside the browser.
  try {
    const base = (typeof window !== 'undefined' && window.location) ? window.location.origin : 'https://localhost';
    const parsed = new URL(url, base);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch { return false; }
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

// Names compare as people type them, so casing and stray spaces never leave the
// same person on two lists at once.
export const normName = (v) => String(v || '').trim().toLowerCase();

// The names offered as Supporting Team on a lead: the active team members,
// minus anyone already named in a field above (Team Leader / Assigned To /
// Sales Executive) and anyone already on the list.
// Does a stored name or email refer to this person? Records carry whichever of
// the two the screen that wrote them had to hand — a lead assignment stores the
// display name, an expenditure stores the email — so both have to be accepted.
// Matching is done on the trimmed, lower-cased value: a stray capital or a
// trailing space in a display name used to mean the notification was written
// but never shown to anybody.
export function isSameUser(value, user) {
  const v = normName(value);
  if (!v) return false;
  return v === normName(user && user.email) || v === normName(user && user.displayName);
}

export function supportingTeamOptions(team, usedAbove = [], selected = []) {
  const blocked = [...usedAbove, ...selected].map(normName).filter(Boolean);
  const out = [];
  (team || []).forEach(t => {
    const name = t && t.name;
    if (!name || t.status !== 'Active') return;
    const k = normName(name);
    if (blocked.includes(k) || out.some(n => normName(n) === k)) return;
    out.push(name);
  });
  return out;
}

// Shrink a picked photo before it is uploaded.
//
// Phone photos are 4–12 MB and 12 megapixels. Decoding one the obvious way —
// `new Image()` onto a full-size canvas — allocates roughly width x height x 4
// bytes (about 48 MB for a 12 MP shot) before anything is scaled down, and on a
// phone that is already short on memory that allocation is what tips it over.
// `createImageBitmap` with resize options decodes straight to the size we want,
// so the big bitmap never exists. The old path is kept for browsers without it,
// and any failure at all just returns the original file.
export async function compressImage(file, maxDim = 1600, quality = 0.82) {
  try {
    if (!file || !/^image\//.test(file.type) || typeof document === 'undefined') return file;
    // A small photo is already fine — don't re-encode it for nothing.
    if (file.size <= 512 * 1024) return file;

    const toJpeg = async (canvas) => {
      const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
      canvas.width = 0; canvas.height = 0;            // release the backing store
      if (!blob || blob.size >= file.size) return file;
      const name = (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg';
      try { return new File([blob], name, { type: 'image/jpeg' }); }
      catch { return blob; }
    };

    if (typeof createImageBitmap === 'function') {
      // Decode at the target size. resizeWidth alone keeps the aspect ratio,
      // and the browser picks the smaller edge for us.
      let bmp;
      try {
        bmp = await createImageBitmap(file, { resizeWidth: maxDim, resizeQuality: 'medium' });
        // A portrait photo comes back taller than maxDim; scale it down again.
        if (bmp.height > maxDim) {
          const shrunk = await createImageBitmap(file, { resizeHeight: maxDim, resizeQuality: 'medium' });
          bmp.close();
          bmp = shrunk;
        }
      } catch {
        bmp = await createImageBitmap(file);           // no resize support
      }
      const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bmp.width * scale));
      canvas.height = Math.max(1, Math.round(bmp.height * scale));
      canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
      bmp.close();
      return await toJpeg(canvas);
    }

    // Older browsers: decode through an <img>, which costs more memory.
    return await new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = async () => {
        try {
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(url);
          resolve(await toJpeg(canvas));
        } catch { URL.revokeObjectURL(url); resolve(file); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  } catch { return file; }
}

// Q5 fix: dynamic days-in-month instead of hardcoded 30
export function getDaysInMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}
