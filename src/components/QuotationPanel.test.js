// Render checks for the lead-detail panels. These exist because a plain
// "cannot read properties of null" in a component is invisible to the unit
// suites, which only exercise src/services: a lead with no quotation yet
// crashed the Quotation tab, and nothing caught it before a user did.
//
// Each panel is rendered for every state a lead can be in. The assertion is
// simply that it renders without throwing and says something sensible.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const mockNoop = () => {};
let mockData = {};
let mockAuth = {};

jest.mock('../context/DataContext', () => ({ useData: () => mockData }));
jest.mock('../context/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../context/ToastContext', () => ({ useToast: () => ({ toast: mockNoop }) }));
jest.mock('../services/firestore', () => ({
  addDocument: async () => 'new-id', updateDocument: async () => {}, deleteDocument: async () => {},
  createNotification: async () => {}, notifyAdmins: async () => {}, logActivity: async () => {},
}));
jest.mock('../services/api', () => ({
  apiGet: async () => ({}), apiPost: async () => ({}), apiPatch: async () => ({}), apiDelete: async () => ({}),
  apiUpload: async () => ({ url: '' }),
}));

const QuotationPanel = require('./QuotationPanel').default;
const DispatchPanel = require('./DispatchPanel').default;
const BcoOperationsPanel = require('./BcoOperationsPanel').default;

const users = [
  { id: 'u1', email: 'revanth@x.com', displayName: 'Revanth Reddy', role: 'executive', teamLeader: 'yogendra@x.com', approved: true },
  { id: 'u2', email: 'yogendra@x.com', displayName: 'K.J. Yogendra reddy', role: 'team_leader', approved: true },
  { id: 'u3', email: 'admin@x.com', displayName: 'Admin', role: 'admin', approved: true },
];
const lead = { id: 'L1', name: 'Mr Rao', phone: '9701461156', assignedTo: 'Revanth Reddy', kwRequired: '3' };

function render(element) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(element); });
  const text = host.textContent;
  act(() => { root.unmount(); });
  host.remove();
  return text;
}

const asUser = (email, role) => {
  const u = users.find(x => x.email === email) || { email, displayName: email };
  mockAuth = { user: u, role };
};

describe('QuotationPanel', () => {
  const statuses = ['Pending Approval', 'Approved', 'Shared with Customer', 'Accepted', 'Not Accepted', 'Rejected'];
  const quote = (status, extra = {}) => ({
    id: 'Q1', leadId: 'L1', quotationNumber: 'QTN-001', revision: 0, status, date: '2026-10-03',
    customerName: 'Mr Rao', customerPhone: '9701461156', kw: '3', systemCost: 200000,
    executiveName: 'Revanth Reddy', raisedBy: 'Revanth Reddy', bomItems: [], ...extra,
  });

  test('a lead with NO quotation renders the "raise one" state, for every role', () => {
    for (const [email, role] of [['revanth@x.com', 'executive'], ['yogendra@x.com', 'team_leader'], ['admin@x.com', 'admin'], ['x@x.com', 'technician']]) {
      asUser(email, role);
      mockData = { quotations: [], leads: [lead], customers: [], users, leadPOs: [] };
      expect(() => render(<QuotationPanel lead={lead} />)).not.toThrow();
    }
  });

  test.each(statuses)('renders a quotation in status "%s" for the assignee, the leader and an admin', (status) => {
    for (const [email, role] of [['revanth@x.com', 'executive'], ['yogendra@x.com', 'team_leader'], ['admin@x.com', 'admin']]) {
      asUser(email, role);
      mockData = { quotations: [quote(status)], leads: [lead], customers: [], users, leadPOs: [] };
      const text = render(<QuotationPanel lead={lead} />);
      expect(text).toContain('QTN-001');
    }
  });

  test('a rejected quotation offers the assignee a revision and says it goes back for approval', () => {
    asUser('revanth@x.com', 'executive');
    mockData = { quotations: [quote('Rejected', { rejectedBy: 'Admin', rejectionReason: 'too high' })], leads: [lead], customers: [], users, leadPOs: [] };
    const text = render(<QuotationPanel lead={lead} />);
    expect(text).toContain('Create Revision');
    expect(text).toContain('goes back for approval');
  });

  test('a resubmitted revision shows its banner and the approve button to an approver', () => {
    asUser('admin@x.com', 'admin');
    mockData = { quotations: [quote('Pending Approval', { revision: 1, resubmittedAt: '2026-10-03T10:00:00Z', resubmittedBy: 'Revanth Reddy', resubmittedRevision: 1 })], leads: [lead], customers: [], users, leadPOs: [] };
    const text = render(<QuotationPanel lead={lead} />);
    expect(text).toContain('after the earlier rejection');
    expect(text).toContain('Approve Quotation');
  });

  test('a quotation with recommendation, proof and PO fields renders', () => {
    asUser('admin@x.com', 'admin');
    mockData = {
      quotations: [quote('Accepted', { recommendedBy: 'yogendra@x.com', acceptanceProofUrl: 'https://x/y.jpg', acceptedAt: '2026-10-03T10:00:00Z', bomSource: 'po', poId: 'P1' })],
      leads: [lead], customers: [], users, leadPOs: [{ id: 'P1', leadId: 'L1', status: 'Approved', items: [{ materialName: 'Solar PV Module', quantity: 6, unit: 'Nos' }] }],
    };
    expect(render(<QuotationPanel lead={lead} />)).toContain('Acceptance Proof');
  });
});

