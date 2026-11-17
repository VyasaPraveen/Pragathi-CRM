// The list pages on the phone (29-Oct): every section carries the same
// toolbar pieces (a chip strip, the right-hand group, the date strip) and its
// table is marked for the card layout — a heading cell, an actions cell, and
// a label on every other cell, with every action button named so the phone
// can print the name under its icon.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

let mockData = {};
let mockAuth = {};
jest.mock('../context/DataContext', () => ({ useData: () => mockData }));
jest.mock('../context/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../context/ToastContext', () => ({ useToast: () => ({ toast: jest.fn() }) }));

const PAGES = {
  Leads: { data: { leads: [{ id: 'l1', name: 'Sai Krishna', phone: '9876543210', status: 'Interested', priority: 'High', dateGenerated: '2026-10-01', address: 'Tirupati', leadReference: 'Website', assignedTo: 'Revanth Reddy' }] }, dated: true },
  Customers: { data: { customers: [{ id: 'c1', name: 'Customer One', phone: '9876543210', paymentType: 'Cash', totalPrice: 100000, advanceAmount: 20000, status: 'Active', nextServiceDate: '2026-12-01' }] }, dated: false },
  EmployeeTasks: { data: { employeeTasks: [{ id: 't1', title: 'Site survey', status: 'Pending', priority: 'High', assignedTo: 'Revanth Reddy', dueDate: '2026-11-01' }] }, dated: true },
  PurchaseOrders: { data: { purchaseOrders: [{ id: 'p1', poNumber: 'PO-1', vendorName: 'Vendor', status: 'Approved', items: [{ materialName: 'Cable', quantity: 1 }], poDate: '2026-10-01', totalValue: 5000 }] }, dated: true },
  Reminders: { data: { reminders: [{ id: 'r1', type: 'Service', customer: 'Customer One', phone: '9876543210', date: '2026-11-02', message: 'Service due', status: 'Pending' }] }, dated: false },
  Expenditure: { data: { expenditures: [{ id: 'e1', amount: 1200, status: 'Requested', requestedBy: 'o@x.com', requestedDate: '2026-10-01', category: 'Travel' }] }, dated: true },
};

// Anything a page asks for that the case does not name is an empty list.
const dataOf = (given) => new Proxy({ settings: {}, ...given }, { get: (t, k) => (k in t ? t[k] : []) });

function mount(element) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(element); });
  return { host, unmount: () => { act(() => { root.unmount(); }); host.remove(); } };
}

beforeEach(() => {
  mockAuth = { role: 'super_admin', designation: 'Owner', user: { email: 'o@x.com', displayName: 'Owner', uid: 'u1', modules: {} } };
});

Object.entries(PAGES).forEach(([name, { data, dated }]) => {
  test(`${name}: the toolbar pieces and a card-ready list`, () => {
    mockData = dataOf(data);
    const Page = require(`./${name}`).default;
    const { host, unmount } = mount(<Page />);

    // The toolbar: a chip strip inside the right-hand group, and the date strip where the page has one.
    expect(host.querySelector('.tl .tl-r')).not.toBeNull();
    expect(host.querySelectorAll('.tl .tl-r > .chips > .fc').length).toBeGreaterThan(0);
    if (dated) expect(host.querySelector('.df')).not.toBeNull();

    // The list: marked for cards, every row with one heading, one actions cell and labels on the rest.
    const wrap = host.querySelector('.tw.tw-m');
    expect(wrap).not.toBeNull();
    const rows = [...wrap.querySelectorAll(':scope > table > tbody > tr')].filter(tr => !tr.querySelector(':scope > td[colspan]'));
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach(tr => {
      const tds = [...tr.querySelectorAll(':scope > td')];
      expect(tds.filter(td => td.classList.contains('m-h')).length).toBe(1);
      expect(tds.filter(td => td.classList.contains('m-a')).length).toBe(1);
      tds.filter(td => !td.classList.contains('m-h') && !td.classList.contains('m-a'))
        .forEach(td => expect(td.getAttribute('data-l') || '').not.toBe(''));
      // Every button in the actions cell is named: a title the phone prints, or an explicit data-m.
      const buttons = [...tr.querySelectorAll(':scope > td.m-a button')];
      expect(buttons.length).toBeGreaterThan(0);
      buttons.forEach(b => expect(b.hasAttribute('title') || b.hasAttribute('data-m')).toBe(true));
    });
    unmount();
  });
});
