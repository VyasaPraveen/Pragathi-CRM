// ============================================================================
// The stock ledger — Materials & Inventory (10-Oct).
//
// A material's figures (stock, dispatched, balance) are no longer typed into
// a form. They move only through transactions the server records in
// `stockTransactions` (routes/stock.php), each applied exactly once:
//
//   receipt     the warehouse enters what arrived (against a PO line where
//               there is one) → the Operation Manager reviews and forwards it
//               → the Owner approves → stock and balance go up
//   adjustment  a physical count that differs from the book figure, with its
//               reason → the same review → the Owner approves → the balance
//               moves by the difference (the Owner's own correction applies
//               at once)
//   dispatch    the final dispatch confirmation on a PO whose items were
//               sent, assigned and received → balance down, once per PO
//   opening     the figure the Owner created a material with
//
// Everything here is pure: who may do what (mirroring the server, which is
// the enforcement), how the figures are summed for the screens, and how a PO
// line finds its inventory material. The calls themselves are in stockApi.js.
// ============================================================================

import { normalizeRole, DISPATCH_STATUS } from './permissions';
import { isSameUser, toNumber } from './helpers';

export const STOCK_TYPES = { RECEIPT: 'receipt', ADJUSTMENT: 'adjustment', DISPATCH: 'dispatch', OPENING: 'opening' };
export const STOCK_STATUS = {
  PENDING: 'Pending Review',        // with the Operation Manager
  FORWARDED: 'Forwarded to Owner',  // with the Owner
  APPROVED: 'Approved',             // applied by the Owner's approval
  REJECTED: 'Rejected',
  APPLIED: 'Applied',               // a dispatch, an opening figure, the Owner's own correction
};
// An entry still on its way through the approvals — its quantity is NOT in the
// available balance and is shown separately.
export const STOCK_OPEN_STATUSES = [STOCK_STATUS.PENDING, STOCK_STATUS.FORWARDED];
export const isStockOpen = (t) => !!t && STOCK_OPEN_STATUSES.includes(t.status);
export const isStockApplied = (t) => !!t && !!t.appliedAt;

// Who enters receipts and reports discrepancies: the warehouse side (which
// the client's "Warehouse / BCO" includes, with the Technical Manager) and
// the office roles that stand in for it. Mirrors STOCK_ENTRY_ROLES in stock.php.
export const STOCK_ENTRY_ROLES = ['warehouse_admin', 'technical_manager', 'bco', 'operation_manager', 'admin', 'management', 'super_admin'];
// Who reviews an entry and forwards it to the Owner. Mirrors STOCK_REVIEW_ROLES.
export const STOCK_REVIEW_ROLES = ['operation_manager', 'admin', 'management', 'super_admin'];
// The Materials page has always called a balance under 10 "Low Stock" and
// under 30 "Medium". Unchanged. Mirrors STOCK_LOW in stock.php.
export const STOCK_LOW = 10;
export const STOCK_MEDIUM = 30;
// The figures the server refuses to take from a form. Mirrors MATERIAL_FIGURE_FIELDS.
export const MATERIAL_FIGURE_FIELDS = ['stock', 'dispatched', 'balance'];

const roleIn = (role, list) => role === 'super_admin' || list.includes(normalizeRole(role));
export const isStockOwner = (role) => role === 'super_admin';
export const canEnterStock = (role) => roleIn(role, STOCK_ENTRY_ROLES);
export const canReviewStock = (role) => roleIn(role, STOCK_REVIEW_ROLES);
export const canApproveStock = (role) => isStockOwner(role);
// A quick "no approvals needed" correction: the Owner's alone.
export const canCorrectStockDirectly = (role) => isStockOwner(role);

// Good / Medium / Low Stock from the available balance — the rule the page
// has always used, now in one place for the page, the dashboard and the
// detail view to share.
export function stockStatusOf(balance) {
  const b = toNumber(balance);
  if (b < STOCK_LOW) return 'Low Stock';
  if (b < STOCK_MEDIUM) return 'Medium';
  return 'Good';
}

export const qtyText = (q, unit) => {
  const n = Math.round(toNumber(q) * 1000) / 1000;
  return `${n}${unit ? ' ' + unit : ''}`;
};
export const signedQty = (q, unit) => `${toNumber(q) > 0 ? '+' : ''}${qtyText(q, unit)}`;

// The ledger lines for one material, newest first.
export function materialTransactions(txns, materialId) {
  return (txns || [])
    .filter(t => t && t.materialId === materialId)
    .sort((a, b) => String(b.submittedAt || b.createdAt || '').localeCompare(String(a.submittedAt || a.createdAt || '')));
}