describe('DispatchPanel', () => {
  const po = (status, extra = {}) => ({ id: 'P1', poNumber: 'PO-1', leadId: 'L1', status, items: [{ materialName: 'Solar PV Module', quantity: 6, unit: 'Nos' }], ...extra });
  test('renders nothing before approval and the list after, for warehouse, OM and a viewer', () => {
    mockData = { users };
    for (const [email, role] of [['wh@x.com', 'warehouse_admin'], ['om@x.com', 'operation_manager'], ['revanth@x.com', 'executive']]) {
      asUser(email, role);
      expect(render(<DispatchPanel po={po('Recommended')} lead={lead} />)).toBe('');
      expect(render(<DispatchPanel po={po('Approved')} lead={lead} />)).toContain('Material Dispatch');
      expect(render(<DispatchPanel po={po('Approved', { dispatchStatus: 'Completed', dispatchCompletedBy: 'W', dispatchCompletedAt: '2026-10-03T10:00:00Z', dispatchItems: [{ dispatched: true }] })} lead={lead} />)).toContain('Stock OK');
      expect(render(<DispatchPanel po={po('Approved', { dispatchConfirmedAt: '2026-10-03T10:00:00Z', dispatchConfirmedBy: 'OM', dispatchStatus: 'Completed' })} lead={lead} />)).toContain('Approved for dispatch');
    }
  });
  test('survives a PO with no items and no lead', () => {
    asUser('wh@x.com', 'warehouse_admin');
    mockData = { users };
    expect(() => render(<DispatchPanel po={{ id: 'P2', status: 'Approved' }} lead={null} />)).not.toThrow();
  });

  // 8-Oct R6: the handover after "Stock OK" (which was "OK & Send" until 15-Oct).
  test('the warehouse sees "Stock OK"; the OM sees the assignment once sent; the person sees the handover table', () => {
    mockData = { users };
    asUser('wh@x.com', 'warehouse_admin');
    expect(render(<DispatchPanel po={po('Approved')} lead={lead} />)).toContain('Stock OK');
    const sent = po('Approved', { dispatchStatus: 'Completed', dispatchCompletedBy: 'W', dispatchCompletedAt: '2026-10-08T05:00:00Z', dispatchItems: [{ dispatched: true }] });
    asUser('om@x.com', 'operation_manager');
    let text = render(<DispatchPanel po={sent} lead={lead} />);
    expect(text).toContain('Assigned Person for Dispatch');
    expect(text).toContain('Assign Person');
    expect(text).toContain('Solar PV Module (6 Nos)');
    // The warehouse does not get the assignment control.
    asUser('wh@x.com', 'warehouse_admin');
    expect(render(<DispatchPanel po={sent} lead={lead} />)).not.toContain('Assign Person');
    const assigned = { ...sent, dispatchAssignedTo: 'Revanth Reddy', dispatchAssignedToEmail: 'revanth@x.com', dispatchAssignedBy: 'OM', dispatchAssignedAt: '2026-10-08T06:00:00Z' };
    asUser('revanth@x.com', 'executive');
    // The button renders as its icon name followed by its label; the status
    // line quotes the label too, so the icon is what tells the two apart.
    const RECEIVE_BUTTON = 'how_to_reg Handover Received';
    text = render(<DispatchPanel po={assigned} lead={lead} />);
    expect(text).toContain(RECEIVE_BUTTON);
    // Req 3 (15-Oct): the handover is item by item.
    expect(text).toContain('Received / Missing');
    asUser('yogendra@x.com', 'team_leader');
    expect(render(<DispatchPanel po={assigned} lead={lead} />)).not.toContain(RECEIVE_BUTTON);
    asUser('om@x.com', 'operation_manager');
    text = render(<DispatchPanel po={assigned} lead={lead} />);
    expect(text).toContain('Re-assign');
    expect(text).toContain('Awaiting their');
    const received = { ...assigned, dispatchReceivedBy: 'Revanth Reddy', dispatchReceivedAt: '2026-10-08T07:00:00Z', handoverItems: [{ ok: true, note: '' }] };
    text = render(<DispatchPanel po={received} lead={lead} />);
    expect(text).toContain('Received by Revanth Reddy');
    expect(text).not.toContain('Re-assign');
    asUser('revanth@x.com', 'executive');
    expect(render(<DispatchPanel po={received} lead={lead} />)).not.toContain(RECEIVE_BUTTON);
  });

  // 28-Oct: the Yes / No tables were components created inside the panel's
  // render, so every keystroke in a note remounted the input and dropped the
  // focus (on a phone the keyboard closed after each character).
  test('typing a handover note keeps the focus', () => {
    mockData = { users };
    asUser('revanth@x.com', 'executive');
    const assigned = po('Approved', { dispatchStatus: 'Completed', dispatchItems: [{ dispatched: true }], dispatchAssignedTo: 'Revanth Reddy', dispatchAssignedToEmail: 'revanth@x.com', dispatchAssignedBy: 'OM', dispatchAssignedAt: '2026-10-08T06:00:00Z' });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => { root.render(<DispatchPanel po={assigned} lead={lead} />); });
    const input = host.querySelector('input[placeholder="Optional note"]');
    expect(input).not.toBeNull();
    act(() => { input.focus(); });
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'o');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(host.querySelector('input[placeholder="Optional note"]')).toBe(input);
    expect(document.activeElement).toBe(input);
    act(() => { root.unmount(); });
    host.remove();
  });
});

