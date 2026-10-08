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

// ── R3 (8-Oct): the installation is opened from the Customer, not the lead ──
//
// A lead becomes a customer when it converts, and the customer record is what
// the office works from after that. So the installation picker lists the
// customers, each with the name and phone they carried over from their lead,
// and the lead itself is only read for the site details the customer record
// does not hold (roof, floors, team leader, site visit).

// The lead a customer came from, if it is still on file.
export function leadOfCustomer(customer, leads) {
  if (!customer) return null;
  const list = leads || [];
  if (customer.leadId) {
    const byId = list.find(l => l.id === customer.leadId);
    if (byId) return byId;
  }
  // Older customers were made without the link: fall back to the phone.
  return findLeadByPhone(list, customer.phone) || null;
}

// A customer matching a phone number (last ten digits), or null.
export function findCustomerByPhone(customers, phone) {
  const p = digits(phone);
  if (p.length < 10) return null;
  const tail = p.slice(-10);
  return (customers || []).find(c => digits(c.phone).slice(-10) === tail) || null;
}

// A customer matching a name exactly (case and spacing aside), or null.
export function findCustomerByName(customers, name) {
  const n = norm(name).replace(/\s+/g, ' ');
  if (!n) return null;
  return (customers || []).find(c => norm(c.name).replace(/\s+/g, ' ') === n) || null;
}

// "Name — phone" labels for the picker, and the customer each stands for.
// The lead's name and phone are searchable too: the label carries whichever
// of the two differ from the customer's, so a customer renamed after
// conversion is still found under the name the lead was known by.
export function customerPickerOptions(customers, leads) {
  const seen = new Map();
  (customers || []).forEach(c => {
    if (!c || !String(c.name || '').trim()) return;
    const lead = leadOfCustomer(c, leads);
    let label = String(c.name).trim() + (c.phone ? ' — ' + String(c.phone).trim() : '');
    if (lead) {
      const extra = [];
      if (lead.name && norm(lead.name) !== norm(c.name)) extra.push(String(lead.name).trim());
      if (lead.phone && digits(lead.phone).slice(-10) !== digits(c.phone).slice(-10)) extra.push(String(lead.phone).trim());
      if (extra.length) label += ' (lead: ' + extra.join(', ') + ')';
    }
    if (!seen.has(label)) seen.set(label, c);
  });
  return seen;
}

// The installation fields a customer (and the lead behind it) can fill in.
// The customer's own details win; the lead supplies only what the customer
// record does not hold.
export function installationFromCustomer(customer, leads) {
  if (!customer) return {};
  const lead = leadOfCustomer(customer, leads);
  const out = lead ? installationFromLead(lead) : {};
  const put = (k, v) => { if (v !== undefined && v !== null && String(v).trim() !== '') out[k] = v; };
  put('customerName', customer.name);
  put('phone', customer.phone);
  put('address', [customer.address, customer.city, customer.district].filter(v => v && String(v).trim()).join(', '));
  put('customerId', customer.id);
  if (customer.leadId) put('leadId', customer.leadId);
  return out;
}

export function applyCustomerToForm(form, customer, leads) {
  return { ...form, ...installationFromCustomer(customer, leads) };
}
