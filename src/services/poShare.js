// ============================================================================
// Getting the Purchase Order out of the system as a file.
//
// The PO and its Bill of Materials are one document — two pages of the
// company's reference: the Letter of Indent on page 1 and the BOM on page 2.
// The server builds it (server/api/lib/po_pdf.php) so there is a real PDF to
// open, save or send, rather than a browser print with no file at the end.
//
// It used to be drawn twice in HTML, once as a PO and once as a BOM sheet, and
// the two had already drifted apart. There is now one layout, on the server.
// ============================================================================

import { apiGet } from './api';
import { openInNewTab, downloadUrl } from './quotationShare';

// → { url, absoluteUrl, name, bytes, poNumber, materials }
export async function buildPoPdf(poId) {
  if (!poId) throw new Error('Save the purchase order before generating its PDF.');
  const res = await apiGet('/po-pdf?id=' + encodeURIComponent(poId));
  if (!res || !res.url) throw new Error('The server did not return a purchase order PDF.');
  return { ...res, absoluteUrl: absolute(res.url) };
}

function absolute(url) {
  if (/^https?:\/\//i.test(url)) return url;
  if (typeof window === 'undefined' || !window.location) return url;
  return window.location.origin + (url.startsWith('/') ? url : '/' + url);
}

// The call sites are plain onClick handlers, so failures are reported here
// rather than left for each of them to remember.
const report = (e, onError) => {
  const msg = (e && e.message) || 'Could not build the purchase order PDF';
  if (typeof onError === 'function') onError(msg);
  else if (typeof window !== 'undefined') window.alert(msg);
};

export async function openPoPdf(po, onError) {
  try {
    const pdf = await buildPoPdf(po && po.id);
    openInNewTab(pdf.absoluteUrl);
    return pdf;
  } catch (e) { report(e, onError); return null; }
}

export async function downloadPoPdf(po, onError) {
  try {
    const pdf = await buildPoPdf(po && po.id);
    downloadUrl(pdf.absoluteUrl, pdf.name);
    return pdf;
  } catch (e) { report(e, onError); return null; }
}

// ── The approved terms, and the wording they replaced ───────────────────────
// These match PO_DEFAULTS and popdf_upgrade_term() in
// server/api/lib/po_pdf.php. The PDF is what gets printed, but the form has to
// agree with it — otherwise somebody opens a purchase order raised last month,
// sees the superseded warranty on screen, and has no idea the printed copy
// says something else.
export const PO_TERMS = {
  warrantyTerms: 'BOS - 5 Yrs , Solar Inverter - 8 Yrs, Solar Modules - 30 Yrs',
  deliveryTerms: '2-3 Weeks from the receipt of LOI /PO.',
  installationTerms: 'Within 10 days from the date of material received.',
  paymentTerms: '10% Advance along with PO, 80% Before dispatch the Material, and balance 10% After Installation.',
  customerScope: 'Civil Works, Elevated Structure, UPVC Pipes, Additional Relay, Additional Cables and Grid Synchronization ,CEIG and Coordination with APSPDCL .',
  companyScope: 'System Supply and Installation as per BOM.',
};

const PO_LEGACY = {
  warrantyTerms: [
    'Solar Inverter \u2013 5 Yrs, Solar Modules- 5 Yrs +20 Yrs',
    'Solar Inverter \u2013 8 Yrs, Solar Modules- 5 Yrs +20 Yrs',
    'Solar Inverter - 5 Yrs, Solar Modules- 5 Yrs +20 Yrs',
  ],
  deliveryTerms: ['3-4 Weeks from the receipt of LOI /PO.'],
  paymentTerms: ['80% Advance along with PO, 20% Before dispatching the materials against PI.'],
  customerScope: ['Civil works, UPVC Pipes, Additional cable if required more than 20 metres and Grid Synchronization Charges and Coordination with APSPDCL.'],
};

// The stored term, brought up to date only when it is word for word what the
// form used to put there. A term somebody typed is left exactly as typed.
export function poTerm(po, key) {
  const stored = String((po && po[key]) || '').trim();
  if (!stored) return PO_TERMS[key] || '';
  return (PO_LEGACY[key] || []).includes(stored) ? PO_TERMS[key] : stored;
}
