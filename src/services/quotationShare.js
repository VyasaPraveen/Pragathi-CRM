// ============================================================================
// Getting the quotation to the customer.
//
// The printed quotation has always been HTML that the browser turns into a PDF
// when somebody presses Print. That is fine to read, but there is no file at
// the end of it, so a quotation could only be sent by saving it by hand and
// attaching it by hand. The server now builds the same proposal as a real PDF
// (server/api/lib/quotation_pdf.php) and keeps it at a fixed address; this is
// the client's side of that.
//
// Three ways out, in the order they are worth trying:
//   1. Share the file itself — on a phone, navigator.share() hands the actual
//      PDF to WhatsApp as a document. This is the one the requirement asks for.
//   2. WhatsApp the lead's number with the message and a direct link to the
//      PDF. Works everywhere, and needs nobody to look up the number.
//   3. Open or download the file.
//
// What is NOT possible from a browser: sending a document to a chosen number
// with no further interaction. wa.me links can only carry text, and attaching a
// document to a specific number without the sender confirming needs the
// WhatsApp Business Cloud API (a Meta account, a registered sender number and
// an approved template). Until that is in place, (1) and (2) are the whole of
// what any web app can do.
// ============================================================================

import { apiGet } from './api';
import { toNumber } from './helpers';
import { quotationRef, quotationWhatsAppText } from './quotation';

// Ask the server to build the PDF and tell us where it put it.
// → { url, absoluteUrl, name, bytes, quotationRef }
export async function buildQuotationPdf(quotationId) {
  if (!quotationId) throw new Error('Save the quotation before generating its PDF.');
  const res = await apiGet('/quotation-pdf?id=' + encodeURIComponent(quotationId));
  if (!res || !res.url) throw new Error('The server did not return a quotation PDF.');
  return { ...res, absoluteUrl: absolute(res.url) };
}

function absolute(url) {
  if (/^https?:\/\//i.test(url)) return url;
  if (typeof window === 'undefined' || !window.location) return url;
  return window.location.origin + (url.startsWith('/') ? url : '/' + url);
}

// A tab of its own, with no way back into this one — see openHtmlSafely() in
// helpers.js for why the print dialog must never belong to the CRM's tab.
export function openInNewTab(url) {
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function downloadUrl(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || '';
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// 91XXXXXXXXXX, or '' if there is nothing usable to dial.
export function waNumber(phone) {
  const cleaned = String(phone || '').replace(/\D/g, '');
  if (cleaned.length < 10) return '';
  return cleaned.length === 10 ? '91' + cleaned : cleaned;
}

// The message that goes with the PDF. The link is what makes the quotation
// reachable when the file itself cannot be attached.
export function quotationShareText(q, pdfUrl) {
  const body = quotationWhatsAppText(q);
  return pdfUrl ? `${body}\n\nQuotation PDF: ${pdfUrl}` : body;
}

// Can this device hand a file straight to WhatsApp? Android and iOS can;
// desktop browsers generally cannot.
export function canShareFiles() {
  return typeof navigator !== 'undefined'
    && typeof navigator.share === 'function'
    && typeof navigator.canShare === 'function'
    && typeof File !== 'undefined';
}

// Route 1 — hand WhatsApp the actual PDF document.
// Returns true if the share sheet was opened, false if this device can't.
export async function shareQuotationFile(q, pdf) {
  if (!canShareFiles()) return false;
  let file;
  try {
    const res = await fetch(pdf.absoluteUrl || pdf.url, { credentials: 'omit' });
    if (!res.ok) return false;
    const blob = await res.blob();
    file = new File([blob], pdf.name || `${quotationRef(q)}.pdf`, { type: 'application/pdf' });
  } catch { return false; }
  if (!navigator.canShare({ files: [file] })) return false;
  try {
    await navigator.share({
      files: [file],
      title: `Quotation ${quotationRef(q)}`,
      text: quotationShareText(q, ''),
    });
    return true;
  } catch (e) {
    // The sheet opening and then being dismissed is not a failure worth
    // falling back from — only a device that refused outright is.
    if (e && e.name === 'AbortError') return true;
    return false;
  }
}

// Route 2 — WhatsApp the number on the lead, with the message and the link.
export function shareQuotationLink(q, phone, pdfUrl) {
  const num = waNumber(phone || q.customerPhone);
  const text = encodeURIComponent(quotationShareText(q, pdfUrl));
  openInNewTab(num ? `https://wa.me/${num}?text=${text}` : `https://wa.me/?text=${text}`);
  return !!num;
}

// What the "Send on WhatsApp" button does: build the PDF, try to attach it,
// and fall back to the lead's number with the link.
// → { via: 'file' | 'link', url, toNumber }
export async function sendQuotationOnWhatsApp(q, phone) {
  const pdf = await buildQuotationPdf(q.id);
  const sent = await shareQuotationFile(q, pdf);
  if (sent) return { via: 'file', url: pdf.absoluteUrl, toNumber: waNumber(phone || q.customerPhone) };
  const hadNumber = shareQuotationLink(q, phone, pdf.absoluteUrl);
  return { via: 'link', url: pdf.absoluteUrl, toNumber: hadNumber ? waNumber(phone || q.customerPhone) : '' };
}

// A quotation with no price on it is not something to send a customer.
export function quotationReadyToShare(q) {
  if (!q || !q.id) return 'Save the quotation first.';
  if (toNumber(q.systemCost) <= 0) return 'Set the system cost before sharing this quotation.';
  if (!waNumber(q.customerPhone)) return 'This lead has no usable mobile number — add one on the lead first.';
  return '';
}