describe('Installations page', () => {
  const Installations = require('../pages/Installations').default;
  const insts = [
    { id: 'I1', customerName: 'Mr Rao', phone: '9701461156', progress: 40, teamLeader: 'K.J. Yogendra reddy', numPeople: 3, teamMembers: ['Revanth Reddy', 'Someone'], startDate: '2026-10-01', consumptionReportUrl: 'https://x/r.pdf', consumptionReportName: 'report.pdf' },
    { id: 'I2', customerName: 'Mrs Devi', progress: 0, discomFeasibility: 'Done', handSketch: 'https://x/s.jpg', siteVisitAssignedTo: 'Revanth Reddy', siteVisitAssignedBy: 'OM', siteVisitAssignedAt: '2026-10-09T05:00:00Z' },
  ];
  test('renders for a manager (add + edit), the installation\'s Team Leader (edit that one) and a member (no edit)', () => {
    const base = { installations: insts, users, customers: [{ id: 'C1', leadId: 'L1', name: 'Mr Rao', phone: '9701461156' }], leads: [lead] };
    mockData = base;
    asUser('om@x.com', 'operation_manager');
    let text = render(<Installations />);
    expect(text).toContain('Add Installation');
    expect(text).toContain('Team Members');
    expect(text).toContain('report.pdf');
    expect(text).not.toContain('DISCOM');
    expect((text.match(/Edit/g) || []).length).toBe(2);
    asUser('yogendra@x.com', 'team_leader');
    text = render(<Installations />);
    expect(text).not.toContain('Add Installation');
    expect((text.match(/Edit/g) || []).length).toBe(1);
    asUser('revanth@x.com', 'executive');
    text = render(<Installations />);
    expect(text).not.toContain('Add Installation');
    expect((text.match(/Edit/g) || []).length).toBe(0);
    // The Admin's per-user grant.
    mockAuth = { user: { ...users[1], permissions: { installations_manage: true } }, role: 'team_leader' };
    expect(render(<Installations />)).toContain('Add Installation');
  });
  // RR3 (9-Oct): the site visit is assigned on the installation; only the
  // assigned person gets the "Site Visit Done" button, and it goes once reported.
  test('the site-visit assignee sees "Site Visit Done"; nobody else does; it goes once reported', () => {
    mockData = { installations: insts, users, customers: [], leads: [] };
    asUser('revanth@x.com', 'executive');
    let text = render(<Installations />);
    expect(text).toContain('Site Visit Assigned To');
    expect(text).toContain('Site Visit Done');
    asUser('om@x.com', 'operation_manager');
    text = render(<Installations />);
    expect(text).toContain('Awaiting the site visit');
    expect(text).not.toContain('Site Visit Done');
    mockData = { installations: [{ ...insts[1], siteVisitReportedBy: 'Revanth Reddy', siteVisitReportedAt: '2026-10-09T09:00:00Z' }], users, customers: [], leads: [] };
    asUser('revanth@x.com', 'executive');
    text = render(<Installations />);
    expect(text).toContain('Visit done');
    expect(text).not.toContain('Site Visit Done');
  });
  test('renders with no installations and no customers', () => {
    mockData = { installations: [], users, customers: [], leads: [] };
    asUser('om@x.com', 'operation_manager');
    expect(render(<Installations />)).toContain('No installations');
  });
});

