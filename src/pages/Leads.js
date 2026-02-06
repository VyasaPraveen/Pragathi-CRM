import React, { useState } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { addDocument, updateDocument, deleteDocument } from '../services/firestore';
import { formatDate, safeStr } from '../services/helpers';
import { StatusBadge, Modal, EmptyState } from '../components/SharedUI';

const refs = ['Website', 'Referral', 'Walk-in', 'Facebook Ad', 'Google Ad', 'Other'];
const fups = ['New Lead', 'Interested', 'Follow-up', 'Negotiating', 'No Response', 'Completed'];
const sts = ['Interested', 'Not Interested', 'Converted', 'Not Converted'];
const PAGE_SIZE = 20;

export default function Leads() {
  const { leads } = useData();
  const { role } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [modal, setModal] = useState(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  let filtered = leads;
  if (filter !== 'all') filtered = filtered.filter(l => l.status === filter);
  // B4 fix: null-safe search using safeStr
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(l =>
      safeStr(l.name).toLowerCase().includes(q) ||
      safeStr(l.phone).includes(q) ||
      safeStr(l.address).toLowerCase().includes(q)
    );
  }

  // P2 fix: client-side pagination
  const displayed = filtered.slice(0, visibleCount);
  const hasMore = filtered.length > visibleCount;

  const handleSave = async (data, id, prevStatus) => {
    try {
      if (id) {
        await updateDocument('leads', id, data);
        toast('Lead updated');
      } else {
        await addDocument('leads', data);
        toast('Lead added');
      }
      // B1 fix: only auto-create customer on FIRST conversion, not every save
      if (data.advancePaid === 'Yes' && data.status === 'Converted' && prevStatus !== 'Converted') {
        await addDocument('customers', {
          name: data.name, phone: data.phone, address: data.address,
          advanceAmount: 0, secondPayment: 0, thirdPayment: 0, finalPayment: 0,
          totalPrice: 0, paymentType: 'Cash', agreedPrice: 0, bosAmount: 0,
          kwRequired: '', status: 'Active'
        });
        toast(data.name + ' auto-added to Customers!');
      }
      setModal(null);
    } catch (e) { toast(e.message, 'er'); }
  };

  // B2 fix: added try/catch to handleDelete
  const handleDelete = async (id) => {
    if (window.confirm('Delete this lead permanently?')) {
      try {
        await deleteDocument('leads', id);
        toast('Lead deleted');
      } catch (e) { toast(e.message, 'er'); }
    }
  };

  return (
    <>
      <div className="tl">
        <div className="sb-x"><span className="material-icons-round">search</span><input type="text" placeholder="Search leads..." value={search} onChange={e => setSearch(e.target.value)} /></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {['all', ...sts].map(s => <span key={s} className={`fc ${filter === s ? 'act' : ''}`} onClick={() => setFilter(s)}>{s === 'all' ? 'All' : s}</span>)}
          </div>
          <button className="btn bp bsm" onClick={() => setModal({ data: {} })}><span className="material-icons-round" style={{ fontSize: 18 }}>add</span> Add Lead</button>
        </div>
      </div>
      <div className="card"><div className="cb" style={{ padding: 0 }}><div className="tw"><table><thead><tr><th>Name / Phone</th><th>Address</th><th>Source</th><th>Site Visit</th><th>Quotation</th><th>Advance</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead><tbody>
        {displayed.map(l => (
          <tr key={l.id}>
            <td><strong>{l.name}</strong><br /><span style={{ fontSize: '.78rem', color: 'var(--muted)' }}>{l.phone}</span></td>
            <td style={{ maxWidth: 160, fontSize: '.82rem' }}>{l.address}</td>
            <td style={{ fontSize: '.82rem' }}>{l.leadReference || '-'}</td>
            <td>{l.siteVisit === 'Yes' ? <span className="st st-g">Done</span> : <span className="st st-x">No</span>}</td>
            <td>{l.quotationSent === 'Yes' ? <span className="st st-g">Sent</span> : <span className="st st-x">No</span>}</td>
            <td>{l.advancePaid === 'Yes' ? <span className="st st-g">Paid</span> : <span className="st st-x">No</span>}</td>
            <td><StatusBadge status={l.status} /></td>
            <td style={{ fontSize: '.82rem' }}>{formatDate(l.dateGenerated)}</td>
            <td><div style={{ display: 'flex', gap: 4 }}>
              <button className="btn bsm bo" onClick={() => setModal({ data: l, id: l.id })}><span className="material-icons-round" style={{ fontSize: 16 }}>edit</span></button>
              {role === 'admin' && <button className="btn bsm bo" onClick={() => handleDelete(l.id)} style={{ color: 'var(--err)', borderColor: 'rgba(231,76,60,.3)' }}><span className="material-icons-round" style={{ fontSize: 16 }}>delete</span></button>}
            </div></td>
          </tr>
        ))}
        {!filtered.length && <tr><td colSpan="9"><EmptyState icon="search_off" title="No leads found" message="Try adjusting filters or add a new lead." /></td></tr>}
      </tbody></table></div>
      {hasMore && <div style={{ textAlign: 'center', padding: 16 }}><button className="btn bsm bo" onClick={() => setVisibleCount(c => c + PAGE_SIZE)}>Show More ({filtered.length - visibleCount} remaining)</button></div>}
      </div></div>
      {modal && <LeadModal data={modal.data} id={modal.id} onSave={handleSave} onClose={() => setModal(null)} />}
    </>
  );
}

