import React, { useState, useEffect } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { addDocument, updateDocument } from '../services/firestore';
import { hasAccess } from '../services/helpers';
import { DateInput, EmptyState } from '../components/SharedUI';

const to12 = (h) => { const p = h >= 12 ? 'PM' : 'AM'; let hr = h % 12; if (hr === 0) hr = 12; return `${hr}:00 ${p}`; };
// Hourly slots 6 AM → 8 PM, then one night block 8 PM → 6 AM (req #11).
const DAY_SLOTS = [];
for (let h = 6; h <= 19; h++) DAY_SLOTS.push({ key: 'h' + h, label: `${to12(h)} – ${to12(h + 1)}` });
const NIGHT_SLOT = { key: 'night', label: '8:00 PM – 6:00 AM (Night)' };
const ALL_SLOTS = [...DAY_SLOTS, NIGHT_SLOT];

const today = () => new Date().toISOString().slice(0, 10);
// Sales Executive + Sales Manager (and higher authority) may view any member's plan.
const canViewOthers = (role) => role === 'executive' || role === 'sales_manager' || hasAccess(role, 'manager');

export default function Tracking() {
  const { tracking, users } = useData();
  const { user, role } = useAuth();
  const { toast } = useToast();

  const myEmail = user?.email || '';
  const myName = user?.displayName || '';
  const viewOthers = canViewOthers(role);

  const [date, setDate] = useState(today());
  const [empEmail, setEmpEmail] = useState(myEmail);
  const [slots, setSlots] = useState({});
  const [saving, setSaving] = useState(false);

  const isSelf = empEmail === myEmail;
  const doc = tracking.find(t => t.employeeEmail === empEmail && t.date === date);

  // Load the selected employee/date plan into the editor when the selection
  // changes, or when the matching doc first arrives from the server (doc?.id
  // flips from undefined → id). Keying on doc?.id (not the whole doc) means later
  // polls with the same id don't clobber what the user is currently typing.
  useEffect(() => {
    const d = tracking.find(t => t.employeeEmail === empEmail && t.date === date);
    setSlots(d?.slots || {});
  }, [date, empEmail, doc?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const setSlot = (key, val) => setSlots(p => ({ ...p, [key]: val }));

  const save = async () => {
    if (!isSelf) return;
    setSaving(true);
    try {
      const clean = {};
      Object.entries(slots).forEach(([k, v]) => { if (v && v.trim()) clean[k] = v.trim(); });
      if (doc) await updateDocument('tracking', doc.id, { slots: clean });
      else await addDocument('tracking', { employeeName: myName || myEmail, employeeEmail: myEmail, date, slots: clean });
      toast('Tracking saved');
    } catch (e) { toast(e.message, 'er'); }
    finally { setSaving(false); }
  };

  const employees = viewOthers ? (users || []) : [];
  const filledCount = ALL_SLOTS.filter(s => (slots[s.key] || '').trim()).length;

  return (
    <>
      <div className="tl">
        <h3>Daily Work Tracking</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {viewOthers && (
            <select className="fi" style={{ width: 'auto', minWidth: 180 }} value={empEmail} onChange={e => setEmpEmail(e.target.value)}>
              <option value={myEmail}>My tracking</option>
              {employees.filter(u => u.email !== myEmail).map(u => <option key={u.id} value={u.email}>{u.displayName || u.email}</option>)}
            </select>
          )}
          <DateInput value={date} onChange={e => setDate(e.target.value)} />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}><div className="cb" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span className="material-icons-round" style={{ fontSize: 22, color: 'var(--pri)' }}>schedule</span>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontWeight: 700 }}>{isSelf ? 'My plan' : (doc?.employeeName || employees.find(u => u.email === empEmail)?.displayName || empEmail)}</div>
          <div style={{ fontSize: '.82rem', color: 'var(--muted)' }}>{filledCount} of {ALL_SLOTS.length} slots filled{isSelf ? '' : ' · read-only'}</div>
        </div>
        {isSelf && <button className="btn bp bsm" onClick={save} disabled={saving}><span className="material-icons-round" style={{ fontSize: 18 }}>save</span> {saving ? 'Saving…' : 'Save'}</button>}
      </div></div>

      <div className="card"><div className="cb">
        {!isSelf && !doc ? (
          <EmptyState icon="event_busy" title="No tracking for this day" message="This member has not entered any tasks for the selected date." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {ALL_SLOTS.map(s => (
              <div key={s.key} style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: 12, alignItems: 'center' }}>
                <div style={{ fontSize: '.82rem', fontWeight: 600, color: s.key === 'night' ? '#6c5ce7' : 'var(--txt)' }}>
                  <span className="material-icons-round" style={{ fontSize: 15, verticalAlign: 'middle', marginRight: 4, color: 'var(--muted)' }}>{s.key === 'night' ? 'nightlight' : 'wb_sunny'}</span>{s.label}
                </div>
                {isSelf
                  ? <input className="fi" value={slots[s.key] || ''} onChange={e => setSlot(s.key, e.target.value)} placeholder="Task / work for this slot…" />
                  : <div style={{ fontSize: '.88rem', color: (slots[s.key] || '').trim() ? 'var(--txt)' : 'var(--light)', padding: '9px 0' }}>{(slots[s.key] || '').trim() || '—'}</div>}
              </div>
            ))}
          </div>
        )}
      </div></div>

      <div style={{ marginTop: 12, fontSize: '.76rem', color: 'var(--muted)', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="material-icons-round" style={{ fontSize: 15 }}>info</span>
        Enter or edit your work per hourly slot (6 AM–8 PM) plus the night block. Sales Executives and Sales Managers can view any member's tracking.
      </div>
    </>
  );
}
