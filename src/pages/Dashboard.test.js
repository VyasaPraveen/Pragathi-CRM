// The dashboard renders for an admin and for an executive, with data and
// with nothing at all, and carries the responsive building blocks (28-Oct).
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

let mockData = {};
let mockAuth = {};
const mockNavigate = jest.fn();
jest.mock('../context/DataContext', () => ({ useData: () => mockData }));
jest.mock('../context/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }), { virtual: true });
const Dashboard = require('./Dashboard').default;

const empty = () => ({ leads: [], customers: [], installations: [], income: [], expenses: [], materials: [], reminders: [], employeeTasks: [], team: [], users: [], leadPOs: [] });

function mount(element) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(element); });
  return { host, unmount: () => { act(() => { root.unmount(); }); host.remove(); } };
}

test('an admin with data: tiles, chips, chart rows, donut legend, quick actions', () => {
  mockAuth = { role: 'super_admin', designation: 'Owner', user: { email: 'o@x.com', displayName: 'Owner' } };
  mockData = { ...empty(),
    leads: [{ id: 'l1', name: 'A', status: 'Converted', priority: 'High', city: 'Tirupati', leadReference: 'Website', dateGenerated: '2026-10-01', assignedTo: 'Rev' },
            { id: 'l2', name: 'B', status: 'Interested', priority: 'Low', city: 'Chittoor', leadReference: 'Referral', dateGenerated: '2026-10-02', nextFollowUpDate: '2026-01-01', assignedTo: 'Rev' }],
    customers: [{ id: 'c1', name: 'A', paymentType: 'Cash', totalPrice: 100000, advanceAmount: 20000 }],
    installations: [{ id: 'i1', customerName: 'A', progress: 40 }],
    income: [{ amount: 5000 }], expenses: [{ amount: 1000 }],
    materials: [{ id: 'm1', name: 'Cable', balance: 5, unit: 'm' }],
    team: [{ id: 't1', name: 'Rev', status: 'Active', role: 'Executive' }],
  };
  const { host, unmount } = mount(<Dashboard />);
  expect(host.querySelector('.db')).not.toBeNull();
  expect(host.querySelectorAll('.db-chip').length).toBe(3);
  expect(host.querySelectorAll('.db-tile').length).toBe(6);
  expect(host.querySelectorAll('.db-tile.go').length).toBe(5);
  expect(host.querySelectorAll('.db-row').length).toBeGreaterThanOrEqual(5);
  expect(host.querySelector('.db-mini3')).not.toBeNull();
  expect(host.querySelectorAll('.db-legend > div').length).toBe(4);
  expect(host.querySelectorAll('.db-qa').length).toBe(6);
  expect(host.textContent).toContain('Welcome Back!');
  expect(host.textContent).toContain('Revenue vs Expenses');
  act(() => { host.querySelector('.db-tile.go').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  expect(mockNavigate).toHaveBeenCalledWith('/leads');
  act(() => { host.querySelector('.db-qa').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  expect(mockNavigate).toHaveBeenLastCalledWith('/leads');
  unmount();
});

test('an executive with nothing at all still renders', () => {
  mockAuth = { role: 'executive', designation: 'Executive', user: { email: 'e@x.com', displayName: 'Exec' } };
  mockData = empty();
  const { host, unmount } = mount(<Dashboard />);
  expect(host.querySelectorAll('.db-tile').length).toBe(5);
  expect(host.textContent).toContain('Monthly Leads');
  expect(host.querySelector('.db-row.db-1')).not.toBeNull();
  unmount();
});

test('Top Performers ranks by conversions, and dates read as "02 Oct 2026"', () => {
  mockAuth = { role: 'super_admin', designation: 'Owner', user: { email: 'o@x.com', displayName: 'Owner' } };
  mockData = { ...empty(),
    leads: [{ id: 'a1', name: 'A', status: 'Interested', assignedTo: 'Revanth Reddy', dateGenerated: '2026-10-01', nextFollowUpDate: '2026-01-01', city: 'Tirupathi' },
            { id: 'a2', name: 'B', status: 'Interested', assignedTo: 'Revanth Reddy', dateGenerated: '2026-10-02', city: 'tirupathi' },
            { id: 'a3', name: 'C', status: 'Converted', assignedTo: 'Revanth Reddy', dateGenerated: '2026-10-03', city: 'Tirupathi ' },
            { id: 'a4', name: 'D', status: 'Converted', assignedTo: 'Mahesh', dateGenerated: '2026-10-04', city: 'Kadapa' },
            { id: 'a5', name: 'E', status: 'Converted', assignedTo: 'Mahesh', dateGenerated: '2026-10-05', city: 'Kadapa' },
            { id: 'a6', name: 'F', status: 'Converted', assignedTo: 'Sarath', dateGenerated: '2026-10-06', city: 'Kadapa' }],
  };
  const { host, unmount } = mount(<Dashboard />);
  const names = [...host.querySelectorAll('.db-top tbody tr')].map(tr => tr.querySelector('td:nth-child(2)').textContent.trim());
  // Two conversions beat one; among one each, the full rate beats one in three.
  expect(names).toEqual(['Mahesh', 'Sarath', 'Revanth Reddy']);
  // The overdue follow-up and the recent leads print the date as day, month name, year.
  expect(host.textContent).toContain('01 Jan 2026');
  expect(host.textContent).toContain('05 Oct 2026');
  expect(host.textContent).not.toContain('2026-01-01');
  // One city however it was typed.
  const cities = [...host.querySelectorAll('.db-city .mbc-l')].map(e => e.textContent);
  expect(cities).toEqual(['Tirupath', 'Kadapa']);
  unmount();
});