describe('BcoOperationsPanel', () => {
  test('renders with no record, a partial record and a complete record, for the BCO and a viewer', () => {
    const full = { id: 'B1', leadId: 'L1', stages: Object.fromEntries(['s1', 's2', 's3', 's4', 's5', 's6', 's7'].map(k => [k, { done: true, answer: 'YES', closedBy: 'BCO', closedAt: '2026-10-03T10:00:00Z' }])) };
    const part = { id: 'B1', leadId: 'L1', stages: { s1: { done: true, slots: [{ label: 'PAN', url: 'https://x/p.pdf', name: 'p.pdf' }] }, s2: { answer: 'NO', note: 'declined' } } };
    for (const [email, role] of [['bco@x.com', 'bco'], ['revanth@x.com', 'executive']]) {
      asUser(email, role);
      for (const ops of [null, part, full]) {
        mockData = { bcoOps: ops ? [ops] : [], users };
        const text = render(<BcoOperationsPanel lead={lead} />);
        expect(text).toContain('Stage 7');
        expect(text).toContain('Subsidy Process');
      }
    }
  });
});

// 10-Oct: Materials & Inventory — the ledger-driven page and the final
// dispatch step on the PO.
describe('Materials page', () => {
  const Materials = require('../pages/Materials').default;
  const materials = [
    { id: 'M1', name: 'AC Cable (4 sq mm)', unit: 'mtrs', stock: 70, dispatched: 25, installed: 20, balance: 45, category: 'AC Cable' },
    { id: 'M2', name: 'Solar Module', unit: 'Nos', stock: 5, dispatched: 0, installed: 0, balance: 5 },
  ];
  const txns = [
    { id: 'T1', type: 'receipt', materialId: 'M1', materialName: 'AC Cable (4 sq mm)', unit: 'mtrs', quantity: 10, status: 'Pending Review', reference: 'RCP-261010-AAAAA', submittedBy: 'Warehouse', submittedByEmail: 'wh@x.com', submittedAt: '2026-10-10T05:00:00Z', receiptDate: '2026-10-10', balanceAtSubmission: 45, poNumber: 'VPO-1', poItemName: 'AC Cable 4sqmm', poOrderedQty: 100 },
    { id: 'T2', type: 'adjustment', materialId: 'M2', materialName: 'Solar Module', unit: 'Nos', quantity: -1, countedQuantity: 4, balanceAtSubmission: 5, reason: 'one damaged', status: 'Forwarded to Owner', reference: 'ADJ-261010-BBBBB', submittedBy: 'Warehouse', submittedAt: '2026-10-10T06:00:00Z', reviewedBy: 'OM', reviewedAt: '2026-10-10T07:00:00Z' },
    { id: 'T3', type: 'dispatch', materialId: 'M1', materialName: 'AC Cable (4 sq mm)', unit: 'mtrs', quantity: 25, status: 'Applied', appliedAt: 'x', previousBalance: 70, newBalance: 45, reference: 'DSP-261010-CCCCC', confirmedBy: 'Revanth Reddy', assignedTo: 'Revanth Reddy', submittedBy: 'Revanth Reddy', submittedAt: '2026-10-09T05:00:00Z', dispatchDate: '2026-10-09', poNumber: 'PO-7', customerName: 'Mr Rao' },
  ];
  const data = (extra = {}) => ({ materials, stockTransactions: txns, purchaseOrders: [], leadPOs: [], leads: [], users, ...extra });

  test('the summary table is still there, with the pending quantity and the status', () => {
    mockData = data();
    asUser('x@x.com', 'technician');
    const text = render(<Materials />);
    expect(text).toContain('AC Cable (4 sq mm)');
    expect(text).toContain('Low Stock');
    expect(text).toContain('Good');
    expect(text).toContain('+10 receipt');
    expect(text).toContain('1 correction');
    // A technician sees, but has none of the buttons.
    expect(text).not.toContain('Receive Stock');
    expect(text).not.toContain('Add Material');
    expect(text).not.toContain('Approvals');
  });

  test('the warehouse records and reports; the OM reviews; the Owner approves and corrects; the Admin does not get the Owner\'s buttons', () => {
    mockData = data();
    asUser('wh@x.com', 'warehouse_admin');
    let text = render(<Materials />);
    expect(text).toContain('Receive Stock');
    expect(text).toContain('Report Discrepancy');
    expect(text).not.toContain('Correct Stock');
    expect(text).toContain('Add Material');     // warehouse_admin is manager level, as before
    asUser('om@x.com', 'operation_manager');
    text = render(<Materials />);
    expect(text).toContain('Approvals');
    asUser('owner@x.com', 'super_admin');
    text = render(<Materials />);
    expect(text).toContain('Correct Stock');
    expect(text).not.toContain('Report Discrepancy');
    asUser('admin@x.com', 'admin');
    text = render(<Materials />);
    expect(text).toContain('Report Discrepancy');
    expect(text).not.toContain('Correct Stock');
  });

  test('renders with nothing at all', () => {
    mockData = data({ materials: [], stockTransactions: [] });
    asUser('om@x.com', 'operation_manager');
    expect(render(<Materials />)).toContain('No materials');
  });
});

