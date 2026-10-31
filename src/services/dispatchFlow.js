// ============================================================================
// The material movement on a purchase order, end to end (Req 3, 15-Oct).
//
//   PO approved → warehouse verifies each item (Yes / No + note) → "Stock OK"
//   → the Operation Manager reviews and gives the "Approval for Dispatch"
//   → assigns a person → the person checks each item received ("Handover
//   Received") → delivers at the customer's location, checks each item again
//   and photographs it ("Delivery Confirmed") → the stock comes off at the
//   final dispatch.
//
// Every stage is a stamp on the PO itself, so the whole history is one record.
// The rules for who may do what at each stage live in permissions.js (the
// dispatch marks, Stock OK, approval, assignment, receipt) and stock.js (the
// final deduction); this file adds the two item-by-item handovers, the
// "Assigned Materials" list and the timeline that shows where a PO stands.
// Mirrors the gates in routes/collections.php, which are the enforcement.
// ============================================================================

import { isSameUser, toNumber } from './helpers';
import {
  DISPATCH_STATUS, dispatchOpen, dispatchSent, dispatchMarks, canReceiveDispatch, normalizeRole, poLines,
} from './permissions';

// The dispatched lines of a PO, each with the handover mark on it.
// `marks` is the stored handoverItems / deliveryItems array (by PO line index).
export function handoverLines(po, marks) {
  const items = poLines(po);
  const sent = dispatchMarks(po);
  const stored = Array.isArray(marks) ? marks : [];
  return items.map((it, index) => ({
    index, name: it.materialName || `Item ${index + 1}`, spec: it.specification || '', quantity: toNumber(it.quantity), unit: it.unit || '',
    sent: !!(sent[index] && sent[index].dispatched),
    ok: stored[index] && typeof stored[index].ok === 'boolean' ? stored[index].ok : null,   // null = not yet answered
    note: (stored[index] && stored[index].note) || '',
  })).filter(l => l.sent);
}

// A blank set of handover marks for the sent lines, keyed by PO line index.
export function blankHandoverMarks(po) {
  const out = [];
  handoverLines(po, []).forEach(l => { out[l.index] = { ok: null, note: '' }; });
  return out;
}

// What stops the handover from being confirmed: an unanswered line, or a "No"
// without the reason.
export function handoverIssue(po, marks) {
  const lines = handoverLines(po, marks);
  if (!lines.length) return 'There are no dispatched items to confirm.';
  const unanswered = lines.filter(l => l.ok === null);
  if (unanswered.length) return `Mark Yes or No for: ${unanswered.map(l => l.name).join(', ')}.`;
  const unexplained = lines.filter(l => l.ok === false && !String(l.note || '').trim());
  if (unexplained.length) return `Say what is wrong with: ${unexplained.map(l => l.name).join(', ')}.`;
  return '';
}

// The marks as stored on the PO: one entry per PO line index, blanks for lines
// that were never sent.
export function handoverMarksForSave(po, marks) {
  const items = poLines(po);
  const stored = Array.isArray(marks) ? marks : [];
  return items.map((_, i) => (stored[i] && typeof stored[i].ok === 'boolean' ? { ok: stored[i].ok, note: String(stored[i].note || '').trim() } : null));
}

// "4 of 5 received; missing: DC Cable (short by 10 m)"
export function handoverSummary(po, marks) {
  const lines = handoverLines(po, marks);
  const yes = lines.filter(l => l.ok === true);
  const no = lines.filter(l => l.ok === false);
  return { total: lines.length, yes: yes.length, no: no.length,
    text: `${yes.length} of ${lines.length} ${lines.length === 1 ? 'item' : 'items'}` + (no.length ? `; not ${no.length === 1 ? 'confirmed' : 'confirmed'}: ${no.map(l => `${l.name}${l.note ? ' (' + l.note + ')' : ''}`).join(', ')}` : '') };
}

// ── Stage 1 handover: received from the warehouse ────────────────────────────
export const handoverDone = (po) => !!po && !!po.dispatchReceivedAt;
export const canConfirmHandover = (po, user) => canReceiveDispatch(po, user);

// ── Stage 2 handover: delivered at the customer's location ──────────────────
export const deliveryDone = (po) => !!po && !!po.deliveredAt;

