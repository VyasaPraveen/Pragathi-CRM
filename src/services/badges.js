// ============================================================================
// The counts on the sidebar (Req 7, 27-Oct).
//
// A badge is the number of UNREAD notifications addressed to this person
// about that section — the same notifications the bell shows. It goes up by
// one when a new notification arrives, and down as they are read: from the
// bell, from "mark all read", or by opening the section itself (AppLayout
// marks a section's notifications read on arrival). Nothing is counted twice:
// each notification row is one row, and a read one counts for nothing.
//
// It used to count outstanding records instead (leads marked Interested,
// POs not yet approved, …), which never went down when the person looked.
// ============================================================================

import { isSameUser } from './helpers';

// Which section a notification's `module` belongs to. Keep in step with the
// `module` values createNotification() is called with and the badgeKeys in
// Sidebar.js.
export const MODULE_BADGE_KEY = {
  leads: 'leads', quotations: 'leads', lead: 'leads',
  purchaseOrders: 'purchase_orders', leadPOs: 'purchase_orders',
  paymentRequests: 'payment_requests',
  leaveRequests: 'leave', leave: 'leave',
  employeeTasks: 'tasks', tasks: 'tasks',
  expenditures: 'expenditure', expenditure: 'expenditure',
  reminders: 'reminders',
  assignedMaterials: 'assigned_materials',
  materials: 'materials',
  installations: 'installations', customers: 'customers', attendance: 'attendance', ongoingWork: 'ongoing_work',
};
export const badgeKeyOf = (module) => MODULE_BADGE_KEY[module] || '';

// The notifications addressed to this person that are still unread.
export function unreadNotificationsFor(notifications, user) {
  return (notifications || []).filter(n => n && !n.read && isSameUser(n.forUser, user));
}

export function badgeCounts(data, user) {
  const { notifications = [] } = data || {};
  const counts = {};
  unreadNotificationsFor(notifications, user).forEach(n => {
    const key = badgeKeyOf(n.module);
    if (!key) return;
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

// The unread notifications that the section at this route is about — the
// ones opening it marks as read.
export function notificationsForRoute(notifications, user, pathname, routeOf) {
  return unreadNotificationsFor(notifications, user).filter(n => {
    const to = routeOf(n.module);
    return to && to !== '/' && to === pathname;
  });
}