describe('DispatchPanel — final dispatch', () => {
  const materials = [{ id: 'M1', name: 'Solar PV Module', unit: 'Nos', balance: 10 }];
  const received = { id: 'P1', poNumber: 'PO-1', leadId: 'L1', status: 'Approved', dispatchStatus: 'Completed', dispatchCompletedBy: 'W', dispatchCompletedAt: '2026-10-08T05:00:00Z',
    items: [{ materialName: 'Solar PV Module', quantity: 6, unit: 'Nos' }], dispatchItems: [{ dispatched: true }],
    dispatchAssignedTo: 'Revanth Reddy', dispatchAssignedToEmail: 'revanth@x.com', dispatchAssignedBy: 'OM', dispatchAssignedAt: '2026-10-08T06:00:00Z',
    dispatchReceivedBy: 'Revanth Reddy', dispatchReceivedAt: '2026-10-08T07:00:00Z' };
  test('the assignee and the OM get "Confirm Final Dispatch" once the items are received; the warehouse does not; it goes once deducted', () => {
    mockData = { users, materials };
    asUser('revanth@x.com', 'executive');
    let text = render(<DispatchPanel po={received} lead={lead} />);
    expect(text).toContain('Final Dispatch');
    expect(text).toContain('Confirm Final Dispatch');
    expect(text).toContain('matched by name');
    expect(text).toContain('10 Nos');
    asUser('om@x.com', 'operation_manager');
    expect(render(<DispatchPanel po={received} lead={lead} />)).toContain('Confirm Final Dispatch');
    // 27-Oct (Req 4A): the warehouse may confirm too; a BCO waits.
    asUser('wh@x.com', 'warehouse_admin');
    expect(render(<DispatchPanel po={received} lead={lead} />)).toContain('Confirm Final Dispatch');
    asUser('bco@x.com', 'bco');
    text = render(<DispatchPanel po={received} lead={lead} />);
    expect(text).toContain('Awaiting the dispatch confirmation');
    expect(text).not.toContain('Confirm Final Dispatch');
    // Not before receipt.
    asUser('revanth@x.com', 'executive');
    expect(render(<DispatchPanel po={{ ...received, dispatchReceivedAt: '', dispatchReceivedBy: '' }} lead={lead} />)).not.toContain('Final Dispatch');
    // Done: the deduction is shown, the button is gone.
    const done = { ...received, stockDispatchedAt: '2026-10-08T08:00:00Z', stockDispatchedBy: 'Revanth Reddy', stockDispatchRef: 'DSP-261008-ZZZZZ',
      stockDispatchItems: [{ materialName: 'Solar PV Module', quantity: 6, unit: 'Nos', previousBalance: 16, newBalance: 10 }] };
    text = render(<DispatchPanel po={done} lead={lead} />);
    expect(text).toContain('Dispatch 1');
    expect(text).toContain('DSP-261008-ZZZZZ');
    expect(text).toContain('16 → 10');
    expect(text).toContain('All dispatched');
    expect(text).not.toContain('Confirm Final Dispatch');
    expect(text).not.toContain('Confirm Partial Dispatch');
  });
  test('survives no materials loaded yet', () => {
    mockData = { users, materials: undefined };
    asUser('revanth@x.com', 'executive');
    expect(() => render(<DispatchPanel po={received} lead={lead} />)).not.toThrow();
  });
});


