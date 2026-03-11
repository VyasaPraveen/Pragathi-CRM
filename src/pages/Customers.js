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
    // Payment
    paymentType: data.paymentType || 'Cash',
    agreedPrice: data.agreedPrice || 0, bosAmount: data.bosAmount || 0, totalPrice: data.totalPrice || 0,
    advanceAmount: data.advanceAmount || 0, secondPayment: data.secondPayment || 0,
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

  const EDIT_TABS = [
    { key: 'info', label: 'Customer Info', icon: 'person' },
    { key: 'payment', label: 'Payment', icon: 'payments' },
    { key: 'dispatch', label: 'Dispatch', icon: 'local_shipping' },
    { key: 'installation', label: 'Installation', icon: 'construction' },
    { key: 'quality', label: 'Quality', icon: 'fact_check' },
    { key: 'warranty', label: 'Warranty', icon: 'verified_user' },
    { key: 'subsidy', label: 'Subsidy', icon: 'savings' },
    { key: 'sync', label: 'Sync & Flag', icon: 'sync' },
    { key: 'firstbill', label: 'First Bill', icon: 'receipt' },
    { key: 'om', label: 'O&M', icon: 'build_circle' },
  ];

  const tabStyle = (key) => ({
    padding: '9px 13px', fontWeight: 600, fontSize: '.78rem',
    color: tab === key ? 'var(--pri)' : 'var(--muted)',
    borderBottom: tab === key ? '2px solid var(--pri)' : '2px solid transparent',
    marginBottom: '-2px', display: 'flex', alignItems: 'center', gap: 4,
    background: 'none', border: 'none', borderBottomStyle: 'solid', cursor: 'pointer', whiteSpace: 'nowrap'
  });

  return (
    <Modal title={id ? 'Edit Customer' : 'Add Customer'} onClose={onClose} wide>
      <form onSubmit={e => { e.preventDefault(); onSave(f, id); }}>
        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--bor)', marginBottom: 16, overflowX: 'auto' }}>
          {EDIT_TABS.map(t => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)} style={tabStyle(t.key)}>
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
          {tab === 'payment' && (<>
            <div className="fg"><label>Payment Type</label><select className="fi" value={f.paymentType} onChange={e => set('paymentType', e.target.value)}><option>Cash</option><option>Finance</option></select></div>
            {f.paymentType === 'Cash' && (<>
              <div style={{ fontWeight: 700, fontSize: '.85rem', margin: '12px 0 8px' }}>Pricing</div>
              <div className="fr3"><div className="fg"><label>Agreed Price (₹)</label><input type="number" className="fi" value={f.agreedPrice} onChange={e => set('agreedPrice', e.target.value)} /></div><div className="fg"><label>BOS Amount (₹)</label><input type="number" className="fi" value={f.bosAmount} onChange={e => set('bosAmount', e.target.value)} /></div><div className="fg"><label>Total Price (₹)</label><input type="number" className="fi" value={f.totalPrice} onChange={e => set('totalPrice', e.target.value)} /></div></div>
              <div style={{ fontWeight: 700, fontSize: '.85rem', margin: '12px 0 8px' }}>Payment Tracking</div>
              <div className="fr"><div className="fg"><label>Advance (₹)</label><input type="number" className="fi" value={f.advanceAmount} onChange={e => set('advanceAmount', e.target.value)} /></div><div className="fg"><label>2nd Payment (₹)</label><input type="number" className="fi" value={f.secondPayment} onChange={e => set('secondPayment', e.target.value)} /></div></div>
              <div className="fr"><div className="fg"><label>3rd Payment (₹)</label><input type="number" className="fi" value={f.thirdPayment} onChange={e => set('thirdPayment', e.target.value)} /></div><div className="fg"><label>Final Payment (₹)</label><input type="number" className="fi" value={f.finalPayment} onChange={e => set('finalPayment', e.target.value)} /></div></div>
            </>)}
            {f.paymentType === 'Finance' && (<>
              <div className="fg"><label>Bank Name</label><input className="fi" value={f.bankName} onChange={e => set('bankName', e.target.value)} /></div>
              <div className="fr"><div className="fg"><label>Quotation Project Value (₹)</label><input type="number" className="fi" value={f.quotationProjectValue} onChange={e => set('quotationProjectValue', e.target.value)} /></div><div className="fg"><label>Total Price (₹)</label><input type="number" className="fi" value={f.totalPrice} onChange={e => set('totalPrice', e.target.value)} /></div></div>
              <div className="fr"><div className="fg"><label>Advance Received Date</label><input type="date" className="fi" value={f.advanceReceivedDate} onChange={e => set('advanceReceivedDate', e.target.value)} /></div><div className="fg"><label>Advance Received Amount (₹)</label><input type="number" className="fi" value={f.advanceReceivedAmount} onChange={e => set('advanceReceivedAmount', e.target.value)} /></div></div>
              <div className="fr"><div className="fg"><label>Final Amount Date</label><input type="date" className="fi" value={f.finalAmountDate} onChange={e => set('finalAmountDate', e.target.value)} /></div><div className="fg"><label>Final Amount (₹)</label><input type="number" className="fi" value={f.finalAmount} onChange={e => set('finalAmount', e.target.value)} /></div></div>
              <div className="fg"><label>BOS Amount Status</label><select className="fi" value={f.bosAmountStatus} onChange={e => set('bosAmountStatus', e.target.value)}><option>Included</option><option>Pending</option><option>Paid</option></select></div>
            </>)}
          </>)}

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
            {f.installationPicUrl && <img src={f.installationPicUrl} alt="Installation" style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--bor)', marginTop: 8 }} onError={e => { e.target.style.display = 'none'; }} />}
            {f.linkedInstallationId && <div className="fg" style={{ marginTop: 12 }}><label>Linked Installation ID</label><input className="fi" value={f.linkedInstallationId} disabled /></div>}
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
  const [instModal, setInstModal] = useState(false);
  const { leadPOs, leads, installations } = useData();
  const { role } = useAuth();
  const { toast } = useToast();
  const canEdit = hasAccess(role, 'coordinator');

  const handleInstSave = async (data, id) => {
    try {
      data.progress = Math.min(100, Math.max(0, toNumber(data.progress)));
      data.floors = toNumber(data.floors);
      if (id) {
        await updateDocument('installations', id, data);
        toast('Installation updated');
      } else {
        await addDocument('installations', { ...data, customerName: customer.name, phone: customer.phone });
        toast('Installation record created');
      }
      setInstModal(false);
    } catch (e) { toast(e.message, 'er'); }
  };

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

  const TABS = [
    { key: 'info', label: 'Customer Info', icon: 'person' },
    { key: 'payment', label: 'Payment Details', icon: 'payments' },
    { key: 'dispatch', label: 'Material Dispatch', icon: 'local_shipping' },
    { key: 'installation', label: 'Installation', icon: 'construction' },
    { key: 'quality', label: 'Quality Inspection', icon: 'fact_check' },
    { key: 'warranty', label: 'Warranty Details', icon: 'verified_user' },
    { key: 'subsidy', label: 'Subsidy Process', icon: 'savings' },
    { key: 'sync', label: 'Sync & Flagging', icon: 'sync' },
    { key: 'firstbill', label: 'First Bill', icon: 'receipt' },
    { key: 'om', label: 'Next O&M', icon: 'build_circle' },
  ];

  const tabStyle = (key) => ({
    padding: '11px 14px', fontWeight: 600, fontSize: '.8rem',
    color: tab === key ? 'var(--pri)' : 'var(--muted)',
    borderBottom: tab === key ? '2px solid var(--pri)' : '2px solid transparent',
    marginBottom: '-2px', display: 'flex', alignItems: 'center', gap: 5,
    background: 'none', border: 'none', borderBottomStyle: 'solid', cursor: 'pointer', whiteSpace: 'nowrap'
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
        <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--bor)', padding: '0 4px', overflowX: 'auto' }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={tabStyle(t.key)}>
              <span className="material-icons-round" style={{ fontSize: 16 }}>{t.icon}</span>{t.label}
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
                        <div className="tw"><table><thead><tr><th>#</th><th>Material</th><th>Make</th><th>Spec</th><th>Qty</th><th>Unit</th><th>Amount</th></tr></thead><tbody>
                          {po.items.map((item, i) => (
                            <tr key={i}><td>{i + 1}</td><td>{item.materialName}</td><td style={{ fontSize: '.8rem' }}>{item.make || '-'}</td><td style={{ fontSize: '.8rem', color: 'var(--muted)' }}>{item.specification || '-'}</td><td>{item.quantity}</td><td>{item.unit || '-'}</td><td style={{ fontWeight: 600 }}>{formatCurrency(item.amount)}</td></tr>
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
            <div>
              {/* Header actions */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="di" style={{ margin: 0 }}><div className="dl" style={{ marginBottom: 2 }}>Status</div><div className="dv"><StatusBadge status={c.installationStatus || 'Pending'} /></div></div>
                  {c.advancePaidDate && <div className="di" style={{ margin: 0 }}><div className="dl" style={{ marginBottom: 2 }}>Advance Paid</div><div className="dv">{formatDate(c.advancePaidDate)}</div></div>}
                </div>
                {canEdit && (
                  <button className="btn bp bsm" onClick={() => setInstModal(true)}>
                    <span className="material-icons-round" style={{ fontSize: 16 }}>{inst ? 'edit' : 'add'}</span>
                    {inst ? 'Edit Installation' : 'Create Installation Record'}
                  </button>
                )}
              </div>

              {inst ? (<>
                {/* Progress */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: '.88rem' }}>Installation Progress</span>
                    <span style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--pri)' }}>{inst.progress || 0}%</span>
                  </div>
                  <div style={{ height: 12, borderRadius: 8, background: 'var(--bor)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${inst.progress || 0}%`, background: 'linear-gradient(90deg,#667eea,#764ba2)', borderRadius: 8, transition: 'width .4s' }} />
                  </div>
                </div>

                {/* Team & Schedule */}
                <SectionTitle>Team & Schedule</SectionTitle>
                <InfoGrid>
                  <InfoItem label="Team Leader" value={inst.teamLeader} />
                  <InfoItem label="Team Size" value={inst.numPeople} />
                  <InfoItem label="Start Date" value={formatDate(inst.startDate)} />
                  <InfoItem label="Total Days" value={inst.totalDays} />
                </InfoGrid>

                {/* Site & Roof */}
                <SectionTitle>Site & Roof Details</SectionTitle>
                <InfoGrid>
                  <div className="di"><div className="dl">Site Visit</div><div className="dv"><span className={`st ${inst.siteVisitStatus === 'Visited' ? 'st-g' : 'st-x'}`}>{inst.siteVisitStatus || 'Not Visited'}</span></div></div>
                  <InfoItem label="Roof Type" value={inst.roofType} />
                  <InfoItem label="Floors" value={inst.floors} />
                  <InfoItem label="Structure" value={inst.structureType} />
                </InfoGrid>

                {/* Material & Quality */}
                <SectionTitle>Material & Quality</SectionTitle>
                <InfoGrid>
                  <div className="di"><div className="dl">Material Dispatched</div><div className="dv"><span className={`st ${inst.materialDispatched === 'Yes' ? 'st-g' : 'st-o'}`}>{inst.materialDispatched === 'Yes' ? 'Dispatched' : 'Pending'}</span></div></div>
                  <div className="di"><div className="dl">Quality Inspection</div><div className="dv"><StatusBadge status={inst.qualityInspection || 'Pending'} /></div></div>
                  <div className="di"><div className="dl">Guarantee Card</div><div className="dv"><span className={`st ${inst.guaranteeCard === 'Yes' ? 'st-g' : 'st-x'}`}>{inst.guaranteeCard === 'Yes' ? 'Issued' : 'Not Issued'}</span></div></div>
                </InfoGrid>

                {/* DISCOM & Subsidy */}
                <SectionTitle>DISCOM & Subsidy Process</SectionTitle>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10, marginBottom: 16 }}>
                  {[
                    { label: 'Feasibility', status: inst.discomFeasibility, date: inst.discomFeasibilityDate },
                    { label: 'Doc Submission', status: inst.docSubmission, date: inst.docSubmissionDate },
                    { label: 'DISCOM Inspection', status: inst.discomInspection, date: inst.discomInspectionDate },
                    { label: 'Meter Change', status: inst.meterChange, date: inst.meterChangeDate },
                    { label: 'Flagging', status: inst.flaggingStatus, date: inst.flaggingDate },
                    { label: 'Subsidy', status: inst.subsidyStatus, date: inst.subsidyDate },
                  ].map(row => (
                    <div key={row.label} style={{ border: '1px solid var(--bor)', borderRadius: 8, padding: '10px 12px', background: '#fafbfc' }}>
                      <div style={{ fontSize: '.72rem', color: 'var(--muted)', marginBottom: 4, textTransform: 'uppercase', fontWeight: 600 }}>{row.label}</div>
                      <StatusBadge status={row.status || 'Pending'} />
                      {row.date && <div style={{ fontSize: '.74rem', color: 'var(--muted)', marginTop: 4 }}>{formatDate(row.date)}</div>}
                    </div>
                  ))}
                </div>

                {/* Material Consumption */}
                <SectionTitle>Material Consumption</SectionTitle>
                <InfoGrid>
                  {inst.acCableQty && <InfoItem label="AC Cable" value={`${inst.acCableQty} mtrs${inst.acCableSize ? ' (' + inst.acCableSize + ')' : ''}`} />}
                  {inst.dcCableQty && <InfoItem label="DC Cable" value={`${inst.dcCableQty} mtrs${inst.dcCableSize ? ' (' + inst.dcCableSize + ')' : ''}`} />}
                  {inst.earthCable && <InfoItem label="Earth Cable" value={`${inst.earthCable} mtrs${inst.earthCableSize ? ' (' + inst.earthCableSize + ')' : ''}`} />}
                  {inst.upvcPipes && <InfoItem label="UPVC Pipes" value={`${inst.upvcPipes} pcs${inst.upvcPipeSize ? ' (' + inst.upvcPipeSize + ')' : ''}`} />}
                  {!inst.acCableQty && !inst.dcCableQty && !inst.earthCable && !inst.upvcPipes && <div className="di" style={{ gridColumn: '1 / -1' }}><div className="dv" style={{ color: 'var(--muted)' }}>No material consumption data entered</div></div>}
                </InfoGrid>

                {/* Service Dates */}
                <SectionTitle>Service Dates</SectionTitle>
                <InfoGrid>
                  <InfoItem label="1st Service Date" value={formatDate(inst.firstServiceDate)} />
                  <InfoItem label="Next Service Date" value={formatDate(inst.nextServiceDate)} />
                </InfoGrid>

                {/* Hand Sketch */}
                {inst.handSketch && (<>
                  <SectionTitle>Hand Sketch</SectionTitle>
                  <img src={inst.handSketch} alt="Hand Sketch" style={{ maxWidth: '100%', maxHeight: 280, objectFit: 'contain', borderRadius: 8, border: '1px solid var(--bor)' }} onError={e => { e.target.style.display = 'none'; }} />
                </>)}

                {/* Installation Report */}
                {inst.installationReport && (<>
                  <SectionTitle>Installation Report</SectionTitle>
                  <div style={{ background: '#fafbfc', borderRadius: 10, padding: 14, border: '1px solid var(--bor)', fontSize: '.88rem', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{inst.installationReport}</div>
                </>)}

                {/* Installation Picture (from customer) */}
                {c.installationPicUrl && (<>
                  <SectionTitle>Installation Picture</SectionTitle>
                  <img src={c.installationPicUrl} alt="Installation" style={{ width: '100%', maxHeight: 260, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--bor)' }} onError={e => { e.target.style.display = 'none'; }} />
                </>)}

              </>) : (
                <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                  <span className="material-icons-round" style={{ fontSize: 48, color: 'var(--muted)', opacity: .4 }}>construction</span>
                  <p style={{ color: 'var(--muted)', margin: '12px 0 16px' }}>No installation record linked to this customer yet.</p>
                  {canEdit && <button className="btn bp" onClick={() => setInstModal(true)}><span className="material-icons-round" style={{ fontSize: 16 }}>add</span> Create Installation Record</button>}
                </div>
              )}

              {/* Installation modal */}
              {instModal && <InstallationInlineModal data={inst || { customerName: c.name, phone: c.phone, address: c.address }} id={inst?.id} onSave={handleInstSave} onClose={() => setInstModal(false)} />}
            </div>
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

/* ============ INSTALLATION INLINE MODAL (from Customer view) ============ */
function InstallationInlineModal({ data, id, onSave, onClose }) {
  const d = data || {};
  const [f, setF] = useState({
    customerName: d.customerName || '', phone: d.phone || '', address: d.address || '',
    siteVisitStatus: d.siteVisitStatus || 'Not Visited',
    roofType: d.roofType || 'RCC', floors: d.floors || 1, structureType: d.structureType || 'Flat',
    startDate: d.startDate || '', totalDays: d.totalDays || '', teamLeader: d.teamLeader || '',
    numPeople: d.numPeople || '', materialDispatched: d.materialDispatched || 'No',
    progress: d.progress || 0,
    qualityInspection: d.qualityInspection || 'Pending', guaranteeCard: d.guaranteeCard || 'No',
    customerReference: d.customerReference || 'No',
    referenceLeadName: d.referenceLeadName || '', referencePhoneNumber: d.referencePhoneNumber || '',
    // DISCOM & Subsidy
    discomFeasibility: d.discomFeasibility || 'Pending', discomFeasibilityDate: d.discomFeasibilityDate || '',
    docSubmission: d.docSubmission || 'Pending', docSubmissionDate: d.docSubmissionDate || '',
    discomInspection: d.discomInspection || 'Pending', discomInspectionDate: d.discomInspectionDate || '',
    meterChange: d.meterChange || 'Pending', meterChangeDate: d.meterChangeDate || '',
    flaggingStatus: d.flaggingStatus || 'Pending', flaggingDate: d.flaggingDate || '',
    subsidyStatus: d.subsidyStatus || 'Not Applied', subsidyDate: d.subsidyDate || '',
    // Material Consumption
    acCableQty: d.acCableQty || '', acCableSize: d.acCableSize || '',
    dcCableQty: d.dcCableQty || '', dcCableSize: d.dcCableSize || '',
    earthCable: d.earthCable || '', earthCableSize: d.earthCableSize || '',
    upvcPipes: d.upvcPipes || '', upvcPipeSize: d.upvcPipeSize || '',
    // Service
    firstServiceDate: d.firstServiceDate || '', nextServiceDate: d.nextServiceDate || '',
    // Documents
    handSketch: d.handSketch || '', installationReport: d.installationReport || '',
  });
  const [tab, setTab] = useState('basic');
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  const ITABS = [
    { key: 'basic', label: 'Basic', icon: 'construction' },
    { key: 'discom', label: 'DISCOM & Subsidy', icon: 'account_balance' },
    { key: 'materials', label: 'Materials', icon: 'cable' },
    { key: 'docs', label: 'Documents', icon: 'description' },
  ];

  const ts = (key) => ({
    padding: '9px 13px', fontWeight: 600, fontSize: '.78rem',
    color: tab === key ? 'var(--pri)' : 'var(--muted)',
    borderBottom: tab === key ? '2px solid var(--pri)' : '2px solid transparent',
    marginBottom: '-2px', display: 'flex', alignItems: 'center', gap: 4,
    background: 'none', border: 'none', borderBottomStyle: 'solid', cursor: 'pointer', whiteSpace: 'nowrap'
  });

  return (
    <Modal title={id ? 'Edit Installation Record' : 'Create Installation Record'} onClose={onClose} wide>
      <form onSubmit={e => { e.preventDefault(); onSave(f, id); }}>
        <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--bor)', marginBottom: 16, overflowX: 'auto' }}>
          {ITABS.map(t => <button key={t.key} type="button" onClick={() => setTab(t.key)} style={ts(t.key)}><span className="material-icons-round" style={{ fontSize: 15 }}>{t.icon}</span>{t.label}</button>)}
        </div>
        <div className="mb">
          {/* Basic Tab */}
          {tab === 'basic' && (<>
            <div className="fr"><div className="fg"><label>Customer Name</label><input className="fi" value={f.customerName} onChange={e => set('customerName', e.target.value)} /></div><div className="fg"><label>Phone</label><input className="fi" value={f.phone} onChange={e => set('phone', e.target.value)} /></div></div>
            <div className="fr"><div className="fg"><label>Address</label><input className="fi" value={f.address} onChange={e => set('address', e.target.value)} /></div><div className="fg"><label>Site Visit Status</label><select className="fi" value={f.siteVisitStatus} onChange={e => set('siteVisitStatus', e.target.value)}><option>Not Visited</option><option>Visited</option></select></div></div>
            <div className="fr3"><div className="fg"><label>Roof Type</label><select className="fi" value={f.roofType} onChange={e => set('roofType', e.target.value)}><option>RCC</option><option>Sheet</option><option>Tile</option></select></div><div className="fg"><label>Floors</label><input type="number" className="fi" value={f.floors} onChange={e => set('floors', e.target.value)} /></div><div className="fg"><label>Structure</label><select className="fi" value={f.structureType} onChange={e => set('structureType', e.target.value)}><option>Flat</option><option>Sloped</option></select></div></div>
            <div className="fr3"><div className="fg"><label>Start Date</label><input type="date" className="fi" value={f.startDate} onChange={e => set('startDate', e.target.value)} /></div><div className="fg"><label>Total Days</label><input type="number" className="fi" value={f.totalDays} onChange={e => set('totalDays', e.target.value)} /></div><div className="fg"><label>Team Leader</label><input className="fi" value={f.teamLeader} onChange={e => set('teamLeader', e.target.value)} /></div></div>
            <div className="fr3"><div className="fg"><label>Team Size</label><input type="number" className="fi" value={f.numPeople} onChange={e => set('numPeople', e.target.value)} /></div><div className="fg"><label>Material Dispatched</label><select className="fi" value={f.materialDispatched} onChange={e => set('materialDispatched', e.target.value)}><option>No</option><option>Yes</option></select></div><div className="fg"><label>Progress %</label><input type="number" className="fi" value={f.progress} min="0" max="100" onChange={e => set('progress', e.target.value)} /></div></div>
            <div className="fr"><div className="fg"><label>Quality Inspection</label><select className="fi" value={f.qualityInspection} onChange={e => set('qualityInspection', e.target.value)}><option>Pending</option><option>Done</option><option>Approved</option></select></div><div className="fg"><label>Guarantee Card</label><select className="fi" value={f.guaranteeCard} onChange={e => set('guaranteeCard', e.target.value)}><option>No</option><option>Yes</option></select></div></div>
            <div className="fr"><div className="fg"><label>1st Service Date</label><input type="date" className="fi" value={f.firstServiceDate} onChange={e => set('firstServiceDate', e.target.value)} /></div><div className="fg"><label>Next Service Date</label><input type="date" className="fi" value={f.nextServiceDate} onChange={e => set('nextServiceDate', e.target.value)} /></div></div>
            <div className="fg"><label>Customer Reference?</label><select className="fi" value={f.customerReference} onChange={e => set('customerReference', e.target.value)}><option>No</option><option>Yes</option></select></div>
            {f.customerReference === 'Yes' && <div className="fr"><div className="fg"><label>Reference Lead Name</label><input className="fi" value={f.referenceLeadName} onChange={e => set('referenceLeadName', e.target.value)} /></div><div className="fg"><label>Reference Phone</label><input className="fi" value={f.referencePhoneNumber} onChange={e => set('referencePhoneNumber', e.target.value)} /></div></div>}
          </>)}
          {/* DISCOM & Subsidy Tab */}
          {tab === 'discom' && (<>
            <div style={{ fontWeight: 700, fontSize: '.85rem', marginBottom: 10 }}>DISCOM & Subsidy Tracking</div>
            {[
              { label: 'Feasibility Status', key: 'discomFeasibility', dateKey: 'discomFeasibilityDate', opts: ['Pending','Done','Approved'] },
              { label: 'Doc Submission', key: 'docSubmission', dateKey: 'docSubmissionDate', opts: ['Pending','Done','Approved'] },
              { label: 'DISCOM Inspection', key: 'discomInspection', dateKey: 'discomInspectionDate', opts: ['Pending','Done','Approved'] },
              { label: 'Meter Change', key: 'meterChange', dateKey: 'meterChangeDate', opts: ['Pending','Done'] },
              { label: 'Flagging', key: 'flaggingStatus', dateKey: 'flaggingDate', opts: ['Pending','Done'] },
              { label: 'Subsidy', key: 'subsidyStatus', dateKey: 'subsidyDate', opts: ['Not Applied','Pending','Approved','Released'] },
            ].map(row => (
              <div className="fr" key={row.key}>
                <div className="fg"><label>{row.label}</label><select className="fi" value={f[row.key]} onChange={e => set(row.key, e.target.value)}>{row.opts.map(o => <option key={o}>{o}</option>)}</select></div>
                <div className="fg"><label>Date</label><input type="date" className="fi" value={f[row.dateKey]} onChange={e => set(row.dateKey, e.target.value)} /></div>
              </div>
            ))}
          </>)}
          {/* Materials Tab */}
          {tab === 'materials' && (<>
            <div style={{ fontWeight: 700, fontSize: '.85rem', marginBottom: 10 }}>Material Consumption</div>
            <div className="fr"><div className="fg"><label>AC Cable Qty (mtrs)</label><input type="number" className="fi" value={f.acCableQty} onChange={e => set('acCableQty', e.target.value)} /></div><div className="fg"><label>AC Cable Size (mm)</label><input className="fi" value={f.acCableSize} onChange={e => set('acCableSize', e.target.value)} placeholder="e.g. 4mm" /></div></div>
            <div className="fr"><div className="fg"><label>DC Cable Qty (mtrs)</label><input type="number" className="fi" value={f.dcCableQty} onChange={e => set('dcCableQty', e.target.value)} /></div><div className="fg"><label>DC Cable Size (mm)</label><input className="fi" value={f.dcCableSize} onChange={e => set('dcCableSize', e.target.value)} placeholder="e.g. 6mm" /></div></div>
            <div className="fr"><div className="fg"><label>Earth Cable (mtrs)</label><input type="number" className="fi" value={f.earthCable} onChange={e => set('earthCable', e.target.value)} /></div><div className="fg"><label>Earth Cable Size (mm)</label><input className="fi" value={f.earthCableSize} onChange={e => set('earthCableSize', e.target.value)} placeholder="e.g. 4mm" /></div></div>
            <div className="fr"><div className="fg"><label>UPVC Pipes (pcs)</label><input type="number" className="fi" value={f.upvcPipes} onChange={e => set('upvcPipes', e.target.value)} /></div><div className="fg"><label>UPVC Pipe Size (mm)</label><input className="fi" value={f.upvcPipeSize} onChange={e => set('upvcPipeSize', e.target.value)} placeholder="e.g. 25mm" /></div></div>
          </>)}
          {/* Documents Tab */}
          {tab === 'docs' && (<>
            <div className="fg"><label>Hand Sketch URL</label><input className="fi" type="url" value={f.handSketch} onChange={e => set('handSketch', e.target.value)} placeholder="https://..." /></div>
            {f.handSketch && <img src={f.handSketch} alt="Hand Sketch" style={{ width: '100%', maxHeight: 200, objectFit: 'contain', borderRadius: 8, border: '1px solid var(--bor)', marginTop: 8 }} onError={e => { e.target.style.display = 'none'; }} />}
            <div className="fg" style={{ marginTop: 10 }}><label>Installation Report / Notes</label><textarea className="fi" value={f.installationReport} onChange={e => set('installationReport', e.target.value)} rows="4" placeholder="Enter installation report details..." /></div>
          </>)}
        </div>
        <div className="mf"><button type="button" className="btn bo" onClick={onClose}>Cancel</button><button type="submit" className="btn bp">{id ? 'Update' : 'Create'}</button></div>
      </form>
    </Modal>
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
