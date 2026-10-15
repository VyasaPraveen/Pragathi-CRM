// ============================================================================
// Purchase Order helpers.
//
// The PO and its Bill of Materials used to be built here twice over as HTML —
// once as a PO letter with the BOM appended, once as a standalone BOM sheet —
// and the two had drifted apart from each other and from the company's own
// reference document. Both are now one PDF, drawn on the server from a single
// layout (server/api/lib/po_pdf.php). What stays here is the WhatsApp summary,
// which is text and has no layout to share.
// ============================================================================

import { formatDate } from './helpers';
import { openPoPdf, downloadPoPdf } from './poShare';

// The same two pages under the four names the screens already call, because
// the PO and the BOM are one document: page 1 the Letter of Indent, page 2 the
// Bill of Materials with its signatures.
export const printPO = (po, onError) => openPoPdf(po, onError);
export const downloadPO = (po, onError) => downloadPoPdf(po, onError);
export const printBOM = (po, onError) => openPoPdf(po, onError);
export const downloadBOM = (po, onError) => downloadPoPdf(po, onError);

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
    '\n\nPayment: ' + (po.paymentTerms || '10% Advance along with PO, 80% Before dispatch the Material, and balance 10% After Installation.') +
    '\nWarranty: ' + (po.warrantyTerms || 'BOS - 5 Yrs, Solar Inverter - 8 Yrs, Solar Modules - 30 Yrs') +
    '\nDelivery: ' + (po.deliveryTerms || '2-3 Weeks from the receipt of LOI /PO.') +
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
