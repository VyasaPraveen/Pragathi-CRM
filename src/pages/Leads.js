import React, { useState } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { addDocument, updateDocument, deleteDocument, createNotification, notifyAdmins } from '../services/firestore';
import { apiUpload } from '../services/api';
import { assignableNames, supportingNames } from '../services/people';
import { formatCurrency, formatDate, formatDateTime, safeStr, toNumber, daysSince, priorityClass, hasAccess, makeCall, sendWhatsApp, escapeHtml, openHtmlSafely, normName as norm, todayStr, compressImage, isSafeUrl, shareWhatsApp } from '../services/helpers';
import { StatusBadge, Modal, EmptyState, DateInput, SearchSelect, DateFilter } from '../components/SharedUI';
import { DATE_FILTER_ALL, applyDateFilter } from '../services/dateFilter';
import { sharePOWhatsApp } from '../services/poUtils';
import { openPoPdf, downloadPoPdf } from '../services/poShare';
import {
  can, ACTIONS, PO_STATUS, advanceGate, canSeeLead, canEditLead, salesMembersOf, teamLeaders, normalizeRole,
  quotationApprovers, canAddLeadPO, canEditLeadPO, canRecommendLeadPO, warehouseUsers,
  leadLeaderEmail, DISPATCH_STATUS, dispatchMarks, dispatchNotifyUsers,
} from '../services/permissions';
import QuotationPanel from '../components/QuotationPanel';
import DispatchPanel from '../components/DispatchPanel';
import BcoOperationsPanel from '../components/BcoOperationsPanel';
import LeadPOModal from '../components/LeadPOModal';
import { canViewBco, bcoProgress } from '../services/bco';
import { QT_STATUS, DEFAULT_TARIFF, daysUntil, FOLLOWUP_REMIND_DAYS, quotationRef } from '../services/quotation';
import { getOptions, withCurrent } from '../services/options';
import { buildLeadNotice, leadNotifyTargets, siteVisitPhotoIssue, sitePhotoList } from '../services/leadNotify';
// 31-Oct (Customers batch): a converted lead's customer starts with the stages
// the lead and the BCO already recorded, and the lead's Advance Received keeps
// Stage 6 of the customer's workflow up to date.
import { newCustomerWorkflow } from '../services/customerWorkflow';
import { syncLeadToCustomer } from '../services/customerSync';

// The customer made from a converted lead (Req 1.3, 1.8–1.10, 1.16): the
// lead's details, the person it is assigned to, and whatever the lead and the
// BCO already recorded for Stages 5, 6 and 12 of the customer's workflow.
function customerFromConvertedLead(leadId, cleaned, bco, by) {
  const fields = {
    leadId,
    name: cleaned.name, phone: cleaned.phone, address: cleaned.address,
    email: cleaned.email || '', kwRequired: cleaned.kwRequired || '',
    city: cleaned.city || '', district: cleaned.district || '', pincode: cleaned.pincode || '',
    assignedTo: cleaned.assignedTo || '', salesExecutive: cleaned.salesExecutive || '',
    advanceAmount: toNumber(cleaned.advanceLeadAmount), secondPayment: 0, thirdPayment: 0, finalPayment: 0,
    totalPrice: 0, paymentType: 'Cash', agreedPrice: 0, bosAmount: 0,
    customerServiceNumber: cleaned.customerServiceNumber || '',
    status: 'Active',
  };
  return { ...fields, workflow: newCustomerWorkflow(fields, { lead: { ...cleaned, id: leadId }, bco, by }) };
}

// Lead Reference, Follow-up Status, Priority and Mode of Payment now come from
// Settings → Manage Options (src/services/options.js holds the same defaults).
// Lead Status stays fixed: "Converted" creates the customer record, so the app's
// behaviour hangs off these exact four values.
const sts = ['Interested', 'Not Interested', 'Converted', 'Not Converted'];
const PAGE_SIZE = 20;
// The filter tab holding leads whose quotation was not accepted and that are
// waiting for their next follow-up.
const PENDING_FOLLOWUP = 'Pending Follow-up';

// The day a lead belongs to for the Day / Month filter: the date it was
// generated, else the moment the record was created.
const LEAD_DATE_FIELDS = ['dateGenerated', 'createdAt'];

