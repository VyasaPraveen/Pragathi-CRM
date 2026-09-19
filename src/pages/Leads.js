import React, { useState } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { addDocument, updateDocument, deleteDocument, createNotification, notifyAdmins } from '../services/firestore';
import { formatCurrency, formatDate, safeStr, toNumber, daysSince, priorityClass, hasAccess, makeCall, sendWhatsApp, escapeHtml, openHtmlSafely, normName as norm, supportingTeamOptions } from '../services/helpers';
import { StatusBadge, Modal, EmptyState, DateInput } from '../components/SharedUI';
import { printPO, downloadPO, printBOM, downloadBOM, sharePOWhatsApp } from '../services/poUtils';
import { can, ACTIONS, PO_STATUS, advanceGate, hasModule, canSeeLead, salesMembersOf, teamLeaders, quotationApprovers } from '../services/permissions';
import QuotationPanel from '../components/QuotationPanel';
import { QT_STATUS, DEFAULT_TARIFF, daysUntil, FOLLOWUP_REMIND_DAYS, quotationRef, bomFromPO } from '../services/quotation';

// The lead-reference names that come as standard. The field also takes a name
// typed by hand, for a referrer who is not on the list.
const refs = ['Website', 'Referral', 'Walk-in', 'Facebook Ad', 'Google Ad', 'Other'];
const fups = ['New Lead', 'Interested', 'Follow-up', 'Negotiating', 'No Response', 'Completed'];
const sts = ['Interested', 'Not Interested', 'Converted', 'Not Converted'];
const priorities = ['Hot', 'Warm', 'Cold'];
const payModes = ['PhonePe', 'Google Pay', 'Paytm', 'Cash', 'Bank Transfer', 'Cheque', 'Card', 'Other'];
const PAGE_SIZE = 20;
// The filter tab holding leads whose quotation was not accepted and that are
// waiting for their next follow-up.
const PENDING_FOLLOWUP = 'Pending Follow-up';

const EMPTY_BOM_ITEM = { materialName: '', make: '', quantity: '', actualQuantity: '', unit: 'Nos', specification: '', scopePragathi: false, scopeCustomer: false, rate: '', amount: 0 };

// Stable per-row keys so add/remove doesn't shuffle React DOM/focus (not persisted to Firestore)
let bomKeyCounter = 0;
const nextBomKey = () => 'bom_' + (bomKeyCounter++);

// The material catalogue, in the order of the official Bill of Materials sheet.
// The kW-specific inverter variants are kept at the end so nothing that could be
// picked before has been taken away.
const DEFAULT_BOM_MATERIALS = [
  { materialName: 'Solar PV Module', unit: 'Nos', make: 'Tata/Others' },
  { materialName: 'Grid Tie Inverter', unit: 'Nos', make: 'Tata/Others' },
  { materialName: 'Junction Box / ACDB', unit: 'Nos', make: '' },
  { materialName: 'Junction Box / DCDB', unit: 'Nos', make: '' },
  { materialName: 'Earthing Rods', unit: 'Nos', make: '' },
  { materialName: 'LA', unit: 'Nos', make: '' },
  { materialName: 'MC4 Connectors', unit: 'Nos', make: '' },
  { materialName: 'Earth Chemical Bags', unit: 'Nos', make: '' },
  { materialName: 'Earth Chambers', unit: 'Nos', make: '' },
  { materialName: 'DC Cable', unit: 'Mtrs', make: 'Polycab/Others' },
  { materialName: 'AC Cable', unit: 'Mtrs', make: 'Polycab/Others' },
  { materialName: 'Earthing Cable', unit: 'Mtrs', make: 'Polycab/Others' },
  { materialName: 'MMS -2/4 (PPS Standard)', unit: 'Nos', make: 'HOT DIP/Other' },
  { materialName: 'If Any Elevated MMS (Height)', unit: 'Nos', make: 'HOT DIP/Other' },
  { materialName: 'Additional AC Cable', unit: 'Mtrs', make: 'Polycab/Others' },
  { materialName: 'Additional DC Cable', unit: 'Mtrs', make: 'Polycab/Others' },
  { materialName: 'Additional Earth Cable', unit: 'Mtrs', make: 'Polycab/Others' },
  { materialName: 'UPVC Pipes & Fittings', unit: 'Mtrs', make: 'Finolex/Others' },
  { materialName: 'Civil Works', unit: 'Nos', make: 'Finolex/Others' },
  { materialName: 'Additional Relay', unit: 'Nos', make: '' },
  { materialName: 'DISCOM Charges', unit: 'Rs.', make: '' },
  { materialName: 'Ladder (Height)', unit: 'Nos', make: '' },
  { materialName: 'MCS - Cleaning System', unit: 'Nos', make: '' },
  { materialName: 'Additional Load', unit: '', make: '' },
  { materialName: 'Any Misc / Others', unit: '', make: '' },
  // kW-specific inverter variants (kept from the previous catalogue)
  { materialName: 'Grid Tie Inverter (1KW - 1 Ph)', unit: 'Nos', make: 'Tata/Others' },
  { materialName: 'Grid Tie Inverter (2KW - 1 Ph)', unit: 'Nos', make: 'Tata/Others' },
  { materialName: 'Grid Tie Inverter (3KW - 1 Ph)', unit: 'Nos', make: 'Tata/Others' },
  { materialName: 'Grid Tie Inverter (4KW - 1 Ph)', unit: 'Nos', make: 'Tata/Others' },
  { materialName: 'Grid Tie Inverter (5KW - 1 Ph)', unit: 'Nos', make: 'Tata/Others' },
  { materialName: 'Grid Tie Inverter (5KW - 3 Ph)', unit: 'Nos', make: 'Tata/Others' },
  { materialName: 'Grid Tie Inverter (6KW - 3 Ph)', unit: 'Nos', make: 'Tata/Others' },
  { materialName: 'Grid Tie Inverter (8KW - 3 Ph)', unit: 'Nos', make: 'Tata/Others' },
  { materialName: 'Grid Tie Inverter (10KW - 3 Ph)', unit: 'Nos', make: 'Tata/Others' },
  { materialName: 'Module Mounting Structure (2-4) Default Structure', unit: 'Nos', make: 'HOT DIP/Other' },
];

