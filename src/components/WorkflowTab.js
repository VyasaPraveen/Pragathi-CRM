import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { updateDocument } from '../services/firestore';
import { apiUpload } from '../services/api';
import { hasAccess, formatDate, isSafeUrl, compressImage } from '../services/helpers';
import {
  TOTAL_STAGES, getWorkflowView, completedCount,
  isStageComplete, isFieldSatisfied, photoList, listValue, withStage, reopenedWorkflow,
} from '../services/workflow';
import { stageAccess, stagesUnrestricted, ACCESS } from '../services/customerAccess';
import { stageSourceNote } from '../services/customerWorkflow';
import { recordPhotoDeletion } from '../services/customerSync';

// ============================================================================
// The 18-stage workflow on a customer (31-Oct rewrite).
//
//  - One stage is open for editing at a time: the current stage by default.
//    The Owner may open ANY stage — locked, current or completed — and edit
//    or complete it without the ones before (Req 1.5). Everyone else keeps
//    the sequence (Req 1.6).
//  - Who may edit a given stage is decided per stage (customerAccess.js):
//    the Owner's per-person settings first, then the role rules.
//  - Photo fields hold several photos, each with its own Change and Delete;
//    a deletion is logged and the Owner is told (Req 1.151).
//  - Reopening a stage takes its tick off and nothing else: the data of every
//    other stage stays exactly as it was (Req 1.23).
// ============================================================================

const MAX_UPLOAD = 10 * 1024 * 1024;
const PHOTO_TYPES = ['photo', 'docs'];

// Seed a stage's form: saved data over blanks, with a few sensible prefills.
function prefill(stage, customer) {
  if (!stage) return {};
  const base = {};
  (stage.fields || []).forEach(f => { base[f.key] = f.type === 'checkbox' ? false : (PHOTO_TYPES.includes(f.type) || f.type === 'list' ? [] : ''); });
  if (stage.key === 'advance') base.advanceAmount = customer.advanceReceivedAmount || customer.advanceAmount || '';
  if (stage.key === 'finalPayment') base.finalPaymentAmount = customer.finalAmount || customer.finalPayment || '';
  const saved = customer.workflow?.stages?.[stage.key] || {};
  const form = { ...base, ...saved };
  (stage.fields || []).forEach(f => {
    if (PHOTO_TYPES.includes(f.type)) form[f.key] = photoList(form[f.key]);
    if (f.type === 'list') form[f.key] = listValue(form[f.key]);
  });
  return form;
}

// The photos a save takes off a stage, field by field.
function removedPhotos(stage, before, after) {
  const out = [];
  (stage.fields || []).filter(f => PHOTO_TYPES.includes(f.type)).forEach(f => {
    const was = photoList(before[f.key]);
    const now = new Set(photoList(after[f.key]).map(p => p.url));
    const gone = was.filter(p => !now.has(p.url));
    if (gone.length) out.push({ fieldKey: f.key, photos: gone });
  });
  return out;
}

const STATUS_ICON = { completed: 'check_circle', current: 'radio_button_checked', locked: 'lock' };
const STATUS_COLOR = { completed: '#10b981', current: '#7c3aed', locked: '#9ca3af' };