// Open once the person has the items, until they confirm the delivery.
export function deliveryOpen(po) {
  if (!dispatchOpen(po) || !dispatchSent(po)) return false;
  if (!po.dispatchAssignedTo || !handoverDone(po)) return false;
  return !deliveryDone(po);
}
// The assigned person delivers; an Admin may record it on their behalf.
export function canConfirmDelivery(po, user, role) {
  if (!deliveryOpen(po)) return false;
  if (role === 'super_admin' || ['admin', 'management'].includes(normalizeRole(role))) return true;
  return isSameUser(po.dispatchAssignedTo, user) || isSameUser(po.dispatchAssignedToEmail, user);
}

// What stops the delivery from being confirmed: the item checks, and the proof.
export function deliveryIssue(po, marks, photos) {
  const issue = handoverIssue(po, marks);
  if (issue) return issue;
  const proof = (photos || []).filter(p => p && p.url);
  if (!proof.length) return 'Upload at least one photograph of the delivered material as proof.';
  return '';
}

// ── Where a PO stands, for lists and badges ─────────────────────────────────
export const DISPATCH_STAGES = [
  { key: 'approved', label: 'PO approved' },
  { key: 'verifying', label: 'Warehouse verifying stock' },
  { key: 'stock_ok', label: 'Stock OK — awaiting the Operation Manager' },
  { key: 'approved_dispatch', label: 'Approved for dispatch — awaiting assignment' },
  { key: 'assigned', label: 'Assigned — awaiting handover' },
  { key: 'received', label: 'Received by the assigned person — out for delivery' },
  { key: 'delivered', label: 'Delivered at the customer location' },
  { key: 'closed', label: 'Delivered and stock deducted' },
  { key: 'returned', label: 'Return items recorded' },
];

export function dispatchStage(po) {
  if (!po || po.status !== 'Approved') return null;
  if (deliveryDone(po)) return (po.stockDispatchedAt || (po.stockDispatches || []).length) ? 'closed' : 'delivered';
  if (handoverDone(po)) return 'received';
  if (po.dispatchAssignedTo) return 'assigned';
  if (po.dispatchConfirmedAt) return 'approved_dispatch';
  if (po.dispatchStatus === DISPATCH_STATUS.COMPLETED) return 'stock_ok';
  if (po.dispatchStatus === DISPATCH_STATUS.PARTIAL) return 'verifying';
  return 'approved';
}
export const dispatchStageLabel = (po) => {
  const k = dispatchStage(po);
  const s = DISPATCH_STAGES.find(x => x.key === k);
  return s ? s.label : '';
};

// The purchase orders on somebody's "Assigned Materials" screen: the ones
// assigned to them. The Operation Manager, the warehouse and the authorities
// see every assignment, since they follow all of them.
export const ASSIGNED_MATERIALS_OVERSEERS = ['super_admin', 'management', 'admin', 'operation_manager', 'warehouse_admin', 'technical_manager'];
export function assignedMaterialsFor(leadPOs, user, role) {
  const all = (leadPOs || []).filter(po => po && po.status === 'Approved' && dispatchSent(po) && po.dispatchAssignedTo);
  if (role === 'super_admin' || ASSIGNED_MATERIALS_OVERSEERS.includes(normalizeRole(role))) return all;
  return all.filter(po => isSameUser(po.dispatchAssignedTo, user) || isSameUser(po.dispatchAssignedToEmail, user));
}
// The ones still needing this person to act — for the sidebar count.
export const assignedMaterialsOpenFor = (leadPOs, user) =>
  assignedMaterialsFor(leadPOs, user, '').filter(po => !deliveryDone(po));

