import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { formatCurrency, formatDate, toNumber } from '../services/helpers';
import { StatCard, StatusBadge, ProgressBar } from '../components/SharedUI';

export default function Dashboard() {
  const navigate = useNavigate();
  const { role } = useAuth();
  const { leads, customers, installations, income, expenses, materials, reminders } = useData();

  const tl = leads.length;
  const cv = leads.filter(l => l.status === 'Converted').length;
  const it = leads.filter(l => l.status === 'Interested').length;
  // D1/D3 fix: use toNumber for safe aggregation
  const tI = income.reduce((s, i) => s + toNumber(i.amount), 0);
  const tE = expenses.reduce((s, i) => s + toNumber(i.amount), 0);
  const pI = installations.filter(i => i.progress < 100).length;
  const pP = customers.filter(c => {
    const p = c.paymentType === 'Finance'
      ? toNumber(c.advanceReceivedAmount) + toNumber(c.finalAmount)
      : toNumber(c.advanceAmount) + toNumber(c.secondPayment) + toNumber(c.thirdPayment) + toNumber(c.finalPayment);
    return (toNumber(c.totalPrice) - p) > 0;
  }).length;

  return (
    <>
      <div className="sg">
        <StatCard color="bl" icon="leaderboard" value={tl} label="Total Leads" />
        <StatCard color="gr" icon="check_circle" value={cv} label="Converted" />
        <StatCard color="or" icon="trending_up" value={it} label="Interested" />
        {role === 'admin' && <>
          <StatCard color="gr" icon="account_balance_wallet" value={formatCurrency(tI)} label="Total Revenue" />
          <StatCard color="re" icon="payments" value={formatCurrency(tE)} label="Total Expenses" />
          <StatCard color="pu" icon="savings" value={formatCurrency(tI - tE)} label="Net Profit" />
        </>}
        <StatCard color="or" icon="engineering" value={pI} label="Pending Installations" />
        <StatCard color="re" icon="payment" value={pP} label="Pending Payments" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <div className="card">
          <div className="ch"><h3>Recent Leads</h3><button className="btn bsm bo" onClick={() => navigate('/leads')}>View All</button></div>
          <div className="cb" style={{ padding: 0 }}>
            <div className="tw"><table><thead><tr><th>Name</th><th>Status</th><th>Date</th></tr></thead><tbody>
              {leads.slice(0, 5).map(l => (
                <tr key={l.id}><td><strong>{l.name}</strong><br /><span style={{ fontSize: '.78rem', color: 'var(--muted)' }}>{l.phone}</span></td><td><StatusBadge status={l.status} /></td><td style={{ fontSize: '.82rem' }}>{formatDate(l.dateGenerated)}</td></tr>
              ))}
              {!leads.length && <tr><td colSpan="3" style={{ textAlign: 'center', padding: 20, color: 'var(--muted)' }}>No leads yet</td></tr>}
            </tbody></table></div>
          </div>
        </div>
        <div className="card">
          <div className="ch"><h3>Upcoming Reminders</h3><button className="btn bsm bo" onClick={() => navigate('/reminders')}>View All</button></div>
          <div className="cb" style={{ padding: 0 }}>
            <div className="tw"><table><thead><tr><th>Type</th><th>Customer</th><th>Date</th><th>Status</th></tr></thead><tbody>
              {reminders.slice(0, 5).map(r => (
                <tr key={r.id}><td style={{ fontWeight: 600 }}>{r.type}</td><td>{r.customer}</td><td style={{ fontSize: '.82rem' }}>{formatDate(r.date)}</td><td><StatusBadge status={r.status} /></td></tr>
              ))}
              {!reminders.length && <tr><td colSpan="4" style={{ textAlign: 'center', padding: 20, color: 'var(--muted)' }}>No reminders</td></tr>}
            </tbody></table></div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginTop: 18 }}>
        <div className="card">
          <div className="ch"><h3>Installation Progress</h3></div>
          <div className="cb">
            {installations.map(i => (
              <div key={i.id} style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontWeight: 600, fontSize: '.9rem' }}>{i.customerName}</span>
                  <span style={{ fontWeight: 700, fontSize: '.88rem', color: 'var(--pri)' }}>{i.progress}%</span>
                </div>
                <ProgressBar value={i.progress} />
              </div>
            ))}
            {!installations.length && <p style={{ color: 'var(--muted)', fontSize: '.88rem' }}>No active installations</p>}
          </div>
        </div>
        <div className="card">
          <div className="ch"><h3>Stock Alerts</h3></div>
          <div className="cb">
            {materials.map(m => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--bor)' }}>
                <span style={{ fontSize: '.88rem' }}>{m.name}</span>
                <span className={`st ${m.balance < 10 ? 'st-r' : m.balance < 30 ? 'st-o' : 'st-g'}`}>{m.balance} {m.unit}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
