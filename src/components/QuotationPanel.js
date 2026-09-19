import React, { useState } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { addDocument, updateDocument, createNotification } from '../services/firestore';
import { formatCurrency, formatDate, toNumber, sendWhatsApp, todayStr } from '../services/helpers';
import { StatusBadge, Modal, EmptyState, DateInput } from './SharedUI';
import { can, ACTIONS, quotationApprovers } from '../services/permissions';
import {
  QT_STATUS, MAX_REVISION, APPROVAL_HOURS, SHARE_DAYS,
  DEFAULT_TARIFF, DEFAULT_UNITS_PER_KW_MONTH,
  nextQuotationNumber, quotationRef, ppsRefFor, canRevise, calcQuotation,
  defaultQuoteBOM, bomFromPO, crossCheckCustomer, quotationDue, isOverdue,
  printQuotation, quotationWhatsAppText,
} from '../services/quotation';

const nowIso = () => new Date().toISOString();
const today = () => todayStr();

// "in 1 h 20 m" / "overdue by 2 days" — the SLA in words, so nobody has to do
// the arithmetic themselves.
function untilText(at) {
  if (!at) return '';
  const ms = new Date(at) - new Date();
  const abs = Math.abs(ms);
  const d = Math.floor(abs / 86400000);
  const h = Math.floor((abs % 86400000) / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  const parts = d ? `${d}d ${h}h` : (h ? `${h}h ${m}m` : `${m}m`);
  return ms >= 0 ? `in ${parts}` : `overdue by ${parts}`;
}

/* ============ QUOTATION TAB (inside the Lead detail modal) ============ */
export default function QuotationPanel({ lead }) {
  const { quotations, leads, customers, users, leadPOs } = useData();
  const { role, user } = useAuth();
  const { toast } = useToast();
  const [form, setForm] = useState(null);       // { mode: 'new' | 'revise', data }
  const [declineForm, setDeclineForm] = useState(false);
  const [decline, setDecline] = useState({ reason: '', nextFollowUpDate: '' });
  const [busy, setBusy] = useState(false);

  const myQuotes = quotations.filter(q => q.leadId === lead.id);
  // One quotation per lead — revisions live on the same record.
  const q = myQuotes[0] || null;
  const meName = user?.displayName || user?.email || '';
  const myEmail = String(user?.email || '').toLowerCase();

  const isApprover = can(role, ACTIONS.QUOTATION_APPROVE);
  const isAdminOverride = can(role, ACTIONS.QUOTATION_REVISION_OVERRIDE);
  // Sharing and recording the customer's answer is the assigned person's job;
  // the hierarchy can always step in.
  const isConcerned = [lead.assignedTo, lead.salesExecutive, q?.executiveName, q?.executiveEmail]
    .some(v => {
      const s = String(v || '').toLowerCase();
      return !!s && (s === myEmail || s === String(user?.displayName || '').toLowerCase());
    });
  const mayAct = isConcerned || isApprover;

  const notify = (targets, title, message) => {
    const seen = new Set();
    targets.filter(Boolean).forEach(t => {
      const key = typeof t === 'string' ? t : (t.displayName || t.email);
      if (!key || seen.has(key)) return;
      seen.add(key);
      createNotification({ forUser: key, title, message, type: 'status_update', module: 'quotations', relatedId: q?.id || lead.id });
    });
  };

  const assignedTarget = lead.assignedTo || lead.salesExecutive || q?.executiveName || '';

  /* ── create / revise ─────────────────────────────────────────────────── */
  const openNew = () => {
    const seq = quotations.length + 1;
    setForm({
      mode: 'new',
      data: {
        leadId: lead.id,
        leadName: lead.name || '',
        quotationNumber: nextQuotationNumber(quotations),
        revision: 0,
        ppsRef: ppsRefFor(9072 + seq, today()),
        date: today(),
        executiveName: lead.assignedTo || lead.salesExecutive || meName,
        executiveEmail: myEmail,
        executiveId: '',
        executivePhone: '',
        customerName: lead.name || '',
        customerPhone: lead.phone || '',
        customerAddress: lead.address || '',
        city: lead.city || '',
        district: lead.district || '',
        pincode: lead.pincode || '',
        serviceNumber: lead.customerServiceNumber || lead.meterNumber || '',
        kw: lead.kwRequired || '',
        systemCost: lead.expectedValue || '',
        subsidy: '',
        tariff: DEFAULT_TARIFF,
        unitsPerKwMonth: DEFAULT_UNITS_PER_KW_MONTH,
        validityDays: 15,
        bomSource: 'default',
        bomItems: defaultQuoteBOM(lead.kwRequired),
      },
    });
  };

  const openRevise = () => {
    const gate = canRevise(q);
    if (!gate.ok) { toast(gate.reason, 'er'); return; }
    setForm({
      mode: 'revise',
      data: { ...q, revision: toNumber(q.revision) + 1, date: today() },
    });
  };

  const handleSave = async (data) => {
    setBusy(true);
    try {
      const calc = calcQuotation(data);
      const payload = {
        ...data,
        kw: data.kw, systemCost: toNumber(data.systemCost), subsidy: toNumber(data.subsidy),
        tariff: toNumber(data.tariff) || DEFAULT_TARIFF,
        unitsPerKwMonth: toNumber(data.unitsPerKwMonth) || DEFAULT_UNITS_PER_KW_MONTH,
        generation: calc.generation, monthlySavings: calc.monthlySavings,
        yearlySavings: calc.yearlySavings, paybackYears: calc.paybackYears,
        paybackLoanYears: calc.paybackLoanYears,
      };
      if (form.mode === 'new') {
        const id = await addDocument('quotations', {
          ...payload,
          status: QT_STATUS.PENDING,
          raisedAt: nowIso(),
          raisedBy: meName,
        });
        // All four authorities are told; the first one to act decides it.
        const approvers = quotationApprovers(users);
        approvers.forEach(u => createNotification({
          forUser: u.displayName || u.email,
          title: 'Quotation Approval Needed (within 2 hours)',
          message: `${quotationRef(payload)} for "${lead.name}" (${payload.kw || '-'} kW, ${formatCurrency(payload.systemCost)}) needs approval. Any one of Admin / Operation Manager / Management / Owner can approve it.`,
          type: 'status_update', module: 'quotations', relatedId: id,
        }));
        toast(`Quotation ${payload.quotationNumber} raised — sent for approval`);
      } else {
        // A revision keeps the number, bumps R1→R3 and re-dates the document.
        const history = [...(q.revisionHistory || []), {
          revision: toNumber(q.revision), date: q.date, systemCost: toNumber(q.systemCost),
          kw: q.kw, by: meName, at: nowIso(),
        }];
        // A revision changes the document, not where it sits in the workflow —
        // the status (and the ids the server maintains) are left alone.
        const { status, id, createdAt, updatedAt, ...fields } = payload; // eslint-disable-line no-unused-vars
        await updateDocument('quotations', q.id, { ...fields, revisionHistory: history });
        toast(`Revision R${payload.revision} saved`);
        notify([assignedTarget, ...quotationApprovers(users)],
          'Quotation Revised',
          `${quotationRef(payload)} for "${lead.name}" was revised by ${meName}.`);
      }
      setForm(null);
    } catch (e) { toast(e.message, 'er'); }
    finally { setBusy(false); }
  };

  /* ── workflow steps ──────────────────────────────────────────────────── */
  const step = async (patch, okMsg, after) => {
    setBusy(true);
    try {
      await updateDocument('quotations', q.id, patch);
      if (after) await after();
      toast(okMsg);
    } catch (e) { toast(e.message, 'er'); }
    finally { setBusy(false); }
  };

  const handleApprove = () => {
    if (!window.confirm('Approve this quotation? It can then be shared with the customer.')) return;
    step({ status: QT_STATUS.APPROVED, approvedBy: meName, approvedAt: nowIso() },
      'Quotation approved',
      async () => notify([assignedTarget],
        'Share the Approved Quotation with the Customer',
        `${quotationRef(q)} for "${lead.name}" is approved. Please share it with the customer within ${SHARE_DAYS} days.`));
  };

  const handleReject = () => {
    const why = window.prompt('Reason for rejecting this quotation:');
    if (why == null || !why.trim()) return;
    step({ status: QT_STATUS.REJECTED, rejectedBy: meName, rejectedAt: nowIso(), rejectionReason: why.trim() },
      'Quotation rejected',
      async () => notify([assignedTarget, q.raisedBy],
        'Quotation Rejected',
        `${quotationRef(q)} for "${lead.name}" was rejected by ${meName}: ${why.trim()}`));
  };

  const handleShared = () => {
    if (!window.confirm('Mark this quotation as shared with the customer?')) return;
    step({ status: QT_STATUS.SHARED, sharedBy: meName, sharedAt: nowIso() },
      'Marked as shared — the customer has 3 days to respond',
      async () => {
        await updateDocument('leads', lead.id, { quotationSent: 'Yes' });
        notify(quotationApprovers(users), 'Quotation Shared with Customer',
          `${quotationRef(q)} for "${lead.name}" was shared with the customer by ${meName}.`);
      });
  };

  const handleAccepted = () => {
    if (!window.confirm('Has the customer accepted this quotation? PO and BOM will be unlocked.')) return;
    step({ status: QT_STATUS.ACCEPTED, acceptedAt: nowIso(), acceptedRecordedBy: meName },
      'Quotation accepted — PO and BOM are now open',
      async () => {
        await updateDocument('leads', lead.id, {
          quotationAccepted: 'Yes', pendingFollowUp: false,
          followUpStatus: 'Interested', status: lead.status === 'Not Interested' ? 'Interested' : lead.status,
        });
        notify([assignedTarget, ...quotationApprovers(users)], 'Quotation Accepted by Customer',
          `${quotationRef(q)} for "${lead.name}" was accepted. The lead can now move to PO → BOM.`);
      });
  };

  const handleDecline = async () => {
    if (!decline.reason.trim()) { toast('Enter the reason the customer did not accept', 'er'); return; }
    if (!decline.nextFollowUpDate) { toast('Enter the next follow-up date', 'er'); return; }
    setBusy(true);
    try {
      await updateDocument('quotations', q.id, {
        status: QT_STATUS.NOT_ACCEPTED,
        notAcceptedReason: decline.reason.trim(),
        nextFollowUpDate: decline.nextFollowUpDate,
        notAcceptedRecordedBy: meName,
        notAcceptedAt: nowIso(),
      });
      // The lead moves into the assigned Executive's Pending Follow-up list.
      await updateDocument('leads', lead.id, {
        pendingFollowUp: true,
        quotationAccepted: 'No',
        notAcceptedReason: decline.reason.trim(),
        nextFollowUpDate: decline.nextFollowUpDate,
        followUpStatus: 'Follow-up',
      });
      // A reminder so the date is not only on the lead record.
      await addDocument('reminders', {
        type: 'Follow-up', customer: lead.name, phone: lead.phone || '',
        date: decline.nextFollowUpDate,
        message: `Follow-up for ${lead.name} — quotation not accepted: ${decline.reason.trim()}`,
        status: 'Pending',
      });
      notify([assignedTarget, ...quotationApprovers(users)], 'Quotation Not Accepted — Follow-up Pending',
        `${quotationRef(q)} for "${lead.name}" was not accepted (${decline.reason.trim()}). Next follow-up on ${formatDate(decline.nextFollowUpDate)}.`);
      toast('Recorded — the lead is now in Pending Follow-up');
      setDeclineForm(false);
      setDecline({ reason: '', nextFollowUpDate: '' });
    } catch (e) { toast(e.message, 'er'); }
    finally { setBusy(false); }
  };

  const handleAllowExtraRevision = () => {
    if (!window.confirm(`Approve a further revision beyond R${MAX_REVISION} for this quotation?`)) return;
    step({ extraRevisionApprovedBy: meName, extraRevisionApprovedAt: nowIso() },
      'Further revision approved',
      async () => notify([assignedTarget, q.raisedBy], 'Further Quotation Revision Approved',
        `An Admin approved a revision beyond R${MAX_REVISION} for ${quotationRef(q)} ("${lead.name}").`));
  };

  const handleUseActualBOM = async () => {
    const po = leadPOs.find(p => p.leadId === lead.id && (p.items || []).length);
    if (!po) { toast('No purchase order with a BOM exists for this lead yet', 'er'); return; }
    const items = bomFromPO(po);
    if (!items.length) { toast('That purchase order has no BOM lines', 'er'); return; }
    if (!window.confirm(`Replace the default BOM with the actual BOM from ${po.poNumber || 'the PO'} (${items.length} items)?`)) return;
    await step({ bomItems: items, bomSource: 'po', poId: po.id }, 'Actual PO / BOM details applied to the quotation');
  };

  /* ── render ──────────────────────────────────────────────────────────── */
  if (!q) {
    return (
      <>
        <EmptyState icon="description" title="No quotation raised yet"
          message="Create the quotation from this lead — the customer details, PPS reference and assigned Executive are filled in automatically.">
          <button className="btn bsm bp" onClick={openNew} style={{ marginTop: 10 }}>
            <span className="material-icons-round" style={{ fontSize: 16 }}>post_add</span> Create Quotation
          </button>
        </EmptyState>
        {form && <QuotationForm form={form} lead={lead} leads={leads} customers={customers} busy={busy} onSave={handleSave} onClose={() => setForm(null)} />}
      </>
    );
  }

  const calc = calcQuotation(q);
  const due = quotationDue(q);
  const overdue = isOverdue(q);
  const reviseGate = canRevise(q);

  return (
    <div>
      {/* Header: reference, status and the SLA clock */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <strong style={{ fontSize: '1.02rem' }}>{quotationRef(q)}</strong>
          <StatusBadge status={q.status} />
          {q.bomSource === 'po' && <span className="st st-b" style={{ padding: '2px 8px', fontSize: '.7rem' }}>Actual BOM</span>}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className="btn bsm bo" onClick={() => printQuotation(q)}>
            <span className="material-icons-round" style={{ fontSize: 16 }}>print</span> Print / PDF
          </button>
          <button className="btn bsm bo" style={{ color: '#25d366', borderColor: 'rgba(37,211,102,.3)' }}
            onClick={() => sendWhatsApp(q.customerPhone || lead.phone, quotationWhatsAppText(q))}>
            <span className="material-icons-round" style={{ fontSize: 16 }}>share</span> WhatsApp
          </button>
        </div>
      </div>

      {due && (
        <div style={{
          background: overdue ? 'rgba(231,76,60,.08)' : 'rgba(26,58,122,.05)',
          border: `1px solid ${overdue ? 'rgba(231,76,60,.3)' : 'var(--bor)'}`,
          borderRadius: 8, padding: '8px 12px', fontSize: '.82rem',
          color: overdue ? '#c0392b' : 'var(--dark)', marginBottom: 12,
        }}>
          <span className="material-icons-round" style={{ fontSize: 15, verticalAlign: 'middle', marginRight: 5 }}>
            {overdue ? 'warning' : 'schedule'}
          </span>
          <strong>{due.label}:</strong> {due.at ? `${formatDate(due.at)} ${new Date(due.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} (${untilText(due.at)})` : '-'}
          {due.who ? ` — ${due.who}` : ''}
        </div>
      )}

      {/* Workflow actions for the current stage */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {q.status === QT_STATUS.PENDING && isApprover && (
          <>
            <button className="btn bsm bp" disabled={busy} onClick={handleApprove}>
              <span className="material-icons-round" style={{ fontSize: 16 }}>check_circle</span> Approve Quotation
            </button>
            <button className="btn bsm bo" disabled={busy} onClick={handleReject} style={{ color: 'var(--err)', borderColor: 'rgba(231,76,60,.3)' }}>
              <span className="material-icons-round" style={{ fontSize: 16 }}>cancel</span> Reject
            </button>
          </>
        )}
        {q.status === QT_STATUS.PENDING && !isApprover && (
          <span style={{ fontSize: '.82rem', color: 'var(--muted)' }}>
            Waiting for approval from Admin / Operation Manager / Management / Owner (within {APPROVAL_HOURS} hours).
          </span>
        )}
        {q.status === QT_STATUS.APPROVED && mayAct && (
          <button className="btn bsm bp" disabled={busy} onClick={handleShared}>
            <span className="material-icons-round" style={{ fontSize: 16 }}>send</span> Mark as Shared with Customer
          </button>
        )}
        {q.status === QT_STATUS.SHARED && mayAct && (
          <>
            <button className="btn bsm bp" disabled={busy} onClick={handleAccepted}>
              <span className="material-icons-round" style={{ fontSize: 16 }}>thumb_up</span> Customer Accepted
            </button>
            <button className="btn bsm bo" disabled={busy} onClick={() => setDeclineForm(v => !v)} style={{ color: '#d68910', borderColor: 'rgba(243,156,18,.3)' }}>
              <span className="material-icons-round" style={{ fontSize: 16 }}>event_repeat</span> Not Accepted — Record Follow-up
            </button>
          </>
        )}
        {/* Revisions: R1 → R3, then only with an Admin's approval */}
        {[QT_STATUS.PENDING, QT_STATUS.APPROVED, QT_STATUS.SHARED, QT_STATUS.NOT_ACCEPTED, QT_STATUS.REJECTED].includes(q.status) && mayAct && (
          reviseGate.ok
            ? <button className="btn bsm bo" disabled={busy} onClick={openRevise}>
                <span className="material-icons-round" style={{ fontSize: 16 }}>edit_note</span> Create Revision (R{toNumber(q.revision) + 1})
              </button>
            : <span style={{ fontSize: '.8rem', color: '#c0392b', alignSelf: 'center' }}>{reviseGate.reason}</span>
        )}
        {!reviseGate.ok && isAdminOverride && (
          <button className="btn bsm bo" disabled={busy} onClick={handleAllowExtraRevision} style={{ color: '#6c5ce7', borderColor: 'rgba(108,92,231,.3)' }}>
            <span className="material-icons-round" style={{ fontSize: 16 }}>verified_user</span> Approve Further Revision
          </button>
        )}
        {mayAct && (
          <button className="btn bsm bo" disabled={busy} onClick={handleUseActualBOM} title="Replace the default BOM with the BOM from the confirmed PO">
            <span className="material-icons-round" style={{ fontSize: 16 }}>sync</span> Use Actual PO / BOM
          </button>
        )}
      </div>

      {/* Not-accepted form */}
      {declineForm && (
        <div style={{ background: '#fffbf0', border: '1px solid rgba(243,156,18,.3)', borderRadius: 10, padding: 16, marginBottom: 14 }}>
          <div className="fg"><label>Reason the customer did not accept *</label>
            <textarea className="fi" rows="2" value={decline.reason} onChange={e => setDecline(p => ({ ...p, reason: e.target.value }))} placeholder="e.g. Price higher than a competitor's offer" />
          </div>
          <div className="fg"><label>Next Follow-up Date *</label>
            <DateInput value={decline.nextFollowUpDate} min={today()} onChange={e => setDecline(p => ({ ...p, nextFollowUpDate: e.target.value }))} />
            <small style={{ fontSize: '.76rem', color: 'var(--muted)' }}>A reminder appears 2 days before this date.</small>
          </div>
          <button className="btn bsm bp" disabled={busy} onClick={handleDecline}>
            <span className="material-icons-round" style={{ fontSize: 16 }}>save</span> Save &amp; Move to Pending Follow-up
          </button>
        </div>
      )}

      {q.status === QT_STATUS.ACCEPTED && (
        <div style={{ background: 'rgba(39,174,96,.08)', border: '1px solid rgba(39,174,96,.3)', borderRadius: 8, padding: '8px 12px', fontSize: '.82rem', color: '#1e8449', marginBottom: 12 }}>
          <span className="material-icons-round" style={{ fontSize: 15, verticalAlign: 'middle', marginRight: 5 }}>check_circle</span>
          Accepted on {formatDate(q.acceptedAt)} — the next stages (PO → BOM) are open on the Purchase Orders tab.
        </div>
      )}
      {q.status === QT_STATUS.NOT_ACCEPTED && (
        <div style={{ background: 'rgba(243,156,18,.08)', border: '1px solid rgba(243,156,18,.3)', borderRadius: 8, padding: '8px 12px', fontSize: '.82rem', color: '#d68910', marginBottom: 12 }}>
          <strong>Not accepted:</strong> {q.notAcceptedReason || '-'} · Next follow-up {formatDate(q.nextFollowUpDate)}
        </div>
      )}
      {q.status === QT_STATUS.REJECTED && (
        <div style={{ background: 'rgba(231,76,60,.08)', border: '1px solid rgba(231,76,60,.3)', borderRadius: 8, padding: '8px 12px', fontSize: '.82rem', color: '#c0392b', marginBottom: 12 }}>
          <strong>Rejected by {q.rejectedBy || '-'}:</strong> {q.rejectionReason || '-'} — revise the quotation and it goes back for approval.
        </div>
      )}

      {/* The figures, exactly as they print */}
      <div className="dg" style={{ gap: 8 }}>
        <div className="di"><div className="dl">PPS Ref</div><div className="dv">{q.ppsRef || '-'}</div></div>
        <div className="di"><div className="dl">Date</div><div className="dv">{formatDate(q.date)}</div></div>
        <div className="di"><div className="dl">Assigned Executive</div><div className="dv">{q.executiveName || '-'}{q.executiveId ? ` (${q.executiveId})` : ''}</div></div>
        <div className="di"><div className="dl">Service Number</div><div className="dv">{q.serviceNumber || '-'}</div></div>
        <div className="di"><div className="dl">System</div><div className="dv">{q.kw || '-'} kW</div></div>
        <div className="di"><div className="dl">System Cost (incl. GST)</div><div className="dv" style={{ fontWeight: 700 }}>{formatCurrency(q.systemCost)}</div></div>
        {toNumber(q.subsidy) > 0 && <div className="di"><div className="dl">Subsidy</div><div className="dv">- {formatCurrency(q.subsidy)}</div></div>}
        <div className="di"><div className="dl">Solar Generation</div><div className="dv">{calc.generation} units p.m.</div></div>
        <div className="di"><div className="dl">Monthly EB Savings</div><div className="dv">{formatCurrency(calc.monthlySavings)}</div></div>
        <div className="di"><div className="dl">Yearly EB Savings</div><div className="dv">{formatCurrency(calc.yearlySavings)}</div></div>
        <div className="di"><div className="dl">Payback (own funds)</div><div className="dv">{calc.paybackYears.toFixed(2)} yrs</div></div>
        <div className="di"><div className="dl">Payback (bank loan)</div><div className="dv">{calc.paybackLoanYears.toFixed(2)} yrs</div></div>
        {q.approvedBy && <div className="di"><div className="dl">Approved By</div><div className="dv" style={{ fontSize: '.84rem' }}>{q.approvedBy}<br /><span style={{ color: 'var(--muted)', fontSize: '.78rem' }}>{formatDate(q.approvedAt)}</span></div></div>}
        {q.sharedBy && <div className="di"><div className="dl">Shared By</div><div className="dv" style={{ fontSize: '.84rem' }}>{q.sharedBy}<br /><span style={{ color: 'var(--muted)', fontSize: '.78rem' }}>{formatDate(q.sharedAt)}</span></div></div>}
        {q.extraRevisionApprovedBy && <div className="di"><div className="dl">Further Revision Approved</div><div className="dv" style={{ fontSize: '.84rem' }}>{q.extraRevisionApprovedBy}</div></div>}
      </div>

      {/* Bill of Materials on the quotation */}
      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: 'pointer', fontSize: '.84rem', fontWeight: 600, color: 'var(--pri)' }}>
          Bill of Materials ({(q.bomItems || []).length} items · {q.bomSource === 'po' ? 'actual PO' : 'standard template'})
        </summary>
        <div className="tw" style={{ marginTop: 8 }}>
          <table><thead><tr><th>Material Details</th><th>Specification</th><th>Quantity</th><th>Warranty / Guarantee</th></tr></thead>
            <tbody>{(q.bomItems || []).map((it, i) => (
              <tr key={`${it.material}-${i}`}><td>{it.material}</td><td style={{ fontSize: '.82rem' }}>{it.specification}</td><td>{it.quantity}</td><td style={{ fontSize: '.82rem' }}>{it.warranty}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </details>

      {/* Revision history — the main number never changes */}
      {(q.revisionHistory || []).length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: 'pointer', fontSize: '.84rem', fontWeight: 600, color: 'var(--pri)' }}>Revision History ({q.revisionHistory.length})</summary>
          <div className="tw" style={{ marginTop: 8 }}>
            <table><thead><tr><th>Version</th><th>Date</th><th>kW</th><th>System Cost</th><th>Revised By</th></tr></thead>
              <tbody>{q.revisionHistory.map((h, i) => (
                <tr key={`rev-${h.revision}-${i}`}>
                  <td>{h.revision > 0 ? `R${h.revision}` : 'Original'}</td>
                  <td>{formatDate(h.date)}</td><td>{h.kw || '-'}</td>
                  <td>{formatCurrency(h.systemCost)}</td><td style={{ fontSize: '.82rem' }}>{h.by || '-'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </details>
      )}

      {form && <QuotationForm form={form} lead={lead} leads={leads} customers={customers} busy={busy} onSave={handleSave} onClose={() => setForm(null)} />}
    </div>
  );
}

/* ============ CREATE / REVISE FORM ============ */
function QuotationForm({ form, lead, leads, customers, busy, onSave, onClose }) {
  const [f, setF] = useState(form.data);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const isRevision = form.mode === 'revise';
  const calc = calcQuotation(f);
  // The BOM follows the kW until the actual PO BOM has been pulled in.
  const syncBom = (kw) => {
    set('kw', kw);
    if (f.bomSource !== 'po') set('bomItems', defaultQuoteBOM(kw));
  };
  const issues = crossCheckCustomer(
    { phone: f.customerPhone, serviceNumber: f.serviceNumber },
    { leads, customers, leadId: lead.id });

  return (
    <Modal title={isRevision ? `Revise Quotation — ${f.quotationNumber} R${f.revision}` : 'Create Quotation'} onClose={onClose} wide>
      <form onSubmit={e => { e.preventDefault(); if (!busy) onSave(f); }}>
        <div className="mb">
          <div className="fr3">
            <div className="fg"><label>Quotation No.</label><input className="fi" value={f.quotationNumber} readOnly style={{ background: '#f5f6f8' }} /></div>
            <div className="fg"><label>Revision</label><input className="fi" value={f.revision > 0 ? `R${f.revision}` : 'Original'} readOnly style={{ background: '#f5f6f8' }} /></div>
            <div className="fg"><label>Date</label><DateInput value={f.date} onChange={e => set('date', e.target.value)} /></div>
          </div>
          <div className="fr3">
            <div className="fg"><label>PPS Referral No.</label><input className="fi" value={f.ppsRef} onChange={e => set('ppsRef', e.target.value)} /></div>
            <div className="fg"><label>Assigned Executive</label><input className="fi" value={f.executiveName} onChange={e => set('executiveName', e.target.value)} /></div>
            <div className="fg"><label>Executive ID / Code</label><input className="fi" value={f.executiveId} onChange={e => set('executiveId', e.target.value)} placeholder="e.g. PPS05" /></div>
          </div>

          <div style={{ borderTop: '1px solid var(--bor)', margin: '12px 0', paddingTop: 12 }}>
            <label style={{ fontWeight: 700, fontSize: '.9rem', marginBottom: 8, display: 'block' }}>Customer (from the lead)</label>
            <div className="fr">
              <div className="fg"><label>Name</label><input className="fi" value={f.customerName} onChange={e => set('customerName', e.target.value)} required /></div>
              <div className="fg"><label>Phone *</label><input className="fi" value={f.customerPhone} onChange={e => set('customerPhone', e.target.value)} required /></div>
            </div>
            <div className="fg"><label>Address</label><input className="fi" value={f.customerAddress} onChange={e => set('customerAddress', e.target.value)} /></div>
            <div className="fr">
              <div className="fg"><label>Electrical Service Number *</label><input className="fi" value={f.serviceNumber} onChange={e => set('serviceNumber', e.target.value)} placeholder="Service number from the electricity bill" /></div>
              <div className="fg"><label>Executive Mobile (printed)</label><input className="fi" value={f.executivePhone} onChange={e => set('executivePhone', e.target.value)} placeholder="9701426440" /></div>
            </div>
            {issues.length > 0 && (
              <div style={{ background: 'rgba(243,156,18,.1)', border: '1px solid rgba(243,156,18,.3)', borderRadius: 8, padding: '8px 12px', fontSize: '.8rem', color: '#d68910' }}>
                <strong>Cross-check:</strong>
                <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>{issues.map(i => <li key={i}>{i}</li>)}</ul>
              </div>
            )}
          </div>

          <div style={{ borderTop: '1px solid var(--bor)', margin: '12px 0', paddingTop: 12 }}>
            <label style={{ fontWeight: 700, fontSize: '.9rem', marginBottom: 8, display: 'block' }}>System &amp; Price</label>
            <div className="fr3">
              <div className="fg"><label>System Size (kW) *</label><input className="fi" value={f.kw} onChange={e => syncBom(e.target.value)} required /></div>
              <div className="fg"><label>System Cost incl. GST (₹) *</label><input type="number" className="fi" value={f.systemCost} onChange={e => set('systemCost', e.target.value)} required /></div>
              <div className="fg"><label>Subsidy (₹)</label><input type="number" className="fi" value={f.subsidy} onChange={e => set('subsidy', e.target.value)} placeholder="0" /></div>
            </div>
            <div className="fr3">
              <div className="fg"><label>EB Tariff (₹/unit)</label><input type="number" className="fi" value={f.tariff} onChange={e => set('tariff', e.target.value)} step="0.1" /></div>
              <div className="fg"><label>Generation (units/kW/month)</label><input type="number" className="fi" value={f.unitsPerKwMonth} onChange={e => set('unitsPerKwMonth', e.target.value)} /></div>
              <div className="fg"><label>Offer Validity (days)</label><input type="number" className="fi" value={f.validityDays} onChange={e => set('validityDays', e.target.value)} /></div>
            </div>
            {/* Live calculation — changes with the system price, as required */}
            <div style={{ background: 'rgba(26,58,122,.05)', border: '1px solid var(--bor)', borderRadius: 8, padding: 12, fontSize: '.83rem' }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Generation &amp; Payback (auto-calculated)</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8 }}>
                <div>Solar Generation: <strong>{calc.generation}</strong> units p.m.</div>
                <div>Monthly Savings: <strong>{formatCurrency(calc.monthlySavings)}</strong></div>
                <div>Yearly Savings: <strong>{formatCurrency(calc.yearlySavings)}</strong></div>
                <div>Net Cost: <strong>{formatCurrency(calc.netCost)}</strong></div>
                <div>Payback (own funds): <strong>{calc.paybackYears.toFixed(2)} yrs</strong></div>
                <div>Payback (bank loan @7%): <strong>{calc.paybackLoanYears.toFixed(2)} yrs</strong></div>
              </div>
            </div>
          </div>

          <div className="fg" style={{ marginTop: 12 }}>
            <label>Bill of Materials <span style={{ fontSize: '.76rem', color: 'var(--muted)', fontWeight: 400 }}>
              {f.bomSource === 'po' ? 'actual PO details' : 'standard template — replaced by the actual PO / BOM later'}
            </span></label>
            <div className="tw">
              <table style={{ fontSize: '.8rem' }}>
                <thead><tr><th>Material</th><th>Specification</th><th>Qty</th><th>Warranty</th></tr></thead>
                <tbody>{(f.bomItems || []).map((it, i) => (
                  <tr key={`${it.material}-${i}`}>
                    <td>{it.material}</td>
                    <td><input className="fi" style={{ padding: '4px 6px', fontSize: '.78rem' }} value={it.specification}
                      onChange={e => set('bomItems', f.bomItems.map((x, j) => j === i ? { ...x, specification: e.target.value } : x))} /></td>
                    <td style={{ width: 90 }}><input className="fi" style={{ padding: '4px 6px', fontSize: '.78rem' }} value={it.quantity}
                      onChange={e => set('bomItems', f.bomItems.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))} /></td>
                    <td><input className="fi" style={{ padding: '4px 6px', fontSize: '.78rem' }} value={it.warranty}
                      onChange={e => set('bomItems', f.bomItems.map((x, j) => j === i ? { ...x, warranty: e.target.value } : x))} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        </div>
        <div className="mf">
          <button type="button" className="btn bo" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn bp" disabled={busy}>
            {busy ? 'Saving…' : (isRevision ? `Save Revision R${f.revision}` : 'Create & Send for Approval')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