// ── The movement history, one line per stage ────────────────────────────────
// Everything on a PO that says who did what and when, in order, for the
// Operation Manager and the warehouse to follow the material from approval
// to delivery.
// `returns` are this PO's return transactions from the ledger (Req 5): the
// ninth stage is done once the Owner has approved one.
export function dispatchTimeline(po, returns) {
  if (!po) return [];
  const marks = dispatchMarks(po);
  const items = poLines(po);
  const dispatches = Array.isArray(po.stockDispatches) && po.stockDispatches.length ? po.stockDispatches
    : (po.stockDispatchedAt ? [{ ref: po.stockDispatchRef, at: po.stockDispatchedAt, by: po.stockDispatchedBy, items: po.stockDispatchItems || [] }] : []);
  const rets = (returns || []).filter(t => t && t.type === 'return');
  const approvedReturns = rets.filter(t => t.appliedAt);
  const pendingReturns = rets.filter(t => ['Pending Review', 'Forwarded to Owner'].includes(t.status));
  const sentNames = marks.map((m, i) => (m.dispatched ? (items[i] && items[i].materialName) || `Item ${i + 1}` : '')).filter(Boolean);
  const heldNames = marks.map((m, i) => (!m.dispatched && m.note ? `${(items[i] && items[i].materialName) || `Item ${i + 1}`} (${m.note})` : '')).filter(Boolean);
  const hand = handoverLines(po, po.handoverItems);
  const deliv = handoverLines(po, po.deliveryItems);
  const steps = [
    { key: 'approved', label: 'PO approved', by: po.approvedBy, at: po.approvalDate, done: po.status === 'Approved' },
    { key: 'verified', label: 'Warehouse material verification', by: po.dispatchUpdatedBy, at: po.dispatchUpdatedAt, done: marks.some(m => m.at),
      detail: marks.some(m => m.at) ? `${sentNames.length} of ${items.length} marked available${heldNames.length ? '; not available: ' + heldNames.join(', ') : ''}` : '' },
    { key: 'stock_ok', label: 'Stock OK submitted', by: po.dispatchCompletedBy, at: po.dispatchCompletedAt, done: !!po.dispatchCompletedAt },
    { key: 'review', label: 'Approval for Dispatch', by: po.dispatchConfirmedBy, at: po.dispatchConfirmedAt, done: !!po.dispatchConfirmedAt },
    { key: 'assigned', label: 'Assigned for dispatch', by: po.dispatchAssignedBy, at: po.dispatchAssignedAt, done: !!po.dispatchAssignedTo,
      detail: po.dispatchAssignedTo ? `to ${po.dispatchAssignedTo}${po.dispatchAssignNote ? ' — ' + po.dispatchAssignNote : ''}` : '' },
    { key: 'received', label: 'Handover received from the warehouse', by: po.dispatchReceivedBy, at: po.dispatchReceivedAt, done: !!po.dispatchReceivedAt,
      detail: po.dispatchReceivedAt && hand.length ? handoverSummary(po, po.handoverItems).text : '' },
    { key: 'delivered', label: 'Delivered at the customer location', by: po.deliveredBy, at: po.deliveredAt, done: !!po.deliveredAt,
      detail: po.deliveredAt ? `${deliv.length ? handoverSummary(po, po.deliveryItems).text : ''}${(po.deliveryPhotos || []).length ? `; ${(po.deliveryPhotos || []).length} photo${(po.deliveryPhotos || []).length === 1 ? '' : 's'}` : ''}${po.deliveryLocation ? `; at ${po.deliveryLocation}` : ''}` : '' },
    { key: 'stock', label: 'Stock deducted (final dispatch)', by: dispatches.length ? dispatches[dispatches.length - 1].by : po.stockDispatchedBy, at: dispatches.length ? dispatches[dispatches.length - 1].at : po.stockDispatchedAt, done: dispatches.length > 0,
      detail: dispatches.length ? `${dispatches.length} confirmation${dispatches.length === 1 ? '' : 's'}${po.stockDispatchComplete ? ', complete' : ' so far'} — ${dispatches.map(d => d.ref).filter(Boolean).join(', ')}` : '' },
    { key: 'returned', label: 'Return items', by: approvedReturns.length ? approvedReturns[0].approvedBy : (pendingReturns.length ? pendingReturns[0].submittedBy : ''),
      at: approvedReturns.length ? approvedReturns[0].approvedAt : (pendingReturns.length ? pendingReturns[0].submittedAt : ''), done: approvedReturns.length > 0,
      detail: approvedReturns.length ? `${approvedReturns.length} approved: ${approvedReturns.map(t => `${t.materialName} +${t.quantity}${t.unit ? ' ' + t.unit : ''}`).join(', ')}${pendingReturns.length ? `; ${pendingReturns.length} awaiting the Owner` : ''}`
        : (pendingReturns.length ? `${pendingReturns.length} recorded, awaiting the Owner's approval` : '') },
  ];
  return steps;
}
