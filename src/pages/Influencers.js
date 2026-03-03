import React, { useState } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { addDocument, updateDocument, deleteDocument } from '../services/firestore';
import { formatCurrency, formatDate, getInitials, safeStr, toNumber, hasAccess } from '../services/helpers';
import { StatusBadge, Modal, EmptyState } from '../components/SharedUI';

const influencerTypes = ['Electrician', 'Architect', 'Panchayat Member', 'Contractor', 'Other'];
const commissionTypes = ['Fixed per Lead', 'Fixed per Conversion', 'Percentage'];
const statusOptions = ['Active', 'Inactive'];

export default function Influencers() {
  const { influencers, leads, leadPOs } = useData();
  const { role } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);
  const canEdit = hasAccess(role, 'coordinator');

  let filtered = influencers;
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(i =>
      safeStr(i.name).toLowerCase().includes(q) ||
      safeStr(i.phone).includes(q) ||
      safeStr(i.area).toLowerCase().includes(q) ||
      safeStr(i.address).toLowerCase().includes(q)
    );
  }

  const getStats = (influencerId) => {
    const referred = leads.filter(l => l.referredByType === 'Influencer' && l.referredById === influencerId);
    const referredIds = referred.map(l => l.id);
    const linkedPOs = leadPOs.filter(po => referredIds.includes(po.leadId));
    const totalOrderValue = linkedPOs.reduce((s, po) => s + toNumber(po.totalValue), 0);
    return {
      totalLeads: referred.length,
      totalConversions: referred.filter(l => l.status === 'Converted').length,
      totalOrders: linkedPOs.length,
      totalOrderValue
    };
  };

  const handleSave = async (data, id) => {
    try {
      const cleaned = { ...data, commissionValue: toNumber(data.commissionValue), totalPayouts: toNumber(data.totalPayouts) };
      if (id) { await updateDocument('influencers', id, cleaned); toast('Influencer updated'); }
      else { await addDocument('influencers', cleaned); toast('Influencer added'); }
      setModal(null);
    } catch (e) { toast(e.message, 'er'); }
  };

  const handleDelete = async (id) => {
    if (window.confirm('Delete this influencer permanently?')) {
      try { await deleteDocument('influencers', id); toast('Influencer deleted'); }
      catch (e) { toast(e.message, 'er'); }
    }
  };

  return (
    <>
      <div className="tl">
        <div className="sb-x"><span className="material-icons-round">search</span><input type="text" placeholder="Search influencers..." value={search} onChange={e => setSearch(e.target.value)} /></div>
        {canEdit && <button className="btn bp bsm" onClick={() => setModal({ data: {} })}><span className="material-icons-round" style={{ fontSize: 18 }}>add</span> Add Influencer</button>}
      </div>
      {filtered.length ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 16 }}>
          {filtered.map(inf => {
            const stats = getStats(inf.id);
            return (
              <div className="card" key={inf.id}><div className="cb" style={{ textAlign: 'center', padding: 24 }}>
                <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'linear-gradient(135deg,var(--sec),var(--sec-l))', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', fontWeight: 700, margin: '0 auto 12px' }}>{getInitials(inf.name)}</div>
                <h4 style={{ fontSize: '1rem', marginBottom: 2 }}>{inf.name}</h4>
                <p style={{ fontSize: '.82rem', color: 'var(--muted)', marginBottom: 4 }}>{inf.influencerType}</p>
                <p style={{ fontSize: '.78rem', color: 'var(--muted)', marginBottom: 4 }}>{inf.area}{inf.referralCode && <> | Code: <strong>{inf.referralCode}</strong></>}</p>
                <StatusBadge status={inf.status} />
                {inf.joinedDate && <p style={{ fontSize: '.76rem', color: 'var(--muted)', marginTop: 4, marginBottom: 0 }}>Joined: {formatDate(inf.joinedDate)}</p>}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 14, textAlign: 'left' }}>
                  <div><span style={{ fontSize: '.72rem', color: 'var(--muted)', display: 'block' }}>Leads</span><span style={{ fontWeight: 600, fontSize: '.88rem' }}>{stats.totalLeads}</span></div>
                  <div><span style={{ fontSize: '.72rem', color: 'var(--muted)', display: 'block' }}>Conversions</span><span style={{ fontWeight: 600, fontSize: '.88rem' }}>{stats.totalConversions}</span></div>
                  <div><span style={{ fontSize: '.72rem', color: 'var(--muted)', display: 'block' }}>Orders</span><span style={{ fontWeight: 600, fontSize: '.88rem' }}>{stats.totalOrders}</span></div>
                  <div><span style={{ fontSize: '.72rem', color: 'var(--muted)', display: 'block' }}>Order Value</span><span style={{ fontWeight: 600, fontSize: '.88rem' }}>{formatCurrency(stats.totalOrderValue)}</span></div>
                  <div><span style={{ fontSize: '.72rem', color: 'var(--muted)', display: 'block' }}>Commission</span><span style={{ fontWeight: 600, fontSize: '.88rem' }}>{inf.commissionType === 'Percentage' ? (inf.commissionValue || 0) + '%' : formatCurrency(inf.commissionValue)}</span></div>
                  <div><span style={{ fontSize: '.72rem', color: 'var(--muted)', display: 'block' }}>Payouts</span><span style={{ fontWeight: 600, fontSize: '.88rem' }}>{formatCurrency(inf.totalPayouts)}</span></div>
                </div>
                {canEdit && <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'center' }}>
                  <button className="btn bsm bo" onClick={() => setModal({ data: inf, id: inf.id })}><span className="material-icons-round" style={{ fontSize: 16 }}>edit</span> Edit</button>
                  {hasAccess(role, 'admin') && <button className="btn bsm bo" onClick={() => handleDelete(inf.id)} style={{ color: 'var(--err)', borderColor: 'rgba(231,76,60,.3)' }}><span className="material-icons-round" style={{ fontSize: 16 }}>delete</span></button>}
                </div>}
              </div></div>
            );
          })}
        </div>
      ) : (
        <div className="card"><div className="cb"><EmptyState icon="campaign" title="No influencers" message="Add influencers to track your referral network." /></div></div>
      )}
      {modal && <InfluencerModal data={modal.data} id={modal.id} onSave={handleSave} onClose={() => setModal(null)} />}
    </>
  );
}

