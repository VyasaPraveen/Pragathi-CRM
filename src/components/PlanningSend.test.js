// Req 5 / 8 (4-Nov): Send Plan beside Save, a sent plan read-only on the
// Planning screen and reopened with Edit in My Reports & Planning, and who the
// Planning screen lets a person look at.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

let mockData = {};
let mockAuth = {};
const writes = [];
jest.mock('../context/DataContext', () => ({ useData: () => mockData }));
jest.mock('../context/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../context/ToastContext', () => ({ useToast: () => ({ toast: () => {} }) }));
jest.mock('../services/firestore', () => ({
  addDocument: async (col, doc) => { writes.push(['add', col, doc]); return 'new1'; },
  updateDocument: async (col, id, patch) => { writes.push(['update', col, id, patch]); return {}; },
}));
const PlanEditor = require('./PlanningPanel').default;
const Tracking = require('../pages/Tracking').default;

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
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
const me = { email: 'rev@x.com', displayName: 'Revanth Reddy' };
const users = [
  { id: 'u1', email: 'om@x.com', displayName: 'Ops', role: 'operation_manager' },
  { id: 'u2', email: 'yog@x.com', displayName: 'K.J. Yogendra Reddy', role: 'sales_manager' },
  { id: 'u3', email: 'rev@x.com', displayName: 'Revanth Reddy', role: 'executive', teamLeader: 'yog@x.com' },
  { id: 'u4', email: 'chandu@x.com', displayName: 'Chandu K', role: 'executive', teamLeader: 'yog@x.com' },
  { id: 'u5', email: 'gopi@x.com', displayName: 'K Gopi', role: 'team_leader' },
];
beforeEach(() => { writes.length = 0; localStorage.clear(); window.confirm = () => true; });

test('Save and Send Plan sit together; Send Plan saves and marks the plan sent', async () => {
  mockAuth = { role: 'executive', user: me };
  mockData = { tracking: [], users, settings: {} };
  const { host, unmount } = mount(<PlanEditor date="2026-11-04" employeeEmail="rev@x.com" employeeName="Revanth Reddy" lockAfterSend />);
  expect(byText(host, /Save/)).toBeTruthy();
  expect(byText(host, /Send Plan/)).toBeTruthy();
  expect(byText(host, /Report/)).toBeTruthy();
  type(host.querElementorAll ? null : host.querySelector('textarea.fi'), 'Whole day at Tirupati site');
  await act(async () => { byText(host, /Send Plan/).click(); });
  expect(writes.map(w => w[0])).toEqual(['add', 'update']);
  expect(writes[0][2].slots.day.text).toBe('Whole day at Tirupati site');
  expect(writes[1][3].planSent).toBe(true);
  expect(writes[1][3].planSentBy).toBe('rev@x.com');
  expect(writes[1][3].planSentByName).toBe('Revanth Reddy');
  unmount();
});

test('a sent plan is read-only on the Planning screen and reopened with Edit elsewhere', async () => {
  mockAuth = { role: 'executive', user: me };
  const sent = { id: 't1', employeeEmail: 'rev@x.com', employeeName: 'Revanth Reddy', date: '2026-11-04', planSent: true, planSentAt: '2026-11-04T03:30:00Z', planSentByName: 'Revanth Reddy', slots: { h9: { text: 'Call Mr Rao', status: 'planned' } } };
  mockData = { tracking: [sent], users, settings: {} };
  let m = mount(<PlanEditor date="2026-11-04" employeeEmail="rev@x.com" employeeName="Revanth Reddy" lockAfterSend />);
  expect(m.host.textContent).toContain('Plan sent');
  expect(m.host.querySelector('input.fi, textarea.fi')).toBeNull();
  expect(byText(m.host, /Send Plan/)).toBeUndefined();
  expect(byText(m.host, /^\s*edit\s*Edit\s*$/)).toBeUndefined();
  expect(m.host.textContent).toContain('My Reports & Planning');
  m.unmount();
  // My Reports & Planning: Edit opens it again, with Report still available
  m = mount(<PlanEditor date="2026-11-04" employeeEmail="rev@x.com" employeeName="Revanth Reddy" compact />);
  expect(m.host.querySelector('input.fi, textarea.fi')).toBeNull();
  const edit = buttons(m.host).find(b => b.dataset.plan === 'edit');
  expect(edit).toBeTruthy();
  await act(async () => { edit.click(); });
  expect(m.host.querySelector('input.fi, textarea.fi')).not.toBeNull();
  expect(byText(m.host, /Report/)).toBeTruthy();
  expect(byText(m.host, /Send Plan/)).toBeUndefined();      // already sent
  m.unmount();
});

test('the Planning screen: an executive sees only themselves, a Team Leader their members, the Operation Manager everyone', () => {
  mockData = { tracking: [], users, settings: {} };
  mockAuth = { role: 'executive', user: me };
  let m = mount(<Tracking />);
  expect(m.host.querySelector('select[data-plan="who"]')).toBeNull();
  expect(m.host.textContent).toContain('You can view your own planning.');
  m.unmount();
  mockAuth = { role: 'sales_manager', user: users[1] };
  m = mount(<Tracking />);
  let opts = [...m.host.querySelectorAll('select[data-plan="who"] option')].map(o => o.textContent);
  expect(opts).toEqual(['My planning', 'Revanth Reddy', 'Chandu K']);
  m.unmount();
  mockAuth = { role: 'operation_manager', user: users[0] };
  m = mount(<Tracking />);
  opts = [...m.host.querySelectorAll('select[data-plan="who"] option')].map(o => o.textContent);
  expect(opts.length).toBe(5);
  expect(opts).toContain('K Gopi');
  m.unmount();
});
