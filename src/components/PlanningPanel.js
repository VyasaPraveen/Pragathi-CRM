import React, { useState, useEffect, useMemo } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { addDocument, updateDocument } from '../services/firestore';
import { todayStr, formatDate, formatDateTime, hasAccess } from '../services/helpers';
import { DateInput } from './SharedUI';
import {
  SLOT_STATUS, STATUS_LABEL, ALL_SLOTS, allSlotRows, planSummary, writeSlots,
  validateSlot, postponeSlot, carryForward, firstFreeSlot, slotLabel, readSlot,
  submissionState, canEditPlan, submissionIssue,
} from '../services/planning';

// An unsaved draft survives a refresh or the app closing (Req 7.5).
const draftKey = (email, date) => `pps:plan-draft:${String(email || '').toLowerCase()}:${date}`;
const readDraft = (email, date) => { try { const v = localStorage.getItem(draftKey(email, date)); return v ? JSON.parse(v) : null; } catch { return null; } };
const writeDraft = (email, date, slots) => { try { localStorage.setItem(draftKey(email, date), JSON.stringify(slots)); } catch { /* private mode */ } };
const clearDraft = (email, date) => { try { localStorage.removeItem(draftKey(email, date)); } catch { /* ignore */ } };

const TONE = {
  [SLOT_STATUS.PLANNED]: { fg: 'var(--muted)', bg: 'transparent', icon: 'radio_button_unchecked' },
  [SLOT_STATUS.COMPLETED]: { fg: '#1e8449', bg: 'rgba(39,174,96,.10)', icon: 'task_alt' },
  [SLOT_STATUS.NOT_DONE]: { fg: '#c0392b', bg: 'rgba(231,76,60,.08)', icon: 'cancel' },
  [SLOT_STATUS.POSTPONED]: { fg: '#d68910', bg: 'rgba(243,156,18,.10)', icon: 'event_repeat' },
  [SLOT_STATUS.PRE_COMPLETED]: { fg: '#0e7490', bg: 'rgba(14,116,144,.10)', icon: 'verified' },
};

