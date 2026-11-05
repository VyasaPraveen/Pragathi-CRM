// QC smoke (5-Nov): every page mounted under every role with realistic data,
// then every toolbar button pressed and the first row's detail opened, with
// each tab inside it clicked. Anything that throws, or that React reports as
// an error, fails the test and names the page, the role and the button.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

let mockData = {};
let mockAuth = {};
jest.mock('../context/DataContext', () => ({ useData: () => mockData }));
jest.mock('../context/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../context/ToastContext', () => ({ useToast: () => ({ toast: () => {} }) }));
jest.mock('react-router-dom', () => ({
  useNavigate: () => () => {},
  useLocation: () => ({ pathname: '/' }),
  NavLink: ({ children }) => children,
  Link: ({ children }) => children,
}), { virtual: true });
jest.mock('../services/firestore', () => ({
  addDocument: async () => 'new1', updateDocument: async () => {}, deleteDocument: async () => {},
  createNotification: async () => {}, notifyAdmins: async () => {}, logActivity: async () => {},
  listenCollection: () => () => {}, sortDocs: (d) => d,
}));
jest.mock('../services/api', () => ({
  apiGet: async (path) => {
    if (path.startsWith('/auth/users')) return { users: mockData.users || [] };
    if (path === '/auth/me') return { user: mockAuth.user };
    if (path === '/settings') return mockData.settings || {};
    if (path.startsWith('/collections/')) return mockData[path.split('/')[2]] || [];
    if (/\/history$/.test(path)) return { history: [] };
    if (/\/records/.test(path)) return { counts: {}, records: {} };
    return {};
  },
  apiPost: async () => ({}), apiPatch: async () => ({}), apiPut: async () => ({}), apiDelete: async () => ({}),
  apiUpload: async () => ({ url: '/uploads/x.jpg' }),
  getToken: () => 't', setToken: () => {}, getMe: () => mockAuth.user, setMe: () => {}, setUnauthorizedHandler: () => {}, deviceId: () => 'd',
}));
jest.mock('../services/stockApi', () => ({
  submitStockReceipt: async () => ({}), submitStockAdjustment: async () => ({}), submitStockReturn: async () => ({}),
  reviewStockEntry: async () => ({}), approveStockEntry: async () => ({}), confirmFinalDispatch: async () => ({}), saveDispatchDraft: async () => ({}), newClientRef: () => 'c1',
}));

const PAGES = ['Dashboard', 'Leads', 'Customers', 'Installations', 'OngoingWork', 'Materials', 'Revenue', 'Expenditure', 'PaymentRequests', 'Reports', 'Team', 'Reminders', 'About', 'Gallery', 'Settings', 'TotalUsers', 'PurchaseOrders', 'Retailers', 'Influencers', 'EmployeeTasks', 'UserManagement', 'ActivityLog', 'Leave', 'Attendance', 'Tracking', 'MyReports', 'AssignedMaterials'];
const ROLES = ['super_admin', 'admin', 'management', 'operation_manager', 'sales_manager', 'technical_manager', 'warehouse_admin', 'accountant', 'bco', 'team_leader', 'executive', 'technician'];

