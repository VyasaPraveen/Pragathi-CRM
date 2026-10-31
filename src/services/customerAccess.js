// ============================================================================
// Who may see and edit a customer, each Customer tab and each workflow stage.
// (Customers batch, 31-Oct)
//
// Three layers, in order:
//   1. The Owner: everything, always, with no locking (Req 1.2, 1.5).
//   2. What the Owner set for the person in Settings → Customer & Workflow
//      Access: 'edit' | 'view' | 'none' per tab and per stage (Req 1.24),
//      kept on the user record as permissions.customerTabs / customerStages.
//   3. The defaults: what each role could do before this batch, plus the Sales
//      Team's access to the customers made from their own leads (Req 1.3, 1.4)
//      and the stage-by-stage rules of Req 1.10–1.22.
//
// The sequential locking (a tab opens once its stage is reached, a stage once
// the one before it is completed) stays for everyone but the Owner and, for the
// tabs, the Admin (Req 1.6, 1.7).
// ============================================================================

import { hasAccess } from './helpers';
import { normalizeRole, canSeeLead, isLeadOwner, isLeadLeader } from './permissions';
import { completedCount } from './workflow';

export const ACCESS = { EDIT: 'edit', VIEW: 'view', NONE: 'none' };
export const ACCESS_LABEL = { edit: 'Edit', view: 'View only', none: 'No access' };

export const CUSTOMER_TABS = [
  { key: 'workflow', label: 'Workflow', icon: 'account_tree', color: '#7c3aed' },
  { key: 'info', label: 'Customer Info', icon: 'person', color: '#3b82f6' },
  { key: 'payment', label: 'Payment', icon: 'payments', color: '#10b981' },
  { key: 'dispatch', label: 'Dispatch', icon: 'local_shipping', color: '#f59e0b' },
  { key: 'installation', label: 'Installation', icon: 'construction', color: '#8b5cf6' },
  { key: 'quality', label: 'Quality Inspection', icon: 'fact_check', color: '#06b6d4' },
  { key: 'warranty', label: 'Warranty', icon: 'verified_user', color: '#059669' },
  { key: 'subsidy', label: 'Subsidy', icon: 'savings', color: '#d97706' },
  { key: 'sync', label: 'Sync & Flag', icon: 'sync', color: '#6366f1' },
  { key: 'firstbill', label: 'First Bill', icon: 'receipt', color: '#f43f5e' },
  { key: 'om', label: 'O&M', icon: 'build_circle', color: '#14b8a6' },
];

// When each tab opens: the number of workflow stages that must be completed
// (Req 1.7). Workflow, Customer Info and Payment are open from the start;
// Dispatch after the 90% payment condition (Stage 7); Installation and Sync &
// Flag after the dispatch (Stage 8); Warranty after that; Subsidy after the
// Warranty; First Bill after the Subsidy; O&M after the First Bill. Quality
// Inspection keeps the condition it had.
export const TAB_MIN_STAGE = {
  workflow: 0, info: 0, payment: 0,
  dispatch: 7, installation: 8, sync: 8, quality: 9, warranty: 9,
  subsidy: 10, firstbill: 14, om: 15,
};

export const isOwnerRole = (role) => role === 'super_admin';

// The Owner and the Admin open every tab, whatever stage the customer is at (Req 1.2).
export const tabsUnrestricted = (role) => isOwnerRole(role) || hasAccess(normalizeRole(role), 'admin');

// Does the sequence lock this tab for this person right now?
export function tabLocked(key, customer, role, gatingOn = true) {
  if (tabsUnrestricted(role)) return false;
  if (!gatingOn) return false;
  return completedCount(customer || {}) < (TAB_MIN_STAGE[key] || 0);
}

const lc = (v) => String(v || '').trim().toLowerCase();
const isMine = (v, user) => {
  const s = lc(v);
  return !!s && (s === lc(user?.email) || s === lc(user?.displayName));
};

// Is this person the customer's own sales contact: the lead is theirs (or
// their member's), or the customer is assigned to them?
export function isSalesContact(customer, lead, user, users) {
  if (!user) return false;
  if (lead && (isLeadOwner(lead, user) || isLeadLeader(lead, user, users))) return true;
  return isMine(customer?.assignedTo, user) || isMine(customer?.salesExecutive, user);
}

