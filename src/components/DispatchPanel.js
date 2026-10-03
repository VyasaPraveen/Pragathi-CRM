import React, { useState, useEffect } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { updateDocument, createNotification } from '../services/firestore';
import { formatDate } from '../services/helpers';
import {
  DISPATCH_STATUS, dispatchOpen, canUpdateDispatch, canConfirmDispatch,
  dispatchMarks, dispatchSummary, dispatchCompleteIssue, dispatchNotifyUsers, warehouseUsers,
} from '../services/permissions';

const nowIso = () => new Date().toISOString();

// ============================================================================
// Material dispatch on an approved purchase order.
//
// Shown under the PO wherever the PO is shown — the lead's Purchase Orders
// tab and the Purchase Orders page the warehouse works from. The warehouse
// marks each item sent or held back (with a reason), saves as it goes, and
// declares the dispatch complete; the authorities are told, and the Operation
// Manager confirms it. Everyone else sees the same list read-only. The PO's
// own status is never touched here.
// ============================================================================
export default function DispatchPanel({ po, lead }) {
  const { users } = useData();
  const { role, user } = useAuth();
  const { toast } = useToast();
  const meName = user?.displayName || user?.email || '';

  const [marks, setMarks] = useState(() => dispatchMarks(po));
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  // A fresh copy from the server replaces local edits only when nothing is
  // half-done here.
  useEffect(() => { if (!dirty) setMarks(dispatchMarks(po)); }, [po, dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!dispatchOpen(po)) return null;

  const items = po.items || [];
  const mayEdit = canUpdateDispatch(po, role);
  const mayConfirm = canConfirmDispatch(po, role);
  const summary = dispatchSummary({ ...po, dispatchItems: marks });
  const leadName = (lead && lead.name) || po.customerName || po.leadName || '';
  const label = `PO ${po.poNumber || ''}${leadName ? ` for "${leadName}"` : ''}`;

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
      await updateDocument('leadPOs', po.id, {
        dispatchItems: next,
        dispatchStatus: extra.dispatchStatus || (next.some(m => m.dispatched) ? DISPATCH_STATUS.PARTIAL : DISPATCH_STATUS.NONE),
        dispatchUpdatedAt: nowIso(), dispatchUpdatedBy: meName,
        ...extra,
      });
      setDirty(false);
      toast(okMsg);
      return next;
    } catch (e) { toast(e.message, 'er'); return null; }
    finally { setBusy(false); }
  };

  const complete = async () => {
    const issue = dispatchCompleteIssue(po, marks);
    if (issue) { toast(issue, 'er'); return; }
    const s = dispatchSummary({ ...po, dispatchItems: marks });
    const pendingText = s.pending.length
      ? ` Not dispatched: ${s.pending.map(p => `${p.name} (${p.note})`).join('; ')}.`
      : '';
    if (!window.confirm(`Confirm "Material Dispatch Completed" for ${label}?\n${s.dispatched} of ${s.total} items dispatched.${pendingText}`)) return;
    const saved = await save(
      { dispatchStatus: DISPATCH_STATUS.COMPLETED, dispatchCompletedAt: nowIso(), dispatchCompletedBy: meName },
      'Material dispatch marked complete');
    if (!saved) return;
    // The Owner, Management, the Operation Manager and Admin are told, with
    // what went and what did not.
    const seen = new Set();
    dispatchNotifyUsers(users).forEach(u => {
      const key = u.displayName || u.email;
      if (!key || seen.has(key)) return;
      seen.add(key);
      createNotification({
        forUser: key,
        title: 'Material Dispatch Completed',
        message: `${meName} completed the material dispatch for ${label}: ${s.dispatched} of ${s.total} items dispatched.${pendingText} Open the PO to see the item-by-item dispatch.`,
        type: 'status_update', module: 'leadPOs', relatedId: po.id,
      });
    });
  };

  const confirm = async () => {
    if (!window.confirm(`Confirm the dispatch for ${label} as reviewed and accepted?`)) return;
    setBusy(true);
    try {
      await updateDocument('leadPOs', po.id, { dispatchConfirmedAt: nowIso(), dispatchConfirmedBy: meName });
      toast('Dispatch confirmed');
      const seen = new Set();
      [...warehouseUsers(users), ...dispatchNotifyUsers(users)].forEach(u => {
        const key = u.displayName || u.email;
        if (!key || seen.has(key) || key === meName) return;
        seen.add(key);
        createNotification({
          forUser: key, title: 'Dispatch Confirmed',
          message: `${meName} reviewed and confirmed the material dispatch for ${label}.`,
          type: 'status_update', module: 'leadPOs', relatedId: po.id,
        });
      });
    } catch (e) { toast(e.message, 'er'); }
    finally { setBusy(false); }
  };

  const tone = po.dispatchConfirmedAt ? '#1e8449'
    : po.dispatchStatus === DISPATCH_STATUS.COMPLETED ? '#1e8449'
      : po.dispatchStatus === DISPATCH_STATUS.PARTIAL ? '#d68910' : 'var(--muted)';
  const stateText = po.dispatchConfirmedAt
    ? `Dispatch confirmed by ${po.dispatchConfirmedBy || '-'} on ${formatDate(po.dispatchConfirmedAt)}`
    : po.dispatchStatus === DISPATCH_STATUS.COMPLETED
      ? `Material Dispatch Completed by ${po.dispatchCompletedBy || '-'} on ${formatDate(po.dispatchCompletedAt)} — awaiting the Operation Manager's confirmation`
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
            <button className="btn bsm bp" disabled={busy} onClick={complete} title="Declare the dispatch complete and tell the authorities">
              <span className="material-icons-round" style={{ fontSize: 16 }}>task_alt</span> Material Dispatch Completed
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
    </div>
  );
}
