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

import { escapeHtml, openHtmlSafely, toNumber } from './helpers';

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
export const QUOTE_BOM_IMAGES = {
  Modules: 'modules',
  'Solar On Grid tie String inverter': 'inverter',
  ACDB: 'acdb',
  DCDB: 'dcdb',
  'AC Cables': 'ac-cable',
  'DC Cable': 'dc-cable',
  'Earthing Kits & Lightening Arrester': 'earthing',
};

export function defaultQuoteBOM(kw) {
  const k = toNumber(kw);
  const modules = k > 0 ? Math.ceil((k * 1000) / 595) : '';
  const phase = k > 5 ? '3 Phase' : '1 Phase';
  return [
    { material: 'Modules', specification: 'Mono Perc 595Wp DCR (Bifacial)', quantity: modules ? String(modules) : '', warranty: '25 Years Performance Warranty as per MNRE' },
    { material: 'Solar On Grid tie String inverter', specification: `${k || '__'}KW - ${phase} - 1 Nos`, quantity: '1 Nos', warranty: '5 Years with Entire System (Extended Warranty Options are also available)' },
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
    .filter(it => it.materialName)
    .map(it => ({
      material: it.materialName,
      specification: [it.make, it.specification].filter(Boolean).join(' · ') || 'Standard',
      quantity: [it.actualQuantity !== '' && it.actualQuantity != null ? it.actualQuantity : it.quantity, it.unit].filter(v => v !== '' && v != null).join(' '),
      warranty: it.warranty || 'NA',
    }));
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
const money = (n) => '₹' + Number(toNumber(n)).toLocaleString('en-IN');

// The static marketing pages, in the order of the reference proposal.
const STATIC_PAGES = [
  'p2-netmetering', 'p3-schematic', 'p4-generation', 'p5-comparison',
];

export function quotationHTML(q, opts = {}) {
  const e = escapeHtml;
  const base = opts.assetBase || '/quotation';
  const calc = calcQuotation(q);
  const kw = q.kw || '__';
  const rows = (q.bomItems && q.bomItems.length) ? q.bomItems : defaultQuoteBOM(q.kw);
  const dateText = new Date(q.date || Date.now()).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const page = (inner, extra = '') => `<section class="pg ${extra}">
  <img class="lh" src="${base}/letterhead.jpg" alt="Pragathi Power Solutions" />
  <div class="addr">#19-3-12/J, Ramanuja Circle, Tiruchanoor Road, Tirupati 517501, Mob: 9701461156 &nbsp;Website : www.pragathipowersolutions.com</div>
  <div class="body">${inner}</div>
  <img class="ft" src="${base}/footer-dealer.jpg" alt="TATA Power Solar Authorised Dealer" />
</section>`;

  // Page 1 — covering letter
  const letter = page(`
  <div class="ref">PPS Ref: ${e(q.ppsRef || '')}</div>
  <div class="ref">Quotation No: <strong>${e(quotationRef(q))}</strong> &nbsp;·&nbsp; Date: ${e(dateText)}</div>
  <p class="to">To,<br/>
  ${e(q.customerName || '')},<br/>
  ${e([q.customerAddress, q.city, q.district].filter(Boolean).join(', '))}${q.pincode ? ' - ' + e(q.pincode) : ''}<br/>
  Mob: ${e(q.customerPhone || '')}</p>
  <p>Sir/Madam,</p>
  <p class="sub"><strong>Sub:</strong> Tentative Proposal for Solar Power Generating System Req-Reg.</p>
  <p class="stars">***</p>
  <p>With reference to the our discussion and site visit with your good selves regarding the
  requirement of Power Generating Systems, please find enclosed our budgetary proposal for
  &ldquo;Solar Net metering System&rdquo; for your kind perusal.</p>
  <p>Hope the details provided by us are in line with your requirement, please feel free to
  contact for clarifications if any.</p>
  <p>We assure the best services all the times.</p>
  <p>Thanking You in Advance for your kind cooperation</p>
  <p class="sign">Yours truly,<br/>
  Pragathi Power Solutions,<br/>
  Authorized Signature<br/>
  ${e(q.executiveName || 'K. Chandra Sekhar')}${q.executiveId ? ' (' + e(q.executiveId) + ')' : ''}<br/>
  Mobile : ${e(q.executivePhone || '9701426440')}</p>`);

  // The company's own marketing pages, reproduced unchanged
  const statics = STATIC_PAGES.map(n =>
    `<section class="pg full"><img class="fullimg" src="${base}/${n}.jpg" alt="" /></section>`).join('\n');

  // Page 6 — budgetary proposal, generation and payback
  const proposal = page(`
  <h3 class="h-ul">Budgetary Proposal for Solar Rooftop as per Site Condition:</h3>
  <table class="prop">
    <tr class="hd"><th>Solar Rooftop System<br/>Project Details</th><th class="kw">${e(String(kw))}KW</th></tr>
    <tr><td>System Cost ( Including GST)</td><td class="num"><strong>${money(q.systemCost)}</strong>${toNumber(q.subsidy) > 0 ? `<div class="sub-amt">-${Number(toNumber(q.subsidy)).toLocaleString('en-IN')}</div>` : ''}</td></tr>
    <tr><td>Solar Generation (Avg Units p.m)</td><td class="num">${calc.generation}</td></tr>
    <tr><td>Monthly Avg. EB Savings Rs.${calc.tariff}</td><td class="num">${money(calc.monthlySavings)}</td></tr>
    <tr><td>Yearly Avg. EB Savings Rs.</td><td class="num">${money(calc.yearlySavings)}</td></tr>
    <tr><td>ROI / Pay Back ( In Years) by own Funds</td><td class="num">${calc.paybackYears.toFixed(2)}</td></tr>
    <tr><td>ROI / Pay Back by Bank Loan @${Math.round((q.loanRate == null ? DEFAULT_LOAN_RATE : toNumber(q.loanRate)) * 100)}%</td><td class="num">${calc.paybackLoanYears.toFixed(2)}</td></tr>
    <tr><td class="hd2">Additional Charges/Customer Scope :</td><td></td></tr>
    <tr><td class="red">- CEIG &amp; SPDCL Grid Synchronization(except formalities)</td><td class="num red"><strong>Actuals</strong></td></tr>
    <tr><td class="red">- Any Civil Works / Elevated Structure</td><td class="num red"><strong>Actuals</strong></td></tr>
    <tr><td class="red">- UPVC Pipes , Additional Relay &amp; If any other than BOS Materials</td><td class="num red"><strong>Actuals</strong></td></tr>
    <tr><td colspan="2" class="scope"><strong>Pragathi Scope</strong><br/>-Supply&amp;Installation as per BOM</td></tr>
    <tr><td colspan="2" class="terms">
      <strong>General Terms and Conditions for Supply</strong>:
      <div class="tl2"><span>a.&nbsp; Taxes</span><span>: ${e(q.gstNote || 'GST 8.9 % Applicable')}</span></div>
      <div class="tl2"><span>b.&nbsp; Payment Terms</span><span>: ${e(q.paymentTerms || '100% Along with PO')}</span></div>
      <div class="tl2"><span>c.&nbsp; Delivery Time</span><span>: ${e(q.deliveryTime || '20-30 Days for Material & next 30 Days for Project Completion')}</span></div>
      <div class="tl2"><span>d.&nbsp; Warranty</span><span>: ${e(q.warranty || '5 Yrs -Complete System & 25 Yrs for Solar Modules')}</span></div>
      <div class="tl2"><span>e.&nbsp; Offer Validity</span><span>: Validity of the present offer for ${toNumber(q.validityDays) || 15} Days Only</span></div>
      <div class="opt"><strong>OPTION - II</strong><br/>${e(q.optionTwo || 'Waree / Adani / Kirloskar / Luminous')}</div>
    </td></tr>
  </table>
  <h4 class="h-ul">Our Bank NEFT Details:</h4>
  <p class="bank">PRAGATHI POWER SOLUTIONS,<br/>STATE BANK OF INDIA,<br/>Current A/C NO: 33599271521<br/>IFSC Code: SBIN0010677<br/>RAMANUJA CIRCLE BRANCH, TIRUPATHI-01.</p>`);

  // Page 7 — Bill of Materials
  const bomRows = rows.map(r => {
    const img = QUOTE_BOM_IMAGES[r.material];
    return `<tr>
      <td class="mat">${e(r.material || '')}</td>
      <td class="pic">${img ? `<img src="${base}/bom-${img}.jpg" alt="" />` : ''}</td>
      <td>${e(r.specification || '')}</td>
      <td>${e(String(r.quantity ?? ''))}</td>
      <td>${e(r.warranty || 'NA')}</td>
    </tr>`;
  }).join('');
  const bom = page(`
  <h3 class="h-ul">Bill of Materials</h3>
  ${q.bomSource === 'po' ? '<p class="bomnote">As per the confirmed Purchase Order.</p>' : ''}
  <table class="bom">
    <thead><tr><th>Material Details</th><th></th><th>Specification</th><th>Quantity</th><th>Warranty/ Gaurantee</th></tr></thead>
    <tbody>${bomRows}</tbody>
  </table>`);

  const benefits = `<section class="pg full"><img class="fullimg" src="${base}/p8-benefits.jpg" alt="" /></section>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8" />
<title>Quotation ${e(quotationRef(q))} - ${e(q.customerName || '')}</title>
<style>
*{box-sizing:border-box}
body{font-family:Calibri,'Segoe UI',Arial,sans-serif;margin:0;background:#e9e9e9;color:#000;font-size:13px}
.pg{width:210mm;min-height:297mm;background:#fff;margin:10px auto;padding:10mm 12mm;position:relative;border:1px solid #333;page-break-after:always;display:flex;flex-direction:column}
.pg.full{padding:0;border:none}
.fullimg{width:100%;height:auto;display:block}
.lh{width:100%;display:block}
.addr{border-bottom:2px solid #000;font-size:10.5px;padding:2px 0 4px;margin-bottom:10px}
.body{flex:1}
.ft{width:62%;margin:14px auto 0;display:block}
.ref{font-size:12.5px;margin-bottom:2px}
.to{margin:14px 0;line-height:1.5}
.sub{margin:10px 0}
.stars{text-align:center;margin:2px 0}
p{line-height:1.6;margin:8px 0;text-align:justify}
.sign{margin-top:26px;line-height:1.5;text-align:left}
.h-ul{color:#1f3864;text-decoration:underline;font-size:15px;margin:4px 0 10px}
h4.h-ul{margin-top:16px;font-size:14px}
table{width:100%;border-collapse:collapse}
.prop td,.prop th{border:1px solid #444;padding:5px 8px;font-size:12.5px;vertical-align:middle}
.prop tr.hd th{background:#1f9ad6;color:#fff;text-align:center;font-size:15px;padding:10px}
.prop tr.hd th.kw{width:22%;font-size:17px}
.prop td.num{text-align:right;font-weight:600;width:22%}
.sub-amt{color:#1f9ad6;font-weight:400;font-size:11.5px}
.red{color:#c00}
.hd2{color:#7030a0;font-weight:700;font-size:13.5px}
.scope{font-size:12.5px}
.terms{font-size:12px}
.tl2{display:flex;gap:6px;padding:1px 0 1px 14px}
.tl2 span:first-child{min-width:120px}
.opt{color:#00f;margin-top:8px;font-weight:600}
.opt+*{color:#00f}
.bank{font-family:'Times New Roman',serif;font-size:13.5px;line-height:1.5;text-align:left}
.bom th,.bom td{border:1px solid #444;padding:6px;font-size:12px;text-align:center;vertical-align:middle}
.bom thead th{font-weight:700}
.bom td.mat{text-align:left;width:20%}
.bom td.pic{width:24%}
.bom td.pic img{max-width:130px;max-height:92px;object-fit:contain}
.bomnote{font-size:11.5px;color:#1f3864;margin:0 0 6px}
@media print{body{background:#fff}.pg{margin:0;border:none;width:auto;min-height:auto;padding:8mm 10mm}}
</style></head><body>
${letter}
${statics}
${proposal}
${bom}
${benefits}
</body></html>`;
}

export function printQuotation(q) {
  openHtmlSafely(quotationHTML(q), true);
}

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
