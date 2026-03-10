import React, { useState } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { addDocument, updateDocument, deleteDocument } from '../services/firestore';
import { formatDate, sendWhatsApp, safeStr, hasAccess } from '../services/helpers';
import { StatusBadge, Modal, EmptyState } from '../components/SharedUI';

const types = ['Payment Reminder', 'Service Due', 'Follow-up', 'Warranty', 'Other'];
const statusOptions = ['Pending', 'Sent', 'Done'];
const PAGE_SIZE = 20;

// Q4 fix: added full CRUD (was read-only)
export default function Reminders() {
  const { reminders } = useData();
  const { role } = useAuth();
  const { toast } = useToast();
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  let filtered = reminders;
  if (filterStatus !== 'all') filtered = filtered.filter(r => r.status === filterStatus);
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(r =>
      safeStr(r.customer).toLowerCase().includes(q) ||
      safeStr(r.phone).includes(q) ||
      safeStr(r.message).toLowerCase().includes(q) ||
      safeStr(r.type).toLowerCase().includes(q)
    );
  }
  const displayed = filtered.slice(0, visibleCount);
  const hasMore = filtered.length > visibleCount;

  const handleSave = async (data, id) => {
    try {
      if (id) { await updateDocument('reminders', id, data); toast('Reminder updated'); }
      else { await addDocument('reminders', data); toast('Reminder added'); }
      setModal(null);
    } catch (e) { toast(e.message, 'er'); }
  };

  const handleDelete = async (id) => {
    if (window.confirm('Delete this reminder?')) {
      try { await deleteDocument('reminders', id); toast('Reminder deleted'); }
      catch (e) { toast(e.message, 'er'); }
    }
  };

  const markSent = async (id) => {
    try { await updateDocument('reminders', id, { status: 'Sent' }); toast('Marked as sent'); }
    catch (e) { toast(e.message, 'er'); }
  };

  return (
    <>
      <div className="tl">
        <div className="sb-x"><span className="material-icons-round">search</span><input type="text" placeholder="Search reminders..." value={search} onChange={e => setSearch(e.target.value)} /></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {['all', ...statusOptions].map(s => <span key={s} className={`fc ${filterStatus === s ? 'act' : ''}`} onClick={() => setFilterStatus(s)}>{s === 'all' ? 'All' : s}</span>)}
          </div>
          <button className="btn bp bsm" onClick={() => setModal({ data: {} })}><span className="material-icons-round" style={{ fontSize: 18 }}>add</span> Add Reminder</button>
        </div>
      </div>
      <div className="card"><div className="cb" style={{ padding: 0 }}><div className="tw"><table><thead><tr><th>Type</th><th>Customer</th><th>Phone</th><th>Date</th><th>Message</th><th>Status</th><th>Actions</th></tr></thead><tbody>
        {displayed.map(r => (
          <tr key={r.id}>
            <td style={{ fontWeight: 600 }}>{r.type}</td><td>{r.customer}</td>
            <td style={{ fontSize: '.82rem' }}>{r.phone || '-'}</td>
            <td style={{ fontSize: '.82rem' }}>{formatDate(r.date)}</td>
            <td style={{ fontSize: '.85rem' }}>{r.message}</td>
            <td><StatusBadge status={r.status} /></td>
            <td><div style={{ display: 'flex', gap: 4 }}>
              {r.status === 'Pending' && r.phone && <button className="btn bsm bs" onClick={() => { sendWhatsApp(r.phone, r.message); markSent(r.id); }}><span className="material-icons-round" style={{ fontSize: 16 }}>send</span></button>}
              <button className="btn bsm bo" onClick={() => setModal({ data: r, id: r.id })}><span className="material-icons-round" style={{ fontSize: 16 }}>edit</span></button>
              {hasAccess(role, 'admin') && <button className="btn bsm bo" onClick={() => handleDelete(r.id)} style={{ color: 'var(--err)', borderColor: 'rgba(231,76,60,.3)' }}><span className="material-icons-round" style={{ fontSize: 16 }}>delete</span></button>}
            </div></td>
          </tr>
        ))}
        {!filtered.length && <tr><td colSpan="7"><EmptyState icon="notifications_active" title="No reminders" message={search || filterStatus !== 'all' ? 'No reminders match your filters.' : 'Add reminders to stay on top of tasks.'} /></td></tr>}
      </tbody></table></div>
      {hasMore && <div style={{ textAlign: 'center', padding: 16 }}><button className="btn bsm bo" onClick={() => setVisibleCount(c => c + PAGE_SIZE)}>Show More ({filtered.length - visibleCount} remaining)</button></div>}
      </div></div>
      {modal && <ReminderModal data={modal.data} id={modal.id} onSave={handleSave} onClose={() => setModal(null)} />}
    </>
  );
}

function ReminderModal({ data, id, onSave, onClose }) {
  const [f, setF] = useState({
    type: data.type || 'Follow-up', customer: data.customer || '', phone: data.phone || '',
    date: data.date || new Date().toISOString().slice(0, 10), message: data.message || '', status: data.status || 'Pending'
  });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  return (
    <Modal title={id ? 'Edit Reminder' : 'Add Reminder'} onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); onSave(f, id); }}>
        <div className="mb">
          <div className="fr"><div className="fg"><label>Type</label><select className="fi" value={f.type} onChange={e => set('type', e.target.value)}>{types.map(t => <option key={t}>{t}</option>)}</select></div><div className="fg"><label>Status</label><select className="fi" value={f.status} onChange={e => set('status', e.target.value)}>{statusOptions.map(s => <option key={s}>{s}</option>)}</select></div></div>
          <div className="fr"><div className="fg"><label>Customer Name *</label><input className="fi" value={f.customer} onChange={e => set('customer', e.target.value)} required /></div><div className="fg"><label>Phone</label><input className="fi" value={f.phone} onChange={e => set('phone', e.target.value)} /></div></div>
          <div className="fg"><label>Date</label><input type="date" className="fi" value={f.date} onChange={e => set('date', e.target.value)} /></div>
          <div className="fg"><label>Message</label><textarea className="fi" value={f.message} onChange={e => set('message', e.target.value)} rows="3" /></div>
        </div>
        <div className="mf"><button type="button" className="btn bo" onClick={onClose}>Cancel</button><button type="submit" className="btn bp">{id ? 'Update' : 'Add'}</button></div>
      </form>
    </Modal>
  );
}
