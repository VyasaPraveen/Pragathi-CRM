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
