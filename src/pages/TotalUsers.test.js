// Total Users (Req 5, 30-Oct): the teams come off the accounts, every
// person has their actions, and the status / move dialogs talk to the right
// routes with the Owner's choice.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

let mockAuth = {};
const calls = [];
const mockApi = {
  apiGet: async (path) => {
    if (path === '/auth/users') return { users: USERS };
    if (/\/records$/.test(path)) return { records: { leads: [{ id: 'L1', title: 'Mr Rao', status: 'Interested' }, { id: 'L2', title: 'Mr Das', status: 'Converted' }], customers: [], employeeTasks: [{ id: 'T1', title: 'Survey', status: 'Pending' }], installations: [], leadPOs: [] }, counts: { leads: 2, employeeTasks: 1 }, total: 3 };
    if (/\/history$/.test(path)) return { history: [{ id: 'h1', action: 'Account updated', user: 'Owner', details: 'phone', timestamp: '2026-10-30T05:00:00Z' }] };
    return {};
  },
  apiPost: async (path, body) => { calls.push([path, body]); return { ok: true, records: { leads: 1 }, membersMoved: 2 }; },
  apiPatch: async (path, body) => { calls.push([path, body]); return { ok: true }; },
  apiDelete: async (path) => { calls.push([path]); return { ok: true }; },
};
jest.mock('../services/api', () => mockApi);
jest.mock('../context/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../context/ToastContext', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }), { virtual: true });
jest.mock('../components/PasswordManager', () => ({ __esModule: true, default: () => null, generatePassword: () => 'PpsTemp123' }));

const USERS = [
  { id: 'o1', email: 'owner@x.com', displayName: 'The Owner', role: 'super_admin', designation: 'Super Admin', approved: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'tl1', email: 'gopi@x.com', displayName: 'K Gopi', role: 'team_leader', designation: 'Team Leader', approved: true, createdAt: '2026-02-01T00:00:00Z' },
  { id: 'tl2', email: 'murali@x.com', displayName: 'P Murali', role: 'team_leader', designation: 'Team Leader', approved: true, teamName: 'Chittoor Team', createdAt: '2026-03-01T00:00:00Z' },
  { id: 'm1', email: 'rev@x.com', displayName: 'Revanth Reddy', role: 'executive', designation: 'Executive', approved: true, teamLeader: 'gopi@x.com', session: { active: true, seen: '2026-10-30T04:00:00Z' } },
  { id: 'm2', email: 'sai@x.com', displayName: 'Sai', role: 'executive', designation: 'Executive', approved: true, teamLeader: 'gopi@x.com', status: 'hold' },
  { id: 'm3', email: 'ravi@x.com', displayName: 'Ravi', role: 'technician', designation: 'Technician', approved: true, teamLeader: 'murali@x.com', status: 'deactivated' },
  { id: 'acc', email: 'acc@x.com', displayName: 'The Accountant', role: 'accountant', designation: 'Accountant', approved: true },
  { id: 'free', email: 'new@x.com', displayName: 'Newcomer', role: 'executive', designation: 'Executive', approved: true },
];

function mount(element) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(element); });
  return { host, unmount: () => { act(() => { root.unmount(); }); host.remove(); } };
}
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
const btn = (host, title) => [...host.querySelectorAll('button, .fc')].find(b => b.getAttribute('title') === title || b.textContent.trim() === title);
const rowOf = (host, name) => [...host.querySelectorAll('tbody tr')].find(tr => tr.textContent.includes(name));
const TotalUsers = require('./TotalUsers').default;

beforeEach(() => { mockAuth = { role: 'super_admin', user: { id: 'o1', email: 'owner@x.com', displayName: 'The Owner' } }; calls.length = 0; window.confirm = jest.fn(() => true); });

