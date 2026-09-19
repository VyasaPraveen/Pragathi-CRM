import React, { useState } from 'react';
import { apiPost, apiPatch } from '../services/api';
import { useToast } from '../context/ToastContext';
import { Modal } from './SharedUI';
import { DESIGNATIONS, sendWhatsApp } from '../services/helpers';

// Stored passwords are one-way bcrypt hashes — not even the database holds the
// text of an existing password, so no screen can show it. What an Admin can do
// is set a new one, and see that one while it is on screen.
export const PASSWORD_NOTE =
  'Saved passwords are encrypted one-way and cannot be read back — not by an ' +
  'Admin, not from the database. Set a new one here and it is shown once so you ' +
  'can pass it on.';

// A readable password: no letters or digits that get misread over the phone.
export function generatePassword(len = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = 'Pps';
  const rnd = (typeof crypto !== 'undefined' && crypto.getRandomValues)
    ? (n) => { const a = new Uint32Array(n); crypto.getRandomValues(a); return a; }
    : (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 4294967296));
  const vals = rnd(Math.max(1, len - 3));
  for (let i = 0; i < len - 3; i++) out += chars[vals[i] % chars.length];
  return out;
}

const copy = async (text, toast) => {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    }
    toast('Copied');
  } catch { toast('Could not copy — select the text and copy it by hand', 'er'); }
};

/* ============================================================================
   Set or reset a login password. `user` is an existing account, or pass
   `createFor` = { name, email, phone, designation } to create the login first.
   ========================================================================== */
export default function PasswordManager({ user, createFor, onClose, onDone }) {
  const { toast } = useToast();
  const creating = !user && !!createFor;
  const [pwd, setPwd] = useState(generatePassword());
  const [email, setEmail] = useState(createFor?.email || user?.email || '');
  const [designation, setDesignation] = useState(createFor?.designation || 'Technician');
  const [show, setShow] = useState(true);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(null);      // the password that was just set

  const who = user?.displayName || user?.email || createFor?.name || 'this person';
  const phone = user?.phone || createFor?.phone || '';

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    if (pwd.trim().length < 6) { toast('Password must be at least 6 characters', 'er'); return; }
    if (creating && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email.trim())) {
      toast('Enter a valid email address for the login', 'er'); return;
    }
    setSaving(true);
    try {
      if (creating) {
        await apiPost('/auth/users', {
          email: email.trim().toLowerCase(),
          password: pwd.trim(),
          displayName: createFor.name || '',
          phone: createFor.phone || '',
          designation,
          approved: true,
        });
        toast('Login created');
      } else {
        await apiPatch('/auth/users/' + user.id, { password: pwd.trim() });
        toast('Password changed');
      }
      setDone(pwd.trim());
      if (onDone) onDone();
    } catch (err) {
      toast(err.message || 'Could not save', 'er');
    } finally { setSaving(false); }
  };

  // After saving — the one moment the password can be shown.
  if (done) {
    const line = `Pragathi CRM login\nURL: ${window.location.origin}\nUser: ${email}\nPassword: ${done}\n\nPlease change it after signing in.`;
    return (
      <Modal title={creating ? 'Login created' : 'Password changed'} onClose={onClose}>
        <div className="mb">
          <p style={{ fontSize: '.88rem', marginTop: 0 }}>
            {creating ? 'The login for' : 'The new password for'} <strong>{who}</strong> is ready.
          </p>
          <div style={{ background: 'rgba(39,174,96,.08)', border: '1px solid rgba(39,174,96,.3)', borderRadius: 10, padding: 14 }}>
            <div style={{ fontSize: '.74rem', color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>Email</div>
            <div style={{ fontSize: '.95rem', fontWeight: 600, marginBottom: 10, wordBreak: 'break-all' }}>{email}</div>
            <div style={{ fontSize: '.74rem', color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>Password</div>
            <div style={{ fontSize: '1.15rem', fontWeight: 700, letterSpacing: '.5px', fontFamily: 'monospace' }}>{done}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <button type="button" className="btn bsm bo" onClick={() => copy(done, toast)}>
              <span className="material-icons-round" style={{ fontSize: 16 }}>content_copy</span> Copy password
            </button>
            <button type="button" className="btn bsm bo" onClick={() => copy(line, toast)}>
              <span className="material-icons-round" style={{ fontSize: 16 }}>assignment</span> Copy full details
            </button>
            {phone && (
              <button type="button" className="btn bsm bo" style={{ color: '#25d366', borderColor: 'rgba(37,211,102,.3)' }}
                onClick={() => sendWhatsApp(phone, line)}>
                <span className="material-icons-round" style={{ fontSize: 16 }}>chat</span> Send on WhatsApp
              </button>
            )}
          </div>
          <p style={{ fontSize: '.8rem', color: '#d68910', marginBottom: 0 }}>
            <span className="material-icons-round" style={{ fontSize: 15, verticalAlign: 'middle', marginRight: 4 }}>info</span>
            Copy it now — once this closes it cannot be shown again. You can always set a new one.
          </p>
        </div>
        <div className="mf"><button className="btn bp" onClick={onClose}>Done</button></div>
      </Modal>
    );
  }

  return (
    <Modal title={creating ? `Create login — ${who}` : `Set password — ${who}`} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="mb">
          <p style={{ fontSize: '.82rem', color: 'var(--muted)', marginTop: 0 }}>{PASSWORD_NOTE}</p>

          <div className="fg">
            <label>Email (the login)</label>
            <input className="fi" value={email} onChange={e => setEmail(e.target.value)}
              readOnly={!creating} style={creating ? {} : { background: '#f5f6f8' }}
              placeholder="name@example.com" />
            {!creating && <small style={{ fontSize: '.74rem', color: 'var(--muted)' }}>Change the email in Edit User.</small>}
          </div>

          {creating && (
            <div className="fg">
              <label>Designation</label>
              <select className="fi" value={designation} onChange={e => setDesignation(e.target.value)}>
                {DESIGNATIONS.map(d => <option key={d.label} value={d.label}>{d.label}</option>)}
              </select>
            </div>
          )}

          <div className="fg">
            <label>{creating ? 'Password' : 'New password'} *</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="fi" type={show ? 'text' : 'password'} value={pwd}
                onChange={e => setPwd(e.target.value)} autoComplete="new-password" minLength={6} required />
              <button type="button" className="btn bsm bo" title={show ? 'Hide' : 'Show'} onClick={() => setShow(s => !s)}>
                <span className="material-icons-round" style={{ fontSize: 18 }}>{show ? 'visibility_off' : 'visibility'}</span>
              </button>
              <button type="button" className="btn bsm bo" title="Generate a new one" onClick={() => { setPwd(generatePassword()); setShow(true); }}>
                <span className="material-icons-round" style={{ fontSize: 18 }}>autorenew</span>
              </button>
            </div>
            <small style={{ fontSize: '.74rem', color: 'var(--muted)' }}>At least 6 characters. You can type your own.</small>
          </div>
        </div>
        <div className="mf">
          <button type="button" className="btn bo" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn bp" disabled={saving}>
            {saving ? 'Saving…' : (creating ? 'Create login' : 'Change password')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
