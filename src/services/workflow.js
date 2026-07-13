// ============================================================================
// Pragathi CRM — 18-stage operational workflow (from the official process chart)
// Each stage unlocks ONLY after the previous stage is completed, and a stage can
// be completed ONLY once its required data is captured ("require stage data").
// Stages 1–4 (Enquiry → Response → Site Visit → PO-BOM) are auto-completed when a
// customer is created from a converted lead, since that journey is already done.
// ============================================================================

// Stages with sno <= AUTO_STAGES are considered complete the moment a customer exists.
export const AUTO_STAGES = 4;

export const WORKFLOW_STAGES = [
  { sno: 1, key: 'enquiry', title: 'Enquiry / Lead', detail: 'Lead captured from enquiry', team: 'Sales Team', auto: true, fields: [] },
  { sno: 2, key: 'response', title: 'Response Time', detail: 'Responded within 2 hours', team: 'Sales Team', auto: true, fields: [] },
  { sno: 3, key: 'siteVisit', title: 'Site Visit', detail: 'IF YES = collect PO-BOM + Advance · IF NOT = reason for lost order', team: 'Sales Team', auto: true, fields: [] },
  { sno: 4, key: 'poBom', title: 'Collect the PO - BOM', detail: 'PO & Bill of Materials collected', team: 'Sales Team', auto: true, fields: [] },

  { sno: 5, key: 'registration', title: 'Registration', detail: 'PM Surya Ghar / NM / Loan Process. IF LOAN = documents to banker · IF Cash = collect advance', team: 'Sales Team', fields: [
    { key: 'regType', label: 'Registration Type', type: 'select', options: ['PM Surya Ghar', 'Net Metering (NM)', 'Loan', 'Cash'], required: true },
    { key: 'regNumber', label: 'Registration / Application No', type: 'text', required: true },
    { key: 'regDate', label: 'Registration Date', type: 'date', required: true },
    { key: 'bankName', label: 'Banker Name (if Loan)', type: 'text', requiredIf: v => v.regType === 'Loan' },
    { key: 'loanDocsDate', label: 'Documents submitted to banker (date)', type: 'date', requiredIf: v => v.regType === 'Loan' },
  ] },

  { sno: 6, key: 'advance', title: 'Collect the Advance', detail: 'IF YES = raise material request · IF NOT = get confirmation from management', team: 'Sales Team', fields: [
    { key: 'advanceAmount', label: 'Advance Received (₹)', type: 'number', required: true, min: 1 },
    { key: 'advanceDate', label: 'Advance Date', type: 'date', required: true },
    { key: 'advanceMode', label: 'Payment Mode', type: 'select', options: ['Cash', 'Bank Transfer', 'UPI', 'Cheque'], required: true },
  ] },

  { sno: 7, key: 'materialRequest', title: 'Material Delivery Request', detail: 'IF 2nd Payment 80% or 1st from Bank = release material. Confirm payment with Accounts', team: 'Project Manager / Accounts', fields: [
    { key: 'paymentStage', label: 'Payment Milestone', type: 'select', options: ['2nd Payment 80%', '1st Payment from Bank', 'Management Approved'], required: true },
    { key: 'paymentConfirmed', label: 'Payment confirmed with Accounts', type: 'checkbox', required: true },
    { key: 'materialRequestDate', label: 'Material Request Date', type: 'date', required: true },
  ] },

  { sno: 8, key: 'deliveryApproval', title: 'Material Delivery Approvals', detail: 'Follow PO-BOM · manager approval on challan · delivery + customer sign with photo · final DC to warehouse', team: 'Warehouse / Project Engineer / Delivery', fields: [
    { key: 'dcNumber', label: 'Delivery Challan (DC) No', type: 'text', required: true },
    { key: 'managerApproved', label: 'Manager approved the challan', type: 'checkbox', required: true },
    { key: 'customerSignPhoto', label: 'Customer sign with photo', type: 'photo', required: true },
    { key: 'finalDcSubmitted', label: 'Final DC submitted to warehouse', type: 'checkbox', required: true },
  ] },

  { sno: 9, key: 'teamAllotment', title: 'Installation Team Allotment', detail: 'Check final DC & customer availability before allotment', team: 'Project Manager', fields: [
    { key: 'installationTeam', label: 'Team / Engineer Allotted', type: 'text', required: true },
    { key: 'allotmentDate', label: 'Allotment Date', type: 'date', required: true },
    { key: 'finalDcChecked', label: 'Final DC & customer availability checked', type: 'checkbox', required: true },
  ] },

  { sno: 10, key: 'installation', title: 'Installation & Commissioning', detail: 'Cable routing · handsketch sign · quality · warranty · DEMO · switch on (≥1 unit) · I&C review with photo', team: 'I&C Team', fields: [
    { key: 'handsketchSigned', label: 'Handsketch signed by customer', type: 'checkbox', required: true },
    { key: 'systemSwitchedOn', label: 'System switched on (≥1 unit generated)', type: 'checkbox', required: true },
    { key: 'commissioningDate', label: 'Commissioning Date', type: 'date', required: true },
    { key: 'systemPhoto', label: 'I&C review — system + customer photo', type: 'photo', required: true },
  ] },

  { sno: 11, key: 'completionReports', title: 'Prepare the Completion Reports', detail: 'Docs by office · signed docs + material consumption · submit to customer / banker', team: 'Front Office / I&C / Sales', fields: [
    { key: 'completionReport', label: 'Completion Report (photo / scan)', type: 'photo', required: true },
    { key: 'materialConsumption', label: 'Material Consumption Report', type: 'photo', required: true },
    { key: 'reportsSubmittedTo', label: 'Reports submitted to', type: 'select', options: ['Customer', 'Banker', 'Both'], required: true },
  ] },

  { sno: 12, key: 'discom', title: 'DISCOM Followup', detail: 'Completion report to DISCOM for meter change · grid synchronization · meter change', team: 'BCO', fields: [
    { key: 'discomSubmitted', label: 'Completion report submitted to DISCOM', type: 'checkbox', required: true },
    { key: 'gridSyncStatus', label: 'Grid Synchronization', type: 'select', options: ['Pending', 'In Progress', 'Done'], required: true, mustEqual: 'Done' },
    { key: 'meterChangeStatus', label: 'Meter Change', type: 'select', options: ['Pending', 'Done'], required: true, mustEqual: 'Done' },
  ] },

  { sno: 13, key: 'finalPayment', title: 'Final Payment Collection', detail: 'Collect the final payment', team: 'Sales Team / Accounts', fields: [
    { key: 'finalPaymentAmount', label: 'Final Payment Received (₹)', type: 'number', required: true, min: 1 },
    { key: 'finalPaymentDate', label: 'Final Payment Date', type: 'date', required: true },
    { key: 'balanceCleared', label: 'Full payment received (no balance pending)', type: 'checkbox', required: true },
  ] },

  { sno: 14, key: 'demo', title: 'DEMO', detail: 'System switch on · app install & demo · DISCOM import/export · flagging', team: 'Quality / Service / BCO', fields: [
    { key: 'systemSwitchOn', label: 'System switched ON', type: 'checkbox', required: true },
    { key: 'appInstalled', label: 'App installed & DEMO given', type: 'checkbox', required: true },
    { key: 'discomChecked', label: 'DISCOM site import/export verified', type: 'checkbox', required: true },
    { key: 'flaggingStatus', label: 'System Flagging', type: 'select', options: ['Pending', 'Done'], required: true, mustEqual: 'Done' },
  ] },

  { sno: 15, key: 'customerCare', title: 'Customer Care', detail: '1st bill check', team: 'Sales Team', fields: [
    { key: 'firstBillChecked', label: '1st bill checked', type: 'checkbox', required: true },
    { key: 'firstBillDate', label: '1st Bill Date', type: 'date', required: true },
  ] },

  { sno: 16, key: 'cleaning', title: '1st Cleaning', detail: 'Explain maintenance & clean the modules', team: 'Quality / Service', fields: [
    { key: 'cleaningDone', label: 'Modules cleaned', type: 'checkbox', required: true },
    { key: 'maintenanceExplained', label: 'Maintenance explained to customer', type: 'checkbox', required: true },
    { key: 'cleaningDate', label: 'Cleaning Date', type: 'date', required: true },
  ] },

  { sno: 17, key: 'review', title: 'Get the Review & Reference', detail: 'Final review & any references', team: 'Quality / Service', fields: [
    { key: 'reviewRating', label: 'Customer Rating', type: 'select', options: ['5 - Excellent', '4 - Good', '3 - Average', '2 - Poor', '1 - Bad'], required: true },
    { key: 'feedback', label: 'Feedback', type: 'textarea', required: true },
    { key: 'references', label: 'References (names / phones)', type: 'text' },
  ] },

  { sno: 18, key: 'finalReview', title: 'After 3 Months - Final Review', detail: 'Final review after 3 months', team: 'Front Office / Quality', fields: [
    { key: 'finalReviewDate', label: 'Final Review Date', type: 'date', required: true },
    { key: 'finalReviewNotes', label: 'Final Review Notes', type: 'textarea', required: true },
  ] },
];

