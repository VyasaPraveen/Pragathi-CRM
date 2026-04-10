import React, { useState } from 'react';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { addDocument, updateDocument, createNotification, notifyAdmins } from '../services/firestore';
import { formatCurrency, formatDate, safeStr, toNumber, sendWhatsApp, escapeHtml, hasAccess, makeCall, openHtmlSafely } from '../services/helpers';
import { useAuth } from '../context/AuthContext';
import { StatusBadge, Modal, EmptyState } from '../components/SharedUI';
import { printBOM, downloadBOM } from '../services/poUtils';

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

  const areas = [...new Set(customers.map(c => c.area).filter(Boolean))].sort();

  let filtered = customers;
  if (typeFilter !== 'all') filtered = filtered.filter(c => c.customerType === typeFilter);
  if (areaFilter !== 'all') filtered = filtered.filter(c => c.area === areaFilter);
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
      const numericFields = [
        'agreedPrice', 'bosAmount', 'totalPrice', 'advanceAmount', 'secondPayment', 'thirdPayment', 'finalPayment',
        'quotationProjectValue', 'advanceReceivedAmount', 'finalAmount',
        'subsidyAmount', 'firstBillAmount', 'firstBillUnits'
      ];
      const cleaned = { ...data };
      numericFields.forEach(f => { cleaned[f] = toNumber(cleaned[f]); });
      const moneyFields = ['agreedPrice', 'bosAmount', 'totalPrice', 'advanceAmount', 'secondPayment', 'thirdPayment', 'finalPayment', 'quotationProjectValue', 'advanceReceivedAmount', 'finalAmount', 'subsidyAmount'];
      for (const mf of moneyFields) { if (cleaned[mf] < 0) { toast('Amount fields cannot be negative', 'er'); return; } }

      if (id) {
        const prevCustomer = customers.find(c => c.id === id);
        await updateDocument('customers', id, cleaned);
        toast('Customer updated');
        notifyAdmins(users, { title: 'Customer Updated', message: `Customer "${cleaned.name}" has been updated`, type: 'customer', module: 'customers', relatedId: id });
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

/* ============ CUSTOMER MODAL (ADD / EDIT) ============ */
function CustomerModal({ data, id, onSave, onClose }) {
  const { leads, installations, leadPOs, users } = useData();
  const { toast } = useToast();
  // Find linked lead to pre-populate payment fields from lead stage
  const ll = leads.find(l => l.phone === data.phone && l.name === data.name) || leads.find(l => l.phone === data.phone);
  const linkedInst = installations.find(i => i.customerName === data.name && i.phone === data.phone) || installations.find(i => i.customerName === data.name);
  // Find linked BOM/PO
  const customerPOs = leadPOs.filter(po => (ll && po.leadId === ll.id) || (po.customerName === data.name && po.customerPhone === data.phone));
  const linkedPO = customerPOs.find(p => p.status === 'Approved') || customerPOs[0];
  // Parse BOM items for material consumption
  const bomItems = linkedPO?.items || [];
  const findItem = (keyword) => bomItems.find(i => (i.materialName || '').toLowerCase().includes(keyword.toLowerCase()));
  const acItem  = findItem('AC Cable') || findItem('AC cable');
  const dcItem  = findItem('DC Cable') || findItem('DC cable');
  const earthItem = findItem('Earth') || findItem('earth');
  const pipeItem  = findItem('Conduit') || findItem('UPVC') || findItem('PVC Pipe');

  const [tab, setTab] = useState('info');
  const [f, setF] = useState({
    // Basic Info
    name: data.name || '', phone: data.phone || '', email: data.email || '',
    alternatePhone: data.alternatePhone || '', address: data.address || '',
    pincode: data.pincode || '', area: data.area || '', city: data.city || '',
    district: data.district || '', gstNumber: data.gstNumber || '',
    customerType: data.customerType || 'Residential',
    powerPhase: data.powerPhase || 'Single Phase',
    kwRequired: data.kwRequired || '', status: data.status || 'Active',
    customerServiceNumber: data.customerServiceNumber || '',
    // Payment — auto-populate from lead if not already set on customer
    paymentType: data.paymentType || 'Cash',
    agreedPrice: data.agreedPrice || toNumber(ll?.expectedValue) || 0,
    bosAmount: data.bosAmount || 0, totalPrice: data.totalPrice || 0,
    advanceAmount: data.advanceAmount || toNumber(ll?.advanceLeadAmount) || 0,
    secondPayment: data.secondPayment || 0,
    thirdPayment: data.thirdPayment || 0, finalPayment: data.finalPayment || 0,
    bankName: data.bankName || '',
    quotationProjectValue: data.quotationProjectValue || 0,
    advanceReceivedDate: data.advanceReceivedDate || '',
    advanceReceivedAmount: data.advanceReceivedAmount || 0,
    finalAmountDate: data.finalAmountDate || '', finalAmount: data.finalAmount || 0,
    bosAmountStatus: data.bosAmountStatus || 'Pending',
    // Material Dispatch
    dispatchDate: data.dispatchDate || '', dispatchedBy: data.dispatchedBy || '',
    vehicleNumber: data.vehicleNumber || '', driverName: data.driverName || '',
    dispatchRemarks: data.dispatchRemarks || '',
    // Installation
    installationStatus: data.installationStatus || 'Pending',
    installationPicUrl: data.installationPicUrl || '',
    advancePaidDate: data.advancePaidDate || '',
    // Quality Inspection
    qualityInspectionDate: data.qualityInspectionDate || '',
    qualityInspectedBy: data.qualityInspectedBy || '',
    qualityInspectionRemarks: data.qualityInspectionRemarks || '',
    qualityInspectionResult: data.qualityInspectionResult || 'Pending',
    // Warranty
    panelDetails: data.panelDetails || '', inverterDetails: data.inverterDetails || '',
    warrantyStartDate: data.warrantyStartDate || '', warrantyEndDate: data.warrantyEndDate || '',
    linkedInstallationId: data.linkedInstallationId || '',
    // Subsidy
    subsidyApplied: data.subsidyApplied || 'No',
    subsidyAmount: data.subsidyAmount || 0,
    subsidyStatus: data.subsidyStatus || 'Pending',
    subsidyApplicationDate: data.subsidyApplicationDate || '',
    subsidyApprovalDate: data.subsidyApprovalDate || '',
    subsidyRemarks: data.subsidyRemarks || '',
    // Net Metering
    netMeteringStatus: data.netMeteringStatus || 'Pending',
    netMeteringDate: data.netMeteringDate || '',
    netMeteringApplicationNumber: data.netMeteringApplicationNumber || '',
    // Sync & Flagging
    syncStatus: data.syncStatus || 'Not Synced',
    flagStatus: data.flagStatus || 'None',
    flagReason: data.flagReason || '',
    // First Bill
    firstBillDate: data.firstBillDate || '',
    firstBillAmount: data.firstBillAmount || 0,
    firstBillUnits: data.firstBillUnits || 0,
    firstBillRemarks: data.firstBillRemarks || '',
    // O&M
    firstServiceDate: data.firstServiceDate || '',
    lastServiceDate: data.lastServiceDate || '',
    nextServiceDate: data.nextServiceDate || '',
    omServiceInterval: data.omServiceInterval || '',
    serviceHistory: data.serviceHistory || '',
    // Reference & Feedback
    customerReference: data.customerReference || 'No',
    referenceLeadName: data.referenceLeadName || '',
    referencePhoneNumber: data.referencePhoneNumber || '',
    feedback: data.feedback || '',
  });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  const di = linkedInst || {};
  const [instF, setInstF] = useState({
    // Site & roof — from existing installation, else from linked lead
    siteVisitStatus: di.siteVisitStatus || (ll?.siteVisit === 'Yes' ? 'Visited' : 'Not Visited'),
    roofType:      di.roofType      || ll?.roofType      || 'RCC',
    floors:        di.floors        || ll?.floors        || 1,
    structureType: di.structureType || ll?.structureType || 'Flat',
    startDate: di.startDate || '', totalDays: di.totalDays || '', teamLeader: di.teamLeader || '',
    numPeople: di.numPeople || '', materialDispatched: di.materialDispatched || 'No', progress: di.progress || 0,
    qualityInspection: di.qualityInspection || 'Pending', guaranteeCard: di.guaranteeCard || 'No',
    customerReference: di.customerReference || 'No',
    referenceLeadName: di.referenceLeadName || '', referencePhoneNumber: di.referencePhoneNumber || '',
    discomFeasibility: di.discomFeasibility || 'Pending', discomFeasibilityDate: di.discomFeasibilityDate || '',
    docSubmission: di.docSubmission || 'Pending', docSubmissionDate: di.docSubmissionDate || '',
    discomInspection: di.discomInspection || 'Pending', discomInspectionDate: di.discomInspectionDate || '',
    meterChange: di.meterChange || 'Pending', meterChangeDate: di.meterChangeDate || '',
    flaggingStatus: di.flaggingStatus || 'Pending', flaggingDate: di.flaggingDate || '',
    subsidyStatus: di.subsidyStatus || 'Not Applied', subsidyDate: di.subsidyDate || '',
    // Material consumption — from existing installation, else from BOM items
    acCableQty:     di.acCableQty     || acItem?.quantity      || '',
    acCableSize:    di.acCableSize    || acItem?.specification  || '',
    dcCableQty:     di.dcCableQty     || dcItem?.quantity      || '',
    dcCableSize:    di.dcCableSize    || dcItem?.specification  || '',
    earthCable:     di.earthCable     || earthItem?.quantity    || '',
    earthCableSize: di.earthCableSize || earthItem?.specification || '',
    upvcPipes:      di.upvcPipes      || pipeItem?.quantity     || '',
    upvcPipeSize:   di.upvcPipeSize   || pipeItem?.specification || '',
    firstServiceDate: di.firstServiceDate || '', nextServiceDate: di.nextServiceDate || '',
    handSketch: di.handSketch || linkedPO?.handSketch || linkedPO?.sketchWithSignature || '',
    installationReport: di.installationReport || '',
  });
  const setI = (k, v) => setInstF(p => ({ ...p, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Save installation data to installations collection
    try {
      const instData = { ...instF, progress: Math.min(100, Math.max(0, toNumber(instF.progress))), floors: toNumber(instF.floors), customerName: data.name || f.name, phone: data.phone || f.phone };
      if (linkedInst?.id) {
        await updateDocument('installations', linkedInst.id, instData);
      } else if (instData.customerName) {
        await addDocument('installations', instData);
      }
    } catch (err) { toast('Installation save failed: ' + err.message, 'er'); }
    onSave(f, id);
  };

  const EDIT_TABS = [
    { key: 'info',         label: 'Customer Info', icon: 'person',          color: '#3b82f6' },
    { key: 'payment',      label: 'Payment',       icon: 'payments',        color: '#10b981' },
    { key: 'dispatch',     label: 'Dispatch',      icon: 'local_shipping',  color: '#f59e0b' },
    { key: 'installation', label: 'Installation',  icon: 'construction',    color: '#8b5cf6' },
    { key: 'quality',      label: 'Quality',       icon: 'fact_check',      color: '#06b6d4' },
    { key: 'warranty',     label: 'Warranty',      icon: 'verified_user',   color: '#059669' },
    { key: 'subsidy',      label: 'Subsidy',       icon: 'savings',         color: '#d97706' },
    { key: 'sync',         label: 'Sync & Flag',   icon: 'sync',            color: '#6366f1' },
    { key: 'firstbill',    label: 'First Bill',    icon: 'receipt',         color: '#f43f5e' },
    { key: 'om',           label: 'O&M',           icon: 'build_circle',    color: '#14b8a6' },
  ];

  const tabStyle = (key, color) => ({
    padding: '7px 12px', fontWeight: 600, fontSize: '.78rem', borderRadius: 20,
    color: tab === key ? '#fff' : color,
    background: tab === key ? color : `${color}1a`,
    border: `1.5px solid ${tab === key ? color : `${color}55`}`,
    display: 'flex', alignItems: 'center', gap: 4,
    cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all .15s',
  });

  return (
    <Modal title={id ? 'Edit Customer' : 'Add Customer'} onClose={onClose} wide>
      <form onSubmit={handleSubmit}>
        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16, padding: '4px 0' }}>
          {EDIT_TABS.map(t => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)} style={tabStyle(t.key, t.color)}>
              <span className="material-icons-round" style={{ fontSize: 15 }}>{t.icon}</span>{t.label}
            </button>
          ))}
        </div>

        <div className="mb">
          {/* Tab 1: Customer Info */}
          {tab === 'info' && (<>
            <div className="fr"><div className="fg"><label>Name *</label><input className="fi" value={f.name} onChange={e => set('name', e.target.value)} required /></div><div className="fg"><label>Phone *</label><input className="fi" value={f.phone} onChange={e => set('phone', e.target.value)} required /></div></div>
            <div className="fr"><div className="fg"><label>Email</label><input type="email" className="fi" value={f.email} onChange={e => set('email', e.target.value)} /></div><div className="fg"><label>Alternate Phone</label><input className="fi" value={f.alternatePhone} onChange={e => set('alternatePhone', e.target.value)} /></div></div>
            <div className="fg"><label>Address</label><input className="fi" value={f.address} onChange={e => set('address', e.target.value)} /></div>
            <div className="fr"><div className="fg"><label>Pincode</label><input className="fi" value={f.pincode} onChange={e => set('pincode', e.target.value)} /></div><div className="fg"><label>Area</label><input className="fi" value={f.area} onChange={e => set('area', e.target.value)} /></div></div>
            <div className="fr"><div className="fg"><label>City</label><input className="fi" value={f.city} onChange={e => set('city', e.target.value)} /></div><div className="fg"><label>District</label><input className="fi" value={f.district} onChange={e => set('district', e.target.value)} /></div></div>
            <div className="fr"><div className="fg"><label>GST Number</label><input className="fi" value={f.gstNumber} onChange={e => set('gstNumber', e.target.value)} /></div><div className="fg"><label>Customer Type</label><select className="fi" value={f.customerType} onChange={e => set('customerType', e.target.value)}>{customerTypes.map(t => <option key={t}>{t}</option>)}</select></div></div>
            <div className="fr3"><div className="fg"><label>Required kW</label><input className="fi" value={f.kwRequired} onChange={e => set('kwRequired', e.target.value)} /></div><div className="fg"><label>Power Phase</label><select className="fi" value={f.powerPhase} onChange={e => set('powerPhase', e.target.value)}>{phases.map(p => <option key={p}>{p}</option>)}</select></div><div className="fg"><label>Status</label><select className="fi" value={f.status} onChange={e => set('status', e.target.value)}><option>Active</option><option>Inactive</option><option>Completed</option></select></div></div>
            <div className="fg"><label>Customer Service Number</label><input className="fi" value={f.customerServiceNumber} onChange={e => set('customerServiceNumber', e.target.value)} /></div>
          </>)}

          {/* Tab 2: Payment Details */}
          {tab === 'payment' && (() => {
            const cashPaid = toNumber(f.advanceAmount) + toNumber(f.secondPayment) + toNumber(f.thirdPayment) + toNumber(f.finalPayment);
            const finPaid = toNumber(f.advanceReceivedAmount) + toNumber(f.finalAmount);
            const paid = f.paymentType === 'Finance' ? finPaid : cashPaid;
            const balance = toNumber(f.totalPrice) - paid;
            return (<>
              {/* Lead data banner */}
              {ll && (
                <div style={{ background: 'linear-gradient(135deg,rgba(59,130,246,.1),rgba(99,102,241,.1))', border: '1px solid rgba(59,130,246,.3)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span className="material-icons-round" style={{ fontSize: 18, color: '#3b82f6' }}>link</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: '.8rem', color: '#3b82f6' }}>Linked Lead: {ll.name}</div>
                    <div style={{ fontSize: '.75rem', color: 'var(--muted)' }}>
                      Expected Value: <strong>{formatCurrency(ll.expectedValue)}</strong>
                      {ll.advancePaid === 'Yes' && <> &nbsp;|&nbsp; Advance Paid: <strong>{formatCurrency(ll.advanceLeadAmount)}</strong></>}
                    </div>
                  </div>
                </div>
              )}

              {/* Live balance summary */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 16 }}>
                <div style={{ background: 'rgba(26,58,122,.06)', borderRadius: 10, padding: '12px 14px', textAlign: 'center' }}>
                  <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--pri)' }}>{formatCurrency(f.totalPrice)}</div>
                  <div style={{ fontSize: '.72rem', color: 'var(--muted)', marginTop: 3 }}>Total Price</div>
                </div>
                <div style={{ background: 'rgba(39,174,96,.08)', borderRadius: 10, padding: '12px 14px', textAlign: 'center' }}>
                  <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--ok)' }}>{formatCurrency(paid)}</div>
                  <div style={{ fontSize: '.72rem', color: 'var(--muted)', marginTop: 3 }}>Total Paid</div>
                </div>
                <div style={{ background: balance > 0 ? 'rgba(231,76,60,.08)' : 'rgba(39,174,96,.08)', borderRadius: 10, padding: '12px 14px', textAlign: 'center' }}>
                  <div style={{ fontWeight: 700, fontSize: '1rem', color: balance > 0 ? 'var(--err)' : 'var(--ok)' }}>{formatCurrency(Math.abs(balance))}</div>
                  <div style={{ fontSize: '.72rem', color: 'var(--muted)', marginTop: 3 }}>{balance > 0 ? 'Balance Due' : balance < 0 ? 'Overpaid' : 'Fully Paid'}</div>
                </div>
              </div>

              <div className="fg"><label>Payment Type</label><select className="fi" value={f.paymentType} onChange={e => set('paymentType', e.target.value)}><option>Cash</option><option>Finance</option></select></div>
              {f.paymentType === 'Cash' && (<>
                <div style={{ fontWeight: 700, fontSize: '.85rem', margin: '12px 0 8px' }}>Pricing</div>
                <div className="fr3">
                  <div className="fg">
                    <label>Agreed Price (₹)</label>
                    <input type="number" className="fi" value={f.agreedPrice} onChange={e => set('agreedPrice', e.target.value)} />
                    {ll?.expectedValue > 0 && toNumber(f.agreedPrice) === 0 && <span style={{ fontSize: '.72rem', color: '#3b82f6', marginTop: 3, display: 'block' }}>Lead value: {formatCurrency(ll.expectedValue)}</span>}
                  </div>
                  <div className="fg"><label>BOS Amount (₹)</label><input type="number" className="fi" value={f.bosAmount} onChange={e => set('bosAmount', e.target.value)} /></div>
                  <div className="fg"><label>Total Price (₹)</label><input type="number" className="fi" value={f.totalPrice} onChange={e => set('totalPrice', e.target.value)} /></div>
                </div>
                <div style={{ fontWeight: 700, fontSize: '.85rem', margin: '12px 0 8px' }}>Payment Tracking</div>
                <div className="fr">
                  <div className="fg">
                    <label>Advance (₹)</label>
                    <input type="number" className="fi" value={f.advanceAmount} onChange={e => set('advanceAmount', e.target.value)} />
                    {ll?.advancePaid === 'Yes' && ll?.advanceLeadAmount > 0 && <span style={{ fontSize: '.72rem', color: '#10b981', marginTop: 3, display: 'block' }}>From lead: {formatCurrency(ll.advanceLeadAmount)}</span>}
                  </div>
                  <div className="fg"><label>2nd Payment (₹)</label><input type="number" className="fi" value={f.secondPayment} onChange={e => set('secondPayment', e.target.value)} /></div>
                </div>
                <div className="fr"><div className="fg"><label>3rd Payment (₹)</label><input type="number" className="fi" value={f.thirdPayment} onChange={e => set('thirdPayment', e.target.value)} /></div><div className="fg"><label>Final Payment (₹)</label><input type="number" className="fi" value={f.finalPayment} onChange={e => set('finalPayment', e.target.value)} /></div></div>
              </>)}
              {f.paymentType === 'Finance' && (<>
                <div className="fg"><label>Bank Name</label><input className="fi" value={f.bankName} onChange={e => set('bankName', e.target.value)} /></div>
                <div className="fr"><div className="fg"><label>Quotation Project Value (₹)</label><input type="number" className="fi" value={f.quotationProjectValue} onChange={e => set('quotationProjectValue', e.target.value)} /></div><div className="fg"><label>Total Price (₹)</label><input type="number" className="fi" value={f.totalPrice} onChange={e => set('totalPrice', e.target.value)} /></div></div>
                <div className="fr"><div className="fg"><label>Advance Received Date</label><input type="date" className="fi" value={f.advanceReceivedDate} onChange={e => set('advanceReceivedDate', e.target.value)} /></div><div className="fg"><label>Advance Received Amount (₹)</label><input type="number" className="fi" value={f.advanceReceivedAmount} onChange={e => set('advanceReceivedAmount', e.target.value)} /></div></div>
                <div className="fr"><div className="fg"><label>Final Amount Date</label><input type="date" className="fi" value={f.finalAmountDate} onChange={e => set('finalAmountDate', e.target.value)} /></div><div className="fg"><label>Final Amount (₹)</label><input type="number" className="fi" value={f.finalAmount} onChange={e => set('finalAmount', e.target.value)} /></div></div>
                <div className="fg"><label>BOS Amount Status</label><select className="fi" value={f.bosAmountStatus} onChange={e => set('bosAmountStatus', e.target.value)}><option>Included</option><option>Pending</option><option>Paid</option></select></div>
              </>)}
            </>);
          })()}

          {/* Tab 3: Material Dispatch Details */}
          {tab === 'dispatch' && (<>
            <div className="fr"><div className="fg"><label>Dispatch Date</label><input type="date" className="fi" value={f.dispatchDate} onChange={e => set('dispatchDate', e.target.value)} /></div><div className="fg"><label>Dispatched By</label><input className="fi" value={f.dispatchedBy} onChange={e => set('dispatchedBy', e.target.value)} /></div></div>
            <div className="fr"><div className="fg"><label>Vehicle Number</label><input className="fi" value={f.vehicleNumber} onChange={e => set('vehicleNumber', e.target.value)} /></div><div className="fg"><label>Driver Name</label><input className="fi" value={f.driverName} onChange={e => set('driverName', e.target.value)} /></div></div>
            <div className="fg"><label>Dispatch Remarks</label><textarea className="fi" value={f.dispatchRemarks} onChange={e => set('dispatchRemarks', e.target.value)} rows="3" placeholder="Material dispatch notes..." /></div>
          </>)}

          {/* Tab 4: Installation Details */}
          {tab === 'installation' && (<>
            <div className="fr"><div className="fg"><label>Installation Status</label><select className="fi" value={f.installationStatus} onChange={e => set('installationStatus', e.target.value)}><option>Pending</option><option>In Progress</option><option>Completed</option><option>On Hold</option></select></div><div className="fg"><label>Advance Paid Date</label><input type="date" className="fi" value={f.advancePaidDate} onChange={e => set('advancePaidDate', e.target.value)} /></div></div>
            <div className="fg"><label>Installation Picture URL</label><input className="fi" type="url" value={f.installationPicUrl} onChange={e => set('installationPicUrl', e.target.value)} placeholder="https://..." /></div>
            {f.installationPicUrl && <img src={f.installationPicUrl} alt="Installation" style={{ width: '100%', maxHeight: 120, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--bor)', marginTop: 6 }} onError={e => { e.target.style.display = 'none'; }} />}

            <div style={{ fontWeight: 700, fontSize: '.82rem', color: '#8b5cf6', borderTop: '1px solid var(--bor)', paddingTop: 12, marginTop: 12, marginBottom: 8 }}>Site & Roof</div>
            <div className="fr">
              <div className="fg"><label>Site Visit Status</label><select className="fi" value={instF.siteVisitStatus} onChange={e => setI('siteVisitStatus', e.target.value)}><option>Not Visited</option><option>Visited</option></select></div>
              <div className="fg"><label>Roof Type</label><select className="fi" value={instF.roofType} onChange={e => setI('roofType', e.target.value)}><option>RCC</option><option>Sheet</option><option>Tile</option><option>Elevated</option></select></div>
            </div>
            <div className="fr">
              <div className="fg"><label>Floors</label><input type="number" className="fi" value={instF.floors} onChange={e => setI('floors', e.target.value)} /></div>
              <div className="fg"><label>Structure</label><select className="fi" value={instF.structureType} onChange={e => setI('structureType', e.target.value)}><option>Flat</option><option>Sloped</option></select></div>
            </div>

            <div style={{ fontWeight: 700, fontSize: '.82rem', color: '#8b5cf6', borderTop: '1px solid var(--bor)', paddingTop: 12, marginTop: 8, marginBottom: 8 }}>Schedule & Team</div>
            <div className="fr3">
              <div className="fg"><label>Start Date</label><input type="date" className="fi" value={instF.startDate} onChange={e => setI('startDate', e.target.value)} /></div>
              <div className="fg"><label>Total Days</label><input type="number" className="fi" value={instF.totalDays} onChange={e => setI('totalDays', e.target.value)} /></div>
              <div className="fg"><label>Team Leader</label><select className="fi" value={instF.teamLeader} onChange={e => setI('teamLeader', e.target.value)}><option value="">-- Select --</option>{users.filter(u => u.displayName).map(u => <option key={u.id} value={u.displayName}>{u.displayName}</option>)}</select></div>
            </div>
            <div className="fr3">
              <div className="fg"><label>Team Size</label><input type="number" className="fi" value={instF.numPeople} onChange={e => setI('numPeople', e.target.value)} /></div>
              <div className="fg"><label>Material Dispatched</label><select className="fi" value={instF.materialDispatched} onChange={e => setI('materialDispatched', e.target.value)}><option>No</option><option>Yes</option></select></div>
              <div className="fg"><label>Guarantee Card</label><select className="fi" value={instF.guaranteeCard} onChange={e => setI('guaranteeCard', e.target.value)}><option>No</option><option>Yes</option></select></div>
            </div>
            <div className="fr"><div className="fg"><label>Quality Inspection</label><select className="fi" value={instF.qualityInspection} onChange={e => setI('qualityInspection', e.target.value)}><option>Pending</option><option>Done</option><option>Approved</option></select></div></div>

            <div style={{ fontWeight: 700, fontSize: '.82rem', color: '#8b5cf6', borderTop: '1px solid var(--bor)', paddingTop: 12, marginTop: 8, marginBottom: 8 }}>DISCOM & Subsidy</div>
            {[
              { label: 'Feasibility Status', key: 'discomFeasibility', dateKey: 'discomFeasibilityDate', opts: ['Pending','Done','Approved'] },
              { label: 'Doc Submission',      key: 'docSubmission',     dateKey: 'docSubmissionDate',     opts: ['Pending','Done','Approved'] },
              { label: 'DISCOM Inspection',   key: 'discomInspection',  dateKey: 'discomInspectionDate',  opts: ['Pending','Done','Approved'] },
              { label: 'Meter Change',        key: 'meterChange',       dateKey: 'meterChangeDate',       opts: ['Pending','Done'] },
              { label: 'Flagging',            key: 'flaggingStatus',    dateKey: 'flaggingDate',          opts: ['Pending','Done'] },
              { label: 'Subsidy',             key: 'subsidyStatus',     dateKey: 'subsidyDate',           opts: ['Not Applied','Pending','Approved','Released'] },
            ].map(row => (
              <div className="fr" key={row.key}>
                <div className="fg"><label>{row.label}</label><select className="fi" value={instF[row.key]} onChange={e => setI(row.key, e.target.value)}>{row.opts.map(o => <option key={o}>{o}</option>)}</select></div>
                <div className="fg"><label>Date</label><input type="date" className="fi" value={instF[row.dateKey]} onChange={e => setI(row.dateKey, e.target.value)} /></div>
              </div>
            ))}

            <div style={{ fontWeight: 700, fontSize: '.82rem', color: '#8b5cf6', borderTop: '1px solid var(--bor)', paddingTop: 12, marginTop: 8, marginBottom: 8 }}>Material Consumption</div>
            <div className="fr"><div className="fg"><label>AC Cable Qty (mtrs)</label><input type="number" className="fi" value={instF.acCableQty} onChange={e => setI('acCableQty', e.target.value)} /></div><div className="fg"><label>AC Cable Size (mm)</label><input className="fi" value={instF.acCableSize} onChange={e => setI('acCableSize', e.target.value)} placeholder="e.g. 4mm" /></div></div>
            <div className="fr"><div className="fg"><label>DC Cable Qty (mtrs)</label><input type="number" className="fi" value={instF.dcCableQty} onChange={e => setI('dcCableQty', e.target.value)} /></div><div className="fg"><label>DC Cable Size (mm)</label><input className="fi" value={instF.dcCableSize} onChange={e => setI('dcCableSize', e.target.value)} placeholder="e.g. 6mm" /></div></div>
            <div className="fr"><div className="fg"><label>Earth Cable (mtrs)</label><input type="number" className="fi" value={instF.earthCable} onChange={e => setI('earthCable', e.target.value)} /></div><div className="fg"><label>Earth Cable Size (mm)</label><input className="fi" value={instF.earthCableSize} onChange={e => setI('earthCableSize', e.target.value)} placeholder="e.g. 4mm" /></div></div>
            <div className="fr"><div className="fg"><label>UPVC Pipes (pcs)</label><input type="number" className="fi" value={instF.upvcPipes} onChange={e => setI('upvcPipes', e.target.value)} /></div><div className="fg"><label>UPVC Pipe Size (mm)</label><input className="fi" value={instF.upvcPipeSize} onChange={e => setI('upvcPipeSize', e.target.value)} placeholder="e.g. 25mm" /></div></div>

            <div style={{ fontWeight: 700, fontSize: '.82rem', color: '#8b5cf6', borderTop: '1px solid var(--bor)', paddingTop: 12, marginTop: 8, marginBottom: 8 }}>Service Dates</div>
            <div className="fr"><div className="fg"><label>1st Service Date</label><input type="date" className="fi" value={instF.firstServiceDate} onChange={e => setI('firstServiceDate', e.target.value)} /></div><div className="fg"><label>Next Service Date</label><input type="date" className="fi" value={instF.nextServiceDate} onChange={e => setI('nextServiceDate', e.target.value)} /></div></div>

            <div style={{ fontWeight: 700, fontSize: '.82rem', color: '#8b5cf6', borderTop: '1px solid var(--bor)', paddingTop: 12, marginTop: 8, marginBottom: 8 }}>Documents</div>
            <div className="fg"><label>Hand Sketch URL (with Signature)</label><input className="fi" type="url" value={instF.handSketch} onChange={e => setI('handSketch', e.target.value)} placeholder="https://..." /></div>
            {instF.handSketch && <img src={instF.handSketch} alt="Hand Sketch" style={{ width: '100%', maxHeight: 140, objectFit: 'contain', borderRadius: 8, border: '1px solid var(--bor)', marginBottom: 8 }} onError={e => { e.target.style.display = 'none'; }} />}
            <div className="fg"><label>Installation Report / Notes</label><textarea className="fi" value={instF.installationReport} onChange={e => setI('installationReport', e.target.value)} rows="3" placeholder="Enter installation report details..." /></div>

            <div style={{ fontWeight: 700, fontSize: '.82rem', color: '#8b5cf6', borderTop: '1px solid var(--bor)', paddingTop: 12, marginTop: 8, marginBottom: 8 }}>Customer Reference</div>
            <div className="fg"><label>Has Reference?</label><select className="fi" value={instF.customerReference} onChange={e => setI('customerReference', e.target.value)}><option>No</option><option>Yes</option></select></div>
            {instF.customerReference === 'Yes' && <div className="fr"><div className="fg"><label>Reference Lead Name</label><input className="fi" value={instF.referenceLeadName} onChange={e => setI('referenceLeadName', e.target.value)} /></div><div className="fg"><label>Reference Phone</label><input className="fi" value={instF.referencePhoneNumber} onChange={e => setI('referencePhoneNumber', e.target.value)} /></div></div>}
          </>)}

          {/* Tab 5: Quality Inspection */}
          {tab === 'quality' && (<>
            <div className="fr"><div className="fg"><label>Inspection Result</label><select className="fi" value={f.qualityInspectionResult} onChange={e => set('qualityInspectionResult', e.target.value)}><option>Pending</option><option>Passed</option><option>Failed</option><option>Re-inspection Required</option></select></div><div className="fg"><label>Inspection Date</label><input type="date" className="fi" value={f.qualityInspectionDate} onChange={e => set('qualityInspectionDate', e.target.value)} /></div></div>
            <div className="fg"><label>Inspected By</label><input className="fi" value={f.qualityInspectedBy} onChange={e => set('qualityInspectedBy', e.target.value)} /></div>
            <div className="fg"><label>Inspection Remarks</label><textarea className="fi" value={f.qualityInspectionRemarks} onChange={e => set('qualityInspectionRemarks', e.target.value)} rows="3" placeholder="Quality inspection notes..." /></div>
          </>)}

          {/* Tab 6: Warranty Details */}
          {tab === 'warranty' && (<>
            <div className="fr"><div className="fg"><label>Panel Details</label><input className="fi" value={f.panelDetails} onChange={e => set('panelDetails', e.target.value)} placeholder="Brand / Model / Wattage" /></div><div className="fg"><label>Inverter Details</label><input className="fi" value={f.inverterDetails} onChange={e => set('inverterDetails', e.target.value)} placeholder="Brand / Model" /></div></div>
            <div className="fr"><div className="fg"><label>Warranty Start Date</label><input type="date" className="fi" value={f.warrantyStartDate} onChange={e => set('warrantyStartDate', e.target.value)} /></div><div className="fg"><label>Warranty End Date</label><input type="date" className="fi" value={f.warrantyEndDate} onChange={e => set('warrantyEndDate', e.target.value)} /></div></div>
          </>)}

          {/* Tab 7: Subsidy Process */}
          {tab === 'subsidy' && (<>
            <div style={{ fontWeight: 700, fontSize: '.85rem', margin: '0 0 10px' }}>Subsidy Details</div>
            <div className="fr"><div className="fg"><label>Subsidy Applied?</label><select className="fi" value={f.subsidyApplied} onChange={e => set('subsidyApplied', e.target.value)}><option>No</option><option>Yes</option></select></div><div className="fg"><label>Subsidy Status</label><select className="fi" value={f.subsidyStatus} onChange={e => set('subsidyStatus', e.target.value)}><option>Pending</option><option>Applied</option><option>Approved</option><option>Received</option><option>Rejected</option></select></div></div>
            <div className="fr"><div className="fg"><label>Subsidy Amount (₹)</label><input type="number" className="fi" value={f.subsidyAmount} onChange={e => set('subsidyAmount', e.target.value)} /></div><div className="fg"><label>Application Date</label><input type="date" className="fi" value={f.subsidyApplicationDate} onChange={e => set('subsidyApplicationDate', e.target.value)} /></div></div>
            <div className="fg"><label>Approval Date</label><input type="date" className="fi" value={f.subsidyApprovalDate} onChange={e => set('subsidyApprovalDate', e.target.value)} /></div>
            <div className="fg"><label>Subsidy Remarks</label><textarea className="fi" value={f.subsidyRemarks} onChange={e => set('subsidyRemarks', e.target.value)} rows="2" /></div>
            <div style={{ fontWeight: 700, fontSize: '.85rem', margin: '14px 0 10px' }}>Net Metering</div>
            <div className="fr"><div className="fg"><label>Net Metering Status</label><select className="fi" value={f.netMeteringStatus} onChange={e => set('netMeteringStatus', e.target.value)}><option>Pending</option><option>Applied</option><option>Connected</option><option>Rejected</option></select></div><div className="fg"><label>Net Metering Date</label><input type="date" className="fi" value={f.netMeteringDate} onChange={e => set('netMeteringDate', e.target.value)} /></div></div>
            <div className="fg"><label>Application / Reference Number</label><input className="fi" value={f.netMeteringApplicationNumber} onChange={e => set('netMeteringApplicationNumber', e.target.value)} /></div>
          </>)}

          {/* Tab 8: Synchronization and Flagging */}
          {tab === 'sync' && (<>
            <div style={{ fontWeight: 700, fontSize: '.85rem', margin: '0 0 10px' }}>Synchronization Status</div>
            <div className="fg"><label>Sync Status</label><select className="fi" value={f.syncStatus} onChange={e => set('syncStatus', e.target.value)}><option>Not Synced</option><option>Synced</option><option>Sync Pending</option><option>Sync Error</option></select></div>
            <div style={{ fontWeight: 700, fontSize: '.85rem', margin: '14px 0 10px' }}>Flagging</div>
            <div className="fg"><label>Flag Status</label><select className="fi" value={f.flagStatus} onChange={e => set('flagStatus', e.target.value)}><option>None</option><option>Flagged</option><option>Under Review</option><option>Resolved</option></select></div>
            {f.flagStatus !== 'None' && <div className="fg"><label>Flag Reason</label><textarea className="fi" value={f.flagReason} onChange={e => set('flagReason', e.target.value)} rows="3" placeholder="Describe the issue..." /></div>}
          </>)}

          {/* Tab 9: First Bill */}
          {tab === 'firstbill' && (<>
            <div className="fr"><div className="fg"><label>First Bill Date</label><input type="date" className="fi" value={f.firstBillDate} onChange={e => set('firstBillDate', e.target.value)} /></div><div className="fg"><label>First Bill Amount (₹)</label><input type="number" className="fi" value={f.firstBillAmount} onChange={e => set('firstBillAmount', e.target.value)} /></div></div>
            <div className="fr"><div className="fg"><label>Units Generated (kWh)</label><input type="number" className="fi" value={f.firstBillUnits} onChange={e => set('firstBillUnits', e.target.value)} /></div><div className="fg" /></div>
            <div className="fg"><label>First Bill Remarks</label><textarea className="fi" value={f.firstBillRemarks} onChange={e => set('firstBillRemarks', e.target.value)} rows="3" placeholder="Notes about first electricity bill after solar installation..." /></div>
          </>)}

          {/* Tab 10: Next O&M */}
          {tab === 'om' && (<>
            <div style={{ fontWeight: 700, fontSize: '.85rem', margin: '0 0 10px' }}>Service Schedule</div>
            <div className="fr3"><div className="fg"><label>1st Service Date</label><input type="date" className="fi" value={f.firstServiceDate} onChange={e => set('firstServiceDate', e.target.value)} /></div><div className="fg"><label>Last Service Date</label><input type="date" className="fi" value={f.lastServiceDate} onChange={e => set('lastServiceDate', e.target.value)} /></div><div className="fg"><label>Next Service Date</label><input type="date" className="fi" value={f.nextServiceDate} onChange={e => set('nextServiceDate', e.target.value)} /></div></div>
            <div className="fg"><label>Service Interval</label><input className="fi" value={f.omServiceInterval} onChange={e => set('omServiceInterval', e.target.value)} placeholder="e.g. Every 6 months" /></div>
            <div className="fg"><label>Service History / Notes</label><textarea className="fi" value={f.serviceHistory} onChange={e => set('serviceHistory', e.target.value)} rows="3" /></div>
            <div style={{ fontWeight: 700, fontSize: '.85rem', margin: '14px 0 10px' }}>Customer Reference</div>
            <div className="fg"><label>Reference Given?</label><select className="fi" value={f.customerReference} onChange={e => set('customerReference', e.target.value)}><option>No</option><option>Yes</option></select></div>
            {f.customerReference === 'Yes' && <div className="fr"><div className="fg"><label>Reference Lead Name</label><input className="fi" value={f.referenceLeadName} onChange={e => set('referenceLeadName', e.target.value)} /></div><div className="fg"><label>Reference Phone</label><input className="fi" value={f.referencePhoneNumber} onChange={e => set('referencePhoneNumber', e.target.value)} /></div></div>}
            <div className="fg" style={{ marginTop: 8 }}><label>Customer Feedback</label><textarea className="fi" value={f.feedback} onChange={e => set('feedback', e.target.value)} rows="3" placeholder="Satisfaction notes..." /></div>
          </>)}
        </div>

        <div className="mf"><button type="button" className="btn bo" onClick={onClose}>Cancel</button><button type="submit" className="btn bp">{id ? 'Update' : 'Add'}</button></div>
      </form>
    </Modal>
  );
}

