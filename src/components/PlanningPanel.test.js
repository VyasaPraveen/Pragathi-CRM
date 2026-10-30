// The plan editor (Req 7, 30-Oct): Save keeps a draft, Report submits it,
// a submitted report is read-only for its author with a manager's unlock,
// the whole-day slot is a textarea, and Pre-completed is a status.
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
beforeEach(() => { writes.length = 0; localStorage.clear(); window.confirm = jest.fn(() => true); window.prompt = jest.fn(() => 'typo'); });

test('the whole-day slot is a textarea and comes first; Save and Report are two buttons', () => {
  mockAuth = { role: 'executive', user: me };
  mockData = { tracking: [] };
  const { host, unmount } = mount(<PlanEditor date="2026-10-30" employeeEmail="rev@x.com" employeeName="Revanth Reddy" />);
  const ta = host.querySelector('textarea.fi');
  expect(ta).not.toBeNull();
  expect(host.textContent).toContain('6:00 AM – 6:00 PM (Whole day)');
  expect(host.textContent.indexOf('Whole day')).toBeLessThan(host.textContent.indexOf('6:00 AM – 7:00 AM'));
  expect(byText(host, /^\s*save\s*Save/i) || byText(host, /Save/)).toBeTruthy();
  expect(byText(host, /Report/)).toBeTruthy();
  expect(host.textContent).toContain('Not started');
  unmount();
});

test('Save writes a draft (not submitted); Report saves then submits', async () => {
  mockAuth = { role: 'executive', user: me };
  mockData = { tracking: [] };
  const { host, unmount } = mount(<PlanEditor date="2026-10-30" employeeEmail="rev@x.com" employeeName="Revanth Reddy" />);
  type(host.querySelector('textarea.fi'), 'Whole day at Tirupati site');
  expect(host.textContent).toContain('Unsaved changes');
  await act(async () => { byText(host, /Save/).click(); });
  expect(writes.length).toBe(1);
  expect(writes[0][0]).toBe('add');
  expect(writes[0][2].slots.day.text).toBe('Whole day at Tirupati site');
  expect(writes[0][2].submitted).toBeUndefined();
  // the saved draft is now the document
  mockData = { tracking: [{ id: 'new1', employeeEmail: 'rev@x.com', employeeName: 'Revanth Reddy', date: '2026-10-30', slots: { day: { text: 'Whole day at Tirupati site', status: 'planned' } } }] };
  unmount();
  const m2 = mount(<PlanEditor date="2026-10-30" employeeEmail="rev@x.com" employeeName="Revanth Reddy" />);
  expect(m2.host.textContent).toContain('Draft');
  // Pre-completed is one of the choices
  await act(async () => { byText(m2.host, /Pre-completed/).click(); });
  writes.length = 0;
  await act(async () => { byText(m2.host, /Report/).click(); });
  expect(writes.map(w => w[0])).toEqual(['update', 'update']);
  expect(writes[0][3].slots.day.status).toBe('pre_completed');
  expect(writes[1][3]).toEqual({ submitted: true });
  m2.unmount();
});

test('a submitted report is read-only for its author; a manager sees Unlock', async () => {
  const sent = { id: 't1', employeeEmail: 'rev@x.com', employeeName: 'Revanth Reddy', date: '2026-10-30', submitted: true, submittedAt: '2026-10-30T12:30:00Z', submittedByName: 'Revanth Reddy', slots: { h9: { text: 'Call Mr Rao', status: 'completed' } } };
  mockAuth = { role: 'executive', user: me };
  mockData = { tracking: [sent] };
  let m = mount(<PlanEditor date="2026-10-30" employeeEmail="rev@x.com" employeeName="Revanth Reddy" />);
  expect(m.host.textContent).toContain('Submitted');
  expect(m.host.textContent).toContain('Locked');
  expect(m.host.querySelector('input.fi, textarea.fi')).toBeNull();
  expect(byText(m.host, /Report/)).toBeUndefined();
  expect(byText(m.host, /Unlock/)).toBeUndefined();
  m.unmount();
  mockAuth = { role: 'operation_manager', user: { email: 'om@x.com', displayName: 'Ops Manager' } };
  m = mount(<PlanEditor date="2026-10-30" employeeEmail="rev@x.com" employeeName="Revanth Reddy" />);
  expect(m.host.textContent).toContain('Call Mr Rao');
  const unlock = byText(m.host, /Unlock/);
  expect(unlock).toBeTruthy();
  await act(async () => { unlock.click(); });
  expect(writes).toContainEqual(['update', 'tracking', 't1', { submitted: false, unlockNote: 'typo' }]);
  m.unmount();
});

test('an unsaved draft survives a remount', () => {
  mockAuth = { role: 'executive', user: me };
  mockData = { tracking: [] };
  let m = mount(<PlanEditor date="2026-10-30" employeeEmail="rev@x.com" employeeName="Revanth Reddy" />);
  type(m.host.querySelector('textarea.fi'), 'typed but not saved');
  m.unmount();
  m = mount(<PlanEditor date="2026-10-30" employeeEmail="rev@x.com" employeeName="Revanth Reddy" />);
  expect(m.host.querySelector('textarea.fi').value).toBe('typed but not saved');
  expect(m.host.textContent).toContain('restored');
  m.unmount();
});
