import React, { useState, useEffect } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { updateDocument, createNotification } from '../services/firestore';
import { apiUpload } from '../services/api';
import { formatDate, formatDateTime, compressImage, isSafeUrl } from '../services/helpers';
import {
  DISPATCH_STATUS, DISPATCH_CONFIRM_ROLES, dispatchOpen, canUpdateDispatch, canConfirmDispatch,
  dispatchMarks, dispatchSummary, dispatchCompleteIssue, dispatchNotifyUsers, warehouseUsers,
  canAssignDispatch, dispatchedItemNames, dispatchHandoverState, dispatchSent, normalizeRole,
} from '../services/permissions';
import { directoryPeople } from '../services/people';
import {
  finalDispatchOpen, canFinalDispatch, finalDispatchLines, finalDispatchIssue, finalDispatchBody, finalDispatchState, stockDispatched, qtyText,
} from '../services/stock';
import { confirmFinalDispatch } from '../services/stockApi';
import {
  handoverLines, blankHandoverMarks, handoverIssue, handoverMarksForSave, handoverSummary,
  canConfirmHandover, handoverDone, canConfirmDelivery, deliveryOpen, deliveryDone, deliveryIssue, dispatchTimeline,
} from '../services/dispatchFlow';
import { SearchSelect } from './SharedUI';

const nowIso = () => new Date().toISOString();
const NOT_STOCKED = '— not kept in inventory —';
const PHOTO_MAX_EDGE = 1600;
const PHOTO_QUALITY = 0.8;

