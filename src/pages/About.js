import React, { useState } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { apiPatch } from '../services/api';
import { Modal } from '../components/SharedUI';

// ============================================================================
// About — the company page. Req 3 (4-Nov): the Owner, Operation Manager,
// Management and Admin may edit its text and figures; the change is saved in
// the company settings (`about`) and shows for everyone. Anything not edited
// keeps the value it always had: the two counts come from the records unless
// a figure is typed over them.
// ============================================================================

export const ABOUT_EDITOR_ROLES = ['super_admin', 'operation_manager', 'management', 'admin'];

export const ABOUT_DEFAULTS = {
  company: 'Pragathi Power Solutions',
  tagline: 'Power from the Sun... To Power Every One',
  since: 'Since 2012 | Tirupati, Andhra Pradesh',
  vision: 'To be the leading solar energy provider in Andhra Pradesh.',
  mission: 'Deliver high-quality, affordable solar power solutions with exceptional service.',
  statClients: '',        // blank = the live count of customers
  statClientsLabel: 'Happy Clients',
  statInstalls: '',       // blank = the live count of installations
  statInstallsLabel: 'Installations',
  statYears: '10+',
  statYearsLabel: 'Years',
  statTeam: '',           // blank = the live team count
  statTeamLabel: 'Team',
};

// The page's content: the saved text over the defaults.
export function aboutContent(settings) {
  const saved = (settings && settings.about) || {};
  const out = { ...ABOUT_DEFAULTS };
  Object.keys(ABOUT_DEFAULTS).forEach(k => { if (saved[k] !== undefined && saved[k] !== null) out[k] = String(saved[k]); });
  return out;
}

export default function About() {
  const { customers, installations, team, settings } = useData();
  const { role } = useAuth();
  const [editing, setEditing] = useState(false);
  const c = aboutContent(settings);
  const canEdit = ABOUT_EDITOR_ROLES.includes(role);
  const stats = [
    { val: c.statClients || customers.length + '+', label: c.statClientsLabel, bg: 'rgba(26,58,122,.04)', color: 'var(--pri)' },
    { val: c.statInstalls || installations.length + '+', label: c.statInstallsLabel, bg: 'rgba(232,131,12,.06)', color: 'var(--sec)' },
    { val: c.statYears, label: c.statYearsLabel, bg: 'rgba(0,184,148,.06)', color: 'var(--ok)' },
    { val: c.statTeam || team.length + '+', label: c.statTeamLabel, bg: 'rgba(142,68,173,.06)', color: '#8e44ad' },
  ];
  return (
    <>
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="cb" style={{ textAlign: 'center', padding: 40, position: 'relative' }}>
          {canEdit && (
            <button className="btn bsm bo" onClick={() => setEditing(true)} style={{ position: 'absolute', top: 12, right: 12 }} title="Edit the About page">
              <span className="material-icons-round" style={{ fontSize: 16 }}>edit</span> Edit
            </button>
          )}
          <img src="/logo.png" alt="PPS" style={{ height: 64, marginBottom: 14 }} onError={e => e.target.style.display = 'none'} />
          <h2 style={{ fontSize: '1.5rem', color: 'var(--pri)', marginBottom: 6 }}>{c.company}</h2>
          <p style={{ color: 'var(--sec)', fontWeight: 600, fontSize: '1rem', marginBottom: 6 }}>{c.tagline}</p>
          <p style={{ color: 'var(--muted)', fontSize: '.88rem' }}>{c.since}</p>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 18 }}>
        <div className="card"><div className="ch"><h3>Vision &amp; Mission</h3></div><div className="cb">
          <p style={{ fontSize: '.9rem', lineHeight: 1.7, whiteSpace: 'pre-line' }}><strong>Vision:</strong> {c.vision}<br /><br /><strong>Mission:</strong> {c.mission}</p>
        </div></div>
        <div className="card"><div className="ch"><h3>Quick Stats</h3></div><div className="cb">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {stats.map((s, i) => (
              <div key={i} style={{ textAlign: 'center', padding: 14, background: s.bg, borderRadius: 'var(--rs)' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: s.color }}>{s.val}</div>
                <div style={{ fontSize: '.8rem', color: 'var(--muted)' }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div></div>
      </div>
      {editing && <AboutEditor content={c} live={{ clients: customers.length + '+', installs: installations.length + '+', team: team.length + '+' }} onClose={() => setEditing(false)} />}
    </>
  );
}

function AboutEditor({ content, live, onClose }) {
  const { toast } = useToast();
  const [f, setF] = useState({ ...content });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      // Only what differs from the defaults is stored; a field put back to its
      // default is stored as blank so the default shows again.
      const about = {};
      Object.keys(ABOUT_DEFAULTS).forEach(k => { about[k] = f[k] === ABOUT_DEFAULTS[k] ? '' : (f[k] || ''); });
      await apiPatch('/settings', { about });
      window.dispatchEvent(new Event('pps:refresh'));
      toast('About page saved');
      onClose();
    } catch (err) { toast('Failed: ' + err.message, 'er'); }
    setSaving(false);
  };
  const reset = () => { if (window.confirm('Put every field back to the built-in text?')) setF({ ...ABOUT_DEFAULTS }); };
  const Stat = ({ valueKey, labelKey, liveValue }) => (
    <div className="fr">
      <div className="fg"><label>{f[labelKey] || 'Figure'}{liveValue ? <span style={{ fontSize: '.72rem', color: 'var(--muted)', fontWeight: 400 }}> (blank = live count, now {liveValue})</span> : ''}</label><input className="fi" value={f[valueKey]} onChange={e => set(valueKey, e.target.value)} placeholder={liveValue || ''} /></div>
      <div className="fg"><label>Label</label><input className="fi" value={f[labelKey]} onChange={e => set(labelKey, e.target.value)} /></div>
    </div>
  );
  return (
    <Modal title="Edit About Page" onClose={onClose} wide>
      <form onSubmit={save}>
        <div className="mb" style={{ maxHeight: '65vh', overflowY: 'auto' }}>
          <div className="fg"><label>Company name</label><input className="fi" value={f.company} onChange={e => set('company', e.target.value)} /></div>
          <div className="fg"><label>Tagline</label><input className="fi" value={f.tagline} onChange={e => set('tagline', e.target.value)} /></div>
          <div className="fg"><label>Since / location line</label><input className="fi" value={f.since} onChange={e => set('since', e.target.value)} placeholder="Since 2021 | Tirupati, Andhra Pradesh" /></div>
          <div className="fg"><label>Vision</label><textarea className="fi" rows={2} value={f.vision} onChange={e => set('vision', e.target.value)} /></div>
          <div className="fg"><label>Mission</label><textarea className="fi" rows={2} value={f.mission} onChange={e => set('mission', e.target.value)} /></div>
          <div style={{ fontWeight: 700, fontSize: '.86rem', color: 'var(--pri)', margin: '12px 0 8px', paddingBottom: 4, borderBottom: '1px solid var(--bor)' }}>Quick Stats</div>
          <Stat valueKey="statClients" labelKey="statClientsLabel" liveValue={live.clients} />
          <Stat valueKey="statInstalls" labelKey="statInstallsLabel" liveValue={live.installs} />
          <Stat valueKey="statYears" labelKey="statYearsLabel" />
          <Stat valueKey="statTeam" labelKey="statTeamLabel" liveValue={live.team} />
        </div>
        <div className="mf">
          <button type="button" className="btn bo" onClick={reset} disabled={saving}>Reset to defaults</button>
          <button type="button" className="btn bo" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn bp" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}
