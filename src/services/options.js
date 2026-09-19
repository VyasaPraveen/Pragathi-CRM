// ============================================================================
// Admin-editable option lists.
//
// The dropdowns across the CRM come from here rather than from hard-coded
// arrays, so an Admin can add, rename or remove a choice in Settings → Manage
// Options without a code change. A list the Admin has never touched falls back
// to the built-in defaults, so nothing changes until they say so.
//
// Two safety rules, both enforced here rather than trusted to the UI:
//   * some values carry behaviour elsewhere in the app (choosing "Elevated"
//     opens the pole-height fields, "Referral" opens the referrer fields).
//     Those are locked — they can be reordered but never removed.
//   * a value already saved on a record is always still offered, so editing an
//     old lead can never silently drop what it has.
// ============================================================================

export const OPTION_LISTS = [
  {
    key: 'leadReference',
    label: 'Lead Reference / Source',
    where: 'New Lead → Lead Reference',
    defaults: ['Website', 'Referral', 'Walk-in', 'Facebook Ad', 'Google Ad', 'Other'],
    locked: ['Referral', 'Other'],
    lockedNote: '"Referral" opens the referrer fields and "Other" opens the free-text box.',
  },
  {
    key: 'followUpStatus',
    label: 'Follow-up Status',
    where: 'New Lead & Follow-up log',
    defaults: ['New Lead', 'Interested', 'Follow-up', 'Negotiating', 'No Response', 'Completed'],
    locked: [],
  },
  {
    key: 'priority',
    label: 'Lead Priority',
    where: 'New Lead → Priority',
    defaults: ['Hot', 'Warm', 'Cold'],
    locked: [],
  },
  {
    key: 'modeOfPayment',
    label: 'Mode of Payment',
    where: 'New Lead → Mode of Payment',
    defaults: ['PhonePe', 'Google Pay', 'Paytm', 'Cash', 'Bank Transfer', 'Cheque', 'Card', 'Other'],
    locked: ['Other'],
    lockedNote: '"Other" opens the free-text box.',
  },
  {
    key: 'roofType',
    label: 'Roof Type',
    where: 'Site Visit details',
    defaults: ['RCC', 'Sheet', 'Tile', 'Elevated'],
    locked: ['Elevated'],
    lockedNote: '"Elevated" opens the north/south pole height fields.',
  },
  {
    key: 'structureType',
    label: 'Tilt',
    where: 'Site Visit details',
    defaults: ['Flat', 'Sloped'],
    locked: [],
  },
  {
    key: 'existingConnection',
    label: 'Existing Connection',
    where: 'Site Visit details',
    defaults: ['Single Phase', 'Three Phase', 'CT Meter', 'HT Meter'],
    locked: [],
  },
  {
    key: 'bomMaterials',
    label: 'BOM Materials',
    where: 'Purchase Order → Bill of Materials',
    defaults: [
      'Solar PV Module', 'Grid Tie Inverter', 'Junction Box / ACDB', 'Junction Box / DCDB',
      'Earthing Rods', 'LA', 'MC4 Connectors', 'Earth Chemical Bags', 'Earth Chambers',
      'DC Cable', 'AC Cable', 'Earthing Cable', 'MMS -2/4 (PPS Standard)',
      'If Any Elevated MMS (Height)', 'Additional AC Cable', 'Additional DC Cable',
      'Additional Earth Cable', 'UPVC Pipes & Fittings', 'Civil Works', 'Additional Relay',
      'DISCOM Charges', 'Ladder (Height)', 'MCS - Cleaning System', 'Additional Load',
      'Any Misc / Others',
    ],
    locked: [],
    note: 'Extra materials added here appear in the PO material picker alongside the standard list.',
  },
];

export const optionListByKey = (key) => OPTION_LISTS.find(l => l.key === key) || null;

const clean = (list) => (Array.isArray(list) ? list : [])
  .map(v => (typeof v === 'string' ? v.trim() : ''))
  .filter(Boolean)
  .filter((v, i, a) => a.findIndex(x => x.toLowerCase() === v.toLowerCase()) === i);

// The list as it should appear in a dropdown: what the Admin saved, with any
// locked value put back, or the built-in defaults when they have saved nothing.
export function getOptions(settings, key) {
  const meta = optionListByKey(key);
  if (!meta) return [];
  const saved = clean(settings?.optionLists?.[key]);
  if (!saved.length) return [...meta.defaults];
  const lower = saved.map(v => v.toLowerCase());
  const missingLocked = (meta.locked || []).filter(v => !lower.includes(v.toLowerCase()));
  return [...saved, ...missingLocked];
}

// Has the Admin customised this list?
export const isCustomised = (settings, key) => clean(settings?.optionLists?.[key]).length > 0;

// A dropdown must still offer whatever the record already holds, even if that
// choice has since been taken off the list.
export function withCurrent(list, current) {
  const v = typeof current === 'string' ? current.trim() : '';
  if (!v) return list;
  return list.some(x => x.toLowerCase() === v.toLowerCase()) ? list : [v, ...list];
}

// Can this value be removed from the list?
export function isLocked(key, value) {
  const meta = optionListByKey(key);
  if (!meta) return false;
  return (meta.locked || []).some(v => v.toLowerCase() === String(value || '').trim().toLowerCase());
}

// Validate a list the Admin is about to save. Returns { ok, list, error }.
export function validateOptionList(key, list) {
  const meta = optionListByKey(key);
  if (!meta) return { ok: false, error: 'Unknown option list' };
  const cleaned = clean(list);
  if (!cleaned.length) return { ok: false, error: 'Keep at least one option in the list' };
  const lower = cleaned.map(v => v.toLowerCase());
  const lost = (meta.locked || []).filter(v => !lower.includes(v.toLowerCase()));
  if (lost.length) return { ok: false, error: `${lost.join(', ')} cannot be removed — ${meta.lockedNote || 'other screens depend on it.'}` };
  return { ok: true, list: cleaned };
}