/* ── realistic fixtures ─────────────────────────────────────────────────── */
const users = [
  { id: 'u0', email: 'owner@pps.com', displayName: 'Owner', role: 'super_admin', approved: true, phone: '9000000000' },
  { id: 'u1', email: 'admin@pps.com', displayName: 'Admin User', role: 'admin', approved: true },
  { id: 'u2', email: 'mgmt@pps.com', displayName: 'Management', role: 'management', approved: true },
  { id: 'u3', email: 'om@pps.com', displayName: 'Ops Manager', role: 'operation_manager', approved: true, designation: 'Operation Manager' },
  { id: 'u4', email: 'yog@pps.com', displayName: 'K.J. Yogendra Reddy', role: 'sales_manager', approved: true, designation: 'Sales Manager', phone: '9111111111' },
  { id: 'u5', email: 'tm@pps.com', displayName: 'Tech Manager', role: 'technical_manager', approved: true },
  { id: 'u6', email: 'wh@pps.com', displayName: 'Warehouse', role: 'warehouse_admin', approved: true },
  { id: 'u7', email: 'acc@pps.com', displayName: 'Accounts', role: 'accountant', approved: true },
  { id: 'u8', email: 'bco@pps.com', displayName: 'BCO Person', role: 'bco', approved: true },
  { id: 'u9', email: 'gopi@pps.com', displayName: 'K Gopi', role: 'team_leader', approved: true, teamName: 'Team 1' },
  { id: 'u10', email: 'rev@pps.com', displayName: 'Revanth Reddy', role: 'executive', approved: true, teamLeader: 'yog@pps.com', designation: 'Sales Executive', phone: '9222222222' },
  { id: 'u11', email: 'tech@pps.com', displayName: 'P Ganesh', role: 'technician', approved: true, teamLeader: 'gopi@pps.com' },
  { id: 'u12', email: 'chandu@pps.com', displayName: 'Chandu K', role: 'executive', approved: true, teamLeader: 'yog@pps.com' },
  { id: 'u13', email: 'hold@pps.com', displayName: 'On Hold', role: 'executive', approved: true, status: 'hold' },
];
const team = users.map((u, i) => ({ id: 'tm' + i, name: u.displayName, email: u.email, phone: u.phone || '', role: u.designation || u.role, status: 'Active', salary: 20000, joiningDate: '2025-01-10', attendance: 95 }));
const items = [
  { materialName: 'Solar PV Module', specification: '540 Wp', quantity: 6, unit: 'Nos', rate: 12000, scopePragathi: true },
  { materialName: 'Grid Tie Inverter', specification: '3 kW', quantity: 1, unit: 'Nos', rate: 45000, scopePragathi: true },
  { materialName: 'AC Cable', specification: '4 sqmm', quantity: 30, unit: 'Mtr', rate: 60, scopeCustomer: true },
];
const leads = [
  { id: 'l1', name: 'Sai Krishna', phone: '9876543210', email: 'sai@x.com', address: '12 Main Rd', city: 'Tirupati', district: 'Chittoor', pincode: '517501', status: 'Converted', priority: 'High', kwRequired: 3, monthlyBill: 2500, expectedValue: 180000, leadReference: 'Reference', assignedTo: 'Revanth Reddy', salesExecutive: 'Revanth Reddy', teamLeader: 'yog@pps.com', siteVisit: 'Yes', siteVisitPhotos: [{ url: '/uploads/s1.jpg', name: 's1.jpg' }], quotationSent: 'Yes', advancePaid: 'Yes', advanceLeadAmount: 20000, advanceLeadDate: '2026-10-20', existingConnection: 'Single Phase', followUpStatus: 'Converted', nextFollowUpDate: '2026-11-10', dateGenerated: '2026-10-15', createdAt: '2026-10-15T05:00:00Z', notes: 'Rooftop', supportingTeam: ['Chandu K'], modeOfPayment: 'Cash', agreedPrice: 180000 },
  { id: 'l2', name: 'Ravi Kumar', phone: '9123456789', status: 'Interested', priority: 'Medium', kwRequired: 5, assignedTo: 'Chandu K', followUpStatus: 'Follow-up', nextFollowUpDate: '2026-11-04', dateGenerated: '2026-11-04', createdAt: '2026-11-04T05:00:00Z', siteVisit: 'No' },
  { id: 'l3', name: 'Old Lead', phone: '9000011111', status: 'Not Interested', assignedTo: 'GOPI', dateGenerated: '2025-12-01', createdAt: '2025-12-01T05:00:00Z' },
];
const stages = {};
['registration', 'advance', 'materialRequest', 'deliveryApproval', 'teamAllotment', 'installation', 'completionReports'].forEach((k, i) => { stages[k] = { status: 'completed', completedBy: 'Owner', completedAt: `2026-10-2${i}T00:00:00Z` }; });
stages.registration = { ...stages.registration, regType: 'Cash', regNumber: 'R-1', regDate: '2026-10-20', docs: 'data:image/png;base64,AAAA' };
stages.deliveryApproval = { ...stages.deliveryApproval, dcNumber: 'DC-1', managerApproved: true, customerSignPhoto: [{ url: '/uploads/sign.jpg', name: 'sign.jpg', at: '2026-10-25T00:00:00Z', by: 'Ops' }], finalDcSubmitted: true, syncedFrom: 'Purchase Order' };
stages.teamAllotment = { ...stages.teamAllotment, teamLeader: 'K Gopi', teamMembers: ['P Ganesh'], allotmentDate: '2026-10-26', finalDcChecked: true };
const customers = [
  { id: 'c1', leadId: 'l1', name: 'Sai Krishna', phone: '9876543210', email: 'sai@x.com', address: '12 Main Rd', city: 'Tirupati', area: 'Tirupati', pincode: '517501', customerType: 'Residential', kw: 3, paymentType: 'Cash', agreedPrice: 180000, totalPrice: 180000, advanceAmount: 20000, secondPayment: 140000, thirdPayment: 0, finalPayment: 20000, status: 'Active', assignedTo: 'Revanth Reddy', createdAt: '2026-10-16T05:00:00Z', workflow: { stages, currentStage: 12 }, installationStatus: 'In Progress', siteVisitStatus: 'Visited', roofType: 'RCC', teamLeader: 'K Gopi', warrantyYears: 5, subsidyStatus: 'Applied', subsidyAmount: 78000, firstBillAmount: 120, firstBillUnits: 30 },
  { id: 'c2', name: 'Walk-in Customer', phone: '9555555555', paymentType: 'Finance', totalPrice: 300000, status: 'Active', createdAt: '2026-11-01T05:00:00Z', createdBy: 'bco@pps.com' },
];
const leadPOs = [
  { id: 'po1', leadId: 'l1', leadName: 'Sai Krishna', customerName: 'Sai Krishna', customerPhone: '9876543210', customerAddress: '12 Main Rd', poNumber: 'PO-PPSPO-0001/2026-10-20', poDate: '2026-10-20', vendorName: 'Pragathi Power Solutions', kwRequired: 3, systemKw: 3, agreedPrice: 180000, advancePayment: 'Rs 20,000 / 20-10-2026 / UPI', secondPayment: 'Rs 1,40,000', thirdPayment: '', finalPayment: 'Rs 20,000', items, status: 'Approved', approvedBy: 'Owner', approvalDate: '2026-10-21', recommendedBy: 'yog@pps.com', managementApprovedBy: 'Management', dispatchStatus: 'Stock OK', stockDispatchItems: items.map((it, index) => ({ index, materialName: it.materialName, quantity: it.quantity, unit: it.unit, available: 'yes' })), bomOrder: ['Solar PV Module', 'Grid Tie Inverter', 'AC Cable'], createdBy: 'rev@pps.com', createdAt: '2026-10-20T05:00:00Z' },
  { id: 'po2', leadId: 'l2', leadName: 'Ravi Kumar', customerName: 'Ravi Kumar', poNumber: 'PO-PPSPO-0002/2026-11-04', poDate: '2026-11-04', items: items.slice(0, 1), status: 'Unapproved', createdBy: 'chandu@pps.com', createdAt: '2026-11-04T05:00:00Z' },
  { id: 'po3', standalone: true, customerName: 'Manual Customer', poNumber: 'PO-PPSPO-0003/2026-11-04', poDate: '2026-11-04', items: [], status: 'Recommended', createdAt: '2026-11-04T06:00:00Z' },
];
const quotations = [
  { id: 'q1', leadId: 'l1', quotationNumber: 'PPS/Q/2026/0001', ppsRef: 'PPS-REF-0001', date: '2026-10-18', executiveName: 'Revanth Reddy', executivePhone: '9222222222', customerPhone: '9876543210', kw: 3, systemCost: 180000, subsidy: 78000, status: 'Approved', approvedBy: 'Owner', approvedAt: '2026-10-19T00:00:00Z', revision: 1, bomItems: items, raisedBy: 'rev@pps.com', createdAt: '2026-10-18T05:00:00Z' },
  { id: 'q2', leadId: 'l2', quotationNumber: 'PPS/Q/2026/0002', date: '2026-11-04', executiveName: 'Chandu K', kw: 5, systemCost: 300000, status: 'Pending Approval', raisedBy: 'chandu@pps.com', createdAt: '2026-11-04T05:00:00Z' },
];
const installations = [
  { id: 'i1', customerId: 'c1', leadId: 'l1', customerName: 'Sai Krishna', phone: '9876543210', address: '12 Main Rd', kw: 3, progress: 60, status: 'In Progress', startDate: '2026-10-27', teamLeader: 'K Gopi', teamMembers: ['P Ganesh'], numPeople: 2, siteVisitStatus: 'Visited', siteVisitPhotos: [{ url: '/uploads/sv.jpg', name: 'sv.jpg' }], notes: 'Day 2', createdAt: '2026-10-27T05:00:00Z' },
];
const materials = [
  { id: 'm1', name: 'Solar PV Module', unit: 'Nos', category: 'Modules', stock: 120, dispatched: 20, installed: 10, balance: 100, openingStock: 100, lastStockChangeAt: '2026-11-01T05:00:00Z', lastStockChangeBy: 'Owner' },
  { id: 'm2', name: 'AC Cable', unit: 'Mtr', category: 'Cables', stock: 500, dispatched: 100, installed: 0, balance: 400 },
];
const stockTransactions = [
  { id: 's1', type: 'receipt', status: 'Forwarded to Owner', materialId: 'm1', materialName: 'Solar PV Module', quantity: 50, unit: 'Nos', reference: 'RC-0002', submittedBy: 'Warehouse', submittedByEmail: 'wh@pps.com', submittedAt: '2026-11-05T03:00:00Z', receiptDate: '2026-11-05', balanceAtSubmission: 100, reviewedBy: 'Ops Manager', reviewedAt: '2026-11-05T03:30:00Z', poId: 'po1', poNumber: 'PO-PPSPO-0001/2026-10-20', poItemIndex: 0, poItemName: 'Solar PV Module', poOrderedQty: 6, supplier: 'Vendor A', history: [] },
  { id: 's2', type: 'adjustment', status: 'Pending Review', materialId: 'm2', materialName: 'AC Cable', quantity: -5, countedQuantity: 395, unit: 'Mtr', reference: 'ADJ-0001', submittedBy: 'Warehouse', submittedAt: '2026-11-05T04:00:00Z', balanceAtSubmission: 400, reason: 'Count' },
  { id: 's3', type: 'dispatch', status: 'Applied', materialId: 'm1', materialName: 'Solar PV Module', quantity: 6, unit: 'Nos', reference: 'DSP-0001', confirmedBy: 'Ops Manager', appliedAt: '2026-10-25T05:00:00Z', previousBalance: 106, newBalance: 100, poId: 'po1', poNumber: 'PO-PPSPO-0001/2026-10-20', customerName: 'Sai Krishna', dispatchDate: '2026-10-25' },
  { id: 's4', type: 'opening', status: 'Applied', materialId: 'm1', materialName: 'Solar PV Module', quantity: 100, unit: 'Nos', reference: 'OPN-0001', appliedAt: '2026-10-01T05:00:00Z', previousBalance: 0, newBalance: 100 },
];
const income = [{ id: 'in1', date: '2026-11-01', amount: 20000, category: 'Advance', description: 'Advance Sai', customer: 'Sai Krishna', createdAt: '2026-11-01T05:00:00Z' }, { id: 'in2', date: '2026-10-05', amount: '15000', category: 'Service', desc: 'AMC', createdAt: '2026-10-05T05:00:00Z' }];
const expenses = [{ id: 'ex1', date: '2026-11-02', amount: 3000, category: 'Travel', description: 'Fuel', vendor: 'HP', createdAt: '2026-11-02T05:00:00Z' }];
const employeeTasks = [
  { id: 't1', title: 'Site survey', description: 'Measure the roof', assignedTo: 'Revanth Reddy', assignedDate: '2026-11-03', dueDate: '2026-11-07', priority: 'High', category: 'Installation', status: 'Pending', relatedCustomer: 'Sai Krishna', workUpdates: [{ date: '2026-11-04', update: 'Started', by: 'rev@pps.com', at: '2026-11-04T05:00:00Z' }], createdAt: '2026-11-03T05:00:00Z' },
  { id: 't2', title: 'Collect docs', assignees: ['K.J. Yogendra Reddy', 'Chandu K'], assignedTo: 'K.J. Yogendra Reddy', assignedBy: 'Owner', dueDate: '2026-11-01', priority: 'Low', category: 'Documentation', status: 'Completed', completedDate: '2026-11-01', createdAt: '2026-10-30T05:00:00Z' },
];
const attendance = [
  { id: 'a1', date: '2026-11-05', employeeEmail: 'rev@pps.com', employeeName: 'Revanth Reddy', type: 'Check In', time: '09:05', at: '2026-11-05T03:35:00Z', createdAt: '2026-11-05T03:35:00Z' },
  { id: 'a2', date: '2026-11-04', employeeEmail: 'rev@pps.com', employeeName: 'Revanth Reddy', type: 'Check In', time: '09:10', at: '2026-11-04T03:40:00Z' },
  { id: 'a3', date: '2026-11-04', employeeEmail: 'rev@pps.com', employeeName: 'Revanth Reddy', type: 'Check Out', time: '18:00', at: '2026-11-04T12:30:00Z' },
  { id: 'a4', date: '2026-11-04', employeeEmail: 'tech@pps.com', employeeName: 'P Ganesh', status: 'Present', present: true, state: 'Full Day', createdAt: '2026-11-04T03:40:00Z' },
];
const tracking = [
  { id: 'tr1', employeeEmail: 'rev@pps.com', employeeName: 'Revanth Reddy', date: '2026-11-05', slots: { h9: { text: 'Site visit', status: 'planned' }, day: { text: 'Whole day at site ', status: 'planned' } }, planSent: true, planSentAt: '2026-11-04T12:10:00Z', planSentBy: 'rev@pps.com', planSentByName: 'Revanth Reddy', updatedAt: '2026-11-04T12:10:00Z' },
  { id: 'tr2', employeeEmail: 'rev@pps.com', employeeName: 'Revanth Reddy', date: '2026-11-04', slots: { h9: 'Old string slot', h11: { text: 'Call Mr Rao', status: 'not_done', reason: 'No answer' }, h14: { text: 'Visit', status: 'postponed', postponedDate: '2026-11-05', postponedSlot: 'h9' } }, submitted: true, submittedAt: '2026-11-04T13:00:00Z', submittedByName: 'Revanth Reddy', planSent: true, planSentAt: '2026-11-03T12:00:00Z' },
  { id: 'tr3', employeeEmail: 'chandu@pps.com', employeeName: 'Chandu K', date: '2026-11-05', slots: { h10: { text: 'Draft', status: 'planned' } } },
];
const leaveRequests = [
  { id: 'lv1', employeeEmail: 'rev@pps.com', employeeName: 'Revanth Reddy', leaveType: 'Sick', fromDate: '2026-11-06', toDate: '2026-11-06', reason: 'Fever', status: 'Awaiting Replacement', replacementName: 'Chandu K', replacementEmail: 'chandu@pps.com', createdAt: '2026-11-05T02:00:00Z' },
  { id: 'lv2', employeeEmail: 'tech@pps.com', employeeName: 'P Ganesh', leaveType: 'Casual', fromDate: '2026-10-28', toDate: '2026-10-29', status: 'Approved', approvedBy: 'Owner', createdAt: '2026-10-25T02:00:00Z' },
];
const paymentRequests = [
  { id: 'pr1', requestedBy: 'rev@pps.com', requestedByName: 'Revanth Reddy', teamLeaderEmail: 'yog@pps.com', teamLeaderName: 'K.J. Yogendra Reddy', amount: 2500, purpose: 'Site travel', category: 'Travel', paymentMode: 'UPI', status: 'Requested', requestedDate: '2026-11-04', needsRecommendation: true, createdAt: '2026-11-04T05:00:00Z' },
  { id: 'pr2', requestedBy: 'gopi@pps.com', requestedByName: 'K Gopi', amount: 12000, purpose: 'Tools', status: 'Approved', approvedBy: 'Admin User', needsRecommendation: false, requestedDate: '2026-11-01', createdAt: '2026-11-01T05:00:00Z' },
];
const expenditures = [{ id: 'e1', purpose: 'Office rent', amount: 15000, category: 'Rent', date: '2026-11-01', paymentType: 'Bank', status: 'Requested', requestedBy: 'acc@pps.com', createdAt: '2026-11-01T05:00:00Z' }, { id: 'e2', purpose: 'Printer', amount: 8000, status: 'Released', releasedBy: 'Accounts', createdAt: '2026-10-01T05:00:00Z' }];
const reminders = [{ id: 'r1', type: 'Follow-up', customer: 'Ravi Kumar', phone: '9123456789', date: '2026-11-05', message: 'Call back', status: 'Pending', createdAt: '2026-11-04T05:00:00Z' }, { id: 'r2', type: 'Service Due', customer: 'Sai Krishna', date: '2026-10-01', status: 'Done' }];
const notifications = [{ id: 'n1', forUser: 'Revanth Reddy', title: 'New Task Assigned', message: 'x', type: 'task', module: 'employeeTasks', relatedId: 't1', read: false, createdAt: '2026-11-05T05:00:00Z' }, { id: 'n2', forUser: 'Owner', title: 'Stock', message: 'y', module: 'materials', read: false, createdAt: '2026-11-05T05:00:00Z' }];
const activityLog = Array.from({ length: 120 }, (_, i) => ({ id: 'al' + i, action: i % 2 ? 'Created' : 'Updated', module: 'leads', target: 'Lead ' + i, user: 'rev@pps.com', userName: 'Revanth Reddy', at: `2026-11-0${(i % 4) + 1}T05:00:00Z`, createdAt: `2026-11-0${(i % 4) + 1}T05:00:00Z` }));
const bcoOps = [{ id: 'b1', leadId: 'l1', stages: { s1: { done: 'Yes', at: '2026-10-21T00:00:00Z', by: 'BCO Person', docs: [{ url: '/uploads/d1.pdf', name: 'd1.pdf' }] }, s2: { done: 'Yes', regType: 'Cash', regNumber: 'R-1', regDate: '2026-10-20' }, s5: { done: 'No', discomSubmitted: 'Yes', gridSyncStatus: 'Pending', meterChangeStatus: 'Pending' } }, createdAt: '2026-10-21T00:00:00Z' }];
const bomTemplates = [{ id: 'bt1', name: '3 kW Standard', items, createdAt: '2026-10-01T05:00:00Z' }];
const gallery = [{ id: 'g1', url: '/uploads/g1.jpg', caption: 'Site', uploadedBy: 'rev@pps.com', createdAt: '2026-10-01T05:00:00Z' }];
const retailers = [{ id: 'rt1', name: 'Sun Retail', phone: '9333333333', status: 'Active', territory: 'Tirupati', commissionType: 'Percent', commissionValue: 2, totalPayouts: 0, createdAt: '2026-09-01T05:00:00Z' }];
const influencers = [{ id: 'if1', name: 'Solar Guru', phone: '9444444444', status: 'Active', area: 'Chittoor', referralCode: 'GURU1', commissionType: 'Fixed', commissionValue: 500, createdAt: '2026-09-01T05:00:00Z' }];
const settings = { numbering: { quotationStart: 1, referenceStart: 1, poStart: 1 }, pipelineResetAt: '2026-11-04', workflowGatingEnabled: true, assignedLeadAccess: 'edit', attendanceRules: { halfDayHours: 4, fullDayHours: 8 }, ebTariff: 7.5, about: {}, optionLists: { bomMaterials: ['Solar PV Module', 'Grid Tie Inverter', 'AC Cable', 'My Special Clamp'] } };
const purchaseOrders = [{ id: 'lpo1', poNumber: 'LEG-0001', vendorName: 'Legacy Vendor', amount: 50000, status: 'Draft', createdAt: '2025-09-01T05:00:00Z', items: [] }];

