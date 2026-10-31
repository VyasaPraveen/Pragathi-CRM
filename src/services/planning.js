// ============================================================================
// Planning — the day's work, slot by slot, and what became of it.
//
// A plan is one document per person per day: { employeeEmail, date, slots }.
// Each slot used to hold a bare string of what was planned. It now holds what
// was planned AND what happened to it — done, not done and why, or moved to
// another day — because a plan nobody reports back on is just a list.
//
// Old plans are plain strings and must keep working, so every read goes
// through readSlot(), which accepts either shape. Nothing has to be migrated.
// ============================================================================

export const SLOT_STATUS = {
  PLANNED: 'planned',
  COMPLETED: 'completed',
  NOT_DONE: 'not_done',
  POSTPONED: 'postponed',
  // Req 7.1 (30-Oct): done ahead of its slot.
  PRE_COMPLETED: 'pre_completed',
};

export const STATUS_LABEL = {
  [SLOT_STATUS.PLANNED]: 'Planned',
  [SLOT_STATUS.COMPLETED]: 'Completed',
  [SLOT_STATUS.NOT_DONE]: 'Not completed',
  [SLOT_STATUS.POSTPONED]: 'Postponed',
  [SLOT_STATUS.PRE_COMPLETED]: 'Pre-Completed',
};
// The two states that count as done.
export const DONE_STATUSES = [SLOT_STATUS.COMPLETED, SLOT_STATUS.PRE_COMPLETED];

const to12 = (h) => { const p = h >= 12 ? 'PM' : 'AM'; let hr = h % 12; if (hr === 0) hr = 12; return `${hr}:00 ${p}`; };

// Hourly slots 6 AM → 8 PM, then one night block 8 PM → 6 AM — and, first
// (Req 7.4, 30-Oct), one whole-day block 6 AM → 6 PM with room for a fuller
// account of the day.
export const DAY_SLOTS = [];
for (let h = 6; h <= 19; h++) DAY_SLOTS.push({ key: 'h' + h, label: `${to12(h)} – ${to12(h + 1)}` });
export const NIGHT_SLOT = { key: 'night', label: '8:00 PM – 6:00 AM (Night)' };
export const WHOLE_DAY_SLOT = { key: 'day', label: '6:00 AM – 6:00 PM (Whole day)', whole: true };
export const ALL_SLOTS = [WHOLE_DAY_SLOT, ...DAY_SLOTS, NIGHT_SLOT];

export const slotLabel = (key) => (ALL_SLOTS.find(s => s.key === key) || {}).label || key;

const str = (v) => (v == null ? '' : String(v));

// Read a slot in whichever shape it was stored. A plan saved before any of
// this existed is a bare string, and reads back as planned work with nothing
// reported against it yet.
export function readSlot(value) {
  if (value == null) return { text: '', status: SLOT_STATUS.PLANNED, reason: '', postponedDate: '', postponedSlot: '', updatedAt: '' };
  if (typeof value === 'string') {
    return { text: value.trim(), status: SLOT_STATUS.PLANNED, reason: '', postponedDate: '', postponedSlot: '', updatedAt: '' };
  }
  const status = Object.values(SLOT_STATUS).includes(value.status) ? value.status : SLOT_STATUS.PLANNED;
  return {
    text: str(value.text).trim(),
    status,
    reason: str(value.reason).trim(),
    postponedDate: str(value.postponedDate).trim(),
    postponedSlot: str(value.postponedSlot).trim(),
    updatedAt: str(value.updatedAt),
  };
}

// What to store. A slot with no work planned is dropped entirely rather than
// saved as an empty shell, which keeps a cleared slot genuinely cleared.
export function writeSlot(slot) {
  const s = readSlot(slot);
  if (!s.text) return null;
  const out = { text: s.text, status: s.status };
  if (s.status === SLOT_STATUS.NOT_DONE && s.reason) out.reason = s.reason;
  if (s.status === SLOT_STATUS.POSTPONED) {
    if (s.reason) out.reason = s.reason;
    if (s.postponedDate) out.postponedDate = s.postponedDate;
    if (s.postponedSlot) out.postponedSlot = s.postponedSlot;
  }
  if (s.updatedAt) out.updatedAt = s.updatedAt;
  return out;
}

// The whole slot map, ready to save: empty slots removed, everything else
// normalised. This is what goes to the server.
export function writeSlots(slots) {
  const out = {};
  Object.entries(slots || {}).forEach(([k, v]) => {
    const w = writeSlot(v);
    if (w) out[k] = w;
  });
  return out;
}

// The day as rows, in clock order, one per slot that has work in it.
export function planRows(slots) {
  return ALL_SLOTS
    .map(s => ({ key: s.key, label: s.label, ...readSlot((slots || {})[s.key]) }))
    .filter(r => !!r.text);
}

// Every slot in clock order, including the empty ones — what the editor shows.
export function allSlotRows(slots) {
  return ALL_SLOTS.map(s => ({ key: s.key, label: s.label, ...readSlot((slots || {})[s.key]) }));
}

