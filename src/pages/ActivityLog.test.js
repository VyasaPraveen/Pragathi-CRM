// The Activity Log's delete options (30-Oct): the four roles see the
// checkboxes and the two delete buttons, nobody else does, and "Delete
// selected" sends exactly the chosen ids to the purge route.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

let mockData = {};
let mockAuth = {};
const mockPost = jest.fn(() => Promise.resolve({ deleted: 2 }));
jest.mock('../context/DataContext', () => ({ useData: () => mockData }));
jest.mock('../context/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../context/ToastContext', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('../services/api', () => ({ apiPost: (...a) => mockPost(...a) }));
const ActivityLog = require('./ActivityLog').default;
const { canDeleteActivity } = require('./ActivityLog');

const log = [
  { id: 'a1', user: 'Owner', action: 'Created', module: 'leads', details: 'Lead A', timestamp: '2026-10-29T05:00:00Z' },
  { id: 'a2', user: 'Owner', action: 'Updated', module: 'leads', details: 'Lead A', timestamp: '2026-10-29T06:00:00Z' },
  { id: 'a3', user: 'Mahesh', action: 'Deleted', module: 'tasks', details: 'Task', timestamp: '2026-10-29T07:00:00Z' },
];

function mount(element) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(element); });
  return { host, unmount: () => { act(() => { root.unmount(); }); host.remove(); } };
}
const click = (el) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
const buttons = (host) => [...host.querySelectorAll('button')];

test('who may delete', () => {
  expect(['super_admin', 'operation_manager', 'management', 'admin'].map(canDeleteActivity)).toEqual([true, true, true, true]);
  expect(['executive', 'accountant', 'team_leader', 'technician', 'bco', 'sales_manager'].map(canDeleteActivity)).toEqual([false, false, false, false, false, false]);
  expect(canDeleteActivity('manager')).toBe(true);   // legacy spelling of the Operation Manager
});

test('the Operation Manager sees the checkboxes and deletes only the selected entries', async () => {
  mockAuth = { role: 'operation_manager', user: { email: 'om@x.com' } };
  mockData = { activityLog: log };
  window.confirm = jest.fn(() => true);
  const { host, unmount } = mount(<ActivityLog />);
  expect(host.querySelectorAll('input[type="checkbox"]').length).toBe(3);
  expect(buttons(host).find(b => /Delete all/.test(b.textContent))).toBeTruthy();
  const boxes = host.querySelectorAll('input[type="checkbox"]');
  click(boxes[0]); click(boxes[2]);
  const del = buttons(host).find(b => /Delete selected \(2\)/.test(b.textContent));
  expect(del).toBeTruthy();
  await act(async () => { del.click(); });
  expect(mockPost).toHaveBeenCalledWith('/collections/activityLog/purge', { ids: ['a1', 'a3'] });
  unmount();
});

test('Delete all asks first and clears the whole log', async () => {
  mockAuth = { role: 'super_admin', user: { email: 'o@x.com' } };
  mockData = { activityLog: log };
  mockPost.mockClear();
  window.confirm = jest.fn(() => false);
  const { host, unmount } = mount(<ActivityLog />);
  await act(async () => { buttons(host).find(b => /Delete all/.test(b.textContent)).click(); });
  expect(mockPost).not.toHaveBeenCalled();
  window.confirm = jest.fn(() => true);
  await act(async () => { buttons(host).find(b => /Delete all/.test(b.textContent)).click(); });
  expect(mockPost).toHaveBeenCalledWith('/collections/activityLog/purge', { all: true });
  unmount();
});

test('an Admin-level viewer without the right (sales manager) sees no delete controls', () => {
  // The log itself is admin-level; of the roles that can open it, Management,
  // Admin and the Owner may delete. A sales manager cannot open it at all.
  mockAuth = { role: 'sales_manager', user: { email: 's@x.com' } };
  mockData = { activityLog: log };
  const { host, unmount } = mount(<ActivityLog />);
  expect(host.textContent).toContain('Access Denied');
  expect(host.querySelectorAll('input[type="checkbox"]').length).toBe(0);
  unmount();
});
