import { escapeHtml } from './helpers';

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
@media print{body{padding:20px 30px}.lead-box{background:#f8f9fa !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
</head><body>
<div style="text-align:center;border-bottom:2px solid #000;padding-bottom:12px;margin-bottom:16px">
<img src="/logo.png" alt="Pragathi Power Solutions" style="max-height:60px;object-fit:contain;margin-bottom:4px" onerror="this.style.display='none'" />
<p style="margin:2px 0;font-size:11px">19-3-12/J, Ramanuja Circle, Tiruchanoor Road, Tirupati-517501 | Mob: 9701426440 | Email: ppstirupathi@gmail.com</p>
<p style="margin:0;font-size:11px;font-weight:600">GST: 37AAOFP6349K2ZG</p>
</div>
<h2>Purchase Order</h2>
<div class="date-line">Dated: ${e(po.poDate || '___________')}</div>
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
<span><strong>Lead Status:</strong> ${e(l.status || '-')}</span>
<span><strong>Priority:</strong> ${e(l.priority || '-')}</span>
<span><strong>kW Required:</strong> ${e(po.kwRequired || l.kwRequired || '-')}</span>
<span><strong>Monthly Bill:</strong> ${l.monthlyBill ? e(l.monthlyBill) + ' Units' : '-'}</span>
${l.expectedValue ? `<span><strong>Expected Value:</strong> \u20b9${Number(l.expectedValue).toLocaleString('en-IN')}</span>` : ''}
<span><strong>Lead Source:</strong> ${e(l.leadReference || '-')}</span>
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
${po.referenceNumber ? `<p><strong>Note-</strong> : All Technical specifications should be inline with your Reference No: ${po.referenceNumber}.</p>` : ''}
<br/>
<p><strong>Other Terms &amp; Conditions</strong></p>
<table class="terms-tbl">
<tr><td>Taxes</td><td>:</td><td>GST included.</td></tr>
<tr><td>Freight</td><td>:</td><td>Included in the above said prices.</td></tr>
<tr><td>Guarantee/Warranty</td><td>:</td><td>${po.warrantyTerms || 'Solar Inverter \u2013 5 Yrs, Solar Modules- 5 Yrs +20 Yrs'}</td></tr>
<tr><td>Delivery Lead Time</td><td>:</td><td>${po.deliveryTerms || '3-4 Weeks from the receipt of LOI /PO.'}</td></tr>
<tr><td>Installation Lead Time</td><td>:</td><td>${po.installationTerms || 'Within 10 days from the date of material received.'}</td></tr>
<tr><td>Pay-term</td><td>:</td><td>${po.paymentTerms || '80% Advance along with PO, 20% Before dispatching the materials against PI.'}</td></tr>
</table>
<p style="margin-top:30px">With Regards,</p>
<div class="sig-section">
<div class="sig-block"><div class="sig-line">${po.customerName || l.name || '___'}<br/>${po.customerAddress || l.address || ''}</div></div>
<div class="sig-block"><div class="sig-line">Authorized Signature<br/>Pragathi Power Solutions</div></div>
</div>
<div class="footer">Ref: ${po.poNumber} | Pragathi Power Solutions \u2014 Printed on ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
</body></html>`;
}

export function printPO(po, lead) {
  const w = window.open('', '_blank');
  if (!w) { alert('Popup blocked \u2014 please allow popups to print.'); return; }
  w.document.write(buildPOHtml(po, lead));
  w.document.close();
  w.print();
}

export function downloadPO(po, lead) {
  const w = window.open('', '_blank');
  if (!w) { alert('Popup blocked \u2014 please allow popups.'); return; }
  w.document.write(buildPOHtml(po, lead));
  w.document.close();
}

export function buildBOMHtml(po, lead) {
  const items = po.items || [];
  const l = lead || {};
  const e = escapeHtml;
  return `<html><head><title>Bill of Materials - ${e(po.poNumber || '')}</title>
<style>
body{font-family:Arial,sans-serif;padding:20px 30px;font-size:12px;color:#000;line-height:1.5}
.hdr{text-align:center;border-bottom:2px solid #000;padding-bottom:10px;margin-bottom:6px}
.hdr p{margin:2px 0;font-size:11px}
.gst-row{display:flex;justify-content:space-between;font-size:11px;font-weight:600;margin-bottom:10px}
.addr-line{text-align:center;font-size:11px;margin-bottom:10px;line-height:1.6}
.title{text-align:center;font-size:15px;font-weight:700;margin:14px 0;text-decoration:underline}
.info-row{display:flex;justify-content:space-between;margin-bottom:12px;font-size:12px}
table{width:100%;border-collapse:collapse;margin:10px 0}
th,td{border:1px solid #000;padding:5px 8px;text-align:left;font-size:11px}
th{background:#f0f0f0;font-weight:700}
.scope-th{text-align:center}
.scope-td{text-align:center;font-size:13px}
.decl{margin-top:20px;font-size:11px;line-height:1.6}
.sig-row{display:flex;justify-content:space-between;margin-top:50px}
.sig-box{text-align:center;min-width:180px;font-size:11px}
.sig-box .line{border-top:1px solid #000;margin-top:60px;padding-top:4px}
.approvals{display:flex;justify-content:space-between;margin-top:50px;font-size:10px;text-align:center}
.approvals div{border-top:1px solid #000;padding-top:4px;min-width:140px}
@media print{body{padding:10px 15px}}
</style>
</head><body>
<div class="hdr">
<img src="/logo.png" alt="Pragathi Power Solutions" style="max-height:60px;object-fit:contain" onerror="this.style.display='none'" />
</div>
<div class="gst-row">
<span>GST : 37AAOFP6349K2ZG</span>
<span>9700073796</span>
</div>
<div class="addr-line">19-3-12/J, Ramanuja Circle, Tiruchanoor Road, Tirupati-1, Mob: 9701461156 E-Mail: ppstirupathi@gmail.com</div>
<div class="title">Bill of Materials</div>
<div class="info-row">
<div><strong>Customer / Vendor Details:</strong><br/>${e(po.customerName || l.name || '___')}<br/>${e(po.customerAddress || l.address || '')}<br/>Ph: ${e(po.customerPhone || l.phone || '')}</div>
<div style="text-align:right"><strong>PO NO / Date :</strong><br/>${e(po.poNumber || '___')} / ${e(po.poDate || '___')}</div>
</div>
<table>
<thead>
<tr>
<th rowspan="2" style="width:40px">Sl. No</th>
<th rowspan="2">Description of Material</th>
<th rowspan="2" style="width:50px">UOM</th>
<th rowspan="2">Make</th>
<th rowspan="2">Model / Rating</th>
<th rowspan="2" style="width:55px">Quantity</th>
<th colspan="2" class="scope-th">Scope</th>
</tr>
<tr><th class="scope-th" style="width:60px">Pragathi</th><th class="scope-th" style="width:60px">Customer</th></tr>
</thead>
<tbody>
${items.map((item, i) => `<tr>
<td>${i + 1}</td>
<td>${e(item.materialName || '')}</td>
<td>${e(item.unit || 'Nos')}</td>
<td>${e(item.make || '')}</td>
<td>${e(item.specification || '')}</td>
<td>${item.quantity || ''}</td>
<td class="scope-td">${item.scopePragathi ? '✓' : ''}</td>
<td class="scope-td">${item.scopeCustomer ? '✓' : ''}</td>
</tr>`).join('')}
<tr style="font-weight:700"><td></td><td colspan="4" style="text-align:right">Total Quantity</td><td>${items.reduce((s, it) => s + Number(it.quantity || 0), 0)}</td><td></td><td></td></tr>
</tbody>
</table>
<div class="decl">
We hereby agreed and confirm that the above-Bill of Materials &amp; Scope of Works
</div>
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
  const w = window.open('', '_blank');
  if (!w) { alert('Popup blocked \u2014 please allow popups to print.'); return; }
  w.document.write(buildBOMHtml(po, lead));
  w.document.close();
  w.print();
}

export function downloadBOM(po, lead) {
  const w = window.open('', '_blank');
  if (!w) { alert('Popup blocked \u2014 please allow popups.'); return; }
  w.document.write(buildBOMHtml(po, lead));
  w.document.close();
}

export function sharePOWhatsApp(po) {
  const items = (po.items || []).map((item, i) =>
    (i + 1) + '. ' + item.materialName + (item.specification ? ' (' + item.specification + ')' : '') + ' - Qty: ' + item.quantity + (item.unit ? ' ' + item.unit : '') + ' - \u20b9' + Number(item.amount).toLocaleString('en-IN')
  ).join('\n');

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
    'Date: ' + (po.poDate || '-') + '\n' +
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
    '\nDate: ' + (po.approvalDate || '-') +
    '\n\n_Pragathi Power Solutions_';

  if (po.customerPhone) {
    const phone = po.customerPhone.replace(/\D/g, '');
    window.open('https://wa.me/91' + phone + '?text=' + encodeURIComponent(msg), '_blank');
  } else {
    window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
  }
}