function InfluencerModal({ data, id, onSave, onClose }) {
  const [f, setF] = useState({
    name: data.name || '', phone: data.phone || '', email: data.email || '',
    alternateContactPerson: data.alternateContactPerson || '', alternatePhone: data.alternatePhone || '',
    address: data.address || '', joinedDate: data.joinedDate || '',
    influencerType: data.influencerType || 'Electrician',
    area: data.area || '',
    commissionType: data.commissionType || 'Fixed per Lead',
    commissionValue: data.commissionValue || '',
    status: data.status || 'Active',
    referralCode: data.referralCode || '',
    totalPayouts: data.totalPayouts || 0,
    notes: data.notes || ''
  });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  return (
    <Modal title={id ? 'Edit Influencer' : 'Add Influencer'} onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); onSave(f, id); }}>
        <div className="mb">
          <div className="fr"><div className="fg"><label>Name *</label><input className="fi" value={f.name} onChange={e => set('name', e.target.value)} required /></div><div className="fg"><label>Phone *</label><input className="fi" value={f.phone} onChange={e => set('phone', e.target.value)} required /></div></div>
          <div className="fr"><div className="fg"><label>Email</label><input type="email" className="fi" value={f.email} onChange={e => set('email', e.target.value)} /></div><div className="fg"><label>Influencer Type</label><select className="fi" value={f.influencerType} onChange={e => set('influencerType', e.target.value)}>{influencerTypes.map(t => <option key={t}>{t}</option>)}</select></div></div>
          <div className="fr"><div className="fg"><label>Alternate Contact Person</label><input className="fi" value={f.alternateContactPerson} onChange={e => set('alternateContactPerson', e.target.value)} /></div><div className="fg"><label>Alternate Phone</label><input className="fi" value={f.alternatePhone} onChange={e => set('alternatePhone', e.target.value)} /></div></div>
          <div className="fg"><label>Address</label><input className="fi" value={f.address} onChange={e => set('address', e.target.value)} /></div>
          <div className="fr"><div className="fg"><label>Area / Territory</label><input className="fi" value={f.area} onChange={e => set('area', e.target.value)} /></div><div className="fg"><label>Referral Code</label><input className="fi" value={f.referralCode} onChange={e => set('referralCode', e.target.value)} placeholder="Unique code" /></div></div>
          <div className="fg"><label>Joined Date</label><input type="date" className="fi" value={f.joinedDate} onChange={e => set('joinedDate', e.target.value)} /></div>
          <div className="fr3"><div className="fg"><label>Commission Type</label><select className="fi" value={f.commissionType} onChange={e => set('commissionType', e.target.value)}>{commissionTypes.map(t => <option key={t}>{t}</option>)}</select></div><div className="fg"><label>Commission Value</label><input type="number" className="fi" value={f.commissionValue} onChange={e => set('commissionValue', e.target.value)} /></div><div className="fg"><label>Status</label><select className="fi" value={f.status} onChange={e => set('status', e.target.value)}>{statusOptions.map(s => <option key={s}>{s}</option>)}</select></div></div>
          <div className="fg"><label>Total Payouts</label><input type="number" className="fi" value={f.totalPayouts} onChange={e => set('totalPayouts', e.target.value)} /></div>
          <div className="fg"><label>Notes</label><textarea className="fi" value={f.notes} onChange={e => set('notes', e.target.value)} rows="3" /></div>
        </div>
        <div className="mf"><button type="button" className="btn bo" onClick={onClose}>Cancel</button><button type="submit" className="btn bp">{id ? 'Update' : 'Add'} Influencer</button></div>
      </form>
    </Modal>
  );
}
