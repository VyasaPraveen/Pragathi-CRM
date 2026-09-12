import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { getInitials, hasAccess } from '../services/helpers';
import { hasModule } from '../services/permissions';

// `perm` = the per-user permission key an Admin can switch off for an individual
// user (Settings → Permission Management). `minRole` is the role floor.
const sections = [
  { title: 'Main', items: [
    { to: '/', icon: 'dashboard', label: 'Dashboard', perm: 'dashboard' },
    { to: '/leads', icon: 'leaderboard', label: 'Leads', badgeKey: 'leads', perm: 'leads' },
    { to: '/customers', icon: 'people', label: 'Customers', perm: 'customers' },
    { to: '/tasks', icon: 'task_alt', label: 'Tasks', perm: 'tasks' },
    { to: '/my-reports', icon: 'insights', label: 'My Reports & Planning', perm: 'my_reports' },
  ]},
  { title: 'Operations', items: [
    { to: '/installations', icon: 'solar_power', label: 'Installations', perm: 'installations' },
    { to: '/ongoing', icon: 'construction', label: 'Ongoing Work', perm: 'ongoing_work' },
    { to: '/materials', icon: 'inventory_2', label: 'Materials', perm: 'materials' },
    { to: '/purchase-orders', icon: 'receipt_long', label: 'Purchase Orders', perm: 'purchase_orders' },
  ]},
  { title: 'Finance', items: [
    { to: '/revenue', icon: 'account_balance_wallet', label: 'Revenue', perm: 'revenue' },
    { to: '/expenditure', icon: 'payments', label: 'Expenditure', perm: 'expenditure' },
    { to: '/payment-requests', icon: 'request_quote', label: 'Payment Requests', perm: 'payment_requests' },
    { to: '/reports', icon: 'assessment', label: 'Reports', minRole: 'coordinator', perm: 'reports' },
  ]},
  { title: 'People', items: [
    { to: '/team', icon: 'groups', label: 'Team', perm: 'team' },
    { to: '/attendance', icon: 'how_to_reg', label: 'Attendance', perm: 'attendance' },
    { to: '/tracking', icon: 'schedule', label: 'Tracking', perm: 'tracking' },
    { to: '/leave', icon: 'event_available', label: 'Leave', perm: 'leave' },
    { to: '/reminders', icon: 'notifications_active', label: 'Reminders', badgeKey: 'reminders', perm: 'reminders' },
    { to: '/retailers', icon: 'storefront', label: 'Retailers', perm: 'retailers' },
    { to: '/influencers', icon: 'campaign', label: 'Influencers', perm: 'influencers' },
  ]},
  { title: 'Company', items: [
    { to: '/about', icon: 'info', label: 'About', perm: 'about' },
    { to: '/gallery', icon: 'photo_library', label: 'Gallery', perm: 'gallery' },
    { to: '/user-management', icon: 'admin_panel_settings', label: 'User Management', minRole: 'admin' },
    { to: '/activity-log', icon: 'history', label: 'Activity Log', minRole: 'admin' },
    { to: '/settings', icon: 'settings', label: 'Settings', minRole: 'coordinator' },
  ]},
];

export default function Sidebar({ open, onClose }) {
  const { user, role, designation, logout } = useAuth();
  const { leads, reminders } = useData();
  // Q3 fix: use React state instead of outerHTML for logo fallback
  const [logoError, setLogoError] = useState(false);

  const getBadge = (key) => {
    if (key === 'leads') return leads.filter(l => l.status === 'Interested').length;
    if (key === 'reminders') return reminders.filter(r => r.status === 'Pending').length;
    return 0;
  };

  // A nav item shows only when the role floor AND the user's own permission allow it.
  const visible = (item) => {
    if (item.minRole && !hasAccess(role, item.minRole)) return false;
    if (item.perm && !hasModule(user, role, item.perm)) return false;
    return true;
  };

  return (
    <>
      <aside className={`sb ${open ? 'open' : ''}`}>
        <div className="sb-h">
          {logoError ? (
            <div style={{ width: 36, height: 36, background: 'var(--sec)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '.8rem', color: '#fff', flexShrink: 0 }}>PPS</div>
          ) : (
            <img src="/logo.png" alt="PPS" onError={() => setLogoError(true)} style={{ height: 36, width: 'auto', objectFit: 'contain' }} />
          )}
          <div className="sb-brand">Pragathi Power<br /><small>Solar CRM</small></div>
        </div>
        <nav className="sb-nav">
          {sections.map(sec => {
            const items = sec.items.filter(visible);
            if (!items.length) return null; // hide an empty section heading
            return (
            <div key={sec.title}>
              <div className="ns-t">{sec.title}</div>
              {items.map(item => {
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
            );
          })}
        </nav>
        <div className="sb-f">
          <div className="ui">
            <div className="ua">{getInitials(user?.displayName || user?.email || 'U')}</div>
            <div className="ud">
              <div className="un">{user?.displayName || user?.email || 'User'}</div>
              <div className="ur">{designation || role}</div>
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
