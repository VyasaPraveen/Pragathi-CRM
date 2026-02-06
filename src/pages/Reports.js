import React from 'react';
import { useData } from '../context/DataContext';
import { formatCurrency, toNumber } from '../services/helpers';
import { StatCard, ProgressBar } from '../components/SharedUI';

export default function Reports() {
  const { leads, customers, installations, income, expenses } = useData();
  const tI = income.reduce((s, i) => s + toNumber(i.amount), 0);
  const tE = expenses.reduce((s, i) => s + toNumber(i.amount), 0);

  return (
    <>
      <div className="sg" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        <StatCard color="bl" icon="leaderboard" value={leads.length} label="Total Leads" />
        <StatCard color="gr" icon="people" value={customers.length} label="Customers" />
        <StatCard color="or" icon="solar_power" value={installations.length} label="Installations" />
        <StatCard color="pu" icon="savings" value={formatCurrency(tI - tE)} label="Net Profit" />
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
    </>
  );
}
