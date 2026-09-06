import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { formatCurrency, formatDate, toNumber } from '../services/helpers';
import { StatCard, StatusBadge, EmptyState } from '../components/SharedUI';

function downloadCSV(filename, headers, rows) {
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = [headers.join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

const today = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => new Date().toISOString().slice(0, 7);

// Personal, per-member reports + planning — safe for all staff (no company
// financials or team PII; each member sees only their own work). (req #10)
export default function MyReports() {
  const { leads, attendance, leaveRequests, tracking } = useData();
  const { user } = useAuth();
  const navigate = useNavigate();

  const myEmail = user?.email || '';
  const myName = user?.displayName || '';
  const mineByName = (n) => n && (n === myName);

  const myLeads = useMemo(() => leads.filter(l =>
    mineByName(l.assignedTo) || mineByName(l.salesExecutive) ||
    (Array.isArray(l.supportingTeam) && l.supportingTeam.includes(myName)) ||
    l.createdBy === myEmail
  ), [leads, myName, myEmail]); // eslint-disable-line react-hooks/exhaustive-deps

  const myAttendance = useMemo(() =>
    attendance.filter(a => a.employeeEmail === myEmail || a.employeeName === myName)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)),
    [attendance, myEmail, myName]);

  const myLeave = useMemo(() =>
    leaveRequests.filter(lr => lr.employeeEmail === myEmail || lr.employeeName === myName)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)),
    [leaveRequests, myEmail, myName]);

  const converted = myLeads.filter(l => l.status === 'Converted').length;
  const pipelineValue = myLeads.reduce((s, l) => s + toNumber(l.expectedValue), 0);
  const attendanceDaysThisMonth = new Set(myAttendance.filter(a => a.type === 'Check In' && (a.date || '').startsWith(thisMonth())).map(a => a.date)).size;
  const leaveCounted = myLeave.filter(l => l.status === 'Approved').reduce((s, l) => s + (Number(l.countedDays) || 0), 0);
  const myTrackToday = tracking.find(t => t.employeeEmail === myEmail && t.date === today());
  const trackFilled = myTrackToday ? Object.values(myTrackToday.slots || {}).filter(v => (v || '').trim()).length : 0;

  const exportMyLeads = () => {
    const headers = ['Name', 'Phone', 'City', 'Status', 'Priority', 'kW', 'Expected Value', 'Site Visit', 'Quotation', 'Advance Paid', 'Follow-up', 'Next Follow-up', 'Date'];
    const rows = myLeads.map(l => [l.name, l.phone, l.city, l.status, l.priority, l.kwRequired, l.expectedValue, l.siteVisit, l.quotationSent, l.advancePaid, l.followUpStatus, l.nextFollowUpDate, l.dateGenerated]);
    downloadCSV('My_Leads_' + today() + '.csv', headers, rows);
  };

  return (
    <>
      <div className="tl">
        <h3>My Reports &amp; Planning</h3>
        <button className="btn bsm bo" onClick={() => navigate('/tracking')}><span className="material-icons-round" style={{ fontSize: 18 }}>schedule</span> Open Tracking</button>
      </div>

      <div className="sg">
        <StatCard color="bl" icon="leaderboard" value={myLeads.length} label="My Leads" />
        <StatCard color="gr" icon="verified" value={converted} label="Converted" />
        <StatCard color="or" icon="savings" value={formatCurrency(pipelineValue)} label="My Pipeline Value" />
        <StatCard color="pu" icon="how_to_reg" value={attendanceDaysThisMonth} label="Attendance Days (Month)" />
      </div>
      <div className="sg" style={{ marginTop: 4 }}>
        <StatCard color="or" icon="event_note" value={leaveCounted} label="Leave Counted (Approved)" />
        <StatCard color="bl" icon="schedule" value={`${trackFilled} slots`} label="Today's Tracking" />
      </div>

      {/* My leads */}
      <div className="card" style={{ marginTop: 8 }}>
        <div className="ch"><h3>My Leads</h3>{myLeads.length > 0 && <button className="btn bsm bo" onClick={exportMyLeads}><span className="material-icons-round" style={{ fontSize: 16 }}>download</span> Export CSV</button>}</div>
        <div className="cb" style={{ padding: 0 }}><div className="tw"><table><thead><tr><th>Name</th><th>Phone</th><th>Status</th><th>Priority</th><th>Expected</th><th>Follow-up</th></tr></thead><tbody>
          {myLeads.slice(0, 50).map(l => (
            <tr key={l.id}>
              <td><strong>{l.name}</strong></td>
              <td style={{ fontSize: '.82rem' }}>{l.phone || '-'}</td>
              <td><StatusBadge status={l.status} /></td>
              <td style={{ fontSize: '.82rem' }}>{l.priority || '-'}</td>
              <td style={{ fontSize: '.82rem' }}>{l.expectedValue ? formatCurrency(l.expectedValue) : '-'}</td>
              <td style={{ fontSize: '.82rem' }}>{l.followUpStatus || '-'}</td>
            </tr>
          ))}
          {!myLeads.length && <tr><td colSpan="6"><EmptyState icon="leaderboard" title="No leads assigned to you" message="Leads assigned to you will appear here." /></td></tr>}
        </tbody></table></div></div>
      </div>

      {/* Two-up: attendance + leave */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 18, marginTop: 18 }}>
        <div className="card">
          <div className="ch"><h3>My Recent Attendance</h3></div>
          <div className="cb" style={{ padding: 0 }}><div className="tw"><table><thead><tr><th>Date</th><th>Time</th><th>Type</th></tr></thead><tbody>
            {myAttendance.slice(0, 10).map(a => (
              <tr key={a.id}><td style={{ fontSize: '.82rem' }}>{formatDate(a.date)}</td><td style={{ fontSize: '.82rem' }}>{a.time}</td><td style={{ fontSize: '.82rem' }}>{a.type}</td></tr>
            ))}
            {!myAttendance.length && <tr><td colSpan="3"><EmptyState icon="how_to_reg" title="No attendance yet" message="Mark attendance from the Attendance page." /></td></tr>}
          </tbody></table></div></div>
        </div>
        <div className="card">
          <div className="ch"><h3>My Leave</h3></div>
          <div className="cb" style={{ padding: 0 }}><div className="tw"><table><thead><tr><th>Type</th><th>Dates</th><th>Days</th><th>Status</th></tr></thead><tbody>
            {myLeave.slice(0, 10).map(lr => (
              <tr key={lr.id}>
                <td style={{ fontSize: '.82rem' }}>{lr.leaveType === 'Other' ? (lr.leaveTypeOther || 'Other') : lr.leaveType}</td>
                <td style={{ fontSize: '.8rem', whiteSpace: 'nowrap' }}>{formatDate(lr.fromDate)}{lr.toDate && lr.toDate !== lr.fromDate ? ' – ' + formatDate(lr.toDate) : ''}</td>
                <td style={{ fontSize: '.82rem' }}>{lr.days} → {lr.countedDays}</td>
                <td><StatusBadge status={lr.status} /></td>
              </tr>
            ))}
            {!myLeave.length && <tr><td colSpan="4"><EmptyState icon="event_note" title="No leave requests" message="Apply for leave from the Leave page." /></td></tr>}
          </tbody></table></div></div>
        </div>
      </div>
    </>
  );
}
