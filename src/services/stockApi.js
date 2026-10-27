// ============================================================================
// The calls behind the stock ledger (see stock.js for the rules, and
// server/api/routes/stock.php for the enforcement). Each writes on the
// server inside one locked transaction, so a figure can never be applied
// twice; here we only post and ask the screens to refresh.
// ============================================================================

import { apiPost } from './api';
import { logActivity } from './firestore';

// After a write, the material list, the ledger and (for a dispatch) the PO
// all change on the server, so everything is refetched. The DataContext
// listens for this and refetches in one batched request.
function refresh() {
  try { window.dispatchEvent(new CustomEvent('pps:refresh', { detail: { col: 'stockTransactions' } })); } catch { /* ignore */ }
}

// A reference the server uses to recognise the same form sent twice.
export const newClientRef = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export async function submitStockReceipt(body) {
  const res = await apiPost('/stock/receipt', body);
  refresh();
  logActivity('Stock Receipt Submitted', 'materials', `${res && res.materialName} × ${res && res.quantity} (${res && res.reference})`);
  return res;
}

export async function submitStockAdjustment(body) {
  const res = await apiPost('/stock/adjustment', body);
  refresh();
  logActivity(body && body.direct ? 'Stock Corrected' : 'Stock Discrepancy Reported', 'materials', `${res && res.materialName} ${res && res.quantity} (${res && res.reference})`);
  return res;
}

export async function reviewStockEntry(id, action, note = '') {
  const res = await apiPost('/stock/review', { id, action, note });
  refresh();
  logActivity(action === 'forward' ? 'Stock Entry Forwarded' : 'Stock Entry Rejected', 'materials', res && res.reference);
  return res;
}

export async function approveStockEntry(id, action, note = '') {
  const res = await apiPost('/stock/approve', { id, action, note });
  refresh();
  logActivity(action === 'approve' ? 'Stock Entry Approved' : 'Stock Entry Rejected by Owner', 'materials', res && res.reference);
  return res;
}

export async function confirmFinalDispatch(body) {
  const res = await apiPost('/stock/dispatch', body);
  refresh();
  logActivity('Dispatch Confirmed', 'leadPOs', res && res.reference);
  return res;
}

// Save the dispatch as it stands, before confirming (Req 4C). Deducts nothing.
export async function saveDispatchDraft(body) {
  const res = await apiPost('/stock/dispatch-draft', body);
  refresh();
  return res;
}

// Material that physically came back (Req 5): recorded for the Owner's approval.
export async function submitStockReturn(body) {
  const res = await apiPost('/stock/return', body);
  refresh();
  logActivity('Stock Return Recorded', 'materials', `${res && res.materialName} × ${res && res.quantity} (${res && res.reference})`);
  return res;
}
