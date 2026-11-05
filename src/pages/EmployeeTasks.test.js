// Tasks (Req 1 and Req 6, 5-Nov): the New Task button follows the Owner's
// switch for a Sales Executive, a task takes several assignees who are all
// told, and an assignee may update the task.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

let mockData = {};
let mockAuth = {};
const writes = [];
const notes = [];
jest.mock('../context/DataContext', () => ({ useData: () => mockData }));
jest.mock('../context/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../context/ToastContext', () => ({ useToast: () => ({ toast: () => {} }) }));
jest.mock('../services/firestore', () => ({
  addDocument: async (col, doc) => { writes.push(['add', col, doc]); return 'new1'; },
  updateDocument: async (col, id, patch) => { writes.push(['update', col, id, patch]); },
  deleteDocument: async () => {},
  createNotification: async (n) => { notes.push(n); },
  notifyAdmins: async () => {},
}));
const EmployeeTasks = require('./EmployeeTasks').default;

function mount(element) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(element); });
  return { host, unmount: () => { act(() => { root.unmount(); }); host.remove(); } };
}
const buttons = (host) => [...host.querySelectorAll('button')];
const byText = (host, re) => buttons(host).find(b => re.test(b.textContent));
const type = (el, value) => act(() => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
const users = [
  { id: 'u1', email: 'yog@x.com', displayName: 'K.J. Yogendra Reddy', role: 'sales_manager' },
  { id: 'u2', email: 'rev@x.com', displayName: 'Revanth Reddy', role: 'executive', teamLeader: 'yog@x.com' },
  { id: 'u3', email: 'chandu@x.com', displayName: 'Chandu K', role: 'executive', teamLeader: 'yog@x.com' },
];
const rev = { email: 'rev@x.com', displayName: 'Revanth Reddy' };
beforeEach(() => { writes.length = 0; notes.length = 0; window.confirm = () => true; });

test('Req 1: a Sales Executive gets New Task only when the Owner ticks it', () => {
  mockData = { employeeTasks: [], users };
  mockAuth = { role: 'executive', user: { ...rev, permissions: {} } };
  let m = mount(<EmployeeTasks />);
  expect(byText(m.host, /New Task/)).toBeUndefined();
  m.unmount();
  mockAuth = { role: 'executive', user: { ...rev, permissions: { new_task: true } } };
  m = mount(<EmployeeTasks />);
  expect(byText(m.host, /New Task/)).toBeTruthy();
  m.unmount();
});

test('Req 6: a task goes to a Team Leader and two members; each is told; the list shows them all', async () => {
  mockData = { employeeTasks: [], users };
  mockAuth = { role: 'sales_manager', user: { email: 'yog@x.com', displayName: 'K.J. Yogendra Reddy' } };
  const { host, unmount } = mount(<EmployeeTasks />);
  await act(async () => { byText(host, /New Task/).click(); });
  const picker = host.querySelector('[data-task="assignees"]');
  expect(picker).toBeTruthy();
  const boxes = [...picker.querySelectorAll('input[type="checkbox"]')];
  const labelOf = (b) => b.closest('label').textContent;
  // the Sales Manager leads a team, so is marked as a Team Leader
  expect(labelOf(boxes.find(b => /Yogendra/.test(labelOf(b))))).toMatch(/Team Leader/);
  for (const name of ['Yogendra', 'Revanth', 'Chandu']) {
    await act(async () => { boxes.find(b => new RegExp(name).test(labelOf(b))).click(); });
  }
  expect(picker.textContent).toContain('K.J. Yogendra Reddy');
  type(host.querySelector('.md input.fi'), 'Site survey at Renigunta');
  const due = host.querySelector('.md input[type="date"][required]');
  type(due, '2026-11-07');
  await act(async () => { byText(host, /Create Task/).click(); });
  const added = writes.find(w => w[0] === 'add');
  expect(added[2].assignees).toEqual(['K.J. Yogendra Reddy', 'Revanth Reddy', 'Chandu K']);
  expect(added[2].assignedTo).toBe('K.J. Yogendra Reddy');
  expect(added[2].assignedBy).toBe('K.J. Yogendra Reddy');
  expect(notes.filter(n => n.title === 'New Task Assigned').map(n => n.forUser)).toEqual(['K.J. Yogendra Reddy', 'Revanth Reddy', 'Chandu K']);
  unmount();
});

test('Req 6: an assignee can open the task, see everyone on it, and update it; an unrelated executive cannot edit', async () => {
  const task = { id: 't1', title: 'Site survey', assignees: ['K.J. Yogendra Reddy', 'Chandu K'], assignedTo: 'K.J. Yogendra Reddy', assignedBy: 'Owner', status: 'Pending', priority: 'High', dueDate: '2026-11-07' };
  mockData = { employeeTasks: [task], users };
  mockAuth = { role: 'executive', user: { email: 'chandu@x.com', displayName: 'Chandu K', permissions: {} } };
  let m = mount(<EmployeeTasks />);
  const row = m.host.querySelector('tbody tr');
  expect(row.textContent).toContain('K.J. Yogendra Reddy, Chandu K');
  expect(row.querySelector('button[title="Edit"]')).toBeTruthy();
  await act(async () => { row.querySelector('button[title="View Details"]').click(); });
  const people = m.host.querySelector('[data-task="people"]');
  expect(people.textContent).toContain('K.J. Yogendra Reddy · Team Leader');
  expect(people.textContent).toContain('Chandu K · Executive');
  expect(m.host.textContent).toContain('Assigned By');
  expect(byText(m.host, /Edit Task/)).toBeTruthy();
  m.unmount();
  // somebody not on the task
  mockAuth = { role: 'executive', user: { ...rev, permissions: {} } };
  m = mount(<EmployeeTasks />);
  expect(m.host.querySelector('tbody tr button[title="Edit"]')).toBeNull();
  m.unmount();
});

test('Req 6: adding a person to an existing task tells only the newcomer; a status change tells every assignee', async () => {
  const task = { id: 't1', title: 'Site survey', assignees: ['Chandu K'], assignedTo: 'Chandu K', status: 'Pending', priority: 'High', dueDate: '2026-11-07' };
  mockData = { employeeTasks: [task], users };
  mockAuth = { role: 'sales_manager', user: { email: 'yog@x.com', displayName: 'K.J. Yogendra Reddy' } };
  const { host, unmount } = mount(<EmployeeTasks />);
  await act(async () => { host.querySelector('tbody tr button[title="Edit"]').click(); });
  const picker = host.querySelector('[data-task="assignees"]');
  const boxes = [...picker.querySelectorAll('input[type="checkbox"]')];
  await act(async () => { boxes.find(b => /Revanth/.test(b.closest('label').textContent)).click(); });
  const status = [...host.querySelectorAll('.md select.fi')].find(s => [...s.options].some(o => o.value === 'In Progress'));
  await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(status, 'In Progress'); status.dispatchEvent(new Event('change', { bubbles: true })); });
  await act(async () => { byText(host, /Update Task/).click(); });
  const upd = writes.find(w => w[0] === 'update');
  expect(upd[3].assignees).toEqual(['Chandu K', 'Revanth Reddy']);
  expect(notes.filter(n => n.title === 'Task Assigned to You').map(n => n.forUser)).toEqual(['Revanth Reddy']);
  expect(notes.filter(n => n.title === 'Task Status Changed').map(n => n.forUser).sort()).toEqual(['Chandu K', 'Revanth Reddy']);
  unmount();
});
