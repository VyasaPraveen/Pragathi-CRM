import React, { useState, useEffect } from 'react';
import { db } from '../services/firebase';
import { collection, getDocs, doc, updateDoc, deleteDoc, setDoc, addDoc } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { DESIGNATIONS, getRoleFromDesignation, hasAccess } from '../services/helpers';
import { useToast } from '../context/ToastContext';
import { Modal } from '../components/SharedUI';

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

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'users'));
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => (a.approved === b.approved ? 0 : a.approved ? 1 : -1));
      setUsers(list);
    } catch (err) {
      toast('Failed to load users: ' + err.message, 'er');
    }
    setLoading(false);
  };

  useEffect(() => { fetchUsers(); }, []);

  const handleApprove = async (uid) => {
    try {
      await updateDoc(doc(db, 'users', uid), { approved: true });
      setUsers(prev => prev.map(u => u.id === uid ? { ...u, approved: true } : u));
      toast('User approved');
    } catch (err) { toast('Failed to approve: ' + err.message, 'er'); }
  };

  const handleReject = async (uid) => {
    if (!window.confirm('Remove this user? They will need to sign up again.')) return;
    try {
      await deleteDoc(doc(db, 'users', uid));
      setUsers(prev => prev.filter(u => u.id !== uid));
      toast('User removed');
    } catch (err) { toast('Failed to remove: ' + err.message, 'er'); }
  };

  const handleDesignationChange = async (uid, newDesignation) => {
    try {
      const newRole = getRoleFromDesignation(newDesignation);
      await updateDoc(doc(db, 'users', uid), { designation: newDesignation, role: newRole });
      setUsers(prev => prev.map(u => u.id === uid ? { ...u, designation: newDesignation, role: newRole } : u));
      toast('Designation updated');
    } catch (err) { toast('Failed to update: ' + err.message, 'er'); }
  };

  const handleRevoke = async (uid) => {
    if (!window.confirm('Revoke access for this user? They will see the pending approval screen.')) return;
    try {
      await updateDoc(doc(db, 'users', uid), { approved: false });
      setUsers(prev => prev.map(u => u.id === uid ? { ...u, approved: false } : u));
      toast('Access revoked');
    } catch (err) { toast('Failed to revoke: ' + err.message, 'er'); }
  };

  const handleDelete = async (uid) => {
    if (!window.confirm('Permanently delete this user account? This action cannot be undone.')) return;
    try {
      await deleteDoc(doc(db, 'users', uid));
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
        if (u.role === 'manager' && u.designation === 'Operations Manager') continue;
        await updateDoc(doc(db, 'users', u.id), { designation: 'Operations Manager', role: 'manager' });
        count++;
      }
      await fetchUsers();
      toast(`${count} user(s) updated to Manager role`);
    } catch (err) { toast('Failed: ' + err.message, 'er'); }
  };

  const handleCreateUsersFromTeam = async () => {
    const activeTeam = team.filter(t => t.status === 'Active');
    if (activeTeam.length === 0) { toast('No active team members found', 'er'); return; }
    // Find team members that don't already have a user account (match by phone or name)
    const existingPhones = new Set(users.map(u => String(u.phone || '').replace(/\D/g, '').slice(-10)).filter(p => p.length === 10));
    const existingNames = new Set(users.map(u => (u.displayName || '').toLowerCase()));
    const toCreate = activeTeam.filter(t => {
      const ph = String(t.phone || '').replace(/\D/g, '').slice(-10);
      const nm = (t.name || '').toLowerCase();
      return !(ph.length === 10 && existingPhones.has(ph)) && !existingNames.has(nm);
    });
    if (toCreate.length === 0) { toast('All team members already have user accounts', 'er'); return; }
    if (!window.confirm(`Create ${toCreate.length} user account(s) from team members with Manager role?\n\n${toCreate.map(t => t.name).join(', ')}`)) return;
    try {
      let count = 0;
      for (const t of toCreate) {
        const phone = String(t.phone || '').replace(/\D/g, '').slice(-10);
        const userId = 'team_' + t.id; // use team-prefixed ID so they're identifiable
        await setDoc(doc(db, 'users', userId), {
          displayName: t.name || '',
          email: t.email || '',
          phone: phone,
          designation: 'Operations Manager',
          role: 'manager',
          approved: true,
          teamId: t.id,
          createdAt: new Date().toISOString(),
          createdVia: 'bulk_team_import'
        });
        count++;
      }
      await fetchUsers();
      toast(`${count} user(s) created from team members`);
    } catch (err) { toast('Failed: ' + err.message, 'er'); }
  };

  // Strip leading initials like "C.K.", "CH.", "P.", "R.", "V.", "SD." from names
  const stripInitials = (name) => name.replace(/^([A-Z]{1,3}\.)+\s*/i, '').trim();

  const handleCleanNames = async () => {
    const teamSnap = await getDocs(collection(db, 'team'));
    const toUpdate = teamSnap.docs
      .map(d => ({ id: d.id, name: d.data().name || '' }))
      .filter(t => stripInitials(t.name) !== t.name);
    if (toUpdate.length === 0) { toast('No names with initials found', 'er'); return; }
    const preview = toUpdate.map(t => `${t.name} → ${stripInitials(t.name)}`).join('\n');
    if (!window.confirm(`Remove initials from ${toUpdate.length} name(s)?\n\n${preview}`)) return;
    try {
      for (const t of toUpdate) {
        const clean = stripInitials(t.name);
        await updateDoc(doc(db, 'team', t.id), { name: clean });
      }
      // Also update user display names
      const userSnap = await getDocs(collection(db, 'users'));
      for (const u of userSnap.docs) {
        const dn = u.data().displayName || '';
        const clean = stripInitials(dn);
        if (clean !== dn) await updateDoc(doc(db, 'users', u.id), { displayName: clean });
      }
      await fetchUsers();
      toast(`${toUpdate.length} name(s) cleaned successfully`);
    } catch (err) { toast('Failed: ' + err.message, 'er'); }
  };

  const handleAddYashwanth = async () => {
    const teamSnap = await getDocs(collection(db, 'team'));
    const exists = teamSnap.docs.find(d => (d.data().name || '').toLowerCase().includes('yashwanth'));
    if (exists) { toast('Yashwanth already exists in Team', 'er'); return; }
    if (!window.confirm('Add Yashwanth as a new active team member and create a user account?')) return;
    try {
      const teamRef = await addDoc(collection(db, 'team'), {
        name: 'Yashwanth', role: 'Engineer', designation: 'Engineer',
        status: 'Active', phone: '', email: '', attendance: 0,
        joiningDate: new Date().toISOString().slice(0, 10)
      });
      await setDoc(doc(db, 'users', 'team_' + teamRef.id), {
        displayName: 'Yashwanth', email: '', phone: '',
        designation: 'Operations Manager', role: 'manager',
        approved: true, teamId: teamRef.id,
        createdAt: new Date().toISOString(), createdVia: 'manual_add'
      });
      await fetchUsers();
      toast('Yashwanth added to Team and Users');
    } catch (err) { toast('Failed: ' + err.message, 'er'); }
  };

  const handleEditSave = async (uid, data) => {
    try {
      const newRole = data.designation ? getRoleFromDesignation(data.designation) : undefined;
      const update = { ...data };
      if (newRole) update.role = newRole;
      await updateDoc(doc(db, 'users', uid), update);
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
          <button className="btn bp" onClick={handleCreateUsersFromTeam} style={{ padding: '6px 16px', fontSize: '.84rem' }} title="Create user accounts from team members">
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

/* ── Edit User Modal ── */
function EditUserModal({ user, onSave, onClose }) {
  const [f, setF] = useState({
    displayName: user.displayName || '',
    phone: user.phone || '',
    designation: user.designation || '',
    address: user.address || '',
    department: user.department || '',
    notes: user.notes || ''
  });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  const handleSubmit = (e) => {
    e.preventDefault();
    const data = {};
    if (f.displayName !== (user.displayName || '')) data.displayName = f.displayName;
    if (f.phone !== (user.phone || '')) data.phone = f.phone;
    if (f.designation !== (user.designation || '')) data.designation = f.designation;
    if (f.address !== (user.address || '')) data.address = f.address;
    if (f.department !== (user.department || '')) data.department = f.department;
    if (f.notes !== (user.notes || '')) data.notes = f.notes;
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
