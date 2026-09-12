import { escapeHtml, formatDate } from './helpers';

const money = (v) => {
  const n = Number(v);
  return !isNaN(n) && n > 0 ? '\u20b9' + n.toLocaleString('en-IN') : '';
};

// The four details captured on the PO that must also appear on the printed
// quotation / BOM. Each falls back to the matching field on the lead.
function poMeta(po, lead) {
  const l = lead || {};
  return {
    referredBy: po.referredBy || l.referredByName || '',
    sourceOfLead: po.sourceOfLead || l.leadReference || '',
    amount: po.amount || po.agreedPrice || po.totalValue || '',
    date: po.poDate || '',
    uscNo: po.uscNo || l.customerServiceNumber || l.meterNumber || '',
  };
}

// Company letterhead, as printed on the official BOM sheet.
function letterhead() {
  return `<div class="lh">
<img src="/logo.png" alt="Pragathi Power Solutions" class="lh-logo" onerror="this.style.display='none'" />
<div class="lh-txt">
  <div class="lh-name">Pragathi Power Solutions</div>
  <div class="lh-tag">Power from the Sun... To Power every one</div>
</div>
<div class="lh-since">Since 2012</div>
</div>
<div class="lh-sub">19-3-12/J, Ramanuja Circle, Tiruchanoor Road, Tirupati-517501 &nbsp;|&nbsp; Mob: 9701426440 &nbsp;|&nbsp; ppstirupathi@gmail.com &nbsp;|&nbsp; GST: 37AAOFP6349K2ZG</div>`;
}

// The Bill of Materials table, laid out exactly like the printed sheet:
// S.No | Description | UOM | Make | Model/Rating | Quantity (Estimation |
// Actuals) | Scope (Pragathi | Customer), closed by a Total Quantity row.
function bomTableHtml(po) {
  const e = escapeHtml;
  const items = (po.items || []).filter(it => it && (it.materialName || it.quantity));
  const totalQty = items.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);
  const rows = items.length
    ? items.map((item, i) => `<tr>
<td class="c">${i + 1}</td>
<td>${e(item.materialName || '')}</td>
<td class="c">${e(item.unit || '')}</td>
<td>${e(item.make || '')}</td>
<td>${e(item.specification || '')}</td>
<td class="c">${item.quantity !== '' && item.quantity != null ? e(String(item.quantity)) : ''}</td>
<td class="c">${item.actualQuantity !== '' && item.actualQuantity != null ? e(String(item.actualQuantity)) : ''}</td>
<td class="c tick">${item.scopePragathi ? '\u2713' : ''}</td>
<td class="c tick">${item.scopeCustomer ? '\u2713' : ''}</td>
</tr>`).join('')
    : '<tr><td colspan="9" class="c" style="padding:14px">No materials added</td></tr>';

  return `<table class="bom">
<thead>
<tr>
  <th rowspan="2" style="width:38px">S. No</th>
  <th rowspan="2">Description of Material</th>
  <th rowspan="2" style="width:48px">UOM</th>
  <th rowspan="2" style="width:110px">Make</th>
  <th rowspan="2" style="width:90px">Model / Rating</th>
  <th colspan="2" class="c">Quantity</th>
  <th colspan="2" class="c">Scope</th>
</tr>
<tr>
  <th class="c" style="width:70px">Estimation</th>
  <th class="c" style="width:60px">Actuals</th>
  <th class="c" style="width:62px">Pragathi</th>
  <th class="c" style="width:62px">Customer</th>
</tr>
</thead>
<tbody>
${rows}
<tr class="tot"><td></td><td>Total Quantity</td><td class="c">Nos</td><td></td><td></td><td class="c">${totalQty || ''}</td><td class="c"></td><td></td><td></td></tr>
</tbody>
</table>`;
}

