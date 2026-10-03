// ============================================================================
// BCO Operations — the seven stages a sale goes through after the sale.
//
// One record per lead (collection `bcoOps`), holding each stage's answer,
// note, documents and whether it has been closed. The stages open in order:
// each waits for the one before it — except Subsidy (7), which opens with Net
// Meter Processing (5) as soon as Net Metering Processing (4) is closed, and
// does not wait for 5 or 6.
//
//   1 → 2 → 3 → 4 → 5 → 6
//                   └──→ 7
//
// Documents never block a stage: a stage may be closed with none attached.
// The only things that stop a stage closing are an answer not given, or a
// "NO" without the reason it is "NO".
// ============================================================================

import { hasAccess } from './helpers';
import { normalizeRole, isLeadOwner, isLeadLeader } from './permissions';

export const BCO_STAGES = [
  { key: 's1', no: 1, title: 'Document Collection', kind: 'docs',
    docs: ['Aadhaar', 'PAN', 'Power Bill', 'Mail ID', 'Bank Book'] },
  { key: 's2', no: 2, title: 'Registration', kind: 'yesno' },
  { key: 's3', no: 3, title: 'Loan Process', kind: 'yesno' },
  { key: 's4', no: 4, title: 'Net Metering Processing', kind: 'yesno' },
  { key: 's5', no: 5, title: 'Net Meter Processing', kind: 'yesno' },
  { key: 's6', no: 6, title: 'Flagging', kind: 'plain' },
  { key: 's7', no: 7, title: 'Subsidy Process', kind: 'redeem', answers: ['Redeemed', 'Not Redeemed'] },
];

// Which stage each one waits for.
export const BCO_UNLOCKS_AFTER = { s1: null, s2: 's1', s3: 's2', s4: 's3', s5: 's4', s6: 's5', s7: 's4' };

export const bcoStage = (key) => BCO_STAGES.find(s => s.key === key) || null;

export const emptyBcoOps = (lead) => ({ leadId: lead.id, leadName: lead.name || '', stages: {} });

export const stageData = (ops, key) => (ops && ops.stages && ops.stages[key]) || {};
export const stageDone = (ops, key) => !!stageData(ops, key).done;

export function stageUnlocked(ops, key) {
  const prev = BCO_UNLOCKS_AFTER[key];
  return !prev || stageDone(ops, prev);
}

// The stage this one is waiting on, by name, for the lock message.
export function stageWaitsFor(key) {
  const prev = BCO_UNLOCKS_AFTER[key];
  const s = prev ? bcoStage(prev) : null;
  return s ? `Stage ${s.no} – ${s.title}` : '';
}

// What stops this stage from being closed, or '' when nothing does.
export function stageCloseIssue(stage, data) {
  const d = data || {};
  if (!stage) return 'Unknown stage.';
  if (stage.kind === 'yesno') {
    if (d.answer !== 'YES' && d.answer !== 'NO') return 'Choose YES or NO first.';
    if (d.answer === 'NO' && !String(d.note || '').trim()) return 'A Note with the reason is required when the answer is NO.';
  }
  if (stage.kind === 'redeem') {
    if (!(stage.answers || []).includes(d.answer)) return 'Choose Redeemed or Not Redeemed first.';
  }
  return '';
}

export function bcoProgress(ops) {
  const done = BCO_STAGES.filter(s => stageDone(ops, s.key)).length;
  return { done, total: BCO_STAGES.length };
}

// Who may record and edit: the BCO, with the Operation Manager, Admin,
// Management and the Owner able to edit as well.
export const BCO_EDITOR_ROLES = ['bco', 'operation_manager', 'admin', 'management', 'super_admin'];
export function canEditBco(role) {
  if (role === 'super_admin' || hasAccess(role, 'admin')) return true;
  return BCO_EDITOR_ROLES.includes(normalizeRole(role));
}

// Who may look: the editors, the Sales Manager, and the lead's own people.
export function canViewBco(lead, user, role, users) {
  if (canEditBco(role)) return true;
  if (normalizeRole(role) === 'sales_manager') return true;
  return isLeadOwner(lead, user) || isLeadLeader(lead, user, users);
}
