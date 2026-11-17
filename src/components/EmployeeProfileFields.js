import React, { useState } from 'react';
import { DESIGNATIONS } from '../services/helpers';

// ============================================================================
// The four sections of an employee's profile — Basic Info, Bank Details,
// Personal, Work Info — exactly as Team → Select Member → Edit has them, as a
// field set that Total Users → Edit now shows as well (Req 16B, 4-Nov). The
// Team screen keeps its own copy untouched; this one reads and writes the same
// `team` record, found by the person's email.
// ============================================================================

export const PROFILE_ROLES = DESIGNATIONS.map(d => d.label);
export const PROFILE_STATUS_OPTIONS = ['Active', 'On Leave', 'Inactive'];

export const PROFILE_FIELDS = [
  'name', 'role', 'status', 'age', 'phone', 'salary', 'attendance', 'joiningDate', 'email', 'address',
  'emergencyContactName', 'emergencyContactPhone', 'emergencyContactRelation',
  'bankName', 'accountNumber', 'ifscCode', 'upiId', 'aadharNumber', 'panNumber',
  'qualification', 'experience', 'previousCompany', 'bloodGroup', 'notes',
];

// A profile form state from a team record (or nothing), with the account's
// name, email and phone filling what the record does not hold.
export function profileFrom(member, account) {
  const d = member || {};
  const a = account || {};
  return {
    name: d.name || a.displayName || '', role: d.role || a.designation || 'Admin Assistant', status: d.status || 'Active',
    age: d.age || '', phone: d.phone || a.phone || '', salary: d.salary || '', attendance: d.attendance || 0,
    joiningDate: d.joiningDate || '', email: d.email || a.email || '', address: d.address || a.address || '',
    emergencyContactName: d.emergencyContactName || '', emergencyContactPhone: d.emergencyContactPhone || '', emergencyContactRelation: d.emergencyContactRelation || '',
    bankName: d.bankName || '', accountNumber: d.accountNumber || '', ifscCode: d.ifscCode || '', upiId: d.upiId || '',
    aadharNumber: d.aadharNumber || '', panNumber: d.panNumber || '',
    qualification: d.qualification || '', experience: d.experience || '', previousCompany: d.previousCompany || '',
    bloodGroup: d.bloodGroup || '', notes: d.notes || '',
  };
}

// The team record a user account belongs to: by email, else by the exact name.
export function teamRecordOf(team, account) {
  if (!account) return null;
  const lc = (v) => String(v || '').trim().toLowerCase();
  const list = team || [];
  return list.find(t => lc(t.email) && lc(t.email) === lc(account.email))
    || list.find(t => lc(t.name) && lc(t.name) === lc(account.displayName))
    || null;
}

export const PROFILE_TABS = [
  { key: 'basic', label: 'Basic Info', icon: 'person' },
  { key: 'bank', label: 'Bank Details', icon: 'account_balance' },
  { key: 'personal', label: 'Personal', icon: 'badge' },
  { key: 'work', label: 'Work Info', icon: 'work' },
];

