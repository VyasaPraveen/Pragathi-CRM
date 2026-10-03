// ============================================================================
// Leads → Installations: the customer's details, carried across once.
//
// A customer whose details are already on their lead should not have to be
// typed in again when their installation is opened. The flow is one way: a
// lead is read here, never written. Changing the installation afterwards
// changes nothing on the lead.
// ============================================================================

const digits = (v) => String(v || '').replace(/\D/g, '');
const norm = (v) => String(v || '').trim().toLowerCase();

// A lead matching a phone number (the last ten digits, so +91 and a bare
// number match each other), or null.
export function findLeadByPhone(leads, phone) {
  const p = digits(phone);
  if (p.length < 10) return null;
  const tail = p.slice(-10);
  return (leads || []).find(l => digits(l.phone).slice(-10) === tail) || null;
}

// A lead matching a customer name exactly (case and spacing aside), or null.
// Only an exact match is accepted here: a half-typed name must not pull in
// somebody else's details.
export function findLeadByName(leads, name) {
  const n = norm(name).replace(/\s+/g, ' ');
  if (!n) return null;
  return (leads || []).find(l => norm(l.name).replace(/\s+/g, ' ') === n) || null;
}

// "Name — phone" labels for a picker, and the lead each one stands for.
export function leadPickerOptions(leads) {
  const seen = new Map();
  (leads || []).forEach(l => {
    if (!l || !String(l.name || '').trim()) return;
    const label = String(l.name).trim() + (l.phone ? ' — ' + String(l.phone).trim() : '');
    if (!seen.has(label)) seen.set(label, l);
  });
  return seen;
}

const ROOF_TYPES = ['RCC', 'Sheet', 'Tile'];

// The installation fields a lead can fill in. Only what the lead actually
// holds is returned, so nothing already typed on the form is blanked.
export function installationFromLead(lead) {
  if (!lead) return {};
  const out = {};
  const put = (k, v) => { if (v !== undefined && v !== null && String(v).trim() !== '') out[k] = v; };
  put('customerName', lead.name);
  put('phone', lead.phone);
  put('address', [lead.address, lead.city, lead.district].filter(v => v && String(v).trim()).join(', '));
  if (ROOF_TYPES.includes(lead.roofType)) out.roofType = lead.roofType;
  if (Number(lead.floors) > 0) out.floors = Number(lead.floors);
  put('teamLeader', lead.teamLeader);
  put('referenceLeadName', lead.referredByName);
  if (String(lead.siteVisit || '').toLowerCase() === 'yes') out.siteVisitStatus = 'Visited';
  // The link back, so the installation always knows which lead it came from.
  put('leadId', lead.id);
  return out;
}

// The form after a lead has been applied to it: the lead's details go in, and
// anything the lead does not hold is left exactly as it was.
export function applyLeadToForm(form, lead) {
  return { ...form, ...installationFromLead(lead) };
}
