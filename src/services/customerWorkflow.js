// ============================================================================
// The customer's 18-stage workflow, filled in by the other modules (31-Oct).
//
// Several stages are no longer typed in twice. Each has one source of truth
// and the data flows ONE way, from the source into the customer's stage:
//
//   Stage 5  Registration           ← BCO Operations, Stage 2 (Registration)
//   Stage 6  Collect the Advance    ← the lead's Advance Received
//   Stage 7  Material Request       ← the Payment tab: 90% of the agreed price,
//                                     once a purchase order is approved
//   Stage 8  Delivery Approvals     ← the Operation Manager's Confirm Dispatch
//   Stage 9  Team Allotment         ← Installations → New Installation
//   Stage 12 DISCOM Followup        ← BCO Operations, Stage 5 (Net Meter Processing)
//   Stage 13 Final Payment          ← the Payment tab: the full agreed price
//
// Everything here is pure: given the records, it says what the customer's
// workflow should now hold. customerSync.js does the writing.
// ============================================================================

import { toNumber, todayStr } from './helpers';
import { WORKFLOW_STAGES, withStage, listValue } from './workflow';

// The share of the agreed price that releases the material (Req 1.11).
export const RELEASE_PERCENT = 0.9;

const digits = (v) => String(v || '').replace(/\D/g, '');
const norm = (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
const samePhone = (a, b) => {
  const x = digits(a).slice(-10), y = digits(b).slice(-10);
  return x.length === 10 && x === y;
};
const sameName = (a, b) => !!norm(a) && norm(a) === norm(b);
const dayOf = (iso) => (iso ? String(iso).slice(0, 10) : '');

/* ── the Payment tab ──────────────────────────────────────────────────────── */

// What the customer has paid, as the Payment tab adds it up.
export function paidTotal(c) {
  if (!c) return 0;
  return c.paymentType === 'Finance'
    ? toNumber(c.advanceReceivedAmount) + toNumber(c.finalAmount)
    : toNumber(c.advanceAmount) + toNumber(c.secondPayment) + toNumber(c.thirdPayment) + toNumber(c.finalPayment);
}

// The agreed price the payments are measured against. The Agreed Price field
// first; a customer without one is measured against the Total Price.
export function agreedTotal(c) {
  if (!c) return 0;
  return toNumber(c.agreedPrice) || toNumber(c.totalPrice) || toNumber(c.quotationProjectValue) || 0;
}

export function paymentProgress(c) {
  const paid = paidTotal(c);
  const agreed = agreedTotal(c);
  const percent = agreed > 0 ? Math.round((paid / agreed) * 100) : 0;
  return {
    paid, agreed, percent,
    releaseReached: agreed > 0 && paid + 0.005 >= agreed * RELEASE_PERCENT,
    fullyPaid: agreed > 0 && paid + 0.005 >= agreed,
  };
}

/* ── which customer a record belongs to ───────────────────────────────────── */

// The customer made from a lead: by the link, else by the phone and name the
// lead carried (older customers were made without the link).
export function customerOfLead(customers, lead) {
  if (!lead) return null;
  const list = customers || [];
  const byId = lead.id && list.find(c => c.leadId === lead.id);
  if (byId) return byId;
  return list.find(c => samePhone(c.phone, lead.phone) && sameName(c.name, lead.name))
    || list.find(c => samePhone(c.phone, lead.phone))
    || null;
}

// The customer behind a lead PO: through its lead, else the name and phone on it.
export function customerOfPo(customers, leads, po) {
  if (!po) return null;
  const lead = po.leadId ? (leads || []).find(l => l.id === po.leadId) : null;
  const viaLead = lead ? customerOfLead(customers, lead) : null;
  if (viaLead) return viaLead;
  const list = customers || [];
  return list.find(c => c.leadId && c.leadId === po.leadId)
    || list.find(c => samePhone(c.phone, po.customerPhone) && sameName(c.name, po.customerName))
    || null;
}

// The customer an installation is for: the link, else the phone, else the exact name.
export function customerOfInstallation(customers, inst) {
  if (!inst) return null;
  const list = customers || [];
  const byId = inst.customerId && list.find(c => c.id === inst.customerId);
  if (byId) return byId;
  const byLead = inst.leadId && list.find(c => c.leadId === inst.leadId);
  if (byLead) return byLead;
  return list.find(c => samePhone(c.phone, inst.phone) && sameName(c.name, inst.customerName))
    || list.find(c => samePhone(c.phone, inst.phone))
    || list.find(c => sameName(c.name, inst.customerName))
    || null;
}

// The purchase orders on a customer, approved ones first.
export function posOfCustomer(customer, leads, leadPOs) {
  if (!customer) return [];
  const lead = customer.leadId ? (leads || []).find(l => l.id === customer.leadId) : null;
  return (leadPOs || []).filter(po =>
    (customer.leadId && po.leadId === customer.leadId)
    || (lead && po.leadId === lead.id)
    || (samePhone(po.customerPhone, customer.phone) && sameName(po.customerName, customer.name)))
    .sort((a, b) => (b.status === 'Approved') - (a.status === 'Approved'));
}

export const approvedPoOf = (pos) => (pos || []).find(p => p.status === 'Approved') || null;

/* ── what each source puts on its stage ───────────────────────────────────── */

// BCO Operations Stage 2 → Registration (Stage 5).
export function registrationFromBco(stage) {
  if (!stage) return null;
  const f = stage.fields || {};
  return {
    fields: {
      regType: f.regType || '', regNumber: f.regNumber || '', regDate: f.regDate || '',
      bankName: f.bankName || '', bankNumber: f.bankNumber || '', loanDocsDate: f.loanDocsDate || '',
      docs: Array.isArray(stage.docs) ? stage.docs : [],
      note: stage.note || '',
      bcoAnswer: stage.answer || '',
    },
    complete: !!stage.done && stage.answer === 'YES',
  };
}

// BCO Operations Stage 5 → DISCOM Followup (Stage 12).
export function discomFromBco(stage) {
  if (!stage) return null;
  const f = stage.fields || {};
  return {
    fields: {
      discomSubmitted: f.discomSubmitted === true || f.discomSubmitted === 'YES',
      gridSyncStatus: f.gridSyncStatus || '',
      meterChangeStatus: f.meterChangeStatus || '',
      docs: Array.isArray(stage.docs) ? stage.docs : [],
      note: stage.note || '',
      bcoAnswer: stage.answer || '',
    },
    complete: !!stage.done && stage.answer === 'YES',
  };
}

const ADVANCE_MODES = ['Cash', 'Bank Transfer', 'UPI', 'Cheque'];

// The lead's Advance Received → Collect the Advance (Stage 6). Nothing when
// no advance is recorded on the lead.
export function advanceFromLead(lead) {
  if (!lead || lead.advancePaid !== 'Yes') return null;
  const amount = toNumber(lead.advanceLeadAmount);
  if (amount <= 0) return null;
  const rawMode = String(lead.advanceLeadMode || lead.modeOfPayment || '').trim();
  const mode = !rawMode ? '' : (ADVANCE_MODES.find(m => m.toLowerCase() === rawMode.toLowerCase()) || 'Other');
  return {
    fields: { advanceAmount: amount, advanceDate: lead.advanceLeadDate || dayOf(lead.advancePaidAt) || '', advanceMode: mode, advanceModeNote: rawMode === 'Other' ? (lead.modeOfPaymentOther || '') : '' },
    complete: true,
  };
}

// The Payment tab → Material Delivery Request (Stage 7): 90% of the agreed
// price received and a purchase order approved. Nothing until both hold.
export function materialRequestFromPayment(customer, approvedPo) {
  if (!customer || !approvedPo || approvedPo.status !== 'Approved') return null;
  const p = paymentProgress(customer);
  if (!p.releaseReached) return null;
  return {
    fields: {
      paymentStage: '90% Payment Received',
      materialRequestDate: dayOf(approvedPo.approvalDate || approvedPo.updatedAt) || todayStr(),
      paidAmount: p.paid, agreedAmount: p.agreed, paidPercent: p.percent,
    },
    complete: true,
  };
}

// The Operation Manager's Confirm Dispatch → Material Delivery Approvals (Stage 8).
export function deliveryFromDispatch(po) {
  if (!po || !po.dispatchConfirmedAt) return null;
  return {
    fields: {
      dcNumber: po.dcNumber || po.challanNumber || po.poNumber || '',
      managerApproved: true,
      finalDcSubmitted: true,
      dispatchConfirmedAt: po.dispatchConfirmedAt,
      dispatchConfirmedBy: po.dispatchConfirmedBy || '',
      poNumber: po.poNumber || '',
    },
    complete: true,
  };
}

// New Installation → Installation Team Allotment (Stage 9). Nothing until a
// Team Leader is named.
export function allotmentFromInstallation(inst) {
  if (!inst || !String(inst.teamLeader || '').trim()) return null;
  const members = listValue(inst.teamMembers);
  return {
    fields: {
      teamLeader: String(inst.teamLeader).trim(),
      teamSize: toNumber(inst.numPeople) || members.length || '',
      teamMembers: members,
      allotmentDate: dayOf(inst.allottedAt || inst.createdAt) || todayStr(),
      finalDcChecked: true,
      installationId: inst.id || '',
    },
    complete: true,
  };
}

// The Payment tab → Final Payment Collection (Stage 13): the FULL agreed
// price. A part payment never completes it.
export function finalPaymentFromPayment(customer) {
  if (!customer) return null;
  const p = paymentProgress(customer);
  if (!p.fullyPaid) return null;
  return {
    fields: {
      finalPaymentAmount: p.paid,
      finalPaymentDate: customer.finalPaymentDate || customer.finalAmountDate || todayStr(),
      balanceCleared: true,
    },
    complete: true,
  };
}

/* ── putting it on the customer ───────────────────────────────────────────── */

// The stage record after an automation has written to it. What was already on
// the stage stays (a photo someone added by hand, a note); the source's fields
// go on top; a tick already given is never taken away.
export function autoRecord(customer, key, update, source, by) {
  const prev = ((customer && customer.workflow && customer.workflow.stages) || {})[key] || {};
  const now = new Date().toISOString();
  const rec = { ...prev, ...update.fields, syncedFrom: source, syncedAt: now, updatedAt: now };
  if (update.complete) {
    rec.status = 'completed';
    rec.completedAt = prev.status === 'completed' && prev.completedAt ? prev.completedAt : now;
    rec.completedBy = prev.status === 'completed' && prev.completedBy ? prev.completedBy : (by ? `${by} (${source})` : source);
    delete rec.reopenedAt; delete rec.reopenedBy;
  } else if (prev.status !== 'completed') {
    rec.status = prev.status || 'in_progress';
  }
  return rec;
}

const VOLATILE = ['syncedAt', 'updatedAt', 'completedAt'];
const stable = (rec) => {
  const out = {};
  Object.keys(rec || {}).sort().forEach(k => { if (!VOLATILE.includes(k)) out[k] = rec[k]; });
  return JSON.stringify(out);
};

// Apply a list of stage updates ({ key, update, source, by }) to the customer.
// Returns { workflow } when something actually changed, else null — so a save
// that changes nothing writes nothing (and no two clients ping-pong).
export function applyAutomation(customer, updates) {
  let cur = customer || {};
  let changed = false;
  (updates || []).forEach(u => {
    if (!u || !u.update) return;
    const prev = ((cur.workflow && cur.workflow.stages) || {})[u.key] || {};
    const rec = autoRecord(cur, u.key, u.update, u.source, u.by);
    if (stable(prev) === stable(rec)) return;
    cur = { ...cur, workflow: withStage(cur, u.key, rec) };
    changed = true;
  });
  return changed ? { workflow: cur.workflow } : null;
}

// Every automatic stage the sources justify for this customer right now.
// Pass whatever is at hand; a missing source simply contributes nothing.
export function customerAutoStages(customer, { lead, bco, pos, installation, by } = {}) {
  const out = [];
  const push = (key, update, source) => { if (update) out.push({ key, update, source, by }); };
  const bcoStage = (k) => (bco && bco.stages && bco.stages[k]) || null;
  push('registration', registrationFromBco(bcoStage('s2')), 'BCO Operations');
  push('discom', discomFromBco(bcoStage('s5')), 'BCO Operations');
  push('advance', advanceFromLead(lead), 'Leads');
  const approved = approvedPoOf(pos);
  push('materialRequest', materialRequestFromPayment(customer, approved), 'Payment tab');
  const confirmed = (pos || []).find(p => p.dispatchConfirmedAt) || null;
  push('deliveryApproval', deliveryFromDispatch(confirmed), 'Confirm Dispatch');
  push('teamAllotment', allotmentFromInstallation(installation), 'Installations');
  push('finalPayment', finalPaymentFromPayment(customer), 'Payment tab');
  return out;
}

// The workflow a brand-new customer starts with, from what the lead and the
// BCO already recorded before the conversion (Req 1.8–1.10, 1.16).
export function newCustomerWorkflow(customerFields, { lead, bco, by } = {}) {
  const seed = { ...(customerFields || {}), workflow: { stages: {} } };
  const patch = applyAutomation(seed, customerAutoStages(seed, { lead, bco, by }));
  return patch ? patch.workflow : { stages: {}, currentStage: WORKFLOW_STAGES.find(s => !s.auto).sno };
}

// A short line on where a stage's data came from, for the stage card.
export function stageSourceNote(stageData) {
  if (!stageData || !stageData.syncedFrom) return '';
  return `Filled in from ${stageData.syncedFrom}`;
}
