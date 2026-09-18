// ============================================================================
// Pragathi CRM — Role-Based Access Control (RBAC)
// 9 business roles, each with a separate login, gated per the official
// permission matrix. `super_admin` (the owner account) always has full access.
// This layer is additive: the legacy hierarchy in helpers.js (hasAccess) still
// works for generic module gating; this file governs the specific workflow
// ACTIONS (lead entry, PO record/recommend/approve, expenditure chain, etc.).
// ============================================================================

import { hasAccess } from './helpers';

// The 9 canonical roles (order = display order in dropdowns)
export const ROLES = [
  { key: 'executive', label: 'Executive' },
  { key: 'technical_manager', label: 'Technical Manager' },
  { key: 'operation_manager', label: 'Operation Manager' },
  { key: 'accountant', label: 'Accountant' },
  { key: 'admin', label: 'Admin' },
  { key: 'management', label: 'Management' },
  { key: 'bco', label: 'BCO' },
  { key: 'technician', label: 'Technician' },
  { key: 'team_leader', label: 'Team Leader' },
  { key: 'sales_manager', label: 'Sales Manager' },
  { key: 'warehouse_admin', label: 'Warehouse Admin' },
];

export const ALL_ROLE_KEYS = ROLES.map(r => r.key);

export const roleLabel = (key) => {
  if (key === 'super_admin') return 'Super Admin';
  const found = ROLES.find(r => r.key === key);
  return found ? found.label : (key || '');
};

// ── Permission matrix: action → roles allowed ──────────────────────────────
// Keep keys stable — they are referenced from the UI gating code.
export const ACTIONS = {
  LEAD_ENTRY: 'lead_entry',
  SITE_VISIT: 'site_visit',
  PO_RECORD: 'po_record',
  PO_RECOMMENDATION: 'po_recommendation',
  PO_MANAGEMENT_APPROVAL: 'po_management_approval', // mandatory pre-approval step
  PO_APPROVAL: 'po_approval',
  EXPENDITURE_REQUEST: 'expenditure_request',
  EXPENDITURE_RECOMMENDATION: 'expenditure_recommendation',
  EXPENDITURE_VERIFIED: 'expenditure_verified',
  EXPENDITURE_APPROVE: 'expenditure_approve',
  PAYMENT_RELEASE: 'payment_release',
  // Payment Request chain (Team Member → Team Leader → Admin/Management/
  // Operation Manager → Accountant → Work Proposal / Pre-PO → Admin/Mgmt/OM)
  PR_CREATE: 'pr_create',
  PR_RECOMMEND: 'pr_recommend',
  PR_APPROVE: 'pr_approve',
  PR_TRANSFER: 'pr_transfer',
  PR_PROPOSAL: 'pr_proposal',
  PR_PROPOSAL_APPROVE: 'pr_proposal_approve',
};

