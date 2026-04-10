import React, { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { hasAccess } from '../services/helpers';
import { updateDocument } from '../services/firestore';

const titles = {
  '/': 'Dashboard', '/leads': 'Lead Management', '/customers': 'Customers',
  '/installations': 'Installations', '/ongoing': 'Ongoing Work', '/materials': 'Materials & Inventory',
  '/revenue': 'Revenue', '/reports': 'Reports', '/team': 'Team Management',
  '/reminders': 'Reminders', '/about': 'About PPS', '/gallery': 'Gallery', '/settings': 'Settings',
  '/purchase-orders': 'Purchase Orders', '/retailers': 'Retailers', '/influencers': 'Influencers',
  '/tasks': 'Employee Tasks', '/user-management': 'User Management', '/activity-log': 'Activity Log'
};

const typeIcons = {
  lead: 'person_add', customer: 'people', task: 'assignment',
  status_update: 'sync', info: 'info'
};
const typeColors = {
  lead: '#3b82f6', customer: '#10b981', task: '#f59e0b',
  status_update: '#8b5cf6', info: '#6b7280'
};

function timeAgo(d) {
  if (!d) return '';
  const dt = d.toDate ? d.toDate() : new Date(d);
  const diff = Math.floor((Date.now() - dt.getTime()) / 1000);
  if (diff < 60) return 'Just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

export default function Topbar({ onMenuClick }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { role, user } = useAuth();
  const { reminders, notifications } = useData();
  const [showPanel, setShowPanel] = useState(false);
  const panelRef = useRef(null);

  // Get current user's display name for matching notifications
  const myName = user?.displayName || '';

  // Filter notifications for current user (match by displayName)
  const myNotifications = notifications
    .filter(n => n.forUser === myName)
    .sort((a, b) => {
      const at = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
      const bt = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
      return bt - at;
    });

  const unreadCount = myNotifications.filter(n => !n.read).length;
  const pendingReminders = reminders.filter(r => r.status === 'Pending').length;
  const totalBadge = unreadCount + pendingReminders;

  // Close panel on outside click
  useEffect(() => {
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setShowPanel(false);
    };
    if (showPanel) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPanel]);

  const markAsRead = async (id) => {
    try { await updateDocument('notifications', id, { read: true }); } catch (e) { console.warn('Failed to mark notification read:', e.message); }
  };

  const markAllRead = async () => {
    await Promise.all(myNotifications.filter(n => !n.read).map(n =>
      updateDocument('notifications', n.id, { read: true }).catch(e => console.warn('Failed to mark notification read:', e.message))
    ));
  };

  return (
    <header className="tb">
      <div className="tb-l">
        <span className="material-icons-round mt" onClick={onMenuClick}>menu</span>
        <h1 className="pt">{titles[pathname] || 'Dashboard'}</h1>
      </div>
      <div className="tb-r">
        <div style={{ position: 'relative' }} ref={panelRef}>
          <button className="tbtn" onClick={() => setShowPanel(!showPanel)} title="Notifications">
            <span className="material-icons-round">notifications</span>
            {totalBadge > 0 && <span className="dot" style={{ position: 'absolute', top: 4, right: 4, background: '#e74c3c', color: '#fff', borderRadius: '50%', width: totalBadge > 9 ? 20 : 16, height: 16, fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{totalBadge > 99 ? '99+' : totalBadge}</span>}
          </button>

          {showPanel && (
            <div style={{
              position: 'absolute', top: '100%', right: 0, width: 380, maxHeight: 480,
              background: '#fff', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,.15)',
              zIndex: 1000, overflow: 'hidden', border: '1px solid rgba(0,0,0,.08)'
            }}>
              {/* Header */}
              <div style={{ padding: '14px 16px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: '.95rem' }}>Notifications</span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {unreadCount > 0 && (
                    <button onClick={markAllRead} style={{ background: 'none', border: 'none', color: '#3b82f6', fontSize: '.78rem', cursor: 'pointer', fontWeight: 600 }}>
                      Mark all read
                    </button>
                  )}
                  <button onClick={() => { setShowPanel(false); navigate('/reminders'); }} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: '.78rem', cursor: 'pointer' }}>
                    Reminders ({pendingReminders})
                  </button>
                </div>
              </div>

              {/* Notification list */}
              <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                {myNotifications.length === 0 ? (
                  <div style={{ padding: 32, textAlign: 'center', color: '#9ca3af' }}>
                    <span className="material-icons-round" style={{ fontSize: 40, opacity: 0.4 }}>notifications_none</span>
                    <p style={{ margin: '8px 0 0', fontSize: '.85rem' }}>No notifications yet</p>
                  </div>
                ) : (
                  myNotifications.slice(0, 50).map(n => (
                    <div key={n.id} onClick={() => { if (!n.read) markAsRead(n.id); }}
                      style={{
                        padding: '12px 16px', borderBottom: '1px solid #f3f4f6', cursor: 'pointer',
                        background: n.read ? '#fff' : 'rgba(59,130,246,.04)',
                        transition: 'background .2s'
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'}
                      onMouseLeave={e => e.currentTarget.style.background = n.read ? '#fff' : 'rgba(59,130,246,.04)'}
                    >
                      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <span className="material-icons-round" style={{
                          fontSize: 20, color: typeColors[n.type] || '#6b7280',
                          background: (typeColors[n.type] || '#6b7280') + '15',
                          borderRadius: 8, padding: 6, flexShrink: 0
                        }}>
                          {typeIcons[n.type] || 'info'}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                            <strong style={{ fontSize: '.82rem', color: n.read ? '#6b7280' : '#1f2937' }}>{n.title}</strong>
                            {!n.read && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#3b82f6', flexShrink: 0 }}></span>}
                          </div>
                          <p style={{ margin: '2px 0 0', fontSize: '.78rem', color: '#6b7280', lineHeight: 1.4 }}>{n.message}</p>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                            <span style={{ fontSize: '.72rem', color: '#9ca3af' }}>{n.fromUser}</span>
                            <span style={{ fontSize: '.72rem', color: '#9ca3af' }}>{timeAgo(n.createdAt)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {hasAccess(role, 'coordinator') && (
          <button className="tbtn" onClick={() => navigate('/settings')} title="Settings">
            <span className="material-icons-round">settings</span>
          </button>
        )}
      </div>
    </header>
  );
}
