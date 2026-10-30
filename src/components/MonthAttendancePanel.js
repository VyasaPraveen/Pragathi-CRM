import React, { useMemo, useState } from 'react';
import { useData } from '../context/DataContext';
import { formatDate, todayStr } from '../services/helpers';
import { EmptyState } from './SharedUI';
import { monthOverview, attendanceMonths, previousMonth, monthLabel, attendanceRulesFrom, FULL_DAY, HALF_DAY, MANUAL } from '../services/attendance';
import { userStatus } from '../services/teams';

// ============================================================================
// This Month Attendance (Req 6.6 / 6.7, 30-Oct), for the Owner, Admin,
// Management and the Operation Manager: every employee's month off the
// actual records — the same folded days My Attendance and Team Attendance
// use — with one employee's days on request.
// ============================================================================

export default function MonthAttendancePanel({ onAdd }) {
  const { attendance, users, settings } = useData();
  const today = todayStr();
  const rules = attendanceRulesFrom(settings);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [who, setWho] = useState('');
  const employees = useMemo(() => (users || []).filter(u => u.approved !== false && userStatus(u) !== 'deactivated'), [users]);
  const months = useMemo(() => attendanceMonths(attendance, employees, today), [attendance, employees, today]);
  const report = useMemo(() => monthOverview(attendance, employees, month, rules), [attendance, employees, month, rules]);
  const one = who ? report.rows.find(r => String(r.email || '').toLowerCase() === who.toLowerCase()) : null;
  const lastMonth = previousMonth(today.slice(0, 7));

  const tile = (label, val, color) => (
    <div key={label} style={{ border: '1px solid var(--bor)', borderRadius: 10, padding: '10px 12px', textAlign: 'center' }}>
      <div style={{ fontSize: '1.15rem', fontWeight: 700, color }}>{val}</div>
      <div style={{ fontSize: '.72rem', color: 'var(--muted)' }}>{label}</div>
    </div>
  );

  return (
    <div className="card"><div className="cb">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <strong style={{ fontSize: '.95rem' }}>
          <span className="material-icons-round" style={{ fontSize: 18, verticalAlign: '-4px', marginRight: 6, color: 'var(--pri)' }}>calendar_month</span>
          {month === today.slice(0, 7) ? 'This Month' : monthLabel(month)} Attendance
        </strong>
        <div className="df">
          {month !== today.slice(0, 7) && <span className="fc" onClick={() => setMonth(today.slice(0, 7))}>This Month</span>}
          {month !== lastMonth && <span className="fc" onClick={() => setMonth(lastMonth)}>Previous Month</span>}
          <select className="fi" value={month} onChange={e => setMonth(e.target.value)}>
            {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          <select className="fi" value={who} onChange={e => setWho(e.target.value)} aria-label="Employee">
            <option value="">All employees</option>
            {report.rows.map(r => <option key={r.email} value={r.email}>{r.name}</option>)}
          </select>
          {onAdd && <button className="btn bsm bp" onClick={() => onAdd(who)}><span className="material-icons-round" style={{ fontSize: 16 }}>add</span> Add Attendance</button>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10, marginBottom: 14 }}>
        {tile('Total Employees', report.employees, 'var(--pri)')}
        {tile('Present (≥1 day)', report.presentEmployees, '#27ae60')}
        {tile('Days Present', report.presentDays, '#1e8449')}
        {tile('Days Absent', report.absentDays, report.absentDays ? '#c0392b' : 'var(--muted)')}
        {tile('Not Marked At All', report.notMarked, report.notMarked ? '#e67e22' : 'var(--muted)')}
        {tile('Total Hours', report.totalHours, '#6c5ce7')}
      </div>

      {one ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <strong style={{ fontSize: '.95rem' }}>{one.name}</strong>
            <span style={{ fontSize: '.78rem', color: 'var(--muted)' }}>{one.designation || one.role || ''}{one.team ? ' · ' + one.team : ''}</span>
            <span style={{ flex: 1 }} />
            <span className="fc" onClick={() => setWho('')}>All employees</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10, marginBottom: 12 }}>
            {tile('Days Present', one.present, '#1e8449')}
            {tile('Days Absent', one.absent, one.absent ? '#c0392b' : 'var(--muted)')}
            {tile('Full / Half / Short', `${one.fullDays} / ${one.halfDays} / ${one.shortDays}`, 'var(--txt)')}
            {tile('Total Hours', one.totalHours, '#6c5ce7')}
            {tile('Leave Counter', one.leaveCounter, one.leaveCounter ? '#c0392b' : 'var(--muted)')}
          </div>
          <div style={{ fontSize: '.82rem', marginBottom: 6 }}><strong style={{ color: '#1e8449' }}>Present:</strong> {one.days.filter(d => d.present).map(d => formatDate(d.date)).join(', ') || '—'}</div>
          <div style={{ fontSize: '.82rem', marginBottom: 12 }}><strong style={{ color: '#c0392b' }}>Absent:</strong> {one.days.filter(d => d.absent).map(d => formatDate(d.date)).join(', ') || '—'}</div>
          {one.days.length ? (
            <div className="tw tw-m"><table style={{ fontSize: '.82rem' }}><thead><tr><th>Date</th><th>Status</th><th>Check In</th><th>Check Out</th><th>Hours</th><th>Note</th></tr></thead><tbody>
              {one.days.map(d => (
                <tr key={d.date}>
                  <td className="m-h" style={{ whiteSpace: 'nowrap' }}>{formatDate(d.date)}</td>
                  <td data-l="Status">
                    <span className={`st ${d.absent ? 'st-r' : d.status === 'Complete' || d.manual ? 'st-g' : d.status === 'Checked in' ? 'st-b' : 'st-o'}`} style={{ padding: '2px 7px', fontSize: '.68rem' }}>{d.status}</span>
                    {d.standing && <span className={`st ${d.standing === FULL_DAY ? 'st-g' : d.standing === HALF_DAY ? 'st-o' : 'st-r'}`} style={{ padding: '2px 7px', fontSize: '.68rem', marginLeft: 4 }}>{d.standing}</span>}
                  </td>
                  <td data-l="Check in">{d.in?.time || '-'}</td>
                  <td data-l="Check out">{d.out?.time || (d.in ? <span style={{ color: '#e67e22' }}>Not marked</span> : '-')}</td>
                  <td data-l="Hours" style={{ fontWeight: 600 }}>{d.hours != null ? d.hours + ' h' : '-'}</td>
                  <td data-l="Note" style={{ color: 'var(--muted)' }}>{d.manual ? `${d.manual.note || ''}${d.manual.addedBy ? ` (added by ${d.manual.addedBy})` : ''}` : ''}</td>
                </tr>
              ))}
            </tbody></table></div>
          ) : <EmptyState icon="event_busy" title={`No attendance in ${monthLabel(month)}`} message="" />}
        </div>
      ) : (
        <div className="tw tw-m"><table style={{ fontSize: '.84rem' }}><thead><tr>
          <th>Employee</th><th>Team / Designation</th><th>Present</th><th>Absent</th><th>Full / Half / Short</th><th>Hours</th><th>Last Marked</th><th>Detail</th>
        </tr></thead><tbody>
          {report.rows.map(r => (
            <tr key={r.email || r.name}>
              <td className="m-h"><strong>{r.name}</strong></td>
              <td data-l="Team / Designation" style={{ fontSize: '.8rem' }}>{[r.team, r.designation || r.role].filter(Boolean).join(' · ') || '-'}</td>
              <td data-l="Present" style={{ fontWeight: 700, color: r.present ? '#1e8449' : '#c0392b' }}>{r.present}</td>
              <td data-l="Absent" style={{ fontWeight: 700, color: r.absent ? '#c0392b' : 'var(--muted)' }}>{r.absent || '-'}</td>
              <td data-l="Full / Half / Short" style={{ fontSize: '.82rem' }}>{r.fullDays} / {r.halfDays} / {r.shortDays}</td>
              <td data-l="Hours">{r.totalHours || '-'}</td>
              <td data-l="Last Marked" style={{ fontSize: '.8rem' }}>{r.lastSeen ? formatDate(r.lastSeen) : 'Never'}</td>
              <td className="m-a"><div><button className="btn bsm bo" title="View the days" onClick={() => setWho(r.email)}><span className="material-icons-round" style={{ fontSize: 15 }}>visibility</span></button></div></td>
            </tr>
          ))}
          {!report.rows.length && <tr><td colSpan="8"><EmptyState icon="groups" title="No employees" message="" /></td></tr>}
        </tbody></table></div>
      )}
      <p style={{ fontSize: '.74rem', color: 'var(--muted)', margin: '10px 0 0' }}>
        Counts come from the attendance records themselves: a day is present when it has a check-in or an added "{MANUAL}" record, absent only when it was recorded as absent. A day with no record is neither.
      </p>
    </div></div>
  );
}