/* A single time slot: what was planned, and what became of it. */
function SlotRow({ row, editable, onChange, onPostpone }) {
  const tone = TONE[row.status] || TONE[SLOT_STATUS.PLANNED];
  const night = row.key === 'night';
  const whole = row.key === 'day';

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '150px 1fr', gap: 12, alignItems: 'start',
      background: tone.bg, borderRadius: 8, padding: '6px 8px',
    }}>
      <div style={{ fontSize: '.82rem', fontWeight: 600, color: night ? '#6c5ce7' : whole ? 'var(--pri)' : 'var(--txt)', paddingTop: 9 }}>
        <span className="material-icons-round" style={{ fontSize: 15, verticalAlign: 'middle', marginRight: 4, color: 'var(--muted)' }}>{night ? 'nightlight' : whole ? 'today' : 'wb_sunny'}</span>
        {row.label}
      </div>
      <div>
        {editable
          ? (whole
              ? <textarea className="fi" rows={4} value={row.text} placeholder="The day's work in full — what was done, where, with whom…"
                  onChange={e => onChange({ ...row, text: e.target.value })} />
              : <input className="fi" value={row.text} placeholder="Task / work for this slot…"
                  onChange={e => onChange({ ...row, text: e.target.value })} />)
          : <div style={{ fontSize: '.88rem', color: row.text ? 'var(--txt)' : 'var(--light)', padding: '9px 0', whiteSpace: 'pre-wrap' }}>{row.text || '—'}</div>}

        {/* Nothing to report on until something is planned. */}
        {row.text && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
            {editable ? (
              <>
                <button type="button" className="btn bsm bo"
                  title="Mark this work completed"
                  onClick={() => onChange({ ...row, status: row.status === SLOT_STATUS.COMPLETED ? SLOT_STATUS.PLANNED : SLOT_STATUS.COMPLETED, reason: '' })}
                  style={{ padding: '3px 9px', fontSize: '.74rem', color: row.status === SLOT_STATUS.COMPLETED ? '#1e8449' : undefined, borderColor: row.status === SLOT_STATUS.COMPLETED ? 'rgba(39,174,96,.4)' : undefined }}>
                  <span className="material-icons-round" style={{ fontSize: 14 }}>check_circle</span> Completed
                </button>
                <button type="button" className="btn bsm bo"
                  title="Done before its time"
                  onClick={() => onChange({ ...row, status: row.status === SLOT_STATUS.PRE_COMPLETED ? SLOT_STATUS.PLANNED : SLOT_STATUS.PRE_COMPLETED, reason: '' })}
                  style={{ padding: '3px 9px', fontSize: '.74rem', color: row.status === SLOT_STATUS.PRE_COMPLETED ? '#0e7490' : undefined, borderColor: row.status === SLOT_STATUS.PRE_COMPLETED ? 'rgba(14,116,144,.4)' : undefined }}>
                  <span className="material-icons-round" style={{ fontSize: 14 }}>verified</span> Pre-completed
                </button>
                <button type="button" className="btn bsm bo"
                  title="Could not be done — add the reason"
                  onClick={() => onChange({ ...row, status: row.status === SLOT_STATUS.NOT_DONE ? SLOT_STATUS.PLANNED : SLOT_STATUS.NOT_DONE })}
                  style={{ padding: '3px 9px', fontSize: '.74rem', color: row.status === SLOT_STATUS.NOT_DONE ? '#c0392b' : undefined, borderColor: row.status === SLOT_STATUS.NOT_DONE ? 'rgba(231,76,60,.35)' : undefined }}>
                  <span className="material-icons-round" style={{ fontSize: 14 }}>cancel</span> Not completed
                </button>
                <button type="button" className="btn bsm bo"
                  title="Move this work to another day"
                  onClick={() => onPostpone(row)}
                  style={{ padding: '3px 9px', fontSize: '.74rem', color: row.status === SLOT_STATUS.POSTPONED ? '#d68910' : undefined, borderColor: row.status === SLOT_STATUS.POSTPONED ? 'rgba(243,156,18,.4)' : undefined }}>
                  <span className="material-icons-round" style={{ fontSize: 14 }}>event_repeat</span> Postpone
                </button>
              </>
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.76rem', fontWeight: 600, color: tone.fg }}>
                <span className="material-icons-round" style={{ fontSize: 15 }}>{tone.icon}</span>
                {STATUS_LABEL[row.status]}
              </span>
            )}
          </div>
        )}

        {/* Why it did not happen. Required before the day can be saved. */}
        {row.text && row.status === SLOT_STATUS.NOT_DONE && (
          editable
            ? <input className="fi" value={row.reason} placeholder="Reason it was not completed…"
                onChange={e => onChange({ ...row, reason: e.target.value })}
                style={{ marginTop: 6, fontSize: '.82rem' }} />
            : row.reason ? <div style={{ marginTop: 4, fontSize: '.78rem', color: '#c0392b' }}>Reason: {row.reason}</div> : null
        )}

        {row.text && row.status === SLOT_STATUS.POSTPONED && row.postponedDate && (
          <div style={{ marginTop: 4, fontSize: '.78rem', color: '#d68910' }}>
            Moved to {formatDate(row.postponedDate)}{row.postponedSlot ? ' · ' + slotLabel(row.postponedSlot) : ''}
            {row.reason ? ' · ' + row.reason : ''}
          </div>
        )}
      </div>
    </div>
  );
}