export const ACTION_ROLES = {
  [ACTIONS.LEAD_ENTRY]: [...ALL_ROLE_KEYS], // all 1–9
  [ACTIONS.SITE_VISIT]: ['executive', 'technical_manager'],
  // Sales Manager may add a PO directly (req: "Add PO option for Sales Manager")
  [ACTIONS.PO_RECORD]: ['operation_manager', 'admin', 'warehouse_admin', 'sales_manager'],
  [ACTIONS.PO_RECOMMENDATION]: ['operation_manager', 'admin'],
  // Management permission is mandatory before a PO can be approved
  [ACTIONS.PO_MANAGEMENT_APPROVAL]: ['management'],
  [ACTIONS.PO_APPROVAL]: ['admin', 'management'],
  [ACTIONS.EXPENDITURE_REQUEST]: [...ALL_ROLE_KEYS], // anyone may raise a request
  // Approval/payment chain (req #12): requester → concerned approval (Recommend)
  // → Accountant review → Management/Owner final approval → back to Accountant to
  // release payment. super_admin (Owner) always overrides via can().
  [ACTIONS.EXPENDITURE_RECOMMENDATION]: ['technical_manager', 'operation_manager', 'sales_manager'],
  [ACTIONS.EXPENDITURE_VERIFIED]: ['accountant'],   // Accountant review step
  [ACTIONS.EXPENDITURE_APPROVE]: ['management'],     // Management/Owner final approval
  [ACTIONS.PAYMENT_RELEASE]: ['accountant'],         // Accountant releases the payment
  // Payment Request chain
  [ACTIONS.PR_CREATE]: [...ALL_ROLE_KEYS],                                   // any team member
  // The requester's own Team Leader recommends (see prRecommenders); these
  // roles stand in for staff who have no Team Leader assigned.
  [ACTIONS.PR_RECOMMEND]: ['team_leader', 'technical_manager', 'operation_manager', 'sales_manager'],
  [ACTIONS.PR_APPROVE]: ['admin', 'management', 'operation_manager'],        // main approval
  [ACTIONS.PR_TRANSFER]: ['accountant'],                                     // payment transfer
  [ACTIONS.PR_PROPOSAL]: ['accountant'],                                     // Work Proposal / Pre-PO
  [ACTIONS.PR_PROPOSAL_APPROVE]: ['admin', 'management', 'operation_manager'],
};

// Legacy role keys (from before the 9-role system) → nearest new role, so
// existing user accounts keep working until an admin reassigns them one of the
// 9 official roles. New accounts use the canonical keys directly.
const LEGACY_ROLE_MAP = {
  manager: 'operation_manager',
  coordinator: 'bco',
  engineer: 'technician',
  staff: 'executive',
};

export function normalizeRole(role) {
  return LEGACY_ROLE_MAP[role] || role;
}

// Can the given role perform the given action?
export function can(role, action) {
  if (role === 'super_admin') return true; // owner override
  const r = normalizeRole(role);
  const allowed = ACTION_ROLES[action];
  return Array.isArray(allowed) && allowed.includes(r);
}

// ── PO approval workflow states (lead-sourced POs) ─────────────────────────
export const PO_STATUS = {
  UNAPPROVED: 'Unapproved',
  RECOMMENDED: 'Recommended',
  MANAGEMENT_APPROVED: 'Management Approved',
  APPROVED: 'Approved',
};

// Required advance before a PO can be sent for approval ("to Sir"): 10%
export const ADVANCE_PERCENT = 0.10;

// The cost basis a PO's 10% advance is measured against.
export function poCostBasis(po) {
  const n = Number(po?.agreedPrice) || Number(po?.totalValue) || 0;
  return isNaN(n) ? 0 : n;
}

// How much advance has been recorded for this PO's lead.
export function recordedAdvance(lead) {
  if (!lead) return 0;
  if (lead.advancePaid !== 'Yes') return 0;
  const n = Number(lead.advanceLeadAmount);
  return isNaN(n) ? 0 : n;
}

// Is the mandatory 10% advance recorded for this PO? Returns a detail object.
export function advanceGate(po, lead) {
  const cost = poCostBasis(po);
  const required = Math.round(cost * ADVANCE_PERCENT);
  const paid = recordedAdvance(lead);
  return {
    cost,
    required,
    paid,
    // Until a cost (agreed price / total value) is set, the 10% requirement can't
    // be verified, so the PO is not yet allowed to move for approval.
    ok: cost <= 0 ? false : paid >= required,
  };
}

// ── Expenditure approval workflow states ───────────────────────────────────
export const EXP_STATUS = {
  REQUESTED: 'Requested',
  RECOMMENDED: 'Recommended',
  VERIFIED: 'Verified',
  APPROVED: 'Approved',
  RELEASED: 'Released',
  REJECTED: 'Rejected',
};

