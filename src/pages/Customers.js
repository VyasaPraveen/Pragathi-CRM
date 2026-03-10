import React, { useState } from 'react';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { addDocument, updateDocument, createNotification, notifyAdmins } from '../services/firestore';
import { formatCurrency, formatDate, safeStr, toNumber, sendWhatsApp, escapeHtml, hasAccess, makeCall } from '../services/helpers';
import { useAuth } from '../context/AuthContext';
import { StatusBadge, Modal, EmptyState } from '../components/SharedUI';
import { printPO, downloadPO, printBOM, downloadBOM, sharePOWhatsApp } from '../services/poUtils';

const PAGE_SIZE = 20;
const customerTypes = ['Residential', 'Commercial', 'Industrial', 'Other'];
const phases = ['Single Phase', 'Three Phase'];

export default function Customers() {
  const { customers, leadPOs, installations, leads, users } = useData();
  const { role } = useAuth();
  const { toast } = useToast();
  const canEdit = hasAccess(role, 'coordinator');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [areaFilter, setAreaFilter] = useState('all');
  const [modal, setModal] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Unique areas for filter dropdown
  const areas = [...new Set(customers.map(c => c.area).filter(Boolean))].sort();

  let filtered = customers;
  if (typeFilter !== 'all') filtered = filtered.filter(c => c.customerType === typeFilter);
  if (areaFilter !== 'all') filtered = filtered.filter(c => c.area === areaFilter);
  // B4 fix: null-safe search
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(c =>
      safeStr(c.name).toLowerCase().includes(q) ||
      safeStr(c.phone).includes(q) ||
      safeStr(c.email).toLowerCase().includes(q) ||
      safeStr(c.area).toLowerCase().includes(q) ||
      safeStr(c.pincode).includes(q)
    );
  }

  const displayed = filtered.slice(0, visibleCount);
  const hasMore = filtered.length > visibleCount;

  const handleSave = async (data, id) => {
    try {
      // D1 fix: convert all numeric fields before saving to Firestore
      const numericFields = ['agreedPrice', 'bosAmount', 'totalPrice', 'advanceAmount', 'secondPayment', 'thirdPayment', 'finalPayment', 'quotationProjectValue', 'advanceReceivedAmount', 'finalAmount'];
      const cleaned = { ...data };
      numericFields.forEach(f => { cleaned[f] = toNumber(cleaned[f]); });

      if (id) {
        const prevCustomer = customers.find(c => c.id === id);
        await updateDocument('customers', id, cleaned);
        toast('Customer updated');
        // Notify admins about customer update
        notifyAdmins(users, { title: 'Customer Updated', message: `Customer "${cleaned.name}" has been updated`, type: 'customer', module: 'customers', relatedId: id });
        // Notify assigned user if assignment changed
        if (cleaned.assignedTo && cleaned.assignedTo !== (prevCustomer?.assignedTo || '')) {
          createNotification({ forUser: cleaned.assignedTo, title: 'Customer Assigned to You', message: `Customer "${cleaned.name}" has been assigned to you`, type: 'customer', module: 'customers', relatedId: id });
        }
      } else {
        const newId = await addDocument('customers', { ...cleaned, status: 'Active' });
        toast('Customer added');
        notifyAdmins(users, { title: 'New Customer Added', message: `New customer "${cleaned.name}" added`, type: 'customer', module: 'customers', relatedId: newId });
        if (cleaned.assignedTo) {
          createNotification({ forUser: cleaned.assignedTo, title: 'New Customer Assigned', message: `Customer "${cleaned.name}" has been assigned to you`, type: 'customer', module: 'customers', relatedId: newId });
        }
      }
      setModal(null);
    } catch (e) { toast(e.message, 'er'); }
  };

  return (
    <>
      <div className="tl">
        <div className="sb-x"><span className="material-icons-round">search</span><input type="text" placeholder="Search customers..." value={search} onChange={e => setSearch(e.target.value)} /></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {['all', ...customerTypes].map(t => <span key={t} className={`fc ${typeFilter === t ? 'act' : ''}`} onClick={() => setTypeFilter(t)}>{t === 'all' ? 'All Types' : t}</span>)}
          </div>
          {areas.length > 0 && (
            <select className="fi" style={{ width: 'auto', padding: '6px 30px 6px 10px', fontSize: '.82rem' }} value={areaFilter} onChange={e => setAreaFilter(e.target.value)}>
              <option value="all">All Areas</option>
              {areas.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
          {canEdit && <button className="btn bp bsm" onClick={() => setModal({ data: {} })}><span className="material-icons-round" style={{ fontSize: 18 }}>add</span> Add Customer</button>}
        </div>
      </div>
      <div className="card"><div className="cb" style={{ padding: 0 }}><div className="tw"><table><thead><tr><th>Customer</th><th>Type</th><th>kW</th><th>Payment</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th><th>Installation</th><th>Actions</th></tr></thead><tbody>
        {displayed.map(c => {
          const paid = c.paymentType === 'Finance'
            ? toNumber(c.advanceReceivedAmount) + toNumber(c.finalAmount)
            : toNumber(c.advanceAmount) + toNumber(c.secondPayment) + toNumber(c.thirdPayment) + toNumber(c.finalPayment);
          const bal = toNumber(c.totalPrice) - paid;
          return (
            <tr key={c.id}>
              <td><strong>{c.name}</strong><br /><span style={{ fontSize: '.78rem', color: 'var(--muted)' }}>{c.phone}</span>{c.email && <><br /><span style={{ fontSize: '.74rem', color: 'var(--muted)' }}>{c.email}</span></>}</td>
              <td style={{ fontSize: '.82rem' }}>{c.customerType || '-'}</td>
              <td>{c.kwRequired || '-'}</td>
              <td><span className={`st ${c.paymentType === 'Finance' ? 'st-b' : 'st-g'}`}>{c.paymentType}</span></td>
              <td style={{ fontWeight: 600 }}>{formatCurrency(c.totalPrice)}</td>
              <td style={{ color: 'var(--ok)', fontWeight: 600 }}>{formatCurrency(paid)}</td>
              <td style={{ color: bal > 0 ? 'var(--err)' : 'var(--ok)', fontWeight: 600 }}>{formatCurrency(bal)}</td>
              <td><StatusBadge status={c.status} /></td>
              <td><StatusBadge status={c.installationStatus || 'Pending'} /></td>
              <td><div style={{ display: 'flex', gap: 4 }}>
                <button className="btn bsm bo" title="View Details" onClick={() => setDetailId(c.id)}>
                  <span className="material-icons-round" style={{ fontSize: 16 }}>visibility</span>
                </button>
                {c.phone && <button className="btn bsm bo" title="Call" onClick={() => makeCall(c.phone)} style={{ color: '#3b82f6', borderColor: 'rgba(59,130,246,.3)' }}>
                  <span className="material-icons-round" style={{ fontSize: 16 }}>call</span>
                </button>}
                {c.phone && <button className="btn bsm bo" title="WhatsApp" onClick={() => sendWhatsApp(c.phone, `Hi ${c.name}, this is from Pragathi Power Solutions.`)} style={{ color: '#25d366', borderColor: 'rgba(37,211,102,.3)' }}>
                  <span className="material-icons-round" style={{ fontSize: 16 }}>chat</span>
                </button>}
                <button className="btn bsm bo" title="Completion Report" onClick={() => printCompletionReport(c, leadPOs, installations, leads)}>
                  <span className="material-icons-round" style={{ fontSize: 16 }}>description</span>
                </button>
                <button className="btn bsm bo" title="Share Report via WhatsApp" onClick={() => shareCompletionReportWhatsApp(c, leadPOs, installations, leads)} style={{ color: '#25d366', borderColor: 'rgba(37,211,102,.3)' }}>
                  <span className="material-icons-round" style={{ fontSize: 16 }}>share</span>
                </button>
                {c.nextServiceDate && c.phone && (
                  <button className="btn bsm bo" title="Send Service Reminder" onClick={() => sendWhatsApp(c.phone, `Hi ${c.name}, this is a reminder for your upcoming solar system service on ${formatDate(c.nextServiceDate)}. Please let us know if you need to reschedule. - Pragathi Solar`)}>
                    <span className="material-icons-round" style={{ fontSize: 16 }}>send</span>
                  </button>
                )}
                {canEdit && <button className="btn bsm bo" onClick={() => setModal({ data: c, id: c.id })}><span className="material-icons-round" style={{ fontSize: 16 }}>edit</span></button>}
              </div></td>
            </tr>
          );
        })}
        {!filtered.length && <tr><td colSpan="10"><EmptyState icon="people" title="No customers yet" message="Convert leads or add customers directly." /></td></tr>}
      </tbody></table></div>
      {hasMore && <div style={{ textAlign: 'center', padding: 16 }}><button className="btn bsm bo" onClick={() => setVisibleCount(c => c + PAGE_SIZE)}>Show More ({filtered.length - visibleCount} remaining)</button></div>}
      </div></div>
      {modal && <CustomerModal data={modal.data} id={modal.id} onSave={handleSave} onClose={() => setModal(null)} />}
      {detailId && (() => {
        const c = customers.find(x => x.id === detailId);
        if (!c) return null;
        return <CustomerDetailModal customer={c} onClose={() => setDetailId(null)} onEdit={() => { setModal({ data: c, id: c.id }); setDetailId(null); }} />;
      })()}
    </>
  );
}

function CustomerModal({ data, id, onSave, onClose }) {
  const [f, setF] = useState({
    name: data.name || '', phone: data.phone || '', address: data.address || '',
    pincode: data.pincode || '', area: data.area || '',
    email: data.email || '', alternatePhone: data.alternatePhone || '',
    gstNumber: data.gstNumber || '', customerType: data.customerType || 'Residential',
    powerPhase: data.powerPhase || 'Single Phase',
    kwRequired: data.kwRequired || '', paymentType: data.paymentType || 'Cash',
    agreedPrice: data.agreedPrice || 0, bosAmount: data.bosAmount || 0, totalPrice: data.totalPrice || 0,
    advanceAmount: data.advanceAmount || 0, secondPayment: data.secondPayment || 0,
    thirdPayment: data.thirdPayment || 0, finalPayment: data.finalPayment || 0, bankName: data.bankName || '',
    quotationProjectValue: data.quotationProjectValue || 0,
    advanceReceivedDate: data.advanceReceivedDate || '',
    advanceReceivedAmount: data.advanceReceivedAmount || 0,
    finalAmountDate: data.finalAmountDate || '',
    finalAmount: data.finalAmount || 0,
    bosAmountStatus: data.bosAmountStatus || 'Pending',
    advancePaidDate: data.advancePaidDate || '',
    firstServiceDate: data.firstServiceDate || '',
    nextServiceDate: data.nextServiceDate || '',
    installationStatus: data.installationStatus || 'Pending',
    installationPicUrl: data.installationPicUrl || '',
    customerReference: data.customerReference || 'No',
    referenceLeadName: data.referenceLeadName || '',
    referencePhoneNumber: data.referencePhoneNumber || '',
    panelDetails: data.panelDetails || '', inverterDetails: data.inverterDetails || '',
    warrantyStartDate: data.warrantyStartDate || '', warrantyEndDate: data.warrantyEndDate || '',
    feedback: data.feedback || '', linkedInstallationId: data.linkedInstallationId || ''
  });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  return (
    <Modal title={id ? 'Edit Customer' : 'Add Customer'} onClose={onClose} wide>
      <form onSubmit={e => { e.preventDefault(); onSave(f, id); }}>
        <div className="mb">
          <div className="fr"><div className="fg"><label>Name *</label><input className="fi" value={f.name} onChange={e => set('name', e.target.value)} required /></div><div className="fg"><label>Phone *</label><input className="fi" value={f.phone} onChange={e => set('phone', e.target.value)} required /></div></div>
          <div className="fr"><div className="fg"><label>Email</label><input type="email" className="fi" value={f.email} onChange={e => set('email', e.target.value)} /></div><div className="fg"><label>Alternate Phone</label><input className="fi" value={f.alternatePhone} onChange={e => set('alternatePhone', e.target.value)} /></div></div>
          <div className="fg"><label>Address</label><input className="fi" value={f.address} onChange={e => set('address', e.target.value)} /></div>
          <div className="fr"><div className="fg"><label>Pincode</label><input className="fi" value={f.pincode} onChange={e => set('pincode', e.target.value)} placeholder="e.g. 500001" /></div><div className="fg"><label>Area</label><input className="fi" value={f.area} onChange={e => set('area', e.target.value)} placeholder="e.g. Kukatpally" /></div></div>
          <div className="fr"><div className="fg"><label>GST Number</label><input className="fi" value={f.gstNumber} onChange={e => set('gstNumber', e.target.value)} /></div><div className="fg"><label>Customer Type</label><select className="fi" value={f.customerType} onChange={e => set('customerType', e.target.value)}>{customerTypes.map(t => <option key={t}>{t}</option>)}</select></div></div>
          <div className="fr3"><div className="fg"><label>Required kW</label><input className="fi" value={f.kwRequired} onChange={e => set('kwRequired', e.target.value)} /></div><div className="fg"><label>Power Phase</label><select className="fi" value={f.powerPhase} onChange={e => set('powerPhase', e.target.value)}>{phases.map(p => <option key={p}>{p}</option>)}</select></div><div className="fg"><label>Payment Type</label><select className="fi" value={f.paymentType} onChange={e => set('paymentType', e.target.value)}><option>Cash</option><option>Finance</option></select></div></div>

          {/* Cash Mode: Pricing & Payment Tracking */}
          {f.paymentType === 'Cash' && (
            <div style={{ borderTop: '1px solid var(--bor)', margin: '14px 0', paddingTop: 14 }}>
              <label style={{ fontWeight: 700, fontSize: '.9rem', marginBottom: 10, display: 'block' }}>Cash Payment Details</label>
              <div className="fr3"><div className="fg"><label>Agreed Price</label><input type="number" className="fi" value={f.agreedPrice} onChange={e => set('agreedPrice', e.target.value)} /></div><div className="fg"><label>BOS Amount</label><input type="number" className="fi" value={f.bosAmount} onChange={e => set('bosAmount', e.target.value)} /></div><div className="fg"><label>Total Price</label><input type="number" className="fi" value={f.totalPrice} onChange={e => set('totalPrice', e.target.value)} /></div></div>
              <label style={{ fontWeight: 700, fontSize: '.9rem', marginBottom: 10, display: 'block', marginTop: 14 }}>Payment Tracking</label>
              <div className="fr"><div className="fg"><label>Advance</label><input type="number" className="fi" value={f.advanceAmount} onChange={e => set('advanceAmount', e.target.value)} /></div><div className="fg"><label>2nd Payment</label><input type="number" className="fi" value={f.secondPayment} onChange={e => set('secondPayment', e.target.value)} /></div></div>
              <div className="fr"><div className="fg"><label>3rd Payment</label><input type="number" className="fi" value={f.thirdPayment} onChange={e => set('thirdPayment', e.target.value)} /></div><div className="fg"><label>Final Payment</label><input type="number" className="fi" value={f.finalPayment} onChange={e => set('finalPayment', e.target.value)} /></div></div>
            </div>
          )}

          {/* Finance Mode: Bank & Finance Details */}
          {f.paymentType === 'Finance' && (
            <div style={{ borderTop: '1px solid var(--bor)', margin: '14px 0', paddingTop: 14 }}>
              <label style={{ fontWeight: 700, fontSize: '.9rem', marginBottom: 10, display: 'block' }}>Finance Details</label>
              <div className="fg"><label>Bank Name</label><input className="fi" value={f.bankName} onChange={e => set('bankName', e.target.value)} /></div>
              <div className="fr"><div className="fg"><label>Quotation Project Value</label><input type="number" className="fi" value={f.quotationProjectValue} onChange={e => set('quotationProjectValue', e.target.value)} /></div><div className="fg"><label>Total Price</label><input type="number" className="fi" value={f.totalPrice} onChange={e => set('totalPrice', e.target.value)} /></div></div>
              <div className="fr"><div className="fg"><label>Advance Received Date</label><input type="date" className="fi" value={f.advanceReceivedDate} onChange={e => set('advanceReceivedDate', e.target.value)} /></div><div className="fg"><label>Advance Received Amount</label><input type="number" className="fi" value={f.advanceReceivedAmount} onChange={e => set('advanceReceivedAmount', e.target.value)} /></div></div>
              <div className="fr"><div className="fg"><label>Final Amount Date</label><input type="date" className="fi" value={f.finalAmountDate} onChange={e => set('finalAmountDate', e.target.value)} /></div><div className="fg"><label>Final Amount</label><input type="number" className="fi" value={f.finalAmount} onChange={e => set('finalAmount', e.target.value)} /></div></div>
              <div className="fg"><label>BOS Amount Status</label><select className="fi" value={f.bosAmountStatus} onChange={e => set('bosAmountStatus', e.target.value)}><option>Included</option><option>Pending</option><option>Paid</option></select></div>
            </div>
          )}

          {/* System & Warranty Details */}
          <div style={{ borderTop: '1px solid var(--bor)', margin: '14px 0', paddingTop: 14 }}>
            <label style={{ fontWeight: 700, fontSize: '.9rem', marginBottom: 10, display: 'block' }}>System & Warranty Details</label>
            <div className="fr"><div className="fg"><label>Panel Details</label><input className="fi" value={f.panelDetails} onChange={e => set('panelDetails', e.target.value)} placeholder="Brand / Model / Wattage" /></div><div className="fg"><label>Inverter Details</label><input className="fi" value={f.inverterDetails} onChange={e => set('inverterDetails', e.target.value)} placeholder="Brand / Model" /></div></div>
            <div className="fr"><div className="fg"><label>Warranty Start Date</label><input type="date" className="fi" value={f.warrantyStartDate} onChange={e => set('warrantyStartDate', e.target.value)} /></div><div className="fg"><label>Warranty End Date</label><input type="date" className="fi" value={f.warrantyEndDate} onChange={e => set('warrantyEndDate', e.target.value)} /></div></div>
          </div>

          {/* Service & Dates */}
          <div style={{ borderTop: '1px solid var(--bor)', margin: '14px 0', paddingTop: 14 }}>
            <label style={{ fontWeight: 700, fontSize: '.9rem', marginBottom: 10, display: 'block' }}>Service & Dates</label>
            <div className="fr3"><div className="fg"><label>Advance Paid Date</label><input type="date" className="fi" value={f.advancePaidDate} onChange={e => set('advancePaidDate', e.target.value)} /></div><div className="fg"><label>1st Service Date</label><input type="date" className="fi" value={f.firstServiceDate} onChange={e => set('firstServiceDate', e.target.value)} /></div><div className="fg"><label>Next Service Date</label><input type="date" className="fi" value={f.nextServiceDate} onChange={e => set('nextServiceDate', e.target.value)} /></div></div>
            <div className="fg"><label>Installation Status</label><select className="fi" value={f.installationStatus} onChange={e => set('installationStatus', e.target.value)}><option>Pending</option><option>In Progress</option><option>Completed</option><option>On Hold</option></select></div>
          </div>

          {/* Installation Picture */}
          <div style={{ borderTop: '1px solid var(--bor)', margin: '14px 0', paddingTop: 14 }}>
            <label style={{ fontWeight: 700, fontSize: '.9rem', marginBottom: 10, display: 'block' }}>System Installation Picture</label>
            <div className="fg"><label>Image URL</label><input className="fi" type="url" value={f.installationPicUrl} onChange={e => set('installationPicUrl', e.target.value)} placeholder="https://..." /></div>
            {f.installationPicUrl && (
              <div style={{ marginTop: 10, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--bor)' }}>
                <img src={f.installationPicUrl} alt="Installation" style={{ width: '100%', maxHeight: 200, objectFit: 'cover' }} onError={e => { e.target.style.display = 'none'; }} />
              </div>
            )}
          </div>

          {/* Customer Reference */}
          <div style={{ borderTop: '1px solid var(--bor)', margin: '14px 0', paddingTop: 14 }}>
            <label style={{ fontWeight: 700, fontSize: '.9rem', marginBottom: 10, display: 'block' }}>Customer Reference</label>
            <div className="fg"><label>Reference Given?</label><select className="fi" value={f.customerReference} onChange={e => set('customerReference', e.target.value)}><option>No</option><option>Yes</option></select></div>
            {f.customerReference === 'Yes' && (
              <div className="fr"><div className="fg"><label>Reference Lead Name</label><input className="fi" value={f.referenceLeadName} onChange={e => set('referenceLeadName', e.target.value)} /></div><div className="fg"><label>Reference Phone Number</label><input className="fi" value={f.referencePhoneNumber} onChange={e => set('referencePhoneNumber', e.target.value)} /></div></div>
            )}
          </div>

          {/* Customer Feedback */}
          <div className="fg"><label>Customer Feedback</label><textarea className="fi" value={f.feedback} onChange={e => set('feedback', e.target.value)} rows="3" placeholder="Satisfaction notes..." /></div>

          {f.linkedInstallationId && <div className="fg"><label>Linked Installation ID</label><input className="fi" value={f.linkedInstallationId} disabled /></div>}
        </div>
        <div className="mf"><button type="button" className="btn bo" onClick={onClose}>Cancel</button><button type="submit" className="btn bp">{id ? 'Update' : 'Add'}</button></div>
      </form>
    </Modal>
  );
}

/* ============ CUSTOMER DETAIL MODAL ============ */
function CustomerDetailModal({ customer, onClose, onEdit }) {
  const [tab, setTab] = useState('overview');
  const { leadPOs, leads, installations } = useData();
  const { role } = useAuth();
  const canEdit = hasAccess(role, 'coordinator');

  const c = customer;
  const linkedLead = leads.find(l => l.phone === c.phone && l.name === c.name) || leads.find(l => l.phone === c.phone);
  const customerPOs = leadPOs.filter(po =>
    (linkedLead && po.leadId === linkedLead.id) ||
    (po.customerName === c.name && po.customerPhone === c.phone)
  );
  const inst = installations.find(i => i.customerName === c.name && i.phone === c.phone) || installations.find(i => i.customerName === c.name);

  const paid = c.paymentType === 'Finance'
    ? toNumber(c.advanceReceivedAmount) + toNumber(c.finalAmount)
    : toNumber(c.advanceAmount) + toNumber(c.secondPayment) + toNumber(c.thirdPayment) + toNumber(c.finalPayment);
  const balance = toNumber(c.totalPrice) - paid;

  const tabs = [
    ['overview', 'Overview', 'info'],
    ['pos', 'Purchase Orders (' + customerPOs.length + ')', 'receipt_long']
  ];

  return (
    <div className="mo" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="md" style={{ width: '860px', maxWidth: '96vw' }}>
        <div className="mh">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="material-icons-round" style={{ fontSize: 22, color: 'var(--pri)' }}>person</span>
            {c.name}
          </h3>
          <button className="mx" onClick={onClose}><span className="material-icons-round">close</span></button>
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--bor)', padding: '0 24px', overflowX: 'auto' }}>
          {tabs.map(([key, label, icon]) => (
            <button key={key} onClick={() => setTab(key)} style={{
              padding: '12px 18px', fontWeight: 600, fontSize: '.85rem',
              color: tab === key ? 'var(--pri)' : 'var(--muted)',
              borderBottom: tab === key ? '2px solid var(--pri)' : '2px solid transparent',
              marginBottom: '-2px', display: 'flex', alignItems: 'center', gap: 6,
              background: 'none', border: 'none', borderBottomStyle: 'solid', cursor: 'pointer', whiteSpace: 'nowrap'
            }}>
              <span className="material-icons-round" style={{ fontSize: 18 }}>{icon}</span>{label}
            </button>
          ))}
        </div>

        <div style={{ padding: 24, maxHeight: '65vh', overflowY: 'auto' }}>

          {/* -------- OVERVIEW TAB -------- */}
          {tab === 'overview' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16, gap: 8, flexWrap: 'wrap' }}>
                {c.phone && <button className="btn bsm bo" onClick={() => makeCall(c.phone)} style={{ color: '#3b82f6', borderColor: 'rgba(59,130,246,.3)' }}>
                  <span className="material-icons-round" style={{ fontSize: 16 }}>call</span> Call
                </button>}
                {c.phone && <button className="btn bsm bo" onClick={() => sendWhatsApp(c.phone, `Hi ${c.name}, this is from Pragathi Power Solutions.`)} style={{ color: '#25d366', borderColor: 'rgba(37,211,102,.3)' }}>
                  <span className="material-icons-round" style={{ fontSize: 16 }}>chat</span> WhatsApp
                </button>}
                <button className="btn bsm bo" onClick={() => printCompletionReport(c, leadPOs, installations, leads)}>
                  <span className="material-icons-round" style={{ fontSize: 16 }}>description</span> Completion Report
                </button>
                {canEdit && <button className="btn bsm bo" onClick={onEdit}>
                  <span className="material-icons-round" style={{ fontSize: 16 }}>edit</span> Edit
                </button>}
              </div>

              {/* Customer info grid */}
              <div className="dg">
                <div className="di"><div className="dl">Phone</div><div className="dv">{c.phone || '-'}</div></div>
                <div className="di"><div className="dl">Email</div><div className="dv">{c.email || '-'}</div></div>
                {c.alternatePhone && <div className="di"><div className="dl">Alternate Phone</div><div className="dv">{c.alternatePhone}</div></div>}
                <div className="di"><div className="dl">Address</div><div className="dv">{c.address || '-'}</div></div>
                {(c.area || c.pincode) && <div className="di"><div className="dl">Area / Pincode</div><div className="dv">{[c.area, c.pincode].filter(Boolean).join(' - ') || '-'}</div></div>}
                {c.gstNumber && <div className="di"><div className="dl">GST Number</div><div className="dv">{c.gstNumber}</div></div>}
                <div className="di"><div className="dl">Customer Type</div><div className="dv">{c.customerType || '-'}</div></div>
                <div className="di"><div className="dl">kW Required</div><div className="dv">{c.kwRequired || '-'}</div></div>
                <div className="di"><div className="dl">Power Phase</div><div className="dv">{c.powerPhase || '-'}</div></div>
                <div className="di"><div className="dl">Status</div><div className="dv"><StatusBadge status={c.status} /></div></div>
                <div className="di"><div className="dl">Installation Status</div><div className="dv"><StatusBadge status={c.installationStatus || 'Pending'} /></div></div>
              </div>

              {/* Payment Details */}
              <div style={{ borderTop: '1px solid var(--bor)', margin: '20px 0', paddingTop: 16 }}>
                <label style={{ fontWeight: 700, fontSize: '.9rem', marginBottom: 12, display: 'block' }}>Payment Details ({c.paymentType})</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 12 }}>
                  <div style={{ background: 'rgba(26,58,122,.04)', borderRadius: 10, padding: 14, textAlign: 'center' }}>
                    <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{formatCurrency(c.totalPrice)}</div>
                    <div style={{ fontSize: '.72rem', color: 'var(--muted)' }}>Total Price</div>
                  </div>
                  <div style={{ background: 'rgba(39,174,96,.06)', borderRadius: 10, padding: 14, textAlign: 'center' }}>
                    <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--ok)' }}>{formatCurrency(paid)}</div>
                    <div style={{ fontSize: '.72rem', color: 'var(--muted)' }}>Paid</div>
                  </div>
                  <div style={{ background: balance > 0 ? 'rgba(231,76,60,.06)' : 'rgba(39,174,96,.06)', borderRadius: 10, padding: 14, textAlign: 'center' }}>
                    <div style={{ fontWeight: 700, fontSize: '1.1rem', color: balance > 0 ? 'var(--err)' : 'var(--ok)' }}>{formatCurrency(balance)}</div>
                    <div style={{ fontSize: '.72rem', color: 'var(--muted)' }}>Balance</div>
                  </div>
                  {c.agreedPrice > 0 && <div style={{ background: 'rgba(26,58,122,.04)', borderRadius: 10, padding: 14, textAlign: 'center' }}>
                    <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{formatCurrency(c.agreedPrice)}</div>
                    <div style={{ fontSize: '.72rem', color: 'var(--muted)' }}>Agreed Price</div>
                  </div>}
                </div>
                {c.paymentType === 'Finance' && (
                  <div className="dg" style={{ marginTop: 12 }}>
                    <div className="di"><div className="dl">Bank Name</div><div className="dv">{c.bankName || '-'}</div></div>
                    <div className="di"><div className="dl">Quotation Value</div><div className="dv">{formatCurrency(c.quotationProjectValue)}</div></div>
                    <div className="di"><div className="dl">BOS Amount Status</div><div className="dv"><StatusBadge status={c.bosAmountStatus || 'Pending'} /></div></div>
                  </div>
                )}
              </div>

              {/* System & Warranty */}
              <div style={{ borderTop: '1px solid var(--bor)', margin: '20px 0', paddingTop: 16 }}>
                <label style={{ fontWeight: 700, fontSize: '.9rem', marginBottom: 12, display: 'block' }}>System & Warranty</label>
                <div className="dg">
                  {c.panelDetails && <div className="di"><div className="dl">Panel Details</div><div className="dv">{c.panelDetails}</div></div>}
                  {c.inverterDetails && <div className="di"><div className="dl">Inverter Details</div><div className="dv">{c.inverterDetails}</div></div>}
                  <div className="di"><div className="dl">Warranty Start</div><div className="dv">{formatDate(c.warrantyStartDate)}</div></div>
                  <div className="di"><div className="dl">Warranty End</div><div className="dv">{formatDate(c.warrantyEndDate)}</div></div>
                  <div className="di"><div className="dl">Advance Paid Date</div><div className="dv">{formatDate(c.advancePaidDate)}</div></div>
                  <div className="di"><div className="dl">1st Service Date</div><div className="dv">{formatDate(c.firstServiceDate)}</div></div>
                  <div className="di"><div className="dl">Next Service Date</div><div className="dv">{formatDate(c.nextServiceDate)}</div></div>
                </div>
              </div>

              {/* Installation Picture */}
              {c.installationPicUrl && (
                <div style={{ borderTop: '1px solid var(--bor)', margin: '20px 0', paddingTop: 16 }}>
                  <label style={{ fontWeight: 700, fontSize: '.9rem', marginBottom: 12, display: 'block' }}>Installation Picture</label>
                  <img src={c.installationPicUrl} alt="Installation" style={{ width: '100%', maxHeight: 240, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--bor)' }} onError={e => { e.target.style.display = 'none'; }} />
                </div>
              )}

              {/* Installation Record */}
              {inst && (
                <div style={{ borderTop: '1px solid var(--bor)', margin: '20px 0', paddingTop: 16 }}>
                  <label style={{ fontWeight: 700, fontSize: '.9rem', marginBottom: 12, display: 'block' }}>Installation Record</label>
                  <div className="dg">
                    <div className="di"><div className="dl">Progress</div><div className="dv" style={{ fontWeight: 700, color: 'var(--pri)' }}>{inst.progress || 0}%</div></div>
                    <div className="di"><div className="dl">Team Leader</div><div className="dv">{inst.teamLeader || '-'}</div></div>
                    <div className="di"><div className="dl">Start Date</div><div className="dv">{formatDate(inst.startDate)}</div></div>
                    <div className="di"><div className="dl">Total Days</div><div className="dv">{inst.totalDays || '-'}</div></div>
                    <div className="di"><div className="dl">Quality Inspection</div><div className="dv">{inst.qualityInspection || 'Pending'}</div></div>
                    <div className="di"><div className="dl">Material Dispatched</div><div className="dv">{inst.materialDispatched || 'No'}</div></div>
                  </div>
                </div>
              )}

              {/* Reference & Feedback */}
              {(c.customerReference === 'Yes' || c.feedback) && (
                <div style={{ borderTop: '1px solid var(--bor)', margin: '20px 0', paddingTop: 16 }}>
                  {c.customerReference === 'Yes' && (
                    <div className="dg" style={{ marginBottom: 12 }}>
                      <div className="di"><div className="dl">Reference Lead Name</div><div className="dv">{c.referenceLeadName || '-'}</div></div>
                      <div className="di"><div className="dl">Reference Phone</div><div className="dv">{c.referencePhoneNumber || '-'}</div></div>
                    </div>
                  )}
                  {c.feedback && <div style={{ background: 'rgba(26,58,122,.04)', borderRadius: 10, padding: 14 }}>
                    <div style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 6 }}>Customer Feedback</div>
                    <p style={{ margin: 0, fontSize: '.88rem' }}>{c.feedback}</p>
                  </div>}
                </div>
              )}
            </div>
          )}

          {/* -------- PURCHASE ORDERS TAB -------- */}
          {tab === 'pos' && (
            <div>
              {customerPOs.length > 0 ? (
                customerPOs.map(po => (
                  <div key={po.id} style={{ border: '1px solid var(--bor)', borderRadius: 10, padding: 16, marginBottom: 12, background: '#fafbfc' }}>
                    {/* PO Header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <strong style={{ fontSize: '1rem' }}>{po.poNumber}</strong>
                        <StatusBadge status={po.status} />
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button className="btn bsm bo" onClick={() => printPO(po, linkedLead || c)}>
                          <span className="material-icons-round" style={{ fontSize: 16 }}>print</span> Print PO
                        </button>
                        <button className="btn bsm bo" onClick={() => printBOM(po, linkedLead || c)}>
                          <span className="material-icons-round" style={{ fontSize: 16 }}>print</span> Print BOM
                        </button>
                        <button className="btn bsm bo" onClick={() => downloadPO(po, linkedLead || c)} style={{ color: '#6c5ce7', borderColor: 'rgba(108,92,231,.3)' }}>
                          <span className="material-icons-round" style={{ fontSize: 16 }}>download</span> PO
                        </button>
                        <button className="btn bsm bo" onClick={() => downloadBOM(po, linkedLead || c)} style={{ color: '#6c5ce7', borderColor: 'rgba(108,92,231,.3)' }}>
                          <span className="material-icons-round" style={{ fontSize: 16 }}>download</span> BOM
                        </button>
                        <button className="btn bsm bo" onClick={() => sharePOWhatsApp(po)} style={{ color: '#25d366', borderColor: 'rgba(37,211,102,.3)' }}>
                          <span className="material-icons-round" style={{ fontSize: 16 }}>share</span> WhatsApp
                        </button>
                      </div>
                    </div>

                    {/* PO Details Grid */}
                    <div className="dg" style={{ gap: 8 }}>
                      <div className="di"><div className="dl">PO Date</div><div className="dv">{po.poDate || '-'}</div></div>
                      <div className="di"><div className="dl">Vendor</div><div className="dv">{po.vendorName || '-'}</div></div>
                      {po.moduleCount && <div className="di"><div className="dl">Modules</div><div className="dv">{po.moduleCount}</div></div>}
                      {po.inverterDetails && <div className="di"><div className="dl">Inverter</div><div className="dv">{po.inverterDetails}</div></div>}
                      {po.plantLocation && <div className="di"><div className="dl">Plant Location</div><div className="dv">{po.plantLocation}</div></div>}
                      <div className="di"><div className="dl">Items</div><div className="dv">{(po.items || []).length} items</div></div>
                      <div className="di"><div className="dl">Total Value</div><div className="dv" style={{ fontWeight: 700 }}>{formatCurrency(po.totalValue)}</div></div>
                      {po.extraChargesTotal > 0 && <div className="di"><div className="dl">Extra Charges</div><div className="dv" style={{ fontWeight: 600, color: 'var(--sec)' }}>{formatCurrency(po.extraChargesTotal)}</div></div>}
                      {po.agreedPrice && <div className="di"><div className="dl">Price After Subsidy</div><div className="dv" style={{ fontWeight: 700, color: 'var(--pri)' }}>{formatCurrency(po.agreedPrice)}</div></div>}
                      <div className="di"><div className="dl">Created By</div><div className="dv" style={{ fontSize: '.84rem' }}>{po.createdBy || '-'}</div></div>
                      {po.approvedBy && <div className="di"><div className="dl">Approved By</div><div className="dv" style={{ fontSize: '.84rem' }}>{po.approvedBy}<br /><span style={{ color: 'var(--muted)', fontSize: '.78rem' }}>{po.approvalDate}</span></div></div>}
                    </div>

                    {/* Expandable BOM items */}
                    {(po.items || []).length > 0 && (
                      <details style={{ marginTop: 10 }}>
                        <summary style={{ cursor: 'pointer', fontSize: '.84rem', fontWeight: 600, color: 'var(--pri)' }}>View BOM Items</summary>
                        <div className="tw" style={{ marginTop: 8 }}>
                          <table>
                            <thead><tr><th>#</th><th>Material</th><th>Make</th><th>Model / Rating</th><th>Qty</th><th>Unit</th><th>Rate</th><th>Amount</th><th>Remarks</th></tr></thead>
                            <tbody>
                              {po.items.map((item, i) => (
                                <tr key={i}>
                                  <td>{i + 1}</td>
                                  <td>{item.materialName}</td>
                                  <td style={{ fontSize: '.82rem' }}>{item.make || '-'}</td>
                                  <td style={{ fontSize: '.82rem', color: 'var(--muted)' }}>{item.specification || '-'}</td>
                                  <td>{item.quantity}</td>
                                  <td>{item.unit || '-'}</td>
                                  <td>{formatCurrency(item.rate)}</td>
                                  <td style={{ fontWeight: 600 }}>{formatCurrency(item.amount)}</td>
                                  <td style={{ fontSize: '.82rem', color: 'var(--muted)' }}>{item.remarks || '-'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    )}

                    {/* Extra charges breakdown */}
                    {po.extraChargesTotal > 0 && (
                      <details style={{ marginTop: 8 }}>
                        <summary style={{ cursor: 'pointer', fontSize: '.84rem', fontWeight: 600, color: 'var(--sec)' }}>View Extra Charges</summary>
                        <div className="dg" style={{ marginTop: 8, gap: 6 }}>
                          {po.discomCharges > 0 && <div className="di"><div className="dl">Discom Charges</div><div className="dv">{formatCurrency(po.discomCharges)}</div></div>}
                          {po.civilWork > 0 && <div className="di"><div className="dl">Civil Work</div><div className="dv">{formatCurrency(po.civilWork)}</div></div>}
                          {po.upvcPipes > 0 && <div className="di"><div className="dl">UPVC Pipes</div><div className="dv">{formatCurrency(po.upvcPipes)}</div></div>}
                          {po.additionalRelay > 0 && <div className="di"><div className="dl">Additional Relay</div><div className="dv">{formatCurrency(po.additionalRelay)}</div></div>}
                          {po.elevatedStructure > 0 && <div className="di"><div className="dl">Elevated Structure</div><div className="dv">{formatCurrency(po.elevatedStructure)}</div></div>}
                          {po.additionalBom > 0 && <div className="di"><div className="dl">Additional BOM</div><div className="dv">{formatCurrency(po.additionalBom)}</div></div>}
                          {po.otherCharges > 0 && <div className="di"><div className="dl">Others</div><div className="dv">{formatCurrency(po.otherCharges)}</div></div>}
                        </div>
                      </details>
                    )}
                  </div>
                ))
              ) : (
                <EmptyState icon="receipt_long" title="No purchase orders" message="POs linked to this customer's lead will appear here automatically." />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============ COMPLETION REPORT PRINT ============ */
function printCompletionReport(customer, leadPOs, installations, leads) {
  /* Find linked lead by phone match */
  const linkedLead = leads.find(l => l.phone === customer.phone && l.name === customer.name) || leads.find(l => l.phone === customer.phone);
  /* Find POs for this customer (via lead link or name match) */
  const customerPOs = leadPOs.filter(po =>
    (linkedLead && po.leadId === linkedLead.id) ||
    (po.customerName === customer.name && po.customerPhone === customer.phone)
  );
  /* Find linked installation */
  const inst = installations.find(i => i.customerName === customer.name && i.phone === customer.phone) || installations.find(i => i.customerName === customer.name);
  /* Use first approved PO, or first PO */
  const po = customerPOs.find(p => p.status === 'Approved') || customerPOs[0];

  /* Extra charges from PO */
  const extraItems = po ? [
    { label: 'Discom Charges', val: Number(po.discomCharges || 0) },
    { label: 'Civil Work', val: Number(po.civilWork || 0) },
    { label: 'UPVC Pipes', val: Number(po.upvcPipes || 0) },
    { label: 'Additional Relay', val: Number(po.additionalRelay || 0) },
    { label: 'Elevated Structure', val: Number(po.elevatedStructure || 0) },
    { label: 'Additional BOM', val: Number(po.additionalBom || 0) },
    { label: 'Others', val: Number(po.otherCharges || 0) }
  ].filter(e => e.val > 0) : [];

  const fmtCur = (v) => '₹' + Number(v || 0).toLocaleString('en-IN');
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
  const e = escapeHtml;
  const w = window.open('', '_blank');
  if (!w) { alert('Popup blocked — please allow popups to print the report.'); return; }
  w.document.write(`<html><head><title>Completion Report - ${e(customer.name)}</title>
<style>
body{font-family:Arial,sans-serif;padding:30px 40px;line-height:1.6;font-size:13px;color:#333}
.hd{display:flex;align-items:center;gap:16px;border-bottom:2px solid #1a3a7a;padding-bottom:14px;margin-bottom:20px}
.hd img{width:60px;height:60px;object-fit:contain;border-radius:4px}
.hd-text{flex:1}
.hd-text h1{font-size:20px;margin:0;color:#1a3a7a}
.hd-text p{margin:1px 0;color:#666;font-size:11px}
h2{font-size:15px;color:#1a3a7a;border-bottom:1px solid #ddd;padding-bottom:6px;margin:24px 0 10px}
h3{font-size:13px;color:#444;margin:14px 0 6px}
table{width:100%;border-collapse:collapse;margin:8px 0}
th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;font-size:12px}
th{background:#f5f5f5;font-weight:600}
.info-tbl{border:none}
.info-tbl td{border:none;padding:3px 16px 3px 0;vertical-align:top}
.info-tbl .lbl{font-weight:600;color:#555;width:160px}
.section{margin:18px 0;page-break-inside:avoid}
.sketch-img{max-width:100%;max-height:280px;object-fit:contain;border:1px solid #ddd;border-radius:4px;margin:6px 0}
.do-dont{display:flex;gap:20px;flex-wrap:wrap}
.do-dont>div{flex:1;min-width:220px}
.do-dont ul{margin:4px 0;padding-left:18px}
.do-dont li{font-size:12px;margin:3px 0}
.warranty-box{border:2px solid #1a3a7a;border-radius:8px;padding:16px;margin:8px 0;background:#f8faff}
.footer{margin-top:30px;font-size:10px;color:#999;text-align:center;border-top:1px solid #eee;padding-top:8px}
@media print{body{padding:15px 20px}h2{page-break-before:auto}.section{page-break-inside:avoid}}
</style>
</head><body>
<div class="hd">
<img src="/logo.png" alt="PPS" onerror="this.style.display='none'" />
<div class="hd-text">
<h1>PRAGATHI POWER SOLUTIONS</h1>
<p>Solar Energy Solutions | Tirupati</p>
</div>
</div>
<h2 style="text-align:center;border:none;font-size:17px">COMPLETION REPORT</h2>

<!-- Customer Details -->
<div class="section">
<h2>Customer Details</h2>
<table class="info-tbl">
<tr><td class="lbl">Name</td><td>${e(customer.name) || '-'}</td><td class="lbl">Phone</td><td>${e(customer.phone) || '-'}</td></tr>
<tr><td class="lbl">Email</td><td>${e(customer.email) || '-'}</td><td class="lbl">Address</td><td>${e(customer.address) || '-'}</td></tr>
<tr><td class="lbl">Area / Pincode</td><td>${e(customer.area) || '-'}${customer.pincode ? ' - ' + e(customer.pincode) : ''}</td><td class="lbl">Customer Type</td><td>${e(customer.customerType) || '-'}</td></tr>
<tr><td class="lbl">kW Installed</td><td>${e(customer.kwRequired) || '-'}</td><td class="lbl">Power Phase</td><td>${e(customer.powerPhase) || '-'}</td></tr>
<tr><td class="lbl">Payment Type</td><td>${e(customer.paymentType) || '-'}</td><td class="lbl">Total Price</td><td style="font-weight:700">${fmtCur(customer.totalPrice)}</td></tr>
</table>
</div>

${po ? `
<!-- Quotation / Purchase Order -->
<div class="section">
<h2>Quotation / Purchase Order</h2>
<table class="info-tbl">
<tr><td class="lbl">PO Number</td><td>${e(po.poNumber) || '-'}</td><td class="lbl">PO Date</td><td>${e(po.poDate) || '-'}</td></tr>
<tr><td class="lbl">Vendor</td><td>${e(po.vendorName) || '-'}</td><td class="lbl">Status</td><td>${e(po.status) || '-'}</td></tr>
<tr><td class="lbl">Company Scope</td><td colspan="3">${e(po.companyScope) || '-'}</td></tr>
<tr><td class="lbl">Customer Scope</td><td colspan="3">${e(po.customerScope) || '-'}</td></tr>
<tr><td class="lbl">Payment Terms</td><td colspan="3">${e(po.paymentTerms) || '-'}</td></tr>
<tr><td class="lbl">Warranty Terms</td><td colspan="3">${e(po.warrantyTerms) || '-'}</td></tr>
</table>
</div>

<!-- BOM -->
<div class="section">
<h2>Bill of Materials (BOM)</h2>
<table><thead><tr><th>#</th><th>Material</th><th>Specification</th><th>Qty</th><th>Unit</th><th>Rate</th><th>Amount</th></tr></thead><tbody>
${(po.items || []).map((item, i) => `<tr><td>${i + 1}</td><td>${e(item.materialName)}</td><td>${e(item.specification) || '-'}</td><td>${item.quantity}</td><td>${e(item.unit) || '-'}</td><td>${Number(item.rate).toLocaleString('en-IN')}</td><td>${Number(item.amount).toLocaleString('en-IN')}</td></tr>`).join('')}
<tr style="font-weight:700"><td colspan="5" style="text-align:right">BOM Total</td><td colspan="2">${fmtCur(po.totalValue)}</td></tr>
</tbody></table>
${extraItems.length > 0 ? `<h3>Extra Charges</h3><table class="info-tbl">${extraItems.map(ei => `<tr><td class="lbl">${ei.label}</td><td>${fmtCur(ei.val)}</td></tr>`).join('')}<tr style="font-weight:700"><td class="lbl">Extra Charges Total</td><td>${fmtCur(po.extraChargesTotal)}</td></tr></table>` : ''}
<p style="margin-top:8px"><strong>Price After Subsidy:</strong> ${fmtCur(po.agreedPrice || po.totalValue)}</p>
</div>
` : '<div class="section"><h2>Quotation / Purchase Order</h2><p style="color:#999">No purchase order found for this customer.</p></div>'}

<!-- Hand Sketch -->
<div class="section">
<h2>Hand Sketch</h2>
${(po && po.handSketch) || (inst && inst.handSketch) ? `<img class="sketch-img" src="${(po && po.handSketch) || inst.handSketch}" alt="Hand Sketch" onerror="this.style.display='none'" />` : '<p style="color:#999">No hand sketch available.</p>'}
${(po && po.sketchWithSignature) || (inst && inst.sketchWithSignature) ? `<p style="margin-top:8px"><strong>Sketch with Signature:</strong></p><img class="sketch-img" src="${(po && po.sketchWithSignature) || (inst && inst.sketchWithSignature)}" alt="Signed Sketch" onerror="this.style.display='none'" />` : ''}
</div>

<!-- Quality Inspection Report -->
<div class="section">
<h2>Quality Inspection Report</h2>
${inst ? `<table class="info-tbl">
<tr><td class="lbl">Quality Inspection</td><td>${e(inst.qualityInspection) || 'Pending'}</td></tr>
<tr><td class="lbl">Material Dispatched</td><td>${e(inst.materialDispatched) || 'No'}</td></tr>
<tr><td class="lbl">Progress</td><td>${inst.progress || 0}%</td></tr>
<tr><td class="lbl">Team Leader</td><td>${e(inst.teamLeader) || '-'}</td></tr>
<tr><td class="lbl">Start Date</td><td>${fmtDate(inst.startDate)}</td></tr>
<tr><td class="lbl">Total Days</td><td>${inst.totalDays || '-'}</td></tr>
${inst.installationReport ? `<tr><td class="lbl">Installation Report</td><td>${e(inst.installationReport)}</td></tr>` : ''}
</table>` : '<p style="color:#999">No installation data found.</p>'}
</div>

<!-- Do's & Don'ts -->
<div class="section">
<h2>Do's & Don'ts</h2>
<div class="do-dont">
<div>
<h3 style="color:green">Do's</h3>
<ul>
<li>Keep the solar panels clean and free from dust, bird droppings, and debris</li>
<li>Check the inverter display regularly for error codes or faults</li>
<li>Ensure vegetation/trees are trimmed to avoid shading on panels</li>
<li>Get annual maintenance done by authorized personnel</li>
<li>Monitor daily generation through the monitoring app</li>
<li>Report any drop in generation immediately to the service team</li>
<li>Keep the area around the inverter ventilated and dry</li>
</ul>
</div>
<div>
<h3 style="color:red">Don'ts</h3>
<ul>
<li>Do not wash panels with hard water or abrasive materials</li>
<li>Do not place any objects or weight on the solar panels</li>
<li>Do not attempt to repair or modify the system yourself</li>
<li>Do not allow unauthorized persons to access the rooftop system</li>
<li>Do not ignore inverter error messages or warning lights</li>
<li>Do not use high-pressure water jets to clean panels</li>
<li>Do not tamper with wiring, junction boxes, or earthing connections</li>
</ul>
</div>
</div>
</div>

<!-- Warranty Card Details -->
<div class="section">
<h2>Warranty Card Details</h2>
<div class="warranty-box">
<table class="info-tbl">
<tr><td class="lbl">Customer Name</td><td>${e(customer.name) || '-'}</td><td class="lbl">kW System</td><td>${e(customer.kwRequired) || '-'}</td></tr>
<tr><td class="lbl">Panel Details</td><td>${e(customer.panelDetails) || '-'}</td><td class="lbl">Inverter Details</td><td>${e(customer.inverterDetails) || '-'}</td></tr>
<tr><td class="lbl">Warranty Start</td><td>${fmtDate(customer.warrantyStartDate)}</td><td class="lbl">Warranty End</td><td>${fmtDate(customer.warrantyEndDate)}</td></tr>
<tr><td class="lbl">1st Service Date</td><td>${fmtDate(customer.firstServiceDate)}</td><td class="lbl">Next Service</td><td>${fmtDate(customer.nextServiceDate)}</td></tr>
${inst && inst.guaranteeCard === 'Yes' ? '<tr><td class="lbl">Guarantee Card</td><td colspan="3" style="color:green;font-weight:600">Issued</td></tr>' : ''}
</table>
<p style="margin:10px 0 0;font-size:11px;color:#666"><strong>Standard Warranty Coverage:</strong> ${po ? (e(po.warrantyTerms) || 'As per manufacturer terms') : 'As per manufacturer terms'}</p>
</div>
</div>

<!-- Notes -->
<div class="section">
<h2>Notes</h2>
${customer.feedback ? `<p><strong>Customer Feedback:</strong> ${e(customer.feedback)}</p>` : ''}
${po && po.notes ? `<p><strong>PO Notes:</strong> ${e(po.notes)}</p>` : ''}
${inst && inst.installationReport ? `<p><strong>Installation Notes:</strong> ${e(inst.installationReport)}</p>` : ''}
${!customer.feedback && !(po && po.notes) && !(inst && inst.installationReport) ? '<p style="color:#999">No additional notes.</p>' : ''}
</div>

<div class="footer">
<p>This is a system-generated Completion Report. No manual edits allowed post-generation.</p>
<p>Pragathi Power Solutions — Generated on ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
</div>
</body></html>`);
  w.document.close();
  w.print();
}

/* ============ COMPLETION REPORT WHATSAPP ============ */
function shareCompletionReportWhatsApp(customer, leadPOs, installations, leads) {
  const linkedLead = leads.find(l => l.phone === customer.phone && l.name === customer.name) || leads.find(l => l.phone === customer.phone);
  const customerPOs = leadPOs.filter(po =>
    (linkedLead && po.leadId === linkedLead.id) ||
    (po.customerName === customer.name && po.customerPhone === customer.phone)
  );
  const inst = installations.find(i => i.customerName === customer.name && i.phone === customer.phone) || installations.find(i => i.customerName === customer.name);
  const po = customerPOs.find(p => p.status === 'Approved') || customerPOs[0];

  const fmtCur = (v) => '₹' + Number(v || 0).toLocaleString('en-IN');
  const bomText = po && po.items ? po.items.map((it, i) =>
    (i + 1) + '. ' + it.materialName + (it.specification ? ' (' + it.specification + ')' : '') + ' x' + it.quantity
  ).join('\n') : 'N/A';

  const msg = '*COMPLETION REPORT*\n' +
    '*' + (customer.name || '-') + '*\n\n' +
    '*Customer Details:*\n' +
    'Phone: ' + (customer.phone || '-') + '\n' +
    'Address: ' + (customer.address || '-') + '\n' +
    'kW: ' + (customer.kwRequired || '-') + '\n' +
    'Type: ' + (customer.customerType || '-') + '\n\n' +
    (po ? '*Quotation / PO:*\n' +
      'PO#: ' + (po.poNumber || '-') + '\n' +
      'Date: ' + (po.poDate || '-') + '\n' +
      'Vendor: ' + (po.vendorName || '-') + '\n' +
      'Total: ' + fmtCur(po.totalValue) + '\n' +
      (po.extraChargesTotal > 0 ? 'Extra Charges: ' + fmtCur(po.extraChargesTotal) + '\n' : '') +
      'Price After Subsidy: ' + fmtCur(po.agreedPrice || po.totalValue) + '\n\n' +
      '*BOM:*\n' + bomText + '\n\n' : '') +
    (inst ? '*Installation:*\n' +
      'Quality: ' + (inst.qualityInspection || 'Pending') + '\n' +
      'Progress: ' + (inst.progress || 0) + '%\n' +
      'Team Leader: ' + (inst.teamLeader || '-') + '\n\n' : '') +
    '*Warranty:*\n' +
    'Panels: ' + (customer.panelDetails || '-') + '\n' +
    'Inverter: ' + (customer.inverterDetails || '-') + '\n' +
    'Warranty: ' + (customer.warrantyStartDate || '-') + ' to ' + (customer.warrantyEndDate || '-') + '\n' +
    (customer.feedback ? '\n*Feedback:* ' + customer.feedback + '\n' : '') +
    '\n_Pragathi Power Solutions_';

  let url;
  if (customer.phone) {
    const phone = customer.phone.replace(/\D/g, '');
    url = 'https://wa.me/' + (phone.length === 10 ? '91' + phone : phone) + '?text=' + encodeURIComponent(msg);
  } else {
    url = 'https://wa.me/?text=' + encodeURIComponent(msg);
  }
  const win = window.open(url, '_blank');
  if (!win) alert('Popup blocked — please allow popups for WhatsApp sharing.');
}
