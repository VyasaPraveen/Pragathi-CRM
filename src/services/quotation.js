// ============================================================================
// Pragathi CRM — Quotation workflow, calculations and the standard print format
//
// The printed quotation follows the company's reference proposal exactly: the
// letterhead, the covering letter, the marketing pages, the "Budgetary Proposal"
// table with the generation / payback figures, the Bill of Materials and the
// benefits page. The marketing pages are the company's own artwork and are
// reproduced from /quotation/*.jpg — only the customer, the figures and the BOM
// are generated.
//
// Lifecycle (from the 19-Sep requirement):
//   raised → Pending Approval (2 h, any ONE of Admin / Operation Manager /
//   Management / Owner) → Approved → shared with the customer (within 3 days)
//   → customer accepts within 3 days → PO → BOM,
//   or the customer does not accept → reason + next follow-up date → the lead
//   goes to the assigned Executive's "Pending Follow-up" list.
// ============================================================================

import { toNumber } from './helpers';
import { sortQuoteBomRows } from './bomOrder';

// ── Workflow states ─────────────────────────────────────────────────────────
export const QT_STATUS = {
  PENDING: 'Pending Approval',
  APPROVED: 'Approved',
  SHARED: 'Shared with Customer',
  ACCEPTED: 'Accepted',
  NOT_ACCEPTED: 'Not Accepted',
  REJECTED: 'Rejected',
};

// Service levels, in the units the requirement states them in.
export const APPROVAL_HOURS = 2;      // approve the first quotation within 2 hours
export const SHARE_DAYS = 3;          // share the approved quotation within 3 days
export const ACCEPT_DAYS = 3;         // customer has 3 days to accept
export const FOLLOWUP_REMIND_DAYS = 2; // remind 2 days before the follow-up date
export const MAX_REVISION = 3;        // R1 … R3 without Admin approval

// ── Calculation defaults ────────────────────────────────────────────────────
// Solar generation and savings are derived from the system price and the site's
// tariff, so changing the price changes every figure on the quotation.
export const DEFAULT_UNITS_PER_KW_MONTH = 141; // 3 kW → 423 units p.m. (reference)
export const DEFAULT_TARIFF = 8;               // ₹ per unit ("EB Savings Rs.8")
export const DEFAULT_LOAN_RATE = 0.07;         // bank loan @7%

// ── Numbering & revisions ───────────────────────────────────────────────────
// One quotation number per lead. A revision keeps the number and bumps R1→R3.
export function nextQuotationNumber(quotations) {
  const nums = (quotations || []).map(q => {
    const m = /QTN-(\d+)/.exec(String(q.quotationNumber || ''));
    return m ? parseInt(m[1], 10) : 0;
  });
  const max = nums.length ? Math.max(...nums) : 0;
  return 'QTN-' + String(max + 1).padStart(3, '0');
}

// The reference number as it is printed: "QTN-001" or "QTN-001 – R2".
export function quotationRef(q) {
  const base = String(q?.quotationNumber || '');
  const rev = toNumber(q?.revision);
  return rev > 0 ? `${base} – R${rev}` : base;
}

