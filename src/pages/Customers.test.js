// Customers (31-Oct): a Sales Executive sees only the customers made from
// their own leads, and may edit those; the Owner sees them all.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

let mockData = {};
let mockAuth = {};
jest.mock('../context/DataContext', () => ({ useData: () => mockData }));
jest.mock('../context/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../context/ToastContext', () => ({ useToast: () => ({ toast: () => {} }) }));
jest.mock('../services/firestore', () => ({
  addDocument: async () => 'new1', updateDocument: async () => {}, deleteDocument: async () => {},
  createNotification: async () => {}, notifyAdmins: async () => {},
}));
const Customers = require('./Customers').default;

const dataOf = (given) => new Proxy({ settings: {}, ...given }, { get: (t, k) => (k in t ? t[k] : []) });

function mount(element) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(element); });
  return { host, unmount: () => { act(() => { root.unmount(); }); host.remove(); } };
}

const users = [
  { id: 'u1', email: 'owner@x.com', displayName: 'Owner', role: 'super_admin' },
  { id: 'u2', email: 'rev@x.com', displayName: 'Revanth Reddy', role: 'executive' },
  { id: 'u3', email: 'chandu@x.com', displayName: 'Chandu K', role: 'executive' },
];
const leads = [
  { id: 'l1', name: 'Sai Krishna', phone: '9876543210', assignedTo: 'Revanth Reddy', status: 'Converted' },
  { id: 'l2', name: 'Ravi Kumar', phone: '9123456789', assignedTo: 'Chandu K', status: 'Converted' },
];
const customers = [
  { id: 'c1', leadId: 'l1', name: 'Sai Krishna', phone: '9876543210', paymentType: 'Cash', totalPrice: 100000, status: 'Active' },
  { id: 'c2', leadId: 'l2', name: 'Ravi Kumar', phone: '9123456789', paymentType: 'Cash', totalPrice: 80000, status: 'Active' },
];
const rows = (host) => [...host.querySelectorAll('tbody tr')].filter(tr => tr.querySelector('td.m-h'));

beforeEach(() => { mockData = dataOf({ customers, leads, users }); });

test('the Owner sees every customer', () => {
  mockAuth = { role: 'super_admin', user: users[0] };
  const { host, unmount } = mount(<Customers />);
  expect(rows(host).length).toBe(2);
  unmount();
});

test('a Sales Executive sees only the customers of their own leads, with an Edit button', () => {
  mockAuth = { role: 'executive', user: users[1] };
  const { host, unmount } = mount(<Customers />);
  const r = rows(host);
  expect(r.length).toBe(1);
  expect(r[0].textContent).toContain('Sai Krishna');
  expect(host.textContent).not.toContain('Ravi Kumar');
  expect(r[0].querySelector('button[title="Edit"]')).not.toBeNull();
  // adding customers stays with the coordinator level and up
  expect([...host.querySelectorAll('button')].some(b => /Add Customer/.test(b.textContent))).toBe(false);
  unmount();
});

test('…and nothing when the Owner has set the assigned lead person to No access', () => {
  mockAuth = { role: 'executive', user: users[1] };
  mockData = dataOf({ customers, leads, users, settings: { assignedLeadAccess: 'none' } });
  const { host, unmount } = mount(<Customers />);
  expect(rows(host).length).toBe(0);
  expect(host.textContent).toContain('No customers assigned to you');
  unmount();
});

test('with View only, the executive sees their customer but gets no Edit button', () => {
  mockAuth = { role: 'executive', user: users[2] };
  mockData = dataOf({ customers, leads, users, settings: { assignedLeadAccess: 'view' } });
  const { host, unmount } = mount(<Customers />);
  const r = rows(host);
  expect(r.length).toBe(1);
  expect(r[0].textContent).toContain('Ravi Kumar');
  expect(r[0].querySelector('button[title="Edit"]')).toBeNull();
  unmount();
});
