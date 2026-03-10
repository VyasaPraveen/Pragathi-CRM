import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { hasAccess } from '../services/helpers';
import { db } from '../services/firebase';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';

// Module permissions that admin can toggle per user
const PERMISSION_MODULES = [
  { key: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { key: 'leads', label: 'Leads', icon: 'leaderboard' },
  { key: 'customers', label: 'Customers', icon: 'people' },
  { key: 'installations', label: 'Installations', icon: 'solar_power' },
  { key: 'ongoing_work', label: 'Ongoing Work', icon: 'engineering' },
  { key: 'materials', label: 'Materials', icon: 'inventory_2' },
  { key: 'revenue', label: 'Revenue', icon: 'account_balance' },
  { key: 'purchase_orders', label: 'Purchase Orders', icon: 'receipt_long' },
  { key: 'retailers', label: 'Retailers', icon: 'storefront' },
  { key: 'influencers', label: 'Influencers', icon: 'record_voice_over' },
  { key: 'tasks', label: 'Tasks', icon: 'task_alt' },
  { key: 'team', label: 'Team', icon: 'groups' },
  { key: 'reminders', label: 'Reminders', icon: 'notifications_active' },
  { key: 'reports', label: 'Reports', icon: 'assessment' },
  { key: 'gallery', label: 'Gallery', icon: 'photo_library' },
];

export default function Settings() {
  const { user, role } = useAuth();
  const { toast } = useToast();
  const isAdmin = hasAccess(role, 'admin');

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [perms, setPerms] = useState({});
  const [saving, setSaving] = useState(false);

  // Load all users for permission management (admin only)
  useEffect(() => {
    if (!isAdmin) return;
    setLoading(true);
    getDocs(collection(db, 'users')).then(snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(u => u.approved).sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
      setUsers(list);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [isAdmin]);

  // When a user is selected, load their permissions
  const selectUser = (u) => {
    setSelectedUser(u);
    // Default: all permissions ON if no permissions object exists
    const existing = u.permissions || {};
    const p = {};
    PERMISSION_MODULES.forEach(m => {
      p[m.key] = existing[m.key] !== undefined ? existing[m.key] : true;
    });
    setPerms(p);
  };

  const togglePerm = (key) => {
    setPerms(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleAll = (val) => {
    const p = {};
    PERMISSION_MODULES.forEach(m => { p[m.key] = val; });
    setPerms(p);
  };

  const savePermissions = async () => {
    if (!selectedUser) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', selectedUser.id), { permissions: perms });
      setUsers(prev => prev.map(u => u.id === selectedUser.id ? { ...u, permissions: perms } : u));
      setSelectedUser(prev => ({ ...prev, permissions: perms }));
      toast('Permissions saved');
    } catch (err) {
      toast('Failed to save: ' + err.message, 'er');
    }
    setSaving(false);
  };

  // Bulk apply: apply selected user's permissions to multiple users
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState([]);

  const toggleBulkUser = (uid) => {
    setBulkSelected(prev => prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid]);
  };

  const applyBulkPermissions = async () => {
    if (bulkSelected.length === 0) { toast('Select at least one user', 'er'); return; }
    if (!window.confirm(`Apply current permissions to ${bulkSelected.length} user(s)?`)) return;
    setSaving(true);
    try {
      for (const uid of bulkSelected) {
        await updateDoc(doc(db, 'users', uid), { permissions: perms });
      }
      setUsers(prev => prev.map(u => bulkSelected.includes(u.id) ? { ...u, permissions: perms } : u));
      setBulkSelected([]);
      setBulkMode(false);
      toast(`Permissions applied to ${bulkSelected.length} user(s)`);
    } catch (err) {
      toast('Failed: ' + err.message, 'er');
    }
    setSaving(false);
  };

  return (
    <>
      {/* Account Info */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="ch"><h3>Account</h3></div>
        <div className="cb">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div><span style={{ fontSize: '.76rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Email</span><span style={{ fontSize: '.95rem', fontWeight: 500 }}>{user?.email || '-'}</span></div>
            <div><span style={{ fontSize: '.76rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Role</span><span style={{ fontSize: '.95rem', fontWeight: 500, textTransform: 'capitalize' }}>{role}</span></div>
            <div><span style={{ fontSize: '.76rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Display Name</span><span style={{ fontSize: '.95rem', fontWeight: 500 }}>{user?.displayName || 'Not set'}</span></div>
            <div><span style={{ fontSize: '.76rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Project</span><span style={{ fontSize: '.95rem', fontWeight: 500 }}>pps-crm-new</span></div>
          </div>
        </div>
      </div>

      {/* Permission Management — admin only */}
      {isAdmin && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="ch" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3><span className="material-icons-round" style={{ fontSize: 20, verticalAlign: 'middle', marginRight: 6 }}>admin_panel_settings</span>Permission Management</h3>
          </div>
          <div className="cb">
            {loading ? (
              <div style={{ textAlign: 'center', padding: 20 }}><div className="spin"></div></div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 18, minHeight: 300 }}>
                {/* User List */}
                <div style={{ borderRight: '1px solid var(--bor)', paddingRight: 18 }}>
                  <p style={{ fontSize: '.78rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 10 }}>Select User</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 400, overflowY: 'auto' }}>
                    {users.map(u => (
                      <div key={u.id} onClick={() => selectUser(u)} style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                        background: selectedUser?.id === u.id ? 'rgba(var(--pri-rgb,59,130,246),.1)' : 'transparent',
                        border: selectedUser?.id === u.id ? '1px solid var(--pri)' : '1px solid transparent',
                      }}>
                        <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg,var(--pri),var(--pri-l))', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.68rem', fontWeight: 700, flexShrink: 0 }}>
                          {(u.displayName || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
                        </div>
                        <div style={{ overflow: 'hidden' }}>
                          <div style={{ fontSize: '.84rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.displayName || u.email}</div>
                          <div style={{ fontSize: '.72rem', color: 'var(--muted)' }}>{u.designation || u.role}</div>
                        </div>
                        {u.permissions && <span className="material-icons-round" style={{ fontSize: 14, color: 'var(--pri)', marginLeft: 'auto' }}>tune</span>}
                      </div>
                    ))}
                    {users.length === 0 && <p style={{ color: 'var(--muted)', fontSize: '.84rem' }}>No approved users found.</p>}
                  </div>
                </div>

                {/* Permissions Panel */}
                <div>
                  {selectedUser ? (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
                        <div>
                          <h4 style={{ margin: 0, fontSize: '1rem' }}>{selectedUser.displayName || selectedUser.email}</h4>
                          <p style={{ margin: '2px 0 0', fontSize: '.78rem', color: 'var(--muted)' }}>{selectedUser.designation || selectedUser.role} &bull; {selectedUser.email}</p>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn" onClick={() => toggleAll(true)} style={{ padding: '4px 10px', fontSize: '.76rem' }}>Select All</button>
                          <button className="btn" onClick={() => toggleAll(false)} style={{ padding: '4px 10px', fontSize: '.76rem' }}>Deselect All</button>
                        </div>
                      </div>

                      {/* Permission toggles grid */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 8, marginBottom: 16 }}>
                        {PERMISSION_MODULES.map(m => (
                          <label key={m.key} style={{
                            display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                            border: '1px solid var(--bor)', background: perms[m.key] ? 'rgba(39,174,96,.06)' : 'rgba(231,76,60,.04)',
                            transition: 'all .15s',
                          }}>
                            <input type="checkbox" checked={perms[m.key] || false} onChange={() => togglePerm(m.key)} style={{ accentColor: 'var(--pri)' }} />
                            <span className="material-icons-round" style={{ fontSize: 18, color: perms[m.key] ? '#27ae60' : '#e74c3c' }}>{m.icon}</span>
                            <span style={{ fontSize: '.84rem', fontWeight: 500 }}>{m.label}</span>
                          </label>
                        ))}
                      </div>

                      {/* Actions */}
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <button className="btn bp" onClick={savePermissions} disabled={saving} style={{ padding: '8px 20px', fontSize: '.86rem' }}>
                          {saving ? <><span className="ssm"></span> Saving...</> : <><span className="material-icons-round" style={{ fontSize: 16 }}>save</span> Save Permissions</>}
                        </button>
                        <button className="btn" onClick={() => { setBulkMode(!bulkMode); setBulkSelected([]); }} style={{ padding: '8px 16px', fontSize: '.86rem' }}>
                          <span className="material-icons-round" style={{ fontSize: 16 }}>group_add</span> {bulkMode ? 'Cancel Bulk' : 'Apply to Multiple'}
                        </button>
                      </div>

                      {/* Bulk apply mode */}
                      {bulkMode && (
                        <div style={{ marginTop: 14, padding: 14, border: '1px solid var(--bor)', borderRadius: 10, background: 'var(--bg)' }}>
                          <p style={{ fontSize: '.82rem', fontWeight: 600, marginBottom: 10 }}>Select users to apply these same permissions to:</p>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12, maxHeight: 180, overflowY: 'auto' }}>
                            {users.filter(u => u.id !== selectedUser.id).map(u => (
                              <label key={u.id} style={{
                                display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: '.82rem',
                                border: bulkSelected.includes(u.id) ? '1px solid var(--pri)' : '1px solid var(--bor)',
                                background: bulkSelected.includes(u.id) ? 'rgba(var(--pri-rgb,59,130,246),.08)' : '#fff',
                              }}>
                                <input type="checkbox" checked={bulkSelected.includes(u.id)} onChange={() => toggleBulkUser(u.id)} />
                                {u.displayName || u.email}
                              </label>
                            ))}
                          </div>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <button className="btn bp" onClick={applyBulkPermissions} disabled={saving || bulkSelected.length === 0} style={{ padding: '6px 16px', fontSize: '.82rem' }}>
                              <span className="material-icons-round" style={{ fontSize: 14 }}>check</span> Apply to {bulkSelected.length} user(s)
                            </button>
                            <button className="btn" onClick={() => setBulkSelected(users.filter(u => u.id !== selectedUser.id).map(u => u.id))} style={{ padding: '6px 12px', fontSize: '.78rem' }}>Select All</button>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--muted)' }}>
                      <span className="material-icons-round" style={{ fontSize: 48, marginBottom: 10 }}>person_search</span>
                      <p style={{ fontSize: '.9rem' }}>Select a user to manage permissions</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Deployment */}
      <div className="card">
        <div className="ch"><h3>Deployment</h3></div>
        <div className="cb">
          <p style={{ fontSize: '.88rem', color: 'var(--muted)', lineHeight: 1.6 }}>
            To deploy updates, run <code style={{ background: 'var(--bg)', padding: '2px 6px', borderRadius: 4 }}>npm run build</code> followed by <code style={{ background: 'var(--bg)', padding: '2px 6px', borderRadius: 4 }}>firebase deploy</code> from the project root.
          </p>
        </div>
      </div>
    </>
  );
}