// What the detail view shows above the history. The balance is the one on
// the material record (the server keeps it); the rest are summed from the
// applied lines, with pending quantities kept apart from it.
export function materialSummary(material, txns) {
  const m = material || {};
  const lines = materialTransactions(txns, m.id);
  const sum = (pred) => lines.filter(pred).reduce((s, t) => s + toNumber(t.quantity), 0);
  const opening = sum(t => t.type === STOCK_TYPES.OPENING && isStockApplied(t));
  const received = sum(t => t.type === STOCK_TYPES.RECEIPT && isStockApplied(t));
  const dispatched = sum(t => t.type === STOCK_TYPES.DISPATCH && isStockApplied(t));
  const adjusted = sum(t => t.type === STOCK_TYPES.ADJUSTMENT && isStockApplied(t));
  const pendingReceipts = lines.filter(t => t.type === STOCK_TYPES.RECEIPT && isStockOpen(t));
  const pendingAdjustments = lines.filter(t => t.type === STOCK_TYPES.ADJUSTMENT && isStockOpen(t));
  return {
    opening, received, dispatched, adjusted,
    installed: toNumber(m.installed),
    stock: toNumber(m.stock),
    balance: toNumber(m.balance),
    status: stockStatusOf(m.balance),
    pendingReceiptQty: pendingReceipts.reduce((s, t) => s + toNumber(t.quantity), 0),
    pendingReceiptCount: pendingReceipts.length,
    pendingAdjustmentCount: pendingAdjustments.length,
    approvedAdjustmentCount: lines.filter(t => t.type === STOCK_TYPES.ADJUSTMENT && isStockApplied(t)).length,
    lines,
  };
}

// The entries waiting on somebody, oldest first — the approvals list.
export function pendingStockEntries(txns) {
  return (txns || []).filter(isStockOpen)
    .sort((a, b) => String(a.submittedAt || '').localeCompare(String(b.submittedAt || '')));
}

// What this person can do with an open entry: the Operation Manager forwards
// or rejects what is pending; the Owner approves or rejects anything still
// open (the Owner may take a pending entry straight away). Nobody acts on
// their own submission except the Owner.
export function stockEntryActions(t, user, role) {
  if (!t || !isStockOpen(t)) return { forward: false, reject: false, approve: false };
  const mine = isSameUser(t.submittedByEmail, user) || isSameUser(t.submittedBy, user);
  if (canApproveStock(role)) return { forward: false, reject: true, approve: true };
  if (canReviewStock(role) && t.status === STOCK_STATUS.PENDING && !mine) return { forward: true, reject: true, approve: false };
  return { forward: false, reject: false, approve: false };
}

// One line that says where an entry stands.
export function stockEntryState(t) {
  if (!t) return '';
  switch (t.status) {
    case STOCK_STATUS.PENDING: return `Awaiting the Operation Manager's review`;
    case STOCK_STATUS.FORWARDED: return `Forwarded to the Owner by ${t.reviewedBy || '-'} — awaiting approval`;
    case STOCK_STATUS.APPROVED: return `Approved by ${t.approvedBy || '-'} — stock updated`;
    case STOCK_STATUS.REJECTED: return `Rejected by ${t.rejectedBy || '-'}${t.rejectReason ? ': ' + t.rejectReason : ''}`;
    case STOCK_STATUS.APPLIED: return t.type === STOCK_TYPES.DISPATCH ? `Dispatched — confirmed by ${t.confirmedBy || '-'}`
      : t.type === STOCK_TYPES.OPENING ? 'Opening stock' : `Corrected by ${t.appliedBy || '-'}`;
    default: return t.status || '';
  }
}

export const stockTypeLabel = (type) => ({
  receipt: 'Receipt', adjustment: 'Stock Correction', dispatch: 'Dispatch', opening: 'Opening Stock',
}[type] || type || '');

// The day an entry belongs to, for the Day / Month filter.
export const STOCK_DATE_FIELDS = ['receiptDate', 'dispatchDate', 'submittedAt', 'createdAt'];

// ── Purchase orders and receipts ────────────────────────────────────────────
// Both kinds of PO can bring material in: the vendor POs on the Purchase
// Orders page ("standalone") and the lead BOM POs. Offered together, labelled.
export function receivablePOs(purchaseOrders, leadPOs, leads) {
  const out = [];
  (purchaseOrders || []).forEach(po => {
    if (!po || !(po.items || []).length || po.status === 'Cancelled') return;
    out.push({ id: po.id, source: 'standalone', poNumber: po.poNumber || '', party: po.vendorName || '', items: po.items || [],
      label: `${po.poNumber || po.id}${po.vendorName ? ' — ' + po.vendorName : ''} (vendor PO)` });
  });
  (leadPOs || []).forEach(po => {
    if (!po || !(po.items || []).length || po.status !== 'Approved') return;
    const lead = (leads || []).find(l => l.id === po.leadId);
    const name = (lead && lead.name) || po.customerName || '';
    out.push({ id: po.id, source: 'lead', poNumber: po.poNumber || '', party: name, items: po.items || [],
      label: `${po.poNumber || po.id}${name ? ' — ' + name : ''} (lead PO)` });
  });
  return out;
}