const fixtures = { users, team, leads, customers, leadPOs, quotations, installations, materials, stockTransactions, income, expenses, employeeTasks, attendance, tracking, leaveRequests, paymentRequests, expenditures, reminders, notifications, activityLog, bcoOps, bomTemplates, gallery, retailers, influencers, settings, purchaseOrders, ongoingWork: [{ id: 'ow1', projectName: 'Yard shed', status: 'In Progress', progress: 40, startDate: '2026-10-01', installDate: '2026-11-15', createdAt: '2026-10-01T05:00:00Z' }] };
const dataOf = () => new Proxy({ ...fixtures }, { get: (t, k) => (k in t ? t[k] : (typeof k === 'string' ? [] : undefined)) });

/* ── harness ─────────────────────────────────────────────────────────────── */
const realError = console.error;
let errors = [];
const IGNORED = /not configured to support act|act\(\.\.\.\)|was not wrapped in act|Not implemented: HTMLFormElement|Not implemented: window\.(open|print|alert)|Not implemented: navigation|Not implemented: HTMLMediaElement/;
beforeAll(() => { console.error = (...a) => { const s = a.map(x => (x && x.message) || String(x)).join(' '); if (!IGNORED.test(s)) errors.push(s.slice(0, 300)); }; });
afterAll(() => { console.error = realError; });
beforeEach(() => { errors = []; window.confirm = () => false; window.prompt = () => null; window.alert = () => {}; window.open = () => null; window.print = () => {}; localStorage.clear(); URL.createObjectURL = () => 'blob:x'; URL.revokeObjectURL = () => {}; });