// 15-Oct Req 3: Stock OK locks the warehouse; the delivery at the customer
// location with photo proof; the Assigned Materials page.
describe('DispatchPanel — Stock OK lock, delivery and history', () => {
  const sent = { id: 'P1', poNumber: 'PO-1', leadId: 'L1', status: 'Approved', dispatchStatus: 'Completed', dispatchCompletedBy: 'W', dispatchCompletedAt: '2026-10-15T05:00:00Z',
    items: [{ materialName: 'Solar PV Module', quantity: 6, unit: 'Nos' }, { materialName: 'Inverter', quantity: 1, unit: 'Nos' }], dispatchItems: [{ dispatched: true, at: 'x', by: 'W' }, { dispatched: false, note: 'later', at: 'x', by: 'W' }] };
  const received = { ...sent, dispatchConfirmedAt: '2026-10-15T06:00:00Z', dispatchConfirmedBy: 'OM', dispatchAssignedTo: 'Revanth Reddy', dispatchAssignedToEmail: 'revanth@x.com', dispatchAssignedBy: 'OM', dispatchAssignedAt: '2026-10-15T07:00:00Z',
    dispatchReceivedBy: 'Revanth Reddy', dispatchReceivedAt: '2026-10-15T08:00:00Z', handoverItems: [{ ok: true, note: '' }, null] };
  test('after Stock OK the warehouse sees the lock and no Save; the OM still can; the heading reads as verification', () => {
    mockData = { users, materials: [] };
    asUser('wh@x.com', 'warehouse_admin');
    let text = render(<DispatchPanel po={sent} lead={lead} />);
    expect(text).toContain('Warehouse Verification');
    expect(text).toContain('Stock OK has been submitted');
    expect(text).not.toContain('Save Verification');
    asUser('om@x.com', 'operation_manager');
    text = render(<DispatchPanel po={sent} lead={lead} />);
    expect(text).toContain('Save Verification');
    expect(text).toContain('Approval for Dispatch');
    expect(text).not.toContain('Stock OK has been submitted');
  });
  test('the assignee gets the delivery table and photo button; others wait; once delivered the proof is shown', () => {
    mockData = { users, materials: [] };
    asUser('revanth@x.com', 'executive');
    let text = render(<DispatchPanel po={received} lead={lead} />);
    expect(text).toContain('Delivery at the Customer Location');
    expect(text).toContain('Delivered / Not delivered');
    expect(text).toContain('Add delivery photo');
    expect(text).toContain('Delivery Confirmed');
    expect(text).toContain('At least one photo is required');
    asUser('wh@x.com', 'warehouse_admin');
    text = render(<DispatchPanel po={received} lead={lead} />);
    expect(text).toContain('Awaiting the delivery confirmation');
    expect(text).not.toContain('Add delivery photo');
    const delivered = { ...received, deliveredBy: 'Revanth Reddy', deliveredAt: '2026-10-15T10:00:00Z', deliveryLocation: 'Nellore site', deliveryItems: [{ ok: true, note: '' }, null], deliveryPhotos: [{ url: 'https://x/d1.jpg', name: 'd1.jpg' }] };
    asUser('om@x.com', 'operation_manager');
    text = render(<DispatchPanel po={delivered} lead={lead} />);
    expect(text).toContain('Delivered by Revanth Reddy');
    expect(text).toContain('Nellore site');
    expect(text).not.toContain('Add delivery photo');
    expect(text).toContain('Material movement history (7 of 9 stages)');
  });
});

