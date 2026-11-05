import React, { useState, useMemo } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { formatCurrency, toNumber, todayStr, formatDate, formatDateTime, escapeHtml, openHtmlSafely } from '../services/helpers';
import { StatCard, ProgressBar, DateInput, EmptyState } from '../components/SharedUI';
import { submittedReports, reportRows, reportRoll, planningScope, sentPlans, planRoll, planExportRows } from '../services/planning';

function downloadCSV(filename, headers, rows) {
  const escape = (v) => {
    const s = v == null ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv = [headers.join(','), ...rows.map(r => r.map(escape).join(','))].join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

// Daily reports (Req 7, 30-Oct): who has reported for a work date, and the
// submitted reports as a CSV — never a draft, never a plan for another day.
function DailyReports() {
  const { tracking, users } = useData();
  const { user, role } = useAuth();
  const [date, setDate] = useState(todayStr());
  // Req 8 (4-Nov): the Owner, Management, Admin and the Operation Manager see
  // everyone; a Team Leader their own members and themselves; nobody else sees
  // this card at all.
  const scope = useMemo(() => planningScope(users, user, role), [users, user, role]);
  const people = useMemo(() => (scope.all || scope.people.length > 1 ? scope.people : []), [scope]);
  const roll = useMemo(() => reportRoll(tracking, people, date), [tracking, people, date]);
  const submitted = roll.filter(r => r.submitted).length;
  if (!people.length) return null;

  const exportDay = () => {
    const docs = submittedReports(tracking, { date }).filter(d => people.some(p => String(p.email || '').toLowerCase() === String(d.employeeEmail || '').toLowerCase()));
    if (!docs.length) { window.alert(`No submitted reports for ${formatDate(date)}.`); return; }
    exportReports(docs, 'PPS_Daily_Reports_' + date + '.csv');
  };
  const exportMonth = () => {
    const month = date.slice(0, 7);
    const docs = submittedReports(tracking, { month }).filter(d => people.some(p => String(p.email || '').toLowerCase() === String(d.employeeEmail || '').toLowerCase()));
    if (!docs.length) { window.alert('No submitted reports in that month.'); return; }
    exportReports(docs, 'PPS_Daily_Reports_' + month + '.csv');
  };

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="ch" style={{ flexWrap: 'wrap', gap: 8 }}>
        <h3><span className="material-icons-round" style={{ fontSize: 20, verticalAlign: 'middle', marginRight: 6 }}>fact_check</span>Daily Reports</h3>
        <div className="df">
          <DateInput value={date} onChange={e => setDate(e.target.value || todayStr())} />
          <button className="btn bsm bo" onClick={exportDay} title="Only the reports submitted for this work date"><span className="material-icons-round" style={{ fontSize: 16 }}>download</span> Submitted ({submitted})</button>
          <button className="btn bsm bo" onClick={exportMonth} title="Every report submitted in this month, by work date"><span className="material-icons-round" style={{ fontSize: 16 }}>download</span> Month</button>
        </div>
      </div>
      <div className="cb" style={{ padding: 0 }}>
        <div className="tw tw-m"><table style={{ fontSize: '.84rem' }}>
          <thead><tr><th>Employee</th><th>Work date</th><th>Status</th><th>Submitted at</th><th>Slots</th></tr></thead>
          <tbody>
            {roll.map(r => (
              <tr key={r.email}>
                <td className="m-h"><strong>{r.name}</strong>{r.designation && <div style={{ fontSize: '.74rem', color: 'var(--muted)' }}>{r.designation}</div>}</td>
                <td data-l="Work date" style={{ whiteSpace: 'nowrap' }}>{formatDate(date)}</td>
                <td data-l="Status"><span className={`st ${r.submitted ? 'st-g' : r.label === 'Draft' ? 'st-o' : 'st-r'}`} style={{ padding: '2px 8px', fontSize: '.72rem' }}>{r.submitted ? 'Submitted' : r.label === 'Draft' ? 'Draft / incomplete' : 'Missing'}</span></td>
                <td data-l="Submitted at" style={{ fontSize: '.8rem' }}>{r.submitted && r.at ? formatDateTime(r.at) : '-'}</td>
                <td data-l="Slots">{r.slots || '-'}</td>
              </tr>
            ))}
            {!roll.length && <tr><td colSpan="5"><EmptyState icon="groups" title="Nobody to report" message="" /></td></tr>}
          </tbody>
        </table></div>
        <p style={{ fontSize: '.74rem', color: 'var(--muted)', margin: 0, padding: '10px 16px' }}>
          {submitted} of {roll.length} submitted for {formatDate(date)}. The CSV carries submitted reports only, by the work date they belong to; drafts and plans for other days are left out.
        </p>
      </div>
    </div>
  );
}

function exportReports(docs, filename) {
  const headers = ['Employee', 'Email', 'Report Date', 'Submitted At', 'Status', 'Time Slot', 'Report Details', 'Notes', 'Postponed To'];
  const rows = [];
  docs.forEach(d => reportRows(d).forEach(r => rows.push([r.employee, r.email, formatDate(r.date), r.submittedAt ? formatDateTime(r.submittedAt) : '', r.status, r.slot, r.text, r.reason, r.postponedTo ? formatDate(r.postponedTo.slice(0, 10)) + r.postponedTo.slice(10) : ''])));
  downloadCSV(filename, headers, rows);
}

// Daily planning (Req 5, 4-Nov): who has SENT their plan for a date, employee
// by employee, with the sent plans as a CSV and as a printable sheet — for the
// day or the month. Same people rule as the Daily Reports card.
function DailyPlanning() {
  const { tracking, users } = useData();
  const { user, role } = useAuth();
  const [date, setDate] = useState(todayStr());
  const [view, setView] = useState('day');            // 'day' | 'month'
  const scope = useMemo(() => planningScope(users, user, role), [users, user, role]);
  const people = useMemo(() => (scope.all || scope.people.length > 1 ? scope.people : []), [scope]);
  const roll = useMemo(() => planRoll(tracking, people, date), [tracking, people, date]);
  const month = date.slice(0, 7);
  const mine = (d) => people.some(p => String(p.email || '').toLowerCase() === String(d.employeeEmail || '').toLowerCase());
  const monthDocs = useMemo(() => sentPlans(tracking, { month }).filter(mine), [tracking, month, people]); // eslint-disable-line react-hooks/exhaustive-deps
  const sent = roll.filter(r => r.sent).length;
  if (!people.length) return null;

  const docsFor = () => (view === 'day' ? sentPlans(tracking, { date }).filter(mine) : monthDocs);
  const label = view === 'day' ? formatDate(date) : new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const exportPlans = () => {
    const docs = docsFor();
    if (!docs.length) { window.alert(`No plans sent for ${label}.`); return; }
    // Req 4 (5-Nov): the day the plan is FOR and the day it was actually SUBMITTED, side by side.
    const headers = ['Employee', 'Email', 'Plan For', 'Submitted On', 'Submission Status', 'Time Slot', 'Planned Work', 'Status'];
    const rows = [];
    docs.forEach(d => planExportRows(d).forEach(r => rows.push([r.employee, r.email, formatDate(r.date), r.sentAt ? formatDateTime(r.sentAt) : '', 'Submitted', r.slot, r.text, r.status])));
    downloadCSV('PPS_Daily_Planning_' + (view === 'day' ? date : month) + '.csv', headers, rows);
  };
  const printPlans = () => {
    const docs = docsFor();
    if (!docs.length) { window.alert(`No plans sent for ${label}.`); return; }
    const e = escapeHtml;
    const byEmployee = docs.map(d => `
      <div class="emp"><h2>${e(d.employeeName || d.employeeEmail)} <span>Plan for ${e(formatDate(d.date))}${d.planSentAt ? ' · submitted on ' + e(formatDateTime(d.planSentAt)) : ''}</span></h2>
      <table><thead><tr><th style="width:170px">Time slot</th><th>Planned work</th><th style="width:110px">Status</th></tr></thead><tbody>
      ${planExportRows(d).map(r => `<tr><td>${e(r.slot)}</td><td>${e(r.text)}</td><td>${e(r.status)}</td></tr>`).join('')}
      </tbody></table></div>`).join('');
    const html = `<html><head><title>Daily Planning - ${e(label)}</title>
<style>body{font-family:Arial,sans-serif;padding:28px 36px;color:#222;font-size:12.5px}h1{font-size:18px;color:#1a3a7a;margin:0 0 2px}.sub{color:#666;margin-bottom:18px}.emp{page-break-inside:avoid;margin-bottom:18px}h2{font-size:14px;margin:0 0 6px;color:#1a3a7a}h2 span{font-weight:400;color:#666;font-size:12px;margin-left:8px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:5px 8px;text-align:left;vertical-align:top}th{background:#f3f5f9}@media print{body{padding:10px 14px}}</style></head><body>
<h1>Pragathi Power Solutions — Daily Planning</h1><div class="sub">${e(label)} · ${docs.length} plan${docs.length === 1 ? '' : 's'} sent · printed ${e(formatDateTime(new Date().toISOString()))}</div>${byEmployee}</body></html>`;
    openHtmlSafely(html, true);
  };

  return (
    <div className="card" style={{ marginBottom: 18 }} data-card="daily-planning">
      <div className="ch" style={{ flexWrap: 'wrap', gap: 8 }}>
        <h3><span className="material-icons-round" style={{ fontSize: 20, verticalAlign: 'middle', marginRight: 6 }}>event_note</span>Daily Planning</h3>
        <div className="df">
          <DateInput value={date} onChange={e => setDate(e.target.value || todayStr())} />
          <span className="chips">
            <span className={`fc ${view === 'day' ? 'act' : ''}`} onClick={() => setView('day')}>Day</span>
            <span className={`fc ${view === 'month' ? 'act' : ''}`} onClick={() => setView('month')}>Month</span>
          </span>
          <button className="btn bsm bo" onClick={exportPlans} title={`The plans sent for the ${view}, as a CSV`}><span className="material-icons-round" style={{ fontSize: 16 }}>download</span> CSV</button>
          <button className="btn bsm bo" onClick={printPlans} title={`The plans sent for the ${view}, laid out for printing`}><span className="material-icons-round" style={{ fontSize: 16 }}>print</span> Print</button>
        </div>
      </div>
      <div className="cb" style={{ padding: 0 }}>
        {view === 'day' ? (
          <div className="tw tw-m"><table style={{ fontSize: '.84rem' }}>
            <thead><tr><th>Employee</th><th>Plan for</th><th>Submitted on</th><th>Submission status</th><th>Slots</th><th>Report</th></tr></thead>
            <tbody>
              {roll.map(r => (
                <tr key={r.email}>
                  <td className="m-h"><strong>{r.name}</strong>{r.designation && <div style={{ fontSize: '.74rem', color: 'var(--muted)' }}>{r.designation}</div>}</td>
                  <td data-l="Plan for" style={{ whiteSpace: 'nowrap' }}>{formatDate(date)}</td>
                  <td data-l="Submitted on" style={{ fontSize: '.8rem', whiteSpace: 'nowrap' }}>{r.sent && r.at ? formatDateTime(r.at) : '-'}</td>
                  <td data-l="Submission status"><span className={`st ${r.sent ? 'st-g' : r.label === 'Draft' ? 'st-o' : 'st-r'}`} style={{ padding: '2px 8px', fontSize: '.72rem' }}>{r.sent ? 'Submitted' : r.label === 'Draft' ? 'Draft / not submitted' : 'Not submitted'}</span></td>
                  <td data-l="Slots">{r.slots || '-'}</td>
                  <td data-l="Report" style={{ fontSize: '.78rem' }}>{r.doc && r.doc.submitted ? <span className="st st-g" style={{ padding: '2px 8px', fontSize: '.7rem' }}>Reported</span> : <span style={{ color: 'var(--muted)' }}>-</span>}</td>
                </tr>
              ))}
              {!roll.length && <tr><td colSpan="6"><EmptyState icon="groups" title="Nobody to show" message="" /></td></tr>}
            </tbody>
          </table></div>
        ) : (
          <div className="tw tw-m"><table style={{ fontSize: '.84rem' }}>
            <thead><tr><th>Employee</th><th>Plans sent in {label}</th><th>Days reported</th><th>Last plan sent</th></tr></thead>
            <tbody>
              {people.map(p => {
                const em = String(p.email || '').toLowerCase();
                const docs = monthDocs.filter(d => String(d.employeeEmail || '').toLowerCase() === em);
                const last = docs.map(d => d.planSentAt || '').sort().pop() || '';
                return (
                  <tr key={em}>
                    <td className="m-h"><strong>{p.displayName || p.email}</strong>{p.designation && <div style={{ fontSize: '.74rem', color: 'var(--muted)' }}>{p.designation}</div>}</td>
                    <td data-l="Plans sent" style={{ fontWeight: 600 }}>{docs.length}</td>
                    <td data-l="Days reported">{docs.filter(d => d.submitted).length}</td>
                    <td data-l="Last plan sent" style={{ fontSize: '.8rem' }}>{last ? formatDateTime(last) : '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
        <p style={{ fontSize: '.74rem', color: 'var(--muted)', margin: 0, padding: '10px 16px' }}>
          {view === 'day' ? `${sent} of ${roll.length} submitted their plan for ${formatDate(date)}. "Plan for" is the day the plan covers; "Submitted on" is when it was actually sent.` : `${monthDocs.length} plans sent in ${label}.`} The CSV and the printout carry sent plans only. The reminder goes out at 5:30 PM to anyone whose plan is still pending; plans are due by 6:30 PM.
        </p>
      </div>
    </div>
  );
}

export default function Reports() {
  const { leads, customers, installations, income, expenses, retailers, influencers, team, leadPOs } = useData();
  const tI = income.reduce((s, i) => s + toNumber(i.amount), 0);
  const tE = expenses.reduce((s, i) => s + toNumber(i.amount), 0);

  const exportLeads = () => {
    const headers = ['Name', 'Phone', 'Email', 'Address', 'City', 'District', 'Pincode', 'Status', 'Priority', 'kW Required', 'Monthly Bill', 'Expected Value', 'Lead Source', 'Assigned To', 'Sales Executive', 'Site Visit', 'Quotation Sent', 'Advance Paid', 'Existing Connection', 'Follow-up Status', 'Next Follow-up', 'Date Generated', 'Notes'];
    const rows = leads.map(l => [l.name, l.phone, l.email, l.address, l.city, l.district, l.pincode, l.status, l.priority, l.kwRequired, l.monthlyBill, l.expectedValue, l.leadReference, l.assignedTo, l.salesExecutive, l.siteVisit, l.quotationSent, l.advancePaid, l.existingConnection, l.followUpStatus, l.nextFollowUpDate, l.dateGenerated, l.notes]);
    downloadCSV('PPS_Leads_' + todayStr() + '.csv', headers, rows);
  };

  const exportCustomers = () => {
    const headers = ['Name', 'Phone', 'Email', 'Address', 'City', 'kW', 'Total Price', 'Payment Type', 'Advance Amount', 'Status'];
    const rows = customers.map(c => [c.name, c.phone, c.email, c.address, c.city, c.kw, c.totalPrice, c.paymentType, c.advanceAmount, c.status]);
    downloadCSV('PPS_Customers_' + todayStr() + '.csv', headers, rows);
  };

  const exportTeam = () => {
    const headers = ['Name', 'Phone', 'Email', 'Role', 'Status', 'Age', 'Salary', 'Attendance', 'Joining Date', 'Bank Name', 'Account Number', 'IFSC Code', 'Aadhar', 'PAN', 'Address', 'Emergency Contact', 'Qualification'];
    const rows = team.map(t => [t.name, t.phone, t.email, t.role, t.status, t.age, t.salary, t.attendance, t.joiningDate, t.bankName, t.accountNumber, t.ifscCode, t.aadharNumber, t.panNumber, t.address, t.emergencyContactName, t.qualification]);
    downloadCSV('PPS_Team_' + todayStr() + '.csv', headers, rows);
  };

  const exportRevenue = () => {
    const headers = ['Date', 'Type', 'Category', 'Amount', 'Description', 'Customer'];
    const incRows = income.map(i => [i.date, 'Income', i.category || '', i.amount, i.desc || i.description || '', i.customer || '']);
    const expRows = expenses.map(e => [e.date, 'Expense', e.category || '', e.amount, e.desc || e.description || '', e.vendor || '']);
    downloadCSV('PPS_Revenue_' + todayStr() + '.csv', headers, [...incRows, ...expRows]);
  };

  const exportInstallations = () => {
    const headers = ['Customer', 'Phone', 'Address', 'kW', 'Progress', 'Status', 'Start Date', 'Completion Date', 'Notes'];
    const rows = installations.map(i => [i.customerName, i.phone, i.address, i.kw, i.progress, i.status, i.startDate, i.completionDate, i.notes]);
    downloadCSV('PPS_Installations_' + todayStr() + '.csv', headers, rows);
  };

  const exportPOs = () => {
    const headers = ['PO Number', 'Date', 'Customer', 'Vendor', 'kW', 'Agreed Price', 'Status'];
    const rows = leadPOs.map(p => [p.poNumber, p.poDate, p.customerName, p.vendorName, p.kwRequired, p.agreedPrice || p.totalValue, p.status]);
    downloadCSV('PPS_PurchaseOrders_' + todayStr() + '.csv', headers, rows);
  };

  return (
    <>
      <div className="sg" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        <StatCard color="bl" icon="leaderboard" value={leads.length} label="Total Leads" />
        <StatCard color="gr" icon="people" value={customers.length} label="Customers" />
        <StatCard color="or" icon="solar_power" value={installations.length} label="Installations" />
        <StatCard color="pu" icon="savings" value={formatCurrency(tI - tE)} label="Net Profit" />
      </div>

      <DailyPlanning />
      <DailyReports />

      {/* Export Section */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="ch"><h3>Export Data (CSV)</h3></div>
        <div className="cb">
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn bo" onClick={exportLeads} style={{ fontSize: '.82rem' }}>
              <span className="material-icons-round" style={{ fontSize: 16 }}>download</span> Leads ({leads.length})
            </button>
            <button className="btn bo" onClick={exportCustomers} style={{ fontSize: '.82rem' }}>
              <span className="material-icons-round" style={{ fontSize: 16 }}>download</span> Customers ({customers.length})
            </button>
            <button className="btn bo" onClick={exportTeam} style={{ fontSize: '.82rem' }}>
              <span className="material-icons-round" style={{ fontSize: 16 }}>download</span> Team ({team.length})
            </button>
            <button className="btn bo" onClick={exportRevenue} style={{ fontSize: '.82rem' }}>
              <span className="material-icons-round" style={{ fontSize: 16 }}>download</span> Revenue ({income.length + expenses.length})
            </button>
            <button className="btn bo" onClick={exportInstallations} style={{ fontSize: '.82rem' }}>
              <span className="material-icons-round" style={{ fontSize: 16 }}>download</span> Installations ({installations.length})
            </button>
            <button className="btn bo" onClick={exportPOs} style={{ fontSize: '.82rem' }}>
              <span className="material-icons-round" style={{ fontSize: 16 }}>download</span> Purchase Orders ({leadPOs.length})
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <div className="card"><div className="ch"><h3>Lead Conversion</h3></div><div className="cb">
          {['Interested', 'Converted', 'Not Interested', 'Not Converted'].map(s => {
            const n = leads.filter(l => l.status === s).length;
            const p = leads.length ? Math.round(n / leads.length * 100) : 0;
            const c = s === 'Converted' ? 'gr' : s === 'Interested' ? 'bl' : 'or';
            return (
              <div key={s} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: '.85rem' }}><span>{s}</span><span style={{ fontWeight: 700 }}>{n} ({p}%)</span></div>
                <ProgressBar value={p} color={c} />
              </div>
            );
          })}
        </div></div>
        <div className="card"><div className="ch"><h3>Revenue Breakdown</h3></div><div className="cb">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: '.9rem' }}><span>Total Income</span><span style={{ fontWeight: 700, color: 'var(--ok)' }}>{formatCurrency(tI)}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: '.9rem' }}><span>Total Expenses</span><span style={{ fontWeight: 700, color: 'var(--err)' }}>{formatCurrency(tE)}</span></div>
          <hr style={{ border: 'none', borderTop: '2px solid var(--bor)', margin: '10px 0' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.05rem' }}><span style={{ fontWeight: 700 }}>Net Profit</span><span style={{ fontWeight: 800, color: tI - tE >= 0 ? 'var(--ok)' : 'var(--err)' }}>{formatCurrency(tI - tE)}</span></div>
        </div></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginTop: 18 }}>
        <div className="card"><div className="ch"><h3>Retailer Performance</h3></div><div className="cb">
          {retailers.filter(r => r.status === 'Active').length ? retailers.filter(r => r.status === 'Active').slice(0, 5).map(r => {
            const referred = leads.filter(l => l.referredByType === 'Retailer' && l.referredById === r.id);
            const conversions = referred.filter(l => l.status === 'Converted').length;
            const rate = referred.length ? Math.round(conversions / referred.length * 100) : 0;
            return (
              <div key={r.id} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: '.85rem' }}><span>{r.name}</span><span style={{ fontWeight: 700 }}>{conversions}/{referred.length} ({rate}%)</span></div>
                <ProgressBar value={rate} />
              </div>
            );
          }) : <p style={{ color: 'var(--muted)', fontSize: '.88rem' }}>No active retailers</p>}
        </div></div>
        <div className="card"><div className="ch"><h3>Influencer Performance</h3></div><div className="cb">
          {influencers.filter(i => i.status === 'Active').length ? influencers.filter(i => i.status === 'Active').slice(0, 5).map(inf => {
            const referred = leads.filter(l => l.referredByType === 'Influencer' && l.referredById === inf.id);
            const conversions = referred.filter(l => l.status === 'Converted').length;
            const rate = referred.length ? Math.round(conversions / referred.length * 100) : 0;
            return (
              <div key={inf.id} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: '.85rem' }}><span>{inf.name}</span><span style={{ fontWeight: 700 }}>{conversions}/{referred.length} ({rate}%)</span></div>
                <ProgressBar value={rate} />
              </div>
            );
          }) : <p style={{ color: 'var(--muted)', fontSize: '.88rem' }}>No active influencers</p>}
        </div></div>
      </div>
    </>
  );
}