/* ============ CUSTOMER DETAIL MODAL (10 TABS) ============ */
function CustomerDetailModal({ customer, onClose, onEdit }) {
  const [tab, setTab] = useState('info');
  const { leadPOs, leads, installations, users } = useData();
  const { role } = useAuth();
  const { toast } = useToast();
  const canEdit = hasAccess(role, 'coordinator');

  const blankInst = { customerName: customer.name, phone: customer.phone, address: customer.address || '',
    siteVisitStatus: 'Not Visited', roofType: 'RCC', floors: 1, structureType: 'Flat',
    startDate: '', totalDays: '', teamLeader: '', numPeople: '', materialDispatched: 'No', progress: 0,
    qualityInspection: 'Pending', guaranteeCard: 'No', customerReference: 'No',
    referenceLeadName: '', referencePhoneNumber: '',
    discomFeasibility: 'Pending', discomFeasibilityDate: '',
    docSubmission: 'Pending', docSubmissionDate: '',
    discomInspection: 'Pending', discomInspectionDate: '',
    meterChange: 'Pending', meterChangeDate: '',
    flaggingStatus: 'Pending', flaggingDate: '',
    subsidyStatus: 'Not Applied', subsidyDate: '',
    acCableQty: '', acCableSize: '', dcCableQty: '', dcCableSize: '',
    earthCable: '', earthCableSize: '', upvcPipes: '', upvcPipeSize: '',
    firstServiceDate: '', nextServiceDate: '',
    handSketch: '', installationReport: '',
  };
  const [instF, setInstF] = useState(blankInst);
  const [instSaving, setInstSaving] = useState(false);
  const setIF = (k, v) => setInstF(p => ({ ...p, [k]: v }));

  const c = customer;
  const linkedLead = leads.find(l => l.phone === c.phone && l.name === c.name) || leads.find(l => l.phone === c.phone);
  const customerPOs = leadPOs.filter(po =>
    (linkedLead && po.leadId === linkedLead.id) ||
    (po.customerName === c.name && po.customerPhone === c.phone)
  );
  const inst = installations.find(i => i.customerName === c.name && i.phone === c.phone) || installations.find(i => i.customerName === c.name);

  // Sync instF when inst loads/changes from Firestore
  React.useEffect(() => {
    if (inst) setInstF({ ...blankInst, ...inst });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inst?.id]);

  const handleInstSave = async (e) => {
    e?.preventDefault();
    setInstSaving(true);
    try {
      const data = { ...instF, progress: Math.min(100, Math.max(0, toNumber(instF.progress))), floors: toNumber(instF.floors) };
      if (inst?.id) {
        await updateDocument('installations', inst.id, data);
        toast('Installation updated');
      } else {
        await addDocument('installations', { ...data, customerName: c.name, phone: c.phone });
        toast('Installation record created');
      }
    } catch (err) { toast(err.message, 'er'); }
    setInstSaving(false);
  };

  const paid = c.paymentType === 'Finance'
    ? toNumber(c.advanceReceivedAmount) + toNumber(c.finalAmount)
    : toNumber(c.advanceAmount) + toNumber(c.secondPayment) + toNumber(c.thirdPayment) + toNumber(c.finalPayment);
  const balance = toNumber(c.totalPrice) - paid;

  const TABS = [
    { key: 'info',         label: 'Customer Info',    icon: 'person',         color: '#3b82f6' },
    { key: 'payment',      label: 'Payment Details',  icon: 'payments',       color: '#10b981' },
    { key: 'dispatch',     label: 'Material Dispatch',icon: 'local_shipping', color: '#f59e0b' },
    { key: 'installation', label: 'Installation',     icon: 'construction',   color: '#8b5cf6' },
    { key: 'quality',      label: 'Quality Inspection',icon: 'fact_check',    color: '#06b6d4' },
    { key: 'warranty',     label: 'Warranty Details', icon: 'verified_user',  color: '#059669' },
    { key: 'subsidy',      label: 'Subsidy Process',  icon: 'savings',        color: '#d97706' },
    { key: 'sync',         label: 'Sync & Flagging',  icon: 'sync',           color: '#6366f1' },
    { key: 'firstbill',    label: 'First Bill',       icon: 'receipt',        color: '#f43f5e' },
    { key: 'om',           label: 'Next O&M',         icon: 'build_circle',   color: '#14b8a6' },
  ];

  const tabStyle = (key, color) => ({
    padding: '7px 12px', fontWeight: 600, fontSize: '.78rem', borderRadius: 20,
    color: tab === key ? '#fff' : color,
    background: tab === key ? color : `${color}1a`,
    border: `1.5px solid ${tab === key ? color : `${color}55`}`,
    display: 'flex', alignItems: 'center', gap: 5,
    cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all .15s',
  });

  const SectionTitle = ({ children }) => (
    <div style={{ fontWeight: 700, fontSize: '.88rem', color: 'var(--pri)', marginBottom: 12, paddingBottom: 6, borderBottom: '1px solid var(--bor)' }}>{children}</div>
  );

  const InfoGrid = ({ children }) => (
    <div className="dg" style={{ marginBottom: 8 }}>{children}</div>
  );

  const InfoItem = ({ label, value, fullWidth }) => (
    <div className="di" style={fullWidth ? { gridColumn: '1 / -1' } : {}}>
      <div className="dl">{label}</div>
      <div className="dv">{value || '-'}</div>
    </div>
  );

  return (
    <div className="mo" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="md" style={{ width: '920px', maxWidth: '96vw' }}>
        <div className="mh">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="material-icons-round" style={{ fontSize: 22, color: 'var(--pri)' }}>person</span>
            {c.name}
            <StatusBadge status={c.status} />
          </h3>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {c.phone && <button className="btn bsm bo" onClick={() => makeCall(c.phone)} style={{ color: '#3b82f6', borderColor: 'rgba(59,130,246,.3)' }}><span className="material-icons-round" style={{ fontSize: 15 }}>call</span></button>}
            {c.phone && <button className="btn bsm bo" onClick={() => sendWhatsApp(c.phone, `Hi ${c.name}, this is from Pragathi Power Solutions.`)} style={{ color: '#25d366', borderColor: 'rgba(37,211,102,.3)' }}><span className="material-icons-round" style={{ fontSize: 15 }}>chat</span></button>}
            {canEdit && <button className="btn bsm bp" onClick={onEdit}><span className="material-icons-round" style={{ fontSize: 15 }}>edit</span> Edit</button>}
            <button className="mx" onClick={onClose}><span className="material-icons-round">close</span></button>
          </div>
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '12px 24px 0', borderBottom: '1px solid var(--bor)', paddingBottom: 12 }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={tabStyle(t.key, t.color)}>
              <span className="material-icons-round" style={{ fontSize: 15 }}>{t.icon}</span>{t.label}
            </button>
          ))}
        </div>

        <div style={{ padding: 24, maxHeight: '65vh', overflowY: 'auto' }}>

          {/* ===== TAB 1: CUSTOMER INFO ===== */}
          {tab === 'info' && (
            <div>
              <SectionTitle>Basic Information</SectionTitle>
              <InfoGrid>
                <InfoItem label="Phone" value={c.phone} />
                <InfoItem label="Email" value={c.email} />
                {c.alternatePhone && <InfoItem label="Alternate Phone" value={c.alternatePhone} />}
                <InfoItem label="Address" value={c.address} fullWidth />
                <InfoItem label="Area" value={c.area} />
                <InfoItem label="City" value={c.city} />
                <InfoItem label="District" value={c.district} />
                <InfoItem label="Pincode" value={c.pincode} />
                {c.gstNumber && <InfoItem label="GST Number" value={c.gstNumber} />}
                <InfoItem label="Customer Type" value={c.customerType} />
                <InfoItem label="Required kW" value={c.kwRequired} />
                <InfoItem label="Power Phase" value={c.powerPhase} />
                {c.customerServiceNumber && <InfoItem label="Customer Service Number" value={c.customerServiceNumber} />}
                <div className="di"><div className="dl">Status</div><div className="dv"><StatusBadge status={c.status} /></div></div>
                <div className="di"><div className="dl">Installation Status</div><div className="dv"><StatusBadge status={c.installationStatus || 'Pending'} /></div></div>
              </InfoGrid>
            </div>
          )}

          {/* ===== TAB 2: PAYMENT DETAILS ===== */}
          {tab === 'payment' && (
            <div>
              <SectionTitle>Payment Summary ({c.paymentType})</SectionTitle>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 12, marginBottom: 20 }}>
                <div style={{ background: 'rgba(26,58,122,.06)', borderRadius: 12, padding: 16, textAlign: 'center', border: '1px solid rgba(26,58,122,.1)' }}>
                  <div style={{ fontWeight: 700, fontSize: '1.15rem', color: 'var(--pri)' }}>{formatCurrency(c.totalPrice)}</div>
                  <div style={{ fontSize: '.72rem', color: 'var(--muted)', marginTop: 4 }}>Total Price</div>
                </div>
                <div style={{ background: 'rgba(39,174,96,.06)', borderRadius: 12, padding: 16, textAlign: 'center', border: '1px solid rgba(39,174,96,.15)' }}>
                  <div style={{ fontWeight: 700, fontSize: '1.15rem', color: 'var(--ok)' }}>{formatCurrency(paid)}</div>
                  <div style={{ fontSize: '.72rem', color: 'var(--muted)', marginTop: 4 }}>Paid</div>
                </div>
                <div style={{ background: balance > 0 ? 'rgba(231,76,60,.06)' : 'rgba(39,174,96,.06)', borderRadius: 12, padding: 16, textAlign: 'center', border: `1px solid ${balance > 0 ? 'rgba(231,76,60,.15)' : 'rgba(39,174,96,.15)'}` }}>
                  <div style={{ fontWeight: 700, fontSize: '1.15rem', color: balance > 0 ? 'var(--err)' : 'var(--ok)' }}>{formatCurrency(balance)}</div>
                  <div style={{ fontSize: '.72rem', color: 'var(--muted)', marginTop: 4 }}>Balance</div>
                </div>
              </div>

              {c.paymentType === 'Cash' && (<>
                <SectionTitle>Cash Payment Breakdown</SectionTitle>
                <InfoGrid>
                  <InfoItem label="Agreed Price" value={formatCurrency(c.agreedPrice)} />
                  <InfoItem label="BOS Amount" value={formatCurrency(c.bosAmount)} />
                  <InfoItem label="Total Price" value={formatCurrency(c.totalPrice)} />
                  <InfoItem label="Advance" value={formatCurrency(c.advanceAmount)} />
                  <InfoItem label="2nd Payment" value={formatCurrency(c.secondPayment)} />
                  <InfoItem label="3rd Payment" value={formatCurrency(c.thirdPayment)} />
                  <InfoItem label="Final Payment" value={formatCurrency(c.finalPayment)} />
                  {c.advancePaidDate && <InfoItem label="Advance Paid Date" value={formatDate(c.advancePaidDate)} />}
                </InfoGrid>
              </>)}

              {c.paymentType === 'Finance' && (<>
                <SectionTitle>Finance Details</SectionTitle>
                <InfoGrid>
                  <InfoItem label="Bank Name" value={c.bankName} />
                  <InfoItem label="Quotation Project Value" value={formatCurrency(c.quotationProjectValue)} />
                  <InfoItem label="Total Price" value={formatCurrency(c.totalPrice)} />
                  <InfoItem label="Advance Received Date" value={formatDate(c.advanceReceivedDate)} />
                  <InfoItem label="Advance Received Amount" value={formatCurrency(c.advanceReceivedAmount)} />
                  <InfoItem label="Final Amount Date" value={formatDate(c.finalAmountDate)} />
                  <InfoItem label="Final Amount" value={formatCurrency(c.finalAmount)} />
                  <div className="di"><div className="dl">BOS Amount Status</div><div className="dv"><StatusBadge status={c.bosAmountStatus || 'Pending'} /></div></div>
                </InfoGrid>
              </>)}
            </div>
          )}

          {/* ===== TAB 3: MATERIAL DISPATCH DETAILS ===== */}
          {tab === 'dispatch' && (
            <div>
              <SectionTitle>Dispatch Information</SectionTitle>
              <InfoGrid>
                <InfoItem label="Dispatch Date" value={formatDate(c.dispatchDate)} />
                <InfoItem label="Dispatched By" value={c.dispatchedBy} />
                <InfoItem label="Vehicle Number" value={c.vehicleNumber} />
                <InfoItem label="Driver Name" value={c.driverName} />
                <div className="di"><div className="dl">Material Dispatched</div><div className="dv"><StatusBadge status={inst?.materialDispatched === 'Yes' ? 'Completed' : 'Pending'} />{inst?.materialDispatched ? ` (${inst.materialDispatched})` : ''}</div></div>
                {c.dispatchRemarks && <InfoItem label="Dispatch Remarks" value={c.dispatchRemarks} fullWidth />}
              </InfoGrid>

              {customerPOs.length > 0 && (<>
                <SectionTitle>Purchase Orders & BOM Items</SectionTitle>
                {customerPOs.map(po => (
                  <div key={po.id} style={{ border: '1px solid var(--bor)', borderRadius: 10, padding: 14, marginBottom: 10, background: '#fafbfc' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <strong>{po.poNumber}</strong><StatusBadge status={po.status} />
                        <span style={{ fontSize: '.78rem', color: 'var(--muted)' }}>{po.vendorName}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        <button className="btn bsm bo" onClick={() => printBOM(po, linkedLead || c)}><span className="material-icons-round" style={{ fontSize: 14 }}>print</span> BOM</button>
                        <button className="btn bsm bo" onClick={() => downloadBOM(po, linkedLead || c)} style={{ color: '#6c5ce7', borderColor: 'rgba(108,92,231,.3)' }}><span className="material-icons-round" style={{ fontSize: 14 }}>download</span> BOM</button>
                      </div>
                    </div>
                    {(po.items || []).length > 0 && (
                      <details open>
                        <summary style={{ cursor: 'pointer', fontSize: '.84rem', fontWeight: 600, color: 'var(--pri)', marginBottom: 8 }}>BOM Items ({po.items.length})</summary>
                        <div className="tw"><table><thead><tr><th>#</th><th>Description of Material</th><th>UOM</th><th>Make</th><th>Model / Rating</th><th>Qty</th><th>Amount</th><th>Scope</th></tr></thead><tbody>
                          {po.items.map((item, i) => (
                            <tr key={i}><td>{i + 1}</td><td>{item.materialName}</td><td>{item.unit || 'Nos'}</td><td style={{ fontSize: '.8rem' }}>{item.make || '-'}</td><td style={{ fontSize: '.8rem', color: 'var(--muted)' }}>{item.specification || '-'}</td><td>{item.quantity}</td><td style={{ fontWeight: 600 }}>{formatCurrency(item.amount)}</td><td style={{ fontSize: '.8rem' }}>{[item.scopePragathi && 'Pragathi', item.scopeCustomer && 'Customer'].filter(Boolean).join(', ') || '-'}</td></tr>
                          ))}
                        </tbody></table></div>
                      </details>
                    )}
                  </div>
                ))}
              </>)}
              {customerPOs.length === 0 && <EmptyState icon="local_shipping" title="No dispatch data" message="Add dispatch details via Edit. Purchase orders will show BOM items when available." />}
            </div>
          )}

          {/* ===== TAB 4: INSTALLATION DETAILS ===== */}
          {tab === 'installation' && (
            <form onSubmit={handleInstSave}>
              <SectionTitle>Site & Roof</SectionTitle>
              <div className="fr">
                <div className="fg"><label>Site Visit Status</label><select className="fi" value={instF.siteVisitStatus} onChange={e => setIF('siteVisitStatus', e.target.value)} disabled={!canEdit}><option>Not Visited</option><option>Visited</option></select></div>
                <div className="fg"><label>Roof Type</label><select className="fi" value={instF.roofType} onChange={e => setIF('roofType', e.target.value)} disabled={!canEdit}><option>RCC</option><option>Sheet</option><option>Tile</option><option>Elevated</option></select></div>
              </div>
              <div className="fr">
                <div className="fg"><label>Floors</label><input type="number" className="fi" value={instF.floors} onChange={e => setIF('floors', e.target.value)} disabled={!canEdit} /></div>
                <div className="fg"><label>Structure</label><select className="fi" value={instF.structureType} onChange={e => setIF('structureType', e.target.value)} disabled={!canEdit}><option>Flat</option><option>Sloped</option></select></div>
              </div>

              <SectionTitle>Schedule & Team</SectionTitle>
              <div className="fr3">
                <div className="fg"><label>Start Date</label><input type="date" className="fi" value={instF.startDate} onChange={e => setIF('startDate', e.target.value)} disabled={!canEdit} /></div>
                <div className="fg"><label>Total Days</label><input type="number" className="fi" value={instF.totalDays} onChange={e => setIF('totalDays', e.target.value)} disabled={!canEdit} /></div>
                <div className="fg"><label>Team Leader</label><select className="fi" value={instF.teamLeader} onChange={e => setIF('teamLeader', e.target.value)} disabled={!canEdit}><option value="">-- Select --</option>{users.filter(u => u.displayName).map(u => <option key={u.id} value={u.displayName}>{u.displayName}</option>)}</select></div>
              </div>
              <div className="fr3">
                <div className="fg"><label>Team Size</label><input type="number" className="fi" value={instF.numPeople} onChange={e => setIF('numPeople', e.target.value)} disabled={!canEdit} /></div>
                <div className="fg"><label>Material Dispatched</label><select className="fi" value={instF.materialDispatched} onChange={e => setIF('materialDispatched', e.target.value)} disabled={!canEdit}><option>No</option><option>Yes</option></select></div>
                <div className="fg"><label>Guarantee Card</label><select className="fi" value={instF.guaranteeCard} onChange={e => setIF('guaranteeCard', e.target.value)} disabled={!canEdit}><option>No</option><option>Yes</option></select></div>
              </div>
              <div className="fr">
                <div className="fg"><label>Quality Inspection</label><select className="fi" value={instF.qualityInspection} onChange={e => setIF('qualityInspection', e.target.value)} disabled={!canEdit}><option>Pending</option><option>Done</option><option>Approved</option></select></div>
              </div>

              <SectionTitle>DISCOM & Subsidy</SectionTitle>
              {[
                { label: 'Feasibility Status', key: 'discomFeasibility', dateKey: 'discomFeasibilityDate', opts: ['Pending','Done','Approved'] },
                { label: 'Doc Submission',      key: 'docSubmission',     dateKey: 'docSubmissionDate',     opts: ['Pending','Done','Approved'] },
                { label: 'DISCOM Inspection',   key: 'discomInspection',  dateKey: 'discomInspectionDate',  opts: ['Pending','Done','Approved'] },
                { label: 'Meter Change',        key: 'meterChange',       dateKey: 'meterChangeDate',       opts: ['Pending','Done'] },
                { label: 'Flagging',            key: 'flaggingStatus',    dateKey: 'flaggingDate',          opts: ['Pending','Done'] },
                { label: 'Subsidy',             key: 'subsidyStatus',     dateKey: 'subsidyDate',           opts: ['Not Applied','Pending','Approved','Released'] },
              ].map(row => (
                <div className="fr" key={row.key}>
                  <div className="fg"><label>{row.label}</label><select className="fi" value={instF[row.key]} onChange={e => setIF(row.key, e.target.value)} disabled={!canEdit}>{row.opts.map(o => <option key={o}>{o}</option>)}</select></div>
                  <div className="fg"><label>Date</label><input type="date" className="fi" value={instF[row.dateKey]} onChange={e => setIF(row.dateKey, e.target.value)} disabled={!canEdit} /></div>
                </div>
              ))}

              <SectionTitle>Material Consumption</SectionTitle>
              <div className="fr"><div className="fg"><label>AC Cable Qty (mtrs)</label><input type="number" className="fi" value={instF.acCableQty} onChange={e => setIF('acCableQty', e.target.value)} disabled={!canEdit} /></div><div className="fg"><label>AC Cable Size (mm)</label><input className="fi" value={instF.acCableSize} onChange={e => setIF('acCableSize', e.target.value)} placeholder="e.g. 4mm" disabled={!canEdit} /></div></div>
              <div className="fr"><div className="fg"><label>DC Cable Qty (mtrs)</label><input type="number" className="fi" value={instF.dcCableQty} onChange={e => setIF('dcCableQty', e.target.value)} disabled={!canEdit} /></div><div className="fg"><label>DC Cable Size (mm)</label><input className="fi" value={instF.dcCableSize} onChange={e => setIF('dcCableSize', e.target.value)} placeholder="e.g. 6mm" disabled={!canEdit} /></div></div>
              <div className="fr"><div className="fg"><label>Earth Cable (mtrs)</label><input type="number" className="fi" value={instF.earthCable} onChange={e => setIF('earthCable', e.target.value)} disabled={!canEdit} /></div><div className="fg"><label>Earth Cable Size (mm)</label><input className="fi" value={instF.earthCableSize} onChange={e => setIF('earthCableSize', e.target.value)} placeholder="e.g. 4mm" disabled={!canEdit} /></div></div>
              <div className="fr"><div className="fg"><label>UPVC Pipes (pcs)</label><input type="number" className="fi" value={instF.upvcPipes} onChange={e => setIF('upvcPipes', e.target.value)} disabled={!canEdit} /></div><div className="fg"><label>UPVC Pipe Size (mm)</label><input className="fi" value={instF.upvcPipeSize} onChange={e => setIF('upvcPipeSize', e.target.value)} placeholder="e.g. 25mm" disabled={!canEdit} /></div></div>

              <SectionTitle>Service Dates</SectionTitle>
              <div className="fr">
                <div className="fg"><label>1st Service Date</label><input type="date" className="fi" value={instF.firstServiceDate} onChange={e => setIF('firstServiceDate', e.target.value)} disabled={!canEdit} /></div>
                <div className="fg"><label>Next Service Date</label><input type="date" className="fi" value={instF.nextServiceDate} onChange={e => setIF('nextServiceDate', e.target.value)} disabled={!canEdit} /></div>
              </div>

              <SectionTitle>Documents</SectionTitle>
              <div className="fg"><label>Hand Sketch URL (with Signature)</label><input className="fi" type="url" value={instF.handSketch} onChange={e => setIF('handSketch', e.target.value)} placeholder="https://..." disabled={!canEdit} /></div>
              {instF.handSketch && <img src={instF.handSketch} alt="Hand Sketch" style={{ width: '100%', maxHeight: 200, objectFit: 'contain', borderRadius: 8, border: '1px solid var(--bor)', marginBottom: 8 }} onError={e => { e.target.style.display = 'none'; }} />}
              <div className="fg"><label>Installation Report / Notes</label><textarea className="fi" value={instF.installationReport} onChange={e => setIF('installationReport', e.target.value)} rows="4" placeholder="Enter installation report details..." disabled={!canEdit} /></div>

              <SectionTitle>Customer Reference</SectionTitle>
              <div className="fg"><label>Has Reference?</label><select className="fi" value={instF.customerReference} onChange={e => setIF('customerReference', e.target.value)} disabled={!canEdit}><option>No</option><option>Yes</option></select></div>
              {instF.customerReference === 'Yes' && <div className="fr"><div className="fg"><label>Reference Lead Name</label><input className="fi" value={instF.referenceLeadName} onChange={e => setIF('referenceLeadName', e.target.value)} disabled={!canEdit} /></div><div className="fg"><label>Reference Phone</label><input className="fi" value={instF.referencePhoneNumber} onChange={e => setIF('referencePhoneNumber', e.target.value)} disabled={!canEdit} /></div></div>}

              {canEdit && (
                <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
                  <button type="submit" className="btn bp" disabled={instSaving}>
                    <span className="material-icons-round" style={{ fontSize: 16 }}>{inst?.id ? 'save' : 'add'}</span>
                    {instSaving ? 'Saving...' : inst?.id ? 'Save Installation' : 'Create Installation Record'}
                  </button>
                </div>
              )}
            </form>
          )}

          {/* ===== TAB 5: QUALITY INSPECTION ===== */}
          {tab === 'quality' && (
            <div>
              <SectionTitle>Quality Inspection — Customer Record</SectionTitle>
              <InfoGrid>
                <div className="di"><div className="dl">Inspection Result</div><div className="dv"><StatusBadge status={c.qualityInspectionResult || 'Pending'} /></div></div>
                <InfoItem label="Inspection Date" value={formatDate(c.qualityInspectionDate)} />
                <InfoItem label="Inspected By" value={c.qualityInspectedBy} />
                {c.qualityInspectionRemarks && <InfoItem label="Inspection Remarks" value={c.qualityInspectionRemarks} fullWidth />}
              </InfoGrid>

              {inst && (<>
                <SectionTitle>Quality Inspection — Installation Record</SectionTitle>
                <InfoGrid>
                  <div className="di"><div className="dl">Quality Status</div><div className="dv"><StatusBadge status={inst.qualityInspection || 'Pending'} /></div></div>
                  {inst.guaranteeCard && <div className="di"><div className="dl">Guarantee Card</div><div className="dv"><StatusBadge status={inst.guaranteeCard === 'Yes' ? 'Completed' : 'Pending'} />{` ${inst.guaranteeCard}`}</div></div>}
                  <InfoItem label="Material Dispatched" value={inst.materialDispatched} />
                  {inst.installationReport && <InfoItem label="Report Notes" value={inst.installationReport} fullWidth />}
                </InfoGrid>
              </>)}

              {!inst && !c.qualityInspectionResult && <EmptyState icon="fact_check" title="No inspection data" message="Quality inspection details will appear here once added." />}
            </div>
          )}

          {/* ===== TAB 6: WARRANTY DETAILS ===== */}
          {tab === 'warranty' && (
            <div>
              <SectionTitle>System Details</SectionTitle>
              <InfoGrid>
                <InfoItem label="Panel Details" value={c.panelDetails} />
                <InfoItem label="Inverter Details" value={c.inverterDetails} />
                <InfoItem label="Required kW" value={c.kwRequired} />
                <InfoItem label="Power Phase" value={c.powerPhase} />
              </InfoGrid>

              <SectionTitle>Warranty Period</SectionTitle>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div style={{ background: 'linear-gradient(135deg,#11998e,#38ef7d)', borderRadius: 12, padding: 16, color: '#fff', textAlign: 'center' }}>
                  <div style={{ fontWeight: 700, fontSize: '1rem' }}>{formatDate(c.warrantyStartDate) || 'Not set'}</div>
                  <div style={{ fontSize: '.72rem', opacity: .85, marginTop: 4 }}>Warranty Start</div>
                </div>
                <div style={{ background: 'linear-gradient(135deg,#f5af19,#f12711)', borderRadius: 12, padding: 16, color: '#fff', textAlign: 'center' }}>
                  <div style={{ fontWeight: 700, fontSize: '1rem' }}>{formatDate(c.warrantyEndDate) || 'Not set'}</div>
                  <div style={{ fontSize: '.72rem', opacity: .85, marginTop: 4 }}>Warranty End</div>
                </div>
              </div>

              {(() => {
                const po = customerPOs.find(p => p.status === 'Approved') || customerPOs[0];
                return po && po.warrantyTerms ? (<>
                  <SectionTitle>Warranty Terms (from PO)</SectionTitle>
                  <div style={{ background: 'rgba(26,58,122,.04)', borderRadius: 10, padding: 14, fontSize: '.88rem' }}>{po.warrantyTerms}</div>
                </>) : null;
              })()}

              {inst && inst.guaranteeCard && (<>
                <SectionTitle>Guarantee Card</SectionTitle>
                <InfoGrid>
                  <div className="di"><div className="dl">Guarantee Card Issued</div><div className="dv"><StatusBadge status={inst.guaranteeCard === 'Yes' ? 'Completed' : 'Pending'} /> {inst.guaranteeCard}</div></div>
                </InfoGrid>
              </>)}
            </div>
          )}

          {/* ===== TAB 7: SUBSIDY PROCESS ===== */}
          {tab === 'subsidy' && (
            <div>
              <SectionTitle>Subsidy Details</SectionTitle>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 12, marginBottom: 20 }}>
                <div style={{ background: 'linear-gradient(135deg,#667eea,#764ba2)', borderRadius: 12, padding: 14, color: '#fff', textAlign: 'center' }}>
                  <div style={{ fontWeight: 700, fontSize: '.95rem' }}>{c.subsidyApplied || 'No'}</div>
                  <div style={{ fontSize: '.72rem', opacity: .85, marginTop: 4 }}>Applied</div>
                </div>
                <div style={{ background: 'linear-gradient(135deg,#f093fb,#f5576c)', borderRadius: 12, padding: 14, color: '#fff', textAlign: 'center' }}>
                  <div style={{ fontWeight: 700, fontSize: '.95rem' }}>{c.subsidyStatus || 'Pending'}</div>
                  <div style={{ fontSize: '.72rem', opacity: .85, marginTop: 4 }}>Status</div>
                </div>
                {c.subsidyAmount > 0 && <div style={{ background: 'linear-gradient(135deg,#11998e,#38ef7d)', borderRadius: 12, padding: 14, color: '#fff', textAlign: 'center' }}>
                  <div style={{ fontWeight: 700, fontSize: '.95rem' }}>{formatCurrency(c.subsidyAmount)}</div>
                  <div style={{ fontSize: '.72rem', opacity: .85, marginTop: 4 }}>Amount</div>
                </div>}
              </div>
              <InfoGrid>
                <InfoItem label="Application Date" value={formatDate(c.subsidyApplicationDate)} />
                <InfoItem label="Approval Date" value={formatDate(c.subsidyApprovalDate)} />
                {c.subsidyRemarks && <InfoItem label="Remarks" value={c.subsidyRemarks} fullWidth />}
              </InfoGrid>

              <SectionTitle>Net Metering</SectionTitle>
              <InfoGrid>
                <div className="di"><div className="dl">Net Metering Status</div><div className="dv"><StatusBadge status={c.netMeteringStatus || 'Pending'} /></div></div>
                <InfoItem label="Net Metering Date" value={formatDate(c.netMeteringDate)} />
                <InfoItem label="Application / Ref Number" value={c.netMeteringApplicationNumber} />
              </InfoGrid>

              {!c.subsidyApplied && !c.netMeteringStatus && <EmptyState icon="savings" title="No subsidy data" message="Subsidy and net metering details will appear here once added." />}
            </div>
          )}

          {/* ===== TAB 8: SYNCHRONIZATION AND FLAGGING ===== */}
          {tab === 'sync' && (
            <div>
              <SectionTitle>Synchronization</SectionTitle>
              <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
                <div style={{
                  background: c.syncStatus === 'Synced' ? 'linear-gradient(135deg,#11998e,#38ef7d)' : 'linear-gradient(135deg,#f5af19,#f12711)',
                  borderRadius: 12, padding: '14px 20px', color: '#fff', display: 'flex', alignItems: 'center', gap: 10
                }}>
                  <span className="material-icons-round" style={{ fontSize: 28 }}>{c.syncStatus === 'Synced' ? 'sync' : 'sync_problem'}</span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{c.syncStatus || 'Not Synced'}</div>
                    <div style={{ fontSize: '.72rem', opacity: .85 }}>Sync Status</div>
                  </div>
                </div>
              </div>

              <SectionTitle>Flagging</SectionTitle>
              {c.flagStatus && c.flagStatus !== 'None' ? (
                <div style={{
                  background: c.flagStatus === 'Resolved' ? 'rgba(39,174,96,.08)' : 'rgba(231,76,60,.08)',
                  border: `1px solid ${c.flagStatus === 'Resolved' ? 'rgba(39,174,96,.3)' : 'rgba(231,76,60,.3)'}`,
                  borderRadius: 10, padding: 16
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span className="material-icons-round" style={{ color: c.flagStatus === 'Resolved' ? 'var(--ok)' : 'var(--err)' }}>
                      {c.flagStatus === 'Resolved' ? 'check_circle' : 'flag'}
                    </span>
                    <strong style={{ color: c.flagStatus === 'Resolved' ? 'var(--ok)' : 'var(--err)' }}>{c.flagStatus}</strong>
                  </div>
                  {c.flagReason && <p style={{ margin: 0, fontSize: '.88rem' }}>{c.flagReason}</p>}
                </div>
              ) : (
                <div style={{ color: 'var(--ok)', display: 'flex', alignItems: 'center', gap: 6, fontSize: '.9rem' }}>
                  <span className="material-icons-round">check_circle</span> No flags — All clear
                </div>
              )}
            </div>
          )}

          {/* ===== TAB 9: FIRST BILL ===== */}
          {tab === 'firstbill' && (
            <div>
              <SectionTitle>First Electricity Bill After Solar</SectionTitle>
              {(c.firstBillDate || c.firstBillAmount > 0 || c.firstBillUnits > 0) ? (<>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 12, marginBottom: 20 }}>
                  <div style={{ background: 'linear-gradient(135deg,#667eea,#764ba2)', borderRadius: 12, padding: 16, color: '#fff', textAlign: 'center' }}>
                    <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{formatDate(c.firstBillDate) || '-'}</div>
                    <div style={{ fontSize: '.72rem', opacity: .85, marginTop: 4 }}>Bill Date</div>
                  </div>
                  {c.firstBillAmount > 0 && <div style={{ background: 'linear-gradient(135deg,#f093fb,#f5576c)', borderRadius: 12, padding: 16, color: '#fff', textAlign: 'center' }}>
                    <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{formatCurrency(c.firstBillAmount)}</div>
                    <div style={{ fontSize: '.72rem', opacity: .85, marginTop: 4 }}>Bill Amount</div>
                  </div>}
                  {c.firstBillUnits > 0 && <div style={{ background: 'linear-gradient(135deg,#11998e,#38ef7d)', borderRadius: 12, padding: 16, color: '#fff', textAlign: 'center' }}>
                    <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{c.firstBillUnits} kWh</div>
                    <div style={{ fontSize: '.72rem', opacity: .85, marginTop: 4 }}>Units Generated</div>
                  </div>}
                </div>
                {c.firstBillRemarks && (
                  <div style={{ background: 'rgba(26,58,122,.04)', borderRadius: 10, padding: 14 }}>
                    <div style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 6 }}>Remarks</div>
                    <p style={{ margin: 0, fontSize: '.88rem' }}>{c.firstBillRemarks}</p>
                  </div>
                )}
              </>) : (
                <EmptyState icon="receipt" title="No first bill recorded" message="First electricity bill details will appear here once added." />
              )}
            </div>
          )}

          {/* ===== TAB 10: NEXT O&M ===== */}
          {tab === 'om' && (
            <div>
              <SectionTitle>Service Schedule</SectionTitle>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 12, marginBottom: 20 }}>
                {c.firstServiceDate && <div style={{ background: 'linear-gradient(135deg,#667eea,#764ba2)', borderRadius: 12, padding: 14, color: '#fff', textAlign: 'center' }}>
                  <div style={{ fontWeight: 700, fontSize: '.95rem' }}>{formatDate(c.firstServiceDate)}</div>
                  <div style={{ fontSize: '.72rem', opacity: .85, marginTop: 4 }}>1st Service</div>
                </div>}
                {c.lastServiceDate && <div style={{ background: 'linear-gradient(135deg,#f5af19,#f12711)', borderRadius: 12, padding: 14, color: '#fff', textAlign: 'center' }}>
                  <div style={{ fontWeight: 700, fontSize: '.95rem' }}>{formatDate(c.lastServiceDate)}</div>
                  <div style={{ fontSize: '.72rem', opacity: .85, marginTop: 4 }}>Last Service</div>
                </div>}
                {c.nextServiceDate && <div style={{ background: 'linear-gradient(135deg,#11998e,#38ef7d)', borderRadius: 12, padding: 14, color: '#fff', textAlign: 'center' }}>
                  <div style={{ fontWeight: 700, fontSize: '.95rem' }}>{formatDate(c.nextServiceDate)}</div>
                  <div style={{ fontSize: '.72rem', opacity: .85, marginTop: 4 }}>Next Service</div>
                </div>}
              </div>
              <InfoGrid>
                {c.omServiceInterval && <InfoItem label="Service Interval" value={c.omServiceInterval} />}
              </InfoGrid>

              {c.serviceHistory && (<>
                <SectionTitle>Service History</SectionTitle>
                <div style={{ background: 'rgba(26,58,122,.04)', borderRadius: 10, padding: 14 }}>
                  <p style={{ margin: 0, fontSize: '.88rem', whiteSpace: 'pre-line' }}>{c.serviceHistory}</p>
                </div>
              </>)}

              {c.customerReference === 'Yes' && (<>
                <SectionTitle>Customer Reference</SectionTitle>
                <InfoGrid>
                  <InfoItem label="Reference Lead Name" value={c.referenceLeadName} />
                  <InfoItem label="Reference Phone" value={c.referencePhoneNumber} />
                </InfoGrid>
              </>)}

              {c.feedback && (<>
                <SectionTitle>Customer Feedback</SectionTitle>
                <div style={{ background: 'rgba(26,58,122,.04)', borderRadius: 10, padding: 14 }}>
                  <p style={{ margin: 0, fontSize: '.88rem' }}>{c.feedback}</p>
                </div>
              </>)}

              {!c.firstServiceDate && !c.nextServiceDate && !c.serviceHistory && !c.feedback && (
                <EmptyState icon="build_circle" title="No O&M data" message="Service schedule and maintenance history will appear here once added." />
              )}

              {/* Service reminder button */}
              {c.nextServiceDate && c.phone && (
                <div style={{ marginTop: 16 }}>
                  <button className="btn bo" onClick={() => sendWhatsApp(c.phone, `Hi ${c.name}, this is a reminder for your upcoming solar system service on ${formatDate(c.nextServiceDate)}. Please let us know if you need to reschedule. - Pragathi Solar`)} style={{ color: '#25d366', borderColor: 'rgba(37,211,102,.3)' }}>
                    <span className="material-icons-round" style={{ fontSize: 16 }}>send</span> Send Service Reminder via WhatsApp
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bottom action bar */}
        <div style={{ padding: '12px 24px', borderTop: '1px solid var(--bor)', display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap', background: 'var(--bg2)' }}>
          <button className="btn bsm bo" onClick={() => printCompletionReport(c, leadPOs, installations, leads)}>
            <span className="material-icons-round" style={{ fontSize: 15 }}>description</span> Completion Report
          </button>
          <button className="btn bsm bo" onClick={() => shareCompletionReportWhatsApp(c, leadPOs, installations, leads)} style={{ color: '#25d366', borderColor: 'rgba(37,211,102,.3)' }}>
            <span className="material-icons-round" style={{ fontSize: 15 }}>share</span> Share Report
          </button>
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
  const html = `<html><head><title>Completion Report - ${e(customer.name)}</title>
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
<table><thead><tr><th>#</th><th>Description of Material</th><th>UOM</th><th>Make</th><th>Model / Rating</th><th>Qty</th><th>Rate</th><th>Amount</th><th>Scope</th></tr></thead><tbody>
${(po.items || []).map((item, i) => `<tr><td>${i + 1}</td><td>${e(item.materialName)}</td><td>${e(item.unit) || 'Nos'}</td><td>${e(item.make) || '-'}</td><td>${e(item.specification) || '-'}</td><td>${item.quantity}</td><td>${Number(item.rate).toLocaleString('en-IN')}</td><td>${Number(item.amount).toLocaleString('en-IN')}</td><td>${[item.scopePragathi && 'Pragathi', item.scopeCustomer && 'Customer'].filter(Boolean).join(', ') || '-'}</td></tr>`).join('')}
<tr style="font-weight:700"><td colspan="7" style="text-align:right">BOM Total</td><td colspan="2">${fmtCur(po.totalValue)}</td></tr>
</tbody></table>
${extraItems.length > 0 ? `<h3>Extra Charges</h3><table class="info-tbl">${extraItems.map(ei => `<tr><td class="lbl">${ei.label}</td><td>${fmtCur(ei.val)}</td></tr>`).join('')}<tr style="font-weight:700"><td class="lbl">Extra Charges Total</td><td>${fmtCur(po.extraChargesTotal)}</td></tr></table>` : ''}
<p style="margin-top:8px"><strong>Price After Subsidy:</strong> ${fmtCur(po.agreedPrice || po.totalValue)}</p>
</div>
` : '<div class="section"><h2>Quotation / Purchase Order</h2><p style="color:#999">No purchase order found for this customer.</p></div>'}

<!-- Hand Sketch -->
<div class="section">
<h2>Hand Sketch</h2>
${(po && po.handSketch) || (inst && inst.handSketch) ? `<img class="sketch-img" src="${e((po && po.handSketch) || inst.handSketch)}" alt="Hand Sketch" />` : '<p style="color:#999">No hand sketch available.</p>'}
${(po && po.sketchWithSignature) || (inst && inst.sketchWithSignature) ? `<p style="margin-top:8px"><strong>Sketch with Signature:</strong></p><img class="sketch-img" src="${e((po && po.sketchWithSignature) || (inst && inst.sketchWithSignature))}" alt="Signed Sketch" />` : ''}
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
</body></html>`;
  openHtmlSafely(html, true);
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
