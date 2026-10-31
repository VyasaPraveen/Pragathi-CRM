import React, { useMemo, useState } from 'react';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { apiPatch } from '../services/api';
import { roleLabel, leadAssignees } from '../services/permissions';
import { CUSTOMER_TABS, ACCESS, ACCESS_LABEL, assignedLeadAccess } from '../services/customerAccess';
import { WORKFLOW_STAGES } from '../services/workflow';

// ============================================================================
// Settings → Customer & Workflow Access (Owner only; Req 1.24, 31-Oct).
//
// The Owner picks an employee — a real account, with their role and the number
// of leads assigned to them — and sets, for each of the eleven Customer tabs
// and each of the eighteen workflow stages, whether that person may Edit it,
// View it, or not see it at all. "Default" leaves the role's own rule in place.
// Saved on the user record as permissions.customerTabs / customerStages and
// enforced in the Customers section (customerAccess.js).
//
// Below that, one company-wide switch: what the person a lead is ASSIGNED to
// gets on the customer made from it — Edit, View only or No access.
// ============================================================================

const CHOICES = [
  { value: '', label: 'Default' },
  { value: ACCESS.EDIT, label: 'Edit' },
  { value: ACCESS.VIEW, label: 'View only' },
  { value: ACCESS.NONE, label: 'No access' },
];
const TONE = { '': 'var(--muted)', edit: '#1e8449', view: '#b7791f', none: '#c0392b' };

const lc = (v) => String(v || '').trim().toLowerCase();

// One row's four-way choice. Kept outside the editor so it is not re-created
// on every render.
function Choice({ value, onChange, name }) {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }} role="radiogroup" aria-label={name}>
      {CHOICES.map(c => (
        <button key={c.value || 'default'} type="button" onClick={() => onChange(c.value)}
          data-choice={c.value || 'default'} aria-pressed={(value || '') === c.value}
          style={{ padding: '3px 9px', borderRadius: 12, fontSize: '.72rem', fontWeight: 600, cursor: 'pointer',
            border: `1px solid ${(value || '') === c.value ? TONE[c.value] : 'var(--bor)'}`,
            background: (value || '') === c.value ? `${TONE[c.value]}1a` : '#fff', color: (value || '') === c.value ? TONE[c.value] : 'var(--muted)' }}>
          {c.label}
        </button>
      ))}
    </div>
  );
}