// Ordered stages of the expenditure chain, each with its gating action.
export const EXP_STAGES = [
  { from: EXP_STATUS.REQUESTED, to: EXP_STATUS.RECOMMENDED, action: ACTIONS.EXPENDITURE_RECOMMENDATION, label: 'Recommend', field: 'recommendedBy' },
  { from: EXP_STATUS.RECOMMENDED, to: EXP_STATUS.VERIFIED, action: ACTIONS.EXPENDITURE_VERIFIED, label: 'Accountant Review', field: 'verifiedBy' },
  { from: EXP_STATUS.VERIFIED, to: EXP_STATUS.APPROVED, action: ACTIONS.EXPENDITURE_APPROVE, label: 'Management Approval', field: 'approvedBy' },
  { from: EXP_STATUS.APPROVED, to: EXP_STATUS.RELEASED, action: ACTIONS.PAYMENT_RELEASE, label: 'Release Payment', field: 'releasedBy' },
];

export const nextExpStage = (status) => EXP_STAGES.find(s => s.from === status) || null;

// ── Payment Request workflow ───────────────────────────────────────────────
// Team Member → Generate Payment Request → Team Leader (Recommend) → Admin /
// Management / Operation Manager (Main Approval) → Accountant (Payment
// Transfer) → Accountant (one-shot Work Proposal / Pre-PO) → Admin /
// Management / Operation Manager (final sign-off). A stage can only be taken
// from the stage immediately before it, so nothing can be skipped.
export const PR_STATUS = {
  REQUESTED: 'Requested',
  RECOMMENDED: 'Recommended',
  APPROVED: 'Approved',
  PAID: 'Paid',
  PROPOSAL_SUBMITTED: 'Proposal Submitted',
  CLOSED: 'Closed',
  REJECTED: 'Rejected',
};

export const PR_STAGES = [
  { from: PR_STATUS.REQUESTED, to: PR_STATUS.RECOMMENDED, action: ACTIONS.PR_RECOMMEND, label: 'Recommend', by: 'Team Leader', field: 'recommendedBy' },
  { from: PR_STATUS.RECOMMENDED, to: PR_STATUS.APPROVED, action: ACTIONS.PR_APPROVE, label: 'Main Approval', by: 'Admin / Management / Operation Manager', field: 'approvedBy' },
  { from: PR_STATUS.APPROVED, to: PR_STATUS.PAID, action: ACTIONS.PR_TRANSFER, label: 'Payment Transfer', by: 'Accountant', field: 'paidBy' },
  { from: PR_STATUS.PAID, to: PR_STATUS.PROPOSAL_SUBMITTED, action: ACTIONS.PR_PROPOSAL, label: 'Work Proposal / Pre-PO', by: 'Accountant', field: 'proposalBy' },
  { from: PR_STATUS.PROPOSAL_SUBMITTED, to: PR_STATUS.CLOSED, action: ACTIONS.PR_PROPOSAL_APPROVE, label: 'Approve Proposal & Close', by: 'Admin / Management / Operation Manager', field: 'closedBy' },
];

// The next stage for a request. When the requester has no Team Leader to
// recommend it (they are a Team Leader themselves, or none is assigned), the
// recommendation step is skipped and it goes straight for final approval.
export function nextPrStage(status, pr) {
  const from = status || PR_STATUS.REQUESTED;
  if (pr && pr.needsRecommendation === false && from === PR_STATUS.REQUESTED) {
    const approve = PR_STAGES.find(s => s.to === PR_STATUS.APPROVED);
    return approve ? { ...approve, from: PR_STATUS.REQUESTED } : null;
  }
  return PR_STAGES.find(s => s.from === from) || null;
}

// ── Team Leader → Team Member structure ─────────────────────────────────
// A member's user record carries `teamLeader` (their leader's email). A Team
// Leader is anyone who has members pointing at them, which keeps the structure
// in one place instead of duplicating it on both sides.
export const teamMembersOf = (users, leaderEmail) => {
  const key = String(leaderEmail || '').toLowerCase();
  if (!key) return [];
  return (users || []).filter(u => String(u.teamLeader || '').toLowerCase() === key);
};

export const isTeamLeader = (users, email) => teamMembersOf(users, email).length > 0;