// The PPS referral number carried onto the quotation, in the reference's
// "<serial>/<dd.mm.yyyy>" form.
export function ppsRefFor(seq, dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${seq}/${dd}.${mm}.${d.getFullYear()}`;
}

// A revision beyond R3 is not generated automatically — it needs Admin approval
// first, which is recorded on the quotation as extraRevisionApprovedBy.
export function canRevise(q) {
  const rev = toNumber(q?.revision);
  if (rev < MAX_REVISION) return { ok: true };
  if (q?.extraRevisionApprovedBy) return { ok: true, extra: true };
  return {
    ok: false,
    reason: `R${MAX_REVISION} is the last revision allowed without Admin approval. ` +
      'Ask an Admin to approve a further revision for this quotation.',
  };
}

// ── Generation & payback ────────────────────────────────────────────────────
// Everything below follows from the system price, so a price change flows
// through the whole calculation block on the quotation.
export function calcQuotation({ kw, systemCost, subsidy, tariff, unitsPerKwMonth, loanRate } = {}) {
  const k = toNumber(kw);
  const cost = toNumber(systemCost);
  const sub = toNumber(subsidy);
  const rate = toNumber(tariff) || DEFAULT_TARIFF;
  const perKw = toNumber(unitsPerKwMonth) || DEFAULT_UNITS_PER_KW_MONTH;
  const loan = loanRate == null ? DEFAULT_LOAN_RATE : toNumber(loanRate);

  const generation = Math.round(k * perKw);           // avg units per month
  const monthlySavings = Math.round(generation * rate);
  const yearlySavings = monthlySavings * 12;
  const netCost = Math.max(0, cost - sub);            // what the customer funds

  // Own funds: how many years of savings pay the net cost back.
  const paybackYears = yearlySavings > 0 ? netCost / yearlySavings : 0;
  // Bank loan: the same, with the interest paid over that period added on.
  const paybackLoanYears = yearlySavings > 0
    ? (netCost * (1 + loan * paybackYears)) / yearlySavings
    : 0;

  return {
    generation,
    monthlySavings,
    yearlySavings,
    netCost,
    tariff: rate,
    unitsPerKwMonth: perKw,
    paybackYears: round2(paybackYears),
    paybackLoanYears: round2(paybackLoanYears),
  };
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ── The standard (default) Bill of Materials ────────────────────────────────
// Used while the quotation is still a proposal. Once the actual PO and its BOM
// are confirmed, bomFromPO() replaces these rows with the real ones.
// Which picture goes beside a material row. The keys below are the template's
// own names; a real purchase order calls the same things "Solar PV Module" or
// "Grid Tie Inverter", so the lookup also matches on a keyword. Without that,
// a quotation built from the actual BOM printed with no pictures at all.
// Order matters: the first pattern that matches wins, so the specific names go
// above the loose ones. "Module Mounting Structure" is a structure, not a
// panel, and "Earthing Cable" is earthing rather than either cable picture.
export const BOM_IMAGE_KEYWORDS = [
  [/mounting\s*structure|\bmms\b/i, ''],
  [/earth|lightening|lightning|\bla\b/i, 'earthing'],
  [/inverter/i, 'inverter'],
  [/acdb/i, 'acdb'],
  [/dcdb/i, 'dcdb'],
  [/\bac\b[\s-]*cable/i, 'ac-cable'],
  [/\bdc\b[\s-]*cable/i, 'dc-cable'],
  [/module|panel/i, 'modules'],
];

export function bomImageFor(material) {
  const name = String(material || '').trim();
  if (!name) return '';
  if (QUOTE_BOM_IMAGES[name]) return QUOTE_BOM_IMAGES[name];
  const hit = BOM_IMAGE_KEYWORDS.find(([re]) => re.test(name));
  return hit ? hit[1] : '';
}

export const QUOTE_BOM_IMAGES = {
  Modules: 'modules',
  'Solar On Grid tie String inverter': 'inverter',
  ACDB: 'acdb',
  DCDB: 'dcdb',
  'AC Cables': 'ac-cable',
  'DC Cable': 'dc-cable',
  'Earthing Kits & Lightening Arrester': 'earthing',
};

// ── Warranty wording (23-Sep requirement) ───────────────────────────────────
// The modules carry 30 years, an inverter 8 years, and the system as a whole 5.
// The three strings live here so the BOM table, the terms block and the
// warranty upgrade below can never drift apart.
export const WARRANTY_MODULES = '30 Years Performance Warranty as per MNRE';
export const WARRANTY_INVERTER = '8 Years – Per Inverter (Extended Warranty Options are also available)';
export const WARRANTY_TERMS = '8 Yrs – Per Inverter, 5 Yrs – Complete System & 30 Yrs for Solar Modules';

// Quotations raised before that change still carry the old wording in their
// saved BOM rows. Only the exact strings this file used to generate are
// rewritten — a warranty typed by hand, or one carried over from a real PO, is
// left exactly as it was entered.
const LEGACY_WARRANTY = {
  '25 Years Performance Warranty as per MNRE': WARRANTY_MODULES,
  '5 Years with Entire System (Extended Warranty Options are also available)': WARRANTY_INVERTER,
  '5 Yrs -Complete System & 25 Yrs for Solar Modules': WARRANTY_TERMS,
};

export function upgradeWarranty(text) {
  const t = String(text == null ? '' : text).trim();
  return LEGACY_WARRANTY[t] || text;
}

// ── The system size a quotation opens with ──────────────────────────────────
// A lead carries two sizes: the kW the enquiry estimated, and — once the site
// has been visited — the load actually sanctioned there. The quotation has to
// be for the second whenever it exists: a 3.43 kW estimate that the visit
// settles at 2 kW must quote 2 kW. Until there has been a visit, or when the
// visit recorded no load, the estimate stands in.
export function quotationKw(lead) {
  const visited = String(lead?.siteVisit || '').trim().toLowerCase() === 'yes';
  const sanctioned = toNumber(lead?.sanctionedLoad);
  if (visited && sanctioned > 0) return String(lead.sanctionedLoad);
  return lead?.kwRequired || '';
}

// Where that size came from, so the form can say so.
export function quotationKwSource(lead) {
  const visited = String(lead?.siteVisit || '').trim().toLowerCase() === 'yes';
  return visited && toNumber(lead?.sanctionedLoad) > 0 ? 'site-visit' : 'estimate';
}

// A blank line for the "Add Item" option on the BOM. Carries the same columns
// as the standard rows so it prints the same; `added` marks it as the user's
// own line, which is the only kind whose material name is editable.
export const EMPTY_BOM_ROW = { material: '', specification: '', quantity: '', warranty: 'NA', added: true };

export function defaultQuoteBOM(kw) {
  const k = toNumber(kw);
  const modules = k > 0 ? Math.ceil((k * 1000) / 595) : '';
  const phase = k > 5 ? '3 Phase' : '1 Phase';
  return [
    { material: 'Modules', specification: 'Mono Perc 595Wp DCR (Bifacial)', quantity: modules ? String(modules) : '', warranty: WARRANTY_MODULES },
    { material: 'Solar On Grid tie String inverter', specification: `${k || '__'}KW - ${phase} - 1 Nos`, quantity: '1 Nos', warranty: WARRANTY_INVERTER },
    { material: 'ACDB', specification: 'Standard', quantity: '1 Nos', warranty: 'NA' },
    { material: 'DCDB', specification: 'Standard', quantity: '1 Nos', warranty: 'NA' },
    { material: 'AC Cables', specification: '3C X 4 Sqmm - 20 Mtrs Poly Cab', quantity: '20 mtrs', warranty: 'NA' },
    { material: 'DC Cable', specification: '4 Sq - Poly Cab', quantity: '20 mtrs', warranty: 'NA' },
    { material: 'Earthing Kits & Lightening Arrester', specification: 'Standard 60 Meters Cable with Earth Pits', quantity: '3', warranty: 'NA' },
  ];
}

// The actual BOM, taken from the confirmed purchase order, in the same shape
// as the default rows so the printed table does not change.
export function bomFromPO(po) {
  return (po?.items || [])
    .filter(it => it && String(it.materialName || '').trim())
    .map(it => ({
      material: String(it.materialName).trim(),
      specification: [it.make, it.specification].filter(Boolean).join(' · ') || 'Standard',
      quantity: [it.actualQuantity !== '' && it.actualQuantity != null ? it.actualQuantity : it.quantity, it.unit].filter(v => v !== '' && v != null).join(' '),
      warranty: it.warranty || 'NA',
    }));
}

// Every material on the lead, not just the first purchase order's.
//
// A lead is often split across more than one PO — the panels on one, the
// structure or the extra cable on another — and the quotation used to take the
// first PO it happened to find and print only those lines, which is why
// materials that had definitely been entered were missing from the quotation.
// All of the lead's POs are merged here, in PO-date order, and a material that
// appears on two of them is listed once with the quantities added up.
export function bomFromLeadPOs(pos, leadId) {
  const mine = (pos || [])
    .filter(po => po && (leadId === undefined || po.leadId === leadId))
    .filter(po => (po.items || []).length)
    .sort((a, b) => String(a.poDate || '').localeCompare(String(b.poDate || '')));

  const out = [];
  const seen = new Map();   // material+spec -> index in out
  mine.forEach(po => bomFromPO(po).forEach(row => {
    const key = (row.material + '|' + row.specification).toLowerCase();
    const at = seen.get(key);
    if (at == null) { seen.set(key, out.length); out.push({ ...row }); return; }
    out[at].quantity = mergeQuantity(out[at].quantity, row.quantity);
  }));
  // In the order the printed BOM sheet lists them, not the order the purchase
  // orders happened to be raised in.
  return sortQuoteBomRows(out);
}

// "12 Nos" + "4 Nos" = "16 Nos". Anything that is not a plain number in the
// same unit is kept side by side rather than guessed at.
function mergeQuantity(a, b) {
  const parse = (v) => {
    const m = /^\s*([\d.]+)\s*(.*)$/.exec(String(v == null ? '' : v));
    return m ? { n: Number(m[1]), unit: m[2].trim() } : null;
  };
  const x = parse(a), y = parse(b);
  if (x && y && !isNaN(x.n) && !isNaN(y.n) && x.unit.toLowerCase() === y.unit.toLowerCase()) {
    return String(Math.round((x.n + y.n) * 100) / 100) + (x.unit ? ' ' + x.unit : '');
  }
  const both = [a, b].map(v => String(v == null ? '' : v).trim()).filter(Boolean);
  return both.join(' + ');
}

// ── Customer cross-check (phone + electrical service number) ────────────────
// Guards against a quotation being raised against the wrong customer record.
export function crossCheckCustomer({ phone, serviceNumber }, { leads = [], customers = [], leadId = '' } = {}) {
  const issues = [];
  const ph = String(phone || '').replace(/\D/g, '');
  const sn = String(serviceNumber || '').trim().toLowerCase();
  if (!ph || ph.length < 10) issues.push('Customer phone number is missing or incomplete.');
  if (!sn) issues.push('Electrical service number is missing — it identifies the connection this system is for.');

  if (ph.length >= 10) {
    const dupLead = leads.find(l => l.id !== leadId && String(l.phone || '').replace(/\D/g, '') === ph);
    if (dupLead) issues.push(`Phone ${phone} is also on lead "${dupLead.name}".`);
    const dupCust = customers.find(c => String(c.phone || '').replace(/\D/g, '') === ph);
    if (dupCust) issues.push(`Phone ${phone} is already a customer: "${dupCust.name}".`);
  }
  if (sn) {
    const other = leads.find(l => l.id !== leadId &&
      String(l.customerServiceNumber || l.meterNumber || '').trim().toLowerCase() === sn);
    if (other) issues.push(`Service number ${serviceNumber} is also on lead "${other.name}".`);
  }
  return issues;
}

// ── Due dates / SLA helpers ─────────────────────────────────────────────────
const addHours = (iso, h) => iso ? new Date(new Date(iso).getTime() + h * 3600000) : null;
const addDays = (iso, d) => addHours(iso, d * 24);

export function quotationDue(q) {
  if (!q) return null;
  switch (q.status) {
    case QT_STATUS.PENDING:
      return { label: 'Approval due', at: addHours(q.createdAt || q.raisedAt, APPROVAL_HOURS), who: 'Admin / Operation Manager / Management / Owner' };
    case QT_STATUS.APPROVED:
      return { label: 'Share with customer by', at: addDays(q.approvedAt, SHARE_DAYS), who: q.executiveName || q.assignedTo || 'the assigned person' };
    case QT_STATUS.SHARED:
      return { label: 'Customer response due', at: addDays(q.sharedAt, ACCEPT_DAYS), who: q.customerName || 'the customer' };
    default:
      return null;
  }
}

export function isOverdue(q, now = new Date()) {
  const due = quotationDue(q);
  return !!(due && due.at && due.at < now);
}

// Whole days (can be negative = overdue) until a YYYY-MM-DD date.
export function daysUntil(dateStr, now = new Date()) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const b = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((b - a) / 86400000);
}

// A lead sits in "Pending Follow-up" once its quotation was not accepted and a
// next follow-up date was recorded.
export function isPendingFollowUp(lead) {
  return !!(lead && lead.pendingFollowUp && lead.status !== 'Converted');
}

// Should the 2-days-ahead reminder fire for this lead?
export function followUpDueSoon(lead, now = new Date()) {
  if (!isPendingFollowUp(lead) && !lead?.nextFollowUpDate) return false;
  const d = daysUntil(lead.nextFollowUpDate, now);
  return d != null && d <= FOLLOWUP_REMIND_DAYS;
}

// ── The printed quotation ───────────────────────────────────────────────────
// There is no longer an HTML copy of the quotation here.
//
// It used to be built twice: this HTML for Print, and the real PDF on the
// server for View / Download / WhatsApp. The two drifted, so Print produced
// last month's layout while View produced the current one — the customer could
// be sent either depending on which button was pressed. Every route now goes
// through server/api/lib/quotation_pdf.php, which is the only copy.
//
// See src/services/quotationShare.js for the client side of that.

// WhatsApp summary of a quotation — what the customer needs at a glance.
export function quotationWhatsAppText(q) {
  const calc = calcQuotation(q);
  return `*PRAGATHI POWER SOLUTIONS*\n` +
    `Quotation: ${quotationRef(q)}\n` +
    (q.ppsRef ? `PPS Ref: ${q.ppsRef}\n` : '') +
    `\nCustomer: ${q.customerName || '-'}\n` +
    `System: ${q.kw || '-'} kW On-Grid Solar\n` +
    `System Cost (incl. GST): ₹${Number(toNumber(q.systemCost)).toLocaleString('en-IN')}\n` +
    (toNumber(q.subsidy) > 0 ? `Subsidy: -₹${Number(toNumber(q.subsidy)).toLocaleString('en-IN')}\n` : '') +
    `Avg Generation: ${calc.generation} units/month\n` +
    `Monthly Savings: ₹${calc.monthlySavings.toLocaleString('en-IN')}\n` +
    `Yearly Savings: ₹${calc.yearlySavings.toLocaleString('en-IN')}\n` +
    `Payback: ${calc.paybackYears.toFixed(2)} years\n` +
    `Offer valid for ${toNumber(q.validityDays) || 15} days.\n` +
    `\n_Pragathi Power Solutions_`;
}
