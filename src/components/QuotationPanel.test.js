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
      expect(render(<DispatchPanel po={po('Approved', { dispatchStatus: 'Completed', dispatchCompletedBy: 'W', dispatchCompletedAt: '2026-10-03T10:00:00Z', dispatchItems: [{ dispatched: true }] })} lead={lead} />)).toContain('Completed');
      expect(render(<DispatchPanel po={po('Approved', { dispatchConfirmedAt: '2026-10-03T10:00:00Z', dispatchConfirmedBy: 'OM', dispatchStatus: 'Completed' })} lead={lead} />)).toContain('confirmed');
    }
  });
  test('survives a PO with no items and no lead', () => {
    asUser('wh@x.com', 'warehouse_admin');
    mockData = { users };
    expect(() => render(<DispatchPanel po={{ id: 'P2', status: 'Approved' }} lead={null} />)).not.toThrow();
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
