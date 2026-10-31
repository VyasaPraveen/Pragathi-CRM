// ============================================================================
// Pragathi CRM — 18-stage operational workflow (from the official process chart)
// Each stage unlocks ONLY after the previous stage is completed, and a stage can
// be completed ONLY once its required data is captured ("require stage data").
// Stages 1–4 (Enquiry → Response → Site Visit → PO-BOM) are auto-completed when a
// customer is created from a converted lead, since that journey is already done.
//
// 31-Oct (Customers batch): the Owner is free of the sequence (see
// customerAccess.js); several stages are filled in by other modules (see
// customerWorkflow.js); every photo field holds a LIST of photos; and
// reopening a stage no longer wipes the stages after it.
// ============================================================================

// Stages with sno <= AUTO_STAGES are considered complete the moment a customer exists.
export const AUTO_STAGES = 4;

export const WORKFLOW_STAGES = [
  { sno: 1, key: 'enquiry', title: 'Enquiry / Lead', detail: 'Lead captured from enquiry', team: 'Sales Team', auto: true, fields: [] },
  { sno: 2, key: 'response', title: 'Response Time', detail: 'Responded within 2 hours', team: 'Sales Team', auto: true, fields: [] },
  { sno: 3, key: 'siteVisit', title: 'Site Visit', detail: 'IF YES = collect PO-BOM + Advance · IF NOT = reason for lost order', team: 'Sales Team', auto: true, fields: [] },
  { sno: 4, key: 'poBom', title: 'Collect the PO - BOM', detail: 'PO & Bill of Materials collected', team: 'Sales Team', auto: true, fields: [] },

  // Filled in by BCO Operations → Stage 2 Registration (one way); editable here too.
  { sno: 5, key: 'registration', title: 'Registration', detail: 'PM Surya Ghar / NM / Loan Process. IF LOAN = documents to banker · IF Cash = collect advance', team: 'Sales Team', source: 'BCO Operations — Stage 2 Registration', fields: [
    { key: 'regType', label: 'Registration Type', type: 'select', options: ['PM Surya Ghar', 'Net Metering (NM)', 'Loan', 'Cash'], required: true },
    { key: 'regNumber', label: 'Registration / Application No', type: 'text', required: true },
    { key: 'regDate', label: 'Registration Date', type: 'date', required: true },
    { key: 'bankName', label: 'Banker Name (if Loan)', type: 'text', requiredIf: v => v.regType === 'Loan' },
    { key: 'bankNumber', label: 'Banker Number', type: 'text' },
    { key: 'loanDocsDate', label: 'Documents submitted to banker (date)', type: 'date', requiredIf: v => v.regType === 'Loan' },
    { key: 'docs', label: 'Documents', type: 'docs' },
  ] },

  // Filled in from the lead's Advance Received (one way); editable here too.
  { sno: 6, key: 'advance', title: 'Collect the Advance', detail: 'IF YES = raise material request · IF NOT = get confirmation from management', team: 'Sales Team', source: 'Leads — Advance Received', fields: [
    { key: 'advanceAmount', label: 'Advance Received (₹)', type: 'number', required: true, min: 1 },
    { key: 'advanceDate', label: 'Advance Date', type: 'date', required: true },
    { key: 'advanceMode', label: 'Payment Mode', type: 'select', options: ['Cash', 'Bank Transfer', 'UPI', 'Cheque', 'Other'], required: true },
  ] },

  // Completed by itself once 90% of the agreed price is in the Payment tab and
  // a PO is approved; the Owner may complete it by hand regardless.
  { sno: 7, key: 'materialRequest', title: 'Material Delivery Request', detail: 'Released once 90% of the agreed price is received (Payment tab) · or 2nd Payment 80% / 1st from Bank / Management approved', team: 'Project Manager / Accounts', source: 'Customer Payment tab — 90% of the agreed price', fields: [
    { key: 'paymentStage', label: 'Payment Milestone', type: 'select', options: ['90% Payment Received', '2nd Payment 80%', '1st Payment from Bank', 'Management Approved'], required: true },
    { key: 'paymentConfirmed', label: 'Payment confirmed with Accounts', type: 'checkbox' },
    { key: 'materialRequestDate', label: 'Material Request Date', type: 'date', required: true },
  ] },

  // Completed by itself when the Operation Manager gives the Approval for Dispatch.
  { sno: 8, key: 'deliveryApproval', title: 'Material Delivery Approvals', detail: 'Follow PO-BOM · manager approval on challan · delivery + customer sign with photo · final DC to warehouse', team: 'Warehouse / Project Engineer / Delivery', source: 'Purchase Order — Confirm Dispatch', fields: [
    { key: 'dcNumber', label: 'Delivery Challan (DC) No', type: 'text', required: true },
    { key: 'managerApproved', label: 'Manager approved the challan', type: 'checkbox', required: true },
    { key: 'customerSignPhoto', label: 'Customer sign with photo', type: 'photo', required: true },
    { key: 'finalDcSubmitted', label: 'Final DC submitted to warehouse', type: 'checkbox', required: true },
  ] },

  // Filled in from Installations → New Installation (one way).
  { sno: 9, key: 'teamAllotment', title: 'Installation Team Allotment', detail: 'Check final DC & customer availability before allotment', team: 'Project Manager', source: 'Installations — New Installation', fields: [
    { key: 'teamLeader', label: 'Team Leader', type: 'text', required: true },
    { key: 'teamSize', label: 'Team Size', type: 'number' },
    { key: 'teamMembers', label: 'Team Members', type: 'list' },
    { key: 'installationTeam', label: 'Team / Engineer Allotted (note)', type: 'text' },
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

  // Filled in by BCO Operations → Stage 5 Net Meter Processing (one way).
  { sno: 12, key: 'discom', title: 'DISCOM Followup', detail: 'Completion report to DISCOM for meter change · grid synchronization · meter change', team: 'BCO', source: 'BCO Operations — Stage 5 Net Meter Processing', fields: [
    { key: 'discomSubmitted', label: 'Completion report submitted to DISCOM', type: 'checkbox', required: true },
    { key: 'gridSyncStatus', label: 'Grid Synchronization', type: 'select', options: ['Pending', 'In Progress', 'Done'], required: true, mustEqual: 'Done' },
    { key: 'meterChangeStatus', label: 'Meter Change', type: 'select', options: ['Pending', 'Done'], required: true, mustEqual: 'Done' },
    { key: 'note', label: 'Note', type: 'textarea' },
    { key: 'docs', label: 'Documents', type: 'docs' },
  ] },

  // Completed by itself once the full agreed price is in the Payment tab.
  { sno: 13, key: 'finalPayment', title: 'Final Payment Collection', detail: 'Collect the final payment', team: 'Sales Team / Accounts', source: 'Customer Payment tab — the full agreed price', fields: [
    { key: 'finalPaymentAmount', label: 'Final Payment Received (₹)', type: 'number', required: true, min: 1 },
    { key: 'finalPaymentDate', label: 'Final Payment Date', type: 'date', required: true },
    { key: 'balanceCleared', label: 'Full payment received (no balance pending)', type: 'checkbox', required: true },
  ] },

  { sno: 14, key: 'demo', title: 'DEMO', detail: 'System switch on · app install & demo · DISCOM import/export · flagging', team: 'Quality / Service / BCO', fields: [
    { key: 'systemSwitchOn', label: 'System switched ON', type: 'checkbox', required: true },
    { key: 'appInstalled', label: 'App installed & DEMO given', type: 'checkbox', required: true },
    { key: 'discomChecked', label: 'DISCOM site import/export verified', type: 'checkbox', required: true },
    { key: 'flaggingStatus', label: 'System Flagging', type: 'select', options: ['Pending', 'Done'], required: true, mustEqual: 'Done' },
    { key: 'demoPhotos', label: 'DEMO photos (optional)', type: 'photo' },
  ] },

  { sno: 15, key: 'customerCare', title: 'Customer Care', detail: '1st bill check', team: 'Sales Team', fields: [
    { key: 'firstBillChecked', label: '1st bill checked', type: 'checkbox', required: true },
    { key: 'firstBillDate', label: '1st Bill Date', type: 'date', required: true },
  ] },

  { sno: 16, key: 'cleaning', title: '1st Cleaning', detail: 'Explain maintenance & clean the modules', team: 'Quality / Service', fields: [
    { key: 'cleaningDone', label: 'Modules cleaned', type: 'checkbox', required: true },
    { key: 'maintenanceExplained', label: 'Maintenance explained to customer', type: 'checkbox', required: true },
    { key: 'cleaningDate', label: 'Cleaning Date', type: 'date', required: true },
    { key: 'cleaningPhotos', label: 'Cleaning photos (optional)', type: 'photo' },
  ] },

  { sno: 17, key: 'review', title: 'Get the Review & Reference', detail: 'Final review & any references', team: 'Quality / Service', fields: [
    { key: 'reviewRating', label: 'Customer Rating', type: 'select', options: ['5 - Excellent', '4 - Good', '3 - Average', '2 - Poor', '1 - Bad'], required: true },
    { key: 'feedback', label: 'Feedback', type: 'textarea', required: true },
    { key: 'referenceName', label: 'Reference Customer Name', type: 'text' },
    { key: 'referencePhone', label: 'Reference Customer Phone', type: 'text' },
    { key: 'references', label: 'Other references (names / phones)', type: 'text' },
    { key: 'reviewPhotos', label: 'Review photos / documents (optional)', type: 'photo' },
  ] },

  { sno: 18, key: 'finalReview', title: 'After 3 Months - Final Review', detail: 'Final review after 3 months', team: 'Front Office / Quality', fields: [
    { key: 'finalReviewDate', label: 'Final Review Date', type: 'date', required: true },
    { key: 'finalReviewNotes', label: 'Final Review Notes', type: 'textarea', required: true },
    { key: 'finalRating', label: 'Final Customer Rating', type: 'select', options: ['★★★★★ (5)', '★★★★ (4)', '★★★ (3)', '★★ (2)', '★ (1)'], required: true },
    { key: 'finalPhotos', label: 'Photos (optional)', type: 'photo' },
  ] },
];

export const TOTAL_STAGES = WORKFLOW_STAGES.length;

export const stageByKey = (key) => WORKFLOW_STAGES.find(s => s.key === key) || null;

// A photo field's value as a list. Older records hold one data-URL string;
// newer ones a list of { url, name, at, by }. Both read the same way here.
export function photoList(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(p => p && (typeof p === 'string' ? p : p.url)).map(p => (typeof p === 'string' ? { url: p } : p));
  if (typeof v === 'string') return [{ url: v }];
  if (typeof v === 'object' && v.url) return [v];
  return [];
}

// A list field's value as a list of non-empty strings.
export function listValue(v) {
  if (Array.isArray(v)) return v.map(x => String(x || '').trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(/[\n,]/).map(x => x.trim()).filter(Boolean);
  return [];
}

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
  if (field.type === 'photo' || field.type === 'docs') return photoList(val).length > 0;
  if (field.type === 'list') return listValue(val).length > 0;
  return val != null && String(val).trim() !== '';
}

// Are ALL required fields for a stage satisfied? (enables the Complete button)
export function isStageComplete(stage, values) {
  return (stage.fields || []).every(f => isFieldSatisfied(f, values || {}));
}

// Build the gated view of all stages for a given customer.
// Returns each stage tagged with status: 'completed' | 'current' | 'locked'.
// A stage reopened for a correction is the current one; the completed stages
// after it keep their data and their ticks (Req 1.23, 31-Oct).
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

// The sno of the first stage not yet completed, or the last stage when all are.
export function nextOpenStageSno(stages) {
  const saved = stages || {};
  const open = WORKFLOW_STAGES.find(s => !s.auto && saved[s.key]?.status !== 'completed');
  return open ? open.sno : TOTAL_STAGES;
}

// The customer's workflow with one stage's record replaced. Everything else is
// left exactly as it was: the other stages, their data and their ticks.
export function withStage(customer, key, record) {
  const wf = (customer && customer.workflow) || {};
  const stages = { ...(wf.stages || {}), [key]: record };
  return { ...wf, stages, currentStage: nextOpenStageSno(stages) };
}

// Reopen one stage for a correction: its data stays, only its tick comes off.
// Nothing after it is touched (Req 1.23).
export function reopenedWorkflow(customer, key, by) {
  const wf = (customer && customer.workflow) || {};
  const prev = (wf.stages || {})[key] || {};
  const record = { ...prev, status: 'in_progress', reopenedAt: new Date().toISOString(), reopenedBy: by || '' };
  delete record.completedAt;
  delete record.completedBy;
  return withStage(customer, key, record);
}