/* ============ MAIN LEADS LIST ============ */
export default function Leads() {
  const { leads, customers, users, influencers, team, quotations, leadPOs, bcoOps, installations } = useData();
  const { role, user } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [modal, setModal] = useState(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [detailId, setDetailId] = useState(null);
  const [detailTab, setDetailTab] = useState(null);
  // The common Day / Month filter (R15). Opens on All, so the list is unchanged until used.
  const [dateFilter, setDateFilter] = useState(DATE_FILTER_ALL);

  // A lead belongs to the person it is assigned to: they, the people working it
  // and the hierarchy above them see it — nobody else (19-Sep requirement 6).
  const myLeads = leads.filter(l => canSeeLead(l, user, role, users, team, leadPOs));

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

  filtered = applyDateFilter(filtered, dateFilter, LEAD_DATE_FIELDS);

  // P2 fix: client-side pagination
  const displayed = filtered.slice(0, visibleCount);
  const hasMore = filtered.length > visibleCount;
  const detailLead = detailId ? leads.find(l => l.id === detailId) : null;
  const pendingFollowUpCount = myLeads.filter(l => l.pendingFollowUp && l.status !== 'Converted').length;

  // Who is doing the assigning — included in the notification so the employee
  // knows at a glance who gave them the lead.
  const assignedByName = user?.displayName || user?.email || 'a team leader';

  // Req 1.3: the person the lead is assigned to hears at once that it has
  // become a customer, which now sits in their Customers list.
  const tellAssigneeOfCustomer = (lead, customerId) => {
    if (!lead.assignedTo) return;
    createNotification({
      forUser: lead.assignedTo, title: 'Your Lead Is Now a Customer',
      message: `"${lead.name}" has been converted and added to Customers. It is in your Customers list — the workflow continues there.`,
      type: 'customer', module: 'customers', relatedId: customerId,
    });
  };

  // The sign-up reminder a lead's Expected Sign-Up Date creates. Someone whose
  // "Add Reminder" switch is off (Req 20, 4-Nov) still saves the lead; only
  // the reminder is skipped, and they are told so.
  const addSignUpReminder = async (cleaned) => {
    try {
      await addDocument('reminders', {
        type: 'Follow-up',
        customer: cleaned.name,
        phone: cleaned.phone || '',
        date: cleaned.expectedSignUpDate,
        message: 'Expected sign-up date for ' + cleaned.name + '. Follow up to confirm conversion.',
        status: 'Pending'
      });
      toast('Sign-up reminder auto-created');
    } catch (e) { toast('Lead saved; the sign-up reminder was not created: ' + e.message, 'wa'); }
  };

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
        // One notice covering the whole edit, sent to everyone with a stake in
        // the lead. It replaces the old pair of messages, which told only the
        // assignee, never said who had changed what, and fired on every save.
        const notice = buildLeadNotice({
          lead: { ...cleaned, id }, prevLead, users, actor: user, quotations, leadPOs,
        });
        if (notice) {
          notice.targets.forEach(forUser => createNotification({
            forUser, title: notice.title, message: notice.message,
            type: 'lead', module: 'leads', relatedId: id,
          }));
          // The person the lead has just landed on is told directly, because
          // for them it is a job to pick up rather than news about a record.
          if (notice.reassigned && notice.assignee) {
            createNotification({
              forUser: notice.assignee,
              title: 'Lead Assigned to You',
              message: `${assignedByName} assigned you the lead "${cleaned.name}"`
                + `${cleaned.phone ? ' · ' + cleaned.phone : ''}${cleaned.city ? ' · ' + cleaned.city : ''}`
                + `${notice.previousAssignee ? ' (previously with ' + notice.previousAssignee + ')' : ''}`,
              type: 'lead', module: 'leads', relatedId: id,
            });
          }
          if (notice.reassigned && notice.previousAssignee) {
            createNotification({
              forUser: notice.previousAssignee,
              title: 'Lead Moved to Someone Else',
              message: `${assignedByName} moved the lead "${cleaned.name}" from you to ${notice.assignee || '(unassigned)'}.`,
              type: 'lead', module: 'leads', relatedId: id,
            });
          }
        }
      } else {
        const newId = await addDocument('leads', cleaned);
        toast('Lead added');
        // Notify assigned user on new lead
        if (cleaned.assignedTo) {
          createNotification({ forUser: cleaned.assignedTo, title: 'New Lead Assigned', message: `${assignedByName} assigned you a new lead: "${cleaned.name}"${cleaned.phone ? ' · ' + cleaned.phone : ''}${cleaned.city ? ' · ' + cleaned.city : ''}`, type: 'lead', module: 'leads', relatedId: newId });
        }
        // The Team Leader and the approval line hear about a new lead too, not
        // just the Admins — they are the people who have to act on it.
        leadNotifyTargets({ lead: { ...cleaned, id: newId }, prevLead: null, users, actor: user })
          .filter(t => t !== cleaned.assignedTo)
          .forEach(forUser => createNotification({
            forUser,
            title: 'New Lead Created',
            message: `${assignedByName} created the lead "${cleaned.name}"`
              + `${cleaned.city ? ' · ' + cleaned.city : ''}, assigned to ${cleaned.assignedTo || '(nobody)'}.`,
            type: 'lead', module: 'leads', relatedId: newId,
          }));
        // Auto-create customer if lead is created directly as Converted
        if (cleaned.status === 'Converted') {
          const custId = await addDocument('customers', customerFromConvertedLead(newId, cleaned, null, assignedByName));
          toast(cleaned.name + ' auto-added to Customers!');
          tellAssigneeOfCustomer(cleaned, custId);
        }
        // Auto-create reminder for Expected Sign-Up Date on new lead
        if (cleaned.expectedSignUpDate) {
          await addSignUpReminder(cleaned);
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
        await addSignUpReminder(cleaned);
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
        const bco = (bcoOps || []).find(o => o.leadId === id) || null;
        const custId = await addDocument('customers', customerFromConvertedLead(id, cleaned, bco, assignedByName));
        toast(cleaned.name + ' auto-added to Customers!');
        tellAssigneeOfCustomer(cleaned, custId);
      } else if (existingCustomer) {
        // The lead's Advance Received → Stage 6 of the customer's workflow (Req 1.10).
        await syncLeadToCustomer({ customers, leads, leadPOs, installations, bcoOps, lead: { ...(prevLead || {}), ...cleaned, id }, by: assignedByName }).catch(() => {});
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
        <div className="tl-r">
          <div className="chips">
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
      <div style={{ marginBottom: 12 }}><DateFilter value={dateFilter} onChange={setDateFilter} records={myLeads} fields={LEAD_DATE_FIELDS} /></div>
      <div className="card"><div className="cb" style={{ padding: 0 }}><div className="tw tw-m"><table style={{ fontSize: '.82rem' }}><thead><tr><th>Name / Phone</th><th>Address</th><th>Source</th><th>Priority</th><th>Assigned</th><th style={{ textAlign: 'center' }}>Visit</th><th style={{ textAlign: 'center' }}>Quote</th><th style={{ textAlign: 'center' }}>Advance</th><th>Status</th><th>Date</th><th>Age</th><th>Actions</th></tr></thead><tbody>
        {displayed.map(l => (
          <tr key={l.id}>
            <td className="m-h" style={{ minWidth: 120 }}><strong style={{ fontSize: '.84rem' }}>{l.name}</strong><br /><span style={{ fontSize: '.74rem', color: 'var(--muted)' }}>{l.phone}</span></td>
            <td data-l="Address" style={{ maxWidth: 130, fontSize: '.78rem' }}>{l.address || '-'}</td>
            <td data-l="Source" style={{ fontSize: '.78rem' }}>{l.leadReference || '-'}</td>
            <td data-l="Priority">{l.priority ? <span className={`st ${priorityClass(l.priority)}`} style={{ padding: '3px 8px', fontSize: '.72rem' }}>{l.priority}</span> : <span style={{ color: 'var(--muted)' }}>-</span>}</td>
            <td data-l="Assigned" style={{ fontSize: '.78rem' }}>{l.assignedTo || '-'}</td>
            <td data-l="Visit" style={{ textAlign: 'center' }}>{l.siteVisit === 'Yes' ? <span className="st st-g" style={{ padding: '2px 6px', fontSize: '.7rem' }}>Done</span> : <span style={{ color: 'var(--light)', fontSize: '.76rem' }}>No</span>}</td>
            <td data-l="Quote" style={{ textAlign: 'center' }}>{l.quotationSent === 'Yes' ? <span className="st st-g" style={{ padding: '2px 6px', fontSize: '.7rem' }}>Sent</span> : <span style={{ color: 'var(--light)', fontSize: '.76rem' }}>No</span>}</td>
            <td data-l="Advance" style={{ textAlign: 'center' }}>{l.advancePaid === 'Yes' ? <span className="st st-g" style={{ padding: '2px 6px', fontSize: '.7rem' }}>Paid</span> : <span style={{ color: 'var(--light)', fontSize: '.76rem' }}>No</span>}</td>
            <td data-l="Status">
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
            <td data-l="Date" style={{ fontSize: '.76rem', whiteSpace: 'nowrap' }}>{formatDate(l.dateGenerated)}</td>
            <td data-l="Age" style={{ fontSize: '.78rem', fontWeight: 600 }}>{daysSince(l.dateGenerated) != null ? daysSince(l.dateGenerated) + 'd' : '-'}</td>
            <td className="m-a"><div style={{ display: 'flex', gap: 3 }}>
              {l.phone && <button className="btn bsm bo" onClick={() => makeCall(l.phone)} title="Call" style={{ padding: '5px 8px', color: '#3b82f6', borderColor: 'rgba(59,130,246,.3)' }}><span className="material-icons-round" style={{ fontSize: 15 }}>call</span></button>}
              {l.phone && <button className="btn bsm bo" onClick={() => sendWhatsApp(l.phone, `Hi ${l.name}, this is from Pragathi Power Solutions regarding your solar enquiry.`)} title="WhatsApp" style={{ padding: '5px 8px', color: '#25d366', borderColor: 'rgba(37,211,102,.3)' }}><span className="material-icons-round" style={{ fontSize: 15 }}>chat</span></button>}
              <button className="btn bsm bo" onClick={() => setDetailId(l.id)} title="View Details" style={{ padding: '5px 8px' }}><span className="material-icons-round" style={{ fontSize: 15 }}>visibility</span></button>
              <button className="btn bsm bo" onClick={() => { setDetailTab('quotation'); setDetailId(l.id); }} title="Quotation" style={{ padding: '5px 8px', color: 'var(--pri)' }}><span className="material-icons-round" style={{ fontSize: 15 }}>description</span></button>
              <button className="btn bsm bo" onClick={() => { setDetailTab('pos'); setDetailId(l.id); }} title="PO & BOM" style={{ padding: '5px 8px', color: '#6c5ce7', borderColor: 'rgba(108,92,231,.3)' }}><span className="material-icons-round" style={{ fontSize: 15 }}>receipt_long</span></button>
              {/* Req 2 / Req 4 (15-Oct): the BCO, the warehouse and a Technician look but do not edit. */}
              {canEditLead(l, user, role, users) && <button className="btn bsm bo" onClick={() => setModal({ data: l, id: l.id })} title="Edit" style={{ padding: '5px 8px' }}><span className="material-icons-round" style={{ fontSize: 15 }}>edit</span></button>}
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
  const { leads, customers, retailers, influencers, users, settings } = useData();
  // The tariff used to convert a monthly bill amount into units, and back.
  const ebTariff = toNumber(settings?.ebTariff) || DEFAULT_TARIFF;
  // Dropdown choices come from Settings → Manage Options. Whatever this lead
  // already holds stays on its list, even if the Admin has since removed it.
  const opt = (key, current) => withCurrent(getOptions(settings, key), current);
  // B1 fix: track previous status to detect first conversion
  const prevStatus = data.status;
  const [form, setForm] = useState({
    name: data.name || '', phone: data.phone || '', address: data.address || '',
    email: data.email || '',
    leadReference: data.leadReference || 'Website', leadReferenceOther: data.leadReferenceOther || '', dateGenerated: data.dateGenerated || todayStr(),
    lastFollowUp: data.lastFollowUp || '', followUpStatus: data.followUpStatus || 'New Lead',
    siteVisitPhotos: sitePhotoList(data.siteVisitPhotos),
    siteVisit: data.siteVisit || 'No', quotationSent: data.quotationSent || 'No',
    advancePaid: data.advancePaid || 'No', advanceLeadAmount: data.advanceLeadAmount || '', advanceLeadDate: data.advanceLeadDate || '', status: data.status || 'Interested',
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
  // Site visit photos (Req 1, 27-Oct): several per visit, kept on the lead;
  // adding more never replaces the ones already there.
  const { toast: photoToast } = useToast();
  const [photoBusy, setPhotoBusy] = useState(false);
  const addSitePhotos = async (files) => {
    const list = Array.from(files || []).filter(f => f && f.type && f.type.startsWith('image/'));
    if (!list.length) { photoToast('Choose a photograph (JPG / PNG)', 'er'); return; }
    setPhotoBusy(true);
    try {
      const added = [];
      for (const f of list) {
        const small = await compressImage(f, 1600, 0.8);
        const res = await apiUpload(small, 'site-visits');
        if (res && res.url) added.push({ url: res.url, name: res.name || f.name, at: new Date().toISOString() });
      }
      setForm(p => ({ ...p, siteVisitPhotos: [...(p.siteVisitPhotos || []), ...added] }));
      photoToast(`${added.length} photo${added.length === 1 ? '' : 's'} added`);
    } catch (e) { photoToast(e.message, 'er'); }
    finally { setPhotoBusy(false); }
  };
  const photoIssue = siteVisitPhotoIssue(form, data);
  // The Site Visit is not marked done without a photo (Req 1).
  const submitLead = (...args) => {
    if (photoIssue) { photoToast(photoIssue, 'er'); return undefined; }
    return onSave(...args);
  };
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
  const supportOptions = supportingNames(users, usedAbove, form.supportingTeam);
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
  // Every valid account is offered, so a name can always be found by typing.
  // When a Team Leader is chosen their own members are listed first, which
  // keeps the team-based shortlist without making it the only choice.
  const assignOptions = (() => {
    const all = assignableNames(users, form.assignedTo);
    const team = new Set(salesMembersOf(users, form.teamLeader).map(u => norm(u.displayName || u.email)));
    if (!form.teamLeader) return all;
    return [...all].sort((a, b) => (team.has(norm(b)) ? 1 : 0) - (team.has(norm(a)) ? 1 : 0));
  })();
  const leaderTeamNames = new Set(salesMembersOf(users, form.teamLeader).map(u => norm(u.displayName || u.email)));
  const assignGroup = (n) => {
    if (!form.teamLeader || !n) return null;
    return leaderTeamNames.has(norm(n)) ? 'This Team Leader’s team' : 'Everyone else';
  };

  return (
    <Modal title={id ? 'Edit Lead' : 'Add New Lead'} onClose={onClose} wide>
      <form onSubmit={async e => {
        e.preventDefault();
        if (saving) return;
        if (!id && !form.city.trim()) { toast('City is required for new leads', 'er'); return; }
        if (duplicatePhone && !window.confirm(`Phone ${form.phone} already exists for lead "${duplicatePhone.name}". Save anyway?`)) return;
        // R9 (8-Oct): the two checks that used to sit here — Sanctioned Load
        // must be at least the kW Required, and Available Space at least
        // kW x 70 sq.ft — are gone at the client's request. Any value entered
        // in either field is accepted; higher, equal or lower.
        setSaving(true);
        try {
          // Anyone named in a field above is not also supporting team — this
          // tidies older leads that carry the same person twice.
          const cleanedForm = {
            ...form,
            supportingTeam: (form.supportingTeam || []).filter(n => !usedAbove.includes(norm(n))),
          };
          await submitLead(cleanedForm, id, prevStatus, data.expectedSignUpDate || '');
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
          <div className="fr"><div className="fg"><label>Expected Value (₹)</label><input type="number" className="fi" value={form.expectedValue} onChange={e => set('expectedValue', e.target.value)} /></div><div className="fg"><label>Priority</label><select className="fi" value={form.priority} onChange={e => set('priority', e.target.value)}><option value="">-- Select --</option>{opt('priority', form.priority).map(o => <option key={o}>{o}</option>)}</select></div></div>
          <div className="fr">
            <div className="fg">
              <label>Lead Reference <span style={{ fontSize: '.72rem', color: 'var(--muted)', fontWeight: 400 }}>pick a name or type your own</span></label>
              <input className="fi" list="lead-reference-names" value={form.leadReference} onChange={e => set('leadReference', e.target.value)} placeholder="Select or enter a name" />
              <datalist id="lead-reference-names">
                {[...new Set([...getOptions(settings, 'leadReference'), ...leads.map(l => l.leadReference).filter(Boolean)])].map(o => <option key={o} value={o} />)}
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
          <div className="fr"><div className="fg"><label>Last Follow-up</label><DateInput value={form.lastFollowUp} onChange={e => set('lastFollowUp', e.target.value)} /></div><div className="fg"><label>Follow-up Status</label><select className="fi" value={form.followUpStatus} onChange={e => set('followUpStatus', e.target.value)}>{opt('followUpStatus', form.followUpStatus).map(o => <option key={o}>{o}</option>)}</select></div></div>
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
              <SearchSelect
                value={form.assignedTo}
                options={assignOptions}
                groups={assignGroup}
                placeholder="Type a few letters to find a name…"
                onChange={n => { set('assignedTo', n); if (n) dropFromSupport(n); }}
              />
              <small style={{ fontSize: '.72rem', color: 'var(--muted)' }}>
                {form.teamLeader
                  ? 'This Team Leader’s members first, then everyone else. Type to search.'
                  : 'Any current user. Type a few letters to search, or type a name that is not on the list.'}
              </small>
            </div>
            <div className="fg"><label>Next Follow-up Date</label><DateInput value={form.nextFollowUpDate} onChange={e => set('nextFollowUpDate', e.target.value)} /></div>
          </div>
          {/* The "Sales Executive" field that sat here was removed from the
              form on request. The value stays on existing leads and still
              shows wherever it did; it just cannot be set from here any more. */}
          <div className="fr"><div className="fg"><label>Expected Sign-up Date</label><DateInput value={form.expectedSignUpDate} onChange={e => set('expectedSignUpDate', e.target.value)} /></div><div className="fg" /></div>
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
            <SearchSelect
              value=""
              options={supportOptions}
              placeholder={supportOptions.length ? 'Search a name to add…' : 'No other names available'}
              emptyText="No matching name"
              onChange={n => {
                if (n && !(form.supportingTeam || []).some(x => norm(x) === norm(n))) {
                  set('supportingTeam', [...(form.supportingTeam || []), n]);
                }
              }}
            />
            {/* Add a custom supporting name not in the team list */}
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <input className="fi" value={supportName} onChange={e => setSupportName(e.target.value)} placeholder="Or type a name not on the list..." onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSupportName(); } }} />
              <button type="button" className="btn bsm bo" onClick={addSupportName}><span className="material-icons-round" style={{ fontSize: 16 }}>add</span> Add Name</button>
            </div>
          </div>
          <div className="fr3"><div className="fg"><label>Site Visit</label><select className="fi" value={form.siteVisit} onChange={e => set('siteVisit', e.target.value)}><option>No</option><option>Yes</option></select></div><div className="fg"><label>Quotation Sent</label><select className="fi" value={form.quotationSent} onChange={e => set('quotationSent', e.target.value)}><option>No</option><option>Yes</option></select></div><div className="fg"><label>Advance Paid</label><select className="fi" value={form.advancePaid} onChange={e => { set('advancePaid', e.target.value); if (e.target.value === 'Yes' && !form.advanceLeadAmount) { const def = Math.round(toNumber(form.expectedValue) * 0.1); if (def > 0) set('advanceLeadAmount', def); } }}><option>No</option><option>Yes</option></select></div></div>
          {form.advancePaid === 'Yes' && (
            <div className="fr">
              <div className="fg"><label>Advance Amount (₹) <span style={{ fontSize: '.76rem', color: 'var(--muted)', fontWeight: 400 }}>Default 10% of Expected Value</span></label><input type="number" className="fi" value={form.advanceLeadAmount} onChange={e => set('advanceLeadAmount', e.target.value)} placeholder={`e.g. ${Math.round(toNumber(form.expectedValue) * 0.1) || '10% of expected value'}`} /></div>
              {/* The date travels with the amount and the Mode of Payment below to
                  Stage 6 of the customer's workflow (Req 1.10). */}
              <div className="fg"><label>Advance Date</label><DateInput value={form.advanceLeadDate} onChange={e => set('advanceLeadDate', e.target.value)} /></div>
            </div>
          )}
          <div className="fr">
            <div className="fg"><label>Mode of Payment</label><select className="fi" value={form.modeOfPayment} onChange={e => set('modeOfPayment', e.target.value)}><option value="">-- Select --</option>{opt('modeOfPayment', form.modeOfPayment).map(o => <option key={o}>{o}</option>)}</select></div>
            {form.modeOfPayment === 'Other'
              ? <div className="fg"><label>Specify Payment Mode</label><input className="fi" value={form.modeOfPaymentOther} onChange={e => set('modeOfPaymentOther', e.target.value)} placeholder="Enter payment method" /></div>
              : <div className="fg" />}
          </div>
          {form.siteVisit === 'Yes' && (
            <div style={{ borderTop: '1px solid var(--bor)', margin: '14px 0', paddingTop: 14 }}>
              <label style={{ fontWeight: 700, fontSize: '.9rem', marginBottom: 10, display: 'block' }}>Site Visit Details</label>
              <div className="fr"><div className="fg"><label>Visit Date</label><DateInput value={form.siteVisitDate} onChange={e => set('siteVisitDate', e.target.value)} /></div><div className="fg"><label>Roof Type</label><select className="fi" value={form.roofType} onChange={e => set('roofType', e.target.value)}><option value="">-- Select --</option>{opt('roofType', form.roofType).map(o => <option key={o}>{o}</option>)}</select></div></div>
              {form.roofType === 'Elevated' && (
                <div className="fr"><div className="fg"><label>North Pole Height (Feet)</label><input type="number" className="fi" value={form.elevatedNorthHeight} onChange={e => set('elevatedNorthHeight', e.target.value)} placeholder="e.g. 10" min="0" /></div><div className="fg"><label>South Pole Height (Feet)</label><input type="number" className="fi" value={form.elevatedSouthHeight} onChange={e => set('elevatedSouthHeight', e.target.value)} placeholder="e.g. 10" min="0" /></div></div>
              )}
              <div className="fr3"><div className="fg"><label>Floors</label><input type="number" className="fi" value={form.floors} onChange={e => set('floors', e.target.value)} min="1" /></div><div className="fg"><label>Type of Installation</label><select className="fi" value={form.structureType} onChange={e => set('structureType', e.target.value)}><option value="">-- Select --</option>{opt('structureType', form.structureType).map(o => <option key={o}>{o}</option>)}</select></div><div className="fg"><label>Existing Connection</label><select className="fi" value={form.existingConnection} onChange={e => set('existingConnection', e.target.value)}><option value="">-- Select --</option>{opt('existingConnection', form.existingConnection).map(o => <option key={o}>{o}</option>)}</select></div></div>
              <div className="fr"><div className="fg"><label>Sanctioned Load (kW)</label><input type="number" className="fi" value={form.sanctionedLoad} onChange={e => set('sanctionedLoad', e.target.value)} placeholder="e.g. 5" /></div><div className="fg"><label>Available Space (sq.ft)</label><input type="number" className="fi" value={form.availableSpace} onChange={e => set('availableSpace', e.target.value)} placeholder="e.g. 200" /></div></div>
              <div className="fg"><label>Customer Service Number</label><input className="fi" value={form.customerServiceNumber} onChange={e => set('customerServiceNumber', e.target.value)} placeholder="Service number from electricity bill" /></div>
              <div className="fg"><label>Site Visit Notes</label><textarea className="fi" value={form.siteVisitNotes} onChange={e => set('siteVisitNotes', e.target.value)} rows="2" placeholder="Observations from site visit..." /></div>
              {/* Req 1 (27-Oct): the photographs of the visit — one or many, never replacing earlier ones; at least one is required to mark the visit done. */}
              <div className="fg"><label>Site Visit Photos * <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: '.76rem' }}>({(form.siteVisitPhotos || []).length} uploaded — at least one is required)</span></label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <label className="btn bsm bo" style={{ cursor: photoBusy ? 'wait' : 'pointer' }}>
                    <span className="material-icons-round" style={{ fontSize: 16 }}>add_a_photo</span> {photoBusy ? 'Uploading…' : 'Add photo(s)'}
                    <input type="file" accept="image/*" multiple style={{ display: 'none' }} disabled={photoBusy} onChange={e => { addSitePhotos(e.target.files); e.target.value = ''; }} />
                  </label>
                  {(form.siteVisitPhotos || []).map((p, i) => (
                    <span key={p.url || i} style={{ position: 'relative', display: 'inline-block' }}>
                      <a href={p.url} target="_blank" rel="noreferrer"><img src={p.url} alt={`Site visit ${i + 1}`} style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--bor)' }} /></a>
                      <button type="button" className="btn bsm bo" style={{ position: 'absolute', top: -6, right: -6, padding: 0, width: 20, height: 20, borderRadius: 10, lineHeight: '18px' }} title="Remove this photo" onClick={() => set('siteVisitPhotos', form.siteVisitPhotos.filter((_, j) => j !== i))}>×</button>
                    </span>
                  ))}
                </div>
                {photoIssue && <div style={{ fontSize: '.76rem', color: '#c0392b', marginTop: 4 }}>{photoIssue}</div>}
              </div>
            </div>
          )}
          <div className="fg"><label>Notes</label><textarea className="fi" value={form.notes} onChange={e => set('notes', e.target.value)} rows="3" placeholder="Follow-up notes..." /></div>
          {/* A brand-new lead always starts at the default status, so the picker
              is not shown while adding. It stays on an existing lead, because
              choosing "Converted" here is what creates the Customer record. */}
          {id && (
            <div className="fg"><label>Lead Status</label><select className="fi" value={form.status} onChange={e => set('status', e.target.value)}>{sts.map(o => <option key={o}>{o}</option>)}</select></div>
          )}
        </div>
        <div className="mf"><button type="button" className="btn bo" onClick={onClose}>Cancel</button><button type="submit" className="btn bp" disabled={saving}>{saving ? 'Saving...' : ((id ? 'Update' : 'Add') + ' Lead')}</button></div>
      </form>
    </Modal>
  );
}

/* ============ LEAD DETAIL MODAL (NEW) ============ */
function LeadDetailModal({ lead, initialTab, onClose }) {
  const [tab, setTab] = useState(initialTab || 'overview');
  const { leadPOs, installations, users, quotations, settings, bcoOps } = useData();
  const { role, user } = useAuth();
  const { toast } = useToast();
  const [poModal, setPOModal] = useState(null);
  const [fupForm, setFupForm] = useState(false);
  const [fupData, setFupData] = useState({ date: todayStr(), status: '', notes: '' });

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
      setFupData({ date: todayStr(), status: '', notes: '' });
    } catch (e) { toast(e.message, 'er'); }
  };

  /* PO CRUD */
  // Req 1 (4-Nov): a new purchase order is announced to the people whose
  // recommendation it waits on — the lead's Team Leader and the Operation
  // Manager / Admins who may recommend it.
  const tellPoRecommenders = (po) => {
    const seen = new Set();
    const tellOne = (u, title, message) => {
      const key = u && (u.displayName || u.email);
      if (!key || seen.has(key) || key === (user?.displayName || user?.email)) return;
      seen.add(key);
      createNotification({ forUser: key, title, message, type: 'status_update', module: 'leadPOs', relatedId: po.id });
    };
    const tlEmail = leadLeaderEmail(lead, users);
    const tl = tlEmail ? (users || []).find(u => String(u.email || '').toLowerCase() === tlEmail) : null;
    if (tl) tellOne(tl, 'PO needs your recommendation', `${user?.displayName || user?.email || 'A team member'} created PO ${po.poNumber || ''} for "${lead.name}" (${formatCurrency(po.agreedPrice || po.totalValue)}). As the Team Leader, please review and recommend it.`);
    (users || []).filter(u => u.approved !== false && u.role !== 'super_admin' && can(u.role, ACTIONS.PO_RECOMMENDATION))
      .forEach(u => tellOne(u, 'New PO awaiting recommendation', `PO ${po.poNumber || ''} for "${lead.name}" (${formatCurrency(po.agreedPrice || po.totalValue)}) was created by ${user?.displayName || user?.email || 'a team member'} and awaits recommendation.`));
  };

  const handlePOSave = async (data, poId) => {
    try {
      if (poId) {
        // Req 11 (4-Nov): materials added to an approved PO after the warehouse
        // pressed Stock OK reopen the verification for the new rows only; the
        // marks already given stay, and the warehouse is asked to verify the
        // additions and press Stock OK again.
        const prev = leadPOs.find(p => p.id === poId);
        const prevCount = (prev?.items || []).length;
        const added = (data.items || []).length - prevCount;
        const reverify = prev && added > 0 && prev.dispatchStatus === DISPATCH_STATUS.COMPLETED && !prev.dispatchConfirmedAt;
        let patch = data;
        if (reverify) {
          // The saved list is re-sorted into the Owner's BOM order, so a new
          // material can land anywhere: each existing mark follows its
          // material by name; the new ones start blank (5-Nov QC).
          const marks = dispatchMarks(prev);
          const keyOf = (it) => `${it.materialName || ''}|${it.specification || ''}`.trim().toLowerCase();
          const pool = new Map();
          (prev.items || []).forEach((it, i) => { const k = keyOf(it); if (!pool.has(k)) pool.set(k, []); pool.get(k).push(marks[i]); });
          const itemMarks = (data.items || []).map(it => { const q = pool.get(keyOf(it)); return q && q.length ? q.shift() : { dispatched: false, note: '' }; });
          patch = { ...data, dispatchItems: [...itemMarks, ...marks.slice(prevCount)], dispatchStatus: DISPATCH_STATUS.PARTIAL, dispatchReverifyAt: new Date().toISOString(), dispatchReverifyCount: added };
        }
        await updateDocument('leadPOs', poId, patch);
        toast(reverify ? `PO updated — the warehouse has been asked to verify the ${added} new material${added === 1 ? '' : 's'}` : 'PO updated');
        if (reverify) {
          const names = (data.items || []).slice(prevCount).map(it => it.materialName).filter(Boolean).join(', ');
          const me = user?.displayName || user?.email || 'The Operation Manager';
          [...warehouseUsers(users), ...dispatchNotifyUsers(users)].forEach(u => {
            const key = u.displayName || u.email;
            if (!key || key === me) return;
            createNotification({ forUser: key, title: `${me} added ${added} new material${added === 1 ? '' : 's'} — please verify`, message: `${me} added ${added} new material${added === 1 ? '' : 's'} to PO ${data.poNumber || ''} for "${lead.name}" after Stock OK: ${names}. Please verify their stock availability — the items already verified keep their marks — then press Stock OK again.`, type: 'status_update', module: 'leadPOs', relatedId: poId });
          });
        }
      } else {
        const newId = await addDocument('leadPOs', data);
        toast('PO created');
        tellPoRecommenders({ ...data, id: newId });
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
    if (!canRecommendLeadPO(po, lead, user, role, users)) {
      toast('Only this lead\u2019s Team Leader, the Operation Manager or an Admin can recommend this PO', 'er');
      return;
    }
    if (!requireAdvance(po)) return;
    if (!window.confirm('Recommend this PO for approval?')) return;
    try {
      await updateDocument('leadPOs', po.id, {
        status: PO_STATUS.RECOMMENDED,
        recommendedBy: user?.email || 'unknown',
        recommendedDate: new Date().toISOString()
      });
      notifyAdmins(users, { title: 'PO Awaiting Management Approval', message: `PO ${po.poNumber || ''} for "${lead.name}" was recommended and needs Management approval`, type: 'status_update', module: 'leadPOs', relatedId: po.id });
      // Req 1 (4-Nov): whoever raised the PO hears that it was recommended.
      if (po.createdBy && po.createdBy !== user?.email) {
        createNotification({ forUser: po.createdBy, title: 'Your PO was recommended', message: `${user?.displayName || user?.email} recommended PO ${po.poNumber || ''} for "${lead.name}". It now awaits Management approval.`, type: 'status_update', module: 'leadPOs', relatedId: po.id });
      }
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
        managementApprovalDate: new Date().toISOString()
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
        approvalDate: new Date().toISOString()
      });
      // Req 2 (30-Oct): the quotation keeps the BOM it was quoted with. The
      // PO's materials are the PO's; they no longer replace the quotation's
      // rows here. (The quotation's own "Use actual BOM" button still copies
      // them across on request.)
      // Tell the PO creator it's approved, and notify admins for visibility.
      if (po.createdBy) createNotification({ forUser: po.createdBy, title: 'PO Approved', message: `PO ${po.poNumber || ''} for "${lead.name}" has been approved`, type: 'status_update', module: 'leadPOs', relatedId: po.id });
      notifyAdmins(users, { title: 'PO Approved', message: `PO ${po.poNumber || ''} for "${lead.name}" has been approved`, type: 'status_update', module: 'leadPOs', relatedId: po.id });
      // Req 15 — and the warehouse, who are the ones who have to act on it.
      // Without this the approval sat in the office and nobody downstream knew
      // the material could go out.
      warehouseUsers(users).forEach(u => createNotification({
        forUser: u.displayName || u.email,
        title: 'PO Approved \u2014 ready for dispatch',
        message: `PO ${po.poNumber || ''} for "${lead.name}" is approved. Please verify each material (Yes / No) and submit Stock OK.`,
        type: 'status_update', module: 'leadPOs', relatedId: po.id,
      }));
      // Req 2 / Req 3.1 (15-Oct): the BCO's work starts here too, and the
      // approved PO is what opens the lead to them.
      (users || []).filter(u => u.approved !== false && normalizeRole(u.role) === 'bco').forEach(u => createNotification({
        forUser: u.displayName || u.email,
        title: 'PO Approved \u2014 BCO work can begin',
        message: `PO ${po.poNumber || ''} for "${lead.name}" is approved. The lead is now open to you under Leads for the BCO operations.`,
        type: 'status_update', module: 'leads', relatedId: lead.id,
      }));
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

  // BCO Operations: the seven post-sale stages, for the BCO and the
  // authorities, and for the lead's own people to look at.
  const myBco = (bcoOps || []).find(o => o.leadId === lead.id) || null;
  const bcoDone = bcoProgress(myBco);
  const tabs = [
    ['overview', 'Overview', 'info'],
    ['quotation', myQuote ? 'Quotation (' + myQuote.status + ')' : 'Quotation', 'description'],
    ['followups', 'Follow-ups (' + history.length + ')', 'history'],
    ['pos', 'Purchase Orders (' + myPOs.length + ')', 'receipt_long'],
    ...(canViewBco(lead, user, role, users) ? [['bco', `BCO Operations (${bcoDone.done}/${bcoDone.total})`, 'fact_check']] : []),
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
                {lead.siteVisit === 'Yes' && (lead.roofType || lead.structureType || lead.existingConnection || sitePhotoList(lead.siteVisitPhotos).length > 0) && (
                  <>
                    <div className="di" style={{ gridColumn: '1 / -1' }}><div className="dl" style={{ fontWeight: 700 }}>Site Visit Details</div><div className="dv">{lead.siteVisitDate ? formatDate(lead.siteVisitDate) : ''}</div></div>
                    {lead.roofType && <div className="di"><div className="dl">Roof Type</div><div className="dv">{lead.roofType}</div></div>}
                    {lead.floors && <div className="di"><div className="dl">Floors</div><div className="dv">{lead.floors}</div></div>}
                    {lead.structureType && <div className="di"><div className="dl">Type of Installation</div><div className="dv">{lead.structureType}</div></div>}
                    {lead.roofType === 'Elevated' && (lead.elevatedNorthHeight || lead.elevatedHeight) && <div className="di"><div className="dl">North Pole Height</div><div className="dv">{lead.elevatedNorthHeight || lead.elevatedHeight} ft</div></div>}
                    {lead.roofType === 'Elevated' && lead.elevatedSouthHeight && <div className="di"><div className="dl">South Pole Height</div><div className="dv">{lead.elevatedSouthHeight} ft</div></div>}
                    {lead.existingConnection && <div className="di"><div className="dl">Connection</div><div className="dv">{lead.existingConnection}</div></div>}
                    {lead.sanctionedLoad && <div className="di"><div className="dl">Sanctioned Load</div><div className="dv">{lead.sanctionedLoad} kW</div></div>}
                    {lead.availableSpace && <div className="di"><div className="dl">Available Space</div><div className="dv">{lead.availableSpace} sq.ft</div></div>}
                    {(lead.customerServiceNumber || lead.meterNumber) && <div className="di"><div className="dl">Customer Service No.</div><div className="dv">{lead.customerServiceNumber || lead.meterNumber}</div></div>}
                    {lead.siteVisitNotes && <div className="di" style={{ gridColumn: '1 / -1' }}><div className="dl">Site Visit Notes</div><div className="dv">{lead.siteVisitNotes}</div></div>}
                    {sitePhotoList(lead.siteVisitPhotos).length > 0 && (
                      <div className="di" style={{ gridColumn: '1 / -1' }}><div className="dl">Site Visit Photos ({sitePhotoList(lead.siteVisitPhotos).length})</div>
                        <div className="dv" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {sitePhotoList(lead.siteVisitPhotos).filter(p => isSafeUrl(p.url)).map((p, i) => (
                            <a key={p.url || i} href={p.url} target="_blank" rel="noreferrer" title={p.at ? formatDateTime(p.at) : ''}><img src={p.url} alt={`Site visit ${i + 1}`} style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--bor)' }} /></a>
                          ))}
                        </div>
                      </div>
                    )}
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
                {canEditLead(lead, user, role, users) ? <button className="btn bsm bp" onClick={() => setFupForm(!fupForm)}>
                  <span className="material-icons-round" style={{ fontSize: 16 }}>{fupForm ? 'close' : 'add'}</span>
                  {fupForm ? 'Cancel' : 'Log Follow-up'}
                </button> : <span style={{ fontSize: '.8rem', color: 'var(--muted)' }}>View only — follow-ups are logged by the assigned person or their Team Leader.</span>}
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
                        {withCurrent(getOptions(settings, 'followUpStatus'), fupData.status).map(f => <option key={f}>{f}</option>)}
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
                          <td style={{ fontSize: '.84rem', whiteSpace: 'nowrap' }}>{formatDate(h.date)}{h.at ? <><br /><span style={{ fontSize: '.72rem', color: 'var(--muted)' }}>logged {formatDateTime(h.at)}</span></> : null}</td>
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
                {/* Req 13 — raising the PO happens here, in the same window as the
                    quotation. Open to the roles that always had it and, now, to
                    the person the lead is assigned to and their Team Leader. */}
                {canAddLeadPO(lead, user, role, users) && quoteAccepted !== false && (
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
                        {canRecommendLeadPO(po, lead, user, role, users) && (
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
                        {/* One document: the PO letter on page 1, the Bill of
                            Materials with its signatures on page 2 — the way the
                            company's own reference purchase order is laid out. */}
                        <button className="btn bsm bo" onClick={() => openPoPdf(po, m => toast(m, 'er'))} title="Open the purchase order and its BOM as a PDF">
                          <span className="material-icons-round" style={{ fontSize: 16 }}>picture_as_pdf</span> View PO + BOM
                        </button>
                        <button className="btn bsm bo" onClick={() => downloadPoPdf(po, m => toast(m, 'er'))} style={{ color: '#6c5ce7', borderColor: 'rgba(108,92,231,.3)' }} title="Download the purchase order PDF">
                          <span className="material-icons-round" style={{ fontSize: 16 }}>download</span> Download
                        </button>
                        <button className="btn bsm bo" onClick={() => sharePOWhatsApp(po)} style={{ color: '#25d366', borderColor: 'rgba(37,211,102,.3)' }}>
                          <span className="material-icons-round" style={{ fontSize: 16 }}>share</span> WhatsApp
                        </button>
                        {/* Edit: non-Approved, PO Record permission (Operation Manager / Admin) */}
                        {canEditLeadPO(po, lead, user, role, users) && (
                          <button className="btn bsm bo" onClick={() => setPOModal({ data: po, id: po.id })}>
                            <span className="material-icons-round" style={{ fontSize: 16 }}>edit</span>
                          </button>
                        )}
                        {/* Delete: the Owner only (Req 1, 28-Oct) */}
                        {role === 'super_admin' && (
                          <button className="btn bsm bo" onClick={() => handleDeletePO(po.id)} title="Delete (Owner only)" style={{ color: 'var(--err)', borderColor: 'rgba(231,76,60,.3)' }}>
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

                    {/* Once approved, the warehouse dispatch — marked item by
                        item, completed, and confirmed — sits under the PO. */}
                    <DispatchPanel po={po} lead={lead} />

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

          {/* -------- BCO OPERATIONS TAB -------- */}
          {tab === 'bco' && <BcoOperationsPanel lead={lead} />}
        </div>
      </div>

      {/* PO Create/Edit sub-modal */}
      {poModal && <LeadPOModal lead={lead} po={poModal.data} poId={poModal.id} existingPOs={leadPOs} onSave={handlePOSave} onClose={() => setPOModal(null)} />}
    </div>
  );
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

  shareWhatsApp(lead.phone, msg);
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

  shareWhatsApp(lead.phone, msg);
}
