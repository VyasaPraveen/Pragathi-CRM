import React, { useState, useEffect } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { updateDocument, createNotification } from '../services/firestore';
import { formatDate } from '../services/helpers';
import {
  DISPATCH_STATUS, dispatchOpen, canUpdateDispatch, canConfirmDispatch,
  dispatchMarks, dispatchSummary, dispatchCompleteIssue, dispatchNotifyUsers, warehouseUsers,
  canAssignDispatch, canReceiveDispatch, dispatchedItemNames, dispatchHandoverState, dispatchSent,
} from '../services/permissions';
import { directoryPeople } from '../services/people';
import { SearchSelect } from './SharedUI';

const nowIso = () => new Date().toISOString();

// ============================================================================
// Material dispatch on an approved purchase order.
//
// Shown under the PO wherever the PO is shown — the lead's Purchase Orders
// tab and the Purchase Orders page the warehouse works from. The warehouse
// marks each item sent or held back (with a reason), saves as it goes, and
// sends the list with "OK & Send" (which is the Material Dispatch Completed
// step); the authorities are told, and the Operation Manager confirms it.
//
// R6 (8-Oct) adds the handover that follows: the Operation Manager assigns
// the sent items to a named person, that person confirms "I have received
// these items", and the Operation Manager is told who received what. Each
// step is a stamp on the same PO. Everyone else sees the same read-only.
// The PO's own status is never touched here.
// ============================================================================
export default function DispatchPanel({ po, lead }) {
  const { users } = useData();
  const { role, user } = useAuth();
  const { toast } = useToast();
  const meName = user?.displayName || user?.email || '';

  const [marks, setMarks] = useState(() => dispatchMarks(po));
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [assignee, setAssignee] = useState('');
  const [assignNote, setAssignNote] = useState('');
  // What the server last gave us (or what we last saved), so a refreshed copy
  // of the PO replaces the marks only when it actually differs — and never
  // while something is half-done here. Without this, saving cleared the ticks
  // on screen for a moment: the sync ran against the copy from before the
  // save and put the old marks back until the refresh arrived.
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
  const mayReceive = canReceiveDispatch(po, user);
  const summary = dispatchSummary({ ...po, dispatchItems: marks });
  const leadName = (lead && lead.name) || po.customerName || po.leadName || '';
  const label = `PO ${po.poNumber || ''}${leadName ? ` for "${leadName}"` : ''}`;
  const sentItems = dispatchedItemNames(po);
  const handover = dispatchHandoverState(po);

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

  const save = async (extra = {}, okMsg = 'Dispatch saved') => {
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
  const tell = (people, title, message) => {
    const seen = new Set();
    people.forEach(u => {
      const key = typeof u === 'string' ? u : (u.displayName || u.email);
      if (!key || seen.has(key) || key === meName) return;
      seen.add(key);
      createNotification({ forUser: key, title, message, type: 'status_update', module: 'leadPOs', relatedId: po.id });
    });
  };

  // "OK & Send" — the warehouse's list goes to the office.
  const complete = async () => {
    const issue = dispatchCompleteIssue(po, marks);
    if (issue) { toast(issue, 'er'); return; }
    const s = dispatchSummary({ ...po, dispatchItems: marks });
    const sent = dispatchedItemNames({ ...po, dispatchItems: marks });
    const pendingText = s.pending.length
      ? ` Not dispatched: ${s.pending.map(p => `${p.name} (${p.note})`).join('; ')}.`
      : '';
    if (!window.confirm(`OK & Send — mark the material dispatch for ${label} complete and send the list to the Operations Manager?\n${s.dispatched} of ${s.total} items dispatched.${pendingText}`)) return;
    const saved = await save(
      { dispatchStatus: DISPATCH_STATUS.COMPLETED, dispatchCompletedAt: nowIso(), dispatchCompletedBy: meName },
      'Sent — the Operations Manager has been notified');
    if (!saved) return;
    // The Owner, Management, the Operation Manager and Admin are told, with
    // the full list of what went and what did not.
    tell(dispatchNotifyUsers(users), 'Material Dispatch Completed — OK & Send',
      `${meName} sent the material dispatch for ${label}: ${s.dispatched} of ${s.total} items. Items sent: ${sent.join(', ') || 'none'}.${pendingText} Open the PO to assign these items to a person.`);
  };

  const confirm = async () => {
    if (!window.confirm(`Confirm the dispatch for ${label} as reviewed and accepted?`)) return;
    setBusy(true);
    try {
      await updateDocument('leadPOs', po.id, { dispatchConfirmedAt: nowIso(), dispatchConfirmedBy: meName });
      toast('Dispatch confirmed');
      tell([...warehouseUsers(users), ...dispatchNotifyUsers(users)], 'Dispatch Confirmed',
        `${meName} reviewed and confirmed the material dispatch for ${label}.`);
    } catch (e) { toast(e.message, 'er'); }
    finally { setBusy(false); }
  };

  // The Operation Manager hands the sent items to a person.
  const assign = async () => {
    const name = String(assignee || '').trim();
    if (!name) { toast('Choose who the items are assigned to', 'er'); return; }
    if (!sentItems.length) { toast('Nothing has been dispatched yet to assign', 'er'); return; }
    if (!window.confirm(`Assign the ${sentItems.length} dispatched item(s) for ${label} to ${name}?`)) return;
    setBusy(true);
    try {
      const person = directoryPeople(users).find(p => p.name.toLowerCase() === name.toLowerCase());
      await updateDocument('leadPOs', po.id, {
        dispatchAssignedTo: name,
        dispatchAssignedToEmail: (person && person.email) || '',
        dispatchAssignedBy: meName, dispatchAssignedAt: nowIso(),
        dispatchAssignNote: assignNote.trim(),
        // A re-assignment starts the receipt afresh.
        dispatchReceivedBy: '', dispatchReceivedAt: '', dispatchReceivedNote: '',
      });
      toast(`Items assigned to ${name} — they have been notified`);
      tell([name], 'Items Assigned to You from the Warehouse',
        `${meName} assigned you the dispatched material for ${label}. Items received from the warehouse (${sentItems.length}): ${sentItems.join(', ')}.`
        + `${assignNote.trim() ? ' Note: ' + assignNote.trim() + '.' : ''} Open the PO and press "I have received these items" once they are with you.`);
      setAssignee(''); setAssignNote('');
    } catch (e) { toast(e.message, 'er'); }
    finally { setBusy(false); }
  };

  // The assigned person confirms the items are with them.
  const receive = async () => {
    if (!window.confirm(`Confirm that you have received these ${sentItems.length} item(s) for ${label}?`)) return;
    setBusy(true);
    try {
      await updateDocument('leadPOs', po.id, { dispatchReceivedBy: meName, dispatchReceivedAt: nowIso() });
      toast('Receipt recorded — the Operations Manager has been notified');
      tell([po.dispatchAssignedBy, ...dispatchNotifyUsers(users)], 'Dispatched Items Received',
        `${meName} confirmed receipt of the dispatched material for ${label} (${sentItems.length} items: ${sentItems.join(', ')}). Work / dispatch can proceed.`);
    } catch (e) { toast(e.message, 'er'); }
    finally { setBusy(false); }
  };

  const tone = po.dispatchConfirmedAt ? '#1e8449'
    : po.dispatchStatus === DISPATCH_STATUS.COMPLETED ? '#1e8449'
      : po.dispatchStatus === DISPATCH_STATUS.PARTIAL ? '#d68910' : 'var(--muted)';
  const stateText = po.dispatchConfirmedAt
    ? `Dispatch confirmed by ${po.dispatchConfirmedBy || '-'} on ${formatDate(po.dispatchConfirmedAt)}`
    : po.dispatchStatus === DISPATCH_STATUS.COMPLETED
      ? `Material Dispatch Completed — sent by ${po.dispatchCompletedBy || '-'} on ${formatDate(po.dispatchCompletedAt)} — awaiting the Operation Manager's confirmation`
      : po.dispatchStatus === DISPATCH_STATUS.PARTIAL
        ? `Partly dispatched — ${summary.dispatched} of ${summary.total} items`
        : 'Awaiting dispatch from the warehouse';

  return (
    <div style={{ marginTop: 12, border: '1px solid var(--bor)', borderRadius: 10, padding: '10px 12px', background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <span className="material-icons-round" style={{ fontSize: 18, color: tone }}>local_shipping</span>
        <strong style={{ fontSize: '.86rem' }}>Material Dispatch</strong>
        <span style={{ fontSize: '.78rem', color: tone }}>{stateText}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: '.76rem', color: 'var(--muted)' }}>{summary.dispatched} / {summary.total} dispatched</span>
      </div>

      <div className="tw">
        <table style={{ fontSize: '.8rem' }}>
          <thead><tr>
            <th style={{ width: 34 }}>#</th><th>Material</th><th>Qty</th><th style={{ width: 120 }}>Dispatched</th><th>Note / reason if not dispatched</th><th>Marked</th>
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
                        {m.dispatched ? 'Dispatched' : 'Not yet'}
                      </label>
                    ) : (
                      m.dispatched
                        ? <span style={{ color: '#1e8449', fontWeight: 600 }}><span className="material-icons-round" style={{ fontSize: 15, verticalAlign: '-3px' }}>check_circle</span> Dispatched</span>
                        : <span style={{ color: '#c0392b' }}>Not dispatched</span>
                    )}
                  </td>
                  <td>
                    {mayEdit && !m.dispatched
                      ? <input className="fi" style={{ padding: '4px 6px', fontSize: '.78rem' }} value={m.note || ''} placeholder="Why was this not dispatched?"
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

      {(mayEdit || mayConfirm) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {mayEdit && (
            <button className="btn bsm bo" disabled={busy || !dirty} onClick={() => save()} title="Save the marks made so far — partial dispatch is fine">
              <span className="material-icons-round" style={{ fontSize: 16 }}>save</span> Dispatch Items
            </button>
          )}
          {mayEdit && po.dispatchStatus !== DISPATCH_STATUS.COMPLETED && (
            <button className="btn bsm bp" disabled={busy} onClick={complete} title="Material Dispatch Completed — sends the list of dispatched items to the Operations Manager">
              <span className="material-icons-round" style={{ fontSize: 16 }}>send</span> OK &amp; Send
            </button>
          )}
          {mayConfirm && (
            <button className="btn bsm bp" disabled={busy} onClick={confirm} style={{ background: '#1e8449' }} title="Operation Manager: accept the dispatch as reviewed">
              <span className="material-icons-round" style={{ fontSize: 16 }}>verified</span> Confirm Dispatch
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
            <strong style={{ fontSize: '.84rem' }}>Items Handover</strong>
            <span style={{ fontSize: '.78rem', color: 'var(--muted)' }}>{handover.text}</span>
          </div>

          <div style={{ fontSize: '.78rem', color: 'var(--dark)', marginBottom: 6 }}>
            <strong>Items sent by the warehouse ({sentItems.length}):</strong> {sentItems.join(', ') || 'none'}
          </div>

          {po.dispatchAssignedTo && (
            <div style={{ fontSize: '.78rem', color: 'var(--muted)', marginBottom: 6 }}>
              Assigned to <strong style={{ color: 'var(--dark)' }}>{po.dispatchAssignedTo}</strong> by {po.dispatchAssignedBy || '-'} on {formatDate(po.dispatchAssignedAt)}
              {po.dispatchAssignNote ? <> · Note: {po.dispatchAssignNote}</> : null}
              {po.dispatchReceivedAt
                ? <><br /><span style={{ color: '#1e8449', fontWeight: 600 }}><span className="material-icons-round" style={{ fontSize: 14, verticalAlign: '-2px' }}>check_circle</span> Received by {po.dispatchReceivedBy || po.dispatchAssignedTo} on {formatDate(po.dispatchReceivedAt)}</span> — work / dispatch can proceed.</>
                : <><br /><span style={{ color: '#d68910' }}>Awaiting their "I have received these items".</span></>}
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

          {mayReceive && (
            <div style={{ marginTop: 8 }}>
              <button className="btn bsm bp" disabled={busy} onClick={receive} style={{ background: '#1e8449' }} title="Confirm the dispatched items are with you — the Operations Manager is notified">
                <span className="material-icons-round" style={{ fontSize: 16 }}>how_to_reg</span> I have received these items
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
