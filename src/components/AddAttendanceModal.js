import React, { useState, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { addDocument, updateDocument, createNotification } from '../services/firestore';
import { formatDate, todayStr } from '../services/helpers';
import { Modal, DateInput } from './SharedUI';
import { MANUAL, MANUAL_STATUSES, manualRecordFor } from '../services/attendance';
import { userStatus } from '../services/teams';

// ============================================================================
// Add Attendance (Req 6, 30-Oct): an authorised person records a day for an
// employee — today, or a day that was missed. The record belongs to the date
// chosen, not to the day it was typed, so the counts land on the right day;
// one record per employee per date, so a second entry updates the first.
// ============================================================================

export default function AddAttendanceModal({ users, attendance, initial, presetEmail, onClose, onSaved }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const editing = !!(initial && initial.id);
  const [f, setF] = useState({
    employeeEmail: initial?.employeeEmail || presetEmail || '',
    date: initial?.date || todayStr(),
    status: initial?.status || 'Present',
    hours: initial?.hours != null ? String(initial.hours) : '',
    note: initial?.note || '',
  });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const [saving, setSaving] = useState(false);
  const people = useMemo(() => (users || []).filter(u => u.approved !== false && userStatus(u) !== 'deactivated')
    .sort((a, b) => String(a.displayName || a.email).localeCompare(String(b.displayName || b.email))), [users]);
  const who = people.find(u => String(u.email || '').toLowerCase() === String(f.employeeEmail).toLowerCase());
  // The record already on that date for that person, if any.
  const clash = useMemo(() => (editing ? null : manualRecordFor(attendance, f.employeeEmail, f.date)), [attendance, f.employeeEmail, f.date, editing]);

  const submit = async (e) => {
    e.preventDefault();
    if (!who) { toast('Choose the employee', 'er'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) { toast('Choose the attendance date', 'er'); return; }
    if (f.date > todayStr()) { toast('Attendance cannot be recorded for a day that has not come yet', 'er'); return; }
    const hours = f.hours === '' ? null : Number(f.hours);
    if (hours != null && (isNaN(hours) || hours < 0 || hours > 24)) { toast('Worked hours must be between 0 and 24', 'er'); return; }
    if (f.status === 'Absent' && hours) { toast('An absent day has no worked hours', 'er'); return; }
    if (f.date < todayStr() && !f.note.trim() && !editing) { toast('Add the reason the attendance is being recorded late', 'er'); return; }
    const by = user?.displayName || user?.email || '';
    const rec = {
      type: MANUAL,
      employeeEmail: String(who.email).toLowerCase(), employeeName: who.displayName || who.email,
      date: f.date, status: f.status, hours, note: f.note.trim(),
    };
    setSaving(true);
    try {
      const target = editing ? initial : clash;
      if (target) {
        if (!editing && !window.confirm(`${who.displayName || who.email} already has a record on ${formatDate(f.date)} (${target.status}). Update it to ${f.status}?`)) { setSaving(false); return; }
        await updateDocument('attendance', target.id, { status: rec.status, hours: rec.hours, note: rec.note });
        toast(`Attendance updated — ${formatDate(f.date)}`);
      } else {
        await addDocument('attendance', { ...rec, addedBy: by, addedByEmail: user?.email || '', addedAt: new Date().toISOString() });
        toast(`Attendance recorded for ${formatDate(f.date)}`);
      }
      createNotification({
        forUser: rec.employeeName, title: `Attendance ${target ? 'updated' : 'recorded'} — ${formatDate(f.date)}`,
        message: `${by} recorded you ${f.status} on ${formatDate(f.date)}${hours != null ? ` (${hours} h)` : ''}${f.note.trim() ? ` — ${f.note.trim()}` : ''}.`,
        type: 'status_update', module: 'attendance',
      });
      onSaved && onSaved();
      onClose();
    } catch (err) { toast(err.message, 'er'); }
    finally { setSaving(false); }
  };

  return (
    <Modal title={editing ? `Edit attendance — ${initial.employeeName}` : 'Add Attendance'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="mb">
          <p style={{ fontSize: '.8rem', color: 'var(--muted)', marginTop: 0 }}>
            The record counts against the date you choose — a day missed because of a phone or app problem can be added later and lands on the right day. One record per person per day; a second entry updates the first.
          </p>
          <div className="fg"><label>Employee *</label>
            <select className="fi" value={f.employeeEmail} onChange={e => set('employeeEmail', e.target.value)} disabled={editing} required>
              <option value="">— choose —</option>
              {people.map(u => <option key={u.id} value={String(u.email).toLowerCase()}>{u.displayName || u.email}{u.designation ? ' · ' + u.designation : ''}</option>)}
            </select>
          </div>
          <div className="fr">
            <div className="fg"><label>Attendance date *</label><DateInput value={f.date} max={todayStr()} onChange={e => set('date', e.target.value)} required /></div>
            <div className="fg"><label>Status *</label>
              <select className="fi" value={f.status} onChange={e => set('status', e.target.value)}>
                {MANUAL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="fr">
            <div className="fg"><label>Worked hours {f.status === 'Absent' ? '' : '(optional)'}</label><input type="number" step="0.5" min="0" max="24" className="fi" value={f.hours} onChange={e => set('hours', e.target.value)} disabled={f.status === 'Absent'} placeholder="e.g. 8" /></div>
            <div className="fg"><label>Reason / note {f.date < todayStr() && !editing ? '*' : ''}</label><input className="fi" value={f.note} onChange={e => set('note', e.target.value)} placeholder="e.g. phone not working on the day" /></div>
          </div>
          {clash && <div className="aerr" style={{ fontSize: '.8rem' }}>{who?.displayName || 'This person'} already has a record on {formatDate(f.date)}: <strong>{clash.status}</strong>{clash.note ? ` — ${clash.note}` : ''}. Saving updates it.</div>}
        </div>
        <div className="mf"><button type="button" className="btn bo" onClick={onClose}>Cancel</button><button type="submit" className="btn bp" disabled={saving}>{saving ? 'Saving…' : editing ? 'Update' : 'Save attendance'}</button></div>
      </form>
    </Modal>
  );
}
