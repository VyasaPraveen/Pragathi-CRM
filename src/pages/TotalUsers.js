import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { apiGet, apiPost, apiPatch, apiDelete } from '../services/api';
import { DESIGNATIONS, formatDateTime, hasAccess } from '../services/helpers';
import { Modal, EmptyState } from '../components/SharedUI';
import PasswordManager, { generatePassword } from '../components/PasswordManager';
import { teamStructure, userStatus, STATUS_LABEL, leaderCandidates } from '../services/teams';

// ============================================================================
// Total Users — the Owner's one place for every account (Req 5, 30-Oct):
// the teams with their leaders and members, everyone else, who is active,
// on hold or deactivated, and every change a person's account can need —
// without ever making a second account for the same person. What happens to
// a person's existing records when they move is always the Owner's choice.
// ============================================================================

const RECORD_LABELS = { leads: 'Leads', customers: 'Customers', employeeTasks: 'Tasks', installations: 'Installations', leadPOs: 'Dispatches (purchase orders)' };
const lc = (v) => String(v || '').trim().toLowerCase();
const nameOf = (u) => (u && (u.displayName || u.email)) || '';

const STATUS_TONE = { active: 'st-g', hold: 'st-o', deactivated: 'st-x', pending: 'st-b' };
function Standing({ u }) {
  const s = userStatus(u);
  return <span className={`st ${STATUS_TONE[s]}`} style={{ padding: '2px 8px', fontSize: '.72rem' }}>{STATUS_LABEL[s]}</span>;
}

function Avatar({ u, size = 34 }) {
  const initials = (nameOf(u) || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const off = userStatus(u) !== 'active';
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, background: off ? 'var(--bor)' : 'linear-gradient(135deg,var(--pri),var(--pri-l))', color: off ? 'var(--muted)' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: size * 0.36 }}>{initials}</div>
  );
}

/* ── one person's row ───────────────────────────────────────────────────── */
function UserRow({ u, me, leaderLabel, onAct }) {
  const s = userStatus(u);
  const self = u.id === me?.id;
  const btn = (title, icon, act, extra = {}) => (
    <button className="btn bsm bo" title={title} onClick={() => onAct(act, u)} style={{ padding: '5px 8px', ...extra }}>
      <span className="material-icons-round" style={{ fontSize: 15 }}>{icon}</span>
    </button>
  );
  return (
    <tr>
      <td className="m-h">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Avatar u={u} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>{nameOf(u)}{self && <span style={{ fontSize: '.72rem', color: 'var(--pri)', marginLeft: 6 }}>(you)</span>}</div>
            <div style={{ fontSize: '.76rem', color: 'var(--muted)', wordBreak: 'break-all' }}>{u.email}</div>
          </div>
        </div>
      </td>
      <td data-l="Role" style={{ fontSize: '.82rem' }}>{u.designation || u.role || '-'}</td>
      <td data-l="Team" style={{ fontSize: '.82rem' }}>{leaderLabel || <span style={{ color: 'var(--muted)' }}>—</span>}</td>
      <td data-l="Phone" style={{ fontSize: '.82rem' }}>{u.phone || '-'}</td>
      <td data-l="Standing"><Standing u={u} />{u.mustChangePassword && <div style={{ fontSize: '.68rem', color: '#d68910', marginTop: 3 }}>temporary password</div>}</td>
      <td data-l="Device" style={{ fontSize: '.76rem', color: 'var(--muted)' }}>{u.session ? (u.session.active ? 'Signed in' : 'Idle') + (u.session.seen ? ' · ' + formatDateTime(u.session.seen) : '') : 'Not signed in'}</td>
      <td className="m-a"><div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        {btn('Edit details', 'edit', 'edit')}
        {btn('Move to another team / change role', 'swap_horiz', 'move', { color: 'var(--pri)' })}
        {btn('Set password', 'key', 'password', { color: '#6c5ce7', borderColor: 'rgba(108,92,231,.3)' })}
        {btn('Permissions', 'tune', 'permissions')}
        {!self && s === 'active' && btn('Put on hold', 'pause_circle', 'hold', { color: '#d68910', borderColor: 'rgba(243,156,18,.4)' })}
        {!self && s === 'hold' && btn('Remove hold', 'play_circle', 'unhold', { color: '#1e8449', borderColor: 'rgba(39,174,96,.4)' })}
        {!self && s !== 'deactivated' && btn('Deactivate', 'person_off', 'deactivate', { color: 'var(--err)', borderColor: 'rgba(231,76,60,.3)' })}
        {!self && s === 'deactivated' && btn('Reactivate', 'person_add', 'reactivate', { color: '#1e8449', borderColor: 'rgba(39,174,96,.4)' })}
        {u.session && btn('Release device', 'phonelink_erase', 'release', { color: '#0e7490', borderColor: 'rgba(14,116,144,.4)' })}
        {btn('History', 'history', 'history')}
        {!self && btn('Delete account', 'delete', 'delete', { color: 'var(--err)', borderColor: 'rgba(231,76,60,.3)' })}
      </div></td>
    </tr>
  );
}

