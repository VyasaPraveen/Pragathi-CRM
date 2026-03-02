import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { formatCurrency, formatDate, toNumber } from '../services/helpers';
import { StatCard, StatusBadge, ProgressBar } from '../components/SharedUI';

export default function Dashboard() {
  const navigate = useNavigate();
  const { role, designation } = useAuth();
  const { leads, customers, installations, income, expenses, materials, reminders, purchaseOrders, employeeTasks, retailers, influencers, team, leadPOs } = useData();

  const stats = useMemo(() => {
    const tl = leads.length;
    const cv = leads.filter(l => l.status === 'Converted').length;
    const it = leads.filter(l => l.status === 'Interested').length;
    const ni = leads.filter(l => l.status === 'Not Interested').length;
    const nc = leads.filter(l => l.status === 'Not Converted').length;
    const tI = income.reduce((s, i) => s + toNumber(i.amount), 0);
    const tE = expenses.reduce((s, i) => s + toNumber(i.amount), 0);
    const pI = installations.filter(i => i.progress < 100).length;
    const pP = customers.filter(c => {
      const p = c.paymentType === 'Finance'
        ? toNumber(c.advanceReceivedAmount) + toNumber(c.finalAmount)
        : toNumber(c.advanceAmount) + toNumber(c.secondPayment) + toNumber(c.thirdPayment) + toNumber(c.finalPayment);
      return (toNumber(c.totalPrice) - p) > 0;
    }).length;
    const convRate = tl > 0 ? Math.round((cv / tl) * 100) : 0;
    return { tl, cv, it, ni, nc, tI, tE, pI, pP, convRate };
  }, [leads, customers, installations, income, expenses]);

  // Lead conversion funnel
  const funnel = useMemo(() => {
    const total = leads.length;
    const siteVisitDone = leads.filter(l => l.siteVisit === 'Yes').length;
    const quotSent = leads.filter(l => l.quotationSent === 'Yes').length;
    const advPaid = leads.filter(l => l.advancePaid === 'Yes').length;
    const converted = leads.filter(l => l.status === 'Converted').length;
    return [
      { label: 'Total Leads', count: total, color: '#6366f1' },
      { label: 'Site Visit Done', count: siteVisitDone, color: '#3b82f6' },
      { label: 'Quotation Sent', count: quotSent, color: '#f59e0b' },
      { label: 'Advance Paid', count: advPaid, color: '#f97316' },
      { label: 'Converted', count: converted, color: '#22c55e' }
    ];
  }, [leads]);

  // Monthly revenue chart data (last 6 months)
  const monthlyData = useMemo(() => {
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
      const mIncome = income.filter(r => {
        const rd = r.date ? (typeof r.date === 'string' ? r.date : (r.date.toDate ? r.date.toDate().toISOString().slice(0, 7) : '')) : '';
        return typeof rd === 'string' && rd.startsWith(key);
      }).reduce((s, r) => s + toNumber(r.amount), 0);
      const mExpense = expenses.filter(r => {
        const rd = r.date ? (typeof r.date === 'string' ? r.date : (r.date.toDate ? r.date.toDate().toISOString().slice(0, 7) : '')) : '';
        return typeof rd === 'string' && rd.startsWith(key);
      }).reduce((s, r) => s + toNumber(r.amount), 0);
      const mLeads = leads.filter(l => {
        const ld = l.dateGenerated || '';
        return typeof ld === 'string' && ld.startsWith(key);
      }).length;
      months.push({ key, label, income: mIncome, expense: mExpense, leads: mLeads });
    }
    return months;
  }, [income, expenses, leads]);

  // Top performers (by lead count assigned)
  const topPerformers = useMemo(() => {
    const map = {};
    leads.forEach(l => {
      const a = l.assignedTo || l.salesExecutive;
      if (!a) return;
      if (!map[a]) map[a] = { name: a, total: 0, converted: 0 };
      map[a].total++;
      if (l.status === 'Converted') map[a].converted++;
    });
    return Object.values(map).sort((a, b) => b.total - a.total).slice(0, 5);
  }, [leads]);

  // Overdue / upcoming follow-ups
  const overdueFollowUps = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return leads
      .filter(l => l.nextFollowUpDate && l.nextFollowUpDate <= today && l.status !== 'Converted' && l.status !== 'Not Interested')
      .sort((a, b) => (a.nextFollowUpDate || '').localeCompare(b.nextFollowUpDate || ''))
      .slice(0, 8);
  }, [leads]);

  // Priority breakdown
  const priorityData = useMemo(() => {
    const hot = leads.filter(l => l.priority === 'Hot').length;
    const warm = leads.filter(l => l.priority === 'Warm').length;
    const cold = leads.filter(l => l.priority === 'Cold').length;
    return [
      { label: 'Hot', count: hot, color: '#ef4444' },
      { label: 'Warm', count: warm, color: '#f59e0b' },
      { label: 'Cold', count: cold, color: '#3b82f6' }
    ];
  }, [leads]);

  // Lead source breakdown
  const sourceData = useMemo(() => {
    const map = {};
    leads.forEach(l => {
      const s = l.leadReference || 'Unknown';
      map[s] = (map[s] || 0) + 1;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [leads]);

  const maxRevenue = Math.max(...monthlyData.map(m => Math.max(m.income, m.expense)), 1);
  const maxFunnel = Math.max(...funnel.map(f => f.count), 1);

  return (
    <>
      {/* Welcome */}
      <div style={{ marginBottom: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.3rem' }}>Dashboard</h2>
          <p style={{ color: 'var(--muted)', fontSize: '.84rem', margin: 0 }}>{designation || role} | {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ background: stats.convRate >= 30 ? 'rgba(34,197,94,.1)' : stats.convRate >= 15 ? 'rgba(245,158,11,.1)' : 'rgba(239,68,68,.1)', color: stats.convRate >= 30 ? '#22c55e' : stats.convRate >= 15 ? '#f59e0b' : '#ef4444', padding: '6px 14px', borderRadius: 8, fontWeight: 700, fontSize: '.9rem' }}>
            {stats.convRate}% Conversion Rate
          </div>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="sg">
        <StatCard color="bl" icon="leaderboard" value={stats.tl} label="Total Leads" />
        <StatCard color="gr" icon="check_circle" value={stats.cv} label="Converted" />
        <StatCard color="or" icon="trending_up" value={stats.it} label="Interested" />
        {role === 'admin' && <>
          <StatCard color="gr" icon="account_balance_wallet" value={formatCurrency(stats.tI)} label="Total Revenue" />
          <StatCard color="re" icon="payments" value={formatCurrency(stats.tE)} label="Total Expenses" />
          <StatCard color="pu" icon="savings" value={formatCurrency(stats.tI - stats.tE)} label="Net Profit" />
        </>}
        <StatCard color="or" icon="engineering" value={stats.pI} label="Pending Installs" />
        <StatCard color="re" icon="payment" value={stats.pP} label="Pending Payments" />
        <StatCard color="bl" icon="receipt_long" value={purchaseOrders.length + leadPOs.length} label="Purchase Orders" />
        <StatCard color="or" icon="task_alt" value={employeeTasks.filter(t => t.status === 'Pending' || t.status === 'In Progress').length} label="Active Tasks" />
        <StatCard color="pu" icon="storefront" value={retailers.filter(r => r.status === 'Active').length} label="Active Retailers" />
        <StatCard color="gr" icon="campaign" value={influencers.filter(i => i.status === 'Active').length} label="Active Influencers" />
      </div>

      {/* Row 1: Conversion Funnel + Revenue Chart */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginTop: 18 }}>
        {/* Conversion Funnel */}
        <div className="card">
          <div className="ch"><h3>Lead Conversion Funnel</h3></div>
          <div className="cb">
            {funnel.map((f, i) => (
              <div key={f.label} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontSize: '.82rem', fontWeight: 500 }}>{f.label}</span>
                  <span style={{ fontSize: '.82rem', fontWeight: 700 }}>{f.count}</span>
                </div>
                <div style={{ height: 22, background: 'var(--bor)', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
                  <div style={{ height: '100%', width: maxFunnel > 0 ? (f.count / maxFunnel * 100) + '%' : '0%', background: f.color, borderRadius: 4, transition: 'width .5s', minWidth: f.count > 0 ? 20 : 0 }} />
                  {f.count > 0 && <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', fontSize: '.7rem', color: '#fff', fontWeight: 600 }}>{maxFunnel > 0 ? Math.round(f.count / maxFunnel * 100) : 0}%</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Revenue Chart (CSS bars) */}
        {role === 'admin' ? (
          <div className="card">
            <div className="ch"><h3>Revenue vs Expenses (6 months)</h3></div>
            <div className="cb">
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', height: 160, padding: '0 4px' }}>
                {monthlyData.map(m => (
                  <div key={m.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                    <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 130, width: '100%' }}>
                      <div style={{ flex: 1, background: '#22c55e', borderRadius: '3px 3px 0 0', height: maxRevenue > 0 ? Math.max((m.income / maxRevenue) * 130, m.income > 0 ? 4 : 0) : 0, transition: 'height .5s' }} title={`Income: ${formatCurrency(m.income)}`} />
                      <div style={{ flex: 1, background: '#ef4444', borderRadius: '3px 3px 0 0', height: maxRevenue > 0 ? Math.max((m.expense / maxRevenue) * 130, m.expense > 0 ? 4 : 0) : 0, transition: 'height .5s' }} title={`Expense: ${formatCurrency(m.expense)}`} />
                    </div>
                    <span style={{ fontSize: '.68rem', color: 'var(--muted)' }}>{m.label}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 10, fontSize: '.74rem' }}>
                <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#22c55e', borderRadius: 2, marginRight: 4 }} />Revenue</span>
                <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#ef4444', borderRadius: 2, marginRight: 4 }} />Expenses</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="ch"><h3>Monthly Leads (6 months)</h3></div>
            <div className="cb">
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', height: 160, padding: '0 4px' }}>
                {monthlyData.map(m => {
                  const maxL = Math.max(...monthlyData.map(x => x.leads), 1);
                  return (
                    <div key={m.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                      <span style={{ fontSize: '.72rem', fontWeight: 600, color: 'var(--pri)' }}>{m.leads}</span>
                      <div style={{ width: '70%', background: 'var(--pri)', borderRadius: '3px 3px 0 0', height: Math.max((m.leads / maxL) * 120, m.leads > 0 ? 4 : 0), transition: 'height .5s' }} />
                      <span style={{ fontSize: '.68rem', color: 'var(--muted)' }}>{m.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Row 2: Priority + Lead Source */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginTop: 18 }}>
        {/* Priority Breakdown */}
        <div className="card">
          <div className="ch"><h3>Lead Priority</h3></div>
          <div className="cb">
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
              {priorityData.map(p => (
                <div key={p.label} style={{ textAlign: 'center', flex: 1 }}>
                  <div style={{ fontSize: '1.6rem', fontWeight: 700, color: p.color }}>{p.count}</div>
                  <div style={{ fontSize: '.76rem', color: 'var(--muted)' }}>{p.label}</div>
                </div>
              ))}
            </div>
            {leads.length > 0 && (
              <div style={{ height: 14, borderRadius: 7, overflow: 'hidden', display: 'flex', background: 'var(--bor)' }}>
                {priorityData.filter(p => p.count > 0).map(p => (
                  <div key={p.label} style={{ width: (p.count / leads.length * 100) + '%', background: p.color, height: '100%' }} title={`${p.label}: ${p.count}`} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Lead Source */}
        <div className="card">
          <div className="ch"><h3>Lead Sources</h3></div>
          <div className="cb">
            {sourceData.map(([src, count]) => {
              const pct = leads.length > 0 ? Math.round((count / leads.length) * 100) : 0;
              return (
                <div key={src} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <span style={{ fontSize: '.82rem', fontWeight: 500, minWidth: 90 }}>{src}</span>
                  <div style={{ flex: 1, height: 16, background: 'var(--bor)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: pct + '%', background: '#6366f1', borderRadius: 4, minWidth: count > 0 ? 16 : 0 }} />
                  </div>
                  <span style={{ fontSize: '.78rem', fontWeight: 600, minWidth: 40, textAlign: 'right' }}>{count} ({pct}%)</span>
                </div>
              );
            })}
            {!sourceData.length && <p style={{ color: 'var(--muted)', fontSize: '.84rem' }}>No lead data</p>}
          </div>
        </div>
      </div>

      {/* Row 3: Top Performers + Overdue Follow-ups */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginTop: 18 }}>
        {/* Top Performers */}
        <div className="card">
          <div className="ch"><h3>Top Performers</h3></div>
          <div className="cb" style={{ padding: 0 }}>
            <div className="tw"><table><thead><tr><th>#</th><th>Name</th><th>Leads</th><th>Converted</th><th>Rate</th></tr></thead><tbody>
              {topPerformers.map((p, i) => (
                <tr key={p.name}>
                  <td style={{ fontWeight: 700, color: i === 0 ? '#f59e0b' : 'var(--muted)' }}>{i === 0 ? '\u{1F3C6}' : i + 1}</td>
                  <td style={{ fontWeight: 600 }}>{p.name}</td>
                  <td>{p.total}</td>
                  <td style={{ color: '#22c55e', fontWeight: 600 }}>{p.converted}</td>
                  <td style={{ fontWeight: 600 }}>{p.total > 0 ? Math.round((p.converted / p.total) * 100) : 0}%</td>
                </tr>
              ))}
              {!topPerformers.length && <tr><td colSpan="5" style={{ textAlign: 'center', padding: 20, color: 'var(--muted)' }}>No data yet</td></tr>}
            </tbody></table></div>
          </div>
        </div>

        {/* Overdue Follow-ups */}
        <div className="card">
          <div className="ch">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {overdueFollowUps.length > 0 && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />}
              Overdue Follow-ups
              {overdueFollowUps.length > 0 && <span style={{ fontSize: '.76rem', color: '#ef4444', fontWeight: 600 }}>({overdueFollowUps.length})</span>}
            </h3>
            <button className="btn bsm bo" onClick={() => navigate('/leads')}>View All</button>
          </div>
          <div className="cb" style={{ padding: 0 }}>
            <div className="tw"><table><thead><tr><th>Name</th><th>Phone</th><th>Due Date</th><th>Status</th></tr></thead><tbody>
              {overdueFollowUps.map(l => (
                <tr key={l.id}>
                  <td style={{ fontWeight: 600 }}>{l.name}</td>
                  <td style={{ fontSize: '.82rem' }}>{l.phone}</td>
                  <td style={{ fontSize: '.82rem', color: '#ef4444', fontWeight: 600 }}>{l.nextFollowUpDate}</td>
                  <td><StatusBadge status={l.followUpStatus || l.status} /></td>
                </tr>
              ))}
              {!overdueFollowUps.length && <tr><td colSpan="4" style={{ textAlign: 'center', padding: 20, color: 'var(--muted)' }}>No overdue follow-ups</td></tr>}
            </tbody></table></div>
          </div>
        </div>
      </div>

      {/* Row 4: Recent Leads + Upcoming Reminders */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginTop: 18 }}>
        <div className="card">
          <div className="ch"><h3>Recent Leads</h3><button className="btn bsm bo" onClick={() => navigate('/leads')}>View All</button></div>
          <div className="cb" style={{ padding: 0 }}>
            <div className="tw"><table><thead><tr><th>Name</th><th>Status</th><th>Priority</th><th>Date</th></tr></thead><tbody>
              {leads.slice(0, 5).map(l => (
                <tr key={l.id}><td><strong>{l.name}</strong><br /><span style={{ fontSize: '.78rem', color: 'var(--muted)' }}>{l.phone}</span></td><td><StatusBadge status={l.status} /></td><td><StatusBadge status={l.priority} /></td><td style={{ fontSize: '.82rem' }}>{formatDate(l.dateGenerated)}</td></tr>
              ))}
              {!leads.length && <tr><td colSpan="4" style={{ textAlign: 'center', padding: 20, color: 'var(--muted)' }}>No leads yet</td></tr>}
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

      {/* Row 5: Installation Progress + Stock Alerts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginTop: 18 }}>
        <div className="card">
          <div className="ch"><h3>Installation Progress</h3><button className="btn bsm bo" onClick={() => navigate('/installations')}>View All</button></div>
          <div className="cb">
            {installations.filter(i => i.progress < 100).slice(0, 5).map(i => (
              <div key={i.id} style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontWeight: 600, fontSize: '.9rem' }}>{i.customerName}</span>
                  <span style={{ fontWeight: 700, fontSize: '.88rem', color: 'var(--pri)' }}>{i.progress}%</span>
                </div>
                <ProgressBar value={i.progress} />
              </div>
            ))}
            {!installations.filter(i => i.progress < 100).length && <p style={{ color: 'var(--muted)', fontSize: '.88rem' }}>No active installations</p>}
          </div>
        </div>
        <div className="card">
          <div className="ch"><h3>Stock Alerts</h3><button className="btn bsm bo" onClick={() => navigate('/materials')}>View All</button></div>
          <div className="cb">
            {materials.filter(m => m.balance < 30).slice(0, 5).map(m => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--bor)' }}>
                <span style={{ fontSize: '.88rem' }}>{m.name}</span>
                <span className={`st ${m.balance < 10 ? 'st-r' : m.balance < 30 ? 'st-o' : 'st-g'}`}>{m.balance} {m.unit}</span>
              </div>
            ))}
            {!materials.filter(m => m.balance < 30).length && <p style={{ color: 'var(--muted)', fontSize: '.88rem' }}>All stock levels are healthy</p>}
          </div>
        </div>
      </div>

      {/* Row 6: Team Summary (Admin only) */}
      {role === 'admin' && team.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div className="card">
            <div className="ch"><h3>Team Overview</h3><button className="btn bsm bo" onClick={() => navigate('/team')}>Manage</button></div>
            <div className="cb" style={{ padding: 0 }}>
              <div className="tw"><table><thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Attendance</th><th>Phone</th></tr></thead><tbody>
                {team.slice(0, 6).map(t => (
                  <tr key={t.id}>
                    <td style={{ fontWeight: 600 }}>{t.name}</td>
                    <td style={{ fontSize: '.82rem' }}>{t.role}</td>
                    <td><StatusBadge status={t.status} /></td>
                    <td style={{ fontSize: '.82rem' }}>{t.attendance || 0} days</td>
                    <td style={{ fontSize: '.82rem' }}>{t.phone || '-'}</td>
                  </tr>
                ))}
              </tbody></table></div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