// What the Owner allows the lead's assigned person on its customer: 'edit'
// (the default), 'view' or 'none' (Req 1.24 D). A company-wide setting.
export const assignedLeadAccess = (settings) => {
  const v = settings && settings.assignedLeadAccess;
  return v === 'view' || v === 'none' ? v : 'edit';
};

// Who may see this customer at all (Req 1.4). The coordinator level and up
// (BCO, Accountant, Team Leaders, the managers, Admin, Management, the Owner)
// see every customer, as they always did. A Sales Executive, a Technician, or
// anyone below sees the customers of their own leads, the ones assigned to
// them, and the ones they recorded.
export function canSeeCustomer(customer, lead, user, role, users, team, settings) {
  if (!customer) return false;
  const r = normalizeRole(role);
  if (isOwnerRole(r) || hasAccess(r, 'coordinator')) return true;
  if (isMine(customer.createdBy, user) || isMine(customer.assignedTo, user)) return true;
  if (assignedLeadAccess(settings) === 'none') return false;
  if (lead && canSeeLead(lead, user, r, users, team, [])) return true;
  return false;
}

// Who may edit the customer's details: the coordinator level and up, as
// before; and the customer's own sales contact when the Owner allows it.
export function canEditCustomer(customer, lead, user, role, users, settings) {
  const r = normalizeRole(role);
  if (isOwnerRole(r) || hasAccess(r, 'coordinator')) return true;
  return assignedLeadAccess(settings) === 'edit' && isSalesContact(customer, lead, user, users);
}

const explicit = (user, bag, key) => {
  const v = user && user.permissions && user.permissions[bag] && user.permissions[bag][key];
  return v === 'edit' || v === 'view' || v === 'none' ? v : null;
};
export const explicitTabAccess = (user, key) => explicit(user, 'customerTabs', key);
export const explicitStageAccess = (user, key) => explicit(user, 'customerStages', key);

// 'edit' | 'view' | 'none' for one Customer tab.
export function tabAccess(key, { customer, lead, user, role, users, settings }) {
  if (isOwnerRole(role)) return ACCESS.EDIT;
  const set = explicitTabAccess(user, key);
  if (set) return set;
  return canEditCustomer(customer, lead, user, role, users, settings) ? ACCESS.EDIT : ACCESS.VIEW;
}

// ── the stages ──────────────────────────────────────────────────────────────
// Who edits each stage by default. 'sales' stands for the customer's own
// sales contact (Req 1.3 names the five: the four executives and the Sales
// Manager, through the leads assigned to them). The Owner, Management, Admin
// and the Operation Manager edit everything; the coordinator level keeps the
// access it had, except on the strict stages, where only the roles listed may
// edit (Req 1.16: the Sales Team is view-only on DISCOM Followup).
const AUTHORITY_ROLES = ['super_admin', 'management', 'admin', 'operation_manager'];
export const STAGE_EDITORS = {
  advance: ['sales'],
  installation: ['sales', 'bco'],
  completionReports: ['sales', 'bco', 'accountant'],
  discom: ['bco', 'accountant', 'operation_manager', 'admin', 'management', 'super_admin'],
  demo: ['sales', 'bco'],
  customerCare: ['sales', 'bco'],
  cleaning: ['sales', 'bco'],
  review: ['sales', 'bco'],
  finalReview: ['sales', 'bco'],
};
const STRICT_STAGES = ['discom'];

export function defaultStageEdit(stageKey, { customer, lead, user, role, users, settings }) {
  const r = normalizeRole(role);
  if (isOwnerRole(r) || AUTHORITY_ROLES.includes(r)) return true;
  const list = STAGE_EDITORS[stageKey] || [];
  if (STRICT_STAGES.includes(stageKey)) return list.includes(r);
  if (hasAccess(r, 'coordinator')) return true;
  if (list.includes(r)) return true;
  if (list.includes('sales') && assignedLeadAccess(settings) === 'edit' && isSalesContact(customer, lead, user, users)) return true;
  return false;
}

// 'edit' | 'view' | 'none' for one workflow stage.
export function stageAccess(stageKey, ctx) {
  if (isOwnerRole(ctx.role)) return ACCESS.EDIT;
  const set = explicitStageAccess(ctx.user, stageKey);
  if (set) return set;
  return defaultStageEdit(stageKey, ctx) ? ACCESS.EDIT : ACCESS.VIEW;
}

// The Owner alone is free of the stage sequence (Req 1.5, 1.6).
export const stagesUnrestricted = (role) => isOwnerRole(role);
