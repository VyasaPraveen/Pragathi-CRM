// ============================================================================
// Writing the automatic workflow stages onto the customer (31-Oct).
//
// The rules live in customerWorkflow.js; this file finds the customer a record
// belongs to, works out what changed, and saves it. Every function here is
// safe to call after any save of the source record: when nothing is due,
// nothing is written.
// ============================================================================

import { updateDocument, createNotification, logActivity } from './firestore';
import { ownerUsers } from './permissions';
import { stageByKey } from './workflow';
import {
  applyAutomation, customerAutoStages, customerOfLead, customerOfPo, customerOfInstallation, posOfCustomer,
} from './customerWorkflow';

// Apply every due automation to one customer. Returns true when it wrote.
export async function syncCustomerStages(customer, sources) {
  if (!customer || !customer.id) return false;
  const patch = applyAutomation(customer, customerAutoStages(customer, sources));
  if (!patch) return false;
  await updateDocument('customers', customer.id, patch);
  return true;
}

// After a BCO Operations save on a lead (Stage 2 → Registration, Stage 5 →
// DISCOM Followup). `bco` is the record as just saved.
export function syncBcoToCustomer({ customers, leads, leadPOs, installations, lead, bco, by }) {
  const customer = customerOfLead(customers, lead);
  if (!customer) return Promise.resolve(false);
  return syncCustomerStages(customer, { lead, bco, pos: posOfCustomer(customer, leads, leadPOs), installation: installationOf(installations, customer), by });
}

// After a lead is saved (its Advance Received → Collect the Advance).
export function syncLeadToCustomer({ customers, leads, leadPOs, installations, bcoOps, lead, by }) {
  const customer = customerOfLead(customers, lead);
  if (!customer) return Promise.resolve(false);
  const bco = (bcoOps || []).find(o => o.leadId === lead.id) || null;
  return syncCustomerStages(customer, { lead, bco, pos: posOfCustomer(customer, leads, leadPOs), installation: installationOf(installations, customer), by });
}

// After the Operation Manager's Confirm Dispatch on a purchase order.
export function syncDispatchToCustomer({ customers, leads, leadPOs, po, by }) {
  const customer = customerOfPo(customers, leads, po);
  if (!customer) return Promise.resolve(false);
  const lead = (leads || []).find(l => l.id === customer.leadId) || null;
  const pos = posOfCustomer(customer, leads, leadPOs).map(p => (p.id === po.id ? { ...p, ...po } : p));
  if (!pos.some(p => p.id === po.id)) pos.push(po);
  return syncCustomerStages(customer, { lead, pos, by });
}

// After an installation is saved (New Installation → Team Allotment).
export function syncInstallationToCustomer({ customers, leads, leadPOs, inst, by }) {
  const customer = customerOfInstallation(customers, inst);
  if (!customer) return Promise.resolve(false);
  const lead = (leads || []).find(l => l.id === customer.leadId) || null;
  return syncCustomerStages(customer, { lead, pos: posOfCustomer(customer, leads, leadPOs), installation: inst, by });
}

// The installation on a customer, if one is on file.
export function installationOf(installations, customer) {
  if (!customer) return null;
  return (installations || []).find(i => customerOfInstallation([customer], i)) || null;
}

// The workflow patch a customer save should carry, worked out from the
// Payment tab as it is being saved (Stages 7 and 13) and the records already
// linked to the customer. Returns {} when nothing is due.
export function customerSavePatch(merged, { leads, leadPOs, installations, bcoOps, by }) {
  if (!merged) return {};
  const lead = (leads || []).find(l => l.id === merged.leadId) || null;
  const bco = lead ? (bcoOps || []).find(o => o.leadId === lead.id) || null : null;
  const patch = applyAutomation(merged, customerAutoStages(merged, {
    lead, bco, pos: posOfCustomer(merged, leads, leadPOs), installation: installationOf(installations, merged), by,
  }));
  return patch || {};
}

// A photo or document taken off a stage: the Activity Log line and the
// Owner's notification (Req 1.151 C–D). `photos` is the list removed.
export async function recordPhotoDeletion({ users, customer, stageKey, fieldKey, photos, by }) {
  const stage = stageByKey(stageKey);
  const field = stage && (stage.fields || []).find(f => f.key === fieldKey);
  const stageText = stage ? `Stage ${stage.sno} – ${stage.title}` : stageKey;
  const names = (photos || []).map(p => p.name || (p.url || '').split('/').pop() || 'photo').join(', ');
  const when = new Date().toISOString();
  const what = `${(photos || []).length} ${(photos || []).length === 1 ? 'file' : 'files'} (${names})`;
  await logActivity('Deleted Document', 'customers',
    `${customer.name || customer.id}: ${what} removed from "${field ? field.label : fieldKey}" — ${stageText}`);
  const message = `${by} deleted ${what} from "${field ? field.label : fieldKey}" on customer ${customer.name || customer.id}, ${stageText}, at ${new Date(when).toLocaleString('en-IN')}.`;
  for (const owner of ownerUsers(users)) {
    await createNotification({
      forUser: owner.displayName || owner.email, title: 'Customer document deleted', message,
      type: 'customer', module: 'customers', relatedId: customer.id,
    });
  }
}