// Shared print styles for the letterhead + BOM table.
const DOC_CSS = `
.lh{display:flex;align-items:center;gap:12px;border-bottom:2px solid #000;padding-bottom:8px}
.lh-logo{max-height:56px;object-fit:contain}
.lh-txt{flex:1;text-align:center}
.lh-name{font-size:23px;font-weight:800;letter-spacing:.3px;line-height:1.1}
.lh-tag{font-size:10.5px;font-style:italic}
.lh-since{font-size:12px;font-weight:700;white-space:nowrap;align-self:flex-start}
.lh-sub{text-align:center;font-size:10px;margin:5px 0 10px}
table.bom{width:100%;border-collapse:collapse;margin:0}
table.bom th,table.bom td{border:1px solid #000;padding:3px 6px;font-size:10.5px;vertical-align:middle}
table.bom th{background:#f0f0f0;font-weight:700;text-align:center}
table.bom td.c{text-align:center}
table.bom td.tick{font-size:12px;font-weight:700}
table.bom tr.tot td{font-weight:700}
.meta{width:100%;border-collapse:collapse;margin-top:8px}
.meta td{border:1px solid #000;padding:4px 8px;font-size:11px}
.meta .lbl{font-weight:700;white-space:nowrap}
.bom-title{text-align:center;font-weight:700;font-size:14px;border:1px solid #000;border-bottom:none;padding:4px}
@media print{table.bom th{background:#f0f0f0 !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`;

// The header block above the table: Refered By / Source of Lead, then Customer
// Name, PO No / Date and Amount, then USC NO — as on the printed sheet.
function bomMetaHtml(po, lead) {
  const e = escapeHtml;
  const l = lead || {};
  const m = poMeta(po, lead);
  return `<table class="meta">
<tr>
  <td class="lbl" style="width:110px">Refered By</td><td>${e(m.referredBy)}</td>
  <td class="lbl" style="width:110px">Source of Lead</td><td>${e(m.sourceOfLead)}</td>
</tr>
<tr>
  <td class="lbl">Customer Name</td><td>${e(po.customerName || l.name || '')}</td>
  <td class="lbl">PO No / Date</td><td>${e(po.poNumber || '')}${m.date ? ' / ' + e(formatDate(m.date)) : ''}</td>
</tr>
<tr>
  <td class="lbl">USC NO</td><td>${e(m.uscNo)}</td>
  <td class="lbl">Amount</td><td>${e(money(m.amount))}</td>
</tr>
</table>`;
}

