import React, { useState } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { addDocument, updateDocument, deleteDocument } from '../services/firestore';
import { formatCurrency, getInitials, toNumber, getDaysInMonth, hasAccess, DESIGNATIONS } from '../services/helpers';
import { StatusBadge, Modal, EmptyState } from '../components/SharedUI';

const roles = DESIGNATIONS.map(d => d.label);
const statusOptions = ['Active', 'On Leave', 'Inactive'];

export default function Team() {
  const { team } = useData();
  const { role } = useAuth();
  const { toast } = useToast();
  const [modal, setModal] = useState(null);
  const [detailModal, setDetailModal] = useState(null);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const daysInMonth = getDaysInMonth();
  const canEdit = hasAccess(role, 'manager');

  const handleSave = async (data, id) => {
    try {
      const cleaned = {
        ...data,
        age: toNumber(data.age),
        salary: toNumber(data.salary),
        attendance: toNumber(data.attendance)
      };
      if (id) { await updateDocument('team', id, cleaned); toast('Team member updated'); }
      else { await addDocument('team', cleaned); toast('Team member added'); }
      setModal(null);
    } catch (e) { toast(e.message, 'er'); }
  };

  const handleDelete = async (id) => {
    if (window.confirm('Remove this team member?')) {
      try { await deleteDocument('team', id); toast('Team member removed'); setDetailModal(null); }
      catch (e) { toast(e.message, 'er'); }
    }
  };

  const filtered = team.filter(t => {
    if (filterStatus !== 'all' && t.status !== filterStatus) return false;
    if (search) {
      const s = search.toLowerCase();
      return (t.name || '').toLowerCase().includes(s) || (t.phone || '').toLowerCase().includes(s) || (t.role || '').toLowerCase().includes(s);
    }
    return true;
  });

  const activeCount = team.filter(t => t.status === 'Active').length;
  const onLeaveCount = team.filter(t => t.status === 'On Leave').length;

  return (
    <>
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 12, marginBottom: 18 }}>
        <div className="card" style={{ cursor: 'pointer', border: filterStatus === 'all' ? '2px solid var(--pri)' : undefined }} onClick={() => setFilterStatus('all')}>
          <div className="cb" style={{ textAlign: 'center', padding: '12px 8px' }}>
            <span className="material-icons-round" style={{ fontSize: 26, color: 'var(--pri)', display: 'block', marginBottom: 2 }}>groups</span>
            <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{team.length}</div>
            <div style={{ fontSize: '.74rem', color: 'var(--muted)' }}>Total Members</div>
          </div>
        </div>
        <div className="card" style={{ cursor: 'pointer', border: filterStatus === 'Active' ? '2px solid #27ae60' : undefined }} onClick={() => setFilterStatus('Active')}>
          <div className="cb" style={{ textAlign: 'center', padding: '12px 8px' }}>
            <span className="material-icons-round" style={{ fontSize: 26, color: '#27ae60', display: 'block', marginBottom: 2 }}>person</span>
            <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#27ae60' }}>{activeCount}</div>
            <div style={{ fontSize: '.74rem', color: 'var(--muted)' }}>Active</div>
          </div>
        </div>
        <div className="card" style={{ cursor: 'pointer', border: filterStatus === 'On Leave' ? '2px solid #e8830c' : undefined }} onClick={() => setFilterStatus('On Leave')}>
          <div className="cb" style={{ textAlign: 'center', padding: '12px 8px' }}>
            <span className="material-icons-round" style={{ fontSize: 26, color: '#e8830c', display: 'block', marginBottom: 2 }}>event_busy</span>
            <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#e8830c' }}>{onLeaveCount}</div>
            <div style={{ fontSize: '.74rem', color: 'var(--muted)' }}>On Leave</div>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="tl" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1 }}>
          <h3 style={{ margin: 0 }}>Team Management</h3>
          <div style={{ position: 'relative', maxWidth: 260, flex: 1 }}>
            <span className="material-icons-round" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 16, color: 'var(--muted)' }}>search</span>
            <input className="fi" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 32, fontSize: '.82rem', padding: '6px 10px 6px 32px' }} />
          </div>
        </div>
        {canEdit && <button className="btn bp bsm" onClick={() => setModal({ data: {} })}><span className="material-icons-round" style={{ fontSize: 18 }}>add</span> Add Member</button>}
      </div>

      {/* Team Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(290px,1fr))', gap: 16 }}>
        {filtered.map(t => (
          <div className="card" key={t.id} style={{ cursor: 'pointer', transition: 'box-shadow .2s' }} onClick={() => setDetailModal(t)}>
            <div className="cb" style={{ padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
                <div style={{ width: 50, height: 50, borderRadius: '50%', background: 'linear-gradient(135deg,var(--pri),var(--pri-l))', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', fontWeight: 700, flexShrink: 0 }}>{getInitials(t.name)}</div>
                <div style={{ flex: 1 }}>
                  <h4 style={{ fontSize: '.96rem', marginBottom: 2 }}>{t.name}</h4>
                  <p style={{ fontSize: '.78rem', color: 'var(--muted)', margin: 0 }}>{t.role}</p>
                </div>
                <StatusBadge status={t.status} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, textAlign: 'center', padding: '10px 0', borderTop: '1px solid var(--bor)' }}>
                <div>
                  <span style={{ fontSize: '.68rem', color: 'var(--muted)', display: 'block' }}>Phone</span>
                  <span style={{ fontWeight: 600, fontSize: '.82rem' }}>{t.phone || '-'}</span>
                </div>
                <div>
                  <span style={{ fontSize: '.68rem', color: 'var(--muted)', display: 'block' }}>Salary</span>
                  <span style={{ fontWeight: 600, fontSize: '.82rem' }}>{formatCurrency(t.salary)}</span>
                </div>
                <div>
                  <span style={{ fontSize: '.68rem', color: 'var(--muted)', display: 'block' }}>Attendance</span>
                  <span style={{ fontWeight: 600, fontSize: '.82rem' }}>{t.attendance || 0}/{daysInMonth}d</span>
                </div>
              </div>

              {t.joiningDate && (
                <div style={{ textAlign: 'center', padding: '6px 0 0', fontSize: '.76rem', color: 'var(--muted)' }}>
                  <span className="material-icons-round" style={{ fontSize: 13, verticalAlign: 'middle', marginRight: 3 }}>calendar_today</span>
                  Joined: {new Date(t.joiningDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                </div>
              )}

              {canEdit && (
                <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'center' }} onClick={e => e.stopPropagation()}>
                  <button className="btn bsm bo" onClick={() => setModal({ data: t, id: t.id })}><span className="material-icons-round" style={{ fontSize: 15 }}>edit</span> Edit</button>
                  {hasAccess(role, 'admin') && <button className="btn bsm bo" onClick={() => handleDelete(t.id)} style={{ color: 'var(--err)', borderColor: 'rgba(231,76,60,.3)' }}><span className="material-icons-round" style={{ fontSize: 15 }}>delete</span></button>}
                </div>
              )}
            </div>
          </div>
        ))}
        {!filtered.length && <div className="card"><div className="cb"><EmptyState icon="groups" title="No team members" message={search ? 'No members match your search.' : 'Add team members to manage your workforce.'} /></div></div>}
      </div>

      {/* Add/Edit Modal */}
      {modal && <TeamModal data={modal.data} id={modal.id} onSave={handleSave} onClose={() => setModal(null)} />}

      {/* Detail Modal */}
      {detailModal && (
        <Modal title="Team Member Details" onClose={() => setDetailModal(null)}>
          <TeamDetailView member={detailModal} canEdit={canEdit} isAdmin={hasAccess(role, 'admin')} onEdit={() => { setModal({ data: detailModal, id: detailModal.id }); setDetailModal(null); }} onDelete={() => handleDelete(detailModal.id)} daysInMonth={daysInMonth} />
        </Modal>
      )}
    </>
  );
}

