import React, { useState, useEffect } from 'react';
import { apiGet, apiPost, apiPatch, apiDelete } from '../services/api';
import { addDocument, updateDocument } from '../services/firestore';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { DESIGNATIONS, getRoleFromDesignation, hasAccess } from '../services/helpers';
import { useToast } from '../context/ToastContext';
import { Modal } from '../components/SharedUI';

// Default temp password for admin-provisioned accounts (staff should change it).
const TEMP_PASSWORD = (phone) => {
  const p = String(phone || '').replace(/\D/g, '').slice(-4);
  return p.length === 4 ? 'PPS@' + p + '#in' : 'PPS@12345';
};

export default function UserManagement() {
  const { role, user: currentUser } = useAuth();
  const { team } = useData();
  const { toast } = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [editModal, setEditModal] = useState(null);
  const [detailModal, setDetailModal] = useState(null);
  const [addModal, setAddModal] = useState(false);

  const handleCreateUser = async (data) => {
    await apiPost('/auth/users', data);
    await fetchUsers();
    setAddModal(false);
    toast('User created');
  };

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await apiGet('/auth/users');
      const list = res.users || [];
      list.sort((a, b) => (a.approved === b.approved ? 0 : a.approved ? 1 : -1));
      setUsers(list);
    } catch (err) {
      toast('Failed to load users: ' + err.message, 'er');
    }
    setLoading(false);
  };

  useEffect(() => { fetchUsers(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleApprove = async (uid) => {
    try {
      await apiPatch('/auth/users/' + uid, { approved: true });
      setUsers(prev => prev.map(u => u.id === uid ? { ...u, approved: true } : u));
      toast('User approved');
    } catch (err) { toast('Failed to approve: ' + err.message, 'er'); }
  };

  const handleDesignationChange = async (uid, newDesignation) => {
    try {
      const newRole = getRoleFromDesignation(newDesignation);
      await apiPatch('/auth/users/' + uid, { designation: newDesignation });
      setUsers(prev => prev.map(u => u.id === uid ? { ...u, designation: newDesignation, role: newRole } : u));
      toast('Designation updated');
    } catch (err) { toast('Failed to update: ' + err.message, 'er'); }
  };

  const handleRevoke = async (uid) => {
    if (!window.confirm('Revoke access for this user? They will see the pending approval screen.')) return;
    try {
      await apiPatch('/auth/users/' + uid, { approved: false });
      setUsers(prev => prev.map(u => u.id === uid ? { ...u, approved: false } : u));
      toast('Access revoked');
    } catch (err) { toast('Failed to revoke: ' + err.message, 'er'); }
  };

  const handleDelete = async (uid) => {
    if (!window.confirm('Permanently delete this user account? This action cannot be undone.')) return;
    try {
      await apiDelete('/auth/users/' + uid);
      setUsers(prev => prev.filter(u => u.id !== uid));
      if (detailModal?.id === uid) setDetailModal(null);
      toast('User deleted');
    } catch (err) { toast('Failed to delete: ' + err.message, 'er'); }
  };

  const handleBulkSetManager = async () => {
    if (!window.confirm('Set ALL approved users (except yourself) to Manager role? You can reassign individual permissions later in Settings.')) return;
    try {
      let count = 0;
      for (const u of users) {
        if (u.id === currentUser?.uid) continue;
        if (!u.approved) continue;
        if (u.role === 'operation_manager' && u.designation === 'Operation Manager') continue;
        await apiPatch('/auth/users/' + u.id, { designation: 'Operation Manager' });
        count++;
      }
      await fetchUsers();
      toast(`${count} user(s) updated to Operation Manager role`);
    } catch (err) { toast('Failed: ' + err.message, 'er'); }
  };

  const handleCreateUsersFromTeam = async () => {
    const activeTeam = team.filter(t => t.status === 'Active');
    if (activeTeam.length === 0) { toast('No active team members found', 'er'); return; }
    const existingEmails = new Set(users.map(u => (u.email || '').toLowerCase()).filter(Boolean));
    // A login needs an email; only team members with a (new) email can get an account.
    const toCreate = activeTeam.filter(t => t.email && !existingEmails.has(String(t.email).toLowerCase()));
    if (toCreate.length === 0) { toast('No team members with a new email to create logins for', 'er'); return; }
    if (!window.confirm(`Create ${toCreate.length} login(s) from team members (Operation Manager role)?\n\nTemp password: PPS@<last4-of-phone>#in (or PPS@12345). Ask them to change it.\n\n${toCreate.map(t => t.name).join(', ')}`)) return;
    try {
      let count = 0;
      for (const t of toCreate) {
        const phone = String(t.phone || '').replace(/\D/g, '').slice(-10);
        await apiPost('/auth/users', {
          email: String(t.email).toLowerCase(),
          password: TEMP_PASSWORD(phone),
          displayName: t.name || '',
          phone,
          designation: 'Operation Manager',
          approved: true,
        });
        count++;
      }
      await fetchUsers();
      toast(`${count} login(s) created from team members`);
    } catch (err) { toast('Failed: ' + err.message, 'er'); }
  };

  // Strip leading initials like "C.K.", "CH.", "P.", "R.", "V.", "SD." from names
  const stripInitials = (name) => name.replace(/^([A-Z]{1,3}\.)+\s*/i, '').trim();

  const handleCleanNames = async () => {
    const teamList = await apiGet('/collections/team');
    const toUpdate = (teamList || [])
      .map(t => ({ id: t.id, name: t.name || '' }))
      .filter(t => stripInitials(t.name) !== t.name);
    if (toUpdate.length === 0) { toast('No names with initials found', 'er'); return; }
    const preview = toUpdate.map(t => `${t.name} → ${stripInitials(t.name)}`).join('\n');
    if (!window.confirm(`Remove initials from ${toUpdate.length} name(s)?\n\n${preview}`)) return;
    try {
      for (const t of toUpdate) {
        await updateDocument('team', t.id, { name: stripInitials(t.name) });
      }
      // Also update user display names
      const res = await apiGet('/auth/users');
      for (const u of (res.users || [])) {
        const clean = stripInitials(u.displayName || '');
        if (clean !== (u.displayName || '')) await apiPatch('/auth/users/' + u.id, { displayName: clean });
      }
      await fetchUsers();
      toast(`${toUpdate.length} name(s) cleaned successfully`);
    } catch (err) { toast('Failed: ' + err.message, 'er'); }
  };

  const handleAddYashwanth = async () => {
    const teamList = await apiGet('/collections/team');
    const exists = (teamList || []).find(t => (t.name || '').toLowerCase().includes('yashwanth'));
    if (exists) { toast('Yashwanth already exists in Team', 'er'); return; }
    if (!window.confirm('Add Yashwanth as a new active team member and create a login (yashwanth@pragathipowersolutions.com / PPS@12345)?')) return;
    try {
      await addDocument('team', {
        name: 'Yashwanth', role: 'Engineer', designation: 'Engineer',
        status: 'Active', phone: '', email: 'yashwanth@pragathipowersolutions.com', attendance: 0,
        joiningDate: new Date().toISOString().slice(0, 10)
      });
      await apiPost('/auth/users', {
        email: 'yashwanth@pragathipowersolutions.com', password: 'PPS@12345',
        displayName: 'Yashwanth', phone: '', designation: 'Technician', approved: true,
      });
      await fetchUsers();
      toast('Yashwanth added to Team and Users');
    } catch (err) { toast('Failed: ' + err.message, 'er'); }
  };

  const handleEditSave = async (uid, data) => {
    try {
      const update = { ...data };
      if (data.designation) update.role = getRoleFromDesignation(data.designation);
      await apiPatch('/auth/users/' + uid, update);
      setUsers(prev => prev.map(u => u.id === uid ? { ...u, ...update } : u));
      setEditModal(null);
    } catch (err) {
      alert('Failed to update user: ' + err.message);
    }
  };

  if (!hasAccess(role, 'admin')) {
    return (
      <div className="card">
        <div className="cb" style={{ textAlign: 'center', padding: 40 }}>
          <span className="material-icons-round" style={{ fontSize: 48, color: 'var(--err)', marginBottom: 12, display: 'block' }}>lock</span>
          <h3>Access Denied</h3>
          <p style={{ color: 'var(--muted)' }}>Only admins can manage users.</p>
        </div>
      </div>
    );
  }

  const pendingCount = users.filter(u => !u.approved).length;
  const approvedCount = users.filter(u => u.approved).length;
  const filtered = (filter === 'all' ? users : filter === 'pending' ? users.filter(u => !u.approved) : users.filter(u => u.approved))
    .filter(u => {
      if (!search) return true;
      const s = search.toLowerCase();
      return (u.displayName || '').toLowerCase().includes(s) || (u.email || '').toLowerCase().includes(s) || (u.phone || '').toLowerCase().includes(s) || (u.designation || '').toLowerCase().includes(s);
    });

  return (
    <>
      {/* Stats cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12, marginBottom: 18 }}>
        <div className="card" style={{ cursor: 'pointer', border: filter === 'all' ? '2px solid var(--pri)' : undefined }} onClick={() => setFilter('all')}>
          <div className="cb" style={{ textAlign: 'center', padding: '14px 10px' }}>
            <span className="material-icons-round" style={{ fontSize: 28, color: 'var(--pri)', display: 'block', marginBottom: 4 }}>groups</span>
            <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{users.length}</div>
            <div style={{ fontSize: '.76rem', color: 'var(--muted)' }}>Total Users</div>
          </div>
        </div>
        <div className="card" style={{ cursor: 'pointer', border: filter === 'approved' ? '2px solid #27ae60' : undefined }} onClick={() => setFilter('approved')}>
          <div className="cb" style={{ textAlign: 'center', padding: '14px 10px' }}>
            <span className="material-icons-round" style={{ fontSize: 28, color: '#27ae60', display: 'block', marginBottom: 4 }}>verified_user</span>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#27ae60' }}>{approvedCount}</div>
            <div style={{ fontSize: '.76rem', color: 'var(--muted)' }}>Approved</div>
          </div>
        </div>
        <div className="card" style={{ cursor: 'pointer', border: filter === 'pending' ? '2px solid #e8830c' : undefined }} onClick={() => setFilter('pending')}>
          <div className="cb" style={{ textAlign: 'center', padding: '14px 10px' }}>
            <span className="material-icons-round" style={{ fontSize: 28, color: '#e8830c', display: 'block', marginBottom: 4 }}>pending_actions</span>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#e8830c' }}>{pendingCount}</div>
            <div style={{ fontSize: '.76rem', color: 'var(--muted)' }}>Pending</div>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1, minWidth: 200 }}>
          <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
            <span className="material-icons-round" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 18, color: 'var(--muted)' }}>search</span>
            <input className="fi" placeholder="Search by name, email, phone..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 34, fontSize: '.84rem' }} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn bp" onClick={() => setAddModal(true)} style={{ padding: '6px 16px', fontSize: '.84rem' }} title="Create a new login">
            <span className="material-icons-round" style={{ fontSize: 16 }}>person_add</span> New User
          </button>
          <button className="btn" onClick={handleCreateUsersFromTeam} style={{ padding: '6px 16px', fontSize: '.84rem' }} title="Create user accounts from team members">
            <span className="material-icons-round" style={{ fontSize: 16 }}>group_add</span> Create Users from Team
          </button>
          <button className="btn" onClick={handleBulkSetManager} style={{ padding: '6px 16px', fontSize: '.84rem' }} title="Set all approved users to Manager role">
            <span className="material-icons-round" style={{ fontSize: 16 }}>admin_panel_settings</span> Set All to Manager
          </button>
          <button className="btn" onClick={handleCleanNames} style={{ padding: '6px 16px', fontSize: '.84rem', background: 'linear-gradient(135deg,#f59e0b,#f97316)', color: '#fff' }} title="Strip initials like C.K., P., R. from team member names">
            <span className="material-icons-round" style={{ fontSize: 16 }}>auto_fix_high</span> Clean Names
          </button>
          <button className="btn" onClick={handleAddYashwanth} style={{ padding: '6px 16px', fontSize: '.84rem', background: 'linear-gradient(135deg,#8b5cf6,#6366f1)', color: '#fff' }} title="Add Yashwanth to Team and Users">
            <span className="material-icons-round" style={{ fontSize: 16 }}>person_add</span> Add Yashwanth
          </button>
          <button className="btn" onClick={fetchUsers} style={{ padding: '6px 16px', fontSize: '.84rem' }}>
            <span className="material-icons-round" style={{ fontSize: 16 }}>refresh</span> Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <div className="spin"></div>
          <p style={{ color: 'var(--muted)', marginTop: 12 }}>Loading users...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card">
          <div className="cb" style={{ textAlign: 'center', padding: 40 }}>
            <span className="material-icons-round" style={{ fontSize: 48, color: 'var(--muted)', display: 'block', marginBottom: 12 }}>group_off</span>
            <p style={{ color: 'var(--muted)' }}>No {filter !== 'all' ? filter : ''} users found.</p>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Designation</th>
                  <th>Status</th>
                  <th>Joined</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(u => {
                  const isSelf = u.id === currentUser?.uid;
                  return (
                    <tr key={u.id} style={{ cursor: 'pointer' }} onClick={() => setDetailModal(u)}>
                      <td style={{ fontWeight: 600 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 32, height: 32, borderRadius: '50%', background: u.approved ? 'linear-gradient(135deg,var(--pri),var(--pri-l))' : 'var(--bor)', color: u.approved ? '#fff' : 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.72rem', fontWeight: 700, flexShrink: 0 }}>
                            {(u.displayName || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
                          </div>
                          <div>
                            {u.displayName || '-'}
                            {isSelf && <span style={{ fontSize: '.72rem', color: 'var(--pri)', marginLeft: 6 }}>(You)</span>}
                          </div>
                        </div>
                      </td>
                      <td style={{ fontSize: '.84rem' }}>{u.email}</td>
                      <td style={{ fontSize: '.84rem' }}>{u.phone || '-'}</td>
                      <td>
                        {isSelf ? (
                          <span style={{ fontWeight: 500, fontSize: '.84rem' }}>{u.designation || u.role}</span>
                        ) : (
                          <select className="fi" value={u.designation || ''} onChange={e => { e.stopPropagation(); handleDesignationChange(u.id, e.target.value); }} onClick={e => e.stopPropagation()} style={{ padding: '4px 28px 4px 8px', fontSize: '.82rem', minWidth: 160 }}>
                            {!u.designation && <option value="">-- Select --</option>}
                            {DESIGNATIONS.map(d => (
                              <option key={d.label} value={d.label}>{d.label}</option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td>
                        {u.approved ? (
                          <span style={{ background: 'rgba(39,174,96,.1)', color: '#27ae60', padding: '3px 10px', borderRadius: 12, fontSize: '.78rem', fontWeight: 600 }}>Approved</span>
                        ) : (
                          <span style={{ background: 'rgba(232,131,12,.1)', color: '#e8830c', padding: '3px 10px', borderRadius: 12, fontSize: '.78rem', fontWeight: 600 }}>Pending</span>
                        )}
                      </td>
                      <td style={{ fontSize: '.82rem', color: 'var(--muted)' }}>
                        {u.createdAt ? new Date(u.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'}
                      </td>
                      <td style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                        {isSelf ? (
                          <span style={{ fontSize: '.78rem', color: 'var(--muted)' }}>-</span>
                        ) : (
                          <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                            {!u.approved && (
                              <button className="btn bp" onClick={() => handleApprove(u.id)} style={{ padding: '4px 10px', fontSize: '.78rem' }} title="Approve">
                                <span className="material-icons-round" style={{ fontSize: 15 }}>check</span>
                              </button>
                            )}
                            <button className="btn" onClick={() => setEditModal(u)} style={{ padding: '4px 10px', fontSize: '.78rem' }} title="Edit User">
                              <span className="material-icons-round" style={{ fontSize: 15 }}>edit</span>
                            </button>
                            {u.approved && (
                              <button className="btn" onClick={() => handleRevoke(u.id)} style={{ padding: '4px 10px', fontSize: '.78rem', color: '#e8830c' }} title="Revoke Access">
                                <span className="material-icons-round" style={{ fontSize: 15 }}>block</span>
                              </button>
                            )}
                            <button className="btn" onClick={() => handleDelete(u.id)} style={{ padding: '4px 10px', fontSize: '.78rem', color: 'var(--err)' }} title="Delete User">
                              <span className="material-icons-round" style={{ fontSize: 15 }}>delete</span>
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add User Modal */}
      {addModal && <AddUserModal onSave={handleCreateUser} onClose={() => setAddModal(false)} />}

      {/* Edit User Modal */}
      {editModal && <EditUserModal user={editModal} onSave={handleEditSave} onClose={() => setEditModal(null)} />}

      {/* User Detail Modal */}
      {detailModal && (
        <Modal title="User Details" onClose={() => setDetailModal(null)}>
          <UserDetailView user={detailModal} onEdit={() => { setEditModal(detailModal); setDetailModal(null); }} onDelete={() => handleDelete(detailModal.id)} onRevoke={() => handleRevoke(detailModal.id)} onApprove={() => { handleApprove(detailModal.id); setDetailModal(null); }} isSelf={detailModal.id === currentUser?.uid} />
        </Modal>
      )}
    </>
  );
}

/* ── Add User Modal (admin provisions a login) ── */
function AddUserModal({ onSave, onClose }) {
  const [f, setF] = useState({ displayName: '', email: '', phone: '', designation: 'Executive', password: '', approved: true });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!f.email.trim() || !/^\S+@\S+\.\S+$/.test(f.email)) { setErr('Enter a valid email'); return; }
    if (f.password.length < 6) { setErr('Password must be at least 6 characters'); return; }
    setSaving(true);
    try { await onSave({ ...f, email: f.email.trim().toLowerCase() }); }
    catch (e2) { setErr(e2.message); setSaving(false); }
  };

  return (
    <Modal title="Add User" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="mb">
          {err && <div className="aerr" style={{ marginBottom: 10 }}>{err}</div>}
          <div className="fr">
            <div className="fg"><label>Full Name</label><input className="fi" value={f.displayName} onChange={e => set('displayName', e.target.value)} placeholder="e.g. Ravi Kumar" /></div>
            <div className="fg"><label>Phone</label><input className="fi" value={f.phone} onChange={e => set('phone', e.target.value)} /></div>
          </div>
          <div className="fr">
            <div className="fg"><label>Email (username) *</label><input type="email" className="fi" value={f.email} onChange={e => set('email', e.target.value)} required placeholder="name@pragathipowersolutions.com" /></div>
            <div className="fg"><label>Role *</label>
              <select className="fi" value={f.designation} onChange={e => set('designation', e.target.value)}>
                {DESIGNATIONS.map(d => <option key={d.label} value={d.label}>{d.label}</option>)}
              </select>
            </div>
          </div>
          <div className="fr">
            <div className="fg"><label>Password *</label><input className="fi" value={f.password} onChange={e => set('password', e.target.value)} placeholder="Min 6 characters" /></div>
            <div className="fg"><label>Access</label>
              <select className="fi" value={f.approved ? 'yes' : 'no'} onChange={e => set('approved', e.target.value === 'yes')}>
                <option value="yes">Approved (can log in now)</option>
                <option value="no">Pending approval</option>
              </select>
            </div>
          </div>
        </div>
        <div className="mf">
          <button type="button" className="btn bo" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn bp" disabled={saving}>{saving ? 'Creating...' : 'Create User'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ── Edit User Modal ── */
function EditUserModal({ user, onSave, onClose }) {
  const [f, setF] = useState({
    displayName: user.displayName || '',
    phone: user.phone || '',
    designation: user.designation || '',
    address: user.address || '',
    department: user.department || '',
    notes: user.notes || '',
    password: ''
  });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (f.password && f.password.length < 6) { alert('Password must be at least 6 characters'); return; }
    const data = {};
    if (f.displayName !== (user.displayName || '')) data.displayName = f.displayName;
    if (f.phone !== (user.phone || '')) data.phone = f.phone;
    if (f.designation !== (user.designation || '')) data.designation = f.designation;
    if (f.address !== (user.address || '')) data.address = f.address;
    if (f.department !== (user.department || '')) data.department = f.department;
    if (f.notes !== (user.notes || '')) data.notes = f.notes;
    if (f.password) data.password = f.password;
    if (Object.keys(data).length === 0) { onClose(); return; }
    onSave(user.id, data);
  };

  return (
    <Modal title={`Edit User — ${user.displayName || user.email}`} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="mb">
          <div className="fr">
            <div className="fg"><label>Full Name</label><input className="fi" value={f.displayName} onChange={e => set('displayName', e.target.value)} /></div>
            <div className="fg"><label>Phone</label><input className="fi" value={f.phone} onChange={e => set('phone', e.target.value)} /></div>
          </div>
          <div className="fr">
            <div className="fg">
              <label>Designation</label>
              <select className="fi" value={f.designation} onChange={e => set('designation', e.target.value)}>
                {!f.designation && <option value="">-- Select --</option>}
                {DESIGNATIONS.map(d => <option key={d.label} value={d.label}>{d.label}</option>)}
              </select>
            </div>
            <div className="fg"><label>Department</label><input className="fi" value={f.department} onChange={e => set('department', e.target.value)} placeholder="e.g. Sales, Technical, Admin" /></div>
          </div>
          <div className="fg"><label>Address</label><input className="fi" value={f.address} onChange={e => set('address', e.target.value)} placeholder="Full address" /></div>
          <div className="fg"><label>Reset Password <span style={{ fontSize: '.74rem', color: 'var(--muted)', fontWeight: 400 }}>Leave blank to keep current</span></label><input className="fi" value={f.password} onChange={e => set('password', e.target.value)} placeholder="New password (min 6 chars)" autoComplete="new-password" /></div>
          <div className="fg"><label>Admin Notes</label><textarea className="fi" value={f.notes} onChange={e => set('notes', e.target.value)} rows={3} placeholder="Internal notes about this user..." /></div>
        </div>
        <div className="mf">
          <button type="button" className="btn bo" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn bp">Save Changes</button>
        </div>
      </form>
    </Modal>
  );
}

/* ── User Detail View ── */
function UserDetailView({ user, onEdit, onDelete, onRevoke, onApprove, isSelf }) {
  const detailRow = (icon, label, value) => (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--bor)' }}>
      <span className="material-icons-round" style={{ fontSize: 18, color: 'var(--muted)', marginTop: 1 }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '.74rem', color: 'var(--muted)', marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: '.9rem', fontWeight: 500 }}>{value || '-'}</div>
      </div>
    </div>
  );

  return (
    <div>
      {/* Profile header */}
      <div style={{ textAlign: 'center', marginBottom: 18 }}>
        <div style={{ width: 64, height: 64, borderRadius: '50%', background: user.approved ? 'linear-gradient(135deg,var(--pri),var(--pri-l))' : 'var(--bor)', color: user.approved ? '#fff' : 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem', fontWeight: 700, margin: '0 auto 10px' }}>
          {(user.displayName || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
        </div>
        <h3 style={{ margin: 0 }}>{user.displayName || 'No Name'}</h3>
        <p style={{ color: 'var(--muted)', fontSize: '.84rem', margin: '4px 0' }}>{user.designation || user.role || 'No Role'}</p>
        {user.approved ? (
          <span style={{ background: 'rgba(39,174,96,.1)', color: '#27ae60', padding: '3px 12px', borderRadius: 12, fontSize: '.78rem', fontWeight: 600 }}>Approved</span>
        ) : (
          <span style={{ background: 'rgba(232,131,12,.1)', color: '#e8830c', padding: '3px 12px', borderRadius: 12, fontSize: '.78rem', fontWeight: 600 }}>Pending Approval</span>
        )}
      </div>

      {/* Details */}
      <div style={{ marginBottom: 18 }}>
        {detailRow('email', 'Email', user.email)}
        {detailRow('phone', 'Phone', user.phone)}
        {detailRow('badge', 'User ID', user.id)}
        {detailRow('work', 'Designation', user.designation)}
        {detailRow('business', 'Department', user.department)}
        {detailRow('location_on', 'Address', user.address)}
        {detailRow('calendar_today', 'Joined', user.createdAt ? new Date(user.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : '-')}
        {detailRow('schedule', 'Last Login', user.lastLogin ? new Date(user.lastLogin).toLocaleString('en-IN') : '-')}
        {user.notes && detailRow('notes', 'Admin Notes', user.notes)}
      </div>

      {/* Actions */}
      {!isSelf && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button className="btn bp" onClick={onEdit} style={{ padding: '6px 16px', fontSize: '.84rem' }}>
            <span className="material-icons-round" style={{ fontSize: 16 }}>edit</span> Edit
          </button>
          {!user.approved && (
            <button className="btn" onClick={onApprove} style={{ padding: '6px 16px', fontSize: '.84rem', color: '#27ae60', borderColor: '#27ae60' }}>
              <span className="material-icons-round" style={{ fontSize: 16 }}>check_circle</span> Approve
            </button>
          )}
          {user.approved && (
            <button className="btn" onClick={onRevoke} style={{ padding: '6px 16px', fontSize: '.84rem', color: '#e8830c' }}>
              <span className="material-icons-round" style={{ fontSize: 16 }}>block</span> Revoke
            </button>
          )}
          <button className="btn" onClick={onDelete} style={{ padding: '6px 16px', fontSize: '.84rem', color: 'var(--err)' }}>
            <span className="material-icons-round" style={{ fontSize: 16 }}>delete</span> Delete
          </button>
        </div>
      )}
    </div>
  );
}