/* Ask where the work is going. */
function PostponeModal({ row, minDate, onCancel, onConfirm }) {
  const [date, setDate] = useState(row.postponedDate || '');
  const [slot, setSlot] = useState(row.postponedSlot || '');
  const [reason, setReason] = useState(row.reason || '');
  return (
    <div className="mo" onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="md" style={{ width: 460, maxWidth: '94vw' }}>
        <div className="mh"><h3>Postpone this work</h3><button className="mx" onClick={onCancel}><span className="material-icons-round">close</span></button></div>
        <div className="mb">
          <p style={{ margin: '0 0 12px', fontSize: '.84rem', color: 'var(--muted)' }}>
            <strong style={{ color: 'var(--txt)' }}>{row.text}</strong><br />{row.label}
          </p>
          <div className="fg"><label>Move to date *</label>
            <DateInput value={date} min={minDate} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="fg"><label>Time slot</label>
            <select className="fi" value={slot} onChange={e => setSlot(e.target.value)}>
              <option value="">First free slot that day</option>
              {ALL_SLOTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          <div className="fg"><label>Reason (optional)</label>
            <input className="fi" value={reason} onChange={e => setReason(e.target.value)} placeholder="Why is it moving?" />
          </div>
        </div>
        <div className="mf">
          <button className="btn bo" onClick={onCancel}>Cancel</button>
          <button className="btn bp" disabled={!date} onClick={() => onConfirm(date, slot, reason)}>Postpone</button>
        </div>
      </div>
    </div>
  );
}

/* The day's plan: enter the work, report on it, save it as a draft, then
   report it. Used by the Planning screen and by My Reports & Planning, so the
   two can never drift apart. */
export default function PlanEditor({ date, employeeEmail, employeeName, compact }) {
  const { tracking } = useData();
  const { user, role } = useAuth();
  const { toast } = useToast();

  const myEmail = user?.email || '';
  const isSelf = String(employeeEmail || '').toLowerCase() === String(myEmail).toLowerCase();

  const doc = tracking.find(t => t.employeeEmail === employeeEmail && t.date === date);
  const state = submissionState(doc);
  // Its author edits it until it is reported; a manager may unlock it after.
  const editable = canEditPlan(doc, isSelf);
  const mayUnlock = !!doc && !!doc.submitted && hasAccess(role, 'manager');
  const [slots, setSlots] = useState({});
  const [saving, setSaving] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [postponing, setPostponing] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [restored, setRestored] = useState(false);

  // Load the selected day into the editor. Keyed on the document id rather than
  // the document itself, so a background refresh never overwrites what is being
  // typed right now. An unsaved draft left on this device comes back first.
  useEffect(() => {
    const d = tracking.find(t => t.employeeEmail === employeeEmail && t.date === date);
    const draft = isSelf && !(d && d.submitted) ? readDraft(employeeEmail, date) : null;
    if (draft && JSON.stringify(draft) !== JSON.stringify(d?.slots || {})) {
      setSlots(draft); setDirty(true); setRestored(true);
    } else {
      setSlots(d?.slots || {}); setDirty(false); setRestored(false);
    }
    setSaveFailed(false);
  }, [date, employeeEmail, doc?.id, doc?.submitted]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => allSlotRows(slots), [slots]);
  const summary = useMemo(() => planSummary(slots), [slots]);

  const change = (row) => {
    setSlots(p => {
      const next = { ...p, [row.key]: { text: row.text, status: row.status, reason: row.reason, postponedDate: row.postponedDate, postponedSlot: row.postponedSlot } };
      writeDraft(employeeEmail, date, next);
      return next;
    });
    setDirty(true);
  };

  // Save: the draft, exactly as typed. Returns the saved document id, or null
  // when nothing was saved — and says so, so the person never thinks it was.
  const save = async (override, quiet = false) => {
    if (!editable) return null;
    const next = override || slots;
    // A slot that says it was not done, or moved, has to say why or where.
    for (const row of allSlotRows(next)) {
      if (!row.text) continue;
      const problem = validateSlot(row);
      if (problem) { toast(`${row.label}: ${problem}`, 'er'); return null; }
    }
    setSaving(true);
    try {
      const clean = writeSlots(next);
      let id = doc?.id || null;
      if (doc) await updateDocument('tracking', doc.id, { slots: clean });
      else id = await addDocument('tracking', { employeeName: employeeName || myEmail, employeeEmail: myEmail, date, slots: clean });
      setDirty(false); setSaveFailed(false); setRestored(false);
      clearDraft(employeeEmail, date);
      if (!quiet) toast('Saved as a draft — press Report when the day is done');
      return id;
    } catch (e) {
      setSaveFailed(true);
      toast('NOT saved: ' + e.message + ' — your entries are still on this screen; try again.', 'er');
      return null;
    } finally { setSaving(false); }
  };

  // Report: the final submission. The latest entries are saved first, then
  // the day is marked submitted and locked.
  const report = async () => {
    if (!editable) return;
    const issue = submissionIssue(slots);
    if (issue) { toast(issue, 'er'); return; }
    if (!window.confirm(`Submit the report for ${formatDate(date)}? It is then locked; a manager can unlock it if a correction is needed.`)) return;
    setReporting(true);
    try {
      const id = await save(undefined, true);
      if (!id) return;
      await updateDocument('tracking', id, { submitted: true });
      toast(`Report for ${formatDate(date)} submitted`);
    } catch (e) { toast('Not submitted: ' + e.message, 'er'); }
    finally { setReporting(false); }
  };

  // A manager unlocks a submitted report for a correction. The original stays
  // in the document's history.
  const unlock = async () => {
    const note = window.prompt('Why is this report being unlocked? (kept with the report)', '');
    if (note === null) return;
    try {
      await updateDocument('tracking', doc.id, { submitted: false, unlockNote: note });
      toast('Unlocked — the author can correct it and report it again');
    } catch (e) { toast(e.message, 'er'); }
  };

  // Postponing writes the day it moved to as well, so the work actually turns
  // up there instead of only being marked as gone from here.
  const confirmPostpone = async (toDate, toSlotKey, reason) => {
    const row = postponing;
    setPostponing(null);
    const updated = postponeSlot(row, toDate, toSlotKey, reason);
    const next = { ...slots, [row.key]: updated };
    setSlots(next);
    setDirty(true);

    try {
      const targetDoc = tracking.find(t => t.employeeEmail === employeeEmail && t.date === toDate);
      const targetSlots = targetDoc?.slots || {};
      const key = toSlotKey || firstFreeSlot(targetSlots);
      if (!key) {
        toast('That day has no free slot — the work is marked postponed but not placed', 'wa');
      } else {
        const landed = carryForward(targetSlots, key, readSlot(row).text, date);
        if (!landed) {
          toast(`${slotLabel(key)} on that day is already taken — marked postponed but not placed`, 'wa');
        } else if (targetDoc) {
          await updateDocument('tracking', targetDoc.id, { slots: { ...writeSlots(targetSlots), [key]: landed } });
        } else {
          await addDocument('tracking', { employeeName: employeeName || myEmail, employeeEmail: myEmail, date: toDate, slots: { [key]: landed } });
        }
      }
    } catch (e) { toast(e.message, 'er'); }
    await save(next);
  };

  const Chip = ({ label, value, color }) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.76rem', fontWeight: 600, color, background: 'var(--bg2, rgba(0,0,0,.03))', borderRadius: 12, padding: '3px 10px' }}>
      {label} <strong>{value}</strong>
    </span>
  );

  return (
    <>
      {/* Where the report stands: draft, submitted (locked), or unlocked for a correction. */}
      <div className="plan-state" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10, fontSize: '.8rem' }}>
        {state.submitted ? (
          <span className="st st-g" style={{ padding: '3px 10px' }}><span className="material-icons-round" style={{ fontSize: 14 }}>lock</span> Submitted {state.at ? formatDateTime(state.at) : ''}{state.by ? ' · ' + state.by : ''}</span>
        ) : (
          <span className={`st ${state.label === 'Draft' ? 'st-o' : 'st-x'}`} style={{ padding: '3px 10px' }}>{state.label}{state.unlocked ? ' · unlocked for correction' : ''}</span>
        )}
        {dirty && editable && <span style={{ color: saveFailed ? '#c0392b' : '#d68910', fontWeight: 600 }}>{saveFailed ? 'Not saved — try again' : restored ? 'Unsaved changes restored from this device' : 'Unsaved changes'}</span>}
        {!dirty && !state.submitted && doc && editable && <span style={{ color: 'var(--muted)' }}>All changes saved</span>}
        {state.submitted && isSelf && <span style={{ color: 'var(--muted)' }}>Locked — ask a manager to unlock it for a correction.</span>}
        <span style={{ flex: 1 }} />
        {mayUnlock && <button className="btn bsm bo" onClick={unlock} title="Unlock this report for a correction; the submitted version is kept"><span className="material-icons-round" style={{ fontSize: 16 }}>lock_open</span> Unlock</button>}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <Chip label="Planned" value={summary.planned} color="var(--muted)" />
        <Chip label="Completed" value={summary.completed} color="#1e8449" />
        <Chip label="Pre-completed" value={summary.preCompleted} color="#0e7490" />
        <Chip label="Not completed" value={summary.notDone} color="#c0392b" />
        <Chip label="Postponed" value={summary.postponed} color="#d68910" />
        {summary.planned > 0 && <Chip label="Done" value={summary.completionRate + '%'} color="var(--pri)" />}
        <span style={{ flex: 1 }} />
        {editable && (
          <>
            <button className="btn bo bsm" onClick={() => save()} disabled={saving || reporting || !dirty} title="Keep what is entered as a draft">
              <span className="material-icons-round" style={{ fontSize: 18 }}>save</span> {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
            </button>
            <button className="btn bp bsm" onClick={report} disabled={saving || reporting} title="Submit the day's report — it is then locked">
              <span className="material-icons-round" style={{ fontSize: 18 }}>send</span> {reporting ? 'Reporting…' : 'Report'}
            </button>
          </>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: compact ? 420 : undefined, overflowY: compact ? 'auto' : undefined }}>
        {rows.map(row => (
          <SlotRow key={row.key} row={row} editable={editable}
            onChange={change} onPostpone={setPostponing} />
        ))}
      </div>

      {!editable && summary.planned === 0 && (
        <p style={{ fontSize: '.84rem', color: 'var(--muted)', marginTop: 10 }}>
          Nothing planned for this day.
        </p>
      )}

      {postponing && (
        <PostponeModal row={postponing} minDate={todayStr()}
          onCancel={() => setPostponing(null)} onConfirm={confirmPostpone} />
      )}
    </>
  );
}
