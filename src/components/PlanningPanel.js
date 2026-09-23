import React, { useState, useEffect, useMemo } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { addDocument, updateDocument } from '../services/firestore';
import { todayStr, formatDate } from '../services/helpers';
import { DateInput } from './SharedUI';
import {
  SLOT_STATUS, STATUS_LABEL, ALL_SLOTS, allSlotRows, planSummary, writeSlots,
  validateSlot, postponeSlot, carryForward, firstFreeSlot, slotLabel, readSlot,
} from '../services/planning';

const TONE = {
  [SLOT_STATUS.PLANNED]: { fg: 'var(--muted)', bg: 'transparent', icon: 'radio_button_unchecked' },
  [SLOT_STATUS.COMPLETED]: { fg: '#1e8449', bg: 'rgba(39,174,96,.10)', icon: 'task_alt' },
  [SLOT_STATUS.NOT_DONE]: { fg: '#c0392b', bg: 'rgba(231,76,60,.08)', icon: 'cancel' },
  [SLOT_STATUS.POSTPONED]: { fg: '#d68910', bg: 'rgba(243,156,18,.10)', icon: 'event_repeat' },
};

/* A single time slot: what was planned, and what became of it. */
function SlotRow({ row, editable, onChange, onPostpone }) {
  const tone = TONE[row.status] || TONE[SLOT_STATUS.PLANNED];
  const night = row.key === 'night';

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '150px 1fr', gap: 12, alignItems: 'start',
      background: tone.bg, borderRadius: 8, padding: '6px 8px',
    }}>
      <div style={{ fontSize: '.82rem', fontWeight: 600, color: night ? '#6c5ce7' : 'var(--txt)', paddingTop: 9 }}>
        <span className="material-icons-round" style={{ fontSize: 15, verticalAlign: 'middle', marginRight: 4, color: 'var(--muted)' }}>{night ? 'nightlight' : 'wb_sunny'}</span>
        {row.label}
      </div>
      <div>
        {editable
          ? <input className="fi" value={row.text} placeholder="Task / work for this slot…"
              onChange={e => onChange({ ...row, text: e.target.value })} />
          : <div style={{ fontSize: '.88rem', color: row.text ? 'var(--txt)' : 'var(--light)', padding: '9px 0' }}>{row.text || '—'}</div>}

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

/* The day's plan: enter the work, report on it, save it.
   Used by the Planning screen and by My Reports & Planning, so the two can
   never drift apart. */
export default function PlanEditor({ date, employeeEmail, employeeName, compact }) {
  const { tracking } = useData();
  const { user } = useAuth();
  const { toast } = useToast();

  const myEmail = user?.email || '';
  const isSelf = String(employeeEmail || '').toLowerCase() === String(myEmail).toLowerCase();

  const doc = tracking.find(t => t.employeeEmail === employeeEmail && t.date === date);
  const [slots, setSlots] = useState({});
  const [saving, setSaving] = useState(false);
  const [postponing, setPostponing] = useState(null);
  const [dirty, setDirty] = useState(false);

  // Load the selected day into the editor. Keyed on the document id rather than
  // the document itself, so a background refresh never overwrites what is being
  // typed right now.
  useEffect(() => {
    const d = tracking.find(t => t.employeeEmail === employeeEmail && t.date === date);
    setSlots(d?.slots || {});
    setDirty(false);
  }, [date, employeeEmail, doc?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => allSlotRows(slots), [slots]);
  const summary = useMemo(() => planSummary(slots), [slots]);

  const change = (row) => {
    setSlots(p => ({ ...p, [row.key]: { text: row.text, status: row.status, reason: row.reason, postponedDate: row.postponedDate, postponedSlot: row.postponedSlot } }));
    setDirty(true);
  };

  const save = async (override) => {
    if (!isSelf) return;
    const next = override || slots;
    // A slot that says it was not done, or moved, has to say why or where.
    for (const row of allSlotRows(next)) {
      if (!row.text) continue;
      const problem = validateSlot(row);
      if (problem) { toast(`${row.label}: ${problem}`, 'er'); return; }
    }
    setSaving(true);
    try {
      const clean = writeSlots(next);
      if (doc) await updateDocument('tracking', doc.id, { slots: clean });
      else await addDocument('tracking', { employeeName: employeeName || myEmail, employeeEmail: myEmail, date, slots: clean });
      setDirty(false);
      toast('Plan saved');
    } catch (e) { toast(e.message, 'er'); }
    finally { setSaving(false); }
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <Chip label="Planned" value={summary.planned} color="var(--muted)" />
        <Chip label="Completed" value={summary.completed} color="#1e8449" />
        <Chip label="Not completed" value={summary.notDone} color="#c0392b" />
        <Chip label="Postponed" value={summary.postponed} color="#d68910" />
        {summary.planned > 0 && <Chip label="Done" value={summary.completionRate + '%'} color="var(--pri)" />}
        <span style={{ flex: 1 }} />
        {isSelf && (
          <button className="btn bp bsm" onClick={() => save()} disabled={saving || !dirty}>
            <span className="material-icons-round" style={{ fontSize: 18 }}>save</span> {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: compact ? 420 : undefined, overflowY: compact ? 'auto' : undefined }}>
        {rows.map(row => (
          <SlotRow key={row.key} row={row} editable={isSelf}
            onChange={change} onPostpone={setPostponing} />
        ))}
      </div>

      {!isSelf && summary.planned === 0 && (
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
