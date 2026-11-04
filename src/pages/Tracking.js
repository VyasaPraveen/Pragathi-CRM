import React, { useState } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { todayStr } from '../services/helpers';
import { DateInput } from '../components/SharedUI';
import PlanEditor from '../components/PlanningPanel';
import { planningScope } from '../services/planning';

// Planning — the day's work laid out against its time slots, and what became
// of each one. Previously called "Tracking"; the route and the permission key
// keep their old names so nobody's saved access changes.
//
// 4-Nov (Req 5, 8): this is where the plan is entered and SENT. Once sent it
// is read-only here; My Reports & Planning keeps an Edit button for the day's
// reporting. Who can be looked at follows the team structure: the Owner,
// Management, Admin and the Operation Manager see everyone, a Team Leader
// their own members, everyone else only themselves.
const today = () => todayStr();

export default function Tracking() {
  const { tracking, users } = useData();
  const { user, role } = useAuth();

  const myEmail = user?.email || '';
  const myName = user?.displayName || '';
  const scope = planningScope(users, user, role);
  const others = scope.people.filter(u => String(u.email || '').toLowerCase() !== myEmail.toLowerCase());
  const viewOthers = others.length > 0;

  const [date, setDate] = useState(today());
  const [empEmail, setEmpEmail] = useState(myEmail);

  // Somebody outside the person's scope can never be picked.
  const allowed = empEmail === myEmail || others.some(u => u.email === empEmail);
  const shownEmail = allowed ? empEmail : myEmail;
  const isSelf = shownEmail === myEmail;
  const doc = tracking.find(t => t.employeeEmail === shownEmail && t.date === date);

  return (
    <>
      <div className="tl">
        <h3>Planning</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {viewOthers && (
            <select className="fi" style={{ width: 'auto', minWidth: 180 }} value={shownEmail} onChange={e => setEmpEmail(e.target.value)} data-plan="who">
              <option value={myEmail}>My planning</option>
              {others.map(u => <option key={u.id || u.email} value={u.email}>{u.displayName || u.email}</option>)}
            </select>
          )}
          <DateInput value={date} onChange={e => setDate(e.target.value)} />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}><div className="cb" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span className="material-icons-round" style={{ fontSize: 22, color: 'var(--pri)' }}>event_note</span>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontWeight: 700 }}>{isSelf ? 'My plan' : (doc?.employeeName || others.find(u => u.email === shownEmail)?.displayName || shownEmail)}</div>
          <div style={{ fontSize: '.82rem', color: 'var(--muted)' }}>
            Pick the date, enter the day's planned work slot by slot, Save it, then press Send Plan. A sent plan is read-only here; update and report the day from My Reports &amp; Planning.
            {isSelf ? '' : ' · read-only'}
          </div>
        </div>
      </div></div>

      <div className="card"><div className="cb">
        <PlanEditor date={date} employeeEmail={shownEmail} employeeName={isSelf ? (myName || myEmail) : (doc?.employeeName || '')} lockAfterSend />
      </div></div>

      <div style={{ marginTop: 12, fontSize: '.76rem', color: 'var(--muted)', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="material-icons-round" style={{ fontSize: 15 }}>info</span>
        Hourly slots run 6 AM–8 PM, plus a whole-day block (6 AM–6 PM) and a night block. Save keeps a draft; Send Plan submits the plan (reminder at 5:30 PM, due by 6:30 PM); Report submits the day's report and locks it (a manager can unlock it for a correction).
        {scope.all ? ' You can view every employee’s planning.' : viewOthers ? ' You can view your own planning and your team members’.' : ' You can view your own planning.'}
      </div>
    </>
  );
}
