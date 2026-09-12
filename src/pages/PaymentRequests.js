import React, { useState, useMemo } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { addDocument, updateDocument, deleteDocument, notifyAdmins, createNotification } from '../services/firestore';
import { formatCurrency, formatDate, safeStr, toNumber, hasAccess } from '../services/helpers';
import { StatusBadge, Modal, EmptyState, DateInput } from '../components/SharedUI';
import { can, ACTIONS, PR_STATUS, PR_STAGES, nextPrStage } from '../services/permissions';

// Payment Request — the step-by-step approval & payment workflow:
// Team Member → Generate Payment Request → Team Leader (Recommend) → Admin /
// Management / Operation Manager (Main Approval) → Accountant (Payment
// Transfer) → Accountant (one-shot Work Proposal / Pre-PO) → Admin /
// Management / Operation Manager (final sign-off). A request moves to the next
// stage only after the required action on the current stage is completed.
const PAYMENT_MODES = ['Bank Transfer', 'UPI', 'Cash', 'Cheque', 'Card', 'Other'];
const PAGE_SIZE = 20;

// Who may reject at the stage the request is currently sitting on.
const canRejectAtStage = (role, status) => {
  const stage = nextPrStage(status);
  return !!stage && can(role, stage.action);
};

export default function PaymentRequests() {
  const { paymentRequests, users } = useData();
  const { role, user } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [modal, setModal] = useState(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const canRequest = can(role, ACTIONS.PR_CREATE);
  const me = user?.displayName || user?.email || 'unknown';

  // Hand the request to whoever must act on the given stage — this is how it
  // "moves to" the next person in the chain.
  const notifyActors = (action, label, pr) => {
    const seen = new Set();
    (users || []).forEach(u => {
      if (u.role === 'super_admin') return; // owner already gets admin-level notices
      if (!can(u.role, action)) return;
      const key = u.displayName || u.email;
      if (!key || seen.has(key)) return;
      seen.add(key);
      createNotification({
        forUser: key,
        title: `Payment Request needs your ${label}`,
        message: `"${pr.purpose || ''}" (${formatCurrency(pr.amount)}) raised by ${pr.requestedByName || pr.requestedBy || 'a team member'} is awaiting your ${label.toLowerCase()}`,
        type: 'status_update', module: 'paymentRequests', relatedId: pr.id,
      });
    });
  };

  const statuses = ['all', PR_STATUS.REQUESTED, PR_STATUS.RECOMMENDED, PR_STATUS.APPROVED, PR_STATUS.PAID, PR_STATUS.PROPOSAL_SUBMITTED, PR_STATUS.CLOSED, PR_STATUS.REJECTED];

  let filtered = filter === 'all' ? paymentRequests : paymentRequests.filter(x => x.status === filter);
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(x =>
      safeStr(x.purpose).toLowerCase().includes(q) ||
      safeStr(x.payTo).toLowerCase().includes(q) ||
      safeStr(x.requestedByName).toLowerCase().includes(q) ||
      safeStr(x.requestedBy).toLowerCase().includes(q)
    );
  }

  const summary = useMemo(() => {
    const s = { total: 0, pending: 0, approved: 0, paid: 0 };
    (paymentRequests || []).forEach(x => {
      const amt = toNumber(x.amount);
      s.total += amt;
      if (x.status === PR_STATUS.REJECTED) return;
      if ([PR_STATUS.PAID, PR_STATUS.PROPOSAL_SUBMITTED, PR_STATUS.CLOSED].includes(x.status)) s.paid += amt;
      else if (x.status === PR_STATUS.APPROVED) s.approved += amt;
      else s.pending += amt;
    });
    return s;
  }, [paymentRequests]);

  const displayed = filtered.slice(0, visibleCount);
  const hasMore = filtered.length > visibleCount;

  const handleSave = async (data, id) => {
    try {
      const cleaned = { ...data, amount: toNumber(data.amount) };
      if (id) {
        await updateDocument('paymentRequests', id, cleaned);
        toast('Payment request updated');
      } else {
        cleaned.status = PR_STATUS.REQUESTED;
        cleaned.requestedBy = user?.email || 'unknown';
        cleaned.requestedByName = me;
        cleaned.requestedDate = new Date().toISOString().slice(0, 10);
        const newId = await addDocument('paymentRequests', cleaned);
        notifyAdmins(users, { title: 'New Payment Request', message: `${cleaned.purpose} — ${formatCurrency(cleaned.amount)} (by ${me})`, type: 'info', module: 'paymentRequests', relatedId: newId });
        // Step 1 of the flow: it goes to the Team Leader for recommendation.
        notifyActors(ACTIONS.PR_RECOMMEND, 'Recommendation', { ...cleaned, id: newId });
        toast('Payment request generated');
      }
      setModal(null);
    } catch (e) { toast(e.message, 'er'); }
  };

  const advanceStage = async (pr) => {
    const stage = nextPrStage(pr.status);
    if (!stage) return;
    if (!can(role, stage.action)) { toast(`You are not authorised to ${stage.label.toLowerCase()}`, 'er'); return; }
    const extra = {};

    if (stage.to === PR_STATUS.PAID) {
      const ref = window.prompt('Payment transfer reference / transaction no.:', '');
      if (ref === null) return;                    // cancelled
      if (!ref.trim()) { toast('A payment reference is required', 'er'); return; }
      extra.paymentRef = ref.trim();
    } else if (stage.to === PR_STATUS.PROPOSAL_SUBMITTED) {
      const ref = window.prompt('Work Proposal / Pre-PO reference (one-shot, after payment):', '');
      if (ref === null) return;
      if (!ref.trim()) { toast('A Work Proposal / Pre-PO reference is required', 'er'); return; }
      extra.proposalRef = ref.trim();
    } else if (!window.confirm(`${stage.label} this payment request?`)) {
      return;
    }

    try {
      await updateDocument('paymentRequests', pr.id, {
        status: stage.to,
        [stage.field]: me,
        [stage.field + 'Date']: new Date().toISOString().slice(0, 10),
        ...extra,
      });
      // Keep the requester informed as their request moves along the chain.
      if (pr.requestedBy && pr.requestedBy !== user?.email) {
        createNotification({
          forUser: pr.requestedByName || pr.requestedBy,
          title: `Payment Request ${stage.to}`,
          message: `Your payment request "${pr.purpose || ''}" (${formatCurrency(pr.amount)}) is now ${stage.to}${extra.paymentRef ? ' · Ref: ' + extra.paymentRef : ''}`,
          type: 'status_update', module: 'paymentRequests', relatedId: pr.id,
        });
      }
      const next = nextPrStage(stage.to);
      if (next) notifyActors(next.action, next.label, pr);
      else notifyAdmins(users, { title: 'Payment Request Closed', message: `"${pr.purpose || ''}" — ${formatCurrency(pr.amount)} is fully closed`, type: 'status_update', module: 'paymentRequests', relatedId: pr.id });
      toast(`Payment request ${stage.to.toLowerCase()}`);
    } catch (e) { toast(e.message, 'er'); }
  };

  const rejectRequest = async (pr) => {
    if (!window.confirm('Reject this payment request? This stops the approval chain.')) return;
    try {
      await updateDocument('paymentRequests', pr.id, {
        status: PR_STATUS.REJECTED,
        rejectedBy: me,
        rejectedDate: new Date().toISOString().slice(0, 10),
      });
      if (pr.requestedBy && pr.requestedBy !== user?.email) {
        createNotification({ forUser: pr.requestedByName || pr.requestedBy, title: 'Payment Request Rejected', message: `Your payment request "${pr.purpose || ''}" (${formatCurrency(pr.amount)}) was rejected by ${me}`, type: 'status_update', module: 'paymentRequests', relatedId: pr.id });
      }
      toast('Payment request rejected', 'er');
    } catch (e) { toast(e.message, 'er'); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this payment request permanently?')) return;
    try { await deleteDocument('paymentRequests', id); toast('Payment request deleted'); }
    catch (e) { toast(e.message, 'er'); }
  };

  // Compact "who has acted so far" trail for the table.
  const trail = (pr) => [
    pr.recommendedBy && 'Recommended',
    pr.approvedBy && 'Approved',
    pr.paidBy && 'Paid',
    pr.proposalBy && 'Proposal sent',
    pr.closedBy && 'Closed',
  ].filter(Boolean).join(' → ') || 'Awaiting Team Leader recommendation';

  return (
    <>
      <div className="tl">
        <div className="sb-x"><span className="material-icons-round">search</span><input type="text" placeholder="Search payment requests..." value={search} onChange={e => setSearch(e.target.value)} /></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {statuses.map(s => <span key={s} className={`fc ${filter === s ? 'act' : ''}`} onClick={() => setFilter(s)}>{s === 'all' ? 'All' : s}</span>)}
          </div>
          {canRequest && <button className="btn bp bsm" onClick={() => setModal({ data: {} })}><span className="material-icons-round" style={{ fontSize: 18 }}>add</span> Generate Payment Request</button>}
        </div>
      </div>

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 16 }}>
        {[
          ['Total Requested', summary.total, 'request_quote', 'var(--pri)'],
          ['In Approval', summary.pending, 'hourglass_top', '#e8830c'],
          ['Approved (to pay)', summary.approved, 'verified', '#6c5ce7'],
          ['Transferred', summary.paid, 'payments', '#27ae60'],
        ].map(([label, val, icon, color]) => (
          <div className="card" key={label}><div className="cb" style={{ textAlign: 'center', padding: '14px 10px' }}>
            <span className="material-icons-round" style={{ fontSize: 26, color, display: 'block', marginBottom: 4 }}>{icon}</span>
            <div style={{ fontSize: '1.15rem', fontWeight: 700 }}>{formatCurrency(val)}</div>
            <div style={{ fontSize: '.74rem', color: 'var(--muted)' }}>{label}</div>
          </div></div>
        ))}
      </div>

      <div className="card"><div className="cb" style={{ padding: 0 }}><div className="tw"><table><thead><tr>
        <th>Payment For / Paid To</th><th>Amount</th><th>Requested By</th><th>Date</th><th>Status</th><th>Progress</th><th style={{ textAlign: 'right' }}>Actions</th>
      </tr></thead><tbody>
        {displayed.map(pr => {
          const stage = nextPrStage(pr.status);
          const canAct = stage && pr.status !== PR_STATUS.REJECTED && can(role, stage.action);
          const isOwner = pr.requestedBy === user?.email;
          return (
            <tr key={pr.id}>
              <td>
                <strong>{pr.purpose || '-'}</strong><br />
                <span style={{ fontSize: '.74rem', color: 'var(--muted)' }}>
                  {pr.payTo ? pr.payTo : 'Paid to: -'}{pr.paymentMode ? ' · ' + pr.paymentMode : ''}{pr.paymentRef ? ' · Ref ' + pr.paymentRef : ''}{pr.proposalRef ? ' · Proposal ' + pr.proposalRef : ''}
                </span>
              </td>
              <td style={{ fontWeight: 700 }}>{formatCurrency(pr.amount)}</td>
              <td style={{ fontSize: '.82rem' }}>{pr.requestedByName || pr.requestedBy || '-'}</td>
              <td style={{ fontSize: '.8rem', whiteSpace: 'nowrap' }}>{formatDate(pr.requestedDate)}</td>
              <td><StatusBadge status={pr.status} /></td>
              <td style={{ fontSize: '.76rem', color: 'var(--muted)', minWidth: 160 }}>{trail(pr)}</td>
              <td style={{ textAlign: 'right' }}>
                <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  {canAct && (
                    <button className="btn bsm bp" onClick={() => advanceStage(pr)} title={`${stage.label} (${stage.by})`} style={{ padding: '4px 10px', fontSize: '.78rem' }}>
                      <span className="material-icons-round" style={{ fontSize: 15 }}>arrow_forward</span> {stage.label}
                    </button>
                  )}
                  {pr.status !== PR_STATUS.CLOSED && pr.status !== PR_STATUS.REJECTED && canRejectAtStage(role, pr.status) && (
                    <button className="btn bsm bo" onClick={() => rejectRequest(pr)} title="Reject" style={{ padding: '4px 8px', fontSize: '.78rem', color: 'var(--err)', borderColor: 'rgba(231,76,60,.3)' }}>
                      <span className="material-icons-round" style={{ fontSize: 15 }}>block</span>
                    </button>
                  )}
                  {((pr.status === PR_STATUS.REQUESTED && isOwner) || hasAccess(role, 'admin')) && (
                    <button className="btn bsm bo" onClick={() => setModal({ data: pr, id: pr.id })} title="Edit" style={{ padding: '4px 8px', fontSize: '.78rem' }}>
                      <span className="material-icons-round" style={{ fontSize: 15 }}>edit</span>
                    </button>
                  )}
                  {hasAccess(role, 'admin') && (
                    <button className="btn bsm bo" onClick={() => handleDelete(pr.id)} title="Delete" style={{ padding: '4px 8px', fontSize: '.78rem', color: 'var(--err)', borderColor: 'rgba(231,76,60,.3)' }}>
                      <span className="material-icons-round" style={{ fontSize: 15 }}>delete</span>
                    </button>
                  )}
                </div>
              </td>
            </tr>
          );
        })}
        {!filtered.length && <tr><td colSpan="7"><EmptyState icon="request_quote" title="No payment requests" message={canRequest ? 'Use “Generate Payment Request” to raise one.' : 'No payment requests yet.'} /></td></tr>}
      </tbody></table></div>
      {hasMore && <div style={{ textAlign: 'center', padding: 16 }}><button className="btn bsm bo" onClick={() => setVisibleCount(c => c + PAGE_SIZE)}>Show More ({filtered.length - visibleCount} remaining)</button></div>}
      </div></div>

      {/* Workflow legend — the official order of the stages */}
      <div className="card" style={{ marginTop: 12 }}><div className="cb">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: '.76rem', color: 'var(--muted)' }}>
          <span className="material-icons-round" style={{ fontSize: 15 }}>info</span>
          <strong>Flow:</strong> Team Member generates the request
          {PR_STAGES.map(s => <span key={s.to}>→ {s.label} ({s.by})</span>)}
          · no stage can be skipped and each step is role-restricted.
        </div>
      </div></div>

      {modal && <PRModal data={modal.data} id={modal.id} onSave={handleSave} onClose={() => setModal(null)} />}
    </>
  );
}

