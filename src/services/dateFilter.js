// ============================================================================
// The common Day / Month filter (R2 and R15, 8-Oct).
//
// Every list in the app can now be narrowed to one month or one day. The
// filter only chooses what is shown — nothing here writes, and a record that
// is filtered out is simply not in the list until the filter is cleared.
//
// A record's "day" is the first of its date fields that holds a value. A plain
// calendar date ("2026-10-02") is taken as it is; a timestamp (a createdAt, an
// approvedAt) is placed on the Indian calendar day it fell on, which is the
// day the person who made it would say it happened on.
// ============================================================================

const DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})(?:$|[T ])/;
const IST = 'Asia/Kolkata';

// All records — the state every list starts in, so nothing looks different
// until somebody picks a month or a day.
export const DATE_FILTER_ALL = { mode: 'all', month: '', date: '' };

export const thisMonthFilter = (todayStr) => ({ mode: 'month', month: String(todayStr || '').slice(0, 7), date: '' });

// "2026-10-02T18:09:00Z" → "2026-10-03" (the IST day), "2026-10-02" → itself.
export function recordDay(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    const m = DATE_PREFIX.exec(value.trim());
    // A bare date needs no time-zone thought; a timestamp does.
    if (m && m[0] === m[1]) return m[1];
  }
  const dt = value && value.toDate ? value.toDate() : new Date(value);
  if (isNaN(dt)) return '';
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(dt);
  const get = (t) => (parts.find(p => p.type === t) || {}).value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// The day a record belongs to, from the first of `fields` that holds a value.
export function recordDayOf(rec, fields) {
  if (!rec) return '';
  for (const f of fields || []) {
    const day = recordDay(rec[f]);
    if (day) return day;
  }
  return '';
}

// Does this record fall inside the filter?
export function matchesDateFilter(rec, filter, fields) {
  const f = filter || DATE_FILTER_ALL;
  if (!f.mode || f.mode === 'all') return true;
  // A mode with nothing chosen yet narrows nothing.
  if (f.mode === 'date' && !f.date) return true;
  if (f.mode === 'month' && !f.month) return true;
  const day = recordDayOf(rec, fields);
  if (f.mode === 'date') return day === f.date;
  if (f.mode === 'month') return day.slice(0, 7) === f.month;
  return true;
}

export const applyDateFilter = (records, filter, fields) =>
  (records || []).filter(r => matchesDateFilter(r, filter, fields));

// The months worth offering: every month the records fall in, plus this month
// and last month, newest first.
export function dateFilterMonths(records, fields, todayStr) {
  const set = new Set();
  (records || []).forEach(r => { const d = recordDayOf(r, fields); if (d) set.add(d.slice(0, 7)); });
  const now = String(todayStr || '').slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(now)) {
    set.add(now);
    const y = Number(now.slice(0, 4)), m = Number(now.slice(5, 7));
    set.add(m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`);
  }
  return [...set].filter(Boolean).sort().reverse();
}

// "2026-10" → "October 2026"
export function monthName(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m) return String(month || '');
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${names[Number(m[2]) - 1] || m[2]} ${m[1]}`;
}

// What the filter is showing, in words — for the "showing" line and the empty state.
export function dateFilterLabel(filter) {
  const f = filter || DATE_FILTER_ALL;
  if (f.mode === 'month' && f.month) return monthName(f.month);
  if (f.mode === 'date' && f.date) {
    const [y, m, d] = f.date.split('-');
    return `${d}-${m}-${y}`;
  }
  return 'All dates';
}

export const isDateFiltered = (filter) => !!filter && filter.mode !== 'all' && !!(filter.mode === 'month' ? filter.month : filter.date);
