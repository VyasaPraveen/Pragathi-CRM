import React, { useState, useMemo } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { addDocument, updateDocument, deleteDocument, notifyAdmins, createNotification } from '../services/firestore';
import { formatCurrency, formatDate, safeStr, toNumber, hasAccess } from '../services/helpers';
import { StatusBadge, Modal, EmptyState, DateInput } from '../components/SharedUI';
import { can, ACTIONS, EXP_STATUS, nextExpStage } from '../services/permissions';

const CATEGORIES = ['Travel', 'Materials', 'Office', 'Salary', 'Maintenance', 'Marketing', 'Utilities', 'Fuel', 'Other'];
const PAGE_SIZE = 20;

// Which roles may act at the current stage — used to decide whether to reject too.
const canRejectAtStage = (role, status) => {
  if (status === EXP_STATUS.RECOMMENDED) return can(role, ACTIONS.EXPENDITURE_VERIFIED);
  if (status === EXP_STATUS.VERIFIED) return can(role, ACTIONS.EXPENDITURE_APPROVE);
  if (status === EXP_STATUS.REQUESTED) return can(role, ACTIONS.EXPENDITURE_RECOMMENDATION);
  return false;
};

export default function Expenditure() {
  const { expenditures, users } = useData();
  const { role, user } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [modal, setModal] = useState(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const canRequest = can(role, ACTIONS.EXPENDITURE_REQUEST);

  const statuses = ['all', EXP_STATUS.REQUESTED, EXP_STATUS.RECOMMENDED, EXP_STATUS.VERIFIED, EXP_STATUS.APPROVED, EXP_STATUS.RELEASED, EXP_STATUS.REJECTED];

  let filtered = filter === 'all' ? expenditures : expenditures.filter(x => x.status === filter);
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(x =>
      safeStr(x.title).toLowerCase().includes(q) ||
      safeStr(x.category).toLowerCase().includes(q) ||
      safeStr(x.vendor).toLowerCase().includes(q) ||
      safeStr(x.requestedBy).toLowerCase().includes(q)
    );
  }

  const summary = useMemo(() => {
    const s = { requested: 0, approved: 0, released: 0, pending: 0 };
    expenditures.forEach(x => {
      const amt = toNumber(x.amount);
      if (x.status === EXP_STATUS.RELEASED) s.released += amt;
      else if (x.status === EXP_STATUS.APPROVED) s.approved += amt;
      else if (x.status !== EXP_STATUS.REJECTED) s.pending += amt;
      s.requested += amt;
    });
    return s;
  }, [expenditures]);

  const displayed = filtered.slice(0, visibleCount);
  const hasMore = filtered.length > visibleCount;

  const handleSave = async (data, id) => {
    try {
      const cleaned = { ...data, amount: toNumber(data.amount) };
      if (id) {
        await updateDocument('expenditures', id, cleaned);
        toast('Expenditure updated');
      } else {
        cleaned.status = EXP_STATUS.REQUESTED;
        cleaned.requestedBy = user?.email || 'unknown';
        cleaned.requestedDate = new Date().toISOString().slice(0, 10);
        const newId = await addDocument('expenditures', cleaned);
        notifyAdmins(users, { title: 'New Expenditure Request', message: `${cleaned.title} — ${formatCurrency(cleaned.amount)}`, type: 'info', module: 'expenditure', relatedId: newId });
        toast('Expenditure requested');
      }
      setModal(null);
    } catch (e) { toast(e.message, 'er'); }
  };

  const advanceStage = async (exp) => {
    const stage = nextExpStage(exp.status);
    if (!stage) return;
    if (!can(role, stage.action)) { toast(`You are not authorised to ${stage.label.toLowerCase()}`, 'er'); return; }
    let extra = {};
    if (stage.to === EXP_STATUS.RELEASED) {
      const refNo = window.prompt('Payment reference / transaction no. (optional):', '');
      if (refNo === null) return; // cancelled
      extra.paymentRef = refNo;
    } else if (!window.confirm(`${stage.label} this expenditure?`)) {
      return;
    }
    try {
      await updateDocument('expenditures', exp.id, {
        status: stage.to,
        [stage.field]: user?.email || 'unknown',
        [stage.field + 'Date']: new Date().toISOString().slice(0, 10),
        ...extra,
      });
      // Keep the requester informed as their expenditure moves through the chain.
      if (exp.requestedBy && exp.requestedBy !== user?.email) {
        createNotification({ forUser: exp.requestedBy, title: `Expenditure ${stage.to}`, message: `Your expenditure "${exp.title || ''}" (${formatCurrency(exp.amount)}) is now ${stage.to}`, type: 'status_update', module: 'expenditure', relatedId: exp.id });
      }
      // On final release, let admins know the payment went out.
      if (stage.to === EXP_STATUS.RELEASED) {
        notifyAdmins(users, { title: 'Expenditure Payment Released', message: `Payment released for "${exp.title || ''}" — ${formatCurrency(exp.amount)}`, type: 'status_update', module: 'expenditure', relatedId: exp.id });
      }
      toast(`Expenditure ${stage.to.toLowerCase()}`);
    } catch (e) { toast(e.message, 'er'); }
  };

  const rejectExp = async (exp) => {
    if (!window.confirm('Reject this expenditure? This stops the approval chain.')) return;
    try {
      await updateDocument('expenditures', exp.id, {
        status: EXP_STATUS.REJECTED,
        rejectedBy: user?.email || 'unknown',
        rejectedDate: new Date().toISOString().slice(0, 10),
      });
      if (exp.requestedBy && exp.requestedBy !== user?.email) {
        createNotification({ forUser: exp.requestedBy, title: 'Expenditure Rejected', message: `Your expenditure "${exp.title || ''}" (${formatCurrency(exp.amount)}) was rejected`, type: 'status_update', module: 'expenditure', relatedId: exp.id });
      }
      toast('Expenditure rejected', 'er');
    } catch (e) { toast(e.message, 'er'); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this expenditure permanently?')) return;
    try { await deleteDocument('expenditures', id); toast('Expenditure deleted'); }
    catch (e) { toast(e.message, 'er'); }
  };

  const stageBadge = (status) => <StatusBadge status={status} />;

  return (
    <>
      <div className="tl">
        <div className="sb-x"><span className="material-icons-round">search</span><input type="text" placeholder="Search expenditures..." value={search} onChange={e => setSearch(e.target.value)} /></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {statuses.map(s => <span key={s} className={`fc ${filter === s ? 'act' : ''}`} onClick={() => setFilter(s)}>{s === 'all' ? 'All' : s}</span>)}
          </div>
          {canRequest && <button className="btn bp bsm" onClick={() => setModal({ data: {} })}><span className="material-icons-round" style={{ fontSize: 18 }}>add</span> New Request</button>}
        </div>
      </div>

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 16 }}>
        {[
          ['Total Requested', summary.requested, 'receipt_long', 'var(--pri)'],
          ['Pending', summary.pending, 'hourglass_top', '#e8830c'],
          ['Approved', summary.approved, 'verified', '#6c5ce7'],
          ['Released', summary.released, 'payments', '#27ae60'],
        ].map(([label, val, icon, color]) => (
          <div className="card" key={label}><div className="cb" style={{ textAlign: 'center', padding: '14px 10px' }}>
            <span className="material-icons-round" style={{ fontSize: 26, color, display: 'block', marginBottom: 4 }}>{icon}</span>
            <div style={{ fontSize: '1.15rem', fontWeight: 700 }}>{formatCurrency(val)}</div>
            <div style={{ fontSize: '.74rem', color: 'var(--muted)' }}>{label}</div>
          </div></div>
        ))}
      </div>

      <div className="card"><div className="cb" style={{ padding: 0 }}><div className="tw"><table><thead><tr>
        <th>Title / Category</th><th>Amount</th><th>Requested By</th><th>Date</th><th>Status</th><th>Progress</th><th style={{ textAlign: 'right' }}>Actions</th>
      </tr></thead><tbody>
        {displayed.map(exp => {
          const stage = nextExpStage(exp.status);
          const canAct = stage && can(role, stage.action);
          return (
            <tr key={exp.id}>
              <td><strong>{exp.title || '-'}</strong><br /><span style={{ fontSize: '.74rem', color: 'var(--muted)' }}>{exp.category || '-'}{exp.vendor ? ' · ' + exp.vendor : ''}</span></td>
              <td style={{ fontWeight: 700 }}>{formatCurrency(exp.amount)}</td>
              <td style={{ fontSize: '.82rem' }}>{exp.requestedBy || '-'}</td>
              <td style={{ fontSize: '.8rem', whiteSpace: 'nowrap' }}>{formatDate(exp.requestedDate)}</td>
              <td>{stageBadge(exp.status)}</td>
              <td style={{ fontSize: '.76rem', color: 'var(--muted)', minWidth: 150 }}>
                {[
                  exp.recommendedBy && 'Recommended',
                  exp.verifiedBy && 'Verified',
                  exp.approvedBy && 'Approved',
                  exp.releasedBy && 'Released',
                ].filter(Boolean).join(' → ') || 'Awaiting recommendation'}
              </td>
              <td style={{ textAlign: 'right' }}>
                <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  {canAct && (
                    <button className="btn bsm bp" onClick={() => advanceStage(exp)} title={stage.label} style={{ padding: '4px 10px', fontSize: '.78rem' }}>
                      <span className="material-icons-round" style={{ fontSize: 15 }}>arrow_forward</span> {stage.label}
                    </button>
                  )}
                  {exp.status !== EXP_STATUS.RELEASED && exp.status !== EXP_STATUS.REJECTED && canRejectAtStage(role, exp.status) && (
                    <button className="btn bsm bo" onClick={() => rejectExp(exp)} title="Reject" style={{ padding: '4px 8px', fontSize: '.78rem', color: 'var(--err)', borderColor: 'rgba(231,76,60,.3)' }}>
                      <span className="material-icons-round" style={{ fontSize: 15 }}>block</span>
                    </button>
                  )}
                  {(exp.status === EXP_STATUS.REQUESTED && (exp.requestedBy === user?.email)) || hasAccess(role, 'admin') ? (
                    <button className="btn bsm bo" onClick={() => setModal({ data: exp, id: exp.id })} title="Edit" style={{ padding: '4px 8px', fontSize: '.78rem' }}>
                      <span className="material-icons-round" style={{ fontSize: 15 }}>edit</span>
                    </button>
                  ) : null}
                  {hasAccess(role, 'admin') && (
                    <button className="btn bsm bo" onClick={() => handleDelete(exp.id)} title="Delete" style={{ padding: '4px 8px', fontSize: '.78rem', color: 'var(--err)', borderColor: 'rgba(231,76,60,.3)' }}>
                      <span className="material-icons-round" style={{ fontSize: 15 }}>delete</span>
                    </button>
                  )}
                </div>
              </td>
            </tr>
          );
        })}
        {!filtered.length && <tr><td colSpan="7"><EmptyState icon="account_balance_wallet" title="No expenditures" message={canRequest ? 'Raise a new expenditure request using the button above.' : 'No expenditure requests yet.'} /></td></tr>}
      </tbody></table></div>
      {hasMore && <div style={{ textAlign: 'center', padding: 16 }}><button className="btn bsm bo" onClick={() => setVisibleCount(c => c + PAGE_SIZE)}>Show More ({filtered.length - visibleCount} remaining)</button></div>}
      </div></div>

      {/* Workflow legend */}
      <div style={{ marginTop: 12, fontSize: '.76rem', color: 'var(--muted)', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="material-icons-round" style={{ fontSize: 15 }}>info</span>
        Flow: Request → Recommendation → Verified → Approve → Payment Release. Each step is limited to authorised roles.
      </div>

      {modal && <ExpModal data={modal.data} id={modal.id} onSave={handleSave} onClose={() => setModal(null)} />}
    </>
  );
}

/* ── Create / Edit Expenditure ── */
function ExpModal({ data, id, onSave, onClose }) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({
    title: data.title || '',
    category: data.category || 'Travel',
    amount: data.amount || '',
    vendor: data.vendor || '',
    date: data.date || new Date().toISOString().slice(0, 10),
    purpose: data.purpose || '',
    notes: data.notes || '',
  });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    if (!f.title.trim()) { toast('Title is required', 'er'); return; }
    if (toNumber(f.amount) <= 0) { toast('Enter a valid amount', 'er'); return; }
    setSaving(true);
    try { await onSave(f, id); } finally { setSaving(false); }
  };

  return (
    <Modal title={id ? 'Edit Expenditure' : 'New Expenditure Request'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="mb">
          <div className="fg"><label>Title *</label><input className="fi" value={f.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Site visit fuel — Tirupati" required /></div>
          <div className="fr3">
            <div className="fg"><label>Category</label><select className="fi" value={f.category} onChange={e => set('category', e.target.value)}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></div>
            <div className="fg"><label>Amount (₹) *</label><input type="number" className="fi" value={f.amount} onChange={e => set('amount', e.target.value)} min="1" required /></div>
            <div className="fg"><label>Date</label><DateInput value={f.date} onChange={e => set('date', e.target.value)} /></div>
          </div>
          <div className="fg"><label>Vendor / Paid To</label><input className="fi" value={f.vendor} onChange={e => set('vendor', e.target.value)} placeholder="Vendor or payee name" /></div>
          <div className="fg"><label>Purpose</label><textarea className="fi" value={f.purpose} onChange={e => set('purpose', e.target.value)} rows="2" placeholder="Reason for this expenditure..." /></div>
          <div className="fg"><label>Notes</label><textarea className="fi" value={f.notes} onChange={e => set('notes', e.target.value)} rows="2" /></div>
        </div>
        <div className="mf">
          <button type="button" className="btn bo" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn bp" disabled={saving}>{saving ? 'Saving...' : (id ? 'Update' : 'Submit Request')}</button>
        </div>
      </form>
    </Modal>
  );
}
