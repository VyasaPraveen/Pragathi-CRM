import React, { useState } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { addDocument, updateDocument, deleteDocument } from '../services/firestore';
import { formatCurrency, formatDate, getInitials, safeStr, toNumber } from '../services/helpers';
import { StatusBadge, Modal, EmptyState } from '../components/SharedUI';
import { storage } from '../services/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

const retailerTypes = ['Dealer', 'Distributor', 'Channel Partner', 'Other'];
const commissionTypes = ['Fixed', 'Percentage'];
const statusOptions = ['Active', 'Inactive'];

export default function Retailers() {
  const { retailers, leads, leadPOs } = useData();
  const { role } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const canEdit = role === 'admin' || role === 'manager';

  let filtered = retailers;
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(r =>
      safeStr(r.name).toLowerCase().includes(q) ||
      safeStr(r.firmName).toLowerCase().includes(q) ||
      safeStr(r.phone).includes(q) ||
      safeStr(r.territory).toLowerCase().includes(q)
    );
  }

  const getStats = (retailerId) => {
    const referred = leads.filter(l => l.referredByType === 'Retailer' && l.referredById === retailerId);
    const referredIds = referred.map(l => l.id);
    const linkedPOs = leadPOs.filter(po => referredIds.includes(po.leadId));
    const totalOrderValue = linkedPOs.reduce((s, po) => s + toNumber(po.totalValue), 0);
    const allItems = linkedPOs.flatMap(po => (po.items || []).map(it => ({ ...it, poNumber: po.poNumber, poDate: po.poDate })));
    return {
      totalLeads: referred.length,
      totalConversions: referred.filter(l => l.status === 'Converted').length,
      totalOrders: linkedPOs.length,
      totalOrderValue,
      materials: allItems
    };
  };

  const handleSave = async (data, id) => {
    try {
      const cleaned = { ...data, commissionValue: toNumber(data.commissionValue), totalPayouts: toNumber(data.totalPayouts), capitalAmount: toNumber(data.capitalAmount) };
      if (id) { await updateDocument('retailers', id, cleaned); toast('Retailer updated'); }
      else { await addDocument('retailers', cleaned); toast('Retailer added'); }
      setModal(null);
    } catch (e) { toast(e.message, 'er'); }
  };

  const handleDelete = async (id) => {
    if (window.confirm('Delete this retailer permanently?')) {
      try { await deleteDocument('retailers', id); toast('Retailer deleted'); }
      catch (e) { toast(e.message, 'er'); }
    }
  };

  const detailRetailer = detailId ? retailers.find(r => r.id === detailId) : null;

  return (
    <>
      <div className="tl">
        <div className="sb-x"><span className="material-icons-round">search</span><input type="text" placeholder="Search retailers..." value={search} onChange={e => setSearch(e.target.value)} /></div>
        {canEdit && <button className="btn bp bsm" onClick={() => setModal({ data: {} })}><span className="material-icons-round" style={{ fontSize: 18 }}>add</span> Add Retailer</button>}
      </div>
      {filtered.length ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 16 }}>
          {filtered.map(r => {
            const stats = getStats(r.id);
            return (
              <div className="card" key={r.id}><div className="cb" style={{ textAlign: 'center', padding: 24 }}>
                <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'linear-gradient(135deg,var(--pri),var(--pri-l))', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', fontWeight: 700, margin: '0 auto 12px' }}>{getInitials(r.name)}</div>
                <h4 style={{ fontSize: '1rem', marginBottom: 2 }}>{r.name}</h4>
                {r.firmName && <p style={{ fontSize: '.84rem', color: 'var(--txt)', marginBottom: 2 }}>{r.firmName}</p>}
                {r.contactPerson && <p style={{ fontSize: '.82rem', color: 'var(--muted)', marginBottom: 4 }}>{r.contactPerson}</p>}
                <p style={{ fontSize: '.78rem', color: 'var(--muted)', marginBottom: 8 }}>{r.retailerType}{r.territory && <> | {r.territory}</>}</p>
                <StatusBadge status={r.status} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 14, textAlign: 'left' }}>
                  <div><span style={{ fontSize: '.72rem', color: 'var(--muted)', display: 'block' }}>Leads</span><span style={{ fontWeight: 600, fontSize: '.88rem' }}>{stats.totalLeads}</span></div>
                  <div><span style={{ fontSize: '.72rem', color: 'var(--muted)', display: 'block' }}>Conversions</span><span style={{ fontWeight: 600, fontSize: '.88rem' }}>{stats.totalConversions}</span></div>
                  <div><span style={{ fontSize: '.72rem', color: 'var(--muted)', display: 'block' }}>Orders</span><span style={{ fontWeight: 600, fontSize: '.88rem' }}>{stats.totalOrders}</span></div>
                  <div><span style={{ fontSize: '.72rem', color: 'var(--muted)', display: 'block' }}>Order Value</span><span style={{ fontWeight: 600, fontSize: '.88rem' }}>{formatCurrency(stats.totalOrderValue)}</span></div>
                  <div><span style={{ fontSize: '.72rem', color: 'var(--muted)', display: 'block' }}>Commission</span><span style={{ fontWeight: 600, fontSize: '.88rem' }}>{r.commissionType === 'Percentage' ? (r.commissionValue || 0) + '%' : formatCurrency(r.commissionValue)}</span></div>
                  <div><span style={{ fontSize: '.72rem', color: 'var(--muted)', display: 'block' }}>Payouts</span><span style={{ fontWeight: 600, fontSize: '.88rem' }}>{formatCurrency(r.totalPayouts)}</span></div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'center' }}>
                  <button className="btn bsm bo" onClick={() => setDetailId(r.id)} title="View Details"><span className="material-icons-round" style={{ fontSize: 16 }}>visibility</span></button>
                  {canEdit && <button className="btn bsm bo" onClick={() => setModal({ data: r, id: r.id })}><span className="material-icons-round" style={{ fontSize: 16 }}>edit</span> Edit</button>}
                  {role === 'admin' && <button className="btn bsm bo" onClick={() => handleDelete(r.id)} style={{ color: 'var(--err)', borderColor: 'rgba(231,76,60,.3)' }}><span className="material-icons-round" style={{ fontSize: 16 }}>delete</span></button>}
                </div>
              </div></div>
            );
          })}
        </div>
      ) : (
        <div className="card"><div className="cb"><EmptyState icon="storefront" title="No retailers" message="Add retailers to manage your channel partners." /></div></div>
      )}
      {modal && <RetailerModal data={modal.data} id={modal.id} onSave={handleSave} onClose={() => setModal(null)} />}
      {detailRetailer && <RetailerDetail retailer={detailRetailer} stats={getStats(detailRetailer.id)} onClose={() => setDetailId(null)} />}
    </>
  );
}