export const TOTAL_STAGES = WORKFLOW_STAGES.length;

// Is a single field satisfied given the current form values?
export function isFieldSatisfied(field, values) {
  const val = values[field.key];
  const isRequired = field.required || (field.requiredIf && field.requiredIf(values));
  if (field.type === 'checkbox') {
    return isRequired ? val === true : true;
  }
  if (field.mustEqual !== undefined) {
    // A gating select (e.g. Meter Change) must hold a specific value to pass
    return val === field.mustEqual;
  }
  if (!isRequired) return true;
  if (field.type === 'number') {
    const n = Number(val);
    return val !== '' && val != null && !isNaN(n) && (field.min == null || n >= field.min);
  }
  return val != null && String(val).trim() !== '';
}

// Are ALL required fields for a stage satisfied? (enables the Complete button)
export function isStageComplete(stage, values) {
  return (stage.fields || []).every(f => isFieldSatisfied(f, values || {}));
}

// Build the gated view of all stages for a given customer.
// Returns each stage tagged with status: 'completed' | 'current' | 'locked'.
export function getWorkflowView(customer) {
  const wf = (customer && customer.workflow) || {};
  const savedStages = wf.stages || {};
  const isDone = (s) => s.auto || savedStages[s.key]?.status === 'completed';
  const current = WORKFLOW_STAGES.find(s => !isDone(s)); // first not-yet-done stage
  return WORKFLOW_STAGES.map(s => {
    let status;
    if (isDone(s)) status = 'completed';
    else if (current && s.key === current.key) status = 'current';
    else status = 'locked';
    return { ...s, status, data: savedStages[s.key] || {} };
  });
}

export function completedCount(customer) {
  return getWorkflowView(customer).filter(s => s.status === 'completed').length;
}

// The stage the customer is currently working on (or null if the whole flow is done)
export function currentStage(customer) {
  return getWorkflowView(customer).find(s => s.status === 'current') || null;
}
