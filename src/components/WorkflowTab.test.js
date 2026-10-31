// The 18-stage workflow on a customer (31-Oct): the Owner opens any stage,
// a reopen keeps every other stage's data, a deleted photo is logged and the
// Owner told, and the Sales Team is view-only on DISCOM Followup.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

let mockData = {};
let mockAuth = {};
const writes = [];
const logs = [];
const notes = [];
jest.mock('../context/DataContext', () => ({ useData: () => mockData }));
jest.mock('../context/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../context/ToastContext', () => ({ useToast: () => ({ toast: () => {} }) }));
jest.mock('../services/firestore', () => ({
  updateDocument: async (col, id, patch) => { writes.push([col, id, patch]); },
  logActivity: async (action, module, details) => { logs.push([action, module, details]); },
  createNotification: async (n) => { notes.push(n); },
}));
jest.mock('../services/api', () => ({ apiUpload: async () => ({ url: 'https://x/up.jpg' }) }));
const WorkflowTab = require('./WorkflowTab').default;

function mount(element) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(element); });
  return { host, unmount: () => { act(() => { root.unmount(); }); host.remove(); } };
}
const buttons = (host) => [...host.querySelectorAll('button')];
const byText = (host, re) => buttons(host).find(b => re.test(b.textContent));
const card = (host, key) => host.querySelector(`[data-stage="${key}"]`);

const users = [
  { id: 'u1', email: 'owner@x.com', displayName: 'Owner', role: 'super_admin' },
  { id: 'u2', email: 'rev@x.com', displayName: 'Revanth Reddy', role: 'executive' },
  { id: 'u3', email: 'bco@x.com', displayName: 'BCO Lakshmi', role: 'bco' },
  { id: 'u4', email: 'yog@x.com', displayName: 'K.J. Yogendra Reddy', role: 'sales_manager' },
];
const lead = { id: 'l1', name: 'Sai Krishna', phone: '9876543210', assignedTo: 'Revanth Reddy' };
const owner = { role: 'super_admin', user: users[0] };
const asUser = (i) => ({ role: users[i].role, user: users[i] });

beforeEach(() => {
  writes.length = 0; logs.length = 0; notes.length = 0;
  window.confirm = () => true;
  mockData = { users, leads: [lead], settings: {} };
});

test('the Owner opens a locked stage, completes it, and the earlier stages are left alone', async () => {
  mockAuth = owner;
  const customer = { id: 'c1', name: 'Sai Krishna', leadId: 'l1', workflow: { stages: {}, currentStage: 5 } };
  const { host, unmount } = mount(<WorkflowTab customer={customer} canEdit={true} />);
  expect(card(host, 'registration').dataset.status).toBe('current');
  expect(card(host, 'discom').dataset.status).toBe('locked');
  expect(host.textContent).toContain('As the Owner you may open and edit any stage');
  // every non-automatic stage carries an Open button for the Owner
  const open12 = buttons(card(host, 'discom')).find(b => /Open/.test(b.textContent));
  expect(open12).toBeTruthy();
  await act(async () => { open12.click(); });
  // Stage 12's editor is now showing, with its selects
  expect(card(host, 'discom').querySelector('select')).not.toBeNull();
  const complete = buttons(card(host, 'discom')).find(b => /Complete Stage/.test(b.textContent));
  expect(complete).toBeTruthy();
  expect(complete.disabled).toBe(false);           // the Owner may complete with fields empty
  await act(async () => { complete.click(); });
  expect(writes.length).toBe(1);
  const wf = writes[0][2].workflow;
  expect(wf.stages.discom.status).toBe('completed');
  expect(wf.stages.discom.completedBy).toBe('Owner');
  expect(wf.stages.registration).toBeUndefined();   // nothing before it was touched
  expect(wf.currentStage).toBe(5);                   // the sequence still points at Stage 5
  unmount();
});

test('a non-owner gets no Open button on locked stages and only the current stage is editable', () => {
  mockAuth = asUser(2);  // the BCO
  const customer = { id: 'c1', name: 'Sai Krishna', leadId: 'l1', workflow: { stages: {}, currentStage: 5 } };
  const { host, unmount } = mount(<WorkflowTab customer={customer} canEdit={true} />);
  expect(buttons(card(host, 'discom')).some(b => /Open/.test(b.textContent))).toBe(false);
  expect(card(host, 'discom').textContent).toContain('Locked');
  expect(buttons(card(host, 'registration')).some(b => /Complete Stage/.test(b.textContent))).toBe(true);
  unmount();
});

