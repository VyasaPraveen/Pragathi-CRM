import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { formatCurrency, formatDate, toNumber, hasAccess } from '../services/helpers';
import { StatusBadge, ProgressBar } from '../components/SharedUI';

const COLORS = ['#6366f1','#3b82f6','#22c55e','#f59e0b','#ef4444','#ec4899','#8b5cf6','#14b8a6','#f97316','#06b6d4'];

function DonutChart({ segments, size = 140, thickness = 22, label, sublabel }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  const r = (size - thickness) / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={thickness} />
        {total > 0 && segments.filter(s => s.value > 0).map((seg, i) => {
          const pct = seg.value / total;
          const dash = pct * circ;
          const el = <circle key={i} cx={size/2} cy={size/2} r={r} fill="none" stroke={seg.color}
            strokeWidth={thickness} strokeDasharray={`${dash} ${circ - dash}`}
            strokeDashoffset={-offset} strokeLinecap="round" style={{ transition: 'all .8s ease' }} />;
          offset += dash;
          return el;
        })}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: '1.4rem', fontWeight: 800, color: '#1f2937' }}>{label}</span>
        {sublabel && <span style={{ fontSize: '.68rem', color: '#6b7280', marginTop: 2 }}>{sublabel}</span>}
      </div>
    </div>
  );
}

function MiniBarChart({ data, height = 130, barColor }) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height, padding: '0 2px' }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: '.65rem', fontWeight: 700, color: '#6b7280' }}>{d.value > 0 ? d.value : ''}</span>
          <div style={{
            width: '100%', maxWidth: 36, borderRadius: '6px 6px 0 0',
            height: Math.max((d.value / max) * (height - 30), d.value > 0 ? 6 : 2),
            background: barColor || `linear-gradient(180deg, ${COLORS[i % COLORS.length]}, ${COLORS[i % COLORS.length]}aa)`,
            transition: 'height .6s ease', boxShadow: d.value > 0 ? '0 2px 8px rgba(0,0,0,.1)' : 'none'
          }} />
          <span style={{ fontSize: '.62rem', color: '#9ca3af', fontWeight: 500 }}>{d.label}</span>
        </div>
      ))}
    </div>
  );
}

