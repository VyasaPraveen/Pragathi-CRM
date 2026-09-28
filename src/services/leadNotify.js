// ============================================================================
// Who hears about a change to a lead, and what they are told.
//
// A lead used to notify only the person it was assigned to, with the words
// "Lead <name> has been updated" — which said nothing about what had changed or
// who had changed it, and fired just as loudly for a corrected pincode as for a
// reassignment. Worse, when one Executive handed a lead to another, the leader
// and the office never heard about it at all.
//
// So: only changes that matter raise a notification, the message names the
// person who made it and what they changed, and it goes to everyone with a
// stake in the lead — the new owner, the previous owner, their Team Leader and
// the approval line.
// ============================================================================

import { normName } from './helpers';
import { quotationApprovers, leaderOf, normalizeRole } from './permissions';
import { QT_STATUS } from './quotation';

// The fields worth interrupting somebody for. A change to anything not on this
// list — notes, a spelling fix, a pincode — is saved silently, as before.
export const WATCHED_LEAD_FIELDS = [
  { key: 'assignedTo', label: 'Assigned To' },
  { key: 'salesExecutive', label: 'Sales Executive' },
  { key: 'teamLeader', label: 'Team Leader' },
  { key: 'status', label: 'Status' },
  { key: 'priority', label: 'Priority' },
  { key: 'kwRequired', label: 'Capacity (kW)' },
  { key: 'expectedValue', label: 'Expected Value' },
  { key: 'phone', label: 'Phone' },
  { key: 'name', label: 'Customer Name' },
  { key: 'address', label: 'Address' },
  { key: 'expectedSignUpDate', label: 'Expected Sign-up Date' },
  { key: 'nextFollowUpDate', label: 'Next Follow-up' },
  { key: 'supportingTeam', label: 'Supporting Team' },
];

const asText = (v) => {
  if (v == null || v === '') return '';
  if (Array.isArray(v)) return v.filter(Boolean).join(', ');
  return String(v).trim();
};

// What actually changed between two versions of a lead.
export function leadChanges(prev, next) {
  if (!prev || !next) return [];
  return WATCHED_LEAD_FIELDS
    .map(({ key, label }) => ({ key, label, from: asText(prev[key]), to: asText(next[key]) }))
    .filter(c => c.from !== c.to);
}

// "Assigned To: Chandu K → M Yaswanth, Status: Follow-up → Negotiating"
export function changeSummary(changes, limit = 4) {
  const shown = changes.slice(0, limit).map(c =>
    `${c.label}: ${c.from || '(blank)'} → ${c.to || '(blank)'}`);
  const rest = changes.length - shown.length;
  return shown.join(', ') + (rest > 0 ? ` and ${rest} more` : '');
}

// Anything on this lead still waiting on somebody, so the notification can say
// so rather than leaving the reader to go and look.
export function pendingApprovalText(lead, quotations = [], leadPOs = []) {
  const q = (quotations || []).find(x => x.leadId === lead.id && x.status === QT_STATUS.PENDING);
  if (q) return `Quotation ${q.quotationNumber || ''} is awaiting approval`.replace(/\s+/g, ' ').trim();
  const po = (leadPOs || []).find(x => x.leadId === lead.id &&
    ['Unapproved', 'Recommended', 'Management Approved'].includes(x.status));
  if (po) {
    const at = { Unapproved: 'recommendation', Recommended: 'Management approval', 'Management Approved': 'final approval' };
    return `PO ${po.poNumber || ''} is awaiting ${at[po.status]}`.replace(/\s+/g, ' ').trim();
  }
  return '';
}

// The oversight line: Operation Manager, Admin, Management and the Owner.
// Kept as one list so leads, quotations and POs all reach the same people.
export const leadOversight = (users) => quotationApprovers(users);

// Everyone who should hear about this change, as the string createNotification
// addresses people by (display name where there is one, otherwise the email).
// The person who made the change is never told about their own edit.
export function leadNotifyTargets({ lead, prevLead, users, actor, includeOversight = true }) {
  const list = users || [];
  const byKey = (u) => (u && (u.displayName || u.email)) || '';
  const userFor = (nameOrEmail) => {
    const v = normName(nameOrEmail);
    if (!v) return null;
    return list.find(u => normName(u.email) === v || normName(u.displayName) === v) || null;
  };

  const targets = [];
  const push = (v) => { const t = asText(v); if (t) targets.push(t); };

  push(lead.assignedTo);
  push(lead.salesExecutive);
  if (prevLead) { push(prevLead.assignedTo); push(prevLead.salesExecutive); }

  // The Team Leader of whoever now holds the lead — and of whoever held it
  // before, so a lead moving between teams is seen by both.
  [lead.assignedTo, prevLead && prevLead.assignedTo].filter(Boolean).forEach(who => {
    const u = userFor(who);
    const leaderEmail = u ? leaderOf(list, u.email) : '';
    if (leaderEmail) push(byKey(userFor(leaderEmail)) || leaderEmail);
    // A lead may also name its Team Leader directly.
  });
  push(lead.teamLeader);

  if (includeOversight) leadOversight(list).forEach(u => push(byKey(u)));

  const me = normName(actor && (actor.displayName || actor.email));
  const myEmail = normName(actor && actor.email);
  const seen = new Set();
  return targets.filter(t => {
    const k = normName(t);
    if (!k || k === me || k === myEmail || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Is this person one of the Sales Executives the 28-Sep requirement lists? Used
// only to word the message; nothing is gated on it.
export const isSalesExecutive = (users, nameOrEmail) => {
  const v = normName(nameOrEmail);
  const u = (users || []).find(x => normName(x.email) === v || normName(x.displayName) === v);
  return !!u && ['executive', 'bco', 'sales_manager', 'team_leader'].includes(normalizeRole(u.role));
};

// The notification itself: title, message, and who gets it.
// Returns null when nothing worth reporting changed.
export function buildLeadNotice({ lead, prevLead, users, actor, quotations, leadPOs }) {
  const changes = leadChanges(prevLead, lead);
  if (!changes.length) return null;

  const who = (actor && (actor.displayName || actor.email)) || 'Someone';
  const reassigned = changes.find(c => c.key === 'assignedTo');
  const pending = pendingApprovalText(lead, quotations, leadPOs);

  const title = reassigned ? 'Lead Reassigned' : 'Lead Updated';
  const message = [
    `${who} ${reassigned ? 'reassigned' : 'changed'} the lead "${lead.name || ''}"`,
    reassigned
      ? `from ${reassigned.from || '(unassigned)'} to ${reassigned.to || '(unassigned)'}.`
      : `— ${changeSummary(changes)}.`,
    reassigned && changes.length > 1 ? `Also changed: ${changeSummary(changes.filter(c => c.key !== 'assignedTo'))}.` : '',
    `Currently assigned to ${lead.assignedTo || '(nobody)'}.`,
    pending ? `${pending}.` : 'No approval is pending on this lead.',
  ].filter(Boolean).join(' ');

  return {
    title,
    message,
    reassigned: !!reassigned,
    changes,
    targets: leadNotifyTargets({ lead, prevLead, users, actor }),
    assignee: reassigned ? reassigned.to : '',
    previousAssignee: reassigned ? reassigned.from : '',
  };
}