function UserTable({ rows, me, leaderLabelOf, onAct, empty }) {
  return (
    <div className="tw tw-m"><table style={{ fontSize: '.84rem' }}>
      <thead><tr><th>Name</th><th>Role</th><th>Team</th><th>Phone</th><th>Standing</th><th>Device</th><th>Actions</th></tr></thead>
      <tbody>
        {rows.map(u => <UserRow key={u.id} u={u} me={me} leaderLabel={leaderLabelOf(u)} onAct={onAct} />)}
        {!rows.length && <tr><td colSpan="7"><EmptyState icon="group_off" title={empty || 'Nobody here'} message="" /></td></tr>}
      </tbody>
    </table></div>
  );
}

/* ── Add or edit a person ───────────────────────────────────────────────── */
function UserForm({ user, users, presetLeader, onClose, onSaved }) {
  const { toast } = useToast();
  const editing = !!user;
  const [f, setF] = useState({
    displayName: user?.displayName || '', email: user?.email || '', phone: user?.phone || '',
    designation: user?.designation || 'Executive', teamLeader: user?.teamLeader || presetLeader || '',
    teamName: user?.teamName || '', address: user?.address || '', department: user?.department || '', notes: user?.notes || '',
    password: editing ? '' : generatePassword(), mustChangePassword: true, addTeamRecord: true,
  });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const [saving, setSaving] = useState(false);
  const leaders = useMemo(() => leaderCandidates(users).filter(u => u.id !== user?.id), [users, user]);
  const isLeader = f.designation === 'Team Leader';

  const submit = async (e) => {
    e.preventDefault();
    const email = lc(f.email);
    if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) { toast('Enter a valid email address', 'er'); return; }
    if (!f.displayName.trim()) { toast('Enter the person\'s name', 'er'); return; }
    if (!editing && f.password.trim().length < 6) { toast('The password needs at least 6 characters', 'er'); return; }
    if (users.some(u => u.id !== user?.id && lc(u.email) === email)) { toast('An account with this email already exists — pick that person instead of creating a second account', 'er'); return; }
    if (f.teamLeader && lc(f.teamLeader) === email) { toast('A person cannot report to themselves', 'er'); return; }
    setSaving(true);
    try {
      if (editing) {
        const data = {};
        ['displayName', 'phone', 'designation', 'address', 'department', 'notes', 'teamLeader', 'teamName'].forEach(k => { if ((f[k] || '') !== (user[k] || '')) data[k] = f[k]; });
        if (email !== lc(user.email)) data.email = email;
        if (!Object.keys(data).length) { onClose(); return; }
        const res = await apiPatch('/auth/users/' + user.id, data);
        toast(res.linked ? `Saved — ${res.linked} linked record(s) updated to match` : 'Saved');
      } else {
        await apiPost('/auth/users', { email, password: f.password.trim(), displayName: f.displayName.trim(), phone: f.phone, designation: f.designation, teamLeader: f.teamLeader, approved: true, mustChangePassword: f.mustChangePassword, addTeamRecord: f.addTeamRecord });
        toast('Account created');
      }
      onSaved(editing ? null : { email, password: f.password.trim(), name: f.displayName.trim(), phone: f.phone });
    } catch (err) { toast(err.message, 'er'); }
    finally { setSaving(false); }
  };

  return (
    <Modal title={editing ? `Edit — ${nameOf(user)}` : 'New user'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="mb">
          <div className="fr">
            <div className="fg"><label>Full name *</label><input className="fi" value={f.displayName} onChange={e => set('displayName', e.target.value)} required /></div>
            <div className="fg"><label>Phone</label><input className="fi" value={f.phone} onChange={e => set('phone', e.target.value)} /></div>
          </div>
          <div className="fr">
            <div className="fg"><label>Email (username) *</label><input type="email" className="fi" value={f.email} onChange={e => set('email', e.target.value)} required />
              {editing && lc(f.email) !== lc(user.email) && <div style={{ fontSize: '.74rem', color: '#d68910', marginTop: 4 }}>Changing the email renames the login; every record and team link that carried the old address is updated with it, and the person is signed out to sign in again.</div>}
            </div>
            <div className="fg"><label>Designation / role *</label>
              <select className="fi" value={f.designation} onChange={e => set('designation', e.target.value)}>
                {DESIGNATIONS.map(d => <option key={d.label} value={d.label}>{d.label}</option>)}
              </select>
            </div>
          </div>
          <div className="fr">
            <div className="fg"><label>Team (reports to)</label>
              <select className="fi" value={f.teamLeader} onChange={e => set('teamLeader', e.target.value)}>
                <option value="">— no team —</option>
                {leaders.map(u => <option key={u.id} value={lc(u.email)}>{nameOf(u)}{u.designation ? ' · ' + u.designation : ''}</option>)}
              </select>
            </div>
            {isLeader && <div className="fg"><label>Team name</label><input className="fi" value={f.teamName} onChange={e => set('teamName', e.target.value)} placeholder="e.g. Team 3" /></div>}
          </div>
          {!editing && (
            <div className="fr">
              <div className="fg"><label>Temporary password *</label><input className="fi" value={f.password} onChange={e => set('password', e.target.value)} style={{ fontFamily: 'monospace' }} /></div>
              <div className="fg" style={{ display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'flex-end' }}>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '.84rem' }}><input type="checkbox" checked={f.mustChangePassword} onChange={e => set('mustChangePassword', e.target.checked)} /> Must change it at first sign-in</label>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '.84rem' }}><input type="checkbox" checked={f.addTeamRecord} onChange={e => set('addTeamRecord', e.target.checked)} /> Also add to the Team section</label>
              </div>
            </div>
          )}
          {editing && <>
            <div className="fr">
              <div className="fg"><label>Department</label><input className="fi" value={f.department} onChange={e => set('department', e.target.value)} /></div>
              <div className="fg"><label>Address</label><input className="fi" value={f.address} onChange={e => set('address', e.target.value)} /></div>
            </div>
            <div className="fg"><label>Notes</label><textarea className="fi" rows={2} value={f.notes} onChange={e => set('notes', e.target.value)} /></div>
          </>}
        </div>
        <div className="mf"><button type="button" className="btn bo" onClick={onClose}>Cancel</button><button type="submit" className="btn bp" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save' : 'Create account'}</button></div>
      </form>
    </Modal>
  );
}

