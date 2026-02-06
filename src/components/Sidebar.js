import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { getInitials } from '../services/helpers';

const sections = [
  { title: 'Main', items: [
    { to: '/', icon: 'dashboard', label: 'Dashboard' },
    { to: '/leads', icon: 'leaderboard', label: 'Leads', badgeKey: 'leads' },
    { to: '/customers', icon: 'people', label: 'Customers' },
  ]},
  { title: 'Operations', items: [
    { to: '/installations', icon: 'solar_power', label: 'Installations' },
    { to: '/ongoing', icon: 'construction', label: 'Ongoing Work' },
    { to: '/materials', icon: 'inventory_2', label: 'Materials' },
  ]},
  { title: 'Finance', items: [
    { to: '/revenue', icon: 'account_balance_wallet', label: 'Revenue' },
    { to: '/reports', icon: 'assessment', label: 'Reports', hideFor: 'assistant' },
  ]},
  { title: 'People', items: [
    { to: '/team', icon: 'groups', label: 'Team' },
    { to: '/reminders', icon: 'notifications_active', label: 'Reminders', badgeKey: 'reminders' },
  ]},
  { title: 'Company', items: [
    { to: '/about', icon: 'info', label: 'About' },
    { to: '/gallery', icon: 'photo_library', label: 'Gallery' },
    { to: '/settings', icon: 'settings', label: 'Settings', hideFor: 'assistant' },
  ]},
];

export default function Sidebar({ open, onClose }) {
  const { user, role, logout } = useAuth();
  const { leads, reminders } = useData();
  // Q3 fix: use React state instead of outerHTML for logo fallback
  const [logoError, setLogoError] = useState(false);

  const getBadge = (key) => {
    if (key === 'leads') return leads.filter(l => l.status === 'Interested').length;
    if (key === 'reminders') return reminders.filter(r => r.status === 'Pending').length;
    return 0;
  };

  return (
    <>
      <aside className={`sb ${open ? 'open' : ''}`}>
        <div className="sb-h">
          {logoError ? (
            <div style={{ width: 36, height: 36, background: 'var(--sec)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '.8rem', color: '#fff', flexShrink: 0 }}>PPS</div>
          ) : (
            <img src="/logo.jpg" alt="PPS" onError={() => setLogoError(true)} />
          )}
          <div className="sb-brand">Pragathi Power<br /><small>Solar CRM</small></div>
        </div>
        <nav className="sb-nav">
          {sections.map(sec => (
            <div key={sec.title}>
              <div className="ns-t">{sec.title}</div>
              {sec.items.map(item => {
                if (item.hideFor === role) return null;
                const badge = item.badgeKey ? getBadge(item.badgeKey) : 0;
                return (
                  <NavLink key={item.to} to={item.to} end={item.to === '/'} className={({ isActive }) => `ni ${isActive ? 'act' : ''}`} onClick={onClose}>
                    <span className="material-icons-round">{item.icon}</span>
                    {item.label}
                    {badge > 0 && <span className="badge">{badge}</span>}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sb-f">
          <div className="ui">
            <div className="ua">{getInitials(user?.displayName || user?.email || 'U')}</div>
            <div className="ud">
              <div className="un">{user?.displayName || user?.email || 'User'}</div>
              <div className="ur">{role}</div>
            </div>
            <button className="tbtn" onClick={logout} title="Logout" style={{ color: 'rgba(255,255,255,.6)' }}>
              <span className="material-icons-round" style={{ fontSize: 20 }}>logout</span>
            </button>
          </div>
        </div>
      </aside>
      {/* B5 fix: always render overlay, control visibility via CSS class */}
      <div className={`sbo ${open ? 'active' : ''}`} onClick={onClose}></div>
    </>
  );
}
