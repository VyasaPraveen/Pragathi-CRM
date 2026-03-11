import React, { useState } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { addDocument, updateDocument, deleteDocument, createNotification, notifyAdmins } from '../services/firestore';
import { formatCurrency, formatDate, safeStr, toNumber, daysSince, priorityClass, hasAccess, makeCall, sendWhatsApp, escapeHtml } from '../services/helpers';
import { StatusBadge, Modal, EmptyState } from '../components/SharedUI';
import { printPO, downloadPO, printBOM, downloadBOM, sharePOWhatsApp } from '../services/poUtils';

const refs = ['Website', 'Referral', 'Walk-in', 'Facebook Ad', 'Google Ad', 'Other'];
const fups = ['New Lead', 'Interested', 'Follow-up', 'Negotiating', 'No Response', 'Completed'];
const sts = ['Interested', 'Not Interested', 'Converted', 'Not Converted'];
const priorities = ['Hot', 'Warm', 'Cold'];
const PAGE_SIZE = 20;

const EMPTY_BOM_ITEM = { materialName: '', make: '', quantity: '', unit: 'Nos', specification: '', remarks: '', rate: '', amount: 0 };

const DEFAULT_BOM_MATERIALS = [
  'Solar PV Module',
  'Grid Tie Inverter (1KW - 1 Ph)', 'Grid Tie Inverter (2KW - 1 Ph)',
  'Grid Tie Inverter (3KW - 1 Ph)', 'Grid Tie Inverter (4KW - 1 Ph)',
  'Grid Tie Inverter (5KW - 1 Ph)', 'Grid Tie Inverter (5KW - 3 Ph)',
  'Grid Tie Inverter (6KW - 3 Ph)', 'Grid Tie Inverter (8KW - 3 Ph)',
  'Grid Tie Inverter (10KW - 3 Ph)',
  'Junction Box / ACDB', 'Junction Box / DCDB',
  'Earthing Kit', 'Lightning Arrestor', 'MC4 Connectors',
  'DC Cable', 'AC Cable', 'Earthing Cable',
  'Module Mounting Structure', 'Mounting Structure Bolts & Nuts',
  'Mounting Module Bolts & Nuts',
  'Other Accessories (UPVC Pipes / Earth PIT Caps / Earth Chemical)'
];