/* ── The records picker: what moves, what stays ─────────────────────────── */
function RecordChooser({ userId, mode, setMode, chosen, setChosen, onlyLeads, asLeader, note }) {
  const [recs, setRecs] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let dead = false;
    apiGet(`/users/${userId}/records${asLeader ? '?as=leader' : ''}`).then(r => { if (!dead) setRecs(r.records || {}); }).catch(e => { if (!dead) setErr(e.message); });
    return () => { dead = true; };
  }, [userId, asLeader]);
  const colls = Object.keys(RECORD_LABELS).filter(c => !onlyLeads || c === 'leads');
  const total = recs ? colls.reduce((n, c) => n + (recs[c] || []).length, 0) : 0;
  const toggle = (c, id) => setChosen(p => { const cur = new Set(p[c] || []); cur.has(id) ? cur.delete(id) : cur.add(id); return { ...p, [c]: [...cur] }; });
  const all = (c, on) => setChosen(p => ({ ...p, [c]: on ? (recs[c] || []).map(r => r.id) : [] }));
  const Opt = ({ value, title, text }) => (
    <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 10px', border: `1px solid ${mode === value ? 'var(--pri)' : 'var(--bor)'}`, borderRadius: 8, cursor: 'pointer', background: mode === value ? 'rgba(26,58,122,.04)' : '#fff' }}>
      <input type="radio" name="recmode" checked={mode === value} onChange={() => setMode(value)} style={{ marginTop: 3 }} />
      <span><strong style={{ fontSize: '.86rem' }}>{title}</strong><br /><span style={{ fontSize: '.78rem', color: 'var(--muted)' }}>{text}</span></span>
    </label>
  );
  return (
    <div>
      <p style={{ fontSize: '.8rem', color: 'var(--muted)', margin: '0 0 8px' }}>{note || 'What happens to the records this person holds today?'}{recs ? ` They hold ${total} open record(s).` : ''}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Opt value="selected" title="Move the records I pick" text="Only the ticked records move; the rest stay exactly as they are." />
        <Opt value="fresh" title="Only new work from now on" text="Existing records stay with their present assignments; anything created after this follows the new team or role." />
        <Opt value="keep" title="Keep every existing record unchanged" text="Change the person only. Nothing is transferred." />
      </div>
      {mode === 'selected' && (
        <div style={{ marginTop: 10, border: '1px solid var(--bor)', borderRadius: 8, padding: 10, maxHeight: 300, overflowY: 'auto' }}>
          {err && <div className="aerr">{err}</div>}
          {!recs && !err && <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '.82rem', color: 'var(--muted)' }}><div className="spin" style={{ width: 18, height: 18 }} /> Loading the records…</div>}
          {recs && !total && <p style={{ margin: 0, fontSize: '.82rem', color: 'var(--muted)' }}>No open records are linked to this person.</p>}
          {recs && colls.filter(c => (recs[c] || []).length).map(c => (
            <div key={c} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <strong style={{ fontSize: '.8rem' }}>{RECORD_LABELS[c]} ({(recs[c] || []).length})</strong>
                <span style={{ fontSize: '.74rem' }}><button type="button" className="btn bsm bo" style={{ padding: '2px 8px' }} onClick={() => all(c, true)}>all</button> <button type="button" className="btn bsm bo" style={{ padding: '2px 8px' }} onClick={() => all(c, false)}>none</button></span>
              </div>
              {(recs[c] || []).map(r => (
                <label key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '.8rem', padding: '3px 0' }}>
                  <input type="checkbox" checked={(chosen[c] || []).includes(r.id)} onChange={() => toggle(c, r.id)} />
                  <span style={{ flex: 1 }}>{r.title}</span>
                  {r.status && <span style={{ color: 'var(--muted)', fontSize: '.72rem' }}>{r.status}</span>}
                </label>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Move a person: team, role, replacement, records ────────────────────── */
function MoveDialog({ user, users, presetLeader, onClose, onDone }) {
  const { toast } = useToast();
  const [leader, setLeader] = useState(presetLeader !== undefined ? presetLeader : (user.teamLeader || ''));
  const [designation, setDesignation] = useState(user.designation || '');
  const [toUserId, setToUserId] = useState('');
  const [mode, setMode] = useState('keep');
  const [chosen, setChosen] = useState({});
  const [saving, setSaving] = useState(false);
  const leaders = useMemo(() => leaderCandidates(users).filter(u => u.id !== user.id), [users, user]);
  const people = useMemo(() => users.filter(u => u.id !== user.id && userStatus(u) === 'active'), [users, user]);
  const picked = Object.values(chosen).reduce((n, a) => n + a.length, 0);
  const summary = [
    lc(leader) !== lc(user.teamLeader || '') ? `team → ${leader ? nameOf(users.find(u => lc(u.email) === lc(leader))) : 'no team'}` : '',
    designation !== (user.designation || '') ? `role → ${designation}` : '',
    mode === 'selected' ? `${picked} record(s) ${toUserId ? 'handed to ' + nameOf(users.find(u => u.id === toUserId)) : 'relinked to the new team'}` : mode === 'fresh' ? 'existing records stay; new work follows' : 'records unchanged',
  ].filter(Boolean).join(' · ');
  const go = async () => {
    if (mode === 'selected' && !picked) { toast('Tick the records to move, or choose another option', 'er'); return; }
    if (!window.confirm(`Apply to ${nameOf(user)}: ${summary}?`)) return;
    setSaving(true);
    try {
      const body = { recordMode: mode, records: chosen };
      if (lc(leader) !== lc(user.teamLeader || '')) body.teamLeader = leader;
      if (designation && designation !== user.designation) body.designation = designation;
      if (toUserId) body.toUserId = toUserId;
      const res = await apiPost(`/users/${user.id}/reassign`, body);
      const moved = Object.values(res.records || {}).reduce((n, v) => n + v, 0);
      toast(`Done${moved ? ` — ${moved} record(s) moved` : ''}`);
      onDone();
    } catch (err) { toast(err.message, 'er'); }
    finally { setSaving(false); }
  };
  return (
    <Modal title={`Move / change — ${nameOf(user)}`} onClose={onClose}>
      <div className="mb">
        <div className="fr">
          <div className="fg"><label>Team (reports to)</label>
            <select className="fi" value={leader} onChange={e => setLeader(e.target.value)}>
              <option value="">— no team —</option>
              {leaders.map(u => <option key={u.id} value={lc(u.email)}>{nameOf(u)}{u.designation ? ' · ' + u.designation : ''}</option>)}
            </select>
          </div>
          <div className="fg"><label>Designation / role</label>
            <select className="fi" value={designation} onChange={e => setDesignation(e.target.value)}>
              {!designation && <option value="">— keep —</option>}
              {DESIGNATIONS.map(d => <option key={d.label} value={d.label}>{d.label}</option>)}
            </select>
          </div>
        </div>
        <div className="fg"><label>Hand the moved records to (optional)</label>
          <select className="fi" value={toUserId} onChange={e => setToUserId(e.target.value)}>
            <option value="">— nobody: the records keep this person, only their team link changes —</option>
            {people.map(u => <option key={u.id} value={u.id}>{nameOf(u)}{u.designation ? ' · ' + u.designation : ''}</option>)}
          </select>
          <div style={{ fontSize: '.74rem', color: 'var(--muted)', marginTop: 4 }}>Use this to replace a member: the ticked records are reassigned to the person you choose, with a note of the hand-over kept on each.</div>
        </div>
        <RecordChooser userId={user.id} mode={mode} setMode={setMode} chosen={chosen} setChosen={setChosen} />
        <div style={{ marginTop: 10, fontSize: '.8rem', background: 'var(--bg)', borderRadius: 8, padding: '8px 10px' }}><strong>This will:</strong> {summary}</div>
      </div>
      <div className="mf"><button className="btn bo" onClick={onClose}>Cancel</button><button className="btn bp" disabled={saving} onClick={go}>{saving ? 'Applying…' : 'Apply'}</button></div>
    </Modal>
  );
}

/* ── A new Team Leader for a team ───────────────────────────────────────── */
function LeaderDialog({ team, users, onClose, onDone }) {
  const { toast } = useToast();
  const [newId, setNewId] = useState('');
  const [stays, setStays] = useState(true);
  const [prevDesignation, setPrevDesignation] = useState('Executive');
  const [mode, setMode] = useState('keep');
  const [chosen, setChosen] = useState({});
  const [saving, setSaving] = useState(false);
  const candidates = useMemo(() => leaderCandidates(users).filter(u => u.id !== team.leader.id), [users, team]);
  const go = async () => {
    const to = users.find(u => u.id === newId);
    if (!to) { toast('Choose the new Team Leader', 'er'); return; }
    const picked = (chosen.leads || []).length;
    if (mode === 'selected' && !picked) { toast('Tick the leads to relink, or choose another option', 'er'); return; }
    if (!window.confirm(`${nameOf(to)} becomes the leader of ${team.label}. ${nameOf(team.leader)} ${stays ? `stays in the team as ${prevDesignation}` : `leaves the team as ${prevDesignation}`}. The ${team.members.length} member(s) move under the new leader. ${mode === 'selected' ? picked + ' lead(s) relinked' : 'Existing leads keep their present team link'}. Continue?`)) return;
    setSaving(true);
    try {
      const res = await apiPost(`/users/${to.id}/make-leader`, { fromLeaderId: team.leader.id, previousStays: stays, previousDesignation: prevDesignation, recordMode: mode, records: chosen });
      toast(`${nameOf(to)} now leads ${team.label} — ${res.membersMoved} member(s) moved across`);
      onDone();
    } catch (err) { toast(err.message, 'er'); }
    finally { setSaving(false); }
  };
  return (
    <Modal title={`Change the Team Leader — ${team.label}`} onClose={onClose}>
      <div className="mb">
        <p style={{ fontSize: '.84rem', margin: '0 0 10px' }}>Current leader: <strong>{nameOf(team.leader)}</strong> · {team.members.length} member(s)</p>
        <div className="fg"><label>New Team Leader *</label>
          <select className="fi" value={newId} onChange={e => setNewId(e.target.value)}>
            <option value="">— choose —</option>
            {candidates.map(u => <option key={u.id} value={u.id}>{nameOf(u)} · {u.designation || u.role}{team.members.some(m => m.id === u.id) ? ' (in this team)' : ''}</option>)}
          </select>
          <div style={{ fontSize: '.74rem', color: 'var(--muted)', marginTop: 4 }}>The new leader gets the Team Leader role and its permissions (a manager keeps their own role).</div>
        </div>
        <div className="fr">
          <div className="fg"><label>{nameOf(team.leader)} afterwards</label>
            <select className="fi" value={stays ? 'stay' : 'leave'} onChange={e => setStays(e.target.value === 'stay')}>
              <option value="stay">Stays in this team as a member</option>
              <option value="leave">Leaves the team</option>
            </select>
          </div>
          <div className="fg"><label>…with the role</label>
            <select className="fi" value={prevDesignation} onChange={e => setPrevDesignation(e.target.value)}>
              {DESIGNATIONS.filter(d => d.role !== 'super_admin').map(d => <option key={d.label} value={d.label}>{d.label}</option>)}
            </select>
          </div>
        </div>
        <RecordChooser userId={team.leader.id} mode={mode} setMode={setMode} chosen={chosen} setChosen={setChosen} onlyLeads asLeader note="The team's leads carry the leader they were raised under. Which should now carry the new leader?" />
      </div>
      <div className="mf"><button className="btn bo" onClick={onClose}>Cancel</button><button className="btn bp" disabled={saving} onClick={go}>{saving ? 'Applying…' : 'Change leader'}</button></div>
    </Modal>
  );
}

/* ── Hold / deactivate, with the note ───────────────────────────────────── */
function StatusDialog({ user, status, onClose, onDone }) {
  const { toast } = useToast();
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const texts = {
    hold: ['Put on hold', `${nameOf(user)} is signed out and cannot sign in or work until the hold is removed. Their records, team and history stay exactly as they are, and they receive no notifications meanwhile.`],
    active: ['Restore access', `${nameOf(user)} can sign in and work again. Nothing else changes.`],
    deactivated: ['Deactivate', `${nameOf(user)} is signed out and cannot sign in. Their records stay on file for everyone authorised to see them, and the account can be reactivated later. Prefer this to deleting.`],
  };
  const [title, text] = texts[status];
  const go = async () => {
    setSaving(true);
    try { await apiPost(`/users/${user.id}/status`, { status, note }); toast(`${title}: ${nameOf(user)}`); onDone(); }
    catch (err) { toast(err.message, 'er'); }
    finally { setSaving(false); }
  };
  return (
    <Modal title={`${title} — ${nameOf(user)}`} onClose={onClose}>
      <div className="mb">
        <p style={{ fontSize: '.86rem', marginTop: 0 }}>{text}</p>
        <div className="fg"><label>Reason / note</label><input className="fi" value={note} onChange={e => setNote(e.target.value)} placeholder="Kept in the account's history" /></div>
      </div>
      <div className="mf"><button className="btn bo" onClick={onClose}>Cancel</button><button className="btn bp" disabled={saving} onClick={go}>{saving ? 'Saving…' : title}</button></div>
    </Modal>
  );
}

/* ── Delete: the impact first ───────────────────────────────────────────── */
function DeleteDialog({ user, onClose, onDone, onDeactivate }) {
  const { toast } = useToast();
  const [counts, setCounts] = useState(null);
  const [word, setWord] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { apiGet(`/users/${user.id}/records`).then(r => setCounts(r.counts || {})).catch(() => setCounts({})); }, [user.id]);
  const total = counts ? Object.values(counts).reduce((n, v) => n + v, 0) : null;
  const go = async () => {
    setSaving(true);
    try { await apiDelete('/auth/users/' + user.id); toast('Account deleted'); onDone(); }
    catch (err) { toast(err.message, 'er'); }
    finally { setSaving(false); }
  };
  return (
    <Modal title={`Delete the account — ${nameOf(user)}`} onClose={onClose}>
      <div className="mb">
        <div className="aerr" style={{ marginBottom: 10 }}>This removes the login for good. It cannot be undone.</div>
        <p style={{ fontSize: '.84rem' }}>{total == null ? 'Checking the linked records…' : total ? `${total} open record(s) are linked to this person (${Object.entries(counts).filter(([, n]) => n).map(([c, n]) => `${RECORD_LABELS[c]}: ${n}`).join(', ')}). They are NOT deleted — they keep this person's name, but nobody can act on them as this person any more. Move them first, or deactivate the account instead.` : 'No open records are linked to this person. Past records keep their name.'}</p>
        <div className="fg"><label>Type DELETE to confirm</label><input className="fi" value={word} onChange={e => setWord(e.target.value)} /></div>
      </div>
      <div className="mf">
        <button className="btn bo" onClick={onClose}>Cancel</button>
        <button className="btn bo" onClick={onDeactivate} style={{ color: 'var(--pri)' }}>Deactivate instead</button>
        <button className="btn bp" disabled={saving || word !== 'DELETE'} onClick={go} style={{ background: 'var(--err)' }}>{saving ? 'Deleting…' : 'Delete'}</button>
      </div>
    </Modal>
  );
}

/* ── What was done to an account ────────────────────────────────────────── */
function HistoryDialog({ user, onClose }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { apiGet(`/users/${user.id}/history`).then(r => setRows(r.history || [])).catch(() => setRows([])); }, [user.id]);
  return (
    <Modal title={`History — ${nameOf(user)}`} onClose={onClose}>
      <div className="mb">
        {!rows && <div className="spin" />}
        {rows && !rows.length && <p style={{ color: 'var(--muted)', fontSize: '.84rem' }}>Nothing recorded yet.</p>}
        {rows && rows.map(h => (
          <div key={h.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--bor)', fontSize: '.82rem' }}>
            <div><strong>{h.action}</strong> <span style={{ color: 'var(--muted)' }}>by {h.user} · {formatDateTime(h.timestamp || h.createdAt)}</span></div>
            <div style={{ color: 'var(--muted)' }}>{h.details}</div>
          </div>
        ))}
      </div>
      <div className="mf"><button className="btn bo" onClick={onClose}>Close</button></div>
    </Modal>
  );
}

/* ── Add a user to a team: existing or new ──────────────────────────────── */
function AddToTeamDialog({ team, users, onExisting, onNew, onClose }) {
  const [pick, setPick] = useState('');
  const candidates = users.filter(u => u.id !== team.leader.id && !team.members.some(m => m.id === u.id) && userStatus(u) !== 'deactivated');
  return (
    <Modal title={`Add a user to ${team.label}`} onClose={onClose}>
      <div className="mb">
        <div style={{ border: '1px solid var(--bor)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <strong style={{ fontSize: '.86rem' }}>An existing user</strong>
          <p style={{ fontSize: '.78rem', color: 'var(--muted)', margin: '4px 0 8px' }}>Moves the person into this team — the same account, the same history. You then choose what happens to their records.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select className="fi" style={{ flex: 1, minWidth: 200 }} value={pick} onChange={e => setPick(e.target.value)}>
              <option value="">— choose a person —</option>
              {candidates.map(u => <option key={u.id} value={u.id}>{nameOf(u)} · {u.designation || u.role}{u.teamLeader ? ' · in ' + (nameOf(users.find(x => lc(x.email) === lc(u.teamLeader))) || 'another team') : ''}</option>)}
            </select>
            <button className="btn bp" disabled={!pick} onClick={() => onExisting(users.find(u => u.id === pick))}>Move here</button>
          </div>
        </div>
        <div style={{ border: '1px solid var(--bor)', borderRadius: 8, padding: 12 }}>
          <strong style={{ fontSize: '.86rem' }}>A new user</strong>
          <p style={{ fontSize: '.78rem', color: 'var(--muted)', margin: '4px 0 8px' }}>Creates the login under this team's leader, with a temporary password to pass on.</p>
          <button className="btn bo" onClick={onNew}><span className="material-icons-round" style={{ fontSize: 16 }}>person_add</span> Create a new user</button>
        </div>
      </div>
      <div className="mf"><button className="btn bo" onClick={onClose}>Cancel</button></div>
    </Modal>
  );
}

/* ── The page ───────────────────────────────────────────────────────────── */
export default function TotalUsers() {
  const { user: me, role } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(null);   // { kind, user, team, ... }
  const [search, setSearch] = useState('');
  const [openTeams, setOpenTeams] = useState(() => new Set());

  const load = async () => {
    try {
      const res = await apiGet('/auth/users');
      setUsers((res.users || []).sort((a, b) => nameOf(a).localeCompare(nameOf(b))));
    } catch (err) { toast('Could not load the users: ' + err.message, 'er'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const structure = useMemo(() => teamStructure(users), [users]);
  const q = lc(search);
  const matches = (u) => !q || lc(nameOf(u)).includes(q) || lc(u.email).includes(q) || lc(u.designation).includes(q) || lc(u.phone).includes(q);
  const leaderLabelOf = (u) => {
    const t = structure.teams.find(x => x.leader.id === u.id || x.members.some(m => m.id === u.id));
    if (!t) return '';
    return t.leader.id === u.id ? `${t.label} · leader` : `${t.label} · ${nameOf(t.leader)}`;
  };
  const done = () => { setDialog(null); load(); window.dispatchEvent(new Event('pps:refresh')); };

  const act = async (kind, u) => {
    if (kind === 'release') {
      if (!window.confirm(`Sign ${nameOf(u)} out of the current device so the account can sign in on another?`)) return;
      try { await apiPost('/auth/users/' + u.id + '/release-session', {}); toast('Device released'); load(); } catch (err) { toast(err.message, 'er'); }
      return;
    }
    if (kind === 'permissions') { navigate('/settings?user=' + encodeURIComponent(u.id)); return; }
    if (kind === 'unhold' || kind === 'reactivate') { setDialog({ kind: 'status', user: u, status: 'active' }); return; }
    if (kind === 'hold') { setDialog({ kind: 'status', user: u, status: 'hold' }); return; }
    if (kind === 'deactivate') { setDialog({ kind: 'status', user: u, status: 'deactivated' }); return; }
    setDialog({ kind, user: u });
  };

  if (!hasAccess(role, 'admin')) return null;

  const toggleTeam = (key) => setOpenTeams(p => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const c = structure.counts;
  const Stat = ({ label, value, color }) => (
    <div className="card"><div className="cb" style={{ padding: '12px 14px', textAlign: 'center' }}>
      <div style={{ fontSize: '1.4rem', fontWeight: 800, color: color || 'var(--txt)' }}>{value}</div>
      <div style={{ fontSize: '.72rem', color: 'var(--muted)', fontWeight: 600 }}>{label}</div>
    </div></div>
  );

  return (
    <>
      <div className="sg" style={{ marginBottom: 16 }}>
        <Stat label="Teams" value={c.teams} />
        <Stat label="Users" value={c.users} />
        <Stat label="Active" value={c.active} color="#1e8449" />
        <Stat label="On hold" value={c.hold} color="#d68910" />
        <Stat label="Deactivated" value={c.deactivated} color="#6b7a8d" />
        <Stat label="Not in a team" value={c.unassigned} color="var(--pri)" />
      </div>

      <div className="tl">
        <div className="sb-x"><span className="material-icons-round">search</span><input type="text" placeholder="Search users…" value={search} onChange={e => setSearch(e.target.value)} /></div>
        <div className="tl-r">
          <div className="chips">
            <span className={`fc ${openTeams.size ? '' : 'act'}`} onClick={() => setOpenTeams(new Set())}>Collapse all</span>
            <span className="fc" onClick={() => setOpenTeams(new Set(structure.teams.map(t => t.key).concat(['others', 'unassigned'])))}>Expand all</span>
          </div>
          <button className="btn bp bsm" onClick={() => setDialog({ kind: 'new', presetLeader: '' })}><span className="material-icons-round" style={{ fontSize: 18 }}>person_add</span> New User</button>
        </div>
      </div>

      {/* Team summary */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="ch"><h3><span className="material-icons-round" style={{ fontSize: 20, verticalAlign: 'middle', marginRight: 6 }}>account_tree</span>Team summary</h3></div>
        <div className="cb" style={{ padding: 0 }}>
          <div className="tw tw-m"><table style={{ fontSize: '.84rem' }}>
            <thead><tr><th>Team</th><th>Team Leader</th><th>Members</th><th>Active</th><th>On hold</th><th>Deactivated</th><th>Actions</th></tr></thead>
            <tbody>
              {structure.teams.map(t => (
                <tr key={t.key}>
                  <td className="m-h"><strong>{t.label}</strong></td>
                  <td data-l="Team Leader">{nameOf(t.leader)} <Standing u={t.leader} /></td>
                  <td data-l="Members">{t.members.length}</td>
                  <td data-l="Active" style={{ color: '#1e8449', fontWeight: 600 }}>{t.active}</td>
                  <td data-l="On hold" style={{ color: '#d68910', fontWeight: 600 }}>{t.hold}</td>
                  <td data-l="Deactivated" style={{ color: 'var(--muted)', fontWeight: 600 }}>{t.deactivated}</td>
                  <td className="m-a"><div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn bsm bo" title="Open the team" onClick={() => toggleTeam(t.key)}><span className="material-icons-round" style={{ fontSize: 15 }}>{openTeams.has(t.key) ? 'expand_less' : 'expand_more'}</span></button>
                    <button className="btn bsm bo" title="Change the Team Leader" onClick={() => setDialog({ kind: 'leader', team: t })}><span className="material-icons-round" style={{ fontSize: 15 }}>swap_horizontal_circle</span></button>
                    <button className="btn bsm bo" title="Add a user to this team" onClick={() => setDialog({ kind: 'add', team: t })}><span className="material-icons-round" style={{ fontSize: 15 }}>group_add</span></button>
                  </div></td>
                </tr>
              ))}
              {!structure.teams.length && !loading && <tr><td colSpan="7"><EmptyState icon="groups" title="No teams yet" message="Give someone the Team Leader role and assign members to them." /></td></tr>}
            </tbody>
          </table></div>
        </div>
      </div>

      {loading && <div className="page-loading"><div className="spin" /><span>Loading the users…</span></div>}

      {/* Each team */}
      {structure.teams.map(t => {
        const rows = [t.leader, ...t.members].filter(matches);
        const open = openTeams.has(t.key) || !!q;
        return (
          <div className="card" key={t.key} style={{ marginBottom: 14 }}>
            <div className="ch" style={{ cursor: 'pointer', flexWrap: 'wrap', gap: 8 }} onClick={() => toggleTeam(t.key)}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span className="material-icons-round" style={{ fontSize: 20 }}>{open ? 'expand_less' : 'expand_more'}</span>
                {t.label}
                <span style={{ fontSize: '.8rem', fontWeight: 500, color: 'var(--muted)' }}>Leader: {nameOf(t.leader)} · {t.members.length} member{t.members.length === 1 ? '' : 's'}</span>
              </h3>
              <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                <button className="btn bsm bo" onClick={() => setDialog({ kind: 'rename', team: t })} title="Rename the team"><span className="material-icons-round" style={{ fontSize: 15 }}>drive_file_rename_outline</span></button>
                <button className="btn bsm bo" onClick={() => setDialog({ kind: 'leader', team: t })}><span className="material-icons-round" style={{ fontSize: 15 }}>swap_horizontal_circle</span> Change leader</button>
                <button className="btn bsm bp" onClick={() => setDialog({ kind: 'add', team: t })}><span className="material-icons-round" style={{ fontSize: 15 }}>group_add</span> Add user</button>
              </div>
            </div>
            {open && <div className="cb" style={{ padding: 0 }}><UserTable rows={rows} me={me} leaderLabelOf={leaderLabelOf} onAct={act} empty="No one matches" /></div>}
          </div>
        );
      })}

      {/* Everyone outside the teams */}
      {[['others', 'Other users', 'Management, Admin, Operation Manager, Accountant and the other office roles', structure.others],
        ['unassigned', 'Not in a team', 'Executives and technicians with no Team Leader assigned', structure.unassigned]].map(([key, title, sub, list]) => {
        const rows = list.filter(matches);
        const open = openTeams.has(key) || !!q || key === 'unassigned';
        return (
          <div className="card" key={key} style={{ marginBottom: 14 }}>
            <div className="ch" style={{ cursor: 'pointer', flexWrap: 'wrap', gap: 8 }} onClick={() => toggleTeam(key)}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span className="material-icons-round" style={{ fontSize: 20 }}>{open ? 'expand_less' : 'expand_more'}</span>
                {title}
                <span style={{ fontSize: '.8rem', fontWeight: 500, color: 'var(--muted)' }}>{list.length} · {sub}</span>
              </h3>
            </div>
            {open && <div className="cb" style={{ padding: 0 }}><UserTable rows={rows} me={me} leaderLabelOf={leaderLabelOf} onAct={act} empty={key === 'unassigned' ? 'Everyone is in a team' : 'Nobody here'} /></div>}
          </div>
        );
      })}

      {structure.brokenLinks.length > 0 && (
        <div className="card" style={{ marginBottom: 14, borderColor: 'rgba(243,156,18,.5)' }}><div className="cb" style={{ fontSize: '.82rem' }}>
          <strong>Needs attention:</strong> {structure.brokenLinks.map(nameOf).join(', ')} report to a leader whose account no longer exists. Open "Move" on each to set the team.
        </div></div>
      )}

      {/* Dialogs */}
      {dialog?.kind === 'new' && <UserForm users={users} presetLeader={dialog.presetLeader} onClose={() => setDialog(null)} onSaved={(created) => { done(); if (created) setDialog({ kind: 'created', created }); }} />}
      {dialog?.kind === 'edit' && <UserForm user={dialog.user} users={users} onClose={() => setDialog(null)} onSaved={done} />}
      {dialog?.kind === 'move' && <MoveDialog user={dialog.user} users={users} presetLeader={dialog.presetLeader} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === 'leader' && <LeaderDialog team={dialog.team} users={users} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === 'status' && <StatusDialog user={dialog.user} status={dialog.status} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === 'delete' && <DeleteDialog user={dialog.user} onClose={() => setDialog(null)} onDone={done} onDeactivate={() => setDialog({ kind: 'status', user: dialog.user, status: 'deactivated' })} />}
      {dialog?.kind === 'history' && <HistoryDialog user={dialog.user} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'password' && <PasswordManager user={dialog.user} onClose={() => setDialog(null)} onDone={load} />}
      {dialog?.kind === 'add' && <AddToTeamDialog team={dialog.team} users={users} onClose={() => setDialog(null)}
        onExisting={(u) => setDialog({ kind: 'move', user: u, presetLeader: lc(dialog.team.leader.email) })}
        onNew={() => setDialog({ kind: 'new', presetLeader: lc(dialog.team.leader.email) })} />}
      {dialog?.kind === 'rename' && <RenameDialog team={dialog.team} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === 'created' && (
        <Modal title="Account created" onClose={() => setDialog(null)}>
          <div className="mb">
            <p style={{ fontSize: '.86rem', marginTop: 0 }}>Pass these on to <strong>{dialog.created.name}</strong>. The password is shown this once.</p>
            <div style={{ background: 'rgba(39,174,96,.08)', border: '1px solid rgba(39,174,96,.3)', borderRadius: 10, padding: 14, fontSize: '.9rem' }}>
              <div><strong>User:</strong> {dialog.created.email}</div>
              <div><strong>Password:</strong> <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{dialog.created.password}</span></div>
            </div>
          </div>
          <div className="mf"><button className="btn bp" onClick={() => setDialog(null)}>Done</button></div>
        </Modal>
      )}
    </>
  );
}

function RenameDialog({ team, onClose, onDone }) {
  const { toast } = useToast();
  const [name, setName] = useState(team.leader.teamName || team.label);
  const go = async () => {
    try { await apiPatch('/auth/users/' + team.leader.id, { teamName: name.trim() }); toast('Team renamed'); onDone(); }
    catch (err) { toast(err.message, 'er'); }
  };
  return (
    <Modal title="Rename the team" onClose={onClose}>
      <div className="mb"><div className="fg"><label>Team name</label><input className="fi" value={name} onChange={e => setName(e.target.value)} autoFocus /></div></div>
      <div className="mf"><button className="btn bo" onClick={onClose}>Cancel</button><button className="btn bp" onClick={go}>Save</button></div>
    </Modal>
  );
}
