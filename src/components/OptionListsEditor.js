import React, { useState } from 'react';
import { apiPatch } from '../services/api';
import { useToast } from '../context/ToastContext';
import { OPTION_LISTS, getOptions, isCustomised, isLocked, validateOptionList } from '../services/options';

/* ============================================================================
   Settings → Manage Options.
   Lets an Admin add, rename, reorder or remove the choices in the CRM's
   dropdowns without a code change. A list nobody has touched shows the built-in
   defaults; "Restore defaults" puts a list back to those.
   ========================================================================== */
export default function OptionListsEditor({ settings, onSaved }) {
  const { toast } = useToast();
  const [openKey, setOpenKey] = useState(OPTION_LISTS[0]?.key || '');
  const [draft, setDraft] = useState(null);      // { key, list } while editing
  const [newValue, setNewValue] = useState('');
  const [saving, setSaving] = useState(false);

  const meta = OPTION_LISTS.find(l => l.key === openKey);
  const saved = meta ? getOptions(settings, meta.key) : [];
  const list = draft && draft.key === openKey ? draft.list : saved;
  const dirty = !!(draft && draft.key === openKey && JSON.stringify(draft.list) !== JSON.stringify(saved));

  const edit = (next) => setDraft({ key: openKey, list: next });

  const open = (key) => { setOpenKey(key); setDraft(null); setNewValue(''); };

  const add = () => {
    const v = newValue.trim();
    setNewValue('');
    if (!v) return;
    if (list.some(x => x.toLowerCase() === v.toLowerCase())) { toast(`"${v}" is already on the list`, 'er'); return; }
    edit([...list, v]);
  };

  const rename = (i, v) => edit(list.map((x, j) => (j === i ? v : x)));

  const remove = (i) => {
    if (isLocked(openKey, list[i])) {
      toast(`"${list[i]}" cannot be removed — ${meta.lockedNote || 'other screens depend on it.'}`, 'er');
      return;
    }
    edit(list.filter((_, j) => j !== i));
  };

  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    edit(next);
  };

  const save = async () => {
    const check = validateOptionList(openKey, list);
    if (!check.ok) { toast(check.error, 'er'); return; }
    setSaving(true);
    try {
      const next = { ...(settings?.optionLists || {}), [openKey]: check.list };
      await apiPatch('/settings', { optionLists: next });
      toast(`${meta.label} saved — the change is live for everyone`);
      setDraft(null);
      if (onSaved) onSaved({ ...settings, optionLists: next });
    } catch (err) { toast('Could not save: ' + err.message, 'er'); }
    setSaving(false);
  };

  const restore = async () => {
    if (!window.confirm(`Put "${meta.label}" back to the built-in list? Anything you added to it is removed.`)) return;
    setSaving(true);
    try {
      const next = { ...(settings?.optionLists || {}) };
      delete next[openKey];
      await apiPatch('/settings', { optionLists: next });
      toast(`${meta.label} restored to the built-in list`);
      setDraft(null);
      if (onSaved) onSaved({ ...settings, optionLists: next });
    } catch (err) { toast('Could not save: ' + err.message, 'er'); }
    setSaving(false);
  };

  if (!meta) return null;

  return (
    <div>
      <p style={{ fontSize: '.86rem', color: 'var(--muted)', lineHeight: 1.6, marginTop: 0, marginBottom: 12 }}>
        The choices in the CRM's dropdowns. Add your own, rename or reorder them, and the change appears
        for everyone straight away. Existing records keep whatever they already hold, even if you take
        that choice off the list.
      </p>

      {/* Which list */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {OPTION_LISTS.map(l => (
          <span key={l.key} className={`fc ${openKey === l.key ? 'act' : ''}`} onClick={() => open(l.key)}>
            {l.label}{isCustomised(settings, l.key) ? ' •' : ''}
          </span>
        ))}
      </div>

      <div style={{ border: '1px solid var(--bor)', borderRadius: 10, padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          <div>
            <strong style={{ fontSize: '.92rem' }}>{meta.label}</strong>
            <div style={{ fontSize: '.76rem', color: 'var(--muted)' }}>Used in: {meta.where}</div>
          </div>
          <span style={{ fontSize: '.74rem', color: isCustomised(settings, meta.key) ? 'var(--pri)' : 'var(--muted)' }}>
            {isCustomised(settings, meta.key) ? 'Customised' : 'Built-in list'}
          </span>
        </div>

        {meta.note && <p style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: 0 }}>{meta.note}</p>}

        {/* The values */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          {list.map((v, i) => {
            const locked = isLocked(meta.key, v);
            return (
              <div key={`${meta.key}-${i}`} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: '.76rem', color: 'var(--muted)', width: 22, textAlign: 'right' }}>{i + 1}.</span>
                <input className="fi" value={v} onChange={e => rename(i, e.target.value)} style={{ flex: 1 }} />
                <button type="button" className="btn bsm bo" title="Move up" onClick={() => move(i, -1)} disabled={i === 0} style={{ padding: '4px 8px' }}>
                  <span className="material-icons-round" style={{ fontSize: 16 }}>arrow_upward</span>
                </button>
                <button type="button" className="btn bsm bo" title="Move down" onClick={() => move(i, 1)} disabled={i === list.length - 1} style={{ padding: '4px 8px' }}>
                  <span className="material-icons-round" style={{ fontSize: 16 }}>arrow_downward</span>
                </button>
                <button type="button" className="btn bsm bo" title={locked ? 'Required by other screens' : 'Remove'}
                  onClick={() => remove(i)} disabled={locked}
                  style={{ padding: '4px 8px', color: locked ? 'var(--muted)' : 'var(--err)', borderColor: locked ? 'var(--bor)' : 'rgba(231,76,60,.3)' }}>
                  <span className="material-icons-round" style={{ fontSize: 16 }}>{locked ? 'lock' : 'delete'}</span>
                </button>
              </div>
            );
          })}
        </div>

        {/* Add one */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          <input className="fi" value={newValue} onChange={e => setNewValue(e.target.value)}
            placeholder={`Add another ${meta.label.toLowerCase()} option...`}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
          <button type="button" className="btn bsm bo" onClick={add}>
            <span className="material-icons-round" style={{ fontSize: 16 }}>add</span> Add
          </button>
        </div>

        {meta.locked?.length > 0 && (
          <p style={{ fontSize: '.76rem', color: 'var(--muted)', marginTop: 0 }}>
            <span className="material-icons-round" style={{ fontSize: 14, verticalAlign: 'middle', marginRight: 3 }}>lock</span>
            {meta.locked.join(', ')} cannot be removed — {meta.lockedNote}
          </p>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn bp" onClick={save} disabled={!dirty || saving} style={{ padding: '8px 20px', fontSize: '.86rem' }}>
            {saving ? <><span className="ssm"></span> Saving...</> : <><span className="material-icons-round" style={{ fontSize: 16 }}>save</span> Save {meta.label}</>}
          </button>
          {dirty && (
            <button type="button" className="btn bo" onClick={() => setDraft(null)} disabled={saving} style={{ padding: '8px 20px', fontSize: '.86rem' }}>
              Discard changes
            </button>
          )}
          {isCustomised(settings, meta.key) && (
            <button type="button" className="btn bo" onClick={restore} disabled={saving} style={{ padding: '8px 20px', fontSize: '.86rem' }}>
              <span className="material-icons-round" style={{ fontSize: 16 }}>restart_alt</span> Restore defaults
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