// ============================================================================
// Material dispatch on an approved purchase order — the whole movement, on
// the PO itself, wherever the PO is shown (the lead's Purchase Orders tab,
// the Purchase Orders page, and Assigned Materials).
//
//   1. Warehouse material verification: each item Yes / No with a note, saved
//      as it goes, then "Stock OK" — which locks the warehouse's entry and
//      sends the list to the Operation Manager (Req 3.2–3.3, 15-Oct; this was
//      "OK & Send" before and is the same step).
//   2. The Operation Manager reviews (and may still correct the marks) and
//      gives the "Approval for Dispatch" (Req 3.4; formerly "Confirm Dispatch").
//   3. The Operation Manager assigns the items to a person, who is notified
//      and finds them under Assigned Materials (R6, 8-Oct; Req 3.5–3.6).
//   4. First handover: the person checks each item received from the
//      warehouse, Yes / No with a note, and presses "Handover Received" (Req 3.7).
//   5. Second handover: at the customer's location the person checks each
//      item again, photographs the delivery, and presses "Delivery Confirmed"
//      (Req 3.8).
//   6. The stock comes off at "Confirm Final Dispatch" (10-Oct), once.
//
// Every step is a stamp on the PO, so the history at the bottom is the record
// itself. The PO's own status is never touched here.
// ============================================================================
export default function DispatchPanel({ po, lead }) {
  const { users, materials } = useData();
  const { role, user } = useAuth();
  const { toast } = useToast();
  const meName = user?.displayName || user?.email || '';

  const [marks, setMarks] = useState(() => dispatchMarks(po));
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [assignee, setAssignee] = useState('');
  const [assignNote, setAssignNote] = useState('');
  // The final dispatch: which inventory material each sent line is.
  const [mapOverride, setMapOverride] = useState({});
  const [destination, setDestination] = useState('');
  const [dispatchNote, setDispatchNote] = useState('');
  // The two handovers: the person's Yes / No per item, the delivery photos.
  const [handMarks, setHandMarks] = useState(() => blankHandoverMarks(po));
  const [delivMarks, setDelivMarks] = useState(() => blankHandoverMarks(po));
  const [photos, setPhotos] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [deliveryLocation, setDeliveryLocation] = useState('');
  const [deliveryNote, setDeliveryNote] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  // What the server last gave us (or what we last saved), so a refreshed copy
  // of the PO replaces the marks only when it actually differs — and never
  // while something is half-done here.
  const [baseline, setBaseline] = useState(() => JSON.stringify(dispatchMarks(po)));
  useEffect(() => {
    const incoming = JSON.stringify(dispatchMarks(po));
    if (incoming !== baseline && !dirty) { setMarks(dispatchMarks(po)); setBaseline(incoming); }
  }, [po, dirty, baseline]);

  if (!dispatchOpen(po)) return null;

  const items = po.items || [];
  const mayEdit = canUpdateDispatch(po, role);
  const mayConfirm = canConfirmDispatch(po, role);
  const mayAssign = canAssignDispatch(po, role);
  const mayReceive = canConfirmHandover(po, user);
  const mayDeliver = canConfirmDelivery(po, user, role);
  const isConfirmer = role === 'super_admin' || DISPATCH_CONFIRM_ROLES.includes(normalizeRole(role));
  const summary = dispatchSummary({ ...po, dispatchItems: marks });
  const leadName = (lead && lead.name) || po.customerName || po.leadName || '';
  const label = `PO ${po.poNumber || ''}${leadName ? ` for "${leadName}"` : ''}`;
  const sentItems = dispatchedItemNames(po);
  const handover = dispatchHandoverState(po);
  const mayFinalDispatch = canFinalDispatch(po, user, role);
  const finalState = finalDispatchState(po);
  const stockList = materials || [];
  const finalLines = finalDispatchLines(po, stockList).map(l => (
    Object.prototype.hasOwnProperty.call(mapOverride, l.index) ? { ...l, materialId: mapOverride[l.index], suggested: false } : l));
  const finalIssue = finalDispatchIssue(finalLines, stockList);
  const materialName = (id) => { const m = stockList.find(x => x.id === id); return m ? m.name : ''; };
  const defaultDestination = [leadName, po.customerAddress || (lead && lead.address) || ''].filter(Boolean).join(', ');
  const stockOkLocked = po.dispatchStatus === DISPATCH_STATUS.COMPLETED && !po.dispatchConfirmedAt && !isConfirmer;
  const timeline = dispatchTimeline(po);

  const setMark = (i, patch) => {
    setDirty(true);
    setMarks(ms => ms.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  };

  // Stamp who marked what, and when, as it is saved.
  const stamped = () => marks.map((m, i) => {
    const before = dispatchMarks(po)[i] || {};
    const changed = !!m.dispatched !== !!before.dispatched || (m.note || '') !== (before.note || '');
    return changed ? { ...m, at: nowIso(), by: meName } : m;
  });

  const save = async (extra = {}, okMsg = 'Material verification saved') => {
    setBusy(true);
    try {
      const next = stamped();
      // A dispatch already declared complete stays complete when a mark is
      // corrected afterwards; it does not slip back to "partly dispatched".
      const status = extra.dispatchStatus
        || (po.dispatchStatus === DISPATCH_STATUS.COMPLETED ? DISPATCH_STATUS.COMPLETED
          : (next.some(m => m.dispatched) ? DISPATCH_STATUS.PARTIAL : DISPATCH_STATUS.NONE));
      await updateDocument('leadPOs', po.id, {
        dispatchItems: next,
        dispatchStatus: status,
        dispatchUpdatedAt: nowIso(), dispatchUpdatedBy: meName,
        ...extra,
      });
      setMarks(next);
      setBaseline(JSON.stringify(dispatchMarks({ ...po, dispatchItems: next })));
      setDirty(false);
      toast(okMsg);
      return next;
    } catch (e) { toast(e.message, 'er'); return null; }
    finally { setBusy(false); }
  };

  // Tell a set of people, once each, never the person acting.
  const tell = (people, title, message, module = 'leadPOs') => {
    const seen = new Set();
    people.forEach(u => {
      const key = typeof u === 'string' ? u : (u && (u.displayName || u.email));
      if (!key || seen.has(key) || key === meName) return;
      seen.add(key);
      createNotification({ forUser: key, title, message, type: 'status_update', module, relatedId: po.id });
    });
  };

  // "Stock OK" — the warehouse's verification goes to the office and is locked.
  const complete = async () => {
    const issue = dispatchCompleteIssue(po, marks);
    if (issue) { toast(issue, 'er'); return; }
    const s = dispatchSummary({ ...po, dispatchItems: marks });
    const sent = dispatchedItemNames({ ...po, dispatchItems: marks });
    const pendingText = s.pending.length
      ? ` Not available: ${s.pending.map(p => `${p.name} (${p.note})`).join('; ')}.`
      : '';
    if (!window.confirm(`Stock OK — submit the material verification for ${label} to the Operations Manager?\n${s.dispatched} of ${s.total} items available.${pendingText}\n\nAfter this the warehouse can no longer change it.`)) return;
    const saved = await save(
      { dispatchStatus: DISPATCH_STATUS.COMPLETED, dispatchCompletedAt: nowIso(), dispatchCompletedBy: meName },
      'Stock OK submitted — the Operations Manager has been notified');
    if (!saved) return;
    tell(dispatchNotifyUsers(users), 'Stock OK — Material Verification Submitted',
      `${meName} submitted the warehouse verification for ${label}: ${s.dispatched} of ${s.total} items available. Available: ${sent.join(', ') || 'none'}.${pendingText} Open the PO to review and give the Approval for Dispatch.`);
  };

  // "Approval for Dispatch" — the Operation Manager's review.
  const confirm = async () => {
    if (!window.confirm(`Approval for Dispatch — accept the verified material for ${label} as reviewed?`)) return;
    setBusy(true);
    try {
      await updateDocument('leadPOs', po.id, { dispatchConfirmedAt: nowIso(), dispatchConfirmedBy: meName });
      toast('Approved for dispatch — assign the materials to a person below');
      tell([...warehouseUsers(users), ...dispatchNotifyUsers(users)], 'Approval for Dispatch Given',
        `${meName} reviewed the material verification for ${label} and approved it for dispatch. The next step is to assign the materials to a person.`);
    } catch (e) { toast(e.message, 'er'); }
    finally { setBusy(false); }
  };

  // The Operation Manager hands the items to a person.
  const assign = async () => {
    const name = String(assignee || '').trim();
    if (!name) { toast('Choose who the items are assigned to', 'er'); return; }
    if (!sentItems.length) { toast('Nothing has been verified as available yet to assign', 'er'); return; }
    if (!window.confirm(`Assign the ${sentItems.length} item(s) for ${label} to ${name}?`)) return;
    setBusy(true);
    try {
      const person = directoryPeople(users).find(p => p.name.toLowerCase() === name.toLowerCase());
      await updateDocument('leadPOs', po.id, {
        dispatchAssignedTo: name,
        dispatchAssignedToEmail: (person && person.email) || '',
        dispatchAssignedBy: meName, dispatchAssignedAt: nowIso(),
        dispatchAssignNote: assignNote.trim(),
        // A re-assignment starts the handover afresh.
        dispatchReceivedBy: '', dispatchReceivedAt: '', dispatchReceivedNote: '', handoverItems: [],
      });
      toast(`Items assigned to ${name} — they have been notified`);
      tell([name], 'Materials Assigned to You',
        `${meName} assigned you the material for ${label}. Items (${sentItems.length}): ${sentItems.join(', ')}.`
        + `${assignNote.trim() ? ' Note: ' + assignNote.trim() + '.' : ''} Open Assigned Materials, check each item received from the warehouse and press "Handover Received".`, 'assignedMaterials');
      tell([...warehouseUsers(users), ...dispatchNotifyUsers(users)], 'Materials Assigned for Dispatch',
        `${meName} assigned the material for ${label} to ${name} (${sentItems.length} items).`);
      setAssignee(''); setAssignNote('');
    } catch (e) { toast(e.message, 'er'); }
    finally { setBusy(false); }
  };

  // First handover: the assigned person confirms what they received, item by item.
  const receive = async () => {
    const issue = handoverIssue(po, handMarks);
    if (issue) { toast(issue, 'er'); return; }
    const s = handoverSummary(po, handMarks);
    if (!window.confirm(`Handover Received — confirm you have received the material for ${label}?\n${s.text}`)) return;
    setBusy(true);
    try {
      await updateDocument('leadPOs', po.id, { dispatchReceivedBy: meName, dispatchReceivedAt: nowIso(), handoverItems: handoverMarksForSave(po, handMarks) });
      toast('Handover recorded — the Operations Manager and the warehouse have been notified');
      tell([po.dispatchAssignedBy, ...dispatchNotifyUsers(users), ...warehouseUsers(users)], 'Handover Received',
        `${meName} confirmed receipt of the material for ${label} from the warehouse: ${s.text}. Next: delivery at the customer location with photo proof.`);
    } catch (e) { toast(e.message, 'er'); }
    finally { setBusy(false); }
  };

  // Delivery proof photographs.
  const addPhotos = async (files) => {
    const list = Array.from(files || []).filter(f => f && f.type && f.type.startsWith('image/'));
    if (!list.length) { toast('Choose a photograph (JPG / PNG)', 'er'); return; }
    setUploading(true);
    try {
      const added = [];
      for (const f of list) {
        const small = await compressImage(f, PHOTO_MAX_EDGE, PHOTO_QUALITY);
        const res = await apiUpload(small, 'deliveries');
        if (res && res.url) added.push({ url: res.url, name: res.name || f.name, at: nowIso(), by: meName });
      }
      setPhotos(p => [...p, ...added]);
      toast(`${added.length} photo${added.length === 1 ? '' : 's'} uploaded`);
    } catch (e) { toast(e.message, 'er'); }
    finally { setUploading(false); }
  };

  // Second handover: delivered at the customer's location, with proof.
  const deliver = async () => {
    const issue = deliveryIssue(po, delivMarks, photos);
    if (issue) { toast(issue, 'er'); return; }
    const s = handoverSummary(po, delivMarks);
    if (!window.confirm(`Delivery Confirmed — record that the material for ${label} was delivered at the customer location?\n${s.text}\n${photos.length} photo(s) attached.`)) return;
    setBusy(true);
    try {
      await updateDocument('leadPOs', po.id, {
        deliveryItems: handoverMarksForSave(po, delivMarks), deliveryPhotos: photos,
        deliveredBy: meName, deliveredByEmail: user?.email || '', deliveredAt: nowIso(),
        deliveryLocation: (deliveryLocation || defaultDestination).trim(), deliveryNote: deliveryNote.trim(),
      });
      toast('Delivery confirmed — the Operations Manager and the warehouse have been notified');
      tell([po.dispatchAssignedBy, ...dispatchNotifyUsers(users), ...warehouseUsers(users)], 'Delivered at the Customer Location',
        `${meName} delivered the material for ${label}${deliveryLocation.trim() ? ' at ' + deliveryLocation.trim() : ''}: ${s.text}. ${photos.length} photo${photos.length === 1 ? '' : 's'} attached as proof.${deliveryNote.trim() ? ' Note: ' + deliveryNote.trim() : ''}`);
      setPhotos([]); setDeliveryNote('');
    } catch (e) { toast(e.message, 'er'); }
    finally { setBusy(false); }
  };

  // The last step: the stock comes off, once.
  const finalDispatch = async () => {
    if (finalIssue) { toast(finalIssue, 'er'); return; }
    const chosen = finalLines.filter(l => l.materialId);
    const list = chosen.map(l => `${materialName(l.materialId)} −${qtyText(l.quantity, l.unit)}`).join('\n');
    if (!window.confirm(`Confirm the FINAL DISPATCH for ${label}?\n\nThis deducts the stock now and cannot be repeated:\n${list}`)) return;
    setBusy(true);
    try {
      const res = await confirmFinalDispatch(finalDispatchBody(po, finalLines, { destination: (destination || defaultDestination).trim(), note: dispatchNote.trim() }));
      toast(`Final dispatch confirmed — stock deducted (ref ${res.reference || ''}). The Operations Manager and the Owner have been notified.`);
      setMapOverride({}); setDispatchNote('');
    } catch (e) { toast(e.message, 'er'); }
    finally { setBusy(false); }
  };

  const tone = po.dispatchConfirmedAt ? '#1e8449'
    : po.dispatchStatus === DISPATCH_STATUS.COMPLETED ? '#1e8449'
      : po.dispatchStatus === DISPATCH_STATUS.PARTIAL ? '#d68910' : 'var(--muted)';
  const stateText = po.dispatchConfirmedAt
    ? `Approved for dispatch by ${po.dispatchConfirmedBy || '-'} on ${formatDate(po.dispatchConfirmedAt)}`
    : po.dispatchStatus === DISPATCH_STATUS.COMPLETED
      ? `Stock OK — submitted by ${po.dispatchCompletedBy || '-'} on ${formatDate(po.dispatchCompletedAt)} — awaiting the Operation Manager's Approval for Dispatch`
      : po.dispatchStatus === DISPATCH_STATUS.PARTIAL
        ? `Being verified — ${summary.dispatched} of ${summary.total} items available`
        : 'Awaiting the warehouse material verification';

  // One Yes / No row set, used for both handovers.
  const HandoverTable = ({ lines, marksState, setMarksState, yesLabel, noLabel, disabled }) => (
    <div className="tw">
      <table style={{ fontSize: '.8rem' }}>
        <thead><tr><th style={{ width: 34 }}>#</th><th>Material</th><th>Qty</th><th style={{ width: 170 }}>{yesLabel} / {noLabel}</th><th>Notes / reason</th></tr></thead>
        <tbody>
          {lines.map(l => (
            <tr key={l.index} style={{ background: l.ok === true ? 'rgba(39,174,96,.06)' : l.ok === false ? 'rgba(231,76,60,.06)' : 'transparent' }}>
              <td>{l.index + 1}</td>
              <td>{l.name}{l.spec ? <span style={{ color: 'var(--muted)' }}> · {l.spec}</span> : null}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{l.quantity} {l.unit}</td>
              <td>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className={`btn bsm ${l.ok === true ? 'bp' : 'bo'}`} style={l.ok === true ? { background: '#1e8449' } : {}} disabled={disabled}
                    onClick={() => setMarksState(ms => { const n = [...ms]; n[l.index] = { ...(n[l.index] || {}), ok: true }; return n; })}>Yes</button>
                  <button type="button" className={`btn bsm ${l.ok === false ? 'bp' : 'bo'}`} style={l.ok === false ? { background: '#c0392b' } : {}} disabled={disabled}
                    onClick={() => setMarksState(ms => { const n = [...ms]; n[l.index] = { ...(n[l.index] || {}), ok: false }; return n; })}>No</button>
                </div>
              </td>
              <td>
                <input className="fi" style={{ padding: '4px 6px', fontSize: '.78rem' }} value={l.note} disabled={disabled}
                  placeholder={l.ok === false ? 'What is wrong? (required)' : 'Optional note'}
                  onChange={e => setMarksState(ms => { const n = [...ms]; n[l.index] = { ...(n[l.index] || { ok: null }), note: e.target.value }; return n; })} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  // The same rows read-only, once recorded.
  const RecordedTable = ({ lines, yesLabel, noLabel }) => (
    <div className="tw">
      <table style={{ fontSize: '.78rem' }}>
        <thead><tr><th style={{ width: 34 }}>#</th><th>Material</th><th>Qty</th><th>{yesLabel} / {noLabel}</th><th>Notes</th></tr></thead>
        <tbody>
          {lines.map(l => (
            <tr key={l.index}>
              <td>{l.index + 1}</td><td>{l.name}</td><td style={{ whiteSpace: 'nowrap' }}>{l.quantity} {l.unit}</td>
              <td>{l.ok === true ? <span style={{ color: '#1e8449', fontWeight: 600 }}>{yesLabel}</span> : l.ok === false ? <span style={{ color: '#c0392b', fontWeight: 600 }}>{noLabel}</span> : <span style={{ color: 'var(--muted)' }}>—</span>}</td>
              <td style={{ color: 'var(--muted)' }}>{l.note || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div style={{ marginTop: 12, border: '1px solid var(--bor)', borderRadius: 10, padding: '10px 12px', background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <span className="material-icons-round" style={{ fontSize: 18, color: tone }}>local_shipping</span>
        <strong style={{ fontSize: '.86rem' }}>Material Dispatch — Warehouse Verification</strong>
        <span style={{ fontSize: '.78rem', color: tone }}>{stateText}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: '.76rem', color: 'var(--muted)' }}>{summary.dispatched} / {summary.total} available</span>
      </div>

      <div className="tw">
        <table style={{ fontSize: '.8rem' }}>
          <thead><tr>
            <th style={{ width: 34 }}>#</th><th>Material</th><th>Ordered Qty</th><th style={{ width: 130 }}>Available (Yes / No)</th><th>Notes / reason if not available</th><th>Marked</th>
          </tr></thead>
          <tbody>
            {items.map((it, i) => {
              const m = marks[i] || { dispatched: false, note: '' };
              return (
                <tr key={i} style={{ background: m.dispatched ? 'rgba(39,174,96,.06)' : 'transparent' }}>
                  <td>{i + 1}</td>
                  <td>{it.materialName}{it.specification ? <span style={{ color: 'var(--muted)' }}> · {it.specification}</span> : null}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{it.quantity} {it.unit || ''}</td>
                  <td>
                    {mayEdit ? (
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                        <input type="checkbox" checked={!!m.dispatched} disabled={busy}
                          onChange={e => setMark(i, { dispatched: e.target.checked, note: e.target.checked ? '' : m.note })} />
                        {m.dispatched ? 'Yes' : 'No'}
                      </label>
                    ) : (
                      m.dispatched
                        ? <span style={{ color: '#1e8449', fontWeight: 600 }}><span className="material-icons-round" style={{ fontSize: 15, verticalAlign: '-3px' }}>check_circle</span> Yes</span>
                        : <span style={{ color: '#c0392b' }}>No</span>
                    )}
                  </td>
                  <td>
                    {mayEdit && !m.dispatched
                      ? <input className="fi" style={{ padding: '4px 6px', fontSize: '.78rem' }} value={m.note || ''} placeholder="Why is this not available?"
                          onChange={e => setMark(i, { note: e.target.value })} disabled={busy} />
                      : <span style={{ color: m.dispatched ? 'var(--muted)' : '#c0392b' }}>{m.note || (m.dispatched ? '—' : '')}</span>}
                  </td>
                  <td style={{ fontSize: '.72rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{m.by ? <>{m.by}<br />{formatDate(m.at)}</> : '-'}</td>
                </tr>
              );
            })}
            {!items.length && <tr><td colSpan="6" style={{ color: 'var(--muted)' }}>No items on this purchase order.</td></tr>}
          </tbody>
        </table>
      </div>

      {stockOkLocked && (
        <div style={{ fontSize: '.76rem', color: 'var(--muted)', marginTop: 6 }}>
          <span className="material-icons-round" style={{ fontSize: 14, verticalAlign: '-2px' }}>lock</span> Stock OK has been submitted; the verification is locked for the warehouse. The Operation Manager can correct it.
        </div>
      )}

      {(mayEdit || mayConfirm) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {mayEdit && (
            <button className="btn bsm bo" disabled={busy || !dirty} onClick={() => save()} title="Save the marks made so far">
              <span className="material-icons-round" style={{ fontSize: 16 }}>save</span> Save Verification
            </button>
          )}
          {mayEdit && po.dispatchStatus !== DISPATCH_STATUS.COMPLETED && (
            <button className="btn bsm bp" disabled={busy} onClick={complete} title="Stock OK — submits the verification to the Operations Manager and locks it for the warehouse">
              <span className="material-icons-round" style={{ fontSize: 16 }}>send</span> Stock OK
            </button>
          )}
          {mayConfirm && (
            <button className="btn bsm bp" disabled={busy} onClick={confirm} style={{ background: '#1e8449' }} title="Operation Manager: accept the verified material for dispatch">
              <span className="material-icons-round" style={{ fontSize: 16 }}>verified</span> Approval for Dispatch
            </button>
          )}
          {dirty && <span style={{ fontSize: '.76rem', color: '#d68910', alignSelf: 'center' }}>Unsaved marks</span>}
        </div>
      )}

      {/* ── The handover: Operation Manager → person → received ──────────── */}
      {dispatchSent(po) && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dashed var(--bor)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
            <span className="material-icons-round" style={{ fontSize: 18, color: handover.step === 'received' ? '#1e8449' : handover.step === 'assigned' ? '#d68910' : 'var(--pri)' }}>
              {handover.step === 'received' ? 'how_to_reg' : handover.step === 'assigned' ? 'person_pin' : 'assignment_ind'}
            </span>
            <strong style={{ fontSize: '.84rem' }}>Assigned Person for Dispatch</strong>
            <span style={{ fontSize: '.78rem', color: 'var(--muted)' }}>{handover.text}</span>
          </div>

          <div style={{ fontSize: '.78rem', color: 'var(--dark)', marginBottom: 6 }}>
            <strong>Items verified by the warehouse ({sentItems.length}):</strong> {sentItems.join(', ') || 'none'}
          </div>

          {po.dispatchAssignedTo && (
            <div style={{ fontSize: '.78rem', color: 'var(--muted)', marginBottom: 6 }}>
              Assigned to <strong style={{ color: 'var(--dark)' }}>{po.dispatchAssignedTo}</strong> by {po.dispatchAssignedBy || '-'} on {formatDateTime(po.dispatchAssignedAt)}
              {po.dispatchAssignNote ? <> · Note: {po.dispatchAssignNote}</> : null}
              {po.dispatchReceivedAt
                ? <><br /><span style={{ color: '#1e8449', fontWeight: 600 }}><span className="material-icons-round" style={{ fontSize: 14, verticalAlign: '-2px' }}>check_circle</span> Handover received by {po.dispatchReceivedBy || po.dispatchAssignedTo} on {formatDateTime(po.dispatchReceivedAt)}</span>{Array.isArray(po.handoverItems) && handoverLines(po, po.handoverItems).length ? ` — ${handoverSummary(po, po.handoverItems).text}` : ''}</>
                : <><br /><span style={{ color: '#d68910' }}>Awaiting their "Handover Received".</span></>}
            </div>
          )}

          {mayAssign && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 6 }}>
              <div style={{ minWidth: 220, flex: 1 }}>
                <label style={{ fontSize: '.74rem', color: 'var(--muted)', display: 'block', marginBottom: 3 }}>{po.dispatchAssignedTo ? 'Re-assign the items to' : 'Assign the items to'}</label>
                <SearchSelect value={assignee} onChange={setAssignee} options={directoryPeople(users).map(p => p.name)} allowFree={false} placeholder="Select the person…" />
              </div>
              <div style={{ minWidth: 200, flex: 1 }}>
                <label style={{ fontSize: '.74rem', color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Note for them (optional)</label>
                <input className="fi" value={assignNote} onChange={e => setAssignNote(e.target.value)} placeholder="e.g. collect from the warehouse by Friday" />
              </div>
              <button className="btn bsm bp" disabled={busy || !assignee} onClick={assign} title="The person is notified with the list of items">
                <span className="material-icons-round" style={{ fontSize: 16 }}>assignment_ind</span> {po.dispatchAssignedTo ? 'Re-assign' : 'Assign Person'}
              </button>
            </div>
          )}

          {/* First handover: item by item, from the warehouse */}
          {mayReceive && (
            <div style={{ marginTop: 10, border: '1px solid var(--bor)', borderRadius: 8, padding: 10 }}>
              <div style={{ fontSize: '.82rem', fontWeight: 700, marginBottom: 6 }}><span className="material-icons-round" style={{ fontSize: 16, verticalAlign: '-3px', color: 'var(--pri)' }}>fact_check</span> Handover from the warehouse — check each item you received</div>
              <HandoverTable lines={handoverLines(po, handMarks)} marksState={handMarks} setMarksState={setHandMarks} yesLabel="Received" noLabel="Missing" disabled={busy} />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                <button className="btn bsm bp" disabled={busy} onClick={receive} style={{ background: '#1e8449' }} title="Confirm the items are with you — the Operations Manager and the warehouse are notified">
                  <span className="material-icons-round" style={{ fontSize: 16 }}>how_to_reg</span> Handover Received
                </button>
                {handoverIssue(po, handMarks) && <span style={{ fontSize: '.74rem', color: 'var(--muted)' }}>{handoverIssue(po, handMarks)}</span>}
              </div>
            </div>
          )}
          {handoverDone(po) && Array.isArray(po.handoverItems) && handoverLines(po, po.handoverItems).length > 0 && !mayReceive && (
            <details style={{ marginTop: 6, fontSize: '.78rem' }}>
              <summary style={{ cursor: 'pointer', color: 'var(--pri)' }}>Handover details ({handoverSummary(po, po.handoverItems).text})</summary>
              <RecordedTable lines={handoverLines(po, po.handoverItems)} yesLabel="Received" noLabel="Missing" />
            </details>
          )}
        </div>
      )}

      {/* ── The delivery at the customer's location ───────────────────────── */}
      {(deliveryOpen(po) || deliveryDone(po)) && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dashed var(--bor)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
            <span className="material-icons-round" style={{ fontSize: 18, color: deliveryDone(po) ? '#1e8449' : '#2980b9' }}>{deliveryDone(po) ? 'task_alt' : 'local_shipping'}</span>
            <strong style={{ fontSize: '.84rem' }}>Delivery at the Customer Location</strong>
            <span style={{ fontSize: '.78rem', color: 'var(--muted)' }}>
              {deliveryDone(po)
                ? `Delivered by ${po.deliveredBy || '-'} on ${formatDateTime(po.deliveredAt)}${po.deliveryLocation ? ' at ' + po.deliveryLocation : ''}`
                : `${po.dispatchAssignedTo} transports the material to ${defaultDestination || 'the customer'} and confirms each item with photo proof`}
            </span>
          </div>

          {deliveryDone(po) ? (
            <>
              {Array.isArray(po.deliveryItems) && <RecordedTable lines={handoverLines(po, po.deliveryItems)} yesLabel="Delivered" noLabel="Not delivered" />}
              {po.deliveryNote ? <div style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: 4 }}>Note: {po.deliveryNote}</div> : null}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                {(po.deliveryPhotos || []).filter(p => isSafeUrl(p.url)).map((p, i) => (
                  <a key={i} href={p.url} target="_blank" rel="noreferrer" title={`Delivery proof ${i + 1}${p.at ? ' · ' + formatDateTime(p.at) : ''}`}>
                    <img src={p.url} alt={`Delivery proof ${i + 1}`} style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--bor)' }} />
                  </a>
                ))}
              </div>
            </>
          ) : mayDeliver ? (
            <div style={{ border: '1px solid var(--bor)', borderRadius: 8, padding: 10 }}>
              <HandoverTable lines={handoverLines(po, delivMarks)} marksState={delivMarks} setMarksState={setDelivMarks} yesLabel="Delivered" noLabel="Not delivered" disabled={busy} />
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 8 }}>
                <div style={{ minWidth: 220, flex: 2 }}>
                  <label style={{ fontSize: '.74rem', color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Delivered at (location)</label>
                  <input className="fi" value={deliveryLocation} onChange={e => setDeliveryLocation(e.target.value)} placeholder={defaultDestination || 'Customer / project location'} disabled={busy} />
                </div>
                <div style={{ minWidth: 180, flex: 1 }}>
                  <label style={{ fontSize: '.74rem', color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Note (optional)</label>
                  <input className="fi" value={deliveryNote} onChange={e => setDeliveryNote(e.target.value)} placeholder="Received by, vehicle, …" disabled={busy} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
                <label className="btn bsm bo" style={{ cursor: uploading ? 'wait' : 'pointer' }} title="Photograph the delivered material at the location">
                  <span className="material-icons-round" style={{ fontSize: 16 }}>add_a_photo</span> {uploading ? 'Uploading…' : 'Add delivery photo'}
                  <input type="file" accept="image/*" capture="environment" multiple style={{ display: 'none' }} disabled={uploading || busy} onChange={e => { addPhotos(e.target.files); e.target.value = ''; }} />
                </label>
                {photos.map((p, i) => (
                  <span key={i} style={{ position: 'relative', display: 'inline-block' }}>
                    <img src={p.url} alt={`Proof ${i + 1}`} style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--bor)' }} />
                    <button type="button" className="btn bsm bo" style={{ position: 'absolute', top: -6, right: -6, padding: 0, width: 20, height: 20, borderRadius: 10, lineHeight: '18px' }} title="Remove" onClick={() => setPhotos(ps => ps.filter((_, j) => j !== i))} disabled={busy}>×</button>
                  </span>
                ))}
                {!photos.length && <span style={{ fontSize: '.74rem', color: '#c0392b' }}>At least one photo is required as proof of delivery.</span>}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
                <button className="btn bsm bp" disabled={busy || uploading || !!deliveryIssue(po, delivMarks, photos)} onClick={deliver} style={{ background: '#2980b9' }} title={deliveryIssue(po, delivMarks, photos) || 'Record the delivery — the Operations Manager and the warehouse are notified'}>
                  <span className="material-icons-round" style={{ fontSize: 16 }}>task_alt</span> Delivery Confirmed
                </button>
                {deliveryIssue(po, delivMarks, photos) && <span style={{ fontSize: '.74rem', color: 'var(--muted)' }}>{deliveryIssue(po, delivMarks, photos)}</span>}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: '.78rem', color: 'var(--muted)' }}>Awaiting the delivery confirmation and photo proof from {po.dispatchAssignedTo || 'the assigned person'}.</div>
          )}
        </div>
      )}

      {/* ── The final dispatch: the one step that takes stock out ─────────── */}
      {(finalDispatchOpen(po) || stockDispatched(po)) && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dashed var(--bor)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
            <span className="material-icons-round" style={{ fontSize: 18, color: finalState.step === 'done' ? '#1e8449' : '#c0392b' }}>{finalState.step === 'done' ? 'inventory' : 'outbox'}</span>
            <strong style={{ fontSize: '.84rem' }}>Final Dispatch — Stock Deduction</strong>
            <span style={{ fontSize: '.78rem', color: 'var(--muted)' }}>{finalState.text}</span>
          </div>

          {stockDispatched(po) ? (
            <div style={{ fontSize: '.78rem' }}>
              <div style={{ color: '#1e8449', fontWeight: 600 }}><span className="material-icons-round" style={{ fontSize: 14, verticalAlign: '-2px' }}>check_circle</span> Stock deducted on {formatDate(po.stockDispatchedAt)} by {po.stockDispatchedBy || '-'} · ref {po.stockDispatchRef}</div>
              <ul style={{ margin: '4px 0 0 18px', padding: 0, color: 'var(--dark)' }}>
                {(po.stockDispatchItems || []).map((it, i) => <li key={i}>{it.materialName}: −{qtyText(it.quantity, it.unit)} ({qtyText(it.previousBalance, '')} → {qtyText(it.newBalance, '')})</li>)}
              </ul>
              {po.stockDispatchDestination ? <div style={{ color: 'var(--muted)', marginTop: 4 }}>Destination: {po.stockDispatchDestination}{po.stockDispatchNote ? ` · ${po.stockDispatchNote}` : ''}</div> : null}
            </div>
          ) : mayFinalDispatch ? (
            <>
              <div className="tw">
                <table style={{ fontSize: '.8rem' }}>
                  <thead><tr><th>Sent item</th><th>Qty</th><th style={{ minWidth: 220 }}>Inventory material to deduct</th><th>Available</th></tr></thead>
                  <tbody>
                    {finalLines.map(l => {
                      const m = stockList.find(x => x.id === l.materialId);
                      const short = m && l.quantity > (Number(m.balance) || 0);
                      return (
                        <tr key={l.index}>
                          <td>{l.name}{l.spec ? <span style={{ color: 'var(--muted)' }}> · {l.spec}</span> : null}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>{qtyText(l.quantity, l.unit)}</td>
                          <td>
                            <SearchSelect
                              value={l.materialId ? (m ? m.name : '') : (Object.prototype.hasOwnProperty.call(mapOverride, l.index) ? NOT_STOCKED : '')}
                              onChange={name => setMapOverride(o => ({ ...o, [l.index]: name === NOT_STOCKED ? '' : ((stockList.find(x => x.name === name) || {}).id || '') }))}
                              options={[NOT_STOCKED, ...stockList.map(x => x.name).filter(Boolean).sort()]} allowFree={false} placeholder="Choose the material…" disabled={busy} />
                            {l.suggested && <div style={{ fontSize: '.7rem', color: 'var(--muted)' }}>matched by name — change it if wrong</div>}
                          </td>
                          <td style={{ whiteSpace: 'nowrap', color: short ? '#c0392b' : 'var(--dark)', fontWeight: short ? 700 : 400 }}>{m ? qtyText(m.balance, m.unit) : '—'}{short ? ' (short)' : ''}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 8 }}>
                <div style={{ minWidth: 220, flex: 2 }}>
                  <label style={{ fontSize: '.74rem', color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Destination / project</label>
                  <input className="fi" value={destination} onChange={e => setDestination(e.target.value)} placeholder={defaultDestination || 'Site / customer'} disabled={busy} />
                </div>
                <div style={{ minWidth: 180, flex: 1 }}>
                  <label style={{ fontSize: '.74rem', color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Note (optional)</label>
                  <input className="fi" value={dispatchNote} onChange={e => setDispatchNote(e.target.value)} placeholder="Vehicle, challan no., …" disabled={busy} />
                </div>
                <button className="btn bsm bp" disabled={busy || !!finalIssue} onClick={finalDispatch} style={{ background: '#c0392b' }} title={finalIssue || 'Deduct the stock for the chosen materials — once'}>
                  <span className="material-icons-round" style={{ fontSize: 16 }}>outbox</span> Confirm Final Dispatch
                </button>
              </div>
              {finalIssue && <div style={{ fontSize: '.76rem', color: '#c0392b', marginTop: 6 }}>{finalIssue}</div>}
            </>
          ) : (
            <div style={{ fontSize: '.78rem', color: 'var(--muted)' }}>Awaiting the final dispatch confirmation by {po.dispatchAssignedTo || 'the assigned person'} or the Operation Manager; the stock is deducted then.</div>
          )}
        </div>
      )}

      {/* ── The movement history ───────────────────────────────────────────── */}
      <div style={{ marginTop: 12, paddingTop: 8, borderTop: '1px dashed var(--bor)' }}>
        <button type="button" className="btn bsm bo" onClick={() => setShowHistory(h => !h)} style={{ border: 'none', padding: '2px 0', color: 'var(--pri)' }}>
          <span className="material-icons-round" style={{ fontSize: 16 }}>{showHistory ? 'expand_less' : 'history'}</span> Material movement history ({timeline.filter(s => s.done).length} of {timeline.length} stages)
        </button>
        {showHistory && (
          <ol style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: '.78rem' }}>
            {timeline.map(s => (
              <li key={s.key} style={{ marginBottom: 4, color: s.done ? 'var(--dark)' : 'var(--muted)' }}>
                <span className="material-icons-round" style={{ fontSize: 14, verticalAlign: '-2px', color: s.done ? '#1e8449' : 'var(--muted)', marginRight: 4 }}>{s.done ? 'check_circle' : 'radio_button_unchecked'}</span>
                <strong>{s.label}</strong>
                {s.done ? <> — {s.by || '-'}{s.at ? `, ${formatDateTime(s.at)}` : ''}{s.detail ? ` · ${s.detail}` : ''}</> : <> — pending</>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
