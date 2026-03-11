import React from 'react';
import { useData } from '../context/DataContext';
import { formatCurrency, toNumber } from '../services/helpers';
import { StatCard, ProgressBar } from '../components/SharedUI';

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

export default function Reports() {
  const { leads, customers, installations, income, expenses, retailers, influencers, team, leadPOs } = useData();
  const tI = income.reduce((s, i) => s + toNumber(i.amount), 0);
  const tE = expenses.reduce((s, i) => s + toNumber(i.amount), 0);

  const exportLeads = () => {
    const headers = ['Name', 'Phone', 'Email', 'Address', 'City', 'District', 'Pincode', 'Status', 'Priority', 'kW Required', 'Monthly Bill', 'Expected Value', 'Lead Source', 'Assigned To', 'Sales Executive', 'Site Visit', 'Quotation Sent', 'Advance Paid', 'Existing Connection', 'Follow-up Status', 'Next Follow-up', 'Date Generated', 'Notes'];
    const rows = leads.map(l => [l.name, l.phone, l.email, l.address, l.city, l.district, l.pincode, l.status, l.priority, l.kwRequired, l.monthlyBill, l.expectedValue, l.leadReference, l.assignedTo, l.salesExecutive, l.siteVisit, l.quotationSent, l.advancePaid, l.existingConnection, l.followUpStatus, l.nextFollowUpDate, l.dateGenerated, l.notes]);
    downloadCSV('PPS_Leads_' + new Date().toISOString().slice(0, 10) + '.csv', headers, rows);
  };

  const exportCustomers = () => {
    const headers = ['Name', 'Phone', 'Email', 'Address', 'City', 'kW', 'Total Price', 'Payment Type', 'Advance Amount', 'Status'];
    const rows = customers.map(c => [c.name, c.phone, c.email, c.address, c.city, c.kw, c.totalPrice, c.paymentType, c.advanceAmount, c.status]);
    downloadCSV('PPS_Customers_' + new Date().toISOString().slice(0, 10) + '.csv', headers, rows);
  };

  const exportTeam = () => {
    const headers = ['Name', 'Phone', 'Email', 'Role', 'Status', 'Age', 'Salary', 'Attendance', 'Joining Date', 'Bank Name', 'Account Number', 'IFSC Code', 'Aadhar', 'PAN', 'Address', 'Emergency Contact', 'Qualification'];
    const rows = team.map(t => [t.name, t.phone, t.email, t.role, t.status, t.age, t.salary, t.attendance, t.joiningDate, t.bankName, t.accountNumber, t.ifscCode, t.aadharNumber, t.panNumber, t.address, t.emergencyContactName, t.qualification]);
    downloadCSV('PPS_Team_' + new Date().toISOString().slice(0, 10) + '.csv', headers, rows);
  };

  const exportRevenue = () => {
    const headers = ['Date', 'Type', 'Category', 'Amount', 'Description', 'Customer'];
    const incRows = income.map(i => [i.date, 'Income', i.category || '', i.amount, i.description || '', i.customer || '']);
    const expRows = expenses.map(e => [e.date, 'Expense', e.category || '', e.amount, e.description || '', e.vendor || '']);
    downloadCSV('PPS_Revenue_' + new Date().toISOString().slice(0, 10) + '.csv', headers, [...incRows, ...expRows]);
  };

  const exportInstallations = () => {
    const headers = ['Customer', 'Phone', 'Address', 'kW', 'Progress', 'Status', 'Start Date', 'Completion Date', 'Notes'];
    const rows = installations.map(i => [i.customerName, i.phone, i.address, i.kw, i.progress, i.status, i.startDate, i.completionDate, i.notes]);
    downloadCSV('PPS_Installations_' + new Date().toISOString().slice(0, 10) + '.csv', headers, rows);
  };

  const exportPOs = () => {
    const headers = ['PO Number', 'Date', 'Customer', 'Vendor', 'kW', 'Agreed Price', 'Status'];
    const rows = leadPOs.map(p => [p.poNumber, p.poDate, p.customerName, p.vendorName, p.kwRequired, p.agreedPrice || p.totalValue, p.status]);
    downloadCSV('PPS_PurchaseOrders_' + new Date().toISOString().slice(0, 10) + '.csv', headers, rows);
  };

  return (
    <>
      <div className="sg" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        <StatCard color="bl" icon="leaderboard" value={leads.length} label="Total Leads" />
        <StatCard color="gr" icon="people" value={customers.length} label="Customers" />
        <StatCard color="or" icon="solar_power" value={installations.length} label="Installations" />
        <StatCard color="pu" icon="savings" value={formatCurrency(tI - tE)} label="Net Profit" />
      </div>

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
