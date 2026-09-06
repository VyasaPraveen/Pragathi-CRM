// ============================================================================
// Pragathi CRM — Role-Based Access Control (RBAC)
// 9 business roles, each with a separate login, gated per the official
// permission matrix. `super_admin` (the owner account) always has full access.
// This layer is additive: the legacy hierarchy in helpers.js (hasAccess) still
// works for generic module gating; this file governs the specific workflow
// ACTIONS (lead entry, PO record/recommend/approve, expenditure chain, etc.).
// ============================================================================

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
};

export const ACTION_ROLES = {
  [ACTIONS.LEAD_ENTRY]: [...ALL_ROLE_KEYS], // all 1–9
  [ACTIONS.SITE_VISIT]: ['executive', 'technical_manager'],
  [ACTIONS.PO_RECORD]: ['operation_manager', 'admin', 'warehouse_admin'],
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
    // If we don't know the cost yet, don't hard-block on an unknowable figure.
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