/* ── Team Add/Edit Modal ── */
function TeamModal({ data, id, onSave, onClose }) {
  const [tab, setTab] = useState('basic');
  const [f, setF] = useState({
    name: data.name || '', role: data.role || 'Admin Assistant', status: data.status || 'Active',
    age: data.age || '', phone: data.phone || '', salary: data.salary || '', attendance: data.attendance || 0,
    // New fields
    joiningDate: data.joiningDate || '', email: data.email || '', address: data.address || '',
    emergencyContactName: data.emergencyContactName || '', emergencyContactPhone: data.emergencyContactPhone || '', emergencyContactRelation: data.emergencyContactRelation || '',
    bankName: data.bankName || '', accountNumber: data.accountNumber || '', ifscCode: data.ifscCode || '', upiId: data.upiId || '',
    aadharNumber: data.aadharNumber || '', panNumber: data.panNumber || '',
    qualification: data.qualification || '', experience: data.experience || '', previousCompany: data.previousCompany || '',
    bloodGroup: data.bloodGroup || '', notes: data.notes || ''
  });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  const tabs = [
    { key: 'basic', label: 'Basic Info', icon: 'person' },
    { key: 'bank', label: 'Bank Details', icon: 'account_balance' },
    { key: 'personal', label: 'Personal', icon: 'badge' },
    { key: 'work', label: 'Work Info', icon: 'work' }
  ];

  return (
    <Modal title={id ? 'Edit Team Member' : 'Add Team Member'} onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); onSave(f, id); }}>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--bor)', paddingBottom: 8 }}>
          {tabs.map(t => (
            <button type="button" key={t.key} onClick={() => setTab(t.key)}
              style={{ padding: '6px 12px', fontSize: '.78rem', fontWeight: tab === t.key ? 600 : 400, color: tab === t.key ? 'var(--pri)' : 'var(--muted)', background: tab === t.key ? 'rgba(99,102,241,.08)' : 'transparent', border: 'none', borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className="material-icons-round" style={{ fontSize: 15 }}>{t.icon}</span> {t.label}
            </button>
          ))}
        </div>

        <div className="mb">
          {tab === 'basic' && <>
            <div className="fr">
              <div className="fg"><label>Full Name *</label><input className="fi" value={f.name} onChange={e => set('name', e.target.value)} required /></div>
              <div className="fg"><label>Phone</label><input className="fi" value={f.phone} onChange={e => set('phone', e.target.value)} /></div>
            </div>
            <div className="fr">
              <div className="fg"><label>Email</label><input type="email" className="fi" value={f.email} onChange={e => set('email', e.target.value)} placeholder="employee@example.com" /></div>
              <div className="fg"><label>Joining Date</label><input type="date" className="fi" value={f.joiningDate} onChange={e => set('joiningDate', e.target.value)} /></div>
            </div>
            <div className="fr3">
              <div className="fg"><label>Role / Designation</label><select className="fi" value={f.role} onChange={e => set('role', e.target.value)}>{roles.map(r => <option key={r}>{r}</option>)}</select></div>
              <div className="fg"><label>Age</label><input type="number" className="fi" value={f.age} onChange={e => set('age', e.target.value)} /></div>
              <div className="fg"><label>Status</label><select className="fi" value={f.status} onChange={e => set('status', e.target.value)}>{statusOptions.map(s => <option key={s}>{s}</option>)}</select></div>
            </div>
            <div className="fr">
              <div className="fg"><label>Salary (Monthly)</label><input type="number" className="fi" value={f.salary} onChange={e => set('salary', e.target.value)} /></div>
              <div className="fg"><label>Attendance (days this month)</label><input type="number" className="fi" value={f.attendance} onChange={e => set('attendance', e.target.value)} min="0" max="31" /></div>
            </div>
          </>}

          {tab === 'bank' && <>
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
          </>}

          {tab === 'personal' && <>
            <div className="fg"><label>Full Address</label><textarea className="fi" value={f.address} onChange={e => set('address', e.target.value)} rows={2} placeholder="House no, street, city, state, pincode" /></div>
            <div className="fr3">
              <div className="fg"><label>Aadhar Number</label><input className="fi" value={f.aadharNumber} onChange={e => set('aadharNumber', e.target.value)} placeholder="XXXX XXXX XXXX" maxLength={14} /></div>
              <div className="fg"><label>PAN Number</label><input className="fi" value={f.panNumber} onChange={e => set('panNumber', e.target.value)} placeholder="ABCDE1234F" maxLength={10} style={{ textTransform: 'uppercase' }} /></div>
              <div className="fg"><label>Blood Group</label><select className="fi" value={f.bloodGroup} onChange={e => set('bloodGroup', e.target.value)}>
                <option value="">-- Select --</option>
                {['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'].map(bg => <option key={bg}>{bg}</option>)}
              </select></div>
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

        <div className="mf">
          <button type="button" className="btn bo" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn bp">{id ? 'Update' : 'Add Member'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ── Team Detail View ── */
function TeamDetailView({ member: t, canEdit, isAdmin, onEdit, onDelete, daysInMonth }) {
  const detailRow = (icon, label, value) => {
    if (!value && value !== 0) return null;
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--bor)' }}>
        <span className="material-icons-round" style={{ fontSize: 17, color: 'var(--muted)', marginTop: 2 }}>{icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '.72rem', color: 'var(--muted)', marginBottom: 1 }}>{label}</div>
          <div style={{ fontSize: '.88rem', fontWeight: 500 }}>{value}</div>
        </div>
      </div>
    );
  };

  const attendancePercent = daysInMonth > 0 ? Math.round(((t.attendance || 0) / daysInMonth) * 100) : 0;

  return (
    <div>
      {/* Profile header */}
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <div style={{ width: 60, height: 60, borderRadius: '50%', background: 'linear-gradient(135deg,var(--pri),var(--pri-l))', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', fontWeight: 700, margin: '0 auto 10px' }}>{getInitials(t.name)}</div>
        <h3 style={{ margin: 0 }}>{t.name}</h3>
        <p style={{ color: 'var(--muted)', fontSize: '.84rem', margin: '3px 0 8px' }}>{t.role}</p>
        <StatusBadge status={t.status} />
      </div>

      {/* Attendance bar */}
      <div style={{ background: 'rgba(99,102,241,.04)', borderRadius: 8, padding: 12, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: '.78rem', fontWeight: 600 }}>Attendance This Month</span>
          <span style={{ fontSize: '.78rem', fontWeight: 700, color: attendancePercent >= 80 ? '#27ae60' : attendancePercent >= 50 ? '#e8830c' : 'var(--err)' }}>{t.attendance || 0}/{daysInMonth} days ({attendancePercent}%)</span>
        </div>
        <div style={{ height: 6, background: 'var(--bor)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: attendancePercent + '%', background: attendancePercent >= 80 ? '#27ae60' : attendancePercent >= 50 ? '#e8830c' : 'var(--err)', borderRadius: 3, transition: 'width .3s' }} />
        </div>
      </div>

      {/* Details sections */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: '.76rem', fontWeight: 700, color: 'var(--pri)', textTransform: 'uppercase', marginBottom: 4, letterSpacing: '.5px' }}>Contact & Basic</div>
        {detailRow('phone', 'Phone', t.phone)}
        {detailRow('email', 'Email', t.email)}
        {detailRow('cake', 'Age', t.age ? `${t.age} years` : null)}
        {detailRow('payments', 'Salary', t.salary ? formatCurrency(t.salary) + '/month' : null)}
        {detailRow('calendar_today', 'Joining Date', t.joiningDate ? new Date(t.joiningDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : null)}
        {detailRow('location_on', 'Address', t.address)}
        {detailRow('bloodtype', 'Blood Group', t.bloodGroup)}
      </div>

      {(t.bankName || t.accountNumber || t.ifscCode || t.upiId) && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: '.76rem', fontWeight: 700, color: 'var(--pri)', textTransform: 'uppercase', marginBottom: 4, letterSpacing: '.5px' }}>Bank Details</div>
          {detailRow('account_balance', 'Bank Name', t.bankName)}
          {detailRow('pin', 'Account Number', t.accountNumber)}
          {detailRow('qr_code', 'IFSC Code', t.ifscCode)}
          {detailRow('smartphone', 'UPI ID', t.upiId)}
        </div>
      )}

      {(t.aadharNumber || t.panNumber) && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: '.76rem', fontWeight: 700, color: 'var(--pri)', textTransform: 'uppercase', marginBottom: 4, letterSpacing: '.5px' }}>ID Details</div>
          {detailRow('badge', 'Aadhar Number', t.aadharNumber)}
          {detailRow('credit_card', 'PAN Number', t.panNumber)}
        </div>
      )}

      {(t.emergencyContactName || t.emergencyContactPhone) && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: '.76rem', fontWeight: 700, color: 'var(--err)', textTransform: 'uppercase', marginBottom: 4, letterSpacing: '.5px' }}>Emergency Contact</div>
          {detailRow('person', 'Name', t.emergencyContactName)}
          {detailRow('phone', 'Phone', t.emergencyContactPhone)}
          {detailRow('family_restroom', 'Relation', t.emergencyContactRelation)}
        </div>
      )}

      {(t.qualification || t.experience || t.previousCompany) && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: '.76rem', fontWeight: 700, color: 'var(--pri)', textTransform: 'uppercase', marginBottom: 4, letterSpacing: '.5px' }}>Work Background</div>
          {detailRow('school', 'Qualification', t.qualification)}
          {detailRow('work_history', 'Experience', t.experience)}
          {detailRow('business', 'Previous Company', t.previousCompany)}
        </div>
      )}

      {t.notes && (
        <div style={{ marginBottom: 14 }}>
          {detailRow('notes', 'Notes', t.notes)}
        </div>
      )}

      {/* Actions */}
      {canEdit && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 14 }}>
          <button className="btn bp" onClick={onEdit} style={{ padding: '6px 16px', fontSize: '.84rem' }}>
            <span className="material-icons-round" style={{ fontSize: 16 }}>edit</span> Edit
          </button>
          {isAdmin && (
            <button className="btn" onClick={onDelete} style={{ padding: '6px 16px', fontSize: '.84rem', color: 'var(--err)' }}>
              <span className="material-icons-round" style={{ fontSize: 16 }}>delete</span> Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
