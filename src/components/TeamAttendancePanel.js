import React, { useMemo, useState } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { formatDate, hasAccess, isSafeUrl, todayStr } from '../services/helpers';
import { teamMembersOf } from '../services/permissions';
import { EmptyState, DateInput } from './SharedUI';
import {
  teamMonthReport, teamToday, attendanceMonths, previousMonth, monthLabel,
} from '../services/attendance';

// ============================================================================
// Team attendance, for the person answerable for it.
//
// A Team Leader used to see nothing but their own marks: the whole-team view
// was gated at manager level and a Team Leader sits below that, so the one
// person who is actually asked "was your team on site yesterday?" was the one
// person who could not find out.
//
// The screen answers, in this order: who is out today, how the month is going,
// and then each member in full. The month can be changed, and last month is
// always one press away.
// ============================================================================

const STATE_TONE = {
  'Not marked': { bg: 'rgba(231,76,60,.10)', fg: '#c0392b', icon: 'error_outline' },
  'Checked in': { bg: 'rgba(26,58,122,.08)', fg: 'var(--pri)', icon: 'how_to_reg' },
  'Checked out': { bg: 'rgba(39,174,96,.10)', fg: '#1e8449', icon: 'task_alt' },
};

export default function TeamAttendancePanel() {
  const { attendance, users } = useData();
  const { user, role } = useAuth();
  const today = todayStr();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [openMember, setOpenMember] = useState('');
  // The date the calendar card is looking at. It opens on today, so the
  // screen reads exactly as it did before anyone touches it.
  const [pickedDate, setPickedDate] = useState(today);

  // A Team Leader sees their own members. Anyone at manager level or above is
  // answerable for everybody, so they see every approved account.
  const seesEveryone = hasAccess(role, 'manager');
  const members = useMemo(() => {
    const approved = (users || []).filter(u => u.approved !== false);
    if (seesEveryone) return approved;
    const mine = teamMembersOf(approved, user?.email);
    // The leader's own attendance belongs in their team's figures too.
    const self = approved.find(u => String(u.email || '').toLowerCase() === String(user?.email || '').toLowerCase());
    return self ? [self, ...mine.filter(m => m.email !== self.email)] : mine;
  }, [users, user, seesEveryone]);

  const months = useMemo(() => attendanceMonths(attendance, members, today), [attendance, members, today]);
  const roll = useMemo(() => teamToday(attendance, members, today), [attendance, members, today]);
  // The same roll-call, for whichever day was chosen.
  const picked = useMemo(() => teamToday(attendance, members, pickedDate), [attendance, members, pickedDate]);
  const report = useMemo(() => teamMonthReport(attendance, members, month), [attendance, members, month]);
  const lastMonth = previousMonth(today.slice(0, 7));

  if (!members.length) {
    return (
      <EmptyState icon="groups" title="No team members yet"
        message="Nobody is mapped under you. Ask an Admin to set the Team Leader on their user record." />
    );
  }

  return (
    <>
      {/* ── Attendance by date ────────────────────────────────────────────
          An addition, not a replacement: the Today card below is untouched and
          this opens on today, so nothing looks different until a date is
          picked. Any date can be chosen, including ones still to come — those
          simply show nobody marked yet. */}
      <div className="card" style={{ marginBottom: 16 }}><div className="cb">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          <strong style={{ fontSize: '.95rem' }}>
            <span className="material-icons-round" style={{ fontSize: 18, verticalAlign: '-4px', marginRight: 6, color: 'var(--pri)' }}>calendar_month</span>
            Attendance by Date
          </strong>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {pickedDate !== today && (
              <button className="btn bsm bo" onClick={() => setPickedDate(today)}>Today</button>
            )}
            <div style={{ width: 170 }}>
              <DateInput value={pickedDate} onChange={e => setPickedDate(e.target.value || today)} />
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10, marginBottom: 12 }}>
          {[
            ['Present', picked.marked, '#27ae60'],
            ['Still On Site', picked.onSite, 'var(--pri)'],
            ['Not Marked', picked.notMarked, picked.notMarked ? '#c0392b' : 'var(--muted)'],
            [seesEveryone ? 'Staff' : 'Team Members', members.length, '#6c5ce7'],
          ].map(([label, val, color]) => (
            <div key={label} style={{ border: '1px solid var(--bor)', borderRadius: 10, padding: '10px 12px', textAlign: 'center' }}>
              <div style={{ fontSize: '1.3rem', fontWeight: 700, color }}>{val}</div>
              <div style={{ fontSize: '.72rem', color: 'var(--muted)' }}>{label}</div>
            </div>
          ))}
        </div>

        <div style={{ fontSize: '.8rem', color: 'var(--muted)', marginBottom: 8 }}>
          <strong style={{ color: 'var(--dark)' }}>{picked.marked}</strong> of {members.length}
          {' '}marked attendance on <strong style={{ color: 'var(--dark)' }}>{formatDate(pickedDate)}</strong>.
        </div>

        {picked.marked > 0 ? (
          <div className="tw"><table><thead><tr>
            <th>Name</th><th>Status</th><th>Check In</th><th>Check Out</th><th>Location</th>
          </tr></thead><tbody>
            {picked.rows.filter(r => r.state !== 'Not marked').map(r => {
              const tone = STATE_TONE[r.state];
              return (
                <tr key={r.email || r.name}>
                  <td><strong>{r.name}</strong></td>
                  <td><span className="st" style={{ background: tone.bg, color: tone.fg, padding: '2px 8px', fontSize: '.72rem' }}>{r.state}</span></td>
                  <td style={{ fontSize: '.82rem' }}>{r.in?.time || '-'}</td>
                  <td style={{ fontSize: '.82rem' }}>{r.out?.time || (r.in ? <span style={{ color: '#e67e22' }}>Still in</span> : '-')}</td>
                  <td style={{ fontSize: '.8rem' }}>
                    {r.in?.lat && r.in?.lng
                      ? <a href={r.in.mapLink || `https://www.google.com/maps?q=${r.in.lat},${r.in.lng}`} target="_blank" rel="noreferrer" style={{ color: 'var(--pri)' }}>View</a>
                      : '-'}
                  </td>
                </tr>
              );
            })}
          </tbody></table></div>
        ) : (
          <div style={{ fontSize: '.84rem', color: 'var(--muted)', padding: '10px 0' }}>
            Nobody marked attendance on {formatDate(pickedDate)}.
          </div>
        )}

        {picked.notMarked > 0 && (
          <div style={{ fontSize: '.8rem', marginTop: 8, color: '#c0392b' }}>
            <strong>Not marked ({picked.notMarked}):</strong>{' '}
            {picked.rows.filter(r => r.state === 'Not marked').map(r => r.name).join(', ')}
          </div>
        )}
      </div></div>

      {/* ── Today ─────────────────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 16 }}><div className="cb">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          <strong style={{ fontSize: '.95rem' }}>Today&rsquo;s Attendance — {formatDate(today)}</strong>
          <span style={{ fontSize: '.78rem', color: 'var(--muted)' }}>
            {roll.marked} of {members.length} marked · {roll.onSite} still on site
            {roll.notMarked > 0 && <span style={{ color: '#c0392b', fontWeight: 600 }}> · {roll.notMarked} not marked</span>}
          </span>
        </div>
        <div className="tw"><table><thead><tr>
          <th>Team Member</th><th>Status</th><th>Check In</th><th>Check Out</th><th>Location</th><th>Photo</th>
        </tr></thead><tbody>
          {roll.rows.map(r => {
            const tone = STATE_TONE[r.state];
            return (
              <tr key={r.email || r.name}>
                <td><strong>{r.name}</strong></td>
                <td>
                  <span className="st" style={{ background: tone.bg, color: tone.fg, padding: '2px 8px', fontSize: '.72rem', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <span className="material-icons-round" style={{ fontSize: 14 }}>{tone.icon}</span>{r.state}
                  </span>
                </td>
                <td style={{ fontSize: '.82rem' }}>{r.in?.time || '-'}</td>
                <td style={{ fontSize: '.82rem' }}>
                  {r.out?.time || (r.in ? <span style={{ color: '#e67e22' }}>Still in</span> : '-')}
                </td>
                <td style={{ fontSize: '.8rem' }}>
                  {r.in?.lat && r.in?.lng
                    ? <a href={r.in.mapLink || `https://www.google.com/maps?q=${r.in.lat},${r.in.lng}`} target="_blank" rel="noreferrer" style={{ color: 'var(--pri)' }}>View</a>
                    : '-'}
                </td>
                <td>{isSafeUrl(r.in?.photoUrl)
                  ? <a href={r.in.photoUrl} target="_blank" rel="noreferrer"><img src={r.in.photoUrl} alt="" style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--bor)' }} /></a>
                  : '-'}</td>
              </tr>
            );
          })}
        </tbody></table></div>
      </div></div>

      {/* ── The month ─────────────────────────────────────────────────────── */}
      <div className="card"><div className="cb">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <strong style={{ fontSize: '.95rem' }}>Team Attendance — {monthLabel(month)}</strong>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {month !== today.slice(0, 7) && (
              <button className="btn bsm bo" onClick={() => setMonth(today.slice(0, 7))}>This Month</button>
            )}
            {month !== lastMonth && (
              <button className="btn bsm bo" onClick={() => setMonth(lastMonth)}>Previous Month</button>
            )}
            <select className="fi" style={{ width: 'auto', padding: '6px 10px' }} value={month} onChange={e => setMonth(e.target.value)}>
              {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10, marginBottom: 14 }}>
          {[
            ['Members', members.length, 'var(--pri)'],
            ['Attended This Month', report.present, '#27ae60'],
            ['Total Days Present', report.totalDays, '#6c5ce7'],
            ['Total Hours', report.totalHours, '#e8830c'],
            ['Days Without Check-Out', report.incomplete, report.incomplete ? '#e67e22' : 'var(--muted)'],
          ].map(([label, val, color]) => (
            <div key={label} style={{ border: '1px solid var(--bor)', borderRadius: 10, padding: '10px 12px', textAlign: 'center' }}>
              <div style={{ fontSize: '1.15rem', fontWeight: 700, color }}>{val}</div>
              <div style={{ fontSize: '.72rem', color: 'var(--muted)' }}>{label}</div>
            </div>
          ))}
        </div>

        <div className="tw"><table><thead><tr>
          <th>Team Member</th><th>Days Present</th><th>Total Hours</th><th>Avg Hours / Day</th>
          <th>No Check-Out</th><th>Last Marked</th><th style={{ textAlign: 'right' }}>Detail</th>
        </tr></thead><tbody>
          {report.rows.map(r => (
            <React.Fragment key={r.email || r.name}>
              <tr>
                <td><strong>{r.name}</strong></td>
                <td style={{ fontWeight: 700, color: r.present ? '#1e8449' : '#c0392b' }}>{r.present}</td>
                <td>{r.totalHours || '-'}</td>
                <td>{r.avgHours || '-'}</td>
                <td style={{ color: r.incomplete ? '#e67e22' : 'var(--muted)' }}>{r.incomplete || '-'}</td>
                <td style={{ fontSize: '.8rem' }}>{r.lastSeen ? formatDate(r.lastSeen) : 'Never'}</td>
                <td style={{ textAlign: 'right' }}>
                  <button className="btn bsm bo" onClick={() => setOpenMember(openMember === (r.email || r.name) ? '' : (r.email || r.name))}>
                    {openMember === (r.email || r.name) ? 'Hide' : `${r.days.length} day${r.days.length === 1 ? '' : 's'}`}
                  </button>
                </td>
              </tr>
              {openMember === (r.email || r.name) && (
                <tr>
                  <td colSpan={7} style={{ background: 'rgba(26,58,122,.03)', padding: 10 }}>
                    {r.days.length ? (
                      <table style={{ fontSize: '.82rem' }}><thead><tr>
                        <th>Date</th><th>Status</th><th>Check In</th><th>Check Out</th><th>Hours</th><th>Location</th>
                      </tr></thead><tbody>
                        {r.days.map(d => (
                          <tr key={d.date}>
                            <td style={{ whiteSpace: 'nowrap' }}>{formatDate(d.date)}</td>
                            <td><span className={`st ${d.status === 'Complete' ? 'st-g' : d.status === 'Checked in' ? 'st-b' : 'st-o'}`} style={{ padding: '2px 7px', fontSize: '.68rem' }}>{d.status}</span></td>
                            <td>{d.in?.time || '-'}</td>
                            <td>{d.out?.time || <span style={{ color: '#e67e22' }}>Not marked</span>}</td>
                            <td style={{ fontWeight: 600 }}>{d.hours != null ? d.hours + ' h' : '-'}</td>
                            <td>{d.in?.lat && d.in?.lng
                              ? <a href={d.in.mapLink || `https://www.google.com/maps?q=${d.in.lat},${d.in.lng}`} target="_blank" rel="noreferrer" style={{ color: 'var(--pri)' }}>View</a>
                              : '-'}</td>
                          </tr>
                        ))}
                      </tbody></table>
                    ) : (
                      <span style={{ color: 'var(--muted)', fontSize: '.82rem' }}>
                        {r.name} has no attendance in {monthLabel(month)}.
                      </span>
                    )}
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody></table></div>
      </div></div>
    </>
  );
}