export default function CustomerAccessEditor({ users, onUserSaved, settings, onSettingsSaved }) {
  const { leads } = useData();
  const { toast } = useToast();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);
  const [tabs, setTabs] = useState({});
  const [stages, setStages] = useState({});
  const [saving, setSaving] = useState(false);
  const [leadMode, setLeadMode] = useState(assignedLeadAccess(settings));
  const [leadSaving, setLeadSaving] = useState(false);

  // The employees: every approved account but the Owner's own, with the leads
  // assigned to each (by name or email, as the lead carries it).
  const people = useMemo(() => (users || [])
    .filter(u => u.approved !== false && u.role !== 'super_admin')
    .map(u => {
      const keys = [lc(u.displayName), lc(u.email)].filter(Boolean);
      const assigned = (leads || []).filter(l => leadAssignees(l).some(a => keys.includes(a))).length;
      return { ...u, assigned };
    })
    .sort((a, b) => String(a.displayName || a.email).localeCompare(String(b.displayName || b.email))), [users, leads]);
  const shown = people.filter(p => !q || lc(p.displayName).includes(lc(q)) || lc(p.email).includes(lc(q)) || lc(roleLabel(p.role)).includes(lc(q)));

  const pick = (u) => {
    setSel(u);
    setTabs({ ...((u.permissions && u.permissions.customerTabs) || {}) });
    setStages({ ...((u.permissions && u.permissions.customerStages) || {}) });
  };
  const setAllTabs = (v) => setTabs(Object.fromEntries(CUSTOMER_TABS.map(t => [t.key, v])));
  const setAllStages = (v) => setStages(Object.fromEntries(WORKFLOW_STAGES.map(s => [s.key, v])));
  const clean = (bag) => Object.fromEntries(Object.entries(bag).filter(([, v]) => v === 'edit' || v === 'view' || v === 'none'));
  const summary = (u) => {
    const t = clean((u.permissions && u.permissions.customerTabs) || {});
    const s = clean((u.permissions && u.permissions.customerStages) || {});
    const n = Object.keys(t).length + Object.keys(s).length;
    return n ? `${Object.keys(t).length} tab${Object.keys(t).length === 1 ? '' : 's'}, ${Object.keys(s).length} stage${Object.keys(s).length === 1 ? '' : 's'} set` : 'role defaults';
  };

  const save = async () => {
    if (!sel) return;
    setSaving(true);
    try {
      const permissions = { ...(sel.permissions || {}), customerTabs: clean(tabs), customerStages: clean(stages) };
      await apiPatch('/auth/users/' + sel.id, { permissions });
      const updated = { ...sel, permissions };
      setSel(updated);
      onUserSaved && onUserSaved(updated);
      toast(`Customer access saved for ${sel.displayName || sel.email}`);
    } catch (e) { toast('Failed: ' + e.message, 'er'); }
    setSaving(false);
  };

  const saveLeadMode = async (v) => {
    setLeadSaving(true);
    try {
      await apiPatch('/settings', { assignedLeadAccess: v });
      setLeadMode(v);
      onSettingsSaved && onSettingsSaved({ ...(settings || {}), assignedLeadAccess: v });
      toast(`Assigned lead person: ${ACCESS_LABEL[v]} on their customers`);
    } catch (e) { toast('Failed: ' + e.message, 'er'); }
    setLeadSaving(false);
  };

  return (
    <div data-ca="root">
      <p style={{ fontSize: '.86rem', color: 'var(--muted)', lineHeight: 1.6, marginBottom: 12 }}>
        Who may <strong>view</strong> and who may <strong>edit</strong> each Customer tab and each of the 18 workflow stages, person by person.
        <strong> Default</strong> keeps the role's own rule. Tab access and stage access are set independently. The Owner is never restricted.
      </p>

      {/* The assigned lead person, company-wide */}
      <div style={{ border: '1px solid var(--bor)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, background: 'var(--bg)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontWeight: 700, fontSize: '.84rem' }}>Assigned Lead Person</div>
          <div style={{ fontSize: '.76rem', color: 'var(--muted)' }}>What the person a lead is assigned to gets on the customer made from it, whoever that person is. Their own per-stage settings above still apply on top.</div>
        </div>
        <select className="fi" style={{ width: 'auto' }} value={leadMode} disabled={leadSaving} onChange={e => saveLeadMode(e.target.value)} data-ca="lead-mode">
          <option value="edit">Edit access</option>
          <option value="view">View only</option>
          <option value="none">No access</option>
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 300px) 1fr', gap: 18 }} className="ca-grid">
        {/* Employee list */}
        <div style={{ borderRight: '1px solid var(--bor)', paddingRight: 14, minWidth: 0 }}>
          <input className="fi" placeholder="Search employee or role…" value={q} onChange={e => setQ(e.target.value)} style={{ marginBottom: 8 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 420, overflowY: 'auto' }}>
            {shown.map(u => (
              <div key={u.id} onClick={() => pick(u)} data-ca="person" style={{
                padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                background: sel?.id === u.id ? 'rgba(26,58,122,.08)' : 'transparent',
                border: sel?.id === u.id ? '1px solid var(--pri)' : '1px solid transparent',
              }}>
                <div style={{ fontSize: '.84rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.displayName || u.email}</div>
                <div style={{ fontSize: '.72rem', color: 'var(--muted)', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span>{u.designation || roleLabel(u.role)}</span>
                  <span>· {u.assigned} lead{u.assigned === 1 ? '' : 's'} assigned</span>
                  <span>· {summary(u)}</span>
                </div>
              </div>
            ))}
            {!shown.length && <p style={{ color: 'var(--muted)', fontSize: '.84rem' }}>No employee matches.</p>}
          </div>
        </div>

        {/* The settings for one person */}
        <div style={{ minWidth: 0 }}>
          {!sel ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 200, color: 'var(--muted)' }}>
              <span className="material-icons-round" style={{ fontSize: 44, marginBottom: 8 }}>manage_accounts</span>
              <p style={{ fontSize: '.9rem' }}>Select an employee to set their customer access</p>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                <div>
                  <h4 style={{ margin: 0, fontSize: '1rem' }}>{sel.displayName || sel.email}</h4>
                  <p style={{ margin: '2px 0 0', fontSize: '.78rem', color: 'var(--muted)' }}>{sel.designation || roleLabel(sel.role)} · {sel.email} · assigned lead person on {sel.assigned} lead{sel.assigned === 1 ? '' : 's'}</p>
                </div>
                <button className="btn bp bsm" onClick={save} disabled={saving} data-ca="save">
                  <span className="material-icons-round" style={{ fontSize: 15 }}>save</span> {saving ? 'Saving…' : 'Save access'}
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                <strong style={{ fontSize: '.84rem' }}>Customer tabs</strong>
                <span style={{ fontSize: '.72rem', color: 'var(--muted)' }}>set all:</span>
                {CHOICES.map(c => <button key={c.value || 'd'} type="button" className="btn bsm bo" style={{ padding: '2px 8px', fontSize: '.7rem' }} onClick={() => setAllTabs(c.value)}>{c.label}</button>)}
              </div>
              <div className="tw"><table data-ca="tabs"><tbody>
                {CUSTOMER_TABS.map(t => (
                  <tr key={t.key}>
                    <td style={{ fontSize: '.82rem', fontWeight: 600, whiteSpace: 'nowrap' }}><span className="material-icons-round" style={{ fontSize: 15, verticalAlign: '-3px', marginRight: 6, color: t.color }}>{t.icon}</span>{t.label}</td>
                    <td><Choice name={t.label} value={tabs[t.key]} onChange={v => setTabs(p => ({ ...p, [t.key]: v }))} /></td>
                  </tr>
                ))}
              </tbody></table></div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '14px 0 6px' }}>
                <strong style={{ fontSize: '.84rem' }}>Workflow stages</strong>
                <span style={{ fontSize: '.72rem', color: 'var(--muted)' }}>set all:</span>
                {CHOICES.map(c => <button key={c.value || 'd'} type="button" className="btn bsm bo" style={{ padding: '2px 8px', fontSize: '.7rem' }} onClick={() => setAllStages(c.value)}>{c.label}</button>)}
              </div>
              <div className="tw"><table data-ca="stages"><tbody>
                {WORKFLOW_STAGES.map(s => (
                  <tr key={s.key}>
                    <td style={{ fontSize: '.82rem', fontWeight: 600, whiteSpace: 'nowrap' }}>Stage {s.sno} – {s.title}{s.auto && <span style={{ fontSize: '.68rem', color: 'var(--muted)', fontWeight: 400 }}> (automatic)</span>}</td>
                    <td><Choice name={s.title} value={stages[s.key]} onChange={v => setStages(p => ({ ...p, [s.key]: v }))} /></td>
                  </tr>
                ))}
              </tbody></table></div>
              <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn bp" onClick={save} disabled={saving} style={{ padding: '8px 20px', fontSize: '.86rem' }}>
                  <span className="material-icons-round" style={{ fontSize: 16 }}>save</span> {saving ? 'Saving…' : 'Save access'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
