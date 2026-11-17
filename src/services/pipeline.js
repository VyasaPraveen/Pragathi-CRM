// ============================================================================
// My Pipeline Value (My Reports & Planning), Req 7 (4-Nov).
//
// The figure is the expected value of the person's open leads. Before launch
// it is set to ₹0 for everyone: only leads recorded on or after the reset date
// count, so each person builds the figure up again from launch. The Owner may
// reset it again from Settings; the reset date lives in the company settings.
// Nothing else in the CRM reads this date.
// ============================================================================

import { toNumber } from './helpers';

// The launch reset, applied even before the Owner has pressed anything.
export const PIPELINE_RESET_DEFAULT = '2026-11-04';

export const pipelineResetDate = (settings) => {
  const v = settings && settings.pipelineResetAt;
  return /^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10) : PIPELINE_RESET_DEFAULT;
};

// The day a lead was recorded, as YYYY-MM-DD.
const leadDay = (l) => String(l.createdAt || l.dateGenerated || '').slice(0, 10);

// The person's leads that count towards the figure: recorded on or after the
// reset date, and not converted (a converted lead is a customer, not pipeline).
export function pipelineLeads(myLeads, settings) {
  const from = pipelineResetDate(settings);
  return (myLeads || []).filter(l => l && leadDay(l) >= from && l.status !== 'Converted' && l.status !== 'Lost');
}

export const pipelineValue = (myLeads, settings) => pipelineLeads(myLeads, settings).reduce((s, l) => s + toNumber(l.expectedValue), 0);