// Received so far against each line of a PO: approved, still pending, and
// what remains. Rejected receipts do not count. Mirrors stock_received_against().
export function poReceiptProgress(po, txns) {
  const items = (po && po.items) || [];
  return items.map((it, index) => {
    const mine = (txns || []).filter(t => t && t.type === STOCK_TYPES.RECEIPT && t.poId === po.id && Number(t.poItemIndex) === index);
    const approved = mine.filter(t => t.status === STOCK_STATUS.APPROVED).reduce((s, t) => s + toNumber(t.quantity), 0);
    const pending = mine.filter(isStockOpen).reduce((s, t) => s + toNumber(t.quantity), 0);
    const ordered = toNumber(it.quantity);
    return { index, name: it.materialName || `Item ${index + 1}`, unit: it.unit || '', ordered, approved, pending,
      remaining: Math.max(0, Math.round((ordered - approved - pending) * 1000) / 1000), count: mine.length };
  });
}

// ── Matching a PO line to an inventory material ─────────────────────────────
const squash = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// The material a PO line most likely is: the same name (ignoring case and
// punctuation), else the longest material name contained in the line or
// containing it ("AC Cable 6sqmm" → "AC Cable"). Null when nothing fits —
// the person then picks it, or marks the line as not kept in inventory.
export function matchMaterial(materials, name) {
  const q = squash(name);
  if (!q) return null;
  const list = (materials || []).filter(m => m && m.name);
  const exact = list.find(m => squash(m.name) === q);
  if (exact) return exact;
  const partial = list
    .filter(m => { const s = squash(m.name); return s.length >= 3 && (q.includes(s) || s.includes(q)); })
    .sort((a, b) => squash(b.name).length - squash(a.name).length);
  return partial[0] || null;
}

// ── The final dispatch on a lead PO ─────────────────────────────────────────
export const stockDispatched = (po) => !!po && !!po.stockDispatchedAt;

// The final dispatch is open once the items have been sent, assigned and
// received, until the stock has come off. Mirrors stock_final_dispatch().
export function finalDispatchOpen(po) {
  if (!po || po.status !== 'Approved') return false;
  if (po.dispatchStatus !== DISPATCH_STATUS.COMPLETED) return false;
  if (!po.dispatchAssignedTo || !po.dispatchReceivedAt) return false;
  return !stockDispatched(po);
}

// The assigned person confirms it, or the Operation Manager / an Admin.
export function canFinalDispatch(po, user, role) {
  if (!finalDispatchOpen(po)) return false;
  if (canReviewStock(role)) return true;
  return isSameUser(po.dispatchAssignedToEmail, user) || isSameUser(po.dispatchAssignedTo, user);
}

// The dispatched lines of a PO with the inventory material each most likely
// is, ready for the person to confirm or change. `materialId: ''` means
// "not kept in inventory" and the line is left out of the deduction.
export function finalDispatchLines(po, materials) {
  const items = (po && po.items) || [];
  const marks = (po && Array.isArray(po.dispatchItems)) ? po.dispatchItems : [];
  return items.map((it, index) => {
    const sent = !!(marks[index] && marks[index].dispatched);
    const match = sent ? matchMaterial(materials, it.materialName) : null;
    return { index, name: it.materialName || `Item ${index + 1}`, spec: it.specification || '', quantity: toNumber(it.quantity), unit: it.unit || '',
      sent, materialId: match ? match.id : '', suggested: !!match };
  }).filter(l => l.sent);
}

// What stops the deduction: nothing mapped, a line with no quantity, the
// same material short of stock across the lines that use it.
export function finalDispatchIssue(lines, materials) {
  const chosen = (lines || []).filter(l => l.materialId);
  if (!chosen.length) return 'Choose the inventory material for at least one dispatched item.';
  const need = {};
  for (const l of chosen) {
    if (toNumber(l.quantity) <= 0) return `"${l.name}" has no quantity to dispatch.`;
    need[l.materialId] = (need[l.materialId] || 0) + toNumber(l.quantity);
  }
  const short = Object.entries(need).map(([id, q]) => {
    const m = (materials || []).find(x => x.id === id);
    if (!m) return `a chosen material no longer exists`;
    return q > toNumber(m.balance) + 1e-9 ? `${m.name}: needs ${qtyText(q, m.unit)}, available ${qtyText(m.balance, m.unit)}` : '';
  }).filter(Boolean);
  return short.length ? `Not enough stock — ${short.join('; ')}.` : '';
}

// The request body for /stock/dispatch.
export const finalDispatchBody = (po, lines, extra = {}) => ({
  poId: po.id,
  items: (lines || []).filter(l => l.materialId).map(l => ({ index: l.index, materialId: l.materialId, quantity: toNumber(l.quantity) })),
  ...extra,
});

// Where the final dispatch stands, in one line.
export function finalDispatchState(po) {
  if (!po) return { step: 'none', text: '' };
  if (stockDispatched(po)) return { step: 'done', text: `Stock deducted by ${po.stockDispatchedBy || '-'} (ref ${po.stockDispatchRef || '-'})` };
  if (finalDispatchOpen(po)) return { step: 'open', text: `Items received by ${po.dispatchReceivedBy || po.dispatchAssignedTo} — awaiting the final dispatch confirmation` };
  return { step: 'waiting', text: '' };
}
