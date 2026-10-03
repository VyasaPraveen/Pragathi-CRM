// ============================================================================
// Leave — the types on offer and how a request is counted.
//
// Kept out of the page so the counting can be checked on its own. It used to
// add one day to every request ("3 days requested, 4 counted"), which made a
// single day's leave show as two. That is gone. The rules now are:
//
//   - a request counts the days it covers, one for one;
//   - Sunday is not a working day, so a Sunday inside the range is not counted
//     — EXCEPT when the Saturday before it and the Monday after it are both on
//     leave, in which case the Sunday in between is taken too and counts as a
//     day (Saturday + Monday = 3, not 2);
//   - Half Day is half a day;
//   - a Short Leave is measured in hours, not days, and counts no days at all.
// ============================================================================

export const SHORT_LEAVE = 'Short Leave (Hours)';

// "Fever Leave" was removed on request; everything else is as it was, with the
// hourly option added beside Half Day.
export const LEAVE_TYPES = ['Sick Leave', 'Casual Leave', 'Emergency Leave', 'Earned Leave', 'Half Day', SHORT_LEAVE, 'Other'];

export const isShortLeave = (type) => type === SHORT_LEAVE;

// "YYYY-MM-DD" as a local calendar day — never through Date.parse, which reads
// it as UTC midnight and lands on the previous evening in India.
function day(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d) ? null : d;
}
const plus = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

// How many days a request covers, by the rules above.
export function leaveDays(type, from, to) {
  if (type === 'Half Day') return 0.5;
  if (isShortLeave(type)) return 0;
  const a = day(from);
  const b = day(to || from);
  if (!a || !b || b < a) return 0;
  const within = (d) => d >= a && d <= b;
  let n = 0;
  for (let d = new Date(a); d <= b; d = plus(d, 1)) {
    if (d.getDay() !== 0) { n++; continue; }
    // A Sunday counts only when it sits between a leave Saturday and a leave
    // Monday.
    if (within(plus(d, -1)) && within(plus(d, 1))) n++;
  }
  return n;
}

// What the request counts for. One for one — the blanket +1 is gone.
export const countedFor = (days) => (days > 0 ? days : 0);

// Hours between two "HH:MM" clock times on the same day, to a quarter hour.
export function leaveHours(fromTime, toTime) {
  const t = (s) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const a = t(fromTime);
  const b = t(toTime);
  if (a == null || b == null || b <= a) return 0;
  return Math.round(((b - a) / 60) * 4) / 4;
}

// "2 hours", "1 day", "3 days", "half a day" — for notifications and rows.
export function leaveSpanText(lr) {
  if (!lr) return '';
  if (isShortLeave(lr.leaveType)) {
    const h = Number(lr.hours) || 0;
    return `${h} hour${h === 1 ? '' : 's'}`;
  }
  const d = Number(lr.days) || 0;
  if (d === 0.5) return 'half a day';
  return `${d} day${d === 1 ? '' : 's'}`;
}