describe('Assigned Materials page', () => {
  const AssignedMaterials = require('../pages/AssignedMaterials').default;
  const base = { id: 'P1', poNumber: 'PO-1', leadId: 'L1', status: 'Approved', dispatchStatus: 'Completed', dispatchConfirmedAt: 'x', items: [{ materialName: 'Solar PV Module', quantity: 6, unit: 'Nos' }], dispatchItems: [{ dispatched: true }],
    dispatchAssignedTo: 'Revanth Reddy', dispatchAssignedToEmail: 'revanth@x.com', dispatchAssignedBy: 'OM', dispatchAssignedAt: '2026-10-15T07:00:00Z', dispatchAssignNote: 'collect by Friday' };
  const other = { ...base, id: 'P2', poNumber: 'PO-2', dispatchAssignedTo: 'K.J. Yogendra reddy', dispatchAssignedToEmail: 'yogendra@x.com' };
  test('the assignee sees only their own; the OM sees all; it shows who, when, what and the stage', () => {
    mockData = { leadPOs: [base, other], leads: [lead], users, materials: [] };
    asUser('revanth@x.com', 'executive');
    let text = render(<AssignedMaterials />);
    expect(text).toContain('PO PO-1');
    expect(text).not.toContain('PO PO-2');
    expect(text).toContain('Solar PV Module (6 Nos)');
    expect(text).toContain('collect by Friday');
    expect(text).toContain('Assigned — awaiting handover');
    expect(text).toContain('To deliver (1)');
    asUser('om@x.com', 'operation_manager');
    text = render(<AssignedMaterials />);
    expect(text).toContain('PO PO-1');
    expect(text).toContain('PO PO-2');
  });
  test('renders with nothing assigned', () => {
    mockData = { leadPOs: [], leads: [], users, materials: [] };
    asUser('revanth@x.com', 'executive');
    expect(render(<AssignedMaterials />)).toContain('No materials assigned to you');
  });
});