// The four tabs and their fields. `f` is the profile state, `set(key, value)`
// changes one field. `hideIdentity` leaves out the name / phone / email boxes
// when the host form already has them.
export default function EmployeeProfileFields({ f, set, hideIdentity }) {
  const [tab, setTab] = useState('basic');
  return (
    <div data-profile="fields">
      <div style={{ display: 'flex', gap: 4, marginBottom: 12, borderBottom: '1px solid var(--bor)', paddingBottom: 8, flexWrap: 'wrap' }}>
        {PROFILE_TABS.map(t => (
          <button type="button" key={t.key} onClick={() => setTab(t.key)} data-profile-tab={t.key}
            style={{ padding: '6px 12px', fontSize: '.78rem', fontWeight: tab === t.key ? 600 : 400, color: tab === t.key ? 'var(--pri)' : 'var(--muted)', background: tab === t.key ? 'rgba(99,102,241,.08)' : 'transparent', border: 'none', borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className="material-icons-round" style={{ fontSize: 15 }}>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {tab === 'basic' && <>
        {!hideIdentity && (
          <>
            <div className="fr">
              <div className="fg"><label>Full Name *</label><input className="fi" value={f.name} onChange={e => set('name', e.target.value)} required /></div>
              <div className="fg"><label>Phone</label><input className="fi" value={f.phone} onChange={e => set('phone', e.target.value)} /></div>
            </div>
            <div className="fr">
              <div className="fg"><label>Email</label><input type="email" className="fi" value={f.email} onChange={e => set('email', e.target.value)} placeholder="employee@example.com" /></div>
              <div className="fg"><label>Joining Date</label><input type="date" className="fi" value={f.joiningDate} onChange={e => set('joiningDate', e.target.value)} /></div>
            </div>
          </>
        )}
        {hideIdentity && (
          <div className="fr">
            <div className="fg"><label>Joining Date</label><input type="date" className="fi" value={f.joiningDate} onChange={e => set('joiningDate', e.target.value)} /></div>
            <div className="fg"><label>Status (Team section)</label><select className="fi" value={f.status} onChange={e => set('status', e.target.value)}>{PROFILE_STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}</select></div>
          </div>
        )}
        <div className="fr3">
          {!hideIdentity && <div className="fg"><label>Role / Designation</label><select className="fi" value={f.role} onChange={e => set('role', e.target.value)}>{PROFILE_ROLES.map(r => <option key={r}>{r}</option>)}</select></div>}
          <div className="fg"><label>Age</label><input type="number" className="fi" value={f.age} onChange={e => set('age', e.target.value)} /></div>
          {!hideIdentity && <div className="fg"><label>Status</label><select className="fi" value={f.status} onChange={e => set('status', e.target.value)}>{PROFILE_STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}</select></div>}
          <div className="fg"><label>Blood Group</label><select className="fi" value={f.bloodGroup} onChange={e => set('bloodGroup', e.target.value)}>
            <option value="">-- Select --</option>
            {['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'].map(bg => <option key={bg}>{bg}</option>)}
          </select></div>
        </div>
        <div className="fr">
          <div className="fg"><label>Salary (Monthly)</label><input type="number" className="fi" value={f.salary} onChange={e => set('salary', e.target.value)} /></div>
          <div className="fg"><label>Attendance (days this month)</label><input type="number" className="fi" value={f.attendance} onChange={e => set('attendance', e.target.value)} min="0" max="31" /></div>
        </div>
      </>}

      {tab === 'bank' && (
        <div style={{ background: 'rgba(99,102,241,.04)', borderRadius: 8, padding: 14, marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span className="material-icons-round" style={{ fontSize: 20, color: 'var(--pri)' }}>account_balance</span>
            <span style={{ fontWeight: 600, fontSize: '.9rem' }}>Bank Account Details</span>
          </div>
          <div className="fr">
            <div className="fg"><label>Bank Name</label><input className="fi" value={f.bankName} onChange={e => set('bankName', e.target.value)} placeholder="e.g. State Bank of India" /></div>
            <div className="fg"><label>Account Number</label><input className="fi" value={f.accountNumber} onChange={e => set('accountNumber', e.target.value)} placeholder="Account number" /></div>
          </div>
          <div className="fr">
            <div className="fg"><label>IFSC Code</label><input className="fi" value={f.ifscCode} onChange={e => set('ifscCode', e.target.value)} placeholder="e.g. SBIN0001234" style={{ textTransform: 'uppercase' }} /></div>
            <div className="fg"><label>UPI ID</label><input className="fi" value={f.upiId} onChange={e => set('upiId', e.target.value)} placeholder="e.g. name@upi" /></div>
          </div>
        </div>
      )}

      {tab === 'personal' && <>
        <div className="fg"><label>Full Address</label><textarea className="fi" value={f.address} onChange={e => set('address', e.target.value)} rows={2} placeholder="House no, street, city, state, pincode" /></div>
        <div className="fr">
          <div className="fg"><label>Aadhar Number</label><input className="fi" value={f.aadharNumber} onChange={e => set('aadharNumber', e.target.value)} placeholder="XXXX XXXX XXXX" maxLength={14} /></div>
          <div className="fg"><label>PAN Number</label><input className="fi" value={f.panNumber} onChange={e => set('panNumber', e.target.value)} placeholder="ABCDE1234F" maxLength={10} style={{ textTransform: 'uppercase' }} /></div>
        </div>
        <div style={{ background: 'rgba(231,76,60,.04)', borderRadius: 8, padding: 14, marginTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span className="material-icons-round" style={{ fontSize: 20, color: 'var(--err)' }}>emergency</span>
            <span style={{ fontWeight: 600, fontSize: '.9rem' }}>Emergency Contact</span>
          </div>
          <div className="fr3">
            <div className="fg"><label>Contact Name</label><input className="fi" value={f.emergencyContactName} onChange={e => set('emergencyContactName', e.target.value)} /></div>
            <div className="fg"><label>Contact Phone</label><input className="fi" value={f.emergencyContactPhone} onChange={e => set('emergencyContactPhone', e.target.value)} /></div>
            <div className="fg"><label>Relation</label><input className="fi" value={f.emergencyContactRelation} onChange={e => set('emergencyContactRelation', e.target.value)} placeholder="e.g. Father, Spouse" /></div>
          </div>
        </div>
      </>}

      {tab === 'work' && <>
        <div className="fr">
          <div className="fg"><label>Qualification</label><input className="fi" value={f.qualification} onChange={e => set('qualification', e.target.value)} placeholder="e.g. B.Tech, Diploma, ITI" /></div>
          <div className="fg"><label>Experience (years)</label><input className="fi" value={f.experience} onChange={e => set('experience', e.target.value)} placeholder="e.g. 3 years" /></div>
        </div>
        <div className="fg"><label>Previous Company</label><input className="fi" value={f.previousCompany} onChange={e => set('previousCompany', e.target.value)} placeholder="Previous employer name" /></div>
        <div className="fg"><label>Notes</label><textarea className="fi" value={f.notes} onChange={e => set('notes', e.target.value)} rows={3} placeholder="Additional notes about this member..." /></div>
      </>}
    </div>
  );
}

// The CSV columns of an employee: the account, then the four sections.
export const EMPLOYEE_CSV_HEADERS = ['Team', 'Name', 'Email', 'Phone', 'Designation', 'Role', 'Account Status', 'Reports To', 'Team Section Status', 'Age', 'Blood Group', 'Joining Date', 'Salary', 'Attendance (days)', 'Address', 'Aadhar Number', 'PAN Number', 'Emergency Contact Name', 'Emergency Contact Phone', 'Emergency Contact Relation', 'Bank Name', 'Account Number', 'IFSC Code', 'UPI ID', 'Qualification', 'Experience', 'Previous Company', 'Notes'];

export function employeeCsvRow(u, teamLabel, member, leaderName) {
  const m = member || {};
  return [teamLabel, u.displayName || '', u.email || '', u.phone || m.phone || '', u.designation || '', u.role || '', u.status || 'active', leaderName || '',
    m.status || '', m.age || '', m.bloodGroup || '', m.joiningDate || '', m.salary || '', m.attendance ?? '', m.address || u.address || '',
    m.aadharNumber || '', m.panNumber || '', m.emergencyContactName || '', m.emergencyContactPhone || '', m.emergencyContactRelation || '',
    m.bankName || '', m.accountNumber || '', m.ifscCode || '', m.upiId || '', m.qualification || '', m.experience || '', m.previousCompany || '', m.notes || u.notes || ''];
}