/* ============ EDIT MODAL ============ */
function RetailerModal({ data, id, onSave, onClose }) {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [f, setF] = useState({
    name: data.name || '', firmName: data.firmName || '', firmGst: data.firmGst || '',
    contactPerson: data.contactPerson || '', alternatePhone: data.alternatePhone || '',
    phone: data.phone || '', email: data.email || '', address: data.address || '',
    retailerType: data.retailerType || 'Dealer',
    commissionType: data.commissionType || 'Fixed',
    commissionValue: data.commissionValue || '',
    territory: data.territory || '', status: data.status || 'Active',
    agreementDetails: data.agreementDetails || '',
    totalPayouts: data.totalPayouts || 0,
    mouUrl: data.mouUrl || '',
    joinedDate: data.joinedDate || '',
    capitalAmount: data.capitalAmount || '',
    amountPaidDate: data.amountPaidDate || ''
  });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  const handleMouUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast('File too large (max 10MB)', 'er'); return; }
    setUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const fileName = 'mou_' + (f.name || 'retailer').replace(/\s+/g, '_') + '_' + Date.now() + '.' + ext;
      const storageRef = ref(storage, 'mou/' + fileName);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      set('mouUrl', url);
      toast('MOU uploaded');
    } catch (err) { toast('Upload failed: ' + err.message, 'er'); }
    setUploading(false);
  };

  return (
    <Modal title={id ? 'Edit Retailer' : 'Add Retailer'} onClose={onClose} wide>
      <form onSubmit={e => { e.preventDefault(); onSave(f, id); }}>
        <div className="mb">
          <div className="fr"><div className="fg"><label>Name *</label><input className="fi" value={f.name} onChange={e => set('name', e.target.value)} required /></div><div className="fg"><label>Firm Name</label><input className="fi" value={f.firmName} onChange={e => set('firmName', e.target.value)} /></div></div>
          <div className="fr"><div className="fg"><label>Firm GST</label><input className="fi" value={f.firmGst} onChange={e => set('firmGst', e.target.value)} placeholder="e.g. 36AABCU9603R1ZM" /></div><div className="fg"><label>Address</label><input className="fi" value={f.address} onChange={e => set('address', e.target.value)} /></div></div>
          <div className="fr"><div className="fg"><label>Phone *</label><input className="fi" value={f.phone} onChange={e => set('phone', e.target.value)} required /></div><div className="fg"><label>Email</label><input type="email" className="fi" value={f.email} onChange={e => set('email', e.target.value)} /></div></div>
          <div className="fr"><div className="fg"><label>Alternate Contact Person</label><input className="fi" value={f.contactPerson} onChange={e => set('contactPerson', e.target.value)} /></div><div className="fg"><label>Alternate Phone</label><input className="fi" value={f.alternatePhone} onChange={e => set('alternatePhone', e.target.value)} /></div></div>
          <div className="fr3"><div className="fg"><label>Type</label><select className="fi" value={f.retailerType} onChange={e => set('retailerType', e.target.value)}>{retailerTypes.map(t => <option key={t}>{t}</option>)}</select></div><div className="fg"><label>Commission Type</label><select className="fi" value={f.commissionType} onChange={e => set('commissionType', e.target.value)}>{commissionTypes.map(t => <option key={t}>{t}</option>)}</select></div><div className="fg"><label>Commission Value</label><input type="number" className="fi" value={f.commissionValue} onChange={e => set('commissionValue', e.target.value)} /></div></div>
          <div className="fr"><div className="fg"><label>Territory / Area</label><input className="fi" value={f.territory} onChange={e => set('territory', e.target.value)} /></div><div className="fg"><label>Status</label><select className="fi" value={f.status} onChange={e => set('status', e.target.value)}>{statusOptions.map(s => <option key={s}>{s}</option>)}</select></div></div>

          {/* Dates & Financial */}
          <div style={{ borderTop: '1px solid var(--bor)', margin: '14px 0', paddingTop: 14 }}>
            <label style={{ fontWeight: 700, fontSize: '.9rem', marginBottom: 10, display: 'block' }}>Dates & Financial</label>
            <div className="fr3"><div className="fg"><label>Joined Date</label><input type="date" className="fi" value={f.joinedDate} onChange={e => set('joinedDate', e.target.value)} /></div><div className="fg"><label>Capital Amount</label><input type="number" className="fi" value={f.capitalAmount} onChange={e => set('capitalAmount', e.target.value)} /></div><div className="fg"><label>Amount Paid Date</label><input type="date" className="fi" value={f.amountPaidDate} onChange={e => set('amountPaidDate', e.target.value)} /></div></div>
            <div className="fg"><label>Total Payouts</label><input type="number" className="fi" value={f.totalPayouts} onChange={e => set('totalPayouts', e.target.value)} /></div>
          </div>

          {/* MOU Upload */}
          <div style={{ borderTop: '1px solid var(--bor)', margin: '14px 0', paddingTop: 14 }}>
            <label style={{ fontWeight: 700, fontSize: '.9rem', marginBottom: 10, display: 'block' }}>MOU Document</label>
            <div className="fg">
              <label>Upload MOU Copy</label>
              <input type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={handleMouUpload} disabled={uploading} style={{ fontSize: '.85rem' }} />
              {uploading && <p style={{ fontSize: '.82rem', color: 'var(--pri)', marginTop: 4 }}>Uploading...</p>}
            </div>
            {f.mouUrl && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                <span className="material-icons-round" style={{ fontSize: 18, color: 'var(--ok)' }}>check_circle</span>
                <a href={f.mouUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '.84rem', color: 'var(--pri)' }}>View Uploaded MOU</a>
                <button type="button" className="btn bsm bo" onClick={() => set('mouUrl', '')} style={{ color: 'var(--err)', marginLeft: 'auto', padding: '2px 6px' }}><span className="material-icons-round" style={{ fontSize: 14 }}>close</span></button>
              </div>
            )}
          </div>

          <div className="fg"><label>Agreement Details</label><textarea className="fi" value={f.agreementDetails} onChange={e => set('agreementDetails', e.target.value)} rows="3" /></div>
        </div>
        <div className="mf"><button type="button" className="btn bo" onClick={onClose}>Cancel</button><button type="submit" className="btn bp" disabled={uploading}>{id ? 'Update' : 'Add'} Retailer</button></div>
      </form>
    </Modal>
  );
}

