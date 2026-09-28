// ============================================================================
// Attendance calculations.
//
// Marks are stored one row per tap ("Check In" at 09:05, "Check Out" at 18:20).
// Everything the employee actually wants to see — the day's status, the hours
// worked, how many days they were present this month — is worked out from those
// rows here, so the figures always follow the records instead of being counted
// separately and drifting away from them.
// ============================================================================

export const CHECK_IN = 'Check In';
export const CHECK_OUT = 'Check Out';

const norm = (v) => String(v || '').trim().toLowerCase();

// Is this row this person's? Older rows carry only the name, newer ones the
// email as well, so either identifies them.
export function isMine(record, { email, name } = {}) {
  if (!record) return false;
  const e = norm(email), n = norm(name);
  const re = norm(record.employeeEmail), rn = norm(record.employeeName);
  if (re && e) return re === e;
  return !!rn && rn === n;
}

// Order two marks by when they were actually recorded.
const byTime = (a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0);

// Fold a person's marks into one row per day: first check-in, last check-out,
// the hours between them, and what the day amounts to.
export function foldAttendanceDays(records, who) {
  const byDate = new Map();
  (records || []).forEach(r => {
    if (!r || !r.date || !isMine(r, who)) return;
    const day = byDate.get(r.date) || { date: r.date, marks: [] };
    day.marks.push(r);
    byDate.set(r.date, day);
  });

  return [...byDate.values()].map(day => {
    const ordered = [...day.marks].sort(byTime);
    const inMark = ordered.find(m => m.type === CHECK_IN) || null;
    const outMark = [...ordered].reverse().find(m => m.type === CHECK_OUT) || null;
    let hours = null;
    if (inMark?.createdAt && outMark?.createdAt) {
      const diff = new Date(outMark.createdAt) - new Date(inMark.createdAt);
      // A check-out recorded before the check-in is bad data, not negative work.
      if (diff > 0) hours = Math.round((diff / 3600000) * 100) / 100;
    }
    const status = inMark && outMark ? 'Complete'
      : inMark ? 'Checked in'
        : outMark ? 'Check-out only' : '-';
    return { date: day.date, marks: ordered, in: inMark, out: outMark, hours, present: !!inMark, status };
  }).sort((a, b) => (a.date < b.date ? 1 : -1));   // newest first
}

// The month's figures, straight off the folded days.
export function attendanceSummary(days) {
  const list = days || [];
  const worked = list.filter(d => d.hours != null);
  const totalHours = worked.reduce((sum, d) => sum + d.hours, 0);
  return {
    present: list.filter(d => d.present).length,
    incomplete: list.filter(d => d.present && !d.out).length,
    totalHours: Math.round(totalHours * 10) / 10,
    avgHours: worked.length ? Math.round((totalHours / worked.length) * 10) / 10 : 0,
  };
}

// Where this person stands today.
export function todayStanding(days, todayStr) {
  const row = (days || []).find(d => d.date === todayStr) || null;
  if (!row) return { row: null, label: 'Not marked today', tone: 'pending', icon: 'schedule' };
  if (row.out) return { row, label: 'Checked out for today', tone: 'done', icon: 'task_alt' };
  return { row, label: 'Checked in — check out when you finish', tone: 'active', icon: 'how_to_reg' };
}

// Which button the employee needs next: the first mark of the day is a check-in,
// and once they are in, the next one is a check-out.
export function suggestedMarkType(todayMarks) {
  const marks = todayMarks || [];
  const hasIn = marks.some(m => m.type === CHECK_IN);
  const hasOut = marks.some(m => m.type === CHECK_OUT);
  return hasIn && !hasOut ? CHECK_OUT : CHECK_IN;
}

// The whole-team counters on the Attendance screen.
export function teamCounts(records, todayStr, who) {
  const all = records || [];
  const todays = all.filter(a => a.date === todayStr);
  const mine = all.filter(a => isMine(a, who));
  const month = String(todayStr || '').slice(0, 7);
  return {
    presentToday: new Set(todays.filter(a => a.type === CHECK_IN).map(a => a.employeeEmail || a.employeeName)).size,
    marksToday: todays.length,
    myMonth: new Set(mine.filter(a => a.type === CHECK_IN && String(a.date || '').startsWith(month)).map(a => a.date)).size,
    myTotal: mine.filter(a => a.type === CHECK_IN).length,
  };
}