export default function WorkflowTab({ customer, canEdit }) {
  const { user, role } = useAuth();
  const { users, leads, settings } = useData();
  const { toast } = useToast();
  const isAdmin = hasAccess(role, 'admin');
  const free = stagesUnrestricted(role);                  // the Owner
  const meName = user?.displayName || user?.email || 'unknown';
  const lead = (leads || []).find(l => l.id === customer.leadId) || null;
  const ctx = { customer, lead, user, role, users, settings };

  const view = getWorkflowView(customer);
  const current = view.find(s => s.status === 'current');
  const done = completedCount(customer);

  const [editingKey, setEditingKey] = useState(current ? current.key : null);
  const [form, setForm] = useState(() => prefill(current, customer));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [openCompleted, setOpenCompleted] = useState(null);

  // Follow the current stage when it changes (e.g. after completing one).
  // Keying on the derived stage — not workflow.currentStage — avoids wiping
  // in-progress keystrokes when the first "Save Progress" sets currentStage.
  const currentKey = current ? current.key : null;
  useEffect(() => {
    setEditingKey(currentKey);
    setForm(prefill(current, customer));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer.id, currentKey]);

  const editing = view.find(s => s.key === editingKey) || null;
  const openForEdit = (stage) => { setEditingKey(stage.key); setForm(prefill(stage, customer)); setOpenCompleted(null); };
  const setField = (k, v) => setForm(p => ({ ...p, [k]: v }));

  // Photos: uploaded to the server (images shrunk first), kept as { url, name, at, by }.
  const addPhotos = async (fieldKey, files) => {
    const list = Array.from(files || []).filter(Boolean);
    if (!list.length) return;
    setUploading(true);
    try {
      const added = [];
      for (const file of list) {
        if (file.size > MAX_UPLOAD) { toast(`${file.name} is over 10 MB`, 'er'); continue; }
        const small = await compressImage(file, 1600, 0.82);
        const up = await apiUpload(small, 'customers');
        added.push({ url: up.url, name: file.name, at: new Date().toISOString(), by: meName });
      }
      if (added.length) setForm(p => ({ ...p, [fieldKey]: [...photoList(p[fieldKey]), ...added] }));
    } catch (e) { toast(e.message || 'Upload failed', 'er'); }
    setUploading(false);
  };
  const replacePhoto = async (fieldKey, index, file) => {
    if (!file) return;
    if (file.size > MAX_UPLOAD) { toast(`${file.name} is over 10 MB`, 'er'); return; }
    setUploading(true);
    try {
      const small = await compressImage(file, 1600, 0.82);
      const up = await apiUpload(small, 'customers');
      setForm(p => ({ ...p, [fieldKey]: photoList(p[fieldKey]).map((ph, i) => (i === index ? { url: up.url, name: file.name, at: new Date().toISOString(), by: meName } : ph)) }));
    } catch (e) { toast(e.message || 'Upload failed', 'er'); }
    setUploading(false);
  };
  const removePhoto = (fieldKey, index) => {
    if (!window.confirm('Delete this file from the stage? The deletion is recorded and the Owner is informed when you save.')) return;
    setForm(p => ({ ...p, [fieldKey]: photoList(p[fieldKey]).filter((_, i) => i !== index) }));
  };

  // Save one stage's record; everything else on the workflow is untouched.
  const persist = async (stage, record, okMsg) => {
    setSaving(true);
    try {
      const before = customer.workflow?.stages?.[stage.key] || {};
      await updateDocument('customers', customer.id, { workflow: withStage(customer, stage.key, record) });
      toast(okMsg);
      for (const gone of removedPhotos(stage, before, record)) {
        await recordPhotoDeletion({ users, customer, stageKey: stage.key, fieldKey: gone.fieldKey, photos: gone.photos, by: meName });
      }
    } catch (e) { toast(e.message || 'Save failed', 'er'); }
    setSaving(false);
  };

  const saveProgress = () => {
    if (!editing) return;
    const prev = customer.workflow?.stages?.[editing.key] || {};
    const status = prev.status === 'completed' ? 'completed' : 'in_progress';
    persist(editing, { ...form, status, updatedAt: new Date().toISOString(), updatedBy: meName }, status === 'completed' ? 'Stage updated' : 'Progress saved');
  };

  const completeStage = () => {
    if (!editing) return;
    const valid = isStageComplete(editing, form);
    if (!valid && !free) { toast('Fill all required fields to complete this stage', 'er'); return; }
    if (!valid && free && !window.confirm('Some required fields are still empty. Complete this stage anyway? (Owner authority)')) return;
    persist(editing, { ...form, status: 'completed', completedAt: new Date().toISOString(), completedBy: meName }, `Stage "${editing.title}" completed ✓`);
  };

  // Reopen: this stage's tick comes off and its data stays; nothing after it moves.
  const reopenStage = async (stage) => {
    if (!window.confirm(`Reopen "${stage.title}" for a correction?\nIts data is kept, and every other stage stays exactly as it is.`)) return;
    setSaving(true);
    try {
      await updateDocument('customers', customer.id, { workflow: reopenedWorkflow(customer, stage.key, meName) });
      toast(`"${stage.title}" reopened`);
      setOpenCompleted(null);
    } catch (e) { toast(e.message || 'Save failed', 'er'); }
    setSaving(false);
  };

  const stageValid = editing ? isStageComplete(editing, form) : false;
  const pct = Math.round((done / TOTAL_STAGES) * 100);

  return (
    <div>
      {/* Progress header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontWeight: 700, fontSize: '.9rem', color: 'var(--pri)' }}>Project Workflow</span>
          <span style={{ fontSize: '.82rem', color: 'var(--muted)', fontWeight: 600 }}>
            {done} / {TOTAL_STAGES} stages{current ? '' : ' — Completed 🎉'}
          </span>
        </div>
        <div style={{ height: 8, background: '#eceef3', borderRadius: 6, overflow: 'hidden' }}>
          <div style={{ width: pct + '%', height: '100%', background: current ? '#7c3aed' : '#10b981', transition: 'width .3s' }} />
        </div>
        {current && (
          <div style={{ fontSize: '.8rem', color: 'var(--muted)', marginTop: 6 }}>
            Current stage: <strong style={{ color: '#7c3aed' }}>{current.sno}. {current.title}</strong>
            {free && <span style={{ marginLeft: 8, fontSize: '.74rem' }}>· As the Owner you may open and edit any stage.</span>}
          </div>
        )}
      </div>

      {/* Stepper */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-wf="stages">
        {view.map(stage => {
          const access = stageAccess(stage.key, ctx);
          const mayEdit = canEdit && access === ACCESS.EDIT;
          const color = STATUS_COLOR[stage.status];
          const isEditing = editingKey === stage.key && !stage.auto && access !== ACCESS.NONE && (mayEdit || stage.status === 'current');
          const isOpen = isEditing || openCompleted === stage.key;
          const canOpenHere = free && mayEdit && !stage.auto && !isEditing;   // the Owner's "Open" on any stage
          const src = stageSourceNote(stage.data);
          return (
            <div key={stage.key} data-stage={stage.key} data-status={stage.status} style={{
              border: `1.5px solid ${isEditing ? '#7c3aed' : stage.status === 'current' ? color : 'var(--bor)'}`,
              borderRadius: 10, overflow: 'hidden',
              background: stage.status === 'locked' && !isEditing ? '#fafafa' : '#fff',
              opacity: stage.status === 'locked' && !isEditing && !free ? 0.7 : 1,
            }}>
              {/* Row header */}
              <div
                onClick={() => { if (stage.status === 'completed' && !isEditing) setOpenCompleted(openCompleted === stage.key ? null : stage.key); }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: stage.status === 'completed' ? 'pointer' : 'default', flexWrap: 'wrap' }}
              >
                <span className="material-icons-round" style={{ fontSize: 22, color }}>{STATUS_ICON[stage.status]}</span>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontWeight: 700, fontSize: '.86rem', color: stage.status === 'locked' && !free ? 'var(--muted)' : 'var(--fg)' }}>
                    {stage.sno}. {stage.title}
                  </div>
                  <div style={{ fontSize: '.74rem', color: 'var(--muted)', marginTop: 1 }}>{stage.detail}</div>
                </div>
                {access !== ACCESS.EDIT && !stage.auto && (
                  <span style={{ fontSize: '.66rem', fontWeight: 600, color: 'var(--muted)', border: '1px solid var(--bor)', padding: '2px 7px', borderRadius: 10 }}>
                    {access === ACCESS.NONE ? 'no access' : 'view only'}
                  </span>
                )}
                <span style={{ fontSize: '.68rem', fontWeight: 600, color, background: `${color}1a`, padding: '3px 8px', borderRadius: 10, whiteSpace: 'nowrap' }}>
                  {stage.team}
                </span>
                {canOpenHere && (
                  <button type="button" className="btn bsm bo" onClick={(e) => { e.stopPropagation(); openForEdit(stage); }} title="Open this stage for editing (Owner)">
                    <span className="material-icons-round" style={{ fontSize: 15 }}>edit</span> {stage.status === 'completed' ? 'Edit' : 'Open'}
                  </button>
                )}
              </div>

              {/* No access: nothing more is shown */}
              {access === ACCESS.NONE && !stage.auto && (
                <div style={{ padding: '0 14px 10px 46px', fontSize: '.74rem', color: 'var(--muted)' }}>You do not have access to this stage.</div>
              )}

              {/* Completed — read-only summary */}
              {access !== ACCESS.NONE && stage.status === 'completed' && isOpen && !isEditing && (
                <div style={{ padding: '4px 14px 14px', borderTop: '1px solid var(--bor)' }}>
                  {stage.auto ? (
                    <div style={{ fontSize: '.8rem', color: 'var(--muted)', paddingTop: 8 }}>Auto-completed when the customer was created.</div>
                  ) : (
                    <>
                      <div className="dg" style={{ paddingTop: 10 }}>
                        {(stage.fields || []).map(f => (
                          <SummaryItem key={f.key} field={f} value={stage.data[f.key]} />
                        ))}
                      </div>
                      <div style={{ fontSize: '.72rem', color: 'var(--muted)', marginTop: 8 }}>
                        Completed by {stage.data.completedBy || '-'}{stage.data.completedAt ? ' on ' + formatDate(stage.data.completedAt) : ''}
                        {src ? ` · ${src}` : ''}
                      </div>
                      {canEdit && isAdmin && (
                        <button type="button" className="btn bsm bo" style={{ marginTop: 10, color: 'var(--err)', borderColor: 'rgba(231,76,60,.3)' }} onClick={() => reopenStage(stage)} disabled={saving}>
                          <span className="material-icons-round" style={{ fontSize: 15 }}>lock_open</span> Reopen
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* The editor — the current stage, or whichever stage the Owner opened */}
              {access !== ACCESS.NONE && isEditing && (
                <div style={{ padding: '4px 14px 14px', borderTop: `1px solid #7c3aed33`, background: '#7c3aed08' }}>
                  {!mayEdit && <div style={{ fontSize: '.8rem', color: 'var(--muted)', paddingTop: 8 }}>You do not have permission to advance this workflow.</div>}
                  {src && <div style={{ fontSize: '.74rem', color: '#7c3aed', paddingTop: 8 }}><span className="material-icons-round" style={{ fontSize: 14, verticalAlign: '-2px' }}>sync_alt</span> {src}{stage.source ? ` (${stage.source})` : ''}</div>}
                  {!src && stage.source && <div style={{ fontSize: '.74rem', color: 'var(--muted)', paddingTop: 8 }}>Filled in automatically from {stage.source} when that is recorded; it can also be entered here.</div>}
                  <div className="fr" style={{ flexWrap: 'wrap', paddingTop: 8 }}>
                    {(stage.fields || []).map(f => (
                      <Field key={f.key} field={f} values={form} onChange={setField}
                        onAddPhotos={addPhotos} onReplacePhoto={replacePhoto} onRemovePhoto={removePhoto}
                        disabled={!mayEdit || saving} uploading={uploading} />
                    ))}
                  </div>
                  {mayEdit && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                      <button type="button" className="btn bp bsm" onClick={completeStage} disabled={saving || uploading || (!stageValid && !free)}>
                        <span className="material-icons-round" style={{ fontSize: 16 }}>task_alt</span>
                        {saving ? 'Saving...' : stage.status === 'completed' ? 'Save & Keep Completed' : 'Complete Stage & Unlock Next'}
                      </button>
                      <button type="button" className="btn bo bsm" onClick={saveProgress} disabled={saving || uploading}>Save Progress</button>
                      {free && stage.key !== currentKey && (
                        <button type="button" className="btn bo bsm" onClick={() => { setEditingKey(currentKey); setForm(prefill(current, customer)); }} disabled={saving}>Close</button>
                      )}
                      {!stageValid && <span style={{ fontSize: '.74rem', color: 'var(--muted)' }}>{free ? 'Required fields are empty; the Owner may still complete the stage.' : 'Fill all required fields to unlock the next stage.'}</span>}
                    </div>
                  )}
                </div>
              )}

              {/* The current stage while the Owner edits another one */}
              {access !== ACCESS.NONE && stage.status === 'current' && !isEditing && !free && (
                <div style={{ padding: '0 14px 10px 46px', fontSize: '.74rem', color: 'var(--muted)' }}>This is the current stage.</div>
              )}

              {/* Locked */}
              {access !== ACCESS.NONE && stage.status === 'locked' && !isEditing && (
                <div style={{ padding: '0 14px 10px 46px', fontSize: '.74rem', color: 'var(--muted)' }}>
                  {free ? 'Not reached yet — open it above to fill it in now.' : 'Locked — complete the previous stage first.'}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const isImage = (p) => /\.(jpe?g|png|webp|gif)(\?|$)/i.test(p.url || '') || /^data:image\//i.test(p.url || '');

function PhotoThumb({ photo, label }) {
  if (!isSafeUrl(photo.url)) return <span style={{ fontSize: '.76rem', color: 'var(--muted)' }}>{photo.name || 'file'}</span>;
  return isImage(photo)
    ? <a href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt={label} style={{ width: 110, height: 82, borderRadius: 6, border: '1px solid var(--bor)', objectFit: 'cover', display: 'block' }} /></a>
    : <a href={photo.url} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.78rem', color: 'var(--pri)', border: '1px solid var(--bor)', borderRadius: 6, padding: '6px 8px' }}>
        <span className="material-icons-round" style={{ fontSize: 16 }}>description</span>{photo.name || 'document'}
      </a>;
}

// ---- read-only summary of a completed field ----
function SummaryItem({ field, value }) {
  let display;
  if (field.type === 'checkbox') display = value ? 'Yes ✓' : 'No';
  else if (PHOTO_TYPES.includes(field.type)) {
    const list = photoList(value);
    display = list.length
      ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{list.map((p, i) => <PhotoThumb key={i} photo={p} label={field.label} />)}</div>
      : '-';
  }
  else if (field.type === 'list') display = listValue(value).join(', ') || '-';
  else display = value || '-';
  return (
    <div className="di">
      <div className="dl">{field.label}</div>
      <div className="dv">{display}</div>
    </div>
  );
}

// ---- editable field for the open stage ----
function Field({ field, values, onChange, onAddPhotos, onReplacePhoto, onRemovePhoto, disabled, uploading }) {
  const val = values[field.key];
  const isRequired = field.required || (field.requiredIf && field.requiredIf(values));
  const ok = isFieldSatisfied(field, values);
  const label = (
    <label>
      {field.label}{isRequired && <span style={{ color: 'var(--err)' }}> *</span>}
      {field.mustEqual && val && !ok && <span style={{ color: 'var(--err)', fontSize: '.72rem' }}> (must be "{field.mustEqual}")</span>}
    </label>
  );
  const full = field.type === 'textarea' || PHOTO_TYPES.includes(field.type) || field.type === 'list';
  const accept = field.type === 'docs' ? 'image/*,application/pdf,.doc,.docx' : 'image/*,application/pdf';

  return (
    <div className="fg" style={{ flex: full ? '1 1 100%' : '1 1 45%', minWidth: 180 }}>
      {field.type !== 'checkbox' && label}
      {field.type === 'select' && (
        <select className="fi" value={val || ''} onChange={e => onChange(field.key, e.target.value)} disabled={disabled}>
          <option value="">Select...</option>
          {field.options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      )}
      {field.type === 'text' && (
        <input className="fi" value={val || ''} onChange={e => onChange(field.key, e.target.value)} disabled={disabled} />
      )}
      {field.type === 'number' && (
        <input type="number" className="fi" value={val || ''} onChange={e => onChange(field.key, e.target.value)} disabled={disabled} />
      )}
      {field.type === 'date' && (
        <input type="date" className="fi" value={val || ''} onChange={e => onChange(field.key, e.target.value)} disabled={disabled} />
      )}
      {field.type === 'textarea' && (
        <textarea className="fi" rows="2" value={val || ''} onChange={e => onChange(field.key, e.target.value)} disabled={disabled} />
      )}
      {field.type === 'list' && (
        <textarea className="fi" rows="2" value={listValue(val).join('\n')} placeholder="One name per line"
          onChange={e => onChange(field.key, e.target.value.split('\n'))} disabled={disabled} />
      )}
      {field.type === 'checkbox' && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: disabled ? 'default' : 'pointer', fontSize: '.84rem', fontWeight: 600 }}>
          <input type="checkbox" checked={val === true} onChange={e => onChange(field.key, e.target.checked)} disabled={disabled} style={{ width: 16, height: 16 }} />
          {field.label}{isRequired && <span style={{ color: 'var(--err)' }}>*</span>}
        </label>
      )}
      {PHOTO_TYPES.includes(field.type) && (() => {
        const list = photoList(val);
        return (
          <div data-photos={field.key}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              {list.map((p, i) => (
                <div key={p.url + i} style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
                  <PhotoThumb photo={p} label={field.label} />
                  {!disabled && (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <label className="btn bsm bo" style={{ cursor: 'pointer', margin: 0, padding: '2px 7px', fontSize: '.72rem' }} title="Change this file">
                        <span className="material-icons-round" style={{ fontSize: 13 }}>swap_horiz</span> Change
                        <input type="file" accept={accept} style={{ display: 'none' }} onChange={e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; onReplacePhoto(field.key, i, f); }} />
                      </label>
                      <button type="button" className="btn bsm bo" style={{ color: 'var(--err)', padding: '2px 7px', fontSize: '.72rem' }} title="Delete this file" onClick={() => onRemovePhoto(field.key, i)}>
                        <span className="material-icons-round" style={{ fontSize: 13 }}>delete</span> Delete
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {!list.length && (
                <div style={{ width: 90, height: 68, borderRadius: 6, border: '1px dashed var(--bor)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}><span className="material-icons-round">image</span></div>
              )}
            </div>
            {!disabled && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                <label className="btn bsm bo" style={{ cursor: 'pointer', margin: 0 }}>
                  <span className="material-icons-round" style={{ fontSize: 15 }}>add_photo_alternate</span> {list.length ? 'Add another' : 'Upload'}
                  <input type="file" accept={accept} multiple style={{ display: 'none' }} onChange={e => { const fs = e.target.files; onAddPhotos(field.key, fs); e.target.value = ''; }} />
                </label>
                {uploading && <span style={{ fontSize: '.74rem', color: 'var(--muted)' }}>Uploading…</span>}
                <span style={{ fontSize: '.72rem', color: 'var(--muted)' }}>{list.length} uploaded · several allowed · each can be changed or deleted on its own</span>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
