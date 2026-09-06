import React, { useState, useMemo } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { addDocument, updateDocument, deleteDocument, createNotification } from '../services/firestore';
import { formatDate, safeStr, hasAccess } from '../services/helpers';
import { StatusBadge, Modal, EmptyState, DateInput } from '../components/SharedUI';

const LEAVE_TYPES = ['Sick Leave', 'Fever Leave', 'Casual Leave', 'Emergency Leave', 'Earned Leave', 'Half Day', 'Other'];
const PAGE_SIZE = 20;

const ST = {
  AWAIT_REPLACEMENT: 'Awaiting Replacement',
  AWAIT_MANAGER: 'Awaiting Manager',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

// Only the Sales Manager (or higher authority / owner) may approve leave (req #1).
const isLeaveApprover = (role) => ['sales_manager', 'management', 'admin', 'super_admin'].includes(role);

// Whole calendar days between two ISO dates, inclusive. Half Day counts as 0.5.
function leaveDays(type, from, to) {
  if (type === 'Half Day') return 0.5;
  if (!from) return 0;
  const a = new Date(from);
  const b = new Date(to || from);
  if (isNaN(a) || isNaN(b) || b < a) return 0;
  return Math.floor((b - a) / 86400000) + 1;
}
// The mandated +1 per request (req #2): 3 days requested → 4 counted.
const countedFor = (days) => (days > 0 ? days + 1 : 0);

export default function Leave() {
  const { leaveRequests, users } = useData();
  const { user, role } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [modal, setModal] = useState(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const myEmail = user?.email || '';
  const myName = user?.displayName || '';
  const approver = isLeaveApprover(role);
  const admin = hasAccess(role, 'admin');

  // Managers/admins see everything; everyone else sees their own requests plus any
  // where they are the assigned replacement (so they can accept/decline).
  const mine = (lr) => lr.employeeEmail === myEmail || lr.employeeName === myName;
  const isReplacement = (lr) => lr.replacementEmail === myEmail || lr.replacementName === myName;
  let visible = (approver || admin) ? leaveRequests : leaveRequests.filter(lr => mine(lr) || isReplacement(lr));

  let filtered = filter === 'all' ? visible : visible.filter(lr => lr.status === filter);
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(lr =>
      safeStr(lr.employeeName).toLowerCase().includes(q) ||
      safeStr(lr.leaveType).toLowerCase().includes(q) ||
      safeStr(lr.replacementName).toLowerCase().includes(q) ||
      safeStr(lr.reason).toLowerCase().includes(q)
    );
  }
  filtered = [...filtered].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  // Leave count summary: total COUNTED days (incl. +1) of approved leave. Managers
  // see the whole team; staff see their own.
  const summary = useMemo(() => {
    const scope = (approver || admin) ? leaveRequests : leaveRequests.filter(mine);
    const approved = scope.filter(lr => lr.status === ST.APPROVED);
    const requested = Number(approved.reduce((s, lr) => s + (Number(lr.days) || 0), 0).toFixed(1));
    const counted = Number(approved.reduce((s, lr) => s + (Number(lr.countedDays) || 0), 0).toFixed(1));
    const pending = scope.filter(lr => lr.status === ST.AWAIT_REPLACEMENT || lr.status === ST.AWAIT_MANAGER).length;
    return { requested, counted, extra: Number((counted - requested).toFixed(1)), pending };
  }, [leaveRequests, role]); // eslint-disable-line react-hooks/exhaustive-deps

  const statuses = ['all', ST.AWAIT_REPLACEMENT, ST.AWAIT_MANAGER, ST.APPROVED, ST.REJECTED];
  const displayed = filtered.slice(0, visibleCount);
  const hasMore = filtered.length > visibleCount;

  const handleSave = async (data, id) => {
    try {
      const days = leaveDays(data.leaveType, data.fromDate, data.toDate);
      const rep = (users || []).find(u => u.id === data.replacementId);
      const payload = {
        ...data,
        toDate: data.leaveType === 'Half Day' ? data.fromDate : (data.toDate || data.fromDate),
        days,
        countedDays: countedFor(days),
        replacementName: rep ? (rep.displayName || rep.email) : (data.replacementName || ''),
        replacementEmail: rep ? rep.email : (data.replacementEmail || ''),
        // Only the applicant can create or edit their own request, so the current
        // user is always the employee.
        employeeName: myName || myEmail,
        employeeEmail: myEmail,
      };
      if (id) {
        // Re-assigning a replacement puts it back to Pending and re-notifies.
        payload.replacementStatus = 'Pending';
        payload.status = ST.AWAIT_REPLACEMENT;
        await updateDocument('leaveRequests', id, payload);
        toast('Leave request updated');
      } else {
        payload.status = ST.AWAIT_REPLACEMENT;
        payload.replacementStatus = 'Pending';
        payload.requestedDate = new Date().toISOString().slice(0, 10);
        await addDocument('leaveRequests', payload);
        toast('Leave request submitted');
      }
      if (payload.replacementEmail) {
        createNotification({
          forUser: payload.replacementEmail,
          title: 'Leave Replacement Request',
          message: `${payload.employeeName || 'A colleague'} asked you to cover their work (${payload.leaveType}, ${formatDate(payload.fromDate)}${payload.toDate && payload.toDate !== payload.fromDate ? '–' + formatDate(payload.toDate) : ''}). Please accept or decline.`,
          type: 'task', module: 'leaveRequests', relatedId: id || '',
        });
      }
      setModal(null);
    } catch (e) { toast(e.message, 'er'); }
  };

  const notifyApprovers = (lr) => {
    const seen = new Set();
    (users || []).forEach(u => {
      if (!isLeaveApprover(u.role) || u.role === 'super_admin') return;
      const key = u.email || u.displayName;
      if (!key || seen.has(key)) return;
      seen.add(key);
      createNotification({ forUser: key, title: 'Leave Awaiting Your Approval', message: `${lr.employeeName}'s ${lr.leaveType} (${lr.days} day${lr.days === 1 ? '' : 's'}) is ready for approval — replacement confirmed.`, type: 'status_update', module: 'leaveRequests', relatedId: lr.id });
    });
  };

  const acceptReplacement = async (lr) => {
    if (!window.confirm(`Accept covering ${lr.employeeName}'s work during their leave?`)) return;
    try {
      await updateDocument('leaveRequests', lr.id, { replacementStatus: 'Accepted', status: ST.AWAIT_MANAGER, replacementAcceptedDate: new Date().toISOString().slice(0, 10) });
      notifyApprovers({ ...lr, status: ST.AWAIT_MANAGER });
      if (lr.employeeEmail) createNotification({ forUser: lr.employeeEmail, title: 'Replacement Accepted', message: `${myName || myEmail} accepted to cover your leave. It is now with the Sales Manager for approval.`, type: 'status_update', module: 'leaveRequests', relatedId: lr.id });
      toast('You accepted the replacement');
    } catch (e) { toast(e.message, 'er'); }
  };

  const declineReplacement = async (lr) => {
    if (!window.confirm('Decline this replacement request?')) return;
    try {
      await updateDocument('leaveRequests', lr.id, { replacementStatus: 'Declined' });
      if (lr.employeeEmail) createNotification({ forUser: lr.employeeEmail, title: 'Replacement Declined', message: `${myName || myEmail} declined to cover your leave. Please assign another colleague.`, type: 'status_update', module: 'leaveRequests', relatedId: lr.id });
      toast('Replacement declined', 'wa');
    } catch (e) { toast(e.message, 'er'); }
  };

  const approve = async (lr) => {
    if (!window.confirm(`Approve ${lr.employeeName}'s leave?`)) return;
    try {
      await updateDocument('leaveRequests', lr.id, { status: ST.APPROVED, approvedBy: myEmail, approvalDate: new Date().toISOString().slice(0, 10) });
      if (lr.employeeEmail) createNotification({ forUser: lr.employeeEmail, title: 'Leave Approved', message: `Your ${lr.leaveType} (${lr.days} day${lr.days === 1 ? '' : 's'}) was approved.`, type: 'status_update', module: 'leaveRequests', relatedId: lr.id });
      if (lr.replacementEmail) createNotification({ forUser: lr.replacementEmail, title: 'Leave Cover Confirmed', message: `${lr.employeeName}'s leave was approved — you are covering ${formatDate(lr.fromDate)}${lr.toDate && lr.toDate !== lr.fromDate ? '–' + formatDate(lr.toDate) : ''}.`, type: 'status_update', module: 'leaveRequests', relatedId: lr.id });
      toast('Leave approved');
    } catch (e) { toast(e.message, 'er'); }
  };

  const reject = async (lr) => {
    const reason = window.prompt('Reason for rejection (optional):', '');
    if (reason === null) return;
    try {
      await updateDocument('leaveRequests', lr.id, { status: ST.REJECTED, rejectedBy: myEmail, rejectionReason: reason, rejectedDate: new Date().toISOString().slice(0, 10) });
      if (lr.employeeEmail) createNotification({ forUser: lr.employeeEmail, title: 'Leave Rejected', message: `Your ${lr.leaveType} request was rejected${reason ? ': ' + reason : ''}.`, type: 'status_update', module: 'leaveRequests', relatedId: lr.id });
      toast('Leave rejected', 'er');
    } catch (e) { toast(e.message, 'er'); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this leave request permanently?')) return;
    try { await deleteDocument('leaveRequests', id); toast('Leave request deleted'); }
    catch (e) { toast(e.message, 'er'); }
  };

  return (
    <>
      <div className="tl">
        <div className="sb-x"><span className="material-icons-round">search</span><input type="text" placeholder="Search leave..." value={search} onChange={e => setSearch(e.target.value)} /></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {statuses.map(s => <span key={s} className={`fc ${filter === s ? 'act' : ''}`} onClick={() => setFilter(s)}>{s === 'all' ? 'All' : s}</span>)}
          </div>
          <button className="btn bp bsm" onClick={() => setModal({ data: {} })}><span className="material-icons-round" style={{ fontSize: 18 }}>event_available</span> Apply for Leave</button>
        </div>
      </div>

      {/* Leave count summary — the +1 per request is called out explicitly (req #2). */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12, marginBottom: 16 }}>
        {[
          [(approver || admin) ? 'Team Leave Counted' : 'My Leave Counted', summary.counted, 'event_note', 'var(--pri)', `${summary.requested} taken + ${summary.extra} added`],
          ['Extra (+1 per request)', summary.extra, 'add_circle', '#e8830c', 'auto-added surcharge'],
          ['Pending', summary.pending, 'hourglass_top', '#6c5ce7', 'awaiting action'],
        ].map(([label, val, icon, color, sub]) => (
          <div className="card" key={label}><div className="cb" style={{ textAlign: 'center', padding: '14px 10px' }}>
            <span className="material-icons-round" style={{ fontSize: 24, color, display: 'block', marginBottom: 4 }}>{icon}</span>
            <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{val}</div>
            <div style={{ fontSize: '.74rem', color: 'var(--muted)' }}>{label}</div>
            <div style={{ fontSize: '.68rem', color: 'var(--light)', marginTop: 2 }}>{sub}</div>
          </div></div>
        ))}
      </div>

      <div className="card"><div className="cb" style={{ padding: 0 }}><div className="tw"><table><thead><tr>
        <th>Employee</th><th>Type</th><th>Dates</th><th>Days (count)</th><th>Replacement</th><th>Status</th><th style={{ textAlign: 'right' }}>Actions</th>
      </tr></thead><tbody>
        {displayed.map(lr => {
          const iAmReplacement = isReplacement(lr) && lr.replacementStatus === 'Pending' && lr.status === ST.AWAIT_REPLACEMENT;
          const canApprove = approver && lr.status === ST.AWAIT_MANAGER;
          const canEdit = mine(lr) && (lr.status === ST.AWAIT_REPLACEMENT);
          return (
            <tr key={lr.id}>
              <td><strong>{lr.employeeName || '-'}</strong></td>
              <td style={{ fontSize: '.82rem' }}>{lr.leaveType === 'Other' ? (lr.leaveTypeOther || 'Other') : lr.leaveType}</td>
              <td style={{ fontSize: '.8rem', whiteSpace: 'nowrap' }}>{formatDate(lr.fromDate)}{lr.toDate && lr.toDate !== lr.fromDate ? ' – ' + formatDate(lr.toDate) : ''}</td>
              <td style={{ fontSize: '.82rem' }}>
                <strong>{lr.days}</strong> → <strong style={{ color: 'var(--pri)' }}>{lr.countedDays}</strong>
                <span title="One extra leave is added per request" style={{ marginLeft: 4, background: 'rgba(232,131,12,.12)', color: '#d68910', borderRadius: 10, padding: '1px 6px', fontSize: '.66rem', fontWeight: 700 }}>+1</span>
              </td>
              <td style={{ fontSize: '.8rem' }}>{lr.replacementName || '-'}{lr.replacementStatus && <><br /><span style={{ fontSize: '.7rem', color: lr.replacementStatus === 'Accepted' ? 'var(--ok)' : lr.replacementStatus === 'Declined' ? 'var(--err)' : 'var(--muted)' }}>{lr.replacementStatus}</span></>}</td>
              <td><StatusBadge status={lr.status} /></td>
              <td style={{ textAlign: 'right' }}>
                <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  {iAmReplacement && <>
                    <button className="btn bsm bp" onClick={() => acceptReplacement(lr)} style={{ padding: '4px 10px', fontSize: '.78rem' }}><span className="material-icons-round" style={{ fontSize: 15 }}>check</span> Accept</button>
                    <button className="btn bsm bo" onClick={() => declineReplacement(lr)} style={{ padding: '4px 8px', fontSize: '.78rem', color: 'var(--err)', borderColor: 'rgba(231,76,60,.3)' }}><span className="material-icons-round" style={{ fontSize: 15 }}>close</span></button>
                  </>}
                  {canApprove && <>
                    <button className="btn bsm bp" onClick={() => approve(lr)} style={{ padding: '4px 10px', fontSize: '.78rem' }}><span className="material-icons-round" style={{ fontSize: 15 }}>done_all</span> Approve</button>
                    <button className="btn bsm bo" onClick={() => reject(lr)} style={{ padding: '4px 8px', fontSize: '.78rem', color: 'var(--err)', borderColor: 'rgba(231,76,60,.3)' }}><span className="material-icons-round" style={{ fontSize: 15 }}>block</span></button>
                  </>}
                  {canEdit && <button className="btn bsm bo" onClick={() => setModal({ data: lr, id: lr.id })} title="Edit / reassign" style={{ padding: '4px 8px', fontSize: '.78rem' }}><span className="material-icons-round" style={{ fontSize: 15 }}>edit</span></button>}
                  {(admin || (mine(lr) && lr.status === ST.AWAIT_REPLACEMENT)) && <button className="btn bsm bo" onClick={() => handleDelete(lr.id)} title="Delete" style={{ padding: '4px 8px', fontSize: '.78rem', color: 'var(--err)', borderColor: 'rgba(231,76,60,.3)' }}><span className="material-icons-round" style={{ fontSize: 15 }}>delete</span></button>}
                </div>
              </td>
            </tr>
          );
        })}
        {!filtered.length && <tr><td colSpan="7"><EmptyState icon="event_busy" title="No leave requests" message="Apply for leave using the button above." /></td></tr>}
      </tbody></table></div>
      {hasMore && <div style={{ textAlign: 'center', padding: 16 }}><button className="btn bsm bo" onClick={() => setVisibleCount(c => c + PAGE_SIZE)}>Show More ({filtered.length - visibleCount} remaining)</button></div>}
      </div></div>

      <div style={{ marginTop: 12, fontSize: '.76rem', color: 'var(--muted)', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="material-icons-round" style={{ fontSize: 15 }}>info</span>
        Flow: Apply &amp; assign a replacement → replacement accepts → Sales Manager approves. Each request counts as the days taken <strong>+1</strong>.
      </div>

      {modal && <LeaveModal data={modal.data} id={modal.id} onSave={handleSave} onClose={() => setModal(null)} />}
    </>
  );
}

function LeaveModal({ data, id, onSave, onClose }) {
  const { users } = useData();
  const { user } = useAuth();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({
    leaveType: data.leaveType || 'Sick Leave',
    leaveTypeOther: data.leaveTypeOther || '',
    fromDate: data.fromDate || new Date().toISOString().slice(0, 10),
    toDate: data.toDate || new Date().toISOString().slice(0, 10),
    reason: data.reason || '',
    replacementId: data.replacementId || '',
  });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  const days = leaveDays(f.leaveType, f.fromDate, f.toDate);
  const counted = countedFor(days);
  const others = (users || []).filter(u => u.email !== user?.email);

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    if (f.leaveType === 'Other' && !f.leaveTypeOther.trim()) { toast('Please specify the leave reason', 'er'); return; }
    if (!f.reason.trim()) { toast('Please add leave details', 'er'); return; }
    if (!f.replacementId) { toast('Assign a replacement colleague before submitting', 'er'); return; }
    if (days <= 0) { toast('Check the leave dates', 'er'); return; }
    setSaving(true);
    try { await onSave(f, id); } finally { setSaving(false); }
  };

  return (
    <Modal title={id ? 'Edit Leave Request' : 'Apply for Leave'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="mb">
          <div className="fr">
            <div className="fg"><label>Leave Type *</label><select className="fi" value={f.leaveType} onChange={e => set('leaveType', e.target.value)}>{LEAVE_TYPES.map(t => <option key={t}>{t}</option>)}</select></div>
            {f.leaveType === 'Other'
              ? <div className="fg"><label>Specify Reason *</label><input className="fi" value={f.leaveTypeOther} onChange={e => set('leaveTypeOther', e.target.value)} placeholder="Custom leave reason" /></div>
              : <div className="fg" />}
          </div>
          <div className="fr">
            <div className="fg"><label>From Date *</label><DateInput value={f.fromDate} onChange={e => { set('fromDate', e.target.value); if (f.leaveType === 'Half Day') set('toDate', e.target.value); }} /></div>
            {f.leaveType !== 'Half Day' && <div className="fg"><label>To Date *</label><DateInput value={f.toDate} onChange={e => set('toDate', e.target.value)} /></div>}
          </div>
          <div style={{ background: 'rgba(26,58,122,.05)', border: '1px solid var(--bor)', borderRadius: 8, padding: '10px 12px', marginBottom: 14, fontSize: '.85rem' }}>
            Days requested: <strong>{days}</strong> &nbsp;→&nbsp; Leave counted: <strong style={{ color: 'var(--pri)' }}>{counted}</strong>
            <span style={{ marginLeft: 6, background: 'rgba(232,131,12,.12)', color: '#d68910', borderRadius: 10, padding: '1px 7px', fontSize: '.7rem', fontWeight: 700 }}>+1 added</span>
          </div>
          <div className="fg"><label>Assign Replacement *</label>
            <select className="fi" value={f.replacementId} onChange={e => set('replacementId', e.target.value)}>
              <option value="">-- Select a colleague to cover your work --</option>
              {others.map(u => <option key={u.id} value={u.id}>{u.displayName || u.email}{u.designation ? ' — ' + u.designation : ''}</option>)}
            </select>
            <small className="lg-hint">They must accept before the request goes to the Sales Manager.</small>
          </div>
          <div className="fg"><label>Leave Details / Reason *</label><textarea className="fi" value={f.reason} onChange={e => set('reason', e.target.value)} rows="3" placeholder="Briefly describe the reason for leave..." /></div>
        </div>
        <div className="mf">
          <button type="button" className="btn bo" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn bp" disabled={saving}>{saving ? 'Saving...' : (id ? 'Update & Reassign' : 'Submit Request')}</button>
        </div>
      </form>
    </Modal>
  );
}