export function buildPOHtml(po, lead) {
  const agreedPrice = Number(po.agreedPrice || po.totalValue || 0);
  const l = lead || {};
  const e = escapeHtml;
  return `<html><head><title>Purchase Order - ${e(po.poNumber)}</title>
<style>
body{font-family:'Times New Roman',Times,serif;padding:40px 50px;line-height:1.8;font-size:14px;color:#000}
h2{text-align:center;margin:0 0 20px;font-size:18px;text-decoration:underline}
.date-line{text-align:right;margin-bottom:20px}
.addr{margin-bottom:8px;line-height:1.6}
.addr strong{font-size:14px}
.lead-box{background:#f8f9fa;border:1px solid #ddd;border-radius:6px;padding:12px 16px;margin:16px 0;font-size:12px;line-height:1.7}
.lead-box h4{margin:0 0 6px;font-size:13px;border-bottom:1px solid #ddd;padding-bottom:4px}
.lead-grid{display:grid;grid-template-columns:1fr 1fr;gap:2px 20px}
.lead-grid span{display:block}
.lead-grid strong{min-width:100px;display:inline-block}
.terms-tbl{margin:15px 0}
.terms-tbl td{padding:4px 12px 4px 0;vertical-align:top;font-size:13px}
.terms-tbl td:first-child{font-weight:600;white-space:nowrap;padding-right:8px}
.terms-tbl td:nth-child(2){padding-right:8px}
.sig-section{margin-top:60px;display:flex;justify-content:space-between}
.sig-block{text-align:center;min-width:200px}
.sig-line{border-top:1px solid #000;margin-top:70px;padding-top:5px;font-size:12px}
.footer{margin-top:40px;font-size:10px;color:#999;text-align:center;border-top:1px solid #ccc;padding-top:8px}
.bom-page{page-break-before:always;margin-top:24px}
${DOC_CSS}
@media print{body{padding:20px 30px}.lead-box{background:#f8f9fa !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
</head><body>
<div style="text-align:center;border-bottom:2px solid #000;padding-bottom:12px;margin-bottom:16px">
<img src="/logo.png" alt="Pragathi Power Solutions" style="max-height:60px;object-fit:contain;margin-bottom:4px" onerror="this.style.display='none'" />
<p style="margin:2px 0;font-size:11px">19-3-12/J, Ramanuja Circle, Tiruchanoor Road, Tirupati-517501 | Mob: 9701426440 | Email: ppstirupathi@gmail.com</p>
<p style="margin:0;font-size:11px;font-weight:600">GST: 37AAOFP6349K2ZG</p>
</div>
<h2>Purchase Order</h2>
<div class="date-line">Dated: ${po.poDate ? e(formatDate(po.poDate)) : '___________'}</div>
<div class="addr">
<strong>To</strong><br/>
${e(po.vendorName || 'M/S. Tata Power Solar Systems Limited')},<br/>
78, Electronic City, Phase 1,<br/>
Hosur Road, Bangalore - 560100
</div>
<div class="addr" style="margin-top:16px">
<strong>Through</strong><br/><br/>
<strong>Pragathi Power Solutions</strong><br/>
19-3-12/J, Ground Floor, Ramanuja Circle,<br/>
Tiruchanoor Road, Tirupati-517501, Chittoor, AP.<br/>
Contact No: 9701426440.
</div>

<div class="lead-box">
<h4>Lead / Customer Details</h4>
<div class="lead-grid">
<span><strong>Name:</strong> ${e(po.customerName || l.name || '-')}</span>
<span><strong>Phone:</strong> ${e(po.customerPhone || l.phone || '-')}</span>
<span><strong>Address:</strong> ${e(po.customerAddress || l.address || '-')}</span>
<span><strong>City:</strong> ${e(l.city || '-')}${l.district ? ', ' + e(l.district) : ''}${l.pincode ? ' - ' + e(l.pincode) : ''}</span>
${l.email ? `<span><strong>Email:</strong> ${e(l.email)}</span>` : ''}
<span><strong>Priority:</strong> ${e(l.priority || '-')}</span>
<span><strong>kW Required:</strong> ${e(po.kwRequired || l.kwRequired || '-')}</span>
<span><strong>Monthly Bill:</strong> ${l.monthlyBill ? e(l.monthlyBill) + ' Units' : '-'}</span>
${l.expectedValue ? `<span><strong>Expected Value:</strong> \u20b9${Number(l.expectedValue).toLocaleString('en-IN')}</span>` : ''}
<span><strong>Source of Lead:</strong> ${e(poMeta(po, lead).sourceOfLead || '-')}</span>
<span><strong>Referred By:</strong> ${e(poMeta(po, lead).referredBy || '-')}</span>
<span><strong>Amount:</strong> ${money(poMeta(po, lead).amount) || '-'}</span>
<span><strong>Date:</strong> ${po.poDate ? e(formatDate(po.poDate)) : '-'}</span>
${l.assignedTo ? `<span><strong>Assigned To:</strong> ${e(l.assignedTo)}</span>` : ''}
${l.salesExecutive ? `<span><strong>Sales Executive:</strong> ${e(l.salesExecutive)}</span>` : ''}
<span><strong>Site Visit:</strong> ${e(l.siteVisit || 'No')}${l.siteVisitDate ? ' (' + e(l.siteVisitDate) + ')' : ''}</span>
<span><strong>Quotation Sent:</strong> ${e(l.quotationSent || 'No')}</span>
<span><strong>Advance Paid:</strong> ${e(l.advancePaid || 'No')}</span>
${l.existingConnection ? `<span><strong>Connection:</strong> ${e(l.existingConnection)}</span>` : ''}
${l.roofType ? `<span><strong>Roof Type:</strong> ${e(l.roofType)}</span>` : ''}
${l.structureType ? `<span><strong>Structure:</strong> ${e(l.structureType)}</span>` : ''}
${l.floors ? `<span><strong>Floors:</strong> ${e(l.floors)}</span>` : ''}
${l.sanctionedLoad ? `<span><strong>Sanctioned Load:</strong> ${e(l.sanctionedLoad)} kW</span>` : ''}
${l.meterNumber ? `<span><strong>Meter No:</strong> ${e(l.meterNumber)}</span>` : ''}
${l.consumerNumber ? `<span><strong>Consumer No:</strong> ${e(l.consumerNumber)}</span>` : ''}
${l.availableSpace ? `<span><strong>Available Space:</strong> ${e(l.availableSpace)}</span>` : ''}
${l.followUpStatus ? `<span><strong>Follow-up:</strong> ${e(l.followUpStatus)}</span>` : ''}
${l.referredByName ? `<span><strong>Referred By:</strong> ${e(l.referredByName)} (${e(l.referredByType || '')})</span>` : ''}
${l.notes ? `<span style="grid-column:1/-1"><strong>Notes:</strong> ${e(l.notes)}</span>` : ''}
</div>
</div>

<p>Sir,</p>
<p>We are pleased to release the Letter of Indent / PO for the Supply &amp; Installation of Tata Power Solar System of <strong>${e(po.moduleCount || '___')}</strong> Modules with <strong>${e(po.inverterDetails || '___')}</strong> Inverter on our Residential Building/ Plant Location <strong>${e(po.plantLocation || po.customerAddress || '___')}</strong>.</p>
<p><strong>Company Scope</strong>&emsp;: ${e(po.companyScope || 'System Supply and Installation as per BOM.')}</p>
<p><strong>Customer Scope</strong>&emsp;: ${e(po.customerScope || 'Civil works, UPVC Pipes, Additional cable if required more than 20 metres and Grid Synchronization Charges and Coordination with APSPDCL.')}</p>
<p><strong>Final agreed price</strong>&emsp;: Rs. ${agreedPrice > 0 ? agreedPrice.toLocaleString('en-IN') : '_______________'} Including GST.</p>
${po.referenceNumber ? `<p><strong>Note-</strong> : All Technical specifications should be inline with your Reference No: ${e(po.referenceNumber)}.</p>` : ''}
<br/>
<p><strong>Other Terms &amp; Conditions</strong></p>
<table class="terms-tbl">
<tr><td>Taxes</td><td>:</td><td>GST included.</td></tr>
<tr><td>Freight</td><td>:</td><td>Included in the above said prices.</td></tr>
<tr><td>Guarantee/Warranty</td><td>:</td><td>${e(po.warrantyTerms || 'Solar Inverter \u2013 5 Yrs, Solar Modules- 5 Yrs +20 Yrs')}</td></tr>
<tr><td>Delivery Lead Time</td><td>:</td><td>${e(po.deliveryTerms || '3-4 Weeks from the receipt of LOI /PO.')}</td></tr>
<tr><td>Installation Lead Time</td><td>:</td><td>${e(po.installationTerms || 'Within 10 days from the date of material received.')}</td></tr>
<tr><td>Pay-term</td><td>:</td><td>${e(po.paymentTerms || '80% Advance along with PO, 20% Before dispatching the materials against PI.')}</td></tr>
</table>
<div class="bom-page">
<div class="bom-title">Bill of Materials</div>
${bomMetaHtml(po, lead)}
${bomTableHtml(po)}
<p style="font-size:11px;margin:10px 0 0">We hereby agreed and confirm that the above - Bill of Materials &amp; Scope of Works</p>
</div>
<p style="margin-top:30px">With Regards,</p>
<div class="sig-section">
<div class="sig-block"><div class="sig-line">${e(po.customerName || l.name || '___')}<br/>${e(po.customerAddress || l.address || '')}</div></div>
<div class="sig-block"><div class="sig-line">Authorized Signature<br/>Pragathi Power Solutions</div></div>
</div>
<div class="footer">Ref: ${po.poNumber} | Pragathi Power Solutions \u2014 Printed on ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
</body></html>`;
}