function LeadModal({ data, id, onSave, onClose }) {
  // B1 fix: track previous status to detect first conversion
  const prevStatus = data.status;
  const [form, setForm] = useState({
    name: data.name || '', phone: data.phone || '', address: data.address || '',
    leadReference: data.leadReference || 'Website', dateGenerated: data.dateGenerated || new Date().toISOString().slice(0, 10),
    lastFollowUp: data.lastFollowUp || '', followUpStatus: data.followUpStatus || 'New Lead',
    siteVisit: data.siteVisit || 'No', quotationSent: data.quotationSent || 'No',
    advancePaid: data.advancePaid || 'No', status: data.status || 'Interested'
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  return (
    <Modal title={id ? 'Edit Lead' : 'Add New Lead'} onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); onSave(form, id, prevStatus); }}>
        <div className="mb">
          <div className="fr"><div className="fg"><label>Full Name *</label><input className="fi" value={form.name} onChange={e => set('name', e.target.value)} required /></div><div className="fg"><label>Phone *</label><input className="fi" value={form.phone} onChange={e => set('phone', e.target.value)} required /></div></div>
          <div className="fg"><label>Address</label><input className="fi" value={form.address} onChange={e => set('address', e.target.value)} /></div>
          <div className="fr"><div className="fg"><label>Lead Reference</label><select className="fi" value={form.leadReference} onChange={e => set('leadReference', e.target.value)}>{refs.map(o => <option key={o}>{o}</option>)}</select></div><div className="fg"><label>Date Generated</label><input type="date" className="fi" value={form.dateGenerated} onChange={e => set('dateGenerated', e.target.value)} /></div></div>
          <div className="fr"><div className="fg"><label>Last Follow-up</label><input type="date" className="fi" value={form.lastFollowUp} onChange={e => set('lastFollowUp', e.target.value)} /></div><div className="fg"><label>Follow-up Status</label><select className="fi" value={form.followUpStatus} onChange={e => set('followUpStatus', e.target.value)}>{fups.map(o => <option key={o}>{o}</option>)}</select></div></div>
          <div className="fr3"><div className="fg"><label>Site Visit</label><select className="fi" value={form.siteVisit} onChange={e => set('siteVisit', e.target.value)}><option>No</option><option>Yes</option></select></div><div className="fg"><label>Quotation Sent</label><select className="fi" value={form.quotationSent} onChange={e => set('quotationSent', e.target.value)}><option>No</option><option>Yes</option></select></div><div className="fg"><label>Advance Paid</label><select className="fi" value={form.advancePaid} onChange={e => set('advancePaid', e.target.value)}><option>No</option><option>Yes</option></select></div></div>
          <div className="fg"><label>Lead Status</label><select className="fi" value={form.status} onChange={e => set('status', e.target.value)}>{sts.map(o => <option key={o}>{o}</option>)}</select></div>
        </div>
        <div className="mf"><button type="button" className="btn bo" onClick={onClose}>Cancel</button><button type="submit" className="btn bp">{id ? 'Update' : 'Add'} Lead</button></div>
      </form>
    </Modal>
  );
}