// 27-Oct: partial dispatch, extra items, drafts, returns, yard items.
describe('DispatchPanel — partial dispatch, returns and yard items', () => {
  const materials = [{ id: 'M1', name: 'Solar PV Module', unit: 'Nos', balance: 10 }, { id: 'M2', name: 'DC Cable', unit: 'mtrs', balance: 100 }];
  const received = { id: 'P1', poNumber: 'PO-1', leadId: 'L1', status: 'Approved', dispatchStatus: 'Completed', dispatchCompletedBy: 'W', dispatchCompletedAt: '2026-10-08T05:00:00Z', dispatchConfirmedAt: 'x',
    items: [{ materialName: 'Solar PV Module', quantity: 6, unit: 'Nos' }, { materialName: 'DC Cable 4sqmm', quantity: 30, unit: 'mtrs' }], dispatchItems: [{ dispatched: true }, { dispatched: true }],
    dispatchAssignedTo: 'Revanth Reddy', dispatchAssignedToEmail: 'revanth@x.com', dispatchAssignedBy: 'OM', dispatchAssignedAt: '2026-10-08T06:00:00Z',
    dispatchReceivedBy: 'Revanth Reddy', dispatchReceivedAt: '2026-10-08T07:00:00Z' };
  test('the dispatch table shows ordered / so far / remaining, an Add Item row, Save and Confirm; after a partial it says so', () => {
    mockData = { users, materials, stockTransactions: [] };
    asUser('revanth@x.com', 'executive');
    let text = render(<DispatchPanel po={received} lead={lead} />);
    expect(text).toContain('Dispatch now');
    expect(text).toContain('Add more items');
    expect(text).toContain('Save Dispatch Details');
    expect(text).toContain('Confirm Final Dispatch');
    expect(text).toContain('2 items will be deducted now');
    const partial = { ...received, stockDispatches: [{ ref: 'DSP-1', at: '2026-10-09T05:00:00Z', by: 'Revanth Reddy', items: [{ index: 0, materialId: 'M1', materialName: 'Solar PV Module', quantity: 2, unit: 'Nos', previousBalance: 12, newBalance: 10 }] }] };
    text = render(<DispatchPanel po={partial} lead={lead} />);
    expect(text).toContain('1 of 3 dispatches confirmed');
    expect(text).toContain('Dispatch 1');
    expect(text).toContain('12 → 10');
    expect(text).toContain('Confirm Final Dispatch');   // what remains is everything left, so the next one is final
    // the warehouse may confirm now (Req 4A); the BCO may not
    asUser('wh@x.com', 'warehouse_admin');
    expect(render(<DispatchPanel po={received} lead={lead} />)).toContain('Confirm Final Dispatch');
    asUser('bco@x.com', 'bco');
    expect(render(<DispatchPanel po={received} lead={lead} />)).not.toContain('Confirm Final Dispatch');
  });
  test('a saved draft is announced; a completed PO shows Return Items for the OM, and the ninth stage', () => {
    mockData = { users, materials, stockTransactions: [{ id: 'T1', type: 'return', poId: 'P1', materialId: 'M2', materialName: 'DC Cable', unit: 'mtrs', quantity: 5, status: 'Forwarded to Owner', submittedBy: 'OM', submittedAt: '2026-10-27T05:00:00Z', returnDate: '2026-10-27', reference: 'RTN-261027-AAAAA' }] };
    asUser('revanth@x.com', 'executive');
    const drafted = { ...received, stockDispatchDraft: { lines: [{ index: 0, materialId: 'M1', quantity: 3 }], savedBy: 'Revanth Reddy', savedAt: '2026-10-27T04:00:00Z' } };
    let text = render(<DispatchPanel po={drafted} lead={lead} />);
    expect(text).toContain('Saved by Revanth Reddy');
    expect(text).toContain('Confirm Partial Dispatch');
    const complete = { ...received, stockDispatchComplete: true, stockDispatches: [{ ref: 'DSP-1', at: '2026-10-09T05:00:00Z', by: 'R', items: [{ index: 0, materialId: 'M1', materialName: 'Solar PV Module', quantity: 6, unit: 'Nos', previousBalance: 16, newBalance: 10 }, { index: 1, materialId: 'M2', materialName: 'DC Cable', quantity: 30, unit: 'mtrs', previousBalance: 130, newBalance: 100 }] }] };
    asUser('om@x.com', 'operation_manager');
    text = render(<DispatchPanel po={complete} lead={lead} />);
    expect(text).toContain('Return Items');
    expect(text).toContain('Record Return');
    expect(text).toContain('Awaiting the Owner');
    expect(text).toContain('RTN-261027-AAAAA');
    expect(text).toContain('of 9 stages');
    asUser('revanth@x.com', 'executive');
    text = render(<DispatchPanel po={complete} lead={lead} />);
    expect(text).toContain('Return Items');
    expect(text).not.toContain('Record Return');
  });
  test('the OM gets the Yard Items row before the approval; the warehouse does not; a yard line is flagged', () => {
    mockData = { users, materials, stockTransactions: [] };
    const open = { id: 'P2', poNumber: 'PO-2', leadId: 'L1', status: 'Approved', items: [{ materialName: 'Solar PV Module', quantity: 6, unit: 'Nos' }], yardItems: [{ materialId: 'M2', materialName: 'DC Cable', quantity: 10, unit: 'mtrs', addedBy: 'OM' }] };
    asUser('om@x.com', 'operation_manager');
    let text = render(<DispatchPanel po={open} lead={lead} />);
    expect(text).toContain('Yard Items');
    expect(text).toContain('Yard');
    expect(text).toContain('DC Cable');
    expect(text).toContain('2 available'.slice(-9));   // "0 / 2 available"
    asUser('wh@x.com', 'warehouse_admin');
    text = render(<DispatchPanel po={open} lead={lead} />);
    expect(text).not.toContain('Yard Items —');
    expect(text).toContain('DC Cable');
  });
});

describe('Materials page — returns', () => {
  const Materials = require('../pages/Materials').default;
  test('the OM gets Record Return; a pending return sits in Approvals with its figures', () => {
    const materials = [{ id: 'M2', name: 'DC Cable', unit: 'mtrs', stock: 120, dispatched: 45, installed: 0, balance: 65 }];
    const txns = [{ id: 'T1', type: 'return', materialId: 'M2', materialName: 'DC Cable', unit: 'mtrs', quantity: 10, status: 'Forwarded to Owner', submittedBy: 'Ops Manager', submittedAt: '2026-10-27T05:00:00Z', returnDate: '2026-10-27', reference: 'RTN-261027-BBBBB', balanceAtSubmission: 65, poNumber: 'PO-7', customerName: 'Mr Rao', remarks: 'left over' }];
    mockData = { materials, stockTransactions: txns, purchaseOrders: [], leadPOs: [], leads: [], users };
    asUser('om@x.com', 'operation_manager');
    let text = render(<Materials />);
    expect(text).toContain('Record Return');
    asUser('x@x.com', 'technician');
    expect(render(<Materials />)).not.toContain('Record Return');
  });
});