function GradientStatCard({ gradient, icon, value, label, onClick, subtext }) {
  return (
    <div onClick={onClick} style={{
      background: gradient, borderRadius: 16, padding: '20px 22px', color: '#fff',
      cursor: onClick ? 'pointer' : 'default', transition: 'all .3s', position: 'relative', overflow: 'hidden',
      boxShadow: '0 4px 15px rgba(0,0,0,.15)', minHeight: 110
    }} onMouseEnter={e => { if (onClick) e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 8px 25px rgba(0,0,0,.2)'; }}
       onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 15px rgba(0,0,0,.15)'; }}>
      <div style={{ position: 'absolute', top: -10, right: -10, opacity: 0.15, fontSize: 80 }}>
        <span className="material-icons-round" style={{ fontSize: 80 }}>{icon}</span>
      </div>
      <span className="material-icons-round" style={{ fontSize: 28, opacity: 0.9, marginBottom: 8, display: 'block' }}>{icon}</span>
      <div style={{ fontSize: '1.8rem', fontWeight: 800, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: '.78rem', opacity: 0.85, marginTop: 4, fontWeight: 500 }}>{label}</div>
      {subtext && <div style={{ fontSize: '.68rem', opacity: 0.7, marginTop: 2 }}>{subtext}</div>}
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { role, designation } = useAuth();
  const { leads, customers, installations, income, expenses, materials, reminders, employeeTasks, team } = useData();

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
    const totalPaid = customers.reduce((s, c) => {
      const p = c.paymentType === 'Finance'
        ? toNumber(c.advanceReceivedAmount) + toNumber(c.finalAmount)
        : toNumber(c.advanceAmount) + toNumber(c.secondPayment) + toNumber(c.thirdPayment) + toNumber(c.finalPayment);
      return s + p;
    }, 0);
    const totalDue = customers.reduce((s, c) => s + toNumber(c.totalPrice), 0) - totalPaid;
    const convRate = tl > 0 ? Math.round((cv / tl) * 100) : 0;
    return { tl, cv, it, ni, nc, tI, tE, pI, pP, convRate, totalPaid, totalDue };
  }, [leads, customers, installations, income, expenses]);

  // Lead status donut
  const statusSegments = useMemo(() => [
    { value: stats.cv, color: '#22c55e', label: 'Converted' },
    { value: stats.it, color: '#3b82f6', label: 'Interested' },
    { value: stats.ni, color: '#ef4444', label: 'Not Interested' },
    { value: stats.nc, color: '#f59e0b', label: 'Not Converted' }
  ], [stats]);

  // Conversion funnel
  const funnel = useMemo(() => {
    const total = leads.length;
    const sv = leads.filter(l => l.siteVisit === 'Yes').length;
    const qs = leads.filter(l => l.quotationSent === 'Yes').length;
    const ap = leads.filter(l => l.advancePaid === 'Yes').length;
    const cv = leads.filter(l => l.status === 'Converted').length;
    return [
      { label: 'Total Leads', count: total, color: '#6366f1', icon: 'groups' },
      { label: 'Site Visit', count: sv, color: '#3b82f6', icon: 'home_work' },
      { label: 'Quotation Sent', count: qs, color: '#f59e0b', icon: 'request_quote' },
      { label: 'Advance Paid', count: ap, color: '#f97316', icon: 'payments' },
      { label: 'Converted', count: cv, color: '#22c55e', icon: 'verified' }
    ];
  }, [leads]);

  // Monthly revenue (last 6 months)
  const monthlyData = useMemo(() => {
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('en-IN', { month: 'short' });
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

  // Top performers
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

  // Overdue follow-ups
  const overdueFollowUps = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return leads
      .filter(l => l.nextFollowUpDate && l.nextFollowUpDate <= today && l.status !== 'Converted' && l.status !== 'Not Interested')
      .sort((a, b) => (a.nextFollowUpDate || '').localeCompare(b.nextFollowUpDate || ''))
      .slice(0, 8);
  }, [leads]);

  // Priority donut
  const prioritySegments = useMemo(() => [
    { value: leads.filter(l => l.priority === 'Hot').length, color: '#ef4444', label: 'Hot' },
    { value: leads.filter(l => l.priority === 'Warm').length, color: '#f59e0b', label: 'Warm' },
    { value: leads.filter(l => l.priority === 'Cold').length, color: '#3b82f6', label: 'Cold' }
  ], [leads]);

  // Lead source breakdown
  const sourceData = useMemo(() => {
    const map = {};
    leads.forEach(l => { const s = l.leadReference || 'Unknown'; map[s] = (map[s] || 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [leads]);

  // Task summary donut
  const taskSegments = useMemo(() => [
    { value: employeeTasks.filter(t => t.status === 'Pending').length, color: '#f59e0b', label: 'Pending' },
    { value: employeeTasks.filter(t => t.status === 'In Progress').length, color: '#3b82f6', label: 'In Progress' },
    { value: employeeTasks.filter(t => t.status === 'Completed').length, color: '#22c55e', label: 'Completed' },
    { value: employeeTasks.filter(t => t.status === 'Overdue').length, color: '#ef4444', label: 'Overdue' }
  ], [employeeTasks]);

  // City-wise lead distribution
  const cityData = useMemo(() => {
    const map = {};
    leads.forEach(l => { const c = l.city || 'Unknown'; map[c] = (map[c] || 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [leads]);

  // Payment type donut
  const paymentSegments = useMemo(() => [
    { value: customers.filter(c => c.paymentType === 'Cash').length, color: '#22c55e', label: 'Cash' },
    { value: customers.filter(c => c.paymentType === 'Finance').length, color: '#6366f1', label: 'Finance' }
  ], [customers]);

  const maxRevenue = Math.max(...monthlyData.map(m => Math.max(m.income, m.expense)), 1);

  return (
    <>
      {/* Welcome Banner */}
      <div style={{
        background: 'linear-gradient(135deg, #1a3a7a 0%, #2a5cb8 50%, #6366f1 100%)',
        borderRadius: 18, padding: '24px 30px', marginBottom: 22, color: '#fff',
        position: 'relative', overflow: 'hidden', boxShadow: '0 8px 30px rgba(26,58,122,.3)'
      }}>
        <div style={{ position: 'absolute', top: -40, right: -20, width: 200, height: 200, background: 'radial-gradient(circle, rgba(255,255,255,.1), transparent 70%)', borderRadius: '50%' }} />
        <div style={{ position: 'absolute', bottom: -30, left: '40%', width: 150, height: 150, background: 'radial-gradient(circle, rgba(232,131,12,.15), transparent 70%)', borderRadius: '50%' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative', zIndex: 1 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800 }}>Welcome Back!</h2>
            <p style={{ opacity: 0.8, fontSize: '.88rem', margin: '4px 0 0' }}>
              {designation || role} | {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ background: 'rgba(255,255,255,.15)', backdropFilter: 'blur(10px)', borderRadius: 12, padding: '12px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: '1.6rem', fontWeight: 800 }}>{stats.convRate}%</div>
              <div style={{ fontSize: '.7rem', opacity: 0.8 }}>Conversion Rate</div>
            </div>
            <div style={{ background: 'rgba(255,255,255,.15)', backdropFilter: 'blur(10px)', borderRadius: 12, padding: '12px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: '1.6rem', fontWeight: 800 }}>{customers.length}</div>
              <div style={{ fontSize: '.7rem', opacity: 0.8 }}>Total Customers</div>
            </div>
            <div style={{ background: 'rgba(255,255,255,.15)', backdropFilter: 'blur(10px)', borderRadius: 12, padding: '12px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: '1.6rem', fontWeight: 800 }}>{team.filter(t => t.status === 'Active').length}</div>
              <div style={{ fontSize: '.7rem', opacity: 0.8 }}>Active Team</div>
            </div>
          </div>
        </div>
      </div>

      {/* Gradient Stat Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 22 }}>
        <GradientStatCard gradient="linear-gradient(135deg, #6366f1, #8b5cf6)" icon="leaderboard" value={stats.tl} label="Total Leads" onClick={() => navigate('/leads')} />
        <GradientStatCard gradient="linear-gradient(135deg, #22c55e, #14b8a6)" icon="check_circle" value={stats.cv} label="Converted" subtext={`${stats.convRate}% conversion`} />
        <GradientStatCard gradient="linear-gradient(135deg, #3b82f6, #06b6d4)" icon="trending_up" value={stats.it} label="Interested" onClick={() => navigate('/leads')} />
        <GradientStatCard gradient="linear-gradient(135deg, #f59e0b, #f97316)" icon="engineering" value={stats.pI} label="Pending Installs" onClick={() => navigate('/installations')} />
        <GradientStatCard gradient="linear-gradient(135deg, #ef4444, #ec4899)" icon="payment" value={stats.pP} label="Pending Payments" onClick={() => navigate('/customers')} />
        {hasAccess(role, 'admin') && (
          <GradientStatCard gradient="linear-gradient(135deg, #14b8a6, #22c55e)" icon="account_balance_wallet" value={formatCurrency(stats.tI)} label="Total Revenue" onClick={() => navigate('/revenue')} />
        )}
      </div>

      {/* Row 1: Lead Status Donut + Conversion Funnel */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 18, marginBottom: 18 }}>
        {/* Lead Status Donut */}
        <div className="card" style={{ borderRadius: 16 }}>
          <div className="ch" style={{ borderBottom: '2px solid #f3f4f6' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="material-icons-round" style={{ color: '#6366f1', fontSize: 22 }}>pie_chart</span>
              Lead Status
            </h3>
          </div>
          <div className="cb" style={{ display: 'flex', alignItems: 'center', gap: 24, justifyContent: 'center' }}>
            <DonutChart segments={statusSegments} label={stats.tl} sublabel="Total" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {statusSegments.map(s => (
                <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 3, background: s.color, flexShrink: 0 }} />
                  <span style={{ fontSize: '.82rem', color: '#6b7280', minWidth: 90 }}>{s.label}</span>
                  <span style={{ fontSize: '.88rem', fontWeight: 700, color: '#1f2937' }}>{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Conversion Funnel - Visual */}
        <div className="card" style={{ borderRadius: 16 }}>
          <div className="ch" style={{ borderBottom: '2px solid #f3f4f6' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="material-icons-round" style={{ color: '#f59e0b', fontSize: 22 }}>filter_alt</span>
              Conversion Funnel
            </h3>
          </div>
          <div className="cb">
            {funnel.map((f, i) => {
              const maxCount = Math.max(...funnel.map(x => x.count), 1);
              const widthPct = Math.max((f.count / maxCount) * 100, f.count > 0 ? 8 : 3);
              return (
                <div key={f.label} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '.84rem', fontWeight: 600, color: '#374151' }}>
                      <span className="material-icons-round" style={{ fontSize: 18, color: f.color }}>{f.icon}</span>
                      {f.label}
                    </span>
                    <span style={{ fontSize: '.88rem', fontWeight: 800, color: f.color }}>{f.count}</span>
                  </div>
                  <div style={{ height: 28, background: '#f3f4f6', borderRadius: 14, overflow: 'hidden', position: 'relative' }}>
                    <div style={{
                      height: '100%', width: widthPct + '%', background: `linear-gradient(90deg, ${f.color}, ${f.color}bb)`,
                      borderRadius: 14, transition: 'width .8s ease', boxShadow: `0 2px 8px ${f.color}40`
                    }} />
                    {f.count > 0 && maxCount > 0 && (
                      <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: '.72rem', color: '#fff', fontWeight: 700 }}>
                        {Math.round((f.count / maxCount) * 100)}%
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Row 2: Revenue Chart + Monthly Leads */}
      {hasAccess(role, 'admin') ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 18, marginBottom: 18 }}>
          {/* Revenue vs Expenses */}
          <div className="card" style={{ borderRadius: 16 }}>
            <div className="ch" style={{ borderBottom: '2px solid #f3f4f6' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="material-icons-round" style={{ color: '#22c55e', fontSize: 22 }}>bar_chart</span>
                Revenue vs Expenses (6 months)
              </h3>
            </div>
            <div className="cb">
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', height: 180, padding: '0 4px' }}>
                {monthlyData.map((m, i) => (
                  <div key={m.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 150, width: '100%' }}>
                      <div style={{
                        flex: 1, background: 'linear-gradient(180deg, #22c55e, #14b8a6)',
                        borderRadius: '6px 6px 0 0', boxShadow: m.income > 0 ? '0 2px 8px rgba(34,197,94,.3)' : 'none',
                        height: maxRevenue > 0 ? Math.max((m.income / maxRevenue) * 150, m.income > 0 ? 6 : 2) : 2,
                        transition: 'height .6s ease'
                      }} title={`Revenue: ${formatCurrency(m.income)}`} />
                      <div style={{
                        flex: 1, background: 'linear-gradient(180deg, #ef4444, #ec4899)',
                        borderRadius: '6px 6px 0 0', boxShadow: m.expense > 0 ? '0 2px 8px rgba(239,68,68,.3)' : 'none',
                        height: maxRevenue > 0 ? Math.max((m.expense / maxRevenue) * 150, m.expense > 0 ? 6 : 2) : 2,
                        transition: 'height .6s ease'
                      }} title={`Expense: ${formatCurrency(m.expense)}`} />
                    </div>
                    <span style={{ fontSize: '.7rem', color: '#9ca3af', fontWeight: 600 }}>{m.label}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 20, justifyContent: 'center', marginTop: 14 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '.78rem', fontWeight: 600 }}>
                  <span style={{ width: 14, height: 14, borderRadius: 4, background: 'linear-gradient(135deg, #22c55e, #14b8a6)' }} />Revenue
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '.78rem', fontWeight: 600 }}>
                  <span style={{ width: 14, height: 14, borderRadius: 4, background: 'linear-gradient(135deg, #ef4444, #ec4899)' }} />Expenses
                </span>
              </div>
              {/* Summary */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 16 }}>
                <div style={{ background: 'rgba(34,197,94,.08)', borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
                  <div style={{ fontSize: '1rem', fontWeight: 800, color: '#22c55e' }}>{formatCurrency(stats.tI)}</div>
                  <div style={{ fontSize: '.7rem', color: '#6b7280' }}>Total Revenue</div>
                </div>
                <div style={{ background: 'rgba(239,68,68,.08)', borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
                  <div style={{ fontSize: '1rem', fontWeight: 800, color: '#ef4444' }}>{formatCurrency(stats.tE)}</div>
                  <div style={{ fontSize: '.7rem', color: '#6b7280' }}>Total Expenses</div>
                </div>
                <div style={{ background: 'rgba(99,102,241,.08)', borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
                  <div style={{ fontSize: '1rem', fontWeight: 800, color: stats.tI - stats.tE >= 0 ? '#6366f1' : '#ef4444' }}>{formatCurrency(stats.tI - stats.tE)}</div>
                  <div style={{ fontSize: '.7rem', color: '#6b7280' }}>Net Profit</div>
                </div>
              </div>
            </div>
          </div>

          {/* Payment Overview */}
          <div className="card" style={{ borderRadius: 16 }}>
            <div className="ch" style={{ borderBottom: '2px solid #f3f4f6' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="material-icons-round" style={{ color: '#6366f1', fontSize: 22 }}>account_balance</span>
                Payment Overview
              </h3>
            </div>
            <div className="cb" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
              <DonutChart segments={paymentSegments} size={120} thickness={18} label={customers.length} sublabel="Customers" />
              <div style={{ display: 'flex', gap: 12, width: '100%' }}>
                {paymentSegments.map(s => (
                  <div key={s.label} style={{ flex: 1, background: s.color + '10', borderRadius: 10, padding: '10px 12px', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.2rem', fontWeight: 800, color: s.color }}>{s.value}</div>
                    <div style={{ fontSize: '.72rem', color: '#6b7280' }}>{s.label}</div>
                  </div>
                ))}
              </div>
              <div style={{ width: '100%', background: '#f3f4f6', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: '.78rem', color: '#6b7280' }}>Collected</span>
                  <span style={{ fontSize: '.82rem', fontWeight: 700, color: '#22c55e' }}>{formatCurrency(stats.totalPaid)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '.78rem', color: '#6b7280' }}>Pending</span>
                  <span style={{ fontSize: '.82rem', fontWeight: 700, color: '#ef4444' }}>{formatCurrency(stats.totalDue)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 18, marginBottom: 18 }}>
          <div className="card" style={{ borderRadius: 16 }}>
            <div className="ch" style={{ borderBottom: '2px solid #f3f4f6' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="material-icons-round" style={{ color: '#3b82f6', fontSize: 22 }}>show_chart</span>
                Monthly Leads (6 months)
              </h3>
            </div>
            <div className="cb">
              <MiniBarChart data={monthlyData.map(m => ({ label: m.label, value: m.leads }))} height={150} barColor="linear-gradient(180deg, #3b82f6, #6366f1)" />
            </div>
          </div>
        </div>
      )}

      {/* Row 3: Priority Donut + Lead Sources + Task Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 18, marginBottom: 18 }}>
        {/* Priority */}
        <div className="card" style={{ borderRadius: 16 }}>
          <div className="ch" style={{ borderBottom: '2px solid #f3f4f6' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="material-icons-round" style={{ color: '#ef4444', fontSize: 22 }}>local_fire_department</span>
              Lead Priority
            </h3>
          </div>
          <div className="cb" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <DonutChart segments={prioritySegments} size={120} thickness={18}
              label={leads.length} sublabel="Leads" />
            <div style={{ display: 'flex', gap: 8, width: '100%' }}>
              {prioritySegments.map(s => (
                <div key={s.label} style={{ flex: 1, background: s.color + '12', borderRadius: 10, padding: '10px 8px', textAlign: 'center', border: `1px solid ${s.color}20` }}>
                  <div style={{ fontSize: '1.3rem', fontWeight: 800, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: '.7rem', color: '#6b7280', fontWeight: 600 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Lead Sources */}
        <div className="card" style={{ borderRadius: 16 }}>
          <div className="ch" style={{ borderBottom: '2px solid #f3f4f6' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="material-icons-round" style={{ color: '#8b5cf6', fontSize: 22 }}>source</span>
              Lead Sources
            </h3>
          </div>
          <div className="cb">
            {sourceData.map(([src, count], i) => {
              const pct = leads.length > 0 ? Math.round((count / leads.length) * 100) : 0;
              return (
                <div key={src} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: '.8rem', fontWeight: 600, color: '#374151' }}>{src}</span>
                    <span style={{ fontSize: '.78rem', fontWeight: 700, color: COLORS[i % COLORS.length] }}>{count} ({pct}%)</span>
                  </div>
                  <div style={{ height: 8, background: '#f3f4f6', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: pct + '%', background: `linear-gradient(90deg, ${COLORS[i % COLORS.length]}, ${COLORS[i % COLORS.length]}aa)`, borderRadius: 4, transition: 'width .6s', minWidth: count > 0 ? 8 : 0 }} />
                  </div>
                </div>
              );
            })}
            {!sourceData.length && <p style={{ color: '#9ca3af', fontSize: '.84rem', textAlign: 'center' }}>No data</p>}
          </div>
        </div>

        {/* Task Summary */}
        <div className="card" style={{ borderRadius: 16 }}>
          <div className="ch" style={{ borderBottom: '2px solid #f3f4f6' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="material-icons-round" style={{ color: '#f59e0b', fontSize: 22 }}>assignment</span>
              Tasks Overview
            </h3>
            <button className="btn bsm bo" onClick={() => navigate('/tasks')} style={{ borderRadius: 8 }}>View</button>
          </div>
          <div className="cb" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <DonutChart segments={taskSegments} size={120} thickness={18}
              label={employeeTasks.length} sublabel="Total" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, width: '100%' }}>
              {taskSegments.map(s => (
                <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: s.color + '10', borderRadius: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color }} />
                  <span style={{ fontSize: '.76rem', color: '#6b7280' }}>{s.label}</span>
                  <span style={{ fontSize: '.82rem', fontWeight: 700, color: s.color, marginLeft: 'auto' }}>{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Row 4: City Distribution + Top Performers */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 18 }}>
        {/* City-wise */}
        <div className="card" style={{ borderRadius: 16 }}>
          <div className="ch" style={{ borderBottom: '2px solid #f3f4f6' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="material-icons-round" style={{ color: '#14b8a6', fontSize: 22 }}>location_city</span>
              City-wise Lead Distribution
            </h3>
          </div>
          <div className="cb">
            {cityData.length > 0 ? (
              <MiniBarChart data={cityData.map(([city, count]) => ({ label: city.slice(0, 6), value: count }))} height={140} />
            ) : (
              <p style={{ color: '#9ca3af', fontSize: '.84rem', textAlign: 'center' }}>No city data</p>
            )}
          </div>
        </div>

        {/* Top Performers */}
        <div className="card" style={{ borderRadius: 16 }}>
          <div className="ch" style={{ borderBottom: '2px solid #f3f4f6' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="material-icons-round" style={{ color: '#f59e0b', fontSize: 22 }}>emoji_events</span>
              Top Performers
            </h3>
          </div>
          <div className="cb" style={{ padding: 0 }}>
            <div className="tw"><table><thead><tr>
              <th>#</th><th>Name</th><th>Leads</th><th>Converted</th><th>Rate</th>
            </tr></thead><tbody>
              {topPerformers.map((p, i) => {
                const rate = p.total > 0 ? Math.round((p.converted / p.total) * 100) : 0;
                return (
                  <tr key={p.name}>
                    <td>
                      {i === 0 ? <span style={{ fontSize: '1.1rem' }}>{'\u{1F947}'}</span> :
                       i === 1 ? <span style={{ fontSize: '1.1rem' }}>{'\u{1F948}'}</span> :
                       i === 2 ? <span style={{ fontSize: '1.1rem' }}>{'\u{1F949}'}</span> :
                       <span style={{ color: '#9ca3af', fontWeight: 600 }}>{i + 1}</span>}
                    </td>
                    <td style={{ fontWeight: 600 }}>{p.name}</td>
                    <td><span style={{ background: '#6366f120', color: '#6366f1', padding: '2px 8px', borderRadius: 6, fontWeight: 700, fontSize: '.82rem' }}>{p.total}</span></td>
                    <td><span style={{ background: '#22c55e20', color: '#22c55e', padding: '2px 8px', borderRadius: 6, fontWeight: 700, fontSize: '.82rem' }}>{p.converted}</span></td>
                    <td><span style={{ fontWeight: 700, color: rate >= 30 ? '#22c55e' : rate >= 15 ? '#f59e0b' : '#ef4444' }}>{rate}%</span></td>
                  </tr>
                );
              })}
              {!topPerformers.length && <tr><td colSpan="5" style={{ textAlign: 'center', padding: 20, color: '#9ca3af' }}>No data yet</td></tr>}
            </tbody></table></div>
          </div>
        </div>
      </div>

      {/* Row 5: Overdue Follow-ups + Recent Leads */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 18 }}>
        {/* Overdue */}
        <div className="card" style={{ borderRadius: 16, borderLeft: overdueFollowUps.length > 0 ? '4px solid #ef4444' : undefined }}>
          <div className="ch" style={{ borderBottom: '2px solid #f3f4f6' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="material-icons-round" style={{ color: '#ef4444', fontSize: 22 }}>schedule</span>
              Overdue Follow-ups
              {overdueFollowUps.length > 0 && <span style={{ background: '#ef4444', color: '#fff', fontSize: '.7rem', padding: '2px 8px', borderRadius: 12, fontWeight: 700 }}>{overdueFollowUps.length}</span>}
            </h3>
            <button className="btn bsm bo" onClick={() => navigate('/leads')} style={{ borderRadius: 8 }}>View All</button>
          </div>
          <div className="cb" style={{ padding: 0 }}>
            <div className="tw"><table><thead><tr><th>Name</th><th>Phone</th><th>Due Date</th><th>Status</th></tr></thead><tbody>
              {overdueFollowUps.map(l => (
                <tr key={l.id}>
                  <td style={{ fontWeight: 600 }}>{l.name}</td>
                  <td style={{ fontSize: '.82rem' }}>{l.phone}</td>
                  <td style={{ fontSize: '.82rem', color: '#ef4444', fontWeight: 700 }}>{l.nextFollowUpDate}</td>
                  <td><StatusBadge status={l.followUpStatus || l.status} /></td>
                </tr>
              ))}
              {!overdueFollowUps.length && <tr><td colSpan="4" style={{ textAlign: 'center', padding: 20, color: '#9ca3af' }}>All clear!</td></tr>}
            </tbody></table></div>
          </div>
        </div>

        {/* Recent Leads */}
        <div className="card" style={{ borderRadius: 16 }}>
          <div className="ch" style={{ borderBottom: '2px solid #f3f4f6' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="material-icons-round" style={{ color: '#3b82f6', fontSize: 22 }}>person_add</span>
              Recent Leads
            </h3>
            <button className="btn bsm bo" onClick={() => navigate('/leads')} style={{ borderRadius: 8 }}>View All</button>
          </div>
          <div className="cb" style={{ padding: 0 }}>
            <div className="tw"><table><thead><tr><th>Name</th><th>Status</th><th>Priority</th><th>Date</th></tr></thead><tbody>
              {leads.slice(0, 5).map(l => (
                <tr key={l.id}><td><strong>{l.name}</strong><br /><span style={{ fontSize: '.78rem', color: '#9ca3af' }}>{l.phone}</span></td><td><StatusBadge status={l.status} /></td><td><StatusBadge status={l.priority} /></td><td style={{ fontSize: '.82rem' }}>{formatDate(l.dateGenerated)}</td></tr>
              ))}
              {!leads.length && <tr><td colSpan="4" style={{ textAlign: 'center', padding: 20, color: '#9ca3af' }}>No leads yet</td></tr>}
            </tbody></table></div>
          </div>
        </div>
      </div>

      {/* Row 6: Installation Progress + Stock Alerts + Reminders */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 18, marginBottom: 18 }}>
        <div className="card" style={{ borderRadius: 16 }}>
          <div className="ch" style={{ borderBottom: '2px solid #f3f4f6' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="material-icons-round" style={{ color: '#f97316', fontSize: 22 }}>construction</span>
              Installations
            </h3>
            <button className="btn bsm bo" onClick={() => navigate('/installations')} style={{ borderRadius: 8 }}>All</button>
          </div>
          <div className="cb">
            {installations.filter(i => i.progress < 100).slice(0, 4).map(i => (
              <div key={i.id} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span style={{ fontWeight: 600, fontSize: '.85rem' }}>{i.customerName}</span>
                  <span style={{ fontWeight: 800, fontSize: '.82rem', color: i.progress >= 80 ? '#22c55e' : i.progress >= 40 ? '#f59e0b' : '#3b82f6' }}>{i.progress}%</span>
                </div>
                <ProgressBar value={i.progress} />
              </div>
            ))}
            {!installations.filter(i => i.progress < 100).length && <p style={{ color: '#9ca3af', fontSize: '.84rem', textAlign: 'center' }}>No active installs</p>}
          </div>
        </div>

        <div className="card" style={{ borderRadius: 16 }}>
          <div className="ch" style={{ borderBottom: '2px solid #f3f4f6' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="material-icons-round" style={{ color: '#ef4444', fontSize: 22 }}>inventory_2</span>
              Stock Alerts
            </h3>
            <button className="btn bsm bo" onClick={() => navigate('/materials')} style={{ borderRadius: 8 }}>All</button>
          </div>
          <div className="cb">
            {materials.filter(m => m.balance < 30).slice(0, 5).map(m => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
                <span style={{ fontSize: '.84rem', fontWeight: 500 }}>{m.name}</span>
                <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: '.78rem', fontWeight: 700, background: m.balance < 10 ? '#fef2f2' : '#fff7ed', color: m.balance < 10 ? '#ef4444' : '#f59e0b' }}>
                  {m.balance} {m.unit}
                </span>
              </div>
            ))}
            {!materials.filter(m => m.balance < 30).length && <p style={{ color: '#9ca3af', fontSize: '.84rem', textAlign: 'center' }}>Stock OK</p>}
          </div>
        </div>

        <div className="card" style={{ borderRadius: 16 }}>
          <div className="ch" style={{ borderBottom: '2px solid #f3f4f6' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="material-icons-round" style={{ color: '#8b5cf6', fontSize: 22 }}>notifications_active</span>
              Reminders
            </h3>
            <button className="btn bsm bo" onClick={() => navigate('/reminders')} style={{ borderRadius: 8 }}>All</button>
          </div>
          <div className="cb" style={{ padding: 0 }}>
            <div className="tw"><table><thead><tr><th>Type</th><th>Customer</th><th>Date</th></tr></thead><tbody>
              {reminders.filter(r => r.status === 'Pending').slice(0, 5).map(r => (
                <tr key={r.id}><td style={{ fontWeight: 600, fontSize: '.82rem' }}>{r.type}</td><td style={{ fontSize: '.82rem' }}>{r.customer}</td><td style={{ fontSize: '.78rem', color: '#6b7280' }}>{formatDate(r.date)}</td></tr>
              ))}
              {!reminders.filter(r => r.status === 'Pending').length && <tr><td colSpan="3" style={{ textAlign: 'center', padding: 20, color: '#9ca3af' }}>No pending</td></tr>}
            </tbody></table></div>
          </div>
        </div>
      </div>

      {/* Row 7: Team Overview (Admin) */}
      {hasAccess(role, 'admin') && team.length > 0 && (
        <div className="card" style={{ borderRadius: 16, marginBottom: 18 }}>
          <div className="ch" style={{ borderBottom: '2px solid #f3f4f6' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="material-icons-round" style={{ color: '#06b6d4', fontSize: 22 }}>groups</span>
              Team Overview
            </h3>
            <button className="btn bsm bo" onClick={() => navigate('/team')} style={{ borderRadius: 8 }}>Manage</button>
          </div>
          <div className="cb" style={{ padding: 0 }}>
            <div className="tw"><table><thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Attendance</th><th>Phone</th></tr></thead><tbody>
              {team.slice(0, 8).map(t => (
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
      )}

      {/* Quick Actions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 18 }}>
        {[
          { label: 'Add Lead', icon: 'person_add', color: '#6366f1', path: '/leads' },
          { label: 'Customers', icon: 'people', color: '#22c55e', path: '/customers' },
          { label: 'Tasks', icon: 'assignment', color: '#f59e0b', path: '/tasks' },
          { label: 'Purchase Orders', icon: 'receipt_long', color: '#3b82f6', path: '/purchase-orders' },
          { label: 'Retailers', icon: 'storefront', color: '#ec4899', path: '/retailers' },
          { label: 'Influencers', icon: 'campaign', color: '#8b5cf6', path: '/influencers' }
        ].map(a => (
          <div key={a.label} onClick={() => navigate(a.path)} style={{
            background: '#fff', borderRadius: 12, padding: '16px 14px', textAlign: 'center',
            cursor: 'pointer', border: '1px solid #e5e7eb', transition: 'all .3s',
            boxShadow: '0 1px 3px rgba(0,0,0,.05)'
          }} onMouseEnter={e => { e.currentTarget.style.borderColor = a.color; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 4px 15px ${a.color}25`; }}
             onMouseLeave={e => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,.05)'; }}>
            <span className="material-icons-round" style={{ fontSize: 28, color: a.color, display: 'block', marginBottom: 6 }}>{a.icon}</span>
            <span style={{ fontSize: '.78rem', fontWeight: 600, color: '#374151' }}>{a.label}</span>
          </div>
        ))}
      </div>
    </>
  );
}