/* ============ MAIN LEADS LIST ============ */
export default function Leads() {
  const { leads, users, influencers } = useData();
  const { role } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [modal, setModal] = useState(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [detailId, setDetailId] = useState(null);
  const [detailTab, setDetailTab] = useState(null);

  // When 'all', exclude Converted leads (they move to Customers); Converted tab shows only converted
  let filtered = leads.filter(l => filter === 'all' ? l.status !== 'Converted' : l.status === filter);
  // B4 fix: null-safe search using safeStr
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(l =>
      safeStr(l.name).toLowerCase().includes(q) ||
      safeStr(l.phone).includes(q) ||
      safeStr(l.address).toLowerCase().includes(q) ||
      safeStr(l.email).toLowerCase().includes(q) ||
      safeStr(l.assignedTo).toLowerCase().includes(q) ||
      safeStr(l.city).toLowerCase().includes(q)
    );
  }

  // P2 fix: client-side pagination
  const displayed = filtered.slice(0, visibleCount);
  const hasMore = filtered.length > visibleCount;
  const detailLead = detailId ? leads.find(l => l.id === detailId) : null;

  const handleSave = async (data, id, prevStatus, prevExpectedSignUpDate) => {
    try {
      const cleaned = {
        ...data,
        expectedValue: toNumber(data.expectedValue),
        monthlyBill: toNumber(data.monthlyBill),
        floors: toNumber(data.floors),
        sanctionedLoad: toNumber(data.sanctionedLoad)
      };
      const prevLead = id ? leads.find(l => l.id === id) : null;
      if (id) {
        await updateDocument('leads', id, cleaned);
        toast('Lead updated');
        // Notify assigned user on lead update
        if (cleaned.assignedTo) {
          createNotification({ forUser: cleaned.assignedTo, title: 'Lead Updated', message: `Lead "${cleaned.name}" has been updated`, type: 'lead', module: 'leads', relatedId: id });
        }
        // Notify new assignee if assignment changed
        if (cleaned.assignedTo && prevLead && cleaned.assignedTo !== prevLead.assignedTo) {
          createNotification({ forUser: cleaned.assignedTo, title: 'Lead Assigned to You', message: `Lead "${cleaned.name}" has been assigned to you`, type: 'lead', module: 'leads', relatedId: id });
        }
        // Notify admin on status change
        if (prevStatus && cleaned.status !== prevStatus) {
          notifyAdmins(users, { title: 'Lead Status Changed', message: `Lead "${cleaned.name}" changed from ${prevStatus} to ${cleaned.status}`, type: 'lead', module: 'leads', relatedId: id });
        }
      } else {
        const newId = await addDocument('leads', cleaned);
        toast('Lead added');
        // Notify assigned user on new lead
        if (cleaned.assignedTo) {
          createNotification({ forUser: cleaned.assignedTo, title: 'New Lead Assigned', message: `New lead "${cleaned.name}" has been assigned to you`, type: 'lead', module: 'leads', relatedId: newId });
        }
        // Notify admins about new lead
        notifyAdmins(users, { title: 'New Lead Created', message: `New lead "${cleaned.name}" created`, type: 'lead', module: 'leads', relatedId: newId });
        // Auto-open lead detail on PO tab for the new lead
        setModal(null);
        setDetailTab('pos');
        setTimeout(() => setDetailId(newId), 300);
        return;
      }
      // Auto-create reminder for Expected Sign-Up Date (new or changed)
      if (cleaned.expectedSignUpDate && cleaned.expectedSignUpDate !== (prevExpectedSignUpDate || '')) {
        await addDocument('reminders', {
          type: 'Follow-up',
          customer: cleaned.name,
          phone: cleaned.phone || '',
          date: cleaned.expectedSignUpDate,
          message: 'Expected sign-up date for ' + cleaned.name + '. Follow up to confirm conversion.',
          status: 'Pending'
        });
        toast('Sign-up reminder auto-created');
      }
      // Auto-create influencer when referred by "Other" person (new referrer)
      if (cleaned.referredByType === 'Other' && cleaned.referredByName) {
        const exists = influencers.find(inf => inf.name.toLowerCase() === cleaned.referredByName.toLowerCase());
        if (!exists) {
          await addDocument('influencers', {
            name: cleaned.referredByName, phone: '', type: 'Individual', status: 'Active',
            notes: `Auto-created from lead referral by ${cleaned.name}`
          });
          toast(cleaned.referredByName + ' added as Influencer automatically');
        }
      }
      // Auto-create customer on first conversion (advance payment tracked separately in Customer)
      if (cleaned.status === 'Converted' && prevStatus !== 'Converted') {
        await addDocument('customers', {
          name: cleaned.name, phone: cleaned.phone, address: cleaned.address,
          email: cleaned.email || '', kwRequired: cleaned.kwRequired || '',
          city: cleaned.city || '', district: cleaned.district || '', pincode: cleaned.pincode || '',
          advanceAmount: toNumber(cleaned.advanceLeadAmount), secondPayment: 0, thirdPayment: 0, finalPayment: 0,
          totalPrice: 0, paymentType: 'Cash', agreedPrice: 0, bosAmount: 0,
          customerServiceNumber: cleaned.customerServiceNumber || '',
          status: 'Active'
        });
        toast(cleaned.name + ' auto-added to Customers!');
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
      <div className="card"><div className="cb" style={{ padding: 0 }}><div className="tw"><table style={{ fontSize: '.82rem' }}><thead><tr><th>Name / Phone</th><th>Address</th><th>Source</th><th>Priority</th><th>Assigned</th><th style={{ textAlign: 'center' }}>Visit</th><th style={{ textAlign: 'center' }}>Quote</th><th style={{ textAlign: 'center' }}>Advance</th><th>Status</th><th>Date</th><th>Age</th><th>Actions</th></tr></thead><tbody>
        {displayed.map(l => (
          <tr key={l.id}>
            <td style={{ minWidth: 120 }}><strong style={{ fontSize: '.84rem' }}>{l.name}</strong><br /><span style={{ fontSize: '.74rem', color: 'var(--muted)' }}>{l.phone}</span></td>
            <td style={{ maxWidth: 130, fontSize: '.78rem' }}>{l.address || '-'}</td>
            <td style={{ fontSize: '.78rem' }}>{l.leadReference || '-'}</td>
            <td>{l.priority ? <span className={`st ${priorityClass(l.priority)}`} style={{ padding: '3px 8px', fontSize: '.72rem' }}>{l.priority}</span> : <span style={{ color: 'var(--muted)' }}>-</span>}</td>
            <td style={{ fontSize: '.78rem' }}>{l.assignedTo || '-'}</td>
            <td style={{ textAlign: 'center' }}>{l.siteVisit === 'Yes' ? <span className="st st-g" style={{ padding: '2px 6px', fontSize: '.7rem' }}>Done</span> : <span style={{ color: 'var(--light)', fontSize: '.76rem' }}>No</span>}</td>
            <td style={{ textAlign: 'center' }}>{l.quotationSent === 'Yes' ? <span className="st st-g" style={{ padding: '2px 6px', fontSize: '.7rem' }}>Sent</span> : <span style={{ color: 'var(--light)', fontSize: '.76rem' }}>No</span>}</td>
            <td style={{ textAlign: 'center' }}>{l.advancePaid === 'Yes' ? <span className="st st-g" style={{ padding: '2px 6px', fontSize: '.7rem' }}>Paid</span> : <span style={{ color: 'var(--light)', fontSize: '.76rem' }}>No</span>}</td>
            <td><StatusBadge status={l.status} /></td>
            <td style={{ fontSize: '.76rem', whiteSpace: 'nowrap' }}>{formatDate(l.dateGenerated)}</td>
            <td style={{ fontSize: '.78rem', fontWeight: 600 }}>{daysSince(l.dateGenerated) != null ? daysSince(l.dateGenerated) + 'd' : '-'}</td>
            <td><div style={{ display: 'flex', gap: 3 }}>
              {l.phone && <button className="btn bsm bo" onClick={() => makeCall(l.phone)} title="Call" style={{ padding: '5px 8px', color: '#3b82f6', borderColor: 'rgba(59,130,246,.3)' }}><span className="material-icons-round" style={{ fontSize: 15 }}>call</span></button>}
              {l.phone && <button className="btn bsm bo" onClick={() => sendWhatsApp(l.phone, `Hi ${l.name}, this is from Pragathi Power Solutions regarding your solar enquiry.`)} title="WhatsApp" style={{ padding: '5px 8px', color: '#25d366', borderColor: 'rgba(37,211,102,.3)' }}><span className="material-icons-round" style={{ fontSize: 15 }}>chat</span></button>}
              <button className="btn bsm bo" onClick={() => setDetailId(l.id)} title="View Details" style={{ padding: '5px 8px' }}><span className="material-icons-round" style={{ fontSize: 15 }}>visibility</span></button>
              <button className="btn bsm bo" onClick={() => { setDetailTab('pos'); setDetailId(l.id); }} title="PO & BOM" style={{ padding: '5px 8px', color: '#6c5ce7', borderColor: 'rgba(108,92,231,.3)' }}><span className="material-icons-round" style={{ fontSize: 15 }}>receipt_long</span></button>
              <button className="btn bsm bo" onClick={() => setModal({ data: l, id: l.id })} title="Edit" style={{ padding: '5px 8px' }}><span className="material-icons-round" style={{ fontSize: 15 }}>edit</span></button>
              {hasAccess(role, 'admin') && <button className="btn bsm bo" onClick={() => handleDelete(l.id)} title="Delete" style={{ padding: '5px 8px', color: 'var(--err)', borderColor: 'rgba(231,76,60,.3)' }}><span className="material-icons-round" style={{ fontSize: 15 }}>delete</span></button>}
            </div></td>
          </tr>
        ))}
        {!filtered.length && <tr><td colSpan="12"><EmptyState icon="search_off" title="No leads found" message="Try adjusting filters or add a new lead." /></td></tr>}
      </tbody></table></div>
      {hasMore && <div style={{ textAlign: 'center', padding: 16 }}><button className="btn bsm bo" onClick={() => setVisibleCount(c => c + PAGE_SIZE)}>Show More ({filtered.length - visibleCount} remaining)</button></div>}
      </div></div>
      {modal && <LeadModal data={modal.data} id={modal.id} onSave={handleSave} onClose={() => setModal(null)} />}
      {detailLead && <LeadDetailModal lead={detailLead} initialTab={detailTab} onClose={() => { setDetailId(null); setDetailTab(null); }} />}
    </>
  );
}

/* ============ EDIT MODAL (UNCHANGED) ============ */
function LeadModal({ data, id, onSave, onClose }) {
  const { leads, customers, team, retailers, influencers } = useData();
  // B1 fix: track previous status to detect first conversion
  const prevStatus = data.status;
  const [form, setForm] = useState({
    name: data.name || '', phone: data.phone || '', address: data.address || '',
    email: data.email || '',
    leadReference: data.leadReference || 'Website', leadReferenceOther: data.leadReferenceOther || '', dateGenerated: data.dateGenerated || new Date().toISOString().slice(0, 10),
    lastFollowUp: data.lastFollowUp || '', followUpStatus: data.followUpStatus || 'New Lead',
    siteVisit: data.siteVisit || 'No', quotationSent: data.quotationSent || 'No',
    advancePaid: data.advancePaid || 'No', advanceLeadAmount: data.advanceLeadAmount || '', status: data.status || 'Interested',
    assignedTo: data.assignedTo || '', expectedValue: data.expectedValue || '',
    kwRequired: data.kwRequired || '', nextFollowUpDate: data.nextFollowUpDate || '',
    priority: data.priority || '', notes: data.notes || '',
    referredByType: data.referredByType || '', referredById: data.referredById || '',
    referredByName: data.referredByName || '',
    pincode: data.pincode || '', city: data.city || '', district: data.district || '',
    monthlyBill: data.monthlyBill || '',
    expectedSignUpDate: data.expectedSignUpDate || '',
    salesExecutive: data.salesExecutive || '',
    supportingTeam: data.supportingTeam || [],
    siteVisitDate: data.siteVisitDate || '', roofType: data.roofType || '',
    floors: data.floors || '', structureType: data.structureType || '',
    existingConnection: data.existingConnection || '', sanctionedLoad: data.sanctionedLoad || '',
    elevatedHeight: data.elevatedHeight || '', elevatedPole: data.elevatedPole || 'North Pole',
    customerServiceNumber: data.customerServiceNumber || data.meterNumber || '',
    availableSpace: data.availableSpace || '', siteVisitNotes: data.siteVisitNotes || ''
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const { toast } = useToast();
  const [cityOptions, setCityOptions] = useState([]);

  const handlePincodeChange = async (val) => {
    set('pincode', val);
    if (/^\d{6}$/.test(val)) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      try {
        const res = await fetch('https://api.postalpincode.in/pincode/' + val, { signal: ctrl.signal });
        clearTimeout(timer);
        const json = await res.json();
        if (json[0]?.Status === 'Success' && json[0]?.PostOffice?.length) {
          const offices = json[0].PostOffice;
          set('district', offices[0].District);
          const cities = [...new Set(offices.map(o => o.Name))];
          setCityOptions(cities);
          if (!form.city) set('city', cities[0]);
        } else {
          setCityOptions([]);
        }
      } catch { clearTimeout(timer); setCityOptions([]); }
    } else {
      setCityOptions([]);
    }
  };

  // Auto-calculate KW from monthly bill: KW = Total Consumption / 140
  const handleMonthlyBillChange = (val) => {
    set('monthlyBill', val);
    const bill = toNumber(val);
    if (bill > 0 && bill <= 100000) {
      set('kwRequired', (bill / 140).toFixed(2));
    }
  };

  // Duplicate phone detection
  const duplicatePhone = form.phone && leads.find(l => l.id !== id && l.phone === form.phone);

  return (
    <Modal title={id ? 'Edit Lead' : 'Add New Lead'} onClose={onClose} wide>
      <form onSubmit={e => {
        e.preventDefault();
        if (!id && !form.city.trim()) { toast('City is required for new leads', 'er'); return; }
        if (duplicatePhone && !window.confirm(`Phone ${form.phone} already exists for lead "${duplicatePhone.name}". Save anyway?`)) return;
        // Validation: Required KW must be <= Sanctioned Load
        const kw = toNumber(form.kwRequired);
        const sl = toNumber(form.sanctionedLoad);
        if (kw > 0 && sl > 0 && kw > sl) {
          alert(`⚠️ Sanctioned Load (${sl} kW) is less than Required KW (${kw} kW).\nPlease enhance the sanctioned load by ${(kw - sl).toFixed(2)} kW before proceeding.`);
          return;
        }
        // Validation: Available Space must be >= kwRequired * 70
        const minSpace = kw * 70;
        const space = toNumber(form.availableSpace);
        if (kw > 0 && space > 0 && space < minSpace) {
          alert(`⚠️ Not possible for installation!\nRequired space for ${kw} kW system: ${minSpace} sq.ft\nAvailable space entered: ${space} sq.ft\nRequired space is less than minimum for installation.`);
          return;
        }
        onSave(form, id, prevStatus, data.expectedSignUpDate || '');
      }}>
        <div className="mb">
          <div className="fr"><div className="fg"><label>Full Name *</label><input className="fi" value={form.name} onChange={e => set('name', e.target.value)} required /></div><div className="fg"><label>Phone *</label><input className="fi" value={form.phone} onChange={e => set('phone', e.target.value)} required /></div></div>
          {duplicatePhone && <div style={{ background: 'rgba(243,156,18,.1)', border: '1px solid rgba(243,156,18,.3)', borderRadius: 8, padding: '8px 12px', fontSize: '.82rem', color: '#d68910', marginBottom: 10 }}>Duplicate phone: already exists for <strong>{duplicatePhone.name}</strong></div>}
          <div className="fr3"><div className="fg"><label>Email</label><input type="email" className="fi" value={form.email} onChange={e => set('email', e.target.value)} /></div><div className="fg"><label>Monthly Bill (Units)</label><input type="number" className="fi" value={form.monthlyBill} onChange={e => handleMonthlyBillChange(e.target.value)} placeholder="e.g. 350" /></div><div className="fg"><label>kW Required</label><input className="fi" value={form.kwRequired} onChange={e => set('kwRequired', e.target.value)} placeholder="Auto or manual" /></div></div>
          <div className="fg"><label>Address</label><input className="fi" value={form.address} onChange={e => set('address', e.target.value)} /></div>
          <div className="fr3">
            <div className="fg"><label>Pincode</label><input className="fi" value={form.pincode} onChange={e => handlePincodeChange(e.target.value)} maxLength={6} placeholder="e.g. 500001" /></div>
            <div className="fg">
              <label>City {!id && '*'}</label>
              {cityOptions.length > 0
                ? <select className="fi" value={cityOptions.includes(form.city) ? form.city : '__other__'} onChange={e => { if (e.target.value === '__other__') set('city', ''); else set('city', e.target.value); }}>
                    <option value="">-- Select City --</option>
                    {cityOptions.map(c => <option key={c} value={c}>{c}</option>)}
                    <option value="__other__">Other (Enter manually)</option>
                  </select>
                : null}
              {(cityOptions.length === 0 || !cityOptions.includes(form.city))
                ? <input className="fi" style={cityOptions.length > 0 ? { marginTop: 6 } : {}} value={form.city} onChange={e => set('city', e.target.value)} placeholder="Enter city name" />
                : null}
            </div>
            <div className="fg"><label>District</label><input className="fi" value={form.district} onChange={e => set('district', e.target.value)} placeholder="District" /></div>
          </div>
          <div className="fr"><div className="fg"><label>Expected Value (₹)</label><input type="number" className="fi" value={form.expectedValue} onChange={e => set('expectedValue', e.target.value)} /></div><div className="fg"><label>Priority</label><select className="fi" value={form.priority} onChange={e => set('priority', e.target.value)}><option value="">-- Select --</option>{priorities.map(o => <option key={o}>{o}</option>)}</select></div></div>
          <div className="fr"><div className="fg"><label>Lead Reference</label><select className="fi" value={form.leadReference} onChange={e => set('leadReference', e.target.value)}>{refs.map(o => <option key={o}>{o}</option>)}</select></div><div className="fg"><label>Date Generated</label><input type="date" className="fi" value={form.dateGenerated} onChange={e => set('dateGenerated', e.target.value)} /></div></div>
          {form.leadReference === 'Other' && (
            <div className="fg"><label>Specify Other Source</label><input className="fi" value={form.leadReferenceOther} onChange={e => set('leadReferenceOther', e.target.value)} placeholder="Enter lead source details..." /></div>
          )}
          {form.leadReference === 'Referral' && (
            <div className="fr">
              <div className="fg"><label>Referred By</label><select className="fi" value={form.referredByType} onChange={e => { set('referredByType', e.target.value); set('referredById', ''); set('referredByName', ''); }}><option value="">-- Select Type --</option><option>Retailer</option><option>Influencer</option><option>Lead</option><option>Client</option><option>Other</option></select></div>
              {form.referredByType === 'Other'
                ? <div className="fg"><label>Referrer Name <span style={{ fontSize: '.74rem', color: 'var(--muted)', fontWeight: 400 }}>Will be auto-added as Influencer</span></label><input className="fi" value={form.referredByName} onChange={e => set('referredByName', e.target.value)} placeholder="Enter referrer's full name" /></div>
                : <div className="fg"><label>Select {form.referredByType || 'Referrer'}</label><select className="fi" value={form.referredById} onChange={e => {
                    const val = e.target.value;
                    set('referredById', val);
                    const list = form.referredByType === 'Retailer' ? retailers : form.referredByType === 'Influencer' ? influencers : form.referredByType === 'Lead' ? leads : form.referredByType === 'Client' ? customers : [];
                    const found = list.find(r => r.id === val);
                    set('referredByName', found ? found.name : '');
                  }}><option value="">-- Select --</option>{(form.referredByType === 'Retailer' ? retailers : form.referredByType === 'Influencer' ? influencers : form.referredByType === 'Lead' ? leads.filter(l => l.id !== id) : form.referredByType === 'Client' ? customers : []).filter(r => form.referredByType === 'Lead' || form.referredByType === 'Client' || r.status === 'Active').map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
              }
            </div>
          )}
          <div className="fr"><div className="fg"><label>Last Follow-up</label><input type="date" className="fi" value={form.lastFollowUp} onChange={e => set('lastFollowUp', e.target.value)} /></div><div className="fg"><label>Follow-up Status</label><select className="fi" value={form.followUpStatus} onChange={e => set('followUpStatus', e.target.value)}>{fups.map(o => <option key={o}>{o}</option>)}</select></div></div>
          <div className="fr"><div className="fg"><label>Assigned To</label><select className="fi" value={form.assignedTo} onChange={e => set('assignedTo', e.target.value)}><option value="">-- Unassigned --</option>{team.filter(t => t.status === 'Active').map(t => <option key={t.id} value={t.name}>{t.name}</option>)}</select></div><div className="fg"><label>Next Follow-up Date</label><input type="date" className="fi" value={form.nextFollowUpDate} onChange={e => set('nextFollowUpDate', e.target.value)} /></div></div>
          <div className="fr"><div className="fg"><label>Sales Executive</label><select className="fi" value={form.salesExecutive} onChange={e => set('salesExecutive', e.target.value)}><option value="">-- Select --</option>{team.filter(t => t.status === 'Active').map(t => <option key={t.id} value={t.name}>{t.name}</option>)}</select></div><div className="fg"><label>Expected Sign-up Date</label><input type="date" className="fi" value={form.expectedSignUpDate} onChange={e => set('expectedSignUpDate', e.target.value)} /></div></div>
          <div className="fg"><label>Supporting Team</label><div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '8px 12px', border: '1px solid var(--bor)', borderRadius: 8, minHeight: 38, background: '#fff' }}>{team.filter(t => t.status === 'Active').map(t => (<label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '.84rem', cursor: 'pointer' }}><input type="checkbox" checked={(form.supportingTeam || []).includes(t.name)} onChange={e => { const cur = form.supportingTeam || []; if (e.target.checked) set('supportingTeam', [...cur, t.name]); else set('supportingTeam', cur.filter(n => n !== t.name)); }} />{t.name}</label>))}{team.filter(t => t.status === 'Active').length === 0 && <span style={{ color: 'var(--muted)', fontSize: '.82rem' }}>No active team members</span>}</div></div>
          <div className="fr3"><div className="fg"><label>Site Visit</label><select className="fi" value={form.siteVisit} onChange={e => set('siteVisit', e.target.value)}><option>No</option><option>Yes</option></select></div><div className="fg"><label>Quotation Sent</label><select className="fi" value={form.quotationSent} onChange={e => set('quotationSent', e.target.value)}><option>No</option><option>Yes</option></select></div><div className="fg"><label>Advance Paid</label><select className="fi" value={form.advancePaid} onChange={e => { set('advancePaid', e.target.value); if (e.target.value === 'Yes' && !form.advanceLeadAmount) { const def = Math.round(toNumber(form.expectedValue) * 0.1); if (def > 0) set('advanceLeadAmount', def); } }}><option>No</option><option>Yes</option></select></div></div>
          {form.advancePaid === 'Yes' && (
            <div className="fg"><label>Advance Amount (₹) <span style={{ fontSize: '.76rem', color: 'var(--muted)', fontWeight: 400 }}>Default 10% of Expected Value</span></label><input type="number" className="fi" value={form.advanceLeadAmount} onChange={e => set('advanceLeadAmount', e.target.value)} placeholder={`e.g. ${Math.round(toNumber(form.expectedValue) * 0.1) || '10% of expected value'}`} /></div>
          )}
          {form.siteVisit === 'Yes' && (
            <div style={{ borderTop: '1px solid var(--bor)', margin: '14px 0', paddingTop: 14 }}>
              <label style={{ fontWeight: 700, fontSize: '.9rem', marginBottom: 10, display: 'block' }}>Site Visit Details</label>
              <div className="fr"><div className="fg"><label>Visit Date</label><input type="date" className="fi" value={form.siteVisitDate} onChange={e => set('siteVisitDate', e.target.value)} /></div><div className="fg"><label>Roof Type</label><select className="fi" value={form.roofType} onChange={e => set('roofType', e.target.value)}><option value="">-- Select --</option><option>RCC</option><option>Sheet</option><option>Tile</option><option>Elevated</option></select></div></div>
              {form.roofType === 'Elevated' && (
                <div className="fr"><div className="fg"><label>Height (Feet)</label><input type="number" className="fi" value={form.elevatedHeight} onChange={e => set('elevatedHeight', e.target.value)} placeholder="e.g. 10" min="1" /></div><div className="fg"><label>Pole Direction</label><select className="fi" value={form.elevatedPole} onChange={e => set('elevatedPole', e.target.value)}><option>North Pole</option><option>South Pole</option></select></div></div>
              )}
              <div className="fr3"><div className="fg"><label>Floors</label><input type="number" className="fi" value={form.floors} onChange={e => set('floors', e.target.value)} min="1" /></div><div className="fg"><label>Tilt</label><select className="fi" value={form.structureType} onChange={e => set('structureType', e.target.value)}><option value="">-- Select --</option><option>Flat</option><option>Sloped</option></select></div><div className="fg"><label>Existing Connection</label><select className="fi" value={form.existingConnection} onChange={e => set('existingConnection', e.target.value)}><option value="">-- Select --</option><option>Single Phase</option><option>Three Phase</option><option>CT Meter</option><option>HT Meter</option></select></div></div>
              <div className="fr"><div className="fg"><label>Sanctioned Load (kW)</label><input type="number" className="fi" value={form.sanctionedLoad} onChange={e => set('sanctionedLoad', e.target.value)} placeholder="e.g. 5" /></div><div className="fg"><label>Available Space (sq.ft) <span style={{ fontSize: '.74rem', color: 'var(--muted)', fontWeight: 400 }}>Min: {toNumber(form.kwRequired) > 0 ? (toNumber(form.kwRequired) * 70) + ' sq.ft' : 'kW × 70'}</span></label><input type="number" className="fi" value={form.availableSpace} onChange={e => set('availableSpace', e.target.value)} placeholder={toNumber(form.kwRequired) > 0 ? `Min ${toNumber(form.kwRequired) * 70} sq.ft` : 'e.g. 200'} /></div></div>
              <div className="fg"><label>Customer Service Number</label><input className="fi" value={form.customerServiceNumber} onChange={e => set('customerServiceNumber', e.target.value)} placeholder="Service number from electricity bill" /></div>
              <div className="fg"><label>Site Visit Notes</label><textarea className="fi" value={form.siteVisitNotes} onChange={e => set('siteVisitNotes', e.target.value)} rows="2" placeholder="Observations from site visit..." /></div>
            </div>
          )}
          <div className="fg"><label>Notes</label><textarea className="fi" value={form.notes} onChange={e => set('notes', e.target.value)} rows="3" placeholder="Follow-up notes..." /></div>
          <div className="fg"><label>Lead Status</label><select className="fi" value={form.status} onChange={e => set('status', e.target.value)}>{sts.map(o => <option key={o}>{o}</option>)}</select></div>
        </div>
        <div className="mf"><button type="button" className="btn bo" onClick={onClose}>Cancel</button><button type="submit" className="btn bp">{id ? 'Update' : 'Add'} Lead</button></div>
      </form>
    </Modal>
  );
}