// WhatsApp / Gmail / Facebook open links in a cut-down in-app browser that is
// short on memory and often refuses the camera outright. Worth telling the
// employee, because opening the CRM in Chrome fixes it on the spot.
export function detectInAppBrowser(ua) {
  const s = ua || (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '';
  if (/FBAN|FBAV|FB_IAB/i.test(s)) return 'Facebook';
  if (/Instagram/i.test(s)) return 'Instagram';
  if (/WhatsApp/i.test(s)) return 'WhatsApp';
  if (/Line\//i.test(s)) return 'LINE';
  if (/GSA\//i.test(s)) return 'the Google app';
  // Android WebView: "; wv)" in the UA, or a Version/x.y tag beside Chrome
  if (/Android/i.test(s) && (/;\s*wv\)/i.test(s) || /Version\/\d+\.\d+(\.\d+)?\s+Chrome/i.test(s))) return 'an in-app browser';
  return '';
}

// ── Team views (28-Sep requirement) ─────────────────────────────────────────
// A Team Leader could only ever see their own attendance: the whole-team view
// was gated at manager level, and a Team Leader sits below that. These build
// the figures the team screens need, from the same folded days as everything
// else, so a leader's view of a member can never disagree with that member's
// own view of themselves.

// One person, one month: the days they marked and what they add up to.
export function memberMonth(records, member, month) {
  const who = { email: member && member.email, name: member && member.displayName };
  const all = foldAttendanceDays(records, who);
  const days = all.filter(d => String(d.date || '').startsWith(month));
  return {
    email: member && member.email,
    name: (member && (member.displayName || member.email)) || 'Unknown',
    role: member && member.role,
    days,
    ...attendanceSummary(days),
    lastSeen: all.length ? all[0].date : '',   // folded days are newest first
  };
}

// The whole team for a month, worst-attended first so the gaps are at the top
// rather than buried at the bottom of an alphabetical list.
export function teamMonthReport(records, members, month) {
  const rows = (members || []).map(m => memberMonth(records, m, month));
  rows.sort((a, b) => (a.present - b.present) || a.name.localeCompare(b.name));
  return {
    month,
    rows,
    present: rows.filter(r => r.present > 0).length,
    totalDays: rows.reduce((n, r) => n + r.present, 0),
    totalHours: Math.round(rows.reduce((n, r) => n + r.totalHours, 0) * 10) / 10,
    incomplete: rows.reduce((n, r) => n + r.incomplete, 0),
  };
}

// Where each member stands today — the question a leader opens this screen to
// answer. Anyone who has not marked at all is listed too, which is the whole
// point: an absence shows up as a row, not as a missing one.
export function teamToday(records, members, todayStr) {
  const rows = (members || []).map(m => {
    const who = { email: m && m.email, name: m && m.displayName };
    const marks = (records || [])
      .filter(r => r && r.date === todayStr && isMine(r, who))
      .sort(byTime);
    const inMark = marks.find(x => x.type === CHECK_IN) || null;
    const outMark = [...marks].reverse().find(x => x.type === CHECK_OUT) || null;
    return {
      email: m && m.email,
      name: (m && (m.displayName || m.email)) || 'Unknown',
      in: inMark, out: outMark, marks,
      state: inMark && outMark ? 'Checked out' : inMark ? 'Checked in' : 'Not marked',
    };
  });
  rows.sort((a, b) => {
    const order = { 'Not marked': 0, 'Checked in': 1, 'Checked out': 2 };
    return (order[a.state] - order[b.state]) || a.name.localeCompare(b.name);
  });
  return {
    rows,
    marked: rows.filter(r => r.state !== 'Not marked').length,
    onSite: rows.filter(r => r.state === 'Checked in').length,
    notMarked: rows.filter(r => r.state === 'Not marked').length,
  };
}

// The months to offer in the picker: every month the team has marks in, plus
// this month and last, newest first. Last month is always there because
// "previous month" is one of the things a leader is asked for.
export function attendanceMonths(records, members, todayStr) {
  const mine = new Set();
  (members || []).forEach(m => {
    const who = { email: m && m.email, name: m && m.displayName };
    (records || []).forEach(r => { if (r && r.date && isMine(r, who)) mine.add(String(r.date).slice(0, 7)); });
  });
  const now = String(todayStr || '').slice(0, 7);
  mine.add(now);
  mine.add(previousMonth(now));
  return [...mine].filter(Boolean).sort().reverse();
}

// "2026-01" → "2025-12"
export function previousMonth(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m) return '';
  const y = Number(m[1]), n = Number(m[2]);
  return n === 1 ? `${y - 1}-12` : `${y}-${String(n - 1).padStart(2, '0')}`;
}

// "September 2026"
export function monthLabel(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m) return String(month || '');
  return new Date(Number(m[1]), Number(m[2]) - 1, 1)
    .toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}