// How the day went.
export function planSummary(slots) {
  const rows = planRows(slots);
  const by = (st) => rows.filter(r => r.status === st).length;
  const done = by(SLOT_STATUS.COMPLETED);
  const pre = by(SLOT_STATUS.PRE_COMPLETED);
  return {
    planned: rows.length,
    completed: done,
    preCompleted: pre,
    notDone: by(SLOT_STATUS.NOT_DONE),
    postponed: by(SLOT_STATUS.POSTPONED),
    pending: by(SLOT_STATUS.PLANNED),
    // Out of the slots that were actually reported on, how many got done.
    completionRate: rows.length ? Math.round(((done + pre) / rows.length) * 100) : 0,
  };
}

// A slot that says it was not completed has to say why, and one that was moved
// has to say where to. Returns the complaint, or '' when the slot is fine.
export function validateSlot(slot) {
  const s = readSlot(slot);
  if (!s.text) return 'Enter the work for this slot first.';
  if (s.status === SLOT_STATUS.NOT_DONE && !s.reason) return 'Add a short reason why this was not completed.';
  if (s.status === SLOT_STATUS.POSTPONED && !s.postponedDate) return 'Choose the date this work moves to.';
  return '';
}

// Moving a slot's work to another day. The original keeps the record of what
// was planned and where it went — it is not erased, because the day's report
// has to still show that it was planned and not done that day.
export function postponeSlot(slot, toDate, toSlotKey, reason = '') {
  const s = readSlot(slot);
  return {
    ...s,
    status: SLOT_STATUS.POSTPONED,
    reason: reason || s.reason,
    postponedDate: toDate,
    postponedSlot: toSlotKey || s.postponedSlot || '',
  };
}

// The work as it should land on the target day: planned again, with a note of
// where it came from. An occupied target slot is never overwritten.
export function carryForward(targetSlots, slotKey, text, fromDate) {
  const existing = readSlot((targetSlots || {})[slotKey]);
  if (existing.text) return null;             // that slot is already spoken for
  return {
    ...writeSlot({ text, status: SLOT_STATUS.PLANNED }),
    text: text + (fromDate ? ` (moved from ${fromDate})` : ''),
  };
}

// The first slot on the target day with nothing in it, so a postponed task has
// somewhere sensible to go when no particular time was chosen.
export function firstFreeSlot(targetSlots) {
  const free = ALL_SLOTS.find(s => !readSlot((targetSlots || {})[s.key]).text);
  return free ? free.key : '';
}

// ── Submission (Req 7.6 / 7.7, 30-Oct) ──────────────────────────────────────
// Save keeps a draft; Report submits it. A submitted report is read-only for
// its author until a manager unlocks it for a correction, and every
// submission is kept on the document (submissions[]) with the slots as they
// were, so a correction never silently overwrites what was reported.

export function submissionState(doc) {
  if (!doc) return { submitted: false, label: 'Not started', at: '', by: '' };
  if (doc.submitted) return { submitted: true, label: 'Submitted', at: doc.submittedAt || '', by: doc.submittedByName || doc.submittedBy || '' };
  return { submitted: false, label: planRows(doc.slots).length ? 'Draft' : 'Not started', at: doc.updatedAt || '', by: '', unlocked: !!doc.unlockedAt };
}

// May this person edit the plan? Its author, while it is not submitted.
export const canEditPlan = (doc, isSelf) => !!isSelf && !(doc && doc.submitted);

// What a submission needs: at least one slot of work, each slot in order.
export function submissionIssue(slots) {
  const rows = planRows(slots);
  if (!rows.length) return 'Enter the day\'s work in at least one slot before reporting it.';
  for (const r of rows) { const p = validateSlot(r); if (p) return `${r.label}: ${p}`; }
  return '';
}

// A submitted report as flat rows, one per slot, for the CSV.
export function reportRows(doc) {
  return planRows(doc && doc.slots).map(r => ({
    employee: (doc && doc.employeeName) || '',
    email: (doc && doc.employeeEmail) || '',
    date: (doc && doc.date) || '',
    submittedAt: (doc && doc.submittedAt) || '',
    slot: r.label,
    status: STATUS_LABEL[r.status] || r.status,
    text: r.text,
    reason: r.reason,
    postponedTo: r.postponedDate ? r.postponedDate + (r.postponedSlot ? ' ' + slotLabel(r.postponedSlot) : '') : '',
  }));
}

// Only reports actually submitted, for the work date (or month) asked for —
// never a draft, never a plan for a day still to come.
export function submittedReports(docs, { date = '', month = '' } = {}) {
  return (docs || [])
    .filter(d => d && d.submitted === true)
    .filter(d => (date ? d.date === date : true) && (month ? String(d.date || '').startsWith(month) : true))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.employeeName || '').localeCompare(String(b.employeeName || '')));
}

// Everyone's standing for one work date: submitted (when), draft, or nothing.
export function reportRoll(docs, people, date) {
  return (people || []).map(p => {
    const email = String(p.email || '').toLowerCase();
    const doc = (docs || []).find(d => d && d.date === date && String(d.employeeEmail || '').toLowerCase() === email) || null;
    const st = submissionState(doc);
    return { email, name: p.displayName || p.email, designation: p.designation || '', doc, ...st, slots: planRows(doc && doc.slots).length };
  }).sort((a, b) => (a.submitted === b.submitted ? a.name.localeCompare(b.name) : a.submitted ? 1 : -1));
}

export const REPORT_REMINDER = {
  hour: 17,   // 5 PM, local (IST) — every day but Sunday
  message: 'Your daily report is due. You have 1 hour remaining to submit your report.',
};