/* ============ LEAD DETAIL MODAL (NEW) ============ */
function LeadDetailModal({ lead, initialTab, onClose }) {
  const [tab, setTab] = useState(initialTab || 'overview');
  const { leadPOs, installations } = useData();
  const { role, user } = useAuth();
  const { toast } = useToast();
  const [poModal, setPOModal] = useState(null);
  const [fupForm, setFupForm] = useState(false);
  const [fupData, setFupData] = useState({ date: new Date().toISOString().slice(0, 10), status: '', notes: '' });

  const myPOs = leadPOs.filter(po => po.leadId === lead.id);
  const history = lead.followUpHistory || [];

  /* Follow-up logging */
  const handleLogFollowUp = async () => {
    if (!fupData.date || !fupData.status) { toast('Date and status are required', 'er'); return; }
    try {
      const newEntry = { ...fupData, by: user?.email || 'unknown', at: new Date().toISOString() };
      const updated = [...history, newEntry];
      await updateDocument('leads', lead.id, {
        followUpHistory: updated,
        lastFollowUp: fupData.date,
        followUpStatus: fupData.status
      });
      toast('Follow-up logged');
      setFupForm(false);
      setFupData({ date: new Date().toISOString().slice(0, 10), status: '', notes: '' });
    } catch (e) { toast(e.message, 'er'); }
  };

  /* PO CRUD */
  const handlePOSave = async (data, poId) => {
    try {
      if (poId) {
        await updateDocument('leadPOs', poId, data);
        toast('PO updated');
      } else {
        await addDocument('leadPOs', data);
        toast('PO created');
      }
      /* Sync sketch to linked installation (match by customer name + phone) */
      if (data.handSketch || data.sketchWithSignature) {
        const linked = installations.find(inst =>
          inst.customerName === (data.customerName || lead.name) &&
          inst.phone === (data.customerPhone || lead.phone)
        );
        if (linked) {
          const sketchUpdate = {};
          if (data.handSketch) sketchUpdate.handSketch = data.handSketch;
          if (data.sketchWithSignature) sketchUpdate.sketchWithSignature = data.sketchWithSignature;
          await updateDocument('installations', linked.id, sketchUpdate);
          toast('Sketch synced to installation');
        }
      }
      setPOModal(null);
    } catch (e) { toast(e.message, 'er'); }
  };

  /* PO Workflow */
  const handleRecommend = async (po) => {
    if (!window.confirm('Recommend this PO for approval?')) return;
    try {
      await updateDocument('leadPOs', po.id, {
        status: 'Recommended',
        recommendedBy: user?.email || 'unknown',
        recommendedDate: new Date().toISOString().slice(0, 10)
      });
      toast('PO recommended for approval');
    } catch (e) { toast(e.message, 'er'); }
  };

  const handleApprove = async (po) => {
    if (!window.confirm('Approve this purchase order?')) return;
    try {
      await updateDocument('leadPOs', po.id, {
        status: 'Approved',
        approvedBy: user?.email || 'unknown',
        approvalDate: new Date().toISOString().slice(0, 10)
      });
      toast('PO approved');
    } catch (e) { toast(e.message, 'er'); }
  };

  const handleDeletePO = async (poId) => {
    if (!window.confirm('Delete this PO permanently?')) return;
    try {
      await deleteDocument('leadPOs', poId);
      toast('PO deleted');
    } catch (e) { toast(e.message, 'er'); }
  };

  const tabs = [
    ['overview', 'Overview', 'info'],
    ['followups', 'Follow-ups (' + history.length + ')', 'history'],
    ['pos', 'Purchase Orders (' + myPOs.length + ')', 'receipt_long']
  ];

  return (
    <div className="mo" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="md" style={{ width: '860px', maxWidth: '96vw' }}>
        <div className="mh">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="material-icons-round" style={{ fontSize: 22, color: 'var(--pri)' }}>person</span>
            {lead.name}
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
                {lead.phone && <button className="btn bsm bo" onClick={() => makeCall(lead.phone)} style={{ color: '#3b82f6', borderColor: 'rgba(59,130,246,.3)' }}>
                  <span className="material-icons-round" style={{ fontSize: 16 }}>call</span> Call
                </button>}
                {lead.phone && <button className="btn bsm bo" onClick={() => sendWhatsApp(lead.phone, `Hi ${lead.name}, this is from Pragathi Power Solutions regarding your solar enquiry.`)} style={{ color: '#25d366', borderColor: 'rgba(37,211,102,.3)' }}>
                  <span className="material-icons-round" style={{ fontSize: 16 }}>chat</span> WhatsApp
                </button>}
                <button className="btn bsm bo" onClick={() => shareLeadWhatsApp(lead)} style={{ color: '#25d366', borderColor: 'rgba(37,211,102,.3)' }}>
                  <span className="material-icons-round" style={{ fontSize: 16 }}>share</span> Share
                </button>
                <button className="btn bsm bo" onClick={() => printLeadSummary(lead)}>
                  <span className="material-icons-round" style={{ fontSize: 16 }}>print</span> Print Lead
                </button>
                <button className="btn bsm bp" onClick={() => generateQuotation(lead)}>
                  <span className="material-icons-round" style={{ fontSize: 16 }}>description</span> Quotation
                </button>
              </div>
              <div className="dg">
                <div className="di"><div className="dl">Phone</div><div className="dv">{lead.phone || '-'}</div></div>
                <div className="di"><div className="dl">Email</div><div className="dv">{lead.email || '-'}</div></div>
                <div className="di"><div className="dl">Address</div><div className="dv">{lead.address || '-'}</div></div>
                {(lead.city || lead.district || lead.pincode) && <div className="di"><div className="dl">Location</div><div className="dv">{[lead.city, lead.district, lead.pincode].filter(Boolean).join(', ') || '-'}</div></div>}
                {lead.monthlyBill ? <div className="di"><div className="dl">Monthly Bill</div><div className="dv">{lead.monthlyBill} Units</div></div> : null}
                <div className="di"><div className="dl">kW Required</div><div className="dv">{lead.kwRequired || '-'}</div></div>
                <div className="di"><div className="dl">Lead Reference</div><div className="dv">{lead.leadReference || '-'}</div></div>
                <div className="di"><div className="dl">Priority</div><div className="dv">{lead.priority ? <StatusBadge status={lead.priority} /> : '-'}</div></div>
                <div className="di"><div className="dl">Status</div><div className="dv"><StatusBadge status={lead.status} /></div></div>
                <div className="di"><div className="dl">Assigned To</div><div className="dv">{lead.assignedTo || '-'}</div></div>
                {lead.salesExecutive && <div className="di"><div className="dl">Sales Executive</div><div className="dv">{lead.salesExecutive}</div></div>}
                {lead.supportingTeam && lead.supportingTeam.length > 0 && <div className="di"><div className="dl">Supporting Team</div><div className="dv">{lead.supportingTeam.join(', ')}</div></div>}
                <div className="di"><div className="dl">Expected Value</div><div className="dv">{lead.expectedValue ? formatCurrency(lead.expectedValue) : '-'}</div></div>
                <div className="di"><div className="dl">Date Generated</div><div className="dv">{formatDate(lead.dateGenerated)}</div></div>
                {lead.expectedSignUpDate && <div className="di"><div className="dl">Expected Sign-up</div><div className="dv">{formatDate(lead.expectedSignUpDate)}</div></div>}
                <div className="di"><div className="dl">Site Visit</div><div className="dv">{lead.siteVisit || 'No'}</div></div>
                <div className="di"><div className="dl">Quotation Sent</div><div className="dv">{lead.quotationSent || 'No'}</div></div>
                <div className="di"><div className="dl">Advance Paid</div><div className="dv">{lead.advancePaid || 'No'}</div></div>
                <div className="di"><div className="dl">Follow-up Status</div><div className="dv">{lead.followUpStatus || '-'}</div></div>
                {lead.referredByName && <div className="di"><div className="dl">Referred By</div><div className="dv">{lead.referredByName} ({lead.referredByType})</div></div>}
                {lead.siteVisit === 'Yes' && (lead.roofType || lead.structureType || lead.existingConnection) && (
                  <>
                    <div className="di" style={{ gridColumn: '1 / -1' }}><div className="dl" style={{ fontWeight: 700 }}>Site Visit Details</div><div className="dv">{lead.siteVisitDate ? formatDate(lead.siteVisitDate) : ''}</div></div>
                    {lead.roofType && <div className="di"><div className="dl">Roof Type</div><div className="dv">{lead.roofType}</div></div>}
                    {lead.floors && <div className="di"><div className="dl">Floors</div><div className="dv">{lead.floors}</div></div>}
                    {lead.structureType && <div className="di"><div className="dl">Tilt</div><div className="dv">{lead.structureType}</div></div>}
                    {lead.roofType === 'Elevated' && lead.elevatedHeight && <div className="di"><div className="dl">Elevated Height</div><div className="dv">{lead.elevatedHeight} ft ({lead.elevatedPole || 'North Pole'})</div></div>}
                    {lead.existingConnection && <div className="di"><div className="dl">Connection</div><div className="dv">{lead.existingConnection}</div></div>}
                    {lead.sanctionedLoad && <div className="di"><div className="dl">Sanctioned Load</div><div className="dv">{lead.sanctionedLoad} kW</div></div>}
                    {lead.availableSpace && <div className="di"><div className="dl">Available Space</div><div className="dv">{lead.availableSpace} sq.ft</div></div>}
                    {(lead.customerServiceNumber || lead.meterNumber) && <div className="di"><div className="dl">Customer Service No.</div><div className="dv">{lead.customerServiceNumber || lead.meterNumber}</div></div>}
                    {lead.siteVisitNotes && <div className="di" style={{ gridColumn: '1 / -1' }}><div className="dl">Site Visit Notes</div><div className="dv">{lead.siteVisitNotes}</div></div>}
                  </>
                )}
                {lead.notes && <div className="di" style={{ gridColumn: '1 / -1' }}><div className="dl">Notes</div><div className="dv">{lead.notes}</div></div>}
              </div>
            </div>
          )}

          {/* -------- FOLLOW-UPS TAB -------- */}
          {tab === 'followups' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
                <button className="btn bsm bp" onClick={() => setFupForm(!fupForm)}>
                  <span className="material-icons-round" style={{ fontSize: 16 }}>{fupForm ? 'close' : 'add'}</span>
                  {fupForm ? 'Cancel' : 'Log Follow-up'}
                </button>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn bsm bo" onClick={() => shareFollowUpWhatsApp(lead)} style={{ color: '#25d366', borderColor: 'rgba(37,211,102,.3)' }}>
                    <span className="material-icons-round" style={{ fontSize: 16 }}>share</span> WhatsApp
                  </button>
                  <button className="btn bsm bo" onClick={() => printFollowUpHistory(lead)}>
                    <span className="material-icons-round" style={{ fontSize: 16 }}>print</span> Print History
                  </button>
                </div>
              </div>

              {/* Current follow-up info */}
              <div style={{ background: 'rgba(26,58,122,.04)', borderRadius: 10, padding: 16, marginBottom: 16, border: '1px solid var(--bor)' }}>
                <div style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 8 }}>Current Follow-up</div>
                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                  <div><span style={{ fontSize: '.8rem', color: 'var(--muted)' }}>Status:</span> <strong>{lead.followUpStatus || '-'}</strong></div>
                  <div><span style={{ fontSize: '.8rem', color: 'var(--muted)' }}>Last:</span> <strong>{lead.lastFollowUp || '-'}</strong></div>
                  <div><span style={{ fontSize: '.8rem', color: 'var(--muted)' }}>Next:</span> <strong>{lead.nextFollowUpDate || '-'}</strong></div>
                </div>
              </div>

              {/* Log follow-up form */}
              {fupForm && (
                <div style={{ background: '#fffbf0', borderRadius: 10, padding: 16, marginBottom: 16, border: '1px solid rgba(243,156,18,.3)' }}>
                  <div className="fr" style={{ marginBottom: 10 }}>
                    <div className="fg" style={{ marginBottom: 0 }}>
                      <label>Date *</label>
                      <input type="date" className="fi" value={fupData.date} onChange={e => setFupData(p => ({ ...p, date: e.target.value }))} />
                    </div>
                    <div className="fg" style={{ marginBottom: 0 }}>
                      <label>Status *</label>
                      <select className="fi" value={fupData.status} onChange={e => setFupData(p => ({ ...p, status: e.target.value }))}>
                        <option value="">-- Select --</option>
                        {fups.map(f => <option key={f}>{f}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="fg" style={{ marginBottom: 10 }}>
                    <label>Notes</label>
                    <textarea className="fi" value={fupData.notes} onChange={e => setFupData(p => ({ ...p, notes: e.target.value }))} rows="2" placeholder="Follow-up notes..." />
                  </div>
                  <button className="btn bsm bp" onClick={handleLogFollowUp}>
                    <span className="material-icons-round" style={{ fontSize: 16 }}>save</span> Save Follow-up
                  </button>
                </div>
              )}

              {/* Follow-up history table */}
              {history.length > 0 ? (
                <div className="tw">
                  <table>
                    <thead><tr><th>#</th><th>Date</th><th>Status</th><th>Notes</th><th>Logged By</th></tr></thead>
                    <tbody>
                      {[...history].reverse().map((h, i) => (
                        <tr key={`fup-${h.date}-${i}`}>
                          <td>{history.length - i}</td>
                          <td style={{ fontSize: '.84rem' }}>{h.date || '-'}</td>
                          <td><StatusBadge status={h.status} /></td>
                          <td style={{ maxWidth: 220, fontSize: '.84rem' }}>{h.notes || '-'}</td>
                          <td style={{ fontSize: '.82rem', color: 'var(--muted)' }}>{h.by || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState icon="history" title="No follow-up history" message="Use 'Log Follow-up' to start tracking follow-up activities." />
              )}
            </div>
          )}

          {/* -------- PURCHASE ORDERS TAB -------- */}
          {tab === 'pos' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
                <button className="btn bsm bp" onClick={() => setPOModal({ data: {} })}>
                  <span className="material-icons-round" style={{ fontSize: 16 }}>add</span> Create PO
                </button>
              </div>

              {myPOs.length > 0 ? (
                myPOs.map(po => (
                  <div key={po.id} style={{ border: '1px solid var(--bor)', borderRadius: 10, padding: 16, marginBottom: 12, background: '#fafbfc' }}>
                    {/* PO Header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <strong style={{ fontSize: '1rem' }}>{po.poNumber}</strong>
                        <StatusBadge status={po.status} />
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {/* Recommend: manager or admin, only Unapproved */}
                        {po.status === 'Unapproved' && (hasAccess(role, 'manager')) && (
                          <button className="btn bsm bo" onClick={() => handleRecommend(po)} style={{ color: '#d68910', borderColor: 'rgba(243,156,18,.3)' }}>
                            <span className="material-icons-round" style={{ fontSize: 16 }}>thumb_up</span> Recommend
                          </button>
                        )}
                        {/* Approve: admin only, only Recommended */}
                        {po.status === 'Recommended' && hasAccess(role, 'admin') && (
                          <button className="btn bsm bo" onClick={() => handleApprove(po)} style={{ color: 'var(--ok)', borderColor: 'rgba(0,184,148,.3)' }}>
                            <span className="material-icons-round" style={{ fontSize: 16 }}>check_circle</span> Approve
                          </button>
                        )}
                        {/* Print, Download & WhatsApp */}
                        <button className="btn bsm bo" onClick={() => printPO(po, lead)}>
                          <span className="material-icons-round" style={{ fontSize: 16 }}>print</span> Print PO
                        </button>
                        <button className="btn bsm bo" onClick={() => printBOM(po, lead)}>
                          <span className="material-icons-round" style={{ fontSize: 16 }}>print</span> Print BOM
                        </button>
                        <button className="btn bsm bo" onClick={() => downloadPO(po, lead)} style={{ color: '#6c5ce7', borderColor: 'rgba(108,92,231,.3)' }}>
                          <span className="material-icons-round" style={{ fontSize: 16 }}>download</span> PO
                        </button>
                        <button className="btn bsm bo" onClick={() => downloadBOM(po, lead)} style={{ color: '#6c5ce7', borderColor: 'rgba(108,92,231,.3)' }}>
                          <span className="material-icons-round" style={{ fontSize: 16 }}>download</span> BOM
                        </button>
                        <button className="btn bsm bo" onClick={() => sharePOWhatsApp(po)} style={{ color: '#25d366', borderColor: 'rgba(37,211,102,.3)' }}>
                          <span className="material-icons-round" style={{ fontSize: 16 }}>share</span> WhatsApp
                        </button>
                        {/* Edit: non-Approved, admin/manager */}
                        {po.status !== 'Approved' && (hasAccess(role, 'manager')) && (
                          <button className="btn bsm bo" onClick={() => setPOModal({ data: po, id: po.id })}>
                            <span className="material-icons-round" style={{ fontSize: 16 }}>edit</span>
                          </button>
                        )}
                        {/* Delete: admin only */}
                        {hasAccess(role, 'admin') && (
                          <button className="btn bsm bo" onClick={() => handleDeletePO(po.id)} style={{ color: 'var(--err)', borderColor: 'rgba(231,76,60,.3)' }}>
                            <span className="material-icons-round" style={{ fontSize: 16 }}>delete</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* PO Details Grid */}
                    <div className="dg" style={{ gap: 8 }}>
                      <div className="di"><div className="dl">PO Date</div><div className="dv">{po.poDate || '-'}</div></div>
                      <div className="di"><div className="dl">Vendor</div><div className="dv">{po.vendorName || '-'}</div></div>
                      {po.moduleCount && <div className="di"><div className="dl">Modules</div><div className="dv">{po.moduleCount}</div></div>}
                      {po.inverterDetails && <div className="di"><div className="dl">Inverter</div><div className="dv">{po.inverterDetails}</div></div>}
                      {po.plantLocation && <div className="di"><div className="dl">Plant Location</div><div className="dv">{po.plantLocation}</div></div>}
                      {po.referenceNumber && <div className="di"><div className="dl">Reference No.</div><div className="dv">{po.referenceNumber}</div></div>}
                      <div className="di"><div className="dl">Items</div><div className="dv">{(po.items || []).length} items</div></div>
                      <div className="di"><div className="dl">Total Value</div><div className="dv" style={{ fontWeight: 700 }}>{formatCurrency(po.totalValue)}</div></div>
                      {po.extraChargesTotal > 0 && <div className="di"><div className="dl">Extra Charges</div><div className="dv" style={{ fontWeight: 600, color: 'var(--sec)' }}>{formatCurrency(po.extraChargesTotal)}</div></div>}
                      {po.agreedPrice && <div className="di"><div className="dl">Price After Subsidy</div><div className="dv" style={{ fontWeight: 700, color: 'var(--pri)' }}>{formatCurrency(po.agreedPrice)}</div></div>}
                      <div className="di"><div className="dl">Created By</div><div className="dv" style={{ fontSize: '.84rem' }}>{po.createdBy || '-'}</div></div>
                      {po.recommendedBy && <div className="di"><div className="dl">Recommended By</div><div className="dv" style={{ fontSize: '.84rem' }}>{po.recommendedBy}<br /><span style={{ color: 'var(--muted)', fontSize: '.78rem' }}>{po.recommendedDate}</span></div></div>}
                      {po.approvedBy && <div className="di"><div className="dl">Approved By</div><div className="dv" style={{ fontSize: '.84rem' }}>{po.approvedBy}<br /><span style={{ color: 'var(--muted)', fontSize: '.78rem' }}>{po.approvalDate}</span></div></div>}
                    </div>

                    {/* Expandable line items */}
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
                  </div>
                ))
              ) : (
                <EmptyState icon="receipt_long" title="No purchase orders" message="Create a PO for this lead using the button above." />
              )}
            </div>
          )}
        </div>
      </div>

      {/* PO Create/Edit sub-modal */}
      {poModal && <LeadPOModal lead={lead} po={poModal.data} poId={poModal.id} existingPOs={leadPOs} onSave={handlePOSave} onClose={() => setPOModal(null)} />}
    </div>
  );
}

/* ============ LEAD PO CREATE/EDIT MODAL (NEW) ============ */
function LeadPOModal({ lead, po, poId, existingPOs, onSave, onClose }) {
  const { bomTemplates } = useData();
  const { role } = useAuth();
  const { toast } = useToast();
  const canManageTemplates = hasAccess(role, 'manager');
  const autoNumber = poId ? po.poNumber : generatePONumber(existingPOs);

  const [f, setF] = useState({
    poNumber: po.poNumber || autoNumber,
    poDate: po.poDate || new Date().toISOString().slice(0, 10),
    leadId: lead.id,
    leadName: lead.name,
    customerName: po.customerName || lead.name || '',
    customerPhone: po.customerPhone || lead.phone || '',
    customerAddress: po.customerAddress || lead.address || '',
    kwRequired: po.kwRequired || lead.kwRequired || '',
    vendorName: po.vendorName || 'M/S. Tata Power Solar Systems Limited',
    moduleCount: po.moduleCount || '',
    inverterDetails: po.inverterDetails || '',
    plantLocation: po.plantLocation || lead.address || '',
    referenceNumber: po.referenceNumber || '',
    companyScope: po.companyScope || 'System Supply and Installation as per BOM.',
    customerScope: po.customerScope || 'Civil works, UPVC Pipes, Additional cable if required more than 20 metres and Grid Synchronization Charges and Coordination with APSPDCL.',
    paymentTerms: po.paymentTerms || '80% Advance along with PO, 20% Before dispatching the materials against PI.',
    warrantyTerms: po.warrantyTerms || 'Solar Inverter \u2013 5 Yrs, Solar Modules- 5 Yrs +20 Yrs',
    deliveryTerms: po.deliveryTerms || '3-4 Weeks from the receipt of LOI /PO.',
    installationTerms: po.installationTerms || 'Within 10 days from the date of material received.',
    agreedPrice: po.agreedPrice || '',
    discomCharges: po.discomCharges || '',
    civilWork: po.civilWork || '',
    upvcPipes: po.upvcPipes || '',
    additionalRelay: po.additionalRelay || '',
    elevatedStructure: po.elevatedStructure || '',
    additionalBom: po.additionalBom || '',
    otherCharges: po.otherCharges || '',
    handSketch: po.handSketch || '',
    sketchWithSignature: po.sketchWithSignature || '',
    status: po.status || 'Unapproved',
    notes: po.notes || ''
  });
  const [items, setItems] = useState(
    (po.items && po.items.length)
      ? po.items.map(it => ({ ...EMPTY_BOM_ITEM, ...it }))
      : DEFAULT_BOM_MATERIALS.map(m => ({ ...EMPTY_BOM_ITEM, materialName: m }))
  );
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  const setItem = (idx, key, val) => {
    setItems(prev => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], [key]: val };
      if (key === 'quantity' || key === 'rate') {
        copy[idx].amount = toNumber(copy[idx].quantity) * toNumber(copy[idx].rate);
      }
      return copy;
    });
  };
  const addItem = () => setItems(prev => [...prev, { ...EMPTY_BOM_ITEM }]);
  const removeItem = (idx) => setItems(prev => prev.filter((_, i) => i !== idx));
  const totalValue = items.reduce((s, it) => s + toNumber(it.amount), 0);
  const extraChargesTotal = toNumber(f.discomCharges) + toNumber(f.civilWork) + toNumber(f.upvcPipes) + toNumber(f.additionalRelay) + toNumber(f.elevatedStructure) + toNumber(f.additionalBom) + toNumber(f.otherCharges);
  const autoScope = 'Supply and installation of ' + (f.kwRequired || '___') + ' Solar PV On-Grid System as per BOM.';

  /* Combined material suggestions: defaults + saved template materials */
  const allMaterials = [...new Set([
    ...DEFAULT_BOM_MATERIALS,
    ...bomTemplates.flatMap(t => (t.items || []).map(it => it.materialName).filter(Boolean))
  ])];

  /* Template operations */
  const loadTemplate = (templateId) => {
    const tpl = bomTemplates.find(t => t.id === templateId);
    if (!tpl || !tpl.items) return;
    if (items.some(it => it.materialName) && !window.confirm('This will replace current items. Continue?')) return;
    setItems(tpl.items.map(it => ({
      materialName: it.materialName || '',
      quantity: it.quantity || '',
      unit: it.unit || 'Nos',
      specification: it.specification || '',
      remarks: it.remarks || '',
      rate: '', amount: 0
    })));
    toast('Template "' + tpl.name + '" loaded');
  };

  const saveAsTemplate = async () => {
    const validItems = items.filter(it => it.materialName);
    if (!validItems.length) { toast('Add at least one material first', 'er'); return; }
    const name = window.prompt('Enter a name for this BOM template:');
    if (!name || !name.trim()) return;
    try {
      await addDocument('bomTemplates', {
        name: name.trim(),
        items: validItems.map(it => ({
          materialName: it.materialName || '',
          quantity: toNumber(it.quantity),
          unit: it.unit || '',
          specification: it.specification || '',
          remarks: it.remarks || ''
        }))
      });
      toast('BOM template saved');
    } catch (e) { toast(e.message, 'er'); }
  };

  return (
    <div className="mo" style={{ zIndex: 1001 }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="md" style={{ width: '740px', maxWidth: '96vw' }}>
        <div className="mh">
          <h3>{poId ? 'Edit Purchase Order' : 'Create Purchase Order'}</h3>
          <button className="mx" onClick={onClose}><span className="material-icons-round">close</span></button>
        </div>
        <form onSubmit={e => {
          e.preventDefault();
          const cleaned = {
            ...f,
            companyScope: f.companyScope || autoScope,
            items: items.filter(it => it.materialName || it.quantity).map(it => ({
              materialName: it.materialName || '',
              make: it.make || '',
              quantity: toNumber(it.quantity),
              unit: it.unit || '',
              specification: it.specification || '',
              remarks: it.remarks || '',
              rate: toNumber(it.rate),
              amount: toNumber(it.quantity) * toNumber(it.rate)
            })),
            totalValue,
            discomCharges: toNumber(f.discomCharges),
            civilWork: toNumber(f.civilWork),
            upvcPipes: toNumber(f.upvcPipes),
            additionalRelay: toNumber(f.additionalRelay),
            elevatedStructure: toNumber(f.elevatedStructure),
            additionalBom: toNumber(f.additionalBom),
            otherCharges: toNumber(f.otherCharges),
            extraChargesTotal,
            agreedPrice: toNumber(f.agreedPrice) || totalValue
          };
          onSave(cleaned, poId);
        }}>
          <div className="mb" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            <div className="fr">
              <div className="fg"><label>PO Number</label><input className="fi" value={f.poNumber} readOnly style={{ background: '#f0f4f8' }} /></div>
              <div className="fg"><label>PO Date *</label><input type="date" className="fi" value={f.poDate} onChange={e => set('poDate', e.target.value)} required /></div>
            </div>
            <div className="fr">
              <div className="fg"><label>Customer Name</label><input className="fi" value={f.customerName} onChange={e => set('customerName', e.target.value)} /></div>
              <div className="fg"><label>Customer Phone</label><input className="fi" value={f.customerPhone} onChange={e => set('customerPhone', e.target.value)} /></div>
            </div>
            <div className="fg"><label>Customer Address</label><input className="fi" value={f.customerAddress} onChange={e => set('customerAddress', e.target.value)} /></div>
            <div className="fr3">
              <div className="fg"><label>kW Required</label><input className="fi" value={f.kwRequired} onChange={e => set('kwRequired', e.target.value)} placeholder="e.g. 3kW" /></div>
              <div className="fg"><label>No. of Modules</label><input className="fi" value={f.moduleCount} onChange={e => set('moduleCount', e.target.value)} placeholder="e.g. 6" /></div>
              <div className="fg"><label>Inverter Details</label><input className="fi" value={f.inverterDetails} onChange={e => set('inverterDetails', e.target.value)} placeholder="e.g. 3KW 1-Ph" /></div>
            </div>
            <div className="fr">
              <div className="fg"><label>Vendor</label><input className="fi" value={f.vendorName} onChange={e => set('vendorName', e.target.value)} /></div>
              <div className="fg"><label>Reference Number</label><input className="fi" value={f.referenceNumber} onChange={e => set('referenceNumber', e.target.value)} placeholder="Quote/Ref No." /></div>
            </div>
            <div className="fg"><label>Plant Location / Building</label><input className="fi" value={f.plantLocation} onChange={e => set('plantLocation', e.target.value)} placeholder="Residential Building / location" /></div>

            {/* BOM Section with Templates */}
            <div style={{ borderTop: '1px solid var(--bor)', margin: '14px 0', paddingTop: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                <label style={{ fontWeight: 700, fontSize: '.9rem' }}>Bill of Materials (BOM)</label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  {bomTemplates.length > 0 && (
                    <select className="fi" style={{ width: 'auto', padding: '6px 30px 6px 10px', fontSize: '.82rem' }} defaultValue="" onChange={e => { if (e.target.value) loadTemplate(e.target.value); e.target.value = ''; }}>
                      <option value="">Load Template...</option>
                      {bomTemplates.map(t => <option key={t.id} value={t.id}>{t.name} ({(t.items || []).length} items)</option>)}
                    </select>
                  )}
                  {canManageTemplates && (
                    <button type="button" className="btn bsm bo" onClick={saveAsTemplate} title="Save current items as reusable template">
                      <span className="material-icons-round" style={{ fontSize: 16 }}>bookmark_add</span> Save Template
                    </button>
                  )}
                </div>
              </div>

              {items.map((item, i) => (
                <div key={i} style={{ border: '1px solid var(--bor)', borderRadius: 8, padding: '8px 10px', marginBottom: 8, background: '#fafbfc' }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
                    <div className="fg" style={{ flex: 3, marginBottom: 0 }}>{i === 0 && <label>Material</label>}<input className="fi" value={item.materialName} onChange={e => setItem(i, 'materialName', e.target.value)} list="bom-materials" placeholder="Material name" /></div>
                    <div className="fg" style={{ flex: 1, marginBottom: 0 }}>{i === 0 && <label>Qty</label>}<input type="number" className="fi" value={item.quantity} onChange={e => setItem(i, 'quantity', e.target.value)} /></div>
                    <div className="fg" style={{ flex: 0.8, marginBottom: 0 }}>{i === 0 && <label>Unit</label>}<input className="fi" value={item.unit} onChange={e => setItem(i, 'unit', e.target.value)} placeholder="Nos" /></div>
                    <div className="fg" style={{ flex: 1, marginBottom: 0 }}>{i === 0 && <label>Rate</label>}<input type="number" className="fi" value={item.rate} onChange={e => setItem(i, 'rate', e.target.value)} /></div>
                    <div className="fg" style={{ flex: 1, marginBottom: 0 }}>{i === 0 && <label>Amount</label>}<input className="fi" value={formatCurrency(toNumber(item.quantity) * toNumber(item.rate))} disabled /></div>
                    {items.length > 1 && <button type="button" className="btn bsm bo" onClick={() => removeItem(i)} style={{ color: 'var(--err)', marginBottom: 0 }}><span className="material-icons-round" style={{ fontSize: 16 }}>close</span></button>}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <div className="fg" style={{ flex: 1, marginBottom: 0 }}>{i === 0 && <label style={{ fontSize: '.76rem' }}>Make</label>}<input className="fi" style={{ fontSize: '.85rem' }} value={item.make} onChange={e => setItem(i, 'make', e.target.value)} placeholder="Brand / Make" /></div>
                    <div className="fg" style={{ flex: 1, marginBottom: 0 }}>{i === 0 && <label style={{ fontSize: '.76rem' }}>Model / Rating</label>}<input className="fi" style={{ fontSize: '.85rem' }} value={item.specification} onChange={e => setItem(i, 'specification', e.target.value)} placeholder="Model / Rating" /></div>
                    <div className="fg" style={{ flex: 1, marginBottom: 0 }}>{i === 0 && <label style={{ fontSize: '.76rem' }}>Remarks</label>}<input className="fi" style={{ fontSize: '.85rem' }} value={item.remarks} onChange={e => setItem(i, 'remarks', e.target.value)} placeholder="Remarks" /></div>
                  </div>
                </div>
              ))}
              <button type="button" className="btn bsm bo" onClick={addItem} style={{ marginTop: 6 }}>
                <span className="material-icons-round" style={{ fontSize: 16 }}>add</span> Add Item
              </button>
              <datalist id="bom-materials">{allMaterials.map(m => <option key={m} value={m} />)}</datalist>
              <div style={{ textAlign: 'right', fontWeight: 700, fontSize: '1rem', marginTop: 10 }}>Total: {formatCurrency(totalValue)}</div>
            </div>

            {/* Extra Charges Section */}
            <div style={{ borderTop: '1px solid var(--bor)', margin: '14px 0', paddingTop: 14 }}>
              <label style={{ fontWeight: 700, fontSize: '.9rem', marginBottom: 10, display: 'block' }}>Extra Charges</label>
              <div className="fr3">
                <div className="fg"><label>Discom Charges</label><input type="number" className="fi" value={f.discomCharges} onChange={e => set('discomCharges', e.target.value)} placeholder="0" /></div>
                <div className="fg"><label>Civil Work</label><input type="number" className="fi" value={f.civilWork} onChange={e => set('civilWork', e.target.value)} placeholder="0" /></div>
                <div className="fg"><label>UPVC Pipes</label><input type="number" className="fi" value={f.upvcPipes} onChange={e => set('upvcPipes', e.target.value)} placeholder="0" /></div>
              </div>
              <div className="fr3">
                <div className="fg"><label>Additional Relay</label><input type="number" className="fi" value={f.additionalRelay} onChange={e => set('additionalRelay', e.target.value)} placeholder="0" /></div>
                <div className="fg"><label>Elevated Structure</label><input type="number" className="fi" value={f.elevatedStructure} onChange={e => set('elevatedStructure', e.target.value)} placeholder="0" /></div>
                <div className="fg"><label>Additional BOM</label><input type="number" className="fi" value={f.additionalBom} onChange={e => set('additionalBom', e.target.value)} placeholder="0" /></div>
              </div>
              <div className="fr">
                <div className="fg"><label>Others</label><input type="number" className="fi" value={f.otherCharges} onChange={e => set('otherCharges', e.target.value)} placeholder="0" /></div>
                <div className="fg"><label>Extra Charges Total</label><input className="fi" value={extraChargesTotal > 0 ? formatCurrency(extraChargesTotal) : '₹0'} disabled style={{ fontWeight: 700, background: '#f0f4f8' }} /></div>
              </div>
            </div>

            <div className="fg"><label>Price After Subsidy (₹)</label><input type="number" className="fi" value={f.agreedPrice} onChange={e => set('agreedPrice', e.target.value)} placeholder={totalValue.toString()} /></div>

            {/* Terms & Scope */}
            <div style={{ borderTop: '1px solid var(--bor)', margin: '14px 0', paddingTop: 14 }}>
              <label style={{ fontWeight: 700, fontSize: '.9rem', marginBottom: 10, display: 'block' }}>Terms & Scope</label>
              <div className="fg"><label>Company Scope</label><input className="fi" value={f.companyScope} onChange={e => set('companyScope', e.target.value)} placeholder={autoScope} /></div>
              <div className="fg"><label>Customer Scope</label><input className="fi" value={f.customerScope} onChange={e => set('customerScope', e.target.value)} /></div>
              <div className="fr">
                <div className="fg"><label>Payment Terms</label><input className="fi" value={f.paymentTerms} onChange={e => set('paymentTerms', e.target.value)} /></div>
                <div className="fg"><label>Warranty</label><input className="fi" value={f.warrantyTerms} onChange={e => set('warrantyTerms', e.target.value)} /></div>
              </div>
              <div className="fr">
                <div className="fg"><label>Delivery Lead Time</label><input className="fi" value={f.deliveryTerms} onChange={e => set('deliveryTerms', e.target.value)} /></div>
                <div className="fg"><label>Installation</label><input className="fi" value={f.installationTerms} onChange={e => set('installationTerms', e.target.value)} /></div>
              </div>
            </div>

            {/* Sketches */}
            <div style={{ borderTop: '1px solid var(--bor)', margin: '14px 0', paddingTop: 14 }}>
              <label style={{ fontWeight: 700, fontSize: '.9rem', marginBottom: 10, display: 'block' }}>Sketches</label>
              <div className="fr">
                <div className="fg"><label>Hand Sketch URL</label><input className="fi" type="url" value={f.handSketch} onChange={e => set('handSketch', e.target.value)} placeholder="https://..." /></div>
                <div className="fg"><label>Sketch with Signature URL</label><input className="fi" type="url" value={f.sketchWithSignature} onChange={e => set('sketchWithSignature', e.target.value)} placeholder="https://..." /></div>
              </div>
              {(f.handSketch || f.sketchWithSignature) && (
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {f.handSketch && <div style={{ flex: 1, minWidth: 200, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--bor)' }}><img src={f.handSketch} alt="Hand Sketch" style={{ width: '100%', maxHeight: 150, objectFit: 'contain' }} onError={e => { e.target.style.display = 'none'; }} /></div>}
                  {f.sketchWithSignature && <div style={{ flex: 1, minWidth: 200, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--bor)' }}><img src={f.sketchWithSignature} alt="Signed Sketch" style={{ width: '100%', maxHeight: 150, objectFit: 'contain' }} onError={e => { e.target.style.display = 'none'; }} /></div>}
                </div>
              )}
            </div>

            <div className="fg"><label>Notes</label><textarea className="fi" value={f.notes} onChange={e => set('notes', e.target.value)} rows="2" /></div>
          </div>
          <div className="mf">
            <button type="button" className="btn bo" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn bp">{poId ? 'Update' : 'Create'} PO</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ============ UTILITY FUNCTIONS ============ */

function generatePONumber(existingPOs) {
  const now = new Date();
  const prefix = 'PO-' + now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0');
  const sameMonth = existingPOs.filter(p => (p.poNumber || '').startsWith(prefix));
  const maxNum = sameMonth.reduce((max, p) => {
    const parts = (p.poNumber || '').split('-');
    const num = parseInt(parts[2]) || 0;
    return Math.max(max, num);
  }, 0);
  return prefix + '-' + String(maxNum + 1).padStart(3, '0');
}

function generateQuotation(lead) {
  const l = lead || {};
  const e = escapeHtml;
  const kw = e(l.kwRequired || '___');
  const price = l.expectedValue ? Number(l.expectedValue).toLocaleString('en-IN') : '___________';
  const html = `<html><head><title>Quotation - ${e(l.name)}</title>
<style>
body{font-family:'Times New Roman',Times,serif;padding:40px 50px;line-height:1.7;font-size:14px;color:#000}
.hdr{text-align:center;border-bottom:2px solid #000;padding-bottom:12px;margin-bottom:16px}
.hdr img{max-height:60px;object-fit:contain}
.hdr p{margin:2px 0;font-size:11px}
h2{text-align:center;margin:10px 0 18px;font-size:17px;text-decoration:underline}
.date-line{text-align:right;margin-bottom:16px;font-size:13px}
.ref-line{margin-bottom:16px;font-size:13px}
.to-block{margin-bottom:16px;font-size:13px;line-height:1.6}
.to-block strong{font-size:14px}
.section{margin:16px 0;font-size:13px;line-height:1.8}
table{width:100%;border-collapse:collapse;margin:12px 0}
th,td{border:1px solid #000;padding:6px 10px;text-align:left;font-size:12px}
th{background:#f0f0f0;font-weight:700}
.terms td{border:none;padding:4px 10px 4px 0;font-size:12px;vertical-align:top}
.terms td:first-child{font-weight:600;white-space:nowrap}
.sig-section{margin-top:50px;display:flex;justify-content:space-between}
.sig-block{text-align:center;min-width:180px}
.sig-line{border-top:1px solid #000;margin-top:60px;padding-top:5px;font-size:11px}
.footer{margin-top:40px;font-size:10px;color:#999;text-align:center;border-top:1px solid #ccc;padding-top:8px}
@media print{body{padding:20px 30px}}
</style>
</head><body>
<div class="hdr">
<img src="/logo.png" alt="Pragathi Power Solutions" style="max-height:60px;object-fit:contain;margin-bottom:4px" onerror="this.style.display='none'" />
<p>19-3-12/J, Ramanuja Circle, Tiruchanoor Road, Tirupati-517501 | Mob: 9701426440 | Email: ppstirupathi@gmail.com</p>
<p style="font-weight:600">GST: 37AAOFP6349K2ZG</p>
</div>
<h2>QUOTATION</h2>
<div class="date-line">Date: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
<div class="ref-line">Ref: PPS/QTN/${new Date().getFullYear()}/${String(new Date().getMonth() + 1).padStart(2, '0')}</div>
<div class="to-block">
<strong>To,</strong><br/>
${e(l.name || '___________')},<br/>
${e(l.address || '___________')}${l.city ? ', ' + e(l.city) : ''}${l.district ? ', ' + e(l.district) : ''}${l.pincode ? ' - ' + e(l.pincode) : ''}<br/>
Ph: ${e(l.phone || '___________')}${l.email ? '<br/>Email: ' + e(l.email) : ''}
</div>
<div class="section">
<p><strong>Sub:</strong> Quotation for Supply &amp; Installation of <strong>${kw} kW</strong> Grid Connected Rooftop Solar Power Plant.</p>
<p>Dear Sir/Madam,</p>
<p>Thank you for showing interest in Solar Energy. We are pleased to submit our quotation for the supply and installation of a <strong>${kw} kW On-Grid Solar Power Plant</strong> at your premises.</p>
</div>

<table>
<thead><tr><th>Sl.</th><th>Description</th><th>Specification</th><th>Qty</th></tr></thead>
<tbody>
<tr><td>1</td><td>Solar Modules</td><td>545 Wp / 550 Wp Mono PERC (Tier-1)</td><td>${kw !== '___' ? Math.ceil(Number(kw) * 1000 / 545) : '___'}</td></tr>
<tr><td>2</td><td>Solar Inverter</td><td>${kw} kW On-Grid String Inverter</td><td>1</td></tr>
<tr><td>3</td><td>Module Mounting Structure</td><td>Hot-Dip Galvanized / Anodized Aluminum</td><td>1 Set</td></tr>
<tr><td>4</td><td>DC Cables</td><td>4 sq.mm / 6 sq.mm Solar DC Cable</td><td>As Required</td></tr>
<tr><td>5</td><td>AC Cables</td><td>As per inverter capacity</td><td>As Required</td></tr>
<tr><td>6</td><td>Earthing Kit</td><td>LA & Module Earthing</td><td>1 Set</td></tr>
<tr><td>7</td><td>AC/DC Distribution Box</td><td>SPD, MCB, Isolator</td><td>1 Set</td></tr>
<tr><td>8</td><td>Net Meter</td><td>Bi-directional (by DISCOM)</td><td>1</td></tr>
</tbody>
</table>

<p style="font-size:14px;margin-top:16px"><strong>Total Price: Rs. ${price}/- (Including GST)</strong></p>

<p style="margin-top:18px"><strong>Terms & Conditions:</strong></p>
<table class="terms">
<tr><td>Taxes</td><td>:</td><td>GST Included in the above price</td></tr>
<tr><td>Warranty</td><td>:</td><td>25 Years Performance Warranty on Solar Modules, 5 Years on Inverter</td></tr>
<tr><td>Payment Terms</td><td>:</td><td>80% Advance along with PO, 20% Before dispatch</td></tr>
<tr><td>Delivery</td><td>:</td><td>3-4 Weeks from the date of PO receipt</td></tr>
<tr><td>Installation</td><td>:</td><td>Within 10 days from material delivery</td></tr>
<tr><td>Validity</td><td>:</td><td>This quotation is valid for 15 days from the date of issue</td></tr>
<tr><td>Subsidy</td><td>:</td><td>Eligible under PM Surya Ghar / State Subsidy (subject to DISCOM approval)</td></tr>
</table>

${l.siteVisit === 'Yes' ? `
<p style="margin-top:16px"><strong>Site Details:</strong></p>
<table class="terms">
${l.roofType ? '<tr><td>Roof Type</td><td>:</td><td>' + e(l.roofType) + '</td></tr>' : ''}
${l.structureType ? '<tr><td>Tilt</td><td>:</td><td>' + e(l.structureType) + '</td></tr>' : ''}
${l.roofType === 'Elevated' && l.elevatedHeight ? '<tr><td>Elevated Height</td><td>:</td><td>' + e(l.elevatedHeight) + ' ft (' + e(l.elevatedPole || 'North Pole') + ')</td></tr>' : ''}
${l.existingConnection ? '<tr><td>Existing Connection</td><td>:</td><td>' + e(l.existingConnection) + '</td></tr>' : ''}
${l.sanctionedLoad ? '<tr><td>Sanctioned Load</td><td>:</td><td>' + e(l.sanctionedLoad) + ' kW</td></tr>' : ''}
${l.floors ? '<tr><td>Floors</td><td>:</td><td>' + e(l.floors) + '</td></tr>' : ''}
${l.availableSpace ? '<tr><td>Available Space</td><td>:</td><td>' + e(l.availableSpace) + ' sq.ft</td></tr>' : ''}
${(l.customerServiceNumber || l.meterNumber) ? '<tr><td>Customer Service No</td><td>:</td><td>' + e(l.customerServiceNumber || l.meterNumber) + '</td></tr>' : ''}
</table>` : ''}

<p style="margin-top:20px">We hope you find our offer competitive. Please feel free to contact us for any further clarification.</p>
<p>Thanking you,</p>
<div class="sig-section">
<div class="sig-block"><div class="sig-line">For Pragathi Power Solutions<br/>Authorized Signatory</div></div>
<div class="sig-block"><div class="sig-line">Customer Acceptance<br/>(Name & Signature)</div></div>
</div>
<div class="footer">Pragathi Power Solutions | 19-3-12/J, Tiruchanoor Road, Tirupati-517501 | 9701426440 | ppstirupathi@gmail.com</div>
</body></html>`;
  const w = window.open('', '_blank');
  if (!w) { alert('Popup blocked — please allow popups.'); return; }
  w.document.write(html);
  w.document.close();
  w.print();
}

function printLeadSummary(lead) {
  const w = window.open('', '_blank');
  if (!w) { alert('Popup blocked — please allow popups to print.'); return; }
  const e = escapeHtml;
  w.document.write(`<html><head><title>Lead - ${e(lead.name)}</title>
<style>body{font-family:Arial,sans-serif;padding:40px;line-height:1.6;color:#333}h1{font-size:20px;margin-bottom:5px;color:#1a3a7a}.sub{color:#666;font-size:13px;margin-bottom:20px}table{width:100%;border-collapse:collapse;margin:15px 0}th,td{text-align:left;padding:8px 12px;border-bottom:1px solid #eee;font-size:13px}th{color:#666;font-weight:600;width:35%}.footer{margin-top:30px;font-size:11px;color:#999;text-align:center}@media print{body{padding:20px}}</style>
</head><body>
<h1>Lead Summary: ${e(lead.name)}</h1>
<div class="sub">Phone: ${e(lead.phone || '-')} | Generated: ${e(lead.dateGenerated || '-')}</div>
<table>
<tr><th>Status</th><td>${e(lead.status || '-')}</td></tr>
<tr><th>Priority</th><td>${e(lead.priority || '-')}</td></tr>
<tr><th>Email</th><td>${e(lead.email || '-')}</td></tr>
<tr><th>Address</th><td>${e(lead.address || '-')}</td></tr>
${lead.city ? `<tr><th>City / District</th><td>${e(lead.city)}${lead.district ? ', ' + e(lead.district) : ''}${lead.pincode ? ' - ' + e(lead.pincode) : ''}</td></tr>` : ''}
${lead.monthlyBill ? `<tr><th>Monthly Bill</th><td>${e(lead.monthlyBill)} Units</td></tr>` : ''}
<tr><th>kW Required</th><td>${e(lead.kwRequired || '-')}</td></tr>
<tr><th>Expected Value</th><td>${lead.expectedValue ? '₹' + Number(lead.expectedValue).toLocaleString('en-IN') : '-'}</td></tr>
<tr><th>Assigned To</th><td>${e(lead.assignedTo || '-')}</td></tr>
${lead.salesExecutive ? `<tr><th>Sales Executive</th><td>${e(lead.salesExecutive)}</td></tr>` : ''}
${lead.supportingTeam && lead.supportingTeam.length ? `<tr><th>Supporting Team</th><td>${e(lead.supportingTeam.join(', '))}</td></tr>` : ''}
${lead.expectedSignUpDate ? `<tr><th>Expected Sign-up</th><td>${e(lead.expectedSignUpDate)}</td></tr>` : ''}
<tr><th>Lead Source</th><td>${e(lead.leadReference || '-')}</td></tr>
<tr><th>Site Visit</th><td>${e(lead.siteVisit || 'No')}</td></tr>
<tr><th>Quotation Sent</th><td>${e(lead.quotationSent || 'No')}</td></tr>
<tr><th>Advance Paid</th><td>${e(lead.advancePaid || 'No')}</td></tr>
<tr><th>Follow-up Status</th><td>${e(lead.followUpStatus || '-')}</td></tr>
<tr><th>Last Follow-up</th><td>${e(lead.lastFollowUp || '-')}</td></tr>
<tr><th>Next Follow-up</th><td>${e(lead.nextFollowUpDate || '-')}</td></tr>
${lead.referredByName ? `<tr><th>Referred By</th><td>${e(lead.referredByName)} (${e(lead.referredByType)})</td></tr>` : ''}
${lead.siteVisit === 'Yes' && lead.roofType ? `<tr><th>Site Visit</th><td>Done${lead.siteVisitDate ? ' (' + e(lead.siteVisitDate) + ')' : ''} | Roof: ${e(lead.roofType || '-')} | Floors: ${e(lead.floors || '-')} | Structure: ${e(lead.structureType || '-')} | Connection: ${e(lead.existingConnection || '-')}${lead.sanctionedLoad ? ' | Load: ' + e(lead.sanctionedLoad) + 'kW' : ''}${lead.availableSpace ? ' | Space: ' + e(lead.availableSpace) : ''}</td></tr>` : ''}
${lead.notes ? `<tr><th>Notes</th><td>${e(lead.notes)}</td></tr>` : ''}
</table>
<div class="footer">Pragathi Power Solutions — Printed on ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
</body></html>`);
  w.document.close();
  w.print();
}

function printFollowUpHistory(lead) {
  const history = lead.followUpHistory || [];
  const w = window.open('', '_blank');
  if (!w) { alert('Popup blocked — please allow popups to print.'); return; }
  const e = escapeHtml;
  w.document.write(`<html><head><title>Follow-up History - ${e(lead.name)}</title>
<style>body{font-family:Arial,sans-serif;padding:40px;line-height:1.6;color:#333}h1{font-size:18px;margin-bottom:5px;color:#1a3a7a}.sub{color:#666;font-size:13px;margin-bottom:20px}.cur{background:#f0f8f0;padding:12px 16px;border-radius:8px;margin-bottom:20px;font-size:13px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:8px 12px;text-align:left;font-size:13px}th{background:#f5f5f5;font-weight:600}.footer{margin-top:30px;font-size:11px;color:#999;text-align:center}@media print{body{padding:20px}}</style>
</head><body>
<h1>Follow-up History: ${e(lead.name)}</h1>
<div class="sub">Phone: ${e(lead.phone || '-')} | Status: ${e(lead.status || '-')} | Address: ${e(lead.address || '-')}</div>
<div class="cur"><strong>Current:</strong> ${e(lead.followUpStatus || '-')} | Last: ${e(lead.lastFollowUp || '-')} | Next: ${e(lead.nextFollowUpDate || '-')}</div>
${history.length > 0 ? `<table><thead><tr><th>#</th><th>Date</th><th>Status</th><th>Notes</th><th>Logged By</th></tr></thead><tbody>
${history.map((h, i) => `<tr><td>${i + 1}</td><td>${e(h.date || '-')}</td><td>${e(h.status || '-')}</td><td>${e(h.notes || '-')}</td><td>${e(h.by || '-')}</td></tr>`).join('')}
</tbody></table>` : '<p style="color:#999">No follow-up history recorded yet.</p>'}
<div class="footer">Pragathi Power Solutions — Printed on ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
</body></html>`);
  w.document.close();
  w.print();
}

/* PO/BOM print/download/share functions moved to ../services/poUtils.js */

/* ============ WHATSAPP SHARE - LEAD SUMMARY ============ */
function shareLeadWhatsApp(lead) {
  const msg = '*LEAD SUMMARY - ' + (lead.name || 'N/A') + '*\n\n' +
    'Phone: ' + (lead.phone || '-') + '\n' +
    (lead.email ? 'Email: ' + lead.email + '\n' : '') +
    (lead.address ? 'Address: ' + lead.address + '\n' : '') +
    (lead.city ? 'City: ' + lead.city + (lead.district ? ', ' + lead.district : '') + (lead.pincode ? ' - ' + lead.pincode : '') + '\n' : '') +
    (lead.monthlyBill ? 'Monthly Bill: ' + lead.monthlyBill + ' Units\n' : '') +
    'kW Required: ' + (lead.kwRequired || '-') + '\n' +
    'Status: ' + (lead.status || '-') + '\n' +
    'Priority: ' + (lead.priority || '-') + '\n' +
    (lead.expectedValue ? 'Expected Value: ₹' + Number(lead.expectedValue).toLocaleString('en-IN') + '\n' : '') +
    (lead.assignedTo ? 'Assigned To: ' + lead.assignedTo + '\n' : '') +
    (lead.salesExecutive ? 'Sales Executive: ' + lead.salesExecutive + '\n' : '') +
    (lead.supportingTeam && lead.supportingTeam.length ? 'Supporting Team: ' + lead.supportingTeam.join(', ') + '\n' : '') +
    (lead.expectedSignUpDate ? 'Expected Sign-up: ' + lead.expectedSignUpDate + '\n' : '') +
    'Lead Source: ' + (lead.leadReference || '-') + '\n' +
    (lead.referredByName ? 'Referred By: ' + lead.referredByName + ' (' + lead.referredByType + ')\n' : '') +
    'Date Generated: ' + (lead.dateGenerated || '-') + '\n\n' +
    'Site Visit: ' + (lead.siteVisit || 'No') + '\n' +
    'Quotation Sent: ' + (lead.quotationSent || 'No') + '\n' +
    'Advance Paid: ' + (lead.advancePaid || 'No') + '\n' +
    'Follow-up: ' + (lead.followUpStatus || '-') +
    (lead.nextFollowUpDate ? ' | Next: ' + lead.nextFollowUpDate : '') +
    (lead.notes ? '\n\nNotes: ' + lead.notes : '') +
    '\n\n_Pragathi Power Solutions_';

  if (lead.phone) {
    const phone = lead.phone.replace(/\D/g, '');
    window.open('https://wa.me/91' + phone + '?text=' + encodeURIComponent(msg), '_blank');
  } else {
    window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
  }
}

/* ============ WHATSAPP SHARE - FOLLOW-UP HISTORY ============ */
function shareFollowUpWhatsApp(lead) {
  const history = lead.followUpHistory || [];
  const historyText = history.length > 0
    ? history.map((h, i) => (i + 1) + '. ' + (h.date || '-') + ' - ' + (h.status || '-') + (h.notes ? ': ' + h.notes : '')).join('\n')
    : 'No follow-up history recorded.';

  const msg = '*FOLLOW-UP HISTORY - ' + (lead.name || 'N/A') + '*\n\n' +
    'Phone: ' + (lead.phone || '-') + '\n' +
    'Status: ' + (lead.status || '-') + '\n\n' +
    '*Current:* ' + (lead.followUpStatus || '-') +
    ' | Last: ' + (lead.lastFollowUp || '-') +
    ' | Next: ' + (lead.nextFollowUpDate || '-') + '\n\n' +
    '*History:*\n' + historyText +
    '\n\n_Pragathi Power Solutions_';

  if (lead.phone) {
    const phone = lead.phone.replace(/\D/g, '');
    window.open('https://wa.me/91' + phone + '?text=' + encodeURIComponent(msg), '_blank');
  } else {
    window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
  }
}