test('Reopen takes one tick off and keeps every other stage, data and all', async () => {
  mockAuth = { role: 'admin', user: { id: 'u9', email: 'admin@x.com', displayName: 'Admin', role: 'admin' } };
  const stages = {
    registration: { status: 'completed', regType: 'Cash', regNumber: 'R-1', regDate: '2026-10-01', completedBy: 'BCO', completedAt: '2026-10-01T00:00:00Z' },
    advance: { status: 'completed', advanceAmount: 10000, advanceDate: '2026-10-02', advanceMode: 'UPI', completedBy: 'Revanth', completedAt: '2026-10-02T00:00:00Z' },
    materialRequest: { status: 'completed', paymentStage: '90% Payment Received', materialRequestDate: '2026-10-03', completedBy: 'Accounts', completedAt: '2026-10-03T00:00:00Z' },
  };
  const customer = { id: 'c1', name: 'Sai Krishna', leadId: 'l1', workflow: { stages, currentStage: 8 } };
  const { host, unmount } = mount(<WorkflowTab customer={customer} canEdit={true} />);
  // open the completed Stage 5 summary, then Reopen
  await act(async () => { card(host, 'registration').querySelector('div').click(); });
  const reopen = buttons(card(host, 'registration')).find(b => /Reopen/.test(b.textContent));
  expect(reopen).toBeTruthy();
  await act(async () => { reopen.click(); });
  expect(writes.length).toBe(1);
  const wf = writes[0][2].workflow;
  expect(wf.stages.registration.status).toBe('in_progress');
  expect(wf.stages.registration.regNumber).toBe('R-1');          // its own data is kept
  expect(wf.stages.advance).toEqual(stages.advance);              // the later stages are untouched
  expect(wf.stages.materialRequest).toEqual(stages.materialRequest);
  expect(wf.currentStage).toBe(5);
  unmount();
});

test('deleting one photo keeps the others, is logged, and the Owner is told', async () => {
  mockAuth = owner;
  const photos = [{ url: 'https://x/sign1.jpg', name: 'sign1.jpg' }, { url: 'https://x/sign2.jpg', name: 'sign2.jpg' }];
  const stages = {
    registration: { status: 'completed' }, advance: { status: 'completed' }, materialRequest: { status: 'completed' },
    deliveryApproval: { status: 'in_progress', dcNumber: 'DC-9', customerSignPhoto: photos },
  };
  const customer = { id: 'c1', name: 'Sai Krishna', leadId: 'l1', workflow: { stages, currentStage: 8 } };
  const { host, unmount } = mount(<WorkflowTab customer={customer} canEdit={true} />);
  const c8 = card(host, 'deliveryApproval');
  expect(c8.dataset.status).toBe('current');
  expect(c8.querySelectorAll('[data-photos="customerSignPhoto"] img').length).toBe(2);
  const dels = buttons(c8).filter(b => /Delete/.test(b.textContent));
  expect(dels.length).toBe(2);                                    // each photo has its own Delete
  expect([...c8.querySelectorAll('label')].filter(l => /Change/.test(l.textContent)).length).toBe(2);   // and its own Change (a file picker)
  expect([...c8.querySelectorAll('label')].some(l => /Add another/.test(l.textContent))).toBe(true);
  await act(async () => { dels[0].click(); });
  expect(c8.querySelectorAll('[data-photos="customerSignPhoto"] img').length).toBe(1);
  await act(async () => { byText(c8, /Save Progress/).click(); });
  expect(writes.length).toBe(1);
  const saved = writes[0][2].workflow.stages.deliveryApproval;
  expect(saved.customerSignPhoto).toEqual([photos[1]]);
  expect(saved.dcNumber).toBe('DC-9');
  expect(logs.length).toBe(1);
  expect(logs[0][0]).toBe('Deleted Document');
  expect(logs[0][2]).toContain('Sai Krishna');
  expect(logs[0][2]).toContain('sign1.jpg');
  expect(logs[0][2]).toContain('Stage 8');
  expect(notes.length).toBe(1);                                    // one Owner on file
  expect(notes[0].forUser).toBe('Owner');
  expect(notes[0].message).toContain('sign1.jpg');
  expect(notes[0].message).toContain('Stage 8');
  unmount();
});

test('DISCOM Followup is view-only for the Sales Manager and editable for the BCO', () => {
  const stages = {};
  ['registration', 'advance', 'materialRequest', 'deliveryApproval', 'teamAllotment', 'installation', 'completionReports'].forEach(k => { stages[k] = { status: 'completed' }; });
  const customer = { id: 'c1', name: 'Sai Krishna', leadId: 'l1', workflow: { stages, currentStage: 12 } };
  mockAuth = asUser(3);  // Sales Manager
  let m = mount(<WorkflowTab customer={customer} canEdit={true} />);
  let c12 = card(m.host, 'discom');
  expect(c12.dataset.status).toBe('current');
  expect(c12.textContent).toContain('view only');
  expect(buttons(c12).some(b => /Complete Stage/.test(b.textContent))).toBe(false);
  m.unmount();
  mockAuth = asUser(2);  // the BCO
  m = mount(<WorkflowTab customer={customer} canEdit={true} />);
  c12 = card(m.host, 'discom');
  expect(c12.textContent).not.toContain('view only');
  expect(buttons(c12).some(b => /Complete Stage/.test(b.textContent))).toBe(true);
  m.unmount();
});

test('a stage the Owner closed to this person shows nothing of it', () => {
  mockAuth = { role: 'executive', user: { ...users[1], permissions: { customerStages: { registration: 'none' } } } };
  const customer = { id: 'c1', name: 'Sai Krishna', leadId: 'l1', workflow: { stages: { registration: { status: 'in_progress', regNumber: 'SECRET-1' } }, currentStage: 5 } };
  const { host, unmount } = mount(<WorkflowTab customer={customer} canEdit={true} />);
  const c5 = card(host, 'registration');
  expect(c5.textContent).toContain('You do not have access to this stage');
  expect(c5.querySelector('input')).toBeNull();
  expect(host.textContent).not.toContain('SECRET-1');
  unmount();
});
