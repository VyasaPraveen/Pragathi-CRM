// ============================================================================
// The counts on the sidebar.
//
// One rule holds all of them: a badge only ever counts things this person can
// actually open. A number that does not match the list behind it is worse than
// no number — it sends people looking for work that was never theirs, and it
// leaks how much is going on in a section they cannot see.
//
// "Outstanding" means needs somebody to do something. Anything finished,
// rejected or cancelled has stopped needing attention and stops counting.
// ============================================================================

import { canSeeLead, canSeePaymentRequest, isLeaveLeader, PR_STATUS, normalizeRole } from './permissions';
import { hasAccess } from './helpers';

const lc = (v) => String(v || '').trim().toLowerCase();

// Is this row this person's, by either of the two things a record can carry?
const isMine = (a, b, user) => {
  const email = lc(user?.email), name = lc(user?.displayName);
  const x = lc(a), y = lc(b);
  return (!!x && (x === email || x === name)) || (!!y && (y === email || y === name));
};

// Leave: the applicant, the assigned replacement, the applicant's Team Leader
// and the approvers are the people it concerns.
const LEAVE_OPEN = ['Awaiting Replacement', 'Awaiting Manager'];
const isLeaveApprover = (role) => ['sales_manager', 'management', 'admin', 'super_admin'].includes(role);

// A purchase order is done once it is fully approved, and dead once rejected.
const PO_DONE = ['Approved', 'Rejected', 'Cancelled'];
// An expenditure is done once the money has gone out.
const EXP_DONE = ['Released', 'Rejected'];
const TASK_DONE = ['Completed', 'Done', 'Cancelled'];

export function badgeCounts(data, user, role) {
  const {
    leads = [], reminders = [], paymentRequests = [], leaveRequests = [],
    employeeTasks = [], purchaseOrders = [], leadPOs = [], expenditures = [],
    users = [], team = [],
  } = data || {};

  const r = normalizeRole(role);
  const seesAllTasks = hasAccess(r, 'manager');

  // Leads — unchanged in meaning from the badge that was already there, but
  // now counted over the leads this person is allowed to see.
  const leadCount = leads.filter(l =>
    l.status === 'Interested' && canSeeLead(l, user, role, users, team)).length;

  const paymentRequestCount = paymentRequests.filter(pr =>
    pr.status !== PR_STATUS.CLOSED && pr.status !== PR_STATUS.REJECTED &&
    canSeePaymentRequest(pr, user, role, users)).length;

  const leaveCount = leaveRequests.filter(lr => {
    if (!LEAVE_OPEN.includes(lr.status)) return false;
    if (isLeaveApprover(r) || hasAccess(r, 'admin')) return true;
    return isMine(lr.employeeEmail, lr.employeeName, user) ||
      isMine(lr.replacementEmail, lr.replacementName, user) ||
      isLeaveLeader(lr, user, users);
  }).length;

  const taskCount = employeeTasks.filter(t => {
    if (TASK_DONE.includes(t.status)) return false;
    if (seesAllTasks) return true;
    return isMine(t.assignedTo, t.assignedToEmail, user);
  }).length;

  // Both kinds of purchase order share one screen, so they share one count.
  const poCount = [...purchaseOrders, ...leadPOs].filter(po =>
    !PO_DONE.includes(po.status) && po.status !== 'Draft').length;

  const expenditureCount = expenditures.filter(e => !EXP_DONE.includes(e.status)).length;

  const reminderCount = reminders.filter(x => x.status === 'Pending' &&
    (seesAllTasks || isMine(x.forUser, x.assignedTo, user) || !x.forUser)).length;

  return {
    leads: leadCount,
    payment_requests: paymentRequestCount,
    leave: leaveCount,
    tasks: taskCount,
    purchase_orders: poCount,
    expenditure: expenditureCount,
    reminders: reminderCount,
  };
}
