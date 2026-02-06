import React, { useState } from 'react';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { addDocument, updateDocument } from '../services/firestore';
import { formatCurrency, safeStr, toNumber } from '../services/helpers';
import { StatusBadge, Modal, EmptyState } from '../components/SharedUI';

const PAGE_SIZE = 20;

export default function Customers() {
  const { customers } = useData();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  let filtered = customers;
  // B4 fix: null-safe search
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(c =>
      safeStr(c.name).toLowerCase().includes(q) ||
      safeStr(c.phone).includes(q)
    );
  }

  const displayed = filtered.slice(0, visibleCount);
  const hasMore = filtered.length > visibleCount;

  const handleSave = async (data, id) => {
    try {
      // D1 fix: convert all numeric fields before saving to Firestore
      const numericFields = ['agreedPrice', 'bosAmount', 'totalPrice', 'advanceAmount', 'secondPayment', 'thirdPayment', 'finalPayment'];
      const cleaned = { ...data };
      numericFields.forEach(f => { cleaned[f] = toNumber(cleaned[f]); });

      if (id) { await updateDocument('customers', id, cleaned); toast('Customer updated'); }
      else { await addDocument('customers', { ...cleaned, status: 'Active' }); toast('Customer added'); }
      setModal(null);
    } catch (e) { toast(e.message, 'er'); }
  };

  return (
    <>
      <div className="tl">
        <div className="sb-x"><span className="material-icons-round">search</span><input type="text" placeholder="Search customers..." value={search} onChange={e => setSearch(e.target.value)} /></div>
        <button className="btn bp bsm" onClick={() => setModal({ data: {} })}><span className="material-icons-round" style={{ fontSize: 18 }}>add</span> Add Customer</button>
      </div>
      <div className="card"><div className="cb" style={{ padding: 0 }}><div className="tw"><table><thead><tr><th>Customer</th><th>kW</th><th>Payment</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th><th>Actions</th></tr></thead><tbody>
        {displayed.map(c => {
          const paid = toNumber(c.advanceAmount) + toNumber(c.secondPayment) + toNumber(c.thirdPayment) + toNumber(c.finalPayment);
          const bal = toNumber(c.totalPrice) - paid;
          return (
            <tr key={c.id}>
              <td><strong>{c.name}</strong><br /><span style={{ fontSize: '.78rem', color: 'var(--muted)' }}>{c.phone}</span></td>
              <td>{c.kwRequired || '-'}</td>
              <td><span className={`st ${c.paymentType === 'Finance' ? 'st-b' : 'st-g'}`}>{c.paymentType}</span></td>
              <td style={{ fontWeight: 600 }}>{formatCurrency(c.totalPrice)}</td>
              <td style={{ color: 'var(--ok)', fontWeight: 600 }}>{formatCurrency(paid)}</td>
              <td style={{ color: bal > 0 ? 'var(--err)' : 'var(--ok)', fontWeight: 600 }}>{formatCurrency(bal)}</td>
              <td><StatusBadge status={c.status} /></td>
              <td><button className="btn bsm bo" onClick={() => setModal({ data: c, id: c.id })}><span className="material-icons-round" style={{ fontSize: 16 }}>edit</span></button></td>
            </tr>
          );
        })}
        {!filtered.length && <tr><td colSpan="8"><EmptyState icon="people" title="No customers yet" message="Convert leads or add customers directly." /></td></tr>}
      </tbody></table></div>
      {hasMore && <div style={{ textAlign: 'center', padding: 16 }}><button className="btn bsm bo" onClick={() => setVisibleCount(c => c + PAGE_SIZE)}>Show More ({filtered.length - visibleCount} remaining)</button></div>}
      </div></div>
      {modal && <CustomerModal data={modal.data} id={modal.id} onSave={handleSave} onClose={() => setModal(null)} />}
    </>
  );
}

function CustomerModal({ data, id, onSave, onClose }) {
  const [f, setF] = useState({
    name: data.name || '', phone: data.phone || '', address: data.address || '',
    kwRequired: data.kwRequired || '', paymentType: data.paymentType || 'Cash',
    agreedPrice: data.agreedPrice || 0, bosAmount: data.bosAmount || 0, totalPrice: data.totalPrice || 0,
    advanceAmount: data.advanceAmount || 0, secondPayment: data.secondPayment || 0,
    thirdPayment: data.thirdPayment || 0, finalPayment: data.finalPayment || 0, bankName: data.bankName || ''
  });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  return (
    <Modal title={id ? 'Edit Customer' : 'Add Customer'} onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); onSave(f, id); }}>
        <div className="mb">
          <div className="fr"><div className="fg"><label>Name *</label><input className="fi" value={f.name} onChange={e => set('name', e.target.value)} required /></div><div className="fg"><label>Phone *</label><input className="fi" value={f.phone} onChange={e => set('phone', e.target.value)} required /></div></div>
          <div className="fg"><label>Address</label><input className="fi" value={f.address} onChange={e => set('address', e.target.value)} /></div>
          <div className="fr"><div className="fg"><label>Required kW</label><input className="fi" value={f.kwRequired} onChange={e => set('kwRequired', e.target.value)} /></div><div className="fg"><label>Payment Type</label><select className="fi" value={f.paymentType} onChange={e => set('paymentType', e.target.value)}><option>Cash</option><option>Finance</option></select></div></div>
          <div className="fr3"><div className="fg"><label>Agreed Price</label><input type="number" className="fi" value={f.agreedPrice} onChange={e => set('agreedPrice', e.target.value)} /></div><div className="fg"><label>BOS Amount</label><input type="number" className="fi" value={f.bosAmount} onChange={e => set('bosAmount', e.target.value)} /></div><div className="fg"><label>Total Price</label><input type="number" className="fi" value={f.totalPrice} onChange={e => set('totalPrice', e.target.value)} /></div></div>
          <div style={{ borderTop: '1px solid var(--bor)', margin: '14px 0', paddingTop: 14 }}><label style={{ fontWeight: 700, fontSize: '.9rem', marginBottom: 10, display: 'block' }}>Payment Tracking</label>
            <div className="fr"><div className="fg"><label>Advance</label><input type="number" className="fi" value={f.advanceAmount} onChange={e => set('advanceAmount', e.target.value)} /></div><div className="fg"><label>2nd Payment</label><input type="number" className="fi" value={f.secondPayment} onChange={e => set('secondPayment', e.target.value)} /></div></div>
            <div className="fr"><div className="fg"><label>3rd Payment</label><input type="number" className="fi" value={f.thirdPayment} onChange={e => set('thirdPayment', e.target.value)} /></div><div className="fg"><label>Final Payment</label><input type="number" className="fi" value={f.finalPayment} onChange={e => set('finalPayment', e.target.value)} /></div></div>
          </div>
          <div className="fg"><label>Bank Name (if Finance)</label><input className="fi" value={f.bankName} onChange={e => set('bankName', e.target.value)} /></div>
        </div>
        <div className="mf"><button type="button" className="btn bo" onClick={onClose}>Cancel</button><button type="submit" className="btn bp">{id ? 'Update' : 'Add'}</button></div>
      </form>
    </Modal>
  );
}
