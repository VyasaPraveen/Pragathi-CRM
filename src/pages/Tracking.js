import React, { useState } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { hasAccess, todayStr } from '../services/helpers';
import { DateInput } from '../components/SharedUI';
import PlanEditor from '../components/PlanningPanel';

// Planning — the day's work laid out against its time slots, and what became
// of each one. Previously called "Tracking"; the route and the permission key
// keep their old names so nobody's saved access changes.
const today = () => todayStr();

// Sales Executive + Sales Manager (and higher authority) may view any member's plan.
const canViewOthers = (role) => role === 'executive' || role === 'sales_manager' || hasAccess(role, 'manager');

export default function Tracking() {
  const { tracking, users } = useData();
  const { user, role } = useAuth();

  const myEmail = user?.email || '';
  const myName = user?.displayName || '';
  const viewOthers = canViewOthers(role);

  const [date, setDate] = useState(today());
  const [empEmail, setEmpEmail] = useState(myEmail);

  const isSelf = empEmail === myEmail;
  const doc = tracking.find(t => t.employeeEmail === empEmail && t.date === date);
  const employees = viewOthers ? (users || []) : [];

  return (
    <>
      <div className="tl">
        <h3>Planning</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {viewOthers && (
            <select className="fi" style={{ width: 'auto', minWidth: 180 }} value={empEmail} onChange={e => setEmpEmail(e.target.value)}>
              <option value={myEmail}>My planning</option>
              {employees.filter(u => u.email !== myEmail).map(u => <option key={u.id} value={u.email}>{u.displayName || u.email}</option>)}
            </select>
          )}
          <DateInput value={date} onChange={e => setDate(e.target.value)} />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}><div className="cb" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span className="material-icons-round" style={{ fontSize: 22, color: 'var(--pri)' }}>event_note</span>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontWeight: 700 }}>{isSelf ? 'My plan' : (doc?.employeeName || employees.find(u => u.email === empEmail)?.displayName || empEmail)}</div>
          <div style={{ fontSize: '.82rem', color: 'var(--muted)' }}>
            Plan the work slot by slot, then mark each one completed, not completed with a reason, or postponed to another day.
            {isSelf ? '' : ' · read-only'}
          </div>
        </div>
      </div></div>

      <div className="card"><div className="cb">
        <PlanEditor date={date} employeeEmail={empEmail} employeeName={isSelf ? (myName || myEmail) : (doc?.employeeName || '')} />
      </div></div>

      <div style={{ marginTop: 12, fontSize: '.76rem', color: 'var(--muted)', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="material-icons-round" style={{ fontSize: 15 }}>info</span>
        Hourly slots run 6 AM–8 PM, plus a night block. Everything you plan here also shows in My Reports &amp; Planning, where you can update it. Sales Executives and Sales Managers can view any member's plan.
      </div>
    </>
  );
}