// The leader who should recommend this person's requests, if any.
export const leaderOf = (users, email) => {
  const me = (users || []).find(u => String(u.email || '').toLowerCase() === String(email || '').toLowerCase());
  return me && me.teamLeader ? String(me.teamLeader).toLowerCase() : '';
};

// Nobody may recommend or approve their own payment request.
export const isOwnRequest = (pr, user) => {
  if (!pr || !user) return false;
  const email = String(user.email || '').toLowerCase();
  return String(pr.requestedBy || '').toLowerCase() === email;
};

// May this user take the given stage on this request?
export function canTakePrStage(stage, pr, user, role) {
  if (!stage || !pr) return false;
  if (pr.status === PR_STATUS.REJECTED) return false;
  if (isOwnRequest(pr, user)) return false; // never your own request
  if (stage.to === PR_STATUS.RECOMMENDED) {
    // Their own Team Leader recommends. A Team Leader has no say over another
    // leader's members, so only the managers below can stand in.
    const mine = !!pr.teamLeaderEmail &&
      String(pr.teamLeaderEmail).toLowerCase() === String(user?.email || '').toLowerCase();
    if (mine) return true;
    if (normalizeRole(role) === 'team_leader') return false;
    return can(role, ACTIONS.PR_RECOMMEND);
  }
  return can(role, stage.action);
}

// A plain-English trail of what has happened and what the request is waiting on
// — the requester must always be able to see where it is stopped.
export function prProgress(pr) {
  const done = [];
  if (pr.recommendedBy) done.push({ label: 'Recommended', by: pr.recommendedBy, date: pr.recommendedByDate });
  if (pr.approvedBy) done.push({ label: 'Approved', by: pr.approvedBy, date: pr.approvedByDate });
  if (pr.paidBy) done.push({ label: 'Payment transferred', by: pr.paidBy, date: pr.paidByDate });
  if (pr.proposalBy) done.push({ label: 'Work Proposal / Pre-PO sent', by: pr.proposalBy, date: pr.proposalByDate });
  if (pr.closedBy) done.push({ label: 'Closed', by: pr.closedBy, date: pr.closedByDate });
  if (pr.status === PR_STATUS.REJECTED) {
    return { done, waitingOn: null, rejected: true, rejectedBy: pr.rejectedBy, summary: `Rejected by ${pr.rejectedBy || 'a reviewer'}` };
  }
  const stage = nextPrStage(pr.status, pr);
  const waitingOn = stage
    ? (stage.to === PR_STATUS.RECOMMENDED && pr.teamLeaderName ? `${stage.by} (${pr.teamLeaderName})` : stage.by)
    : null;
  return {
    done,
    waitingOn,
    rejected: false,
    summary: stage ? `Pending ${stage.label.toLowerCase()} with ${waitingOn}` : 'Completed — no action pending',
  };
}