/* ── Generate / Edit Payment Request ── */
function PRModal({ data, id, onSave, onClose }) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({
    purpose: data.purpose || '',
    payTo: data.payTo || '',
    amount: data.amount || '',
    paymentMode: data.paymentMode || PAYMENT_MODES[0],
    neededBy: data.neededBy || new Date().toISOString().slice(0, 10),
    notes: data.notes || '',
  });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    if (!f.purpose.trim()) { toast('Payment For is required', 'er'); return; }
    if (!f.payTo.trim()) { toast('Paid To is required', 'er'); return; }
    if (toNumber(f.amount) <= 0) { toast('Enter a valid amount', 'er'); return; }
    setSaving(true);
    try { await onSave(f, id); } finally { setSaving(false); }
  };

  return (
    <Modal title={id ? 'Edit Payment Request' : 'Generate Payment Request'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="mb">
          <div className="fg"><label>Payment For *</label><input className="fi" value={f.purpose} onChange={e => set('purpose', e.target.value)} placeholder="e.g. Module transport charges — Tirupati site" required /></div>
          <div className="fr3">
            <div className="fg"><label>Paid To *</label><input className="fi" value={f.payTo} onChange={e => set('payTo', e.target.value)} placeholder="Vendor / payee name" required /></div>
            <div className="fg"><label>Amount (₹) *</label><input type="number" className="fi" value={f.amount} onChange={e => set('amount', e.target.value)} min="1" required /></div>
            <div className="fg"><label>Payment Mode</label><select className="fi" value={f.paymentMode} onChange={e => set('paymentMode', e.target.value)}>{PAYMENT_MODES.map(m => <option key={m}>{m}</option>)}</select></div>
          </div>
          <div className="fg"><label>Required By</label><DateInput value={f.neededBy} onChange={e => set('neededBy', e.target.value)} /></div>
          <div className="fg"><label>Notes</label><textarea className="fi" value={f.notes} onChange={e => set('notes', e.target.value)} rows="2" placeholder="Any detail the approvers need..." /></div>
        </div>
        <div className="mf">
          <button type="button" className="btn bo" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn bp" disabled={saving}>{saving ? 'Saving...' : (id ? 'Update' : 'Generate Request')}</button>
        </div>
      </form>
    </Modal>
  );
}
