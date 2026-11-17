// Req 4 (17-Nov): Subject and View Planning on both report cards, and the
// whole-day slot's new 6 AM – 8 PM timing.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

let mockData = {};
let mockAuth = {};
jest.mock('../context/DataContext', () => ({ useData: () => mockData }));
jest.mock('../context/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../context/ToastContext', () => ({ useToast: () => ({ toast: () => {} }) }));
const Reports = require('./Reports').default;
const { WHOLE_DAY_SLOT } = require('../services/planning');

const dataOf = (given) => new Proxy({ settings: {}, ...given }, { get: (t, k) => (k in t ? t[k] : []) });
function mount(element) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(element); });
  return { host, unmount: () => { act(() => { root.unmount(); }); host.remove(); } };
}
const today = new Date().toLocaleDateString('en-CA');
const long = 'Whole day at the Tirupati site: module mounting on the north roof, inverter wiring, then the DISCOM meter visit in the afternoon with the customer.';
const users = [
  { id: 'u1', email: 'owner@x.com', displayName: 'Owner', role: 'super_admin' },
  { id: 'u2', email: 'rev@x.com', displayName: 'Revanth Reddy', role: 'executive', designation: 'Sales Executive' },
];
const tracking = [
  { id: 't1', employeeEmail: 'rev@x.com', employeeName: 'Revanth Reddy', date: today, slots: { day: { text: long, status: 'planned' }, h6: { text: 'Site Visit', status: 'completed' }, h7: { text: 'Installation Work', status: 'planned' } }, planSent: true, planSentAt: '2026-11-16T12:00:00Z', submitted: true, submittedAt: today + 'T13:00:00Z' },
];
const headers = (table) => [...table.querySelectorAll('thead th')].map(th => th.textContent);
const tables = (host) => [...host.querySelectorAll('.card[data-card="daily-planning"] table, .card table')];

test('the whole-day slot now reads 6:00 AM – 8:00 PM', () => {
  expect(WHOLE_DAY_SLOT.label).toBe('6:00 AM – 8:00 PM (Whole day)');
  expect(WHOLE_DAY_SLOT.key).toBe('day');
});

test('both cards keep their columns and add Subject and View Planning; the Subject is the whole-day text, shortened', () => {
  mockAuth = { role: 'super_admin', user: users[0] };
  mockData = dataOf({ users, tracking });
  const { host, unmount } = mount(<Reports />);
  const planning = host.querySelector('[data-card="daily-planning"] table');
  expect(headers(planning)).toEqual(['Employee', 'Plan for', 'Submitted on', 'Submission status', 'Slots', 'Report', 'Subject', 'View Planning']);
  const reports = tables(host).find(t => headers(t)[1] === 'Work date');
  expect(headers(reports)).toEqual(['Employee', 'Work date', 'Status', 'Submitted at', 'Slots', 'Subject', 'View Planning']);
  const revRow = [...planning.querySelectorAll('tbody tr')].find(tr => /Revanth/.test(tr.textContent));
  const subject = revRow.querySelector('td[data-l="Subject"]');
  expect(subject.textContent).toContain('Whole day at the Tirupati site');
  expect(subject.textContent).toContain('…');
  expect(subject.textContent.length).toBeLessThan(long.length);
  expect(subject.querySelector('button[data-plan="subject"]')).toBeTruthy();
  expect(planning.querySelector('button[data-plan="view"]')).toBeTruthy();
  unmount();
});

test('View Planning opens every time slot with what was entered; the Subject icon opens the whole-day text in full', async () => {
  mockAuth = { role: 'super_admin', user: users[0] };
  mockData = dataOf({ users, tracking });
  const { host, unmount } = mount(<Reports />);
  const reports = tables(host).find(t => headers(t)[1] === 'Work date');
  await act(async () => { reports.querySelector('button[data-plan="view"]').click(); });
  let detail = host.querySelector('[data-plan="detail"]');
  expect(detail).toBeTruthy();
  const rows = [...detail.querySelectorAll('tbody tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent));
  expect(rows.length).toBe(16);                                        // whole day + 14 hourly + night
  expect(rows[0][0]).toBe('6:00 AM – 8:00 PM (Whole day)');
  expect(rows[0][1]).toBe(long);
  expect(rows.find(r => r[0] === '6:00 AM – 7:00 AM').slice(1)).toEqual(['Site Visit', 'Completed']);
  expect(rows.find(r => r[0] === '7:00 AM – 8:00 AM').slice(1)).toEqual(['Installation Work', 'Planned']);
  expect(rows.find(r => r[0] === '8:00 AM – 9:00 AM')[1]).toBe('—');  // an empty slot still listed
  await act(async () => { host.querySelector('.mx').click(); });
  expect(host.querySelector('[data-plan="detail"]')).toBeNull();
  await act(async () => { reports.querySelector('button[data-plan="subject"]').click(); });
  detail = host.querySelector('[data-plan="detail"]');
  expect(detail.textContent).toContain(long);
  expect(detail.querySelector('table')).toBeNull();
  unmount();
});