// Safe HTML renderer: uses Blob URL instead of document.write to prevent DOM injection
function openHtmlSafely(html, shouldPrint = false) {
  const blob = new Blob([html], { type: 'text/html; charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (!w) { alert('Popup blocked \u2014 please allow popups.'); URL.revokeObjectURL(url); return; }
  w.addEventListener('afterprint', () => URL.revokeObjectURL(url));
  if (shouldPrint) w.addEventListener('load', () => w.print());
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function printPO(po, lead) {
  openHtmlSafely(buildPOHtml(po, lead), true);
}

export function downloadPO(po, lead) {
  openHtmlSafely(buildPOHtml(po, lead), false);
}

export function buildBOMHtml(po, lead) {
  const e = escapeHtml;
  return `<html><head><title>Bill of Materials - ${e(po.poNumber || '')}</title>
<style>
body{font-family:Arial,Helvetica,sans-serif;padding:18px 24px;font-size:11px;color:#000;line-height:1.45}
.bom-title{text-align:center;font-weight:700;font-size:15px;border:1px solid #000;border-bottom:none;padding:5px}
.decl{margin-top:14px;font-size:11px}
.sig-row{display:flex;justify-content:space-between;margin-top:46px}
.sig-box{text-align:center;min-width:190px;font-size:11px}
.sig-box .line{border-top:1px solid #000;margin-top:50px;padding-top:4px}
.approvals{display:flex;justify-content:space-between;margin-top:42px;font-size:10px;text-align:center}
.approvals div{border-top:1px solid #000;padding-top:4px;min-width:150px}
${DOC_CSS}
@media print{body{padding:10px 14px}}
</style>
</head><body>
${letterhead()}
<div class="bom-title">Bill of Materials</div>
${bomMetaHtml(po, lead)}
${bomTableHtml(po)}
<div class="decl">We hereby agreed and confirm that the above - Bill of Materials &amp; Scope of Works</div>
<div class="sig-row">
<div class="sig-box"><div class="line">Customer Signature</div></div>
<div class="sig-box"><div class="line">Pragathi Sales Representative</div></div>
</div>
<div class="approvals">
<div>Procurement</div>
<div>Finance Dept</div>
<div>Management</div>
</div>
</body></html>`;
}

export function printBOM(po, lead) {
  openHtmlSafely(buildBOMHtml(po, lead), true);
}

export function downloadBOM(po, lead) {
  openHtmlSafely(buildBOMHtml(po, lead), false);
}

export function sharePOWhatsApp(po) {
  const items = (po.items || []).map((item, i) => {
    // Lead-PO items carry make/model but no rate/amount \u2014 only append the price when it's a real number
    const amt = Number(item.amount);
    const amtStr = !isNaN(amt) && amt > 0 ? ' - \u20b9' + amt.toLocaleString('en-IN') : '';
    return (i + 1) + '. ' + item.materialName + (item.specification ? ' (' + item.specification + ')' : '') + ' - Qty: ' + (item.quantity || '-') + (item.unit ? ' ' + item.unit : '') + amtStr;
  }).join('\n');

  const extraLines = [
    { label: 'Discom Charges', val: Number(po.discomCharges || 0) },
    { label: 'Civil Work', val: Number(po.civilWork || 0) },
    { label: 'UPVC Pipes', val: Number(po.upvcPipes || 0) },
    { label: 'Additional Relay', val: Number(po.additionalRelay || 0) },
    { label: 'Elevated Structure', val: Number(po.elevatedStructure || 0) },
    { label: 'Additional BOM', val: Number(po.additionalBom || 0) },
    { label: 'Others', val: Number(po.otherCharges || 0) }
  ].filter(e => e.val > 0);
  const extraTotal = Number(po.extraChargesTotal || 0);

  const msg = '*PURCHASE ORDER - ' + po.poNumber + '*\n' +
    'Ref: ' + po.poNumber + '\n\n' +
    'Date: ' + (po.poDate ? formatDate(po.poDate) : '-') + '\n' +
    'Customer: ' + (po.customerName || '-') + '\n' +
    'Address: ' + (po.customerAddress || '-') + '\n' +
    'kW: ' + (po.kwRequired || '-') + '\n' +
    'Vendor: ' + (po.vendorName || '-') + '\n\n' +
    '*BOM Items:*\n' + items + '\n\n' +
    '*BOM Total: \u20b9' + Number(po.totalValue || 0).toLocaleString('en-IN') + '*' +
    (extraLines.length > 0 ? '\n\n*Extra Charges:*\n' + extraLines.map(e => '\u2022 ' + e.label + ': \u20b9' + e.val.toLocaleString('en-IN')).join('\n') + '\n*Extra Total: \u20b9' + extraTotal.toLocaleString('en-IN') + '*' : '') +
    (po.agreedPrice ? '\n\n*Price After Subsidy: \u20b9' + Number(po.agreedPrice).toLocaleString('en-IN') + '*' : '') +
    '\n\nPayment: ' + (po.paymentTerms || '80% advance, 20% before dispatch') +
    '\nWarranty: ' + (po.warrantyTerms || 'Inverter 5yr, Modules 5+20yr') +
    '\nDelivery: ' + (po.deliveryTerms || '3-4 weeks') +
    '\n\nApproved by: ' + (po.approvedBy || '-') +
    '\nDate: ' + (po.approvalDate ? formatDate(po.approvalDate) : '-') +
    '\n\n_Pragathi Power Solutions_';

  if (po.customerPhone) {
    const phone = String(po.customerPhone).replace(/\D/g, '');
    const num = phone.length === 10 ? '91' + phone : phone;
    window.open('https://wa.me/' + num + '?text=' + encodeURIComponent(msg), '_blank');
  } else {
    window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
  }
}
