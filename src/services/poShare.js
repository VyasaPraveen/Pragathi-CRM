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