/* ============ DETAIL MODAL (read-only metrics + materials history) ============ */
function RetailerDetail({ retailer, stats, onClose }) {
  const r = retailer;

  return (
    <div className="mo" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="md" style={{ width: '760px', maxWidth: '96vw' }}>
        <div className="mh">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="material-icons-round" style={{ fontSize: 22, color: 'var(--pri)' }}>storefront</span>
            {r.name}
            {r.firmName && <span style={{ fontSize: '.85rem', fontWeight: 400, color: 'var(--muted)' }}>({r.firmName})</span>}
          </h3>
          <button className="mx" onClick={onClose}><span className="material-icons-round">close</span></button>
        </div>

        <div style={{ padding: 24, maxHeight: '70vh', overflowY: 'auto' }}>
          {/* Info Grid */}
          <div className="dg">
            <div className="di"><div className="dl">Phone</div><div className="dv">{r.phone || '-'}</div></div>
            <div className="di"><div className="dl">Email</div><div className="dv">{r.email || '-'}</div></div>
            <div className="di"><div className="dl">Firm GST</div><div className="dv">{r.firmGst || '-'}</div></div>
            <div className="di"><div className="dl">Address</div><div className="dv">{r.address || '-'}</div></div>
            <div className="di"><div className="dl">Alternate Contact</div><div className="dv">{r.contactPerson || '-'}{r.alternatePhone && <> | {r.alternatePhone}</>}</div></div>
            <div className="di"><div className="dl">Type</div><div className="dv"><StatusBadge status={r.retailerType} /></div></div>
            <div className="di"><div className="dl">Territory</div><div className="dv">{r.territory || '-'}</div></div>
            <div className="di"><div className="dl">Status</div><div className="dv"><StatusBadge status={r.status} /></div></div>
            <div className="di"><div className="dl">Joined Date</div><div className="dv">{formatDate(r.joinedDate)}</div></div>
            <div className="di"><div className="dl">Capital Amount</div><div className="dv">{r.capitalAmount ? formatCurrency(r.capitalAmount) : '-'}</div></div>
            <div className="di"><div className="dl">Amount Paid Date</div><div className="dv">{formatDate(r.amountPaidDate)}</div></div>
            <div className="di"><div className="dl">Commission</div><div className="dv">{r.commissionType === 'Percentage' ? (r.commissionValue || 0) + '%' : formatCurrency(r.commissionValue)} ({r.commissionType})</div></div>
            {r.mouUrl && <div className="di"><div className="dl">MOU</div><div className="dv"><a href={r.mouUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--pri)', fontSize: '.84rem' }}>View MOU Document</a></div></div>}
          </div>

          {/* Auto Metrics */}
          <div style={{ borderTop: '1px solid var(--bor)', margin: '20px 0', paddingTop: 16 }}>
            <label style={{ fontWeight: 700, fontSize: '.9rem', marginBottom: 12, display: 'block' }}>Performance Metrics</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 12 }}>
              {[
                ['Leads Referred', stats.totalLeads, 'group'],
                ['Conversions', stats.totalConversions, 'check_circle'],
                ['Total Orders', stats.totalOrders, 'receipt_long'],
                ['Order Value', formatCurrency(stats.totalOrderValue), 'payments'],
                ['Payouts', formatCurrency(r.totalPayouts), 'account_balance']
              ].map(([label, value, icon]) => (
                <div key={label} style={{ background: 'rgba(26,58,122,.04)', borderRadius: 10, padding: 14, textAlign: 'center' }}>
                  <span className="material-icons-round" style={{ fontSize: 22, color: 'var(--pri)', display: 'block', marginBottom: 4 }}>{icon}</span>
                  <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{value}</div>
                  <div style={{ fontSize: '.72rem', color: 'var(--muted)' }}>{label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Purchased Materials History */}
          <div style={{ borderTop: '1px solid var(--bor)', margin: '20px 0', paddingTop: 16 }}>
            <label style={{ fontWeight: 700, fontSize: '.9rem', marginBottom: 12, display: 'block' }}>Purchased Materials History</label>
            {stats.materials.length > 0 ? (
              <div className="tw">
                <table>
                  <thead><tr><th>#</th><th>PO #</th><th>PO Date</th><th>Material</th><th>Qty</th><th>Unit</th><th>Rate</th><th>Amount</th></tr></thead>
                  <tbody>
                    {stats.materials.map((m, i) => (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        <td style={{ fontWeight: 600, fontSize: '.82rem' }}>{m.poNumber || '-'}</td>
                        <td style={{ fontSize: '.82rem' }}>{formatDate(m.poDate)}</td>
                        <td>{m.materialName}</td>
                        <td>{m.quantity}</td>
                        <td>{m.unit || '-'}</td>
                        <td>{formatCurrency(m.rate)}</td>
                        <td style={{ fontWeight: 600 }}>{formatCurrency(m.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState icon="inventory_2" title="No materials yet" message="Materials will appear here once orders are placed for leads referred by this retailer." />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
