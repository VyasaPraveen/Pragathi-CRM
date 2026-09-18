import React, { useMemo, useState } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { getInitials, formatDate, isSafeUrl } from '../services/helpers';
import { teamMembersOf, hasModule, roleLabel } from '../services/permissions';

// "My Team" — what a Team Leader sees for the members assigned under them:
// who they are, whether they have marked attendance, what they are working on,
// their leave, and their tracking entries. Each section is a permission an
// Admin can switch on or off for that individual Team Leader.
const today = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => today().slice(0, 7);

export default function MyTeamPanel() {
  const { users, attendance, employeeTasks, leaveRequests, tracking } = useData();
  const { user, role } = useAuth();
  const [open, setOpen] = useState(null);

  const members = useMemo(() => teamMembersOf(users, user?.email), [users, user]);

  const may = (key) => hasModule(user, role, key);
  // Nothing to show unless this person actually leads a team and may see it.
  if (!members.length || !may('team_members')) return null;

  const showAttendance = may('team_attendance');
  const showTasks = may('team_tasks');
  const showLeave = may('team_leave');
  const showTracking = may('team_tracking');

  const forMember = (m) => {
    const email = String(m.email || '').toLowerCase();
    const name = m.displayName || '';
    const mine = (r) => String(r.employeeEmail || '').toLowerCase() === email || (name && r.employeeName === name);

    const att = (attendance || []).filter(mine);
    const todays = att.filter(a => a.date === today());
    const checkIn = todays.find(a => a.type === 'Check In');
    const checkOut = todays.find(a => a.type === 'Check Out');
    const monthDays = new Set(att.filter(a => a.type === 'Check In' && String(a.date || '').startsWith(thisMonth())).map(a => a.date)).size;

    const tasks = (employeeTasks || []).filter(t => t.assignedTo === name || t.assignedTo === m.email);
    const openTasks = tasks.filter(t => t.status !== 'Completed');

    const leaves = (leaveRequests || []).filter(mine);
    const activeLeave = leaves.find(l => l.status === 'Approved' && l.fromDate <= today() && (l.toDate || l.fromDate) >= today());
    const pendingLeave = leaves.filter(l => l.status && l.status !== 'Approved' && l.status !== 'Rejected').length;

    const track = (tracking || []).filter(mine).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    const lastTrack = track[0];

    return { att, todays, checkIn, checkOut, monthDays, tasks, openTasks, leaves, activeLeave, pendingLeave, track, lastTrack };
  };

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="ch" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h3>
          <span className="material-icons-round" style={{ fontSize: 20, verticalAlign: 'middle', marginRight: 6 }}>supervisor_account</span>
          My Team
          <span style={{ fontSize: '.78rem', fontWeight: 500, color: 'var(--muted)', marginLeft: 8 }}>
            {members.length} member{members.length === 1 ? '' : 's'} assigned to you
          </span>
        </h3>
      </div>
      <div className="cb" style={{ padding: 0 }}>
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>Member</th>
                {showAttendance && <th>Today</th>}
                {showAttendance && <th>Days this month</th>}
                {showTasks && <th>Open tasks</th>}
                {showLeave && <th>Leave</th>}
                {showTracking && <th>Last tracking</th>}
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {members.map(m => {
                const d = forMember(m);
                const isOpen = open === m.id;
                return (
                  <React.Fragment key={m.id}>
                    <tr style={{ cursor: 'pointer' }} onClick={() => setOpen(isOpen ? null : m.id)}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div className="ua" style={{ width: 30, height: 30, fontSize: '.68rem' }}>{getInitials(m.displayName || m.email)}</div>
                          <div>
                            <strong>{m.displayName || m.email}</strong>
                            <div style={{ fontSize: '.72rem', color: 'var(--muted)' }}>{m.designation || roleLabel(m.role)}</div>
                          </div>
                        </div>
                      </td>
                      {showAttendance && (
                        <td style={{ fontSize: '.8rem', whiteSpace: 'nowrap' }}>
                          {d.checkIn
                            ? <span style={{ color: 'var(--ok)' }}>In {d.checkIn.time}{d.checkOut ? ` · Out ${d.checkOut.time}` : ''}</span>
                            : <span style={{ color: '#e8830c' }}>Not marked</span>}
                        </td>
                      )}
                      {showAttendance && <td style={{ fontWeight: 700 }}>{d.monthDays}</td>}
                      {showTasks && <td>{d.openTasks.length}{d.tasks.length ? <span style={{ color: 'var(--muted)', fontSize: '.74rem' }}> / {d.tasks.length}</span> : null}</td>}
                      {showLeave && (
                        <td style={{ fontSize: '.8rem' }}>
                          {d.activeLeave ? <span style={{ color: '#e8830c' }}>On leave</span>
                            : d.pendingLeave ? <span style={{ color: 'var(--muted)' }}>{d.pendingLeave} pending</span>
                              : <span style={{ color: 'var(--muted)' }}>—</span>}
                        </td>
                      )}
                      {showTracking && <td style={{ fontSize: '.8rem' }}>{d.lastTrack ? formatDate(d.lastTrack.date) : '—'}</td>}
                      <td><span className="material-icons-round" style={{ fontSize: 18, color: 'var(--muted)' }}>{isOpen ? 'expand_less' : 'expand_more'}</span></td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={2 + (showAttendance ? 2 : 0) + (showTasks ? 1 : 0) + (showLeave ? 1 : 0) + (showTracking ? 1 : 0)} style={{ background: 'var(--bg)' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 16, padding: '10px 4px' }}>
                            <div>
                              <strong style={{ fontSize: '.8rem' }}>Contact</strong>
                              <div style={{ fontSize: '.8rem', color: 'var(--muted)', marginTop: 4 }}>{m.email}</div>
                            </div>

                            {showAttendance && (
                              <div>
                                <strong style={{ fontSize: '.8rem' }}>Recent attendance</strong>
                                {d.att.slice(0, 5).map(a => (
                                  <div key={a.id} style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                                    {isSafeUrl(a.photoUrl) && <a href={a.photoUrl} target="_blank" rel="noreferrer"><img src={a.photoUrl} alt="" style={{ width: 26, height: 26, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--bor)' }} /></a>}
                                    <span>{formatDate(a.date)} · {a.type} {a.time}</span>
                                    {a.lat && a.lng && <a href={a.mapLink || `https://www.google.com/maps?q=${a.lat},${a.lng}`} target="_blank" rel="noreferrer" style={{ color: 'var(--pri)' }}><span className="material-icons-round" style={{ fontSize: 14 }}>place</span></a>}
                                  </div>
                                ))}
                                {!d.att.length && <div style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: 4 }}>No attendance recorded yet.</div>}
                              </div>
                            )}

                            {showTasks && (
                              <div>
                                <strong style={{ fontSize: '.8rem' }}>Open tasks</strong>
                                {d.openTasks.slice(0, 5).map(t => (
                                  <div key={t.id} style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: 4 }}>
                                    {t.title} {t.dueDate ? `· due ${formatDate(t.dueDate)}` : ''} {t.status ? `· ${t.status}` : ''}
                                  </div>
                                ))}
                                {!d.openTasks.length && <div style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: 4 }}>Nothing open.</div>}
                              </div>
                            )}

                            {showLeave && (
                              <div>
                                <strong style={{ fontSize: '.8rem' }}>Leave</strong>
                                {d.leaves.slice(0, 5).map(l => (
                                  <div key={l.id} style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: 4 }}>
                                    {l.leaveType} · {formatDate(l.fromDate)}{l.toDate && l.toDate !== l.fromDate ? ' – ' + formatDate(l.toDate) : ''} · {l.status}
                                  </div>
                                ))}
                                {!d.leaves.length && <div style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: 4 }}>No leave requests.</div>}
                              </div>
                            )}

                            {showTracking && (
                              <div>
                                <strong style={{ fontSize: '.8rem' }}>Tracking</strong>
                                {d.track.slice(0, 3).map(t => (
                                  <div key={t.id} style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: 4 }}>
                                    {formatDate(t.date)} · {Object.keys(t.slots || {}).length} slot{Object.keys(t.slots || {}).length === 1 ? '' : 's'} filled
                                  </div>
                                ))}
                                {!d.track.length && <div style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: 4 }}>No tracking entries.</div>}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