test('the teams, the other users and the counts come off the accounts', async () => {
  const { host, unmount } = mount(<TotalUsers />);
  await flush();
  const text = host.textContent;
  expect(text).toContain('Team 1');                 // K Gopi's team, unnamed → numbered
  expect(text).toContain('Chittoor Team');          // P Murali's team, named
  expect(text).toContain('Leader: K Gopi');
  expect(text).toContain('Other users');
  expect(text).toContain('Not in a team');
  // the summary table: two teams with their member counts
  const summary = [...host.querySelectorAll('tbody tr')].filter(tr => /Team 1|Chittoor Team/.test(tr.textContent) && tr.querySelector('td.m-h strong'));
  expect(summary.length).toBe(2);
  expect(summary[0].textContent).toContain('K Gopi');
  // counts: 8 users, 2 teams, 1 on hold, 1 deactivated, 1 not in a team
  const stats = [...host.querySelectorAll('.sg .card')].map(c => c.textContent);
  expect(stats.some(s => /2\s*Teams/.test(s))).toBe(true);
  expect(stats.some(s => /8\s*Users/.test(s))).toBe(true);
  expect(stats.some(s => /1\s*On hold/.test(s))).toBe(true);
  expect(stats.some(s => /1\s*Deactivated/.test(s))).toBe(true);
  expect(stats.some(s => /1\s*Not in a team/.test(s))).toBe(true);
  unmount();
});

test('a person on hold gets "Remove hold", a deactivated one "Reactivate", the Owner cannot act on themselves', async () => {
  const { host, unmount } = mount(<TotalUsers />);
  await flush();
  // open every section so every row renders
  await act(async () => { btn(host, 'Expand all').click(); });
  const sai = rowOf(host, 'Sai');
  expect([...sai.querySelectorAll('button')].some(b => b.getAttribute('title') === 'Remove hold')).toBe(true);
  expect([...sai.querySelectorAll('button')].some(b => b.getAttribute('title') === 'Put on hold')).toBe(false);
  const ravi = rowOf(host, 'Ravi');
  expect([...ravi.querySelectorAll('button')].some(b => b.getAttribute('title') === 'Reactivate')).toBe(true);
  const owner = rowOf(host, 'The Owner');
  expect(owner.textContent).toContain('(you)');
  ['Put on hold', 'Deactivate', 'Delete account'].forEach(t => expect([...owner.querySelectorAll('button')].some(b => b.getAttribute('title') === t)).toBe(false));
  // the signed-in device shows, with its release button
  const rev = rowOf(host, 'Revanth Reddy');
  expect(rev.textContent).toContain('Signed in');
  expect([...rev.querySelectorAll('button')].some(b => b.getAttribute('title') === 'Release device')).toBe(true);
  unmount();
});

test('hold sends the status with the note', async () => {
  const { host, unmount } = mount(<TotalUsers />);
  await flush();
  await act(async () => { btn(host, 'Expand all').click(); });
  const rev = rowOf(host, 'Revanth Reddy');
  await act(async () => { [...rev.querySelectorAll('button')].find(b => b.getAttribute('title') === 'Put on hold').click(); });
  expect(host.textContent).toContain('Put on hold — Revanth Reddy');
  const note = host.querySelector('.md input.fi');
  await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(note, 'On leave'); note.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => { [...host.querySelectorAll('.md button')].find(b => b.textContent.trim() === 'Put on hold').click(); });
  expect(calls).toContainEqual(['/users/m1/status', { status: 'hold', note: 'On leave' }]);
  unmount();
});