const flush = async () => { await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };
function mount(element) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(element); });
  return { host, unmount: () => { act(() => { root.unmount(); }); host.remove(); } };
}
const roleUser = (role) => users.find(u => u.role === role) || users[0];
const label = (b) => (b.textContent || b.title || b.getAttribute('aria-label') || '?').trim().slice(0, 40);
const SKIP = /delete|remove|purge|release|reset|sign out|logout|clear/i;

async function exercise(Page, name, role) {
  const problems = [];
  const where = (what) => `${name} as ${role}: ${what}`;
  let m;
  try {
    m = mount(<Page />);
    await flush();
  } catch (e) { return [where('mount threw: ' + e.message)]; }
  // Press every toolbar / card button outside tables and modals (opening forms, tabs, exports).
  const topButtons = () => [...m.host.querySelectorAll('button, .fc')].filter(b => !b.closest('.md, .mo, table') && !SKIP.test(label(b)) && !b.disabled);
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const next = topButtons().find(b => !seen.has(label(b)));
    if (!next) break;
    seen.add(label(next));
    try { await act(async () => { next.click(); }); await flush(); }
    catch (e) { problems.push(where(`button "${label(next)}" threw: ${e.message}`)); }
    // close whatever opened
    for (const x of m.host.querySelectorAll('.mx, button[aria-label="Close"]')) { try { await act(async () => { x.click(); }); } catch { /* ignore */ } }
  }
  // Open the first row's view / edit and walk every tab inside the modal.
  const rowButtons = [...m.host.querySelectorAll('table tbody tr button, .card button[title="View Details"], .card button[title="View"]')].filter(b => !SKIP.test(label(b)) && !b.disabled).slice(0, 4);
  for (const rb of rowButtons) {
    try { await act(async () => { rb.click(); }); await flush(); }
    catch (e) { problems.push(where(`row button "${label(rb)}" threw: ${e.message}`)); continue; }
    const modal = m.host.querySelector('.md');
    if (modal) {
      const tabs = [...modal.querySelectorAll('button')].filter(b => !modal.querySelector('form') || !b.closest('form')).filter(b => !SKIP.test(label(b)) && !b.disabled && b.type !== 'submit').slice(0, 25);
      for (const t of tabs) {
        if (!document.body.contains(t)) continue;
        try { await act(async () => { t.click(); }); await flush(); }
        catch (e) { problems.push(where(`in modal, "${label(t)}" threw: ${e.message}`)); }
      }
      for (const x of m.host.querySelectorAll('.mx')) { try { await act(async () => { x.click(); }); } catch { /* ignore */ } }
    }
  }
  try { m.unmount(); } catch (e) { problems.push(where('unmount threw: ' + e.message)); }
  return problems;
}

jest.setTimeout(60000);
describe.each(PAGES)('%s', (name) => {
  test.each(ROLES)('renders and survives clicking as %s', async (role) => {
    mockData = dataOf();
    mockAuth = { role, user: { ...roleUser(role), permissions: {} }, designation: roleUser(role).designation || '' };
    const Page = require('./' + name).default;
    const problems = await exercise(Page, name, role);
    const reactErrors = errors.filter(e => /Error|Warning: (Each child|Encountered|Cannot update|React does not recognize|Received NaN|Invalid)/i.test(e));
    expect([...problems, ...reactErrors.map(e => `${name} as ${role}: console.error: ${e}`)]).toEqual([]);
  });
});
