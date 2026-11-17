// Req 5 (5-Nov): Approve All on Materials → Approvals. The Owner approves every
// entry waiting on them through the same route the individual button uses.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

let mockData = {};
let mockAuth = {};
const approved = [];
jest.mock('../context/DataContext', () => ({ useData: () => mockData }));
jest.mock('../context/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../context/ToastContext', () => ({ useToast: () => ({ toast: () => {} }) }));
jest.mock('../services/firestore', () => ({ addDocument: async () => 'x', updateDocument: async () => {}, deleteDocument: async () => {} }));
jest.mock('../services/stockApi', () => ({
  submitStockReceipt: async () => ({}), submitStockAdjustment: async () => ({}), submitStockReturn: async () => ({}),
  reviewStockEntry: async () => ({}), newClientRef: () => 'c1',
  approveStockEntry: async (id, action) => { approved.push([id, action]); return {}; },
}));
const Materials = require('./Materials').default;

const dataOf = (given) => new Proxy({ settings: {}, ...given }, { get: (t, k) => (k in t ? t[k] : []) });
function mount(element) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(element); });
  return { host, unmount: () => { act(() => { root.unmount(); }); host.remove(); } };
}
const buttons = (host) => [...host.querySelectorAll('button')];
const byText = (host, re) => buttons(host).find(b => re.test(b.textContent));

const materials = [{ id: 'm1', name: 'AC Cable', unit: 'Mtr', stock: 100, dispatched: 0, balance: 100 }];
const txns = [
  { id: 's1', type: 'receipt', status: 'Forwarded to Owner', materialId: 'm1', materialName: 'AC Cable', quantity: 50, unit: 'Mtr', reference: 'RC-1', submittedBy: 'Warehouse', submittedAt: '2026-11-05T03:00:00Z', balanceAtSubmission: 100 },
  { id: 's2', type: 'return', status: 'Pending Review', materialId: 'm1', materialName: 'AC Cable', quantity: 5, unit: 'Mtr', reference: 'RT-1', submittedBy: 'Warehouse', submittedAt: '2026-11-05T04:00:00Z', balanceAtSubmission: 100 },
  { id: 's3', type: 'receipt', status: 'Approved', materialId: 'm1', materialName: 'AC Cable', quantity: 10, unit: 'Mtr', reference: 'RC-0', submittedBy: 'Warehouse', submittedAt: '2026-11-04T04:00:00Z' },
];
beforeEach(() => { approved.length = 0; window.confirm = () => true; });

test('the Owner sees Approve All with the count, and it approves each pending entry; individual buttons stay', async () => {
  mockData = dataOf({ materials, stockTransactions: txns });
  mockAuth = { role: 'super_admin', user: { email: 'owner@x.com', displayName: 'Owner' } };
  const { host, unmount } = mount(<Materials />);
  await act(async () => { byText(host, /Approvals/).click(); });
  const all = host.querySelector('[data-stock="approve-all"]');
  expect(all.textContent).toContain('Approve All (2)');
  expect(buttons(host).filter(b => /Approve & Update Stock/.test(b.textContent)).length).toBe(2);
  await act(async () => { all.click(); });
  expect(approved).toEqual([['s1', 'approve'], ['s2', 'approve']]);
  unmount();
});

test('the Operation Manager, who only forwards, gets no Approve All', async () => {
  mockData = dataOf({ materials, stockTransactions: txns });
  mockAuth = { role: 'operation_manager', user: { email: 'om@x.com', displayName: 'Ops' } };
  const { host, unmount } = mount(<Materials />);
  await act(async () => { byText(host, /Approvals/).click(); });
  expect(host.querySelector('[data-stock="approve-all"]')).toBeNull();
  unmount();
});