/* ============ MAIN LEADS LIST ============ */
export default function Leads() {
  const { leads, customers, users, influencers, team } = useData();
  const { role, user } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [modal, setModal] = useState(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [detailId, setDetailId] = useState(null);
  const [detailTab, setDetailTab] = useState(null);

  // A lead belongs to the person it is assigned to: they, the people working it
  // and the hierarchy above them see it — nobody else (19-Sep requirement 6).
  const myLeads = leads.filter(l => canSeeLead(l, user, role, users, team));

  // When 'all', exclude Converted leads (they move to Customers); Converted tab
  // shows only converted; "Pending Follow-up" holds the leads whose quotation
  // the customer did not accept, with a follow-up date recorded.
  let filtered = myLeads.filter(l => {
    if (filter === 'all') return l.status !== 'Converted';
    if (filter === PENDING_FOLLOWUP) return !!l.pendingFollowUp && l.status !== 'Converted';
    return l.status === filter;
  });
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
  const pendingFollowUpCount = myLeads.filter(l => l.pendingFollowUp && l.status !== 'Converted').length;

  // Who is doing the assigning — included in the notification so the employee
  // knows at a glance who gave them the lead.
  const assignedByName = user?.displayName || user?.email || 'a team leader';

  const handleSave = async (data, id, prevStatus, prevExpectedSignUpDate) => {
    try {
      const cleaned = {
        ...data,
        expectedValue: toNumber(data.expectedValue),
        monthlyBill: toNumber(data.monthlyBill),
        monthlyBillAmount: toNumber(data.monthlyBillAmount),
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
          createNotification({ forUser: cleaned.assignedTo, title: 'Lead Assigned to You', message: `${assignedByName} assigned you the lead "${cleaned.name}"${cleaned.phone ? ' · ' + cleaned.phone : ''}${cleaned.city ? ' · ' + cleaned.city : ''}`, type: 'lead', module: 'leads', relatedId: id });
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
          createNotification({ forUser: cleaned.assignedTo, title: 'New Lead Assigned', message: `${assignedByName} assigned you a new lead: "${cleaned.name}"${cleaned.phone ? ' · ' + cleaned.phone : ''}${cleaned.city ? ' · ' + cleaned.city : ''}`, type: 'lead', module: 'leads', relatedId: newId });
        }
        // Notify admins about new lead
        notifyAdmins(users, { title: 'New Lead Created', message: `New lead "${cleaned.name}" created`, type: 'lead', module: 'leads', relatedId: newId });
        // Auto-create customer if lead is created directly as Converted
        if (cleaned.status === 'Converted') {
          await addDocument('customers', {
            leadId: newId,
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
        // Auto-create reminder for Expected Sign-Up Date on new lead
        if (cleaned.expectedSignUpDate) {
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
        // Auto-create influencer when referred by "Other" person on new lead
        if (cleaned.referredByType === 'Other' && cleaned.referredByName) {
          const exists = influencers.find(inf => (inf.name || '').toLowerCase() === (cleaned.referredByName || '').toLowerCase());
          if (!exists) {
            await addDocument('influencers', {
              name: cleaned.referredByName, phone: '', type: 'Individual', status: 'Active',
              notes: `Auto-created from lead referral by ${cleaned.name}`
            });
            toast(cleaned.referredByName + ' added as Influencer automatically');
          }
        }
        // Close the form and return to the list (no auto-popup).
        setModal(null);
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
        const exists = influencers.find(inf => (inf.name || '').toLowerCase() === (cleaned.referredByName || '').toLowerCase());
        if (!exists) {
          await addDocument('influencers', {
            name: cleaned.referredByName, phone: '', type: 'Individual', status: 'Active',
            notes: `Auto-created from lead referral by ${cleaned.name}`
          });
          toast(cleaned.referredByName + ' added as Influencer automatically');
        }
      }
      // Auto-create customer on first conversion (advance payment tracked separately in Customer).
      // Guard against duplicates: skip if a customer already exists for this lead (by leadId or name+phone).
      const existingCustomer = customers.find(c => c.leadId === id || (c.phone === cleaned.phone && c.name === cleaned.name));
      if (cleaned.status === 'Converted' && prevStatus !== 'Converted' && !existingCustomer) {
        await addDocument('customers', {
          leadId: id,
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
            {['all', ...sts, PENDING_FOLLOWUP].map(s => (
              <span key={s} className={`fc ${filter === s ? 'act' : ''}`} onClick={() => setFilter(s)}>
                {s === 'all' ? 'All' : s}
                {s === PENDING_FOLLOWUP && pendingFollowUpCount > 0 ? ` (${pendingFollowUpCount})` : ''}
              </span>
            ))}
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
            <td>
              <StatusBadge status={l.status} />
              {l.pendingFollowUp && l.status !== 'Converted' && (() => {
                // Two days ahead of the follow-up date the chip turns red, which
                // is the same point the reminder pops up.
                const d = daysUntil(l.nextFollowUpDate);
                const soon = d != null && d <= FOLLOWUP_REMIND_DAYS;
                return (
                  <span className={`st ${soon ? 'st-r' : 'st-o'}`} style={{ padding: '2px 6px', fontSize: '.68rem', display: 'block', marginTop: 3 }}
                    title={l.notAcceptedReason || 'Pending follow-up'}>
                    {d == null ? 'Follow-up' : d < 0 ? `Follow-up overdue ${-d}d` : d === 0 ? 'Follow-up today' : `Follow-up in ${d}d`}
                  </span>
                );
              })()}
            </td>
            <td style={{ fontSize: '.76rem', whiteSpace: 'nowrap' }}>{formatDate(l.dateGenerated)}</td>
            <td style={{ fontSize: '.78rem', fontWeight: 600 }}>{daysSince(l.dateGenerated) != null ? daysSince(l.dateGenerated) + 'd' : '-'}</td>
            <td><div style={{ display: 'flex', gap: 3 }}>
              {l.phone && <button className="btn bsm bo" onClick={() => makeCall(l.phone)} title="Call" style={{ padding: '5px 8px', color: '#3b82f6', borderColor: 'rgba(59,130,246,.3)' }}><span className="material-icons-round" style={{ fontSize: 15 }}>call</span></button>}
              {l.phone && <button className="btn bsm bo" onClick={() => sendWhatsApp(l.phone, `Hi ${l.name}, this is from Pragathi Power Solutions regarding your solar enquiry.`)} title="WhatsApp" style={{ padding: '5px 8px', color: '#25d366', borderColor: 'rgba(37,211,102,.3)' }}><span className="material-icons-round" style={{ fontSize: 15 }}>chat</span></button>}
              <button className="btn bsm bo" onClick={() => setDetailId(l.id)} title="View Details" style={{ padding: '5px 8px' }}><span className="material-icons-round" style={{ fontSize: 15 }}>visibility</span></button>
              <button className="btn bsm bo" onClick={() => { setDetailTab('quotation'); setDetailId(l.id); }} title="Quotation" style={{ padding: '5px 8px', color: 'var(--pri)' }}><span className="material-icons-round" style={{ fontSize: 15 }}>description</span></button>
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
  const { leads, customers, team, retailers, influencers, users, settings } = useData();
  // The tariff used to convert a monthly bill amount into units, and back.
  const ebTariff = toNumber(settings?.ebTariff) || DEFAULT_TARIFF;
  // B1 fix: track previous status to detect first conversion
  const prevStatus = data.status;
  const [form, setForm] = useState({
    name: data.name || '', phone: data.phone || '', address: data.address || '',
    email: data.email || '',
    leadReference: data.leadReference || 'Website', leadReferenceOther: data.leadReferenceOther || '', dateGenerated: data.dateGenerated || new Date().toISOString().slice(0, 10),
    lastFollowUp: data.lastFollowUp || '', followUpStatus: data.followUpStatus || 'New Lead',
    siteVisit: data.siteVisit || 'No', quotationSent: data.quotationSent || 'No',
    advancePaid: data.advancePaid || 'No', advanceLeadAmount: data.advanceLeadAmount || '', status: data.status || 'Interested',
    modeOfPayment: data.modeOfPayment || '', modeOfPaymentOther: data.modeOfPaymentOther || '',
    assignedTo: data.assignedTo || '', expectedValue: data.expectedValue || '',
    kwRequired: data.kwRequired || '', nextFollowUpDate: data.nextFollowUpDate || '',
    priority: data.priority || '', notes: data.notes || '',
    referredByType: data.referredByType || '', referredById: data.referredById || '',
    referredByName: data.referredByName || '',
    pincode: data.pincode || '', city: data.city || '', district: data.district || '',
    monthlyBill: data.monthlyBill || '',
    monthlyBillAmount: data.monthlyBillAmount || '',
    teamLeader: data.teamLeader || '',
    expectedSignUpDate: data.expectedSignUpDate || '',
    salesExecutive: data.salesExecutive || '',
    supportingTeam: data.supportingTeam || [],
    siteVisitDate: data.siteVisitDate || '', roofType: data.roofType || '',
    floors: data.floors || '', structureType: data.structureType || '',
    existingConnection: data.existingConnection || '', sanctionedLoad: data.sanctionedLoad || '',
    elevatedNorthHeight: data.elevatedNorthHeight || data.elevatedHeight || '',
    elevatedSouthHeight: data.elevatedSouthHeight || '',
    customerServiceNumber: data.customerServiceNumber || data.meterNumber || '',
    availableSpace: data.availableSpace || '', siteVisitNotes: data.siteVisitNotes || ''
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const { toast } = useToast();
  const [cityOptions, setCityOptions] = useState([]);
  const [saving, setSaving] = useState(false);
  const [supportName, setSupportName] = useState('');

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
          if (offices[0]) set('district', offices[0].District);
          const cities = [...new Set(offices.map(o => o.Name))];
          setCityOptions(cities);
          if (!form.city && cities.length > 0) set('city', cities[0]);
        } else {
          setCityOptions([]);
        }
      } catch { clearTimeout(timer); setCityOptions([]); }
    } else {
      setCityOptions([]);
    }
  };

  // Auto-calculate KW from monthly consumption: KW = Total Consumption / 140
  const applyUnits = (units) => {
    const u = toNumber(units);
    if (u > 0 && u <= 100000) set('kwRequired', (u / 140).toFixed(2));
  };

  // Some customers know their units, others only remember the bill amount.
  // Either one fills the other in, using the system tariff.
  const handleMonthlyBillChange = (val) => {
    set('monthlyBill', val);
    const units = toNumber(val);
    if (units > 0) set('monthlyBillAmount', String(Math.round(units * ebTariff)));
    else set('monthlyBillAmount', '');
    applyUnits(val);
  };

  const handleMonthlyBillAmountChange = (val) => {
    set('monthlyBillAmount', val);
    const amount = toNumber(val);
    if (amount > 0 && ebTariff > 0) {
      const units = Math.round(amount / ebTariff);
      set('monthlyBill', String(units));
      applyUnits(units);
    } else {
      set('monthlyBill', '');
    }
  };

  // Duplicate phone detection
  const duplicatePhone = form.phone && leads.find(l => l.id !== id && l.phone === form.phone);

  // Team Leaders to pick from, and the sales-side members under the chosen one.
  const leaderOptions = teamLeaders(users);
  // Names already used in a field above — they cannot also be supporting team.
  const leaderName = (() => {
    const u = users.find(x => String(x.email || '').toLowerCase() === String(form.teamLeader || '').toLowerCase());
    return u ? (u.displayName || u.email) : '';
  })();
  const usedAbove = [form.salesExecutive, form.assignedTo, leaderName].map(norm).filter(Boolean);
  const supportOptions = supportingTeamOptions(team, usedAbove, form.supportingTeam);
  // A typed name is held to the same rule as a picked one.
  const addSupportName = () => {
    const nm = supportName.trim();
    setSupportName('');
    if (!nm) return;
    if (usedAbove.includes(norm(nm))) { toast(`${nm} is already named in a field above`, 'er'); return; }
    if ((form.supportingTeam || []).some(x => norm(x) === norm(nm))) return;
    set('supportingTeam', [...(form.supportingTeam || []), nm]);
  };

  // Taking someone on above removes them from the supporting list.
  const dropFromSupport = (name) => {
    const k = norm(name);
    if (!k) return;
    const cur = form.supportingTeam || [];
    if (cur.some(x => norm(x) === k)) set('supportingTeam', cur.filter(x => norm(x) !== k));
  };
  const assignOptions = (() => {
    const list = salesMembersOf(users, form.teamLeader).map(u => u.displayName || u.email).filter(Boolean);
    // Whoever the lead is already assigned to stays selectable, even if they
    // have no login or sit under a different leader.
    if (form.assignedTo && !list.includes(form.assignedTo)) list.unshift(form.assignedTo);
    return [...new Set(list)];
  })();

  return (
    <Modal title={id ? 'Edit Lead' : 'Add New Lead'} onClose={onClose} wide>
      <form onSubmit={async e => {
        e.preventDefault();
        if (saving) return;
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
        setSaving(true);
        try {
          // Anyone named in a field above is not also supporting team — this
          // tidies older leads that carry the same person twice.
          const cleanedForm = {
            ...form,
            supportingTeam: (form.supportingTeam || []).filter(n => !usedAbove.includes(norm(n))),
          };
          await onSave(cleanedForm, id, prevStatus, data.expectedSignUpDate || '');
        }
        finally { setSaving(false); }
      }}>
        <div className="mb">
          <div className="fr"><div className="fg"><label>Full Name *</label><input className="fi" value={form.name} onChange={e => set('name', e.target.value)} required /></div><div className="fg"><label>Phone *</label><input className="fi" value={form.phone} onChange={e => set('phone', e.target.value)} required /></div></div>
          {duplicatePhone && <div style={{ background: 'rgba(243,156,18,.1)', border: '1px solid rgba(243,156,18,.3)', borderRadius: 8, padding: '8px 12px', fontSize: '.82rem', color: '#d68910', marginBottom: 10 }}>Duplicate phone: already exists for <strong>{duplicatePhone.name}</strong></div>}
          <div className="fg"><label>Email</label><input type="email" className="fi" value={form.email} onChange={e => set('email', e.target.value)} /></div>
          {/* Either figure fills the other in — some customers know their units,
              others only remember what the bill comes to. */}
          <div className="fr3">
            <div className="fg"><label>Monthly Units</label><input type="number" className="fi" value={form.monthlyBill} onChange={e => handleMonthlyBillChange(e.target.value)} placeholder="e.g. 350" /></div>
            <div className="fg"><label>Monthly Current Bill (₹) <span style={{ fontSize: '.72rem', color: 'var(--muted)', fontWeight: 400 }}>@ ₹{ebTariff}/unit</span></label><input type="number" className="fi" value={form.monthlyBillAmount} onChange={e => handleMonthlyBillAmountChange(e.target.value)} placeholder="e.g. 2800" /></div>
            <div className="fg"><label>kW Required</label><input className="fi" value={form.kwRequired} onChange={e => set('kwRequired', e.target.value)} placeholder="Auto or manual" /></div>
          </div>
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
          <div className="fr">
            <div className="fg">
              <label>Lead Reference <span style={{ fontSize: '.72rem', color: 'var(--muted)', fontWeight: 400 }}>pick a name or type your own</span></label>
              <input className="fi" list="lead-reference-names" value={form.leadReference} onChange={e => set('leadReference', e.target.value)} placeholder="Select or enter a name" />
              <datalist id="lead-reference-names">
                {[...new Set([...refs, ...leads.map(l => l.leadReference).filter(Boolean)])].map(o => <option key={o} value={o} />)}
              </datalist>
            </div>
            <div className="fg"><label>Date Generated</label><DateInput value={form.dateGenerated} onChange={e => set('dateGenerated', e.target.value)} /></div>
          </div>
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
          <div className="fr"><div className="fg"><label>Last Follow-up</label><DateInput value={form.lastFollowUp} onChange={e => set('lastFollowUp', e.target.value)} /></div><div className="fg"><label>Follow-up Status</label><select className="fi" value={form.followUpStatus} onChange={e => set('followUpStatus', e.target.value)}>{fups.map(o => <option key={o}>{o}</option>)}</select></div></div>
          {/* Leads go to the Sales/Team members under the chosen Team Leader —
              the technical team is never offered here. */}
          <div className="fr3">
            <div className="fg"><label>Team Leader</label>
              <select className="fi" value={form.teamLeader} onChange={e => {
                const email = e.target.value;
                set('teamLeader', email);
                set('assignedTo', '');
                const u = users.find(x => String(x.email || '').toLowerCase() === email.toLowerCase());
                if (u) dropFromSupport(u.displayName || u.email);
              }}>
                <option value="">-- All sales members --</option>
                {leaderOptions.map(u => <option key={u.id || u.email} value={u.email}>{u.displayName || u.email}</option>)}
              </select>
            </div>
            <div className="fg"><label>Assigned To</label>
              <select className="fi" value={form.assignedTo} onChange={e => { set('assignedTo', e.target.value); dropFromSupport(e.target.value); }}>
                <option value="">-- Unassigned --</option>
                {assignOptions.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <small style={{ fontSize: '.72rem', color: 'var(--muted)' }}>
                {form.teamLeader
                  ? (assignOptions.length === 0
                      ? 'No members report to this Team Leader yet (Settings → Reports to).'
                      : 'Members of this Team Leader’s team.')
                  : 'All sales-side staff — the technical team is not listed.'}
              </small>
            </div>
            <div className="fg"><label>Next Follow-up Date</label><DateInput value={form.nextFollowUpDate} onChange={e => set('nextFollowUpDate', e.target.value)} /></div>
          </div>
          <div className="fr"><div className="fg"><label>Sales Executive</label><select className="fi" value={form.salesExecutive} onChange={e => {
            const val = e.target.value;
            set('salesExecutive', val);
            // Dedup: the selected Sales Executive should not also appear in Supporting Team
            dropFromSupport(val);
          }}><option value="">-- Select --</option>{team.filter(t => t.status === 'Active').map(t => <option key={t.id} value={t.name}>{t.name}</option>)}</select></div><div className="fg"><label>Expected Sign-up Date</label><DateInput value={form.expectedSignUpDate} onChange={e => set('expectedSignUpDate', e.target.value)} /></div></div>
          <div className="fg"><label>Supporting Team / Names</label>
            {/* Selected supporting names (team members + custom) as removable chips */}
            {(form.supportingTeam || []).length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {(form.supportingTeam || []).map(n => (
                  <span key={n} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(26,58,122,.08)', color: 'var(--pri)', padding: '3px 8px', borderRadius: 12, fontSize: '.8rem' }}>
                    {n}
                    <span className="material-icons-round" style={{ fontSize: 15, cursor: 'pointer' }} onClick={() => set('supportingTeam', (form.supportingTeam || []).filter(x => x !== n))}>close</span>
                  </span>
                ))}
              </div>
            )}
            {/* Pick a name from the list. Anyone already named in a field above
                (Team Leader, Assigned To, Sales Executive) is not offered, and
                neither is someone already on the list. */}
            <select className="fi" value="" onChange={e => {
              const n = e.target.value;
              if (n && !(form.supportingTeam || []).some(x => norm(x) === norm(n))) {
                set('supportingTeam', [...(form.supportingTeam || []), n]);
              }
            }}>
              <option value="">{supportOptions.length ? '-- Select a supporting member --' : '-- No other names available --'}</option>
              {supportOptions.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            {/* Add a custom supporting name not in the team list */}
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <input className="fi" value={supportName} onChange={e => setSupportName(e.target.value)} placeholder="Or type a name not on the list..." onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSupportName(); } }} />
              <button type="button" className="btn bsm bo" onClick={addSupportName}><span className="material-icons-round" style={{ fontSize: 16 }}>add</span> Add Name</button>
            </div>
          </div>
          <div className="fr3"><div className="fg"><label>Site Visit</label><select className="fi" value={form.siteVisit} onChange={e => set('siteVisit', e.target.value)}><option>No</option><option>Yes</option></select></div><div className="fg"><label>Quotation Sent</label><select className="fi" value={form.quotationSent} onChange={e => set('quotationSent', e.target.value)}><option>No</option><option>Yes</option></select></div><div className="fg"><label>Advance Paid</label><select className="fi" value={form.advancePaid} onChange={e => { set('advancePaid', e.target.value); if (e.target.value === 'Yes' && !form.advanceLeadAmount) { const def = Math.round(toNumber(form.expectedValue) * 0.1); if (def > 0) set('advanceLeadAmount', def); } }}><option>No</option><option>Yes</option></select></div></div>
          {form.advancePaid === 'Yes' && (
            <div className="fg"><label>Advance Amount (₹) <span style={{ fontSize: '.76rem', color: 'var(--muted)', fontWeight: 400 }}>Default 10% of Expected Value</span></label><input type="number" className="fi" value={form.advanceLeadAmount} onChange={e => set('advanceLeadAmount', e.target.value)} placeholder={`e.g. ${Math.round(toNumber(form.expectedValue) * 0.1) || '10% of expected value'}`} /></div>
          )}
          <div className="fr">
            <div className="fg"><label>Mode of Payment</label><select className="fi" value={form.modeOfPayment} onChange={e => set('modeOfPayment', e.target.value)}><option value="">-- Select --</option>{payModes.map(o => <option key={o}>{o}</option>)}</select></div>
            {form.modeOfPayment === 'Other'
              ? <div className="fg"><label>Specify Payment Mode</label><input className="fi" value={form.modeOfPaymentOther} onChange={e => set('modeOfPaymentOther', e.target.value)} placeholder="Enter payment method" /></div>
              : <div className="fg" />}
          </div>
          {form.siteVisit === 'Yes' && (
            <div style={{ borderTop: '1px solid var(--bor)', margin: '14px 0', paddingTop: 14 }}>
              <label style={{ fontWeight: 700, fontSize: '.9rem', marginBottom: 10, display: 'block' }}>Site Visit Details</label>
              <div className="fr"><div className="fg"><label>Visit Date</label><DateInput value={form.siteVisitDate} onChange={e => set('siteVisitDate', e.target.value)} /></div><div className="fg"><label>Roof Type</label><select className="fi" value={form.roofType} onChange={e => set('roofType', e.target.value)}><option value="">-- Select --</option><option>RCC</option><option>Sheet</option><option>Tile</option><option>Elevated</option></select></div></div>
              {form.roofType === 'Elevated' && (
                <div className="fr"><div className="fg"><label>North Pole Height (Feet)</label><input type="number" className="fi" value={form.elevatedNorthHeight} onChange={e => set('elevatedNorthHeight', e.target.value)} placeholder="e.g. 10" min="0" /></div><div className="fg"><label>South Pole Height (Feet)</label><input type="number" className="fi" value={form.elevatedSouthHeight} onChange={e => set('elevatedSouthHeight', e.target.value)} placeholder="e.g. 10" min="0" /></div></div>
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
        <div className="mf"><button type="button" className="btn bo" onClick={onClose}>Cancel</button><button type="submit" className="btn bp" disabled={saving}>{saving ? 'Saving...' : ((id ? 'Update' : 'Add') + ' Lead')}</button></div>
      </form>
    </Modal>
  );
}

/* ============ LEAD DETAIL MODAL (NEW) ============ */
function LeadDetailModal({ lead, initialTab, onClose }) {
  const [tab, setTab] = useState(initialTab || 'overview');
  const { leadPOs, installations, users, quotations } = useData();
  const { role, user } = useAuth();
  const { toast } = useToast();
  const [poModal, setPOModal] = useState(null);
  const [fupForm, setFupForm] = useState(false);
  const [fupData, setFupData] = useState({ date: new Date().toISOString().slice(0, 10), status: '', notes: '' });

  const myPOs = leadPOs.filter(po => po.leadId === lead.id);
  const history = lead.followUpHistory || [];
  // PO and BOM are the stage after the customer accepts the quotation.
  const myQuote = quotations.find(q => q.leadId === lead.id) || null;
  const quoteAccepted = myQuote ? myQuote.status === QT_STATUS.ACCEPTED : null;

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
      // The concerned hierarchy — Operation Manager, Management, Admin, Owner —
      // must be able to track the follow-ups the Executive performs.
      quotationApprovers(users).forEach(u => createNotification({
        forUser: u.displayName || u.email,
        title: 'Follow-up Logged',
        message: `${user?.displayName || user?.email || 'An executive'} logged a follow-up on "${lead.name}" — ${fupData.status}${fupData.notes ? ': ' + fupData.notes : ''}`,
        type: 'lead', module: 'leads', relatedId: lead.id,
      }));
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

  /* PO Workflow — gated by the role matrix + mandatory 10% advance + Management approval */
  // The approval request may only proceed "to Sir" once the 10% advance is recorded.
  const requireAdvance = (po) => {
    const g = advanceGate(po, lead);
    if (!g.ok) {
      toast(
        g.cost <= 0
          ? 'Set the PO price (agreed price) before sending for approval.'
          : `10% advance not recorded. Required ₹${g.required.toLocaleString('en-IN')}, recorded ₹${g.paid.toLocaleString('en-IN')}. Record the advance on the lead first.`,
        'er'
      );
      return false;
    }
    return true;
  };

  const handleRecommend = async (po) => {
    if (!can(role, ACTIONS.PO_RECOMMENDATION)) { toast('You are not authorised to recommend POs', 'er'); return; }
    if (!requireAdvance(po)) return;
    if (!window.confirm('Recommend this PO for approval?')) return;
    try {
      await updateDocument('leadPOs', po.id, {
        status: PO_STATUS.RECOMMENDED,
        recommendedBy: user?.email || 'unknown',
        recommendedDate: new Date().toISOString().slice(0, 10)
      });
      notifyAdmins(users, { title: 'PO Awaiting Management Approval', message: `PO ${po.poNumber || ''} for "${lead.name}" was recommended and needs Management approval`, type: 'status_update', module: 'leadPOs', relatedId: po.id });
      toast('PO recommended for approval');
    } catch (e) { toast(e.message, 'er'); }
  };

  // Mandatory Management permission BEFORE final approval (req #3)
  const handleManagementApprove = async (po) => {
    if (!can(role, ACTIONS.PO_MANAGEMENT_APPROVAL)) { toast('Only Management can grant this approval', 'er'); return; }
    if (!requireAdvance(po)) return;
    if (!window.confirm('Grant Management approval for this PO? It can then be approved by Admin/Management.')) return;
    try {
      await updateDocument('leadPOs', po.id, {
        status: PO_STATUS.MANAGEMENT_APPROVED,
        managementApprovedBy: user?.email || 'unknown',
        managementApprovalDate: new Date().toISOString().slice(0, 10)
      });
      notifyAdmins(users, { title: 'PO Ready for Final Approval', message: `PO ${po.poNumber || ''} for "${lead.name}" received Management approval and is ready for final approval`, type: 'status_update', module: 'leadPOs', relatedId: po.id });
      toast('Management approval granted');
    } catch (e) { toast(e.message, 'er'); }
  };

  const handleApprove = async (po) => {
    if (!can(role, ACTIONS.PO_APPROVAL)) { toast('You are not authorised to approve POs', 'er'); return; }
    // Management permission is mandatory before final approval
    if (po.status !== PO_STATUS.MANAGEMENT_APPROVED) { toast('Management approval is required before this PO can be approved', 'er'); return; }
    if (!requireAdvance(po)) return;
    if (!window.confirm('Approve this purchase order?')) return;
    try {
      await updateDocument('leadPOs', po.id, {
        status: PO_STATUS.APPROVED,
        approvedBy: user?.email || 'unknown',
        approvalDate: new Date().toISOString().slice(0, 10)
      });
      // The quotation carried a default BOM while it was still a proposal — now
      // that the PO is approved, the actual PO/BOM details take its place.
      if (myQuote && (po.items || []).length) {
        const actual = bomFromPO(po);
        if (actual.length) {
          try {
            await updateDocument('quotations', myQuote.id, { bomItems: actual, bomSource: 'po', poId: po.id });
            toast('Quotation BOM updated with the actual PO details');
          } catch { /* the quotation is not blocked by this */ }
        }
      }
      // Tell the PO creator it's approved, and notify admins for visibility.
      if (po.createdBy) createNotification({ forUser: po.createdBy, title: 'PO Approved', message: `PO ${po.poNumber || ''} for "${lead.name}" has been approved`, type: 'status_update', module: 'leadPOs', relatedId: po.id });
      notifyAdmins(users, { title: 'PO Approved', message: `PO ${po.poNumber || ''} for "${lead.name}" has been approved`, type: 'status_update', module: 'leadPOs', relatedId: po.id });
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
    ['quotation', myQuote ? 'Quotation (' + myQuote.status + ')' : 'Quotation', 'description'],
    ['followups', 'Follow-ups (' + history.length + ')', 'history'],
    ['pos', 'Purchase Orders (' + myPOs.length + ')', 'receipt_long']
  ];

  return (
    <div className="mo">
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
                <button className="btn bsm bp" onClick={() => setTab('quotation')}>
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
                {(lead.modeOfPayment) && <div className="di"><div className="dl">Mode of Payment</div><div className="dv">{lead.modeOfPayment === 'Other' ? (lead.modeOfPaymentOther || 'Other') : lead.modeOfPayment}</div></div>}
                <div className="di"><div className="dl">Follow-up Status</div><div className="dv">{lead.followUpStatus || '-'}</div></div>
                {lead.referredByName && <div className="di"><div className="dl">Referred By</div><div className="dv">{lead.referredByName} ({lead.referredByType})</div></div>}
                {lead.siteVisit === 'Yes' && (lead.roofType || lead.structureType || lead.existingConnection) && (
                  <>
                    <div className="di" style={{ gridColumn: '1 / -1' }}><div className="dl" style={{ fontWeight: 700 }}>Site Visit Details</div><div className="dv">{lead.siteVisitDate ? formatDate(lead.siteVisitDate) : ''}</div></div>
                    {lead.roofType && <div className="di"><div className="dl">Roof Type</div><div className="dv">{lead.roofType}</div></div>}
                    {lead.floors && <div className="di"><div className="dl">Floors</div><div className="dv">{lead.floors}</div></div>}
                    {lead.structureType && <div className="di"><div className="dl">Tilt</div><div className="dv">{lead.structureType}</div></div>}
                    {lead.roofType === 'Elevated' && (lead.elevatedNorthHeight || lead.elevatedHeight) && <div className="di"><div className="dl">North Pole Height</div><div className="dv">{lead.elevatedNorthHeight || lead.elevatedHeight} ft</div></div>}
                    {lead.roofType === 'Elevated' && lead.elevatedSouthHeight && <div className="di"><div className="dl">South Pole Height</div><div className="dv">{lead.elevatedSouthHeight} ft</div></div>}
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

          {/* -------- QUOTATION TAB -------- */}
          {tab === 'quotation' && <QuotationPanel lead={lead} />}

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
                  <div><span style={{ fontSize: '.8rem', color: 'var(--muted)' }}>Last:</span> <strong>{formatDate(lead.lastFollowUp)}</strong></div>
                  <div><span style={{ fontSize: '.8rem', color: 'var(--muted)' }}>Next:</span> <strong>{formatDate(lead.nextFollowUpDate)}</strong></div>
                </div>
              </div>

              {/* Log follow-up form */}
              {fupForm && (
                <div style={{ background: '#fffbf0', borderRadius: 10, padding: 16, marginBottom: 16, border: '1px solid rgba(243,156,18,.3)' }}>
                  <div className="fr" style={{ marginBottom: 10 }}>
                    <div className="fg" style={{ marginBottom: 0 }}>
                      <label>Date *</label>
                      <DateInput value={fupData.date} onChange={e => setFupData(p => ({ ...p, date: e.target.value }))} />
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
                          <td style={{ fontSize: '.84rem' }}>{formatDate(h.date)}</td>
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
              {/* PO → BOM open once the customer has accepted the quotation. */}
              {quoteAccepted === false && (
                <div style={{ background: 'rgba(243,156,18,.08)', border: '1px solid rgba(243,156,18,.3)', borderRadius: 8, padding: '8px 12px', fontSize: '.82rem', color: '#d68910', marginBottom: 12 }}>
                  <span className="material-icons-round" style={{ fontSize: 15, verticalAlign: 'middle', marginRight: 5 }}>lock</span>
                  Quotation {quotationRef(myQuote)} is <strong>{myQuote.status}</strong>. PO and BOM open once the customer accepts it.
                </div>
              )}
              {quoteAccepted === null && (
                <div style={{ background: 'rgba(26,58,122,.05)', border: '1px solid var(--bor)', borderRadius: 8, padding: '8px 12px', fontSize: '.82rem', color: 'var(--muted)', marginBottom: 12 }}>
                  <span className="material-icons-round" style={{ fontSize: 15, verticalAlign: 'middle', marginRight: 5 }}>info</span>
                  No quotation has been raised for this lead. The proper order is Quotation &rarr; Approval &rarr; Customer Acceptance &rarr; PO &rarr; BOM.
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
                {can(role, ACTIONS.PO_RECORD) && hasModule(user, role, 'new_po') && quoteAccepted !== false && (
                  <button className="btn bsm bp" onClick={() => setPOModal({ data: {} })}>
                    <span className="material-icons-round" style={{ fontSize: 16 }}>add</span> Create PO
                  </button>
                )}
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
                        {/* Recommend: Operation Manager / Admin, only Unapproved */}
                        {(!po.status || po.status === PO_STATUS.UNAPPROVED) && can(role, ACTIONS.PO_RECOMMENDATION) && (
                          <button className="btn bsm bo" onClick={() => handleRecommend(po)} style={{ color: '#d68910', borderColor: 'rgba(243,156,18,.3)' }}>
                            <span className="material-icons-round" style={{ fontSize: 16 }}>thumb_up</span> Recommend
                          </button>
                        )}
                        {/* Management approval: mandatory before final approval */}
                        {po.status === PO_STATUS.RECOMMENDED && can(role, ACTIONS.PO_MANAGEMENT_APPROVAL) && (
                          <button className="btn bsm bo" onClick={() => handleManagementApprove(po)} style={{ color: '#6c5ce7', borderColor: 'rgba(108,92,231,.3)' }}>
                            <span className="material-icons-round" style={{ fontSize: 16 }}>verified_user</span> Management Approve
                          </button>
                        )}
                        {/* Final approve: Admin / Management, only after Management approval */}
                        {po.status === PO_STATUS.MANAGEMENT_APPROVED && can(role, ACTIONS.PO_APPROVAL) && (
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
                        {/* Edit: non-Approved, PO Record permission (Operation Manager / Admin) */}
                        {po.status !== PO_STATUS.APPROVED && can(role, ACTIONS.PO_RECORD) && (
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

                    {/* 10% advance gate notice — approval can't proceed "to Sir" without it */}
                    {po.status !== PO_STATUS.APPROVED && (() => {
                      const g = advanceGate(po, lead);
                      if (g.ok) {
                        return (
                          <div style={{ background: 'rgba(39,174,96,.08)', border: '1px solid rgba(39,174,96,.3)', borderRadius: 8, padding: '6px 12px', fontSize: '.8rem', color: '#1e8449', marginBottom: 10 }}>
                            <span className="material-icons-round" style={{ fontSize: 15, verticalAlign: 'middle', marginRight: 4 }}>check_circle</span>
                            10% advance recorded (₹{g.paid.toLocaleString('en-IN')} of ₹{g.required.toLocaleString('en-IN')}) — eligible for approval.
                          </div>
                        );
                      }
                      return (
                        <div style={{ background: 'rgba(231,76,60,.08)', border: '1px solid rgba(231,76,60,.3)', borderRadius: 8, padding: '6px 12px', fontSize: '.8rem', color: '#c0392b', marginBottom: 10 }}>
                          <span className="material-icons-round" style={{ fontSize: 15, verticalAlign: 'middle', marginRight: 4 }}>warning</span>
                          {g.cost <= 0
                            ? 'Set the PO agreed price to enable approval.'
                            : `10% advance pending — required ₹${g.required.toLocaleString('en-IN')}, recorded ₹${g.paid.toLocaleString('en-IN')}. Cannot send for approval until the advance is recorded on the lead.`}
                        </div>
                      );
                    })()}

                    {/* PO Details Grid */}
                    <div className="dg" style={{ gap: 8 }}>
                      <div className="di"><div className="dl">PO Date</div><div className="dv">{formatDate(po.poDate)}</div></div>
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
                      {po.recommendedBy && <div className="di"><div className="dl">Recommended By</div><div className="dv" style={{ fontSize: '.84rem' }}>{po.recommendedBy}<br /><span style={{ color: 'var(--muted)', fontSize: '.78rem' }}>{formatDate(po.recommendedDate)}</span></div></div>}
                      {po.managementApprovedBy && <div className="di"><div className="dl">Management Approved</div><div className="dv" style={{ fontSize: '.84rem' }}>{po.managementApprovedBy}<br /><span style={{ color: 'var(--muted)', fontSize: '.78rem' }}>{formatDate(po.managementApprovalDate)}</span></div></div>}
                      {po.approvedBy && <div className="di"><div className="dl">Approved By</div><div className="dv" style={{ fontSize: '.84rem' }}>{po.approvedBy}<br /><span style={{ color: 'var(--muted)', fontSize: '.78rem' }}>{formatDate(po.approvalDate)}</span></div></div>}
                    </div>

                    {/* Expandable line items */}
                    {(po.items || []).length > 0 && (
                      <details style={{ marginTop: 10 }}>
                        <summary style={{ cursor: 'pointer', fontSize: '.84rem', fontWeight: 600, color: 'var(--pri)' }}>View BOM Items</summary>
                        <div className="tw" style={{ marginTop: 8 }}>
                          <table>
                            <thead><tr><th>#</th><th>Description of Material</th><th>UOM</th><th>Make</th><th>Model / Rating</th><th>Qty</th><th>Rate</th><th>Amount</th><th>Scope</th></tr></thead>
                            <tbody>
                              {po.items.map((item, i) => (
                                <tr key={i}>
                                  <td>{i + 1}</td>
                                  <td>{item.materialName}</td>
                                  <td>{item.unit || 'Nos'}</td>
                                  <td style={{ fontSize: '.82rem' }}>{item.make || '-'}</td>
                                  <td style={{ fontSize: '.82rem', color: 'var(--muted)' }}>{item.specification || '-'}</td>
                                  <td>{item.quantity}</td>
                                  <td>{formatCurrency(item.rate)}</td>
                                  <td style={{ fontWeight: 600 }}>{formatCurrency(item.amount)}</td>
                                  <td style={{ fontSize: '.82rem' }}>{[item.scopePragathi && 'Pragathi', item.scopeCustomer && 'Customer'].filter(Boolean).join(', ') || '-'}</td>
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
    // Printed on the quotation and on the Bill of Materials. Pre-filled from the
    // lead where we already know it, and editable here.
    referredBy: po.referredBy || lead.referredByName || '',
    sourceOfLead: po.sourceOfLead || lead.leadReference || '',
    amount: po.amount || '',
    uscNo: po.uscNo || lead.customerServiceNumber || '',
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
  // Only the materials actually chosen are rows — they are picked from the list
  // below instead of scrolling through every material one by one.
  const [items, setItems] = useState(
    (po.items && po.items.length)
      ? po.items.map(it => ({ ...EMPTY_BOM_ITEM, ...it, _key: nextBomKey() }))
      : []
  );
  const [matSearch, setMatSearch] = useState('');
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const [poSaving, setPoSaving] = useState(false);

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
  const addItem = () => setItems(prev => [...prev, { ...EMPTY_BOM_ITEM, _key: nextBomKey() }]);
  const removeItem = (idx) => setItems(prev => prev.filter((_, i) => i !== idx));
  const totalValue = items.reduce((s, it) => s + toNumber(it.amount), 0);

  // Tick a material to add it to the BOM, untick to take it out again. A row
  // that already has figures in it asks first, so nothing is lost by a mis-tap.
  const isPicked = (name) => items.some(it => it.materialName === name);
  const toggleMaterial = (m) => {
    const existing = items.find(it => it.materialName === m.materialName);
    if (existing) {
      const hasData = toNumber(existing.quantity) > 0 || toNumber(existing.rate) > 0 || existing.specification;
      if (hasData && !window.confirm(`Remove "${m.materialName}" and the details entered for it?`)) return;
      setItems(prev => prev.filter(it => it.materialName !== m.materialName));
    } else {
      setItems(prev => [...prev, { ...EMPTY_BOM_ITEM, ...m, _key: nextBomKey() }]);
    }
  };
  const pickAllStandard = () => {
    setItems(prev => {
      const have = new Set(prev.map(it => it.materialName));
      return [...prev, ...DEFAULT_BOM_MATERIALS.filter(m => !have.has(m.materialName)).map(m => ({ ...EMPTY_BOM_ITEM, ...m, _key: nextBomKey() }))];
    });
  };
  const clearPicked = () => {
    if (items.length && !window.confirm('Remove all selected materials?')) return;
    setItems([]);
  };
  const visibleMaterials = DEFAULT_BOM_MATERIALS.filter(m =>
    !matSearch || m.materialName.toLowerCase().includes(matSearch.toLowerCase()));
  const extraChargesTotal = toNumber(f.discomCharges) + toNumber(f.civilWork) + toNumber(f.upvcPipes) + toNumber(f.additionalRelay) + toNumber(f.elevatedStructure) + toNumber(f.additionalBom) + toNumber(f.otherCharges);
  const autoScope = 'Supply and installation of ' + (f.kwRequired || '___') + ' Solar PV On-Grid System as per BOM.';

  /* Combined material suggestions: defaults + saved template materials */
  const allMaterials = [...new Set([
    ...DEFAULT_BOM_MATERIALS.map(m => m.materialName),
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
      rate: '', amount: 0, _key: nextBomKey()
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
    <div className="mo" style={{ zIndex: 1001 }}>
      <div className="md" style={{ width: '740px', maxWidth: '96vw' }}>
        <div className="mh">
          <h3>{poId ? 'Edit Purchase Order' : 'Create Purchase Order'}</h3>
          <button className="mx" onClick={onClose}><span className="material-icons-round">close</span></button>
        </div>
        <form onSubmit={async e => {
          e.preventDefault();
          if (poSaving) return;
          const cleaned = {
            ...f,
            companyScope: f.companyScope || autoScope,
            items: items.filter(it => it.materialName || it.quantity).map(it => ({
              materialName: it.materialName || '',
              make: it.make || '',
              quantity: toNumber(it.quantity),
              unit: it.unit || '',
              specification: it.specification || '',
              scopePragathi: !!it.scopePragathi,
              scopeCustomer: !!it.scopeCustomer,
              actualQuantity: it.actualQuantity === '' || it.actualQuantity == null ? '' : toNumber(it.actualQuantity),
              rate: toNumber(it.rate),
              amount: toNumber(it.quantity) * toNumber(it.rate)
            })),
            totalValue,
            amount: toNumber(f.amount),
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
          setPoSaving(true);
          try { await onSave(cleaned, poId); }
          finally { setPoSaving(false); }
        }}>
          <div className="mb" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            <div className="fr">
              <div className="fg"><label>PO Number</label><input className="fi" value={f.poNumber} readOnly style={{ background: '#f0f4f8' }} /></div>
              <div className="fg"><label>PO Date *</label><DateInput value={f.poDate} onChange={e => set('poDate', e.target.value)} required /></div>
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

            {/* Details that also print on the quotation and the Bill of Materials */}
            <div className="fr">
              <div className="fg"><label>Referred By</label><input className="fi" value={f.referredBy} onChange={e => set('referredBy', e.target.value)} placeholder="Who referred this customer" /></div>
              <div className="fg"><label>Source of Lead</label><input className="fi" value={f.sourceOfLead} onChange={e => set('sourceOfLead', e.target.value)} list="lead-sources" placeholder="e.g. Referral, Website" /></div>
            </div>
            <div className="fr">
              <div className="fg"><label>Amount (₹)</label><input type="number" className="fi" value={f.amount} onChange={e => set('amount', e.target.value)} placeholder={totalValue ? String(totalValue) : '0'} /></div>
              <div className="fg"><label>USC No</label><input className="fi" value={f.uscNo} onChange={e => set('uscNo', e.target.value)} placeholder="Service connection no." /></div>
            </div>
            <datalist id="lead-sources">{refs.map(r => <option key={r} value={r} />)}</datalist>

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

              {/* Pick the materials needed — every material in one place */}
              <div style={{ border: '1px solid var(--bor)', borderRadius: 8, padding: 10, marginBottom: 12, background: '#fafbfc' }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                  <input className="fi" style={{ flex: 1, minWidth: 160, padding: '6px 10px', fontSize: '.84rem' }} value={matSearch} onChange={e => setMatSearch(e.target.value)} placeholder="Search materials..." />
                  <button type="button" className="btn bsm bo" onClick={pickAllStandard}>Select All</button>
                  <button type="button" className="btn bsm bo" onClick={clearPicked}>Clear</button>
                  <span style={{ fontSize: '.78rem', color: 'var(--muted)' }}>{items.length} selected</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(210px,1fr))', gap: 4, maxHeight: 190, overflowY: 'auto' }}>
                  {visibleMaterials.map(m => {
                    const on = isPicked(m.materialName);
                    return (
                      <label key={m.materialName} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 6, cursor: 'pointer', fontSize: '.82rem', border: '1px solid ' + (on ? 'var(--pri)' : 'var(--bor)'), background: on ? 'rgba(39,174,96,.07)' : '#fff' }}>
                        <input type="checkbox" checked={on} onChange={() => toggleMaterial(m)} style={{ accentColor: 'var(--pri)' }} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.materialName}>{m.materialName}</span>
                      </label>
                    );
                  })}
                  {!visibleMaterials.length && <span style={{ fontSize: '.82rem', color: 'var(--muted)', padding: 6 }}>No material matches "{matSearch}".</span>}
                </div>
              </div>

              {/* Fill the details for the selected materials, right here */}
              {items.length > 0 && (
                <div className="tw" style={{ border: '1px solid var(--bor)', borderRadius: 8 }}>
                  <table style={{ fontSize: '.8rem' }}>
                    <thead><tr>
                      <th style={{ minWidth: 150 }}>Material</th>
                      <th style={{ width: 62 }}>UOM</th>
                      <th style={{ width: 110 }}>Make</th>
                      <th style={{ width: 110 }}>Model / Rating</th>
                      <th style={{ width: 74 }}>Qty (Est.)</th>
                      <th style={{ width: 74 }}>Actuals</th>
                      <th style={{ width: 84 }}>Rate</th>
                      <th style={{ width: 96 }}>Amount</th>
                      <th style={{ width: 62, textAlign: 'center' }}>Pragathi</th>
                      <th style={{ width: 66, textAlign: 'center' }}>Customer</th>
                      <th style={{ width: 34 }}></th>
                    </tr></thead>
                    <tbody>
                      {items.map((item, i) => (
                        <tr key={item._key || i}>
                          <td><input className="fi" style={{ padding: '4px 6px', fontSize: '.8rem' }} value={item.materialName} onChange={e => setItem(i, 'materialName', e.target.value)} list="bom-materials" /></td>
                          <td><input className="fi" style={{ padding: '4px 6px', fontSize: '.8rem' }} value={item.unit} onChange={e => setItem(i, 'unit', e.target.value)} placeholder="Nos" /></td>
                          <td><input className="fi" style={{ padding: '4px 6px', fontSize: '.8rem' }} value={item.make} onChange={e => setItem(i, 'make', e.target.value)} /></td>
                          <td><input className="fi" style={{ padding: '4px 6px', fontSize: '.8rem' }} value={item.specification} onChange={e => setItem(i, 'specification', e.target.value)} /></td>
                          <td><input type="number" className="fi" style={{ padding: '4px 6px', fontSize: '.8rem' }} value={item.quantity} onChange={e => setItem(i, 'quantity', e.target.value)} /></td>
                          <td><input type="number" className="fi" style={{ padding: '4px 6px', fontSize: '.8rem' }} value={item.actualQuantity} onChange={e => setItem(i, 'actualQuantity', e.target.value)} /></td>
                          <td><input type="number" className="fi" style={{ padding: '4px 6px', fontSize: '.8rem' }} value={item.rate} onChange={e => setItem(i, 'rate', e.target.value)} /></td>
                          <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{formatCurrency(toNumber(item.quantity) * toNumber(item.rate))}</td>
                          <td style={{ textAlign: 'center' }}><input type="checkbox" checked={!!item.scopePragathi} onChange={e => setItem(i, 'scopePragathi', e.target.checked)} /></td>
                          <td style={{ textAlign: 'center' }}><input type="checkbox" checked={!!item.scopeCustomer} onChange={e => setItem(i, 'scopeCustomer', e.target.checked)} /></td>
                          <td><button type="button" className="btn bsm bo" onClick={() => removeItem(i)} title="Remove" style={{ padding: '2px 6px', color: 'var(--err)' }}><span className="material-icons-round" style={{ fontSize: 15 }}>close</span></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {!items.length && <p style={{ fontSize: '.82rem', color: 'var(--muted)', margin: '4px 2px' }}>Tick the materials above to add them to this Bill of Materials.</p>}
              <button type="button" className="btn bsm bo" onClick={addItem} style={{ marginTop: 8 }}>
                <span className="material-icons-round" style={{ fontSize: 16 }}>add</span> Add custom material
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
            <button type="submit" className="btn bp" disabled={poSaving}>{poSaving ? 'Saving...' : ((poId ? 'Update' : 'Create') + ' PO')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ============ UTILITY FUNCTIONS ============ */

function generatePONumber(existingPOs) {
  const now = new Date();
  const dateStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  const allNums = existingPOs.map(p => {
    const match = (p.poNumber || '').match(/PO-PPSPO-(\d+)/);
    return match ? parseInt(match[1]) : 0;
  });
  const maxNum = allNums.length > 0 ? Math.max(...allNums) : 0;
  return 'PO-PPSPO-' + String(maxNum + 1).padStart(4, '0') + '/' + dateStr;
}

/* The quotation is generated from src/services/quotation.js now — it follows the
   company's standard proposal format and carries the approval workflow. */

function printLeadSummary(lead) {
  const e = escapeHtml;
  const html = `<html><head><title>Lead - ${e(lead.name)}</title>
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
</body></html>`;
  openHtmlSafely(html, true);
}

function printFollowUpHistory(lead) {
  const history = lead.followUpHistory || [];
  const e = escapeHtml;
  const html = `<html><head><title>Follow-up History - ${e(lead.name)}</title>
<style>body{font-family:Arial,sans-serif;padding:40px;line-height:1.6;color:#333}h1{font-size:18px;margin-bottom:5px;color:#1a3a7a}.sub{color:#666;font-size:13px;margin-bottom:20px}.cur{background:#f0f8f0;padding:12px 16px;border-radius:8px;margin-bottom:20px;font-size:13px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:8px 12px;text-align:left;font-size:13px}th{background:#f5f5f5;font-weight:600}.footer{margin-top:30px;font-size:11px;color:#999;text-align:center}@media print{body{padding:20px}}</style>
</head><body>
<h1>Follow-up History: ${e(lead.name)}</h1>
<div class="sub">Phone: ${e(lead.phone || '-')} | Status: ${e(lead.status || '-')} | Address: ${e(lead.address || '-')}</div>
<div class="cur"><strong>Current:</strong> ${e(lead.followUpStatus || '-')} | Last: ${e(lead.lastFollowUp || '-')} | Next: ${e(lead.nextFollowUpDate || '-')}</div>
${history.length > 0 ? `<table><thead><tr><th>#</th><th>Date</th><th>Status</th><th>Notes</th><th>Logged By</th></tr></thead><tbody>
${history.map((h, i) => `<tr><td>${i + 1}</td><td>${e(h.date || '-')}</td><td>${e(h.status || '-')}</td><td>${e(h.notes || '-')}</td><td>${e(h.by || '-')}</td></tr>`).join('')}
</tbody></table>` : '<p style="color:#999">No follow-up history recorded yet.</p>'}
<div class="footer">Pragathi Power Solutions — Printed on ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
</body></html>`;
  openHtmlSafely(html, true);
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
    const phone = String(lead.phone).replace(/\D/g, '');
    const num = phone.length === 10 ? '91' + phone : phone;
    window.open('https://wa.me/' + num + '?text=' + encodeURIComponent(msg), '_blank');
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
    const phone = String(lead.phone).replace(/\D/g, '');
    const num = phone.length === 10 ? '91' + phone : phone;
    window.open('https://wa.me/' + num + '?text=' + encodeURIComponent(msg), '_blank');
  } else {
    window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
  }
}
