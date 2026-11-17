// Req 3 (5-Nov): the space key in the planning text fields. The editor used to
// trim the text on every keystroke, so a space typed at the end of a word was
// gone before the next letter arrived.
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
const type = (el, value) => act(() => {
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
const me = { email: 'rev@x.com', displayName: 'Revanth Reddy' };
beforeEach(() => { writes.length = 0; localStorage.clear(); window.confirm = () => true; });

test('a space typed at the end of a word stays in the field, in an hourly slot and in the whole-day block', () => {
  mockAuth = { role: 'executive', user: me };
  mockData = { tracking: [], users: [], settings: {} };
  const { host, unmount } = mount(<PlanEditor date="2026-11-05" employeeEmail="rev@x.com" employeeName="Revanth Reddy" lockAfterSend />);
  const slot = host.querySelector('input.fi');
  type(slot, 'plan');
  type(slot, 'plan ');
  expect(slot.value).toBe('plan ');
  type(slot, 'plan for');
  type(slot, 'plan for ');
  type(slot, 'plan for installation');
  expect(slot.value).toBe('plan for installation');
  const day = host.querySelector('textarea.fi');
  type(day, 'Whole day ');
  expect(day.value).toBe('Whole day ');
  unmount();
});

test('what is saved is still trimmed, and the summary ignores a trailing space', async () => {
  mockAuth = { role: 'executive', user: me };
  mockData = { tracking: [], users: [], settings: {} };
  const { host, unmount } = mount(<PlanEditor date="2026-11-05" employeeEmail="rev@x.com" employeeName="Revanth Reddy" lockAfterSend />);
  type(host.querySelector('input.fi'), 'Site visit Tirupati ');
  const save = [...host.querySelectorAll('button')].find(b => /Save/.test(b.textContent));
  await act(async () => { save.click(); });
  expect(writes.length).toBe(1);
  expect(writes[0][2].slots.h6.text).toBe('Site visit Tirupati');
  unmount();
});
