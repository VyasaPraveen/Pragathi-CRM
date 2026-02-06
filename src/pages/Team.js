import React, { useState } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { addDocument, updateDocument, deleteDocument } from '../services/firestore';
import { formatCurrency, getInitials, toNumber, getDaysInMonth } from '../services/helpers';
import { StatusBadge, Modal, EmptyState } from '../components/SharedUI';

const roles = ['Electrician', 'Helper', 'Technician', 'Manager', 'Driver', 'Other'];
const statusOptions = ['Active', 'On Leave', 'Inactive'];

// Q4 fix: added full CRUD (was read-only)
// Q5 fix: uses getDaysInMonth() instead of hardcoded 30
export default function Team() {
  const { team } = useData();
  const { role } = useAuth();
  const { toast } = useToast();
  const [modal, setModal] = useState(null);
  const daysInMonth = getDaysInMonth();
  const canEdit = role === 'admin' || role === 'manager';

  const handleSave = async (data, id) => {
    try {
      const cleaned = { ...data, age: toNumber(data.age), salary: toNumber(data.salary), attendance: toNumber(data.attendance) };
      if (id) { await updateDocument('team', id, cleaned); toast('Team member updated'); }
      else { await addDocument('team', cleaned); toast('Team member added'); }
      setModal(null);
    } catch (e) { toast(e.message, 'er'); }
  };

  const handleDelete = async (id) => {
    if (window.confirm('Remove this team member?')) {
      try { await deleteDocument('team', id); toast('Team member removed'); }
      catch (e) { toast(e.message, 'er'); }
    }
  };

  return (
    <>
      <div className="tl">
        <h3>Team Management</h3>
        {canEdit && <button className="btn bp bsm" onClick={() => setModal({ data: {} })}><span className="material-icons-round" style={{ fontSize: 18 }}>add</span> Add Member</button>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 16 }}>
        {team.map(t => (
          <div className="card" key={t.id}><div className="cb" style={{ textAlign: 'center', padding: 24 }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'linear-gradient(135deg,var(--pri),var(--pri-l))', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', fontWeight: 700, margin: '0 auto 12px' }}>{getInitials(t.name)}</div>
            <h4 style={{ fontSize: '1rem', marginBottom: 2 }}>{t.name}</h4>
            <p style={{ fontSize: '.82rem', color: 'var(--muted)', marginBottom: 8 }}>{t.role}</p>
            <StatusBadge status={t.status} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 14, textAlign: 'left' }}>
              <div><span style={{ fontSize: '.72rem', color: 'var(--muted)', display: 'block' }}>Age</span><span style={{ fontWeight: 600, fontSize: '.88rem' }}>{t.age}</span></div>
              <div><span style={{ fontSize: '.72rem', color: 'var(--muted)', display: 'block' }}>Phone</span><span style={{ fontWeight: 600, fontSize: '.88rem' }}>{t.phone}</span></div>
              <div><span style={{ fontSize: '.72rem', color: 'var(--muted)', display: 'block' }}>Salary</span><span style={{ fontWeight: 600, fontSize: '.88rem' }}>{formatCurrency(t.salary)}</span></div>
              <div><span style={{ fontSize: '.72rem', color: 'var(--muted)', display: 'block' }}>Attendance</span><span style={{ fontWeight: 600, fontSize: '.88rem' }}>{t.attendance}/{daysInMonth} days</span></div>
            </div>
            {canEdit && <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'center' }}>
              <button className="btn bsm bo" onClick={() => setModal({ data: t, id: t.id })}><span className="material-icons-round" style={{ fontSize: 16 }}>edit</span> Edit</button>
              {role === 'admin' && <button className="btn bsm bo" onClick={() => handleDelete(t.id)} style={{ color: 'var(--err)', borderColor: 'rgba(231,76,60,.3)' }}><span className="material-icons-round" style={{ fontSize: 16 }}>delete</span></button>}
            </div>}
          </div></div>
        ))}
        {!team.length && <div className="card"><div className="cb"><EmptyState icon="groups" title="No team members" message="Add team members to manage your workforce." /></div></div>}
      </div>
      {modal && <TeamModal data={modal.data} id={modal.id} onSave={handleSave} onClose={() => setModal(null)} />}
    </>
  );
}

function TeamModal({ data, id, onSave, onClose }) {
  const [f, setF] = useState({
    name: data.name || '', role: data.role || 'Electrician', status: data.status || 'Active',
    age: data.age || '', phone: data.phone || '', salary: data.salary || '', attendance: data.attendance || 0
  });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  return (
    <Modal title={id ? 'Edit Team Member' : 'Add Team Member'} onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); onSave(f, id); }}>
        <div className="mb">
          <div className="fr"><div className="fg"><label>Full Name *</label><input className="fi" value={f.name} onChange={e => set('name', e.target.value)} required /></div><div className="fg"><label>Phone</label><input className="fi" value={f.phone} onChange={e => set('phone', e.target.value)} /></div></div>
          <div className="fr3"><div className="fg"><label>Role</label><select className="fi" value={f.role} onChange={e => set('role', e.target.value)}>{roles.map(r => <option key={r}>{r}</option>)}</select></div><div className="fg"><label>Age</label><input type="number" className="fi" value={f.age} onChange={e => set('age', e.target.value)} /></div><div className="fg"><label>Status</label><select className="fi" value={f.status} onChange={e => set('status', e.target.value)}>{statusOptions.map(s => <option key={s}>{s}</option>)}</select></div></div>
          <div className="fr"><div className="fg"><label>Salary</label><input type="number" className="fi" value={f.salary} onChange={e => set('salary', e.target.value)} /></div><div className="fg"><label>Attendance (days)</label><input type="number" className="fi" value={f.attendance} onChange={e => set('attendance', e.target.value)} min="0" max="31" /></div></div>
        </div>
        <div className="mf"><button type="button" className="btn bo" onClick={onClose}>Cancel</button><button type="submit" className="btn bp">{id ? 'Update' : 'Add'}</button></div>
      </form>
    </Modal>
  );
}