test('moving a person: the Owner picks the records that move, the rest stay', async () => {
  const { host, unmount } = mount(<TotalUsers />);
  await flush();
  await act(async () => { btn(host, 'Expand all').click(); });
  const rev = rowOf(host, 'Revanth Reddy');
  await act(async () => { [...rev.querySelectorAll('button')].find(b => b.getAttribute('title') === 'Move to another team / change role').click(); });
  const selects = host.querySelectorAll('.md select.fi');
  await act(async () => { selects[0].value = 'murali@x.com'; selects[0].dispatchEvent(new Event('change', { bubbles: true })); });
  // choose "Move the records I pick", then tick one lead
  const radios = host.querySelectorAll('.md input[type="radio"]');
  await act(async () => { radios[0].click(); });
  await flush();
  expect(host.textContent).toContain('Leads (2)');
  const boxes = host.querySelectorAll('.md input[type="checkbox"]');
  await act(async () => { boxes[0].click(); });
  await act(async () => { [...host.querySelectorAll('.md button')].find(b => b.textContent.trim() === 'Apply').click(); });
  const call = calls.find(c => c[0] === '/users/m1/reassign');
  expect(call).toBeTruthy();
  expect(call[1].teamLeader).toBe('murali@x.com');
  expect(call[1].recordMode).toBe('selected');
  expect(call[1].records.leads).toEqual(['L1']);
  expect(call[1].toUserId).toBeUndefined();
  unmount();
});

test('"only new work from now on" sends no records', async () => {
  const { host, unmount } = mount(<TotalUsers />);
  await flush();
  await act(async () => { btn(host, 'Expand all').click(); });
  const rev = rowOf(host, 'Revanth Reddy');
  await act(async () => { [...rev.querySelectorAll('button')].find(b => b.getAttribute('title') === 'Move to another team / change role').click(); });
  const radios = host.querySelectorAll('.md input[type="radio"]');
  await act(async () => { radios[1].click(); });
  await act(async () => { [...host.querySelectorAll('.md button')].find(b => b.textContent.trim() === 'Apply').click(); });
  const call = calls.find(c => c[0] === '/users/m1/reassign');
  expect(call[1].recordMode).toBe('fresh');
  expect(call[1].teamLeader).toBeUndefined();     // the team was not changed
  unmount();
});

test('changing a Team Leader names the team, the new leader and what the old one becomes', async () => {
  const { host, unmount } = mount(<TotalUsers />);
  await flush();
  await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent.includes('Change leader')).click(); });
  expect(host.textContent).toContain('Change the Team Leader — Team 1');
  const sel = host.querySelector('.md select.fi');
  await act(async () => { sel.value = 'm1'; sel.dispatchEvent(new Event('change', { bubbles: true })); });
  await act(async () => { [...host.querySelectorAll('.md button')].find(b => b.textContent.trim() === 'Change leader').click(); });
  const call = calls.find(c => c[0] === '/users/m1/make-leader');
  expect(call).toBeTruthy();
  expect(call[1]).toMatchObject({ fromLeaderId: 'tl1', previousStays: true, previousDesignation: 'Executive', recordMode: 'keep' });
  unmount();
});

test('delete asks for the word, shows the impact and offers deactivation instead', async () => {
  const { host, unmount } = mount(<TotalUsers />);
  await flush();
  await act(async () => { btn(host, 'Expand all').click(); });
  const rev = rowOf(host, 'Revanth Reddy');
  await act(async () => { [...rev.querySelectorAll('button')].find(b => b.getAttribute('title') === 'Delete account').click(); });
  await flush();
  expect(host.textContent).toContain('3 open record(s) are linked');
  const del = [...host.querySelectorAll('.md button')].find(b => b.textContent.trim() === 'Delete');
  expect(del.disabled).toBe(true);
  const word = host.querySelector('.md input.fi');
  await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(word, 'DELETE'); word.dispatchEvent(new Event('input', { bubbles: true })); });
  expect([...host.querySelectorAll('.md button')].find(b => b.textContent.trim() === 'Delete').disabled).toBe(false);
  await act(async () => { [...host.querySelectorAll('.md button')].find(b => b.textContent.trim() === 'Deactivate instead').click(); });
  expect(host.textContent).toContain('Deactivate — Revanth Reddy');
  unmount();
});

test('an Admin (not the Owner) is shown nothing here', async () => {
  mockAuth = { role: 'executive', user: { id: 'm1', email: 'rev@x.com' } };
  const { host, unmount } = mount(<TotalUsers />);
  await flush();
  expect(host.textContent).toBe('');
  unmount();
});
