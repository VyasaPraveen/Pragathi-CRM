// ============================================================================
// Tasks with several assignees (Req 6, 5-Nov).
//
// A task used to name one person in `assignedTo`. It now carries `assignees`,
// a list of names, with `assignedTo` kept as the first of them so every older
// screen, filter and badge keeps working on the tasks already on file. A task
// saved before this change has no `assignees` and reads back as a list of one.
// ============================================================================

import { isSameUser, hasAccess } from './helpers';
import { normalizeRole, roleLabel, isTeamLeader } from './permissions';

const squash = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Everyone a task is assigned to, by name, in the order chosen, no repeats.
export function taskAssignees(task) {
  const out = [];
  const add = (n) => {
    const name = String(n || '').trim();
    if (!name || out.some(x => squash(x) === squash(name))) return;
    out.push(name);
  };
  if (task) {
    if (Array.isArray(task.assignees)) task.assignees.forEach(add);
    add(task.assignedTo);
  }
  return out;
}

// The fields to save for a chosen list of names: the list, and the first name
// in the old single field so the rest of the app reads the task as before.
export function assigneeFields(names) {
  const list = taskAssignees({ assignees: names });
  return { assignees: list, assignedTo: list[0] || '' };
}

// Is this person one of the task's assignees? (By account name or email.)
export const isTaskAssignee = (task, user) => !!user && taskAssignees(task).some(n => isSameUser(n, user));

// Who may change a task: the coordinator level and up (as before), whoever may
// create tasks, and the people it is assigned to - they work it, so they update
// its details and status (Req 6.5).
export function canEditTask(task, user, role, canCreate = false) {
  if (!task) return false;
  const r = normalizeRole(role);
  if (r === 'super_admin' || hasAccess(r, 'coordinator')) return true;
  return !!canCreate || isTaskAssignee(task, user);
}

// The assignees added by an edit - the ones to tell about their new task.
export function newAssignees(before, after) {
  const was = taskAssignees(before).map(squash);
  return taskAssignees(after).filter(n => !was.includes(squash(n)));
}

// Who each assignee is: their role, and whether they lead a team (Req 6.2,
// 6.6). A name that matches no account is shown as it is.
export function taskPeople(task, users) {
  return taskAssignees(task).map(name => {
    const u = (users || []).find(x => isSameUser(name, x));
    const role = u ? normalizeRole(u.role) : '';
    const leader = !!u && (role === 'team_leader' || isTeamLeader(users, u.email));
    return { name, email: u ? u.email : '', role, roleLabel: u ? roleLabel(role) : '', designation: u ? (u.designation || '') : '', leader };
  });
}

// Does the task concern this name? (The "All Members" filter.)
export const taskHasAssignee = (task, name) => taskAssignees(task).some(n => squash(n) === squash(name));
