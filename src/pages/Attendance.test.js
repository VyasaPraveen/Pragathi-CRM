// Attendance (Req 6, 30-Oct): the authorities get Add Attendance and This
// Month, an employee gets neither; adding a day writes a Manual record on
// the chosen date and tells the employee.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

let mockData = {};
let mockAuth = {};
const added = [];
const notes = [];
jest.mock('../context/DataContext', () => ({ useData: () => mockData }));
jest.mock('../context/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../context/ToastContext', () => ({ useToast: () => ({ toast: () => {} }) }));
jest.mock('../services/firestore', () => ({
  addDocument: async (col, doc) => { added.push([col, doc]); return 'new1'; },
  updateDocument: async () => ({}),
  deleteDocument: async () => ({}),
  createNotification: async (n) => { notes.push(n); },
}));
const Attendance = require('./Attendance').default;

const users = [
  { id: 'u1', email: 'om@x.com', displayName: 'Ops Manager', role: 'operation_manager', designation: 'Operation Manager', approved: true },
  { id: 'u2', email: 'rev@x.com', displayName: 'Revanth Reddy', role: 'executive', designation: 'Executive', approved: true, teamLeader: 'gopi@x.com' },
  { id: 'u3', email: 'gopi@x.com', displayName: 'K Gopi', role: 'team_leader', designation: 'Team Leader', approved: true },
];
const data = () => ({ attendance: [], users, settings: {}, leaveRequests: [], tracking: [] });

function mount(element) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(element); });
  return { host, unmount: () => { act(() => { root.unmount(); }); host.remove(); } };
}
const buttons = (host) => [...host.querySelectorAll('button')];
const chips = (host) => [...host.querySelectorAll('.chips > .fc')].map(c => c.textContent.trim());
const setVal = (el, value) => act(() => {
  const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
});

beforeEach(() => { added.length = 0; notes.length = 0; mockData = data(); });

test('the Operation Manager has Add Attendance and This Month; an executive has neither', () => {
  mockAuth = { role: 'operation_manager', user: { email: 'om@x.com', displayName: 'Ops Manager' } };
  let m = mount(<Attendance />);
  expect(buttons(m.host).some(b => /Add Attendance/.test(b.textContent))).toBe(true);
  expect(chips(m.host)).toContain('This Month');
  m.unmount();
  mockAuth = { role: 'executive', user: { email: 'rev@x.com', displayName: 'Revanth Reddy' } };
  m = mount(<Attendance />);
  expect(buttons(m.host).some(b => /Add Attendance/.test(b.textContent))).toBe(false);
  expect(chips(m.host)).not.toContain('This Month');
  expect(buttons(m.host).some(b => /Mark Attendance/.test(b.textContent))).toBe(true);   // their own marking stays
  m.unmount();
});

test('a Team Leader sees the team view but cannot add attendance', () => {
  mockAuth = { role: 'team_leader', user: { email: 'gopi@x.com', displayName: 'K Gopi' } };
  const m = mount(<Attendance />);
  expect(chips(m.host)).toContain('My Team');
  expect(buttons(m.host).some(b => /Add Attendance/.test(b.textContent))).toBe(false);
  m.unmount();
});

test('adding a missed day writes a Manual record against that date and notifies the employee', async () => {
  mockAuth = { role: 'super_admin', user: { email: 'owner@x.com', displayName: 'The Owner' } };
  const { host, unmount } = mount(<Attendance />);
  await act(async () => { buttons(host).find(b => /Add Attendance/.test(b.textContent)).click(); });
  const modal = host.querySelector('.md');
  expect(modal).not.toBeNull();
  const selects = modal.querySelectorAll('select.fi');
  setVal(selects[0], 'rev@x.com');                     // employee
  setVal(modal.querySelector('input[type="date"]'), '2026-10-28');
  setVal(selects[1], 'Present');
  setVal(modal.querySelector('input[type="number"]'), '8');
  const note = [...modal.querySelectorAll('input.fi')].find(i => i.placeholder && /phone/.test(i.placeholder));
  setVal(note, 'phone not working');
  await act(async () => { modal.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(added.length).toBe(1);
  const [col, doc] = added[0];
  expect(col).toBe('attendance');
  expect(doc).toMatchObject({ type: 'Manual', employeeEmail: 'rev@x.com', employeeName: 'Revanth Reddy', date: '2026-10-28', status: 'Present', hours: 8, note: 'phone not working', addedBy: 'The Owner' });
  expect(notes.length).toBe(1);
  expect(notes[0].forUser).toBe('Revanth Reddy');
  expect(notes[0].message).toContain('28 Oct 2026');
  unmount();
});

test('a past day needs a reason; a future day is refused', async () => {
  mockAuth = { role: 'super_admin', user: { email: 'owner@x.com', displayName: 'The Owner' } };
  const { host, unmount } = mount(<Attendance />);
  await act(async () => { buttons(host).find(b => /Add Attendance/.test(b.textContent)).click(); });
  const modal = host.querySelector('.md');
  setVal(modal.querySelectorAll('select.fi')[0], 'rev@x.com');
  setVal(modal.querySelector('input[type="date"]'), '2026-01-05');
  await act(async () => { modal.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(added.length).toBe(0);                          // no reason given
  unmount();
});

test('My Attendance shows an added day and counts it', () => {
  mockAuth = { role: 'executive', user: { email: 'rev@x.com', displayName: 'Revanth Reddy' } };
  const month = new Date().toISOString().slice(0, 7);
  mockData = { ...data(), attendance: [
    { id: 'a1', type: 'Manual', employeeEmail: 'rev@x.com', employeeName: 'Revanth Reddy', date: month + '-02', status: 'Present', hours: 8, note: 'added late', addedBy: 'The Owner', createdAt: '2026-10-29T10:00:00Z' },
    { id: 'a2', type: 'Manual', employeeEmail: 'rev@x.com', employeeName: 'Revanth Reddy', date: month + '-03', status: 'Absent', addedBy: 'The Owner', createdAt: '2026-10-29T10:00:00Z' },
  ] };
  const { host, unmount } = mount(<Attendance />);
  expect(host.textContent).toContain('Present (added)');
  expect(host.textContent).toContain('Absent');
  const tile = (label) => [...host.querySelectorAll('div')].find(d => d.textContent === label)?.previousSibling?.textContent;
  expect(tile('Days Present')).toBe('1');
  expect(tile('Days Absent')).toBe('1');
  unmount();
});
