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

export function sendWhatsApp(phone, msg) {
  if (phone) {
    window.open('https://wa.me/91' + phone + '?text=' + encodeURIComponent(msg), '_blank');
  }
}

export const statusClass = (s) => {
  const m = {
    'Interested': 'st-b', 'Not Interested': 'st-r', 'Converted': 'st-g', 'Not Converted': 'st-x',
    'Active': 'st-g', 'Pending': 'st-o', 'Completed': 'st-g', 'In Progress': 'st-o', 'Delayed': 'st-r',
    'Approved': 'st-g', 'Sent': 'st-g', 'On Leave': 'st-o', 'Not Applied': 'st-x', 'Done': 'st-g',
    'Rejected': 'st-r', 'Released': 'st-g', 'New Lead': 'st-b', 'Follow-up': 'st-o',
    'Negotiating': 'st-p', 'No Response': 'st-r'
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

// Q5 fix: dynamic days-in-month instead of hardcoded 30
export function getDaysInMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}
