import React, { useState } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { apiPost } from '../services/api';
import { hasAccess, formatDateTime } from '../services/helpers';
import { normalizeRole } from '../services/permissions';

// Req 2 (30-Oct): who may delete entries — mirrors activity_log_deleter() on the server.
export const ACTIVITY_DELETE_ROLES = ['super_admin', 'operation_manager', 'management', 'admin'];
export const canDeleteActivity = (role) => ACTIVITY_DELETE_ROLES.includes(normalizeRole(role));

const moduleColors = {
  leads: '#6366f1', customers: '#22c55e', installations: '#f59e0b', team: '#3b82f6',
  purchaseOrders: '#f97316', leadPOs: '#f97316', income: '#22c55e', expenses: '#ef4444',
  reminders: '#8b5cf6', materials: '#06b6d4', ongoingWork: '#f59e0b', employeeTasks: '#ec4899',
  retailers: '#14b8a6', influencers: '#a855f7', users: '#64748b', gallery: '#06b6d4'
};

const actionIcons = { Created: 'add_circle', Updated: 'edit', Deleted: 'delete', Approved: 'check_circle', Rejected: 'cancel' };

export default function ActivityLog() {
  const { role } = useAuth();
  const { activityLog } = useData();
  const { toast } = useToast();
  const [filterModule, setFilterModule] = useState('all');
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const canDelete = canDeleteActivity(role);
  const toggle = (id) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  // Only the selected entries go; everything else stays exactly as it is.
  const purge = async (payload, label) => {
    setBusy(true);
    try {
      const res = await apiPost('/collections/activityLog/purge', payload);
      setSelected(new Set());
      window.dispatchEvent(new Event('pps:refresh'));
      toast(`${res.deleted || 0} ${label} deleted`);
    } catch (e) { toast(e.message, 'er'); }
    finally { setBusy(false); }
  };
  const deleteSelected = () => {
    const ids = [...selected];
    if (!ids.length) return;
    if (!window.confirm(`Delete the ${ids.length} selected activity log entr${ids.length === 1 ? 'y' : 'ies'}? The rest of the log stays as it is.`)) return;
    purge({ ids }, ids.length === 1 ? 'entry' : 'entries');
  };
  const deleteAll = () => {
    if (!activityLog.length) return;
    if (!window.confirm(`Delete ALL ${activityLog.length} activity log entries? This clears the whole log and cannot be undone. No other CRM records are touched.`)) return;
    purge({ all: true }, 'entries');
  };
  const [filterUser, setFilterUser] = useState('all');
  const [search, setSearch] = useState('');

  // Admins as before, plus the Operation Manager, who may now delete entries (Req 2, 30-Oct).
  if (!hasAccess(role, 'admin') && !canDeleteActivity(role)) {
    return (
      <div className="card">
        <div className="cb" style={{ textAlign: 'center', padding: 40 }}>
          <span className="material-icons-round" style={{ fontSize: 48, color: 'var(--err)', marginBottom: 12, display: 'block' }}>lock</span>
          <h3>Access Denied</h3>
          <p style={{ color: 'var(--muted)' }}>Only admins and the Operation Manager can view the activity log.</p>
        </div>
      </div>
    );
  }

  const modules = [...new Set(activityLog.map(a => a.module))].sort();
  const users = [...new Set(activityLog.map(a => a.user))].sort();

  const filtered = activityLog.filter(a => {
    if (filterModule !== 'all' && a.module !== filterModule) return false;
    if (filterUser !== 'all' && a.user !== filterUser) return false;
    if (search) {
      const s = search.toLowerCase();
      return (a.action || '').toLowerCase().includes(s) || (a.module || '').toLowerCase().includes(s) || (a.details || '').toLowerCase().includes(s) || (a.user || '').toLowerCase().includes(s);
    }
    return true;
  });

  const formatTime = (ts) => {
    if (!ts) return '-';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    if (isNaN(d)) return '-';
    const now = new Date();
    const diff = Math.floor((now - d) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 172800) return 'Yesterday';
    // Older than that, the exact date and time shown beside it is enough.
    return '';
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <h3 style={{ margin: 0 }}>Activity Log</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '.82rem', color: 'var(--muted)' }}>{filtered.length} activities</span>
          {canDelete && (
            <>
              <button className="btn bsm bo" disabled={busy || !filtered.length} title="Select every entry shown"
                onClick={() => setSelected(prev => (prev.size === Math.min(filtered.length, 100) ? new Set() : new Set(filtered.slice(0, 100).map(a => a.id).filter(Boolean))))}>
                <span className="material-icons-round" style={{ fontSize: 16 }}>checklist</span> {selected.size && selected.size === Math.min(filtered.length, 100) ? 'Clear selection' : 'Select shown'}
              </button>
              <button className="btn bsm bo" disabled={busy || !selected.size} onClick={deleteSelected} style={{ color: 'var(--err)', borderColor: 'rgba(231,76,60,.3)' }}>
                <span className="material-icons-round" style={{ fontSize: 16 }}>delete</span> Delete selected{selected.size ? ` (${selected.size})` : ''}
              </button>
              <button className="btn bsm bo" disabled={busy || !activityLog.length} onClick={deleteAll} style={{ color: 'var(--err)', borderColor: 'rgba(231,76,60,.3)' }}>
                <span className="material-icons-round" style={{ fontSize: 16 }}>delete_sweep</span> Delete all
              </button>
            </>
          )}
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 280 }}>
          <span className="material-icons-round" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 16, color: 'var(--muted)' }}>search</span>
          <input className="fi" placeholder="Search activities..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 32, fontSize: '.82rem' }} />
        </div>
        <select className="fi" value={filterModule} onChange={e => setFilterModule(e.target.value)} style={{ maxWidth: 160, fontSize: '.82rem' }}>
          <option value="all">All Modules</option>
          {modules.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select className="fi" value={filterUser} onChange={e => setFilterUser(e.target.value)} style={{ maxWidth: 180, fontSize: '.82rem' }}>
          <option value="all">All Users</option>
          {users.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>

      {/* Timeline */}
      <div className="card">
        <div className="cb" style={{ padding: '12px 16px' }}>
          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>
              <span className="material-icons-round" style={{ fontSize: 48, display: 'block', marginBottom: 8 }}>history</span>
              <p>No activities found</p>
            </div>
          ) : (
            filtered.slice(0, 100).map((a, i) => (
              <div key={a.id || i} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: i < filtered.length - 1 ? '1px solid var(--bor)' : 'none', background: selected.has(a.id) ? 'rgba(231,76,60,.05)' : undefined }}>
                {canDelete && a.id && <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} aria-label="Select this entry" style={{ marginTop: 9, width: 16, height: 16, flexShrink: 0 }} />}
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: (moduleColors[a.module] || '#64748b') + '18', color: moduleColors[a.module] || '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
                  <span className="material-icons-round" style={{ fontSize: 16 }}>{actionIcons[a.action] || 'history'}</span>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: '.86rem' }}>{a.user}</span>
                      <span style={{ color: 'var(--muted)', fontSize: '.84rem' }}> {(a.action || '').toLowerCase()} </span>
                      <span style={{ background: (moduleColors[a.module] || '#64748b') + '14', color: moduleColors[a.module] || '#64748b', padding: '1px 8px', borderRadius: 10, fontSize: '.74rem', fontWeight: 600 }}>{a.module}</span>
                    </div>
                    {/* How long ago, and the exact date and IST time beside it. */}
                    <span style={{ fontSize: '.74rem', color: 'var(--muted)', whiteSpace: 'nowrap' }} title={formatDateTime(a.timestamp)}>
                      {formatTime(a.timestamp)}{formatTime(a.timestamp) && a.timestamp ? ' · ' : ''}{a.timestamp ? formatDateTime(a.timestamp) : ''}
                    </span>
                  </div>
                  {a.details && <p style={{ margin: '2px 0 0', fontSize: '.82rem', color: 'var(--muted)' }}>{a.details}</p>}
                </div>
              </div>
            ))
          )}
          {filtered.length > 100 && <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '.82rem', marginTop: 10 }}>Showing first 100 of {filtered.length} activities</p>}
        </div>
      </div>
    </>
  );
}