// ── Per-user module / action permissions (Admin-controlled) ────────────────
// Settings → Permission Management saves a { key: true|false } map on the user
// record. A key that is ABSENT falls back to the role default below, so every
// existing account keeps exactly the access it has today. Admin and above are
// never restricted, so an Admin cannot lock themselves out of the app.
export const PERMISSION_MODULES = [
  { key: 'dashboard', label: 'Dashboard', icon: 'dashboard', group: 'Main' },
  { key: 'leads', label: 'Leads', icon: 'leaderboard', group: 'Main' },
  { key: 'customers', label: 'Customers', icon: 'people', group: 'Main' },
  { key: 'tasks', label: 'Tasks', icon: 'task_alt', group: 'Main' },
  { key: 'my_reports', label: 'My Reports & Planning', icon: 'insights', group: 'Main' },

  { key: 'installations', label: 'Installations', icon: 'solar_power', group: 'Operations' },
  { key: 'ongoing_work', label: 'Ongoing Work', icon: 'construction', group: 'Operations' },
  { key: 'materials', label: 'Materials', icon: 'inventory_2', group: 'Operations' },
  { key: 'purchase_orders', label: 'Purchase Orders', icon: 'receipt_long', group: 'Operations' },
  { key: 'new_po', label: 'New PO (create a PO)', icon: 'post_add', group: 'Operations', action: true },

  { key: 'revenue', label: 'Revenue', icon: 'account_balance_wallet', group: 'Finance' },
  { key: 'expenditure', label: 'Expenditure', icon: 'payments', group: 'Finance' },
  { key: 'payment_requests', label: 'Payment Requests', icon: 'request_quote', group: 'Finance' },
  { key: 'reports', label: 'Reports', icon: 'assessment', group: 'Finance' },

  { key: 'team', label: 'Team', icon: 'groups', group: 'People' },
  { key: 'team_members', label: 'My Team — member list', icon: 'supervisor_account', group: 'Team' },
  { key: 'team_attendance', label: 'My Team — attendance', icon: 'how_to_reg', group: 'Team' },
  { key: 'team_tracking', label: 'My Team — tracking', icon: 'schedule', group: 'Team' },
  { key: 'team_tasks', label: 'My Team — tasks', icon: 'task_alt', group: 'Team' },
  { key: 'team_leave', label: 'My Team — leave', icon: 'event_available', group: 'Team' },
  { key: 'attendance', label: 'Attendance', icon: 'how_to_reg', group: 'People' },
  { key: 'tracking', label: 'Tracking', icon: 'schedule', group: 'People' },
  { key: 'leave', label: 'Leave', icon: 'event_available', group: 'People' },
  { key: 'reminders', label: 'Reminders', icon: 'notifications_active', group: 'People' },
  { key: 'retailers', label: 'Retailers', icon: 'storefront', group: 'People' },
  { key: 'influencers', label: 'Influencers', icon: 'campaign', group: 'People' },

  { key: 'gallery', label: 'Gallery', icon: 'photo_library', group: 'Company' },
  { key: 'about', label: 'About', icon: 'info', group: 'Company' },
];

export const PERMISSION_GROUPS = PERMISSION_MODULES
  .map(m => m.group)
  .filter((g, i, arr) => arr.indexOf(g) === i);

// A Technician login is deliberately limited to the options their work needs.
// Everything else (Leads, Revenue, Expenditure, New PO, …) stays OFF until an
// Admin switches it on for that individual in Settings → Permission Management.
export const TECHNICIAN_DEFAULT_MODULES = [
  'dashboard', 'tasks', 'my_reports', 'installations', 'ongoing_work',
  'materials', 'attendance', 'tracking', 'leave', 'reminders', 'gallery', 'about',
];

// The default state of a permission for a role, used when the Admin has not set
// an explicit value for that user.
// A Team Leader starts with what a Technician gets, plus the Team section and
// the ability to raise a payment request. Anything more is the Admin's call.
export const TEAM_LEADER_DEFAULT_MODULES = [
  ...TECHNICIAN_DEFAULT_MODULES,
  'team', 'team_members', 'team_attendance', 'team_tracking', 'team_tasks', 'team_leave',
  'payment_requests',
];

export function defaultModuleAllowed(role, key) {
  const r = normalizeRole(role);
  if (key === 'new_po') return can(r, ACTIONS.PO_RECORD);
  if (r === 'technician') return TECHNICIAN_DEFAULT_MODULES.includes(key);
  if (r === 'team_leader') return TEAM_LEADER_DEFAULT_MODULES.includes(key);
  // The Team options only mean anything to someone who has members assigned.
  return true;
}

// Is a module / action available to this user? Explicit per-user value wins,
// then the role default. Admin and above always keep full access.
export function hasModule(user, role, key) {
  if (role === 'super_admin' || hasAccess(role, 'admin')) return true;
  const p = user && user.permissions;
  if (p && typeof p === 'object' && p[key] !== undefined && p[key] !== null) return !!p[key];
  return defaultModuleAllowed(role, key);
}
