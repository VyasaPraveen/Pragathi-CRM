import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { updateDocument } from '../services/firestore';
import { hasAccess, formatDate } from '../services/helpers';
import {
  WORKFLOW_STAGES, TOTAL_STAGES, getWorkflowView, completedCount,
  isStageComplete, isFieldSatisfied,
} from '../services/workflow';

// Compress an uploaded image to a small JPEG data URL, lowering quality until it
// fits a per-photo budget so several photos stay well under Firestore's 1MB doc limit.
const PHOTO_MAX_CHARS = 250000; // ~185KB of base64 per photo
function compressImage(file, maxDim = 1000) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) { height = Math.round(height * maxDim / width); width = maxDim; }
          else { width = Math.round(width * maxDim / height); height = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        let quality = 0.7;
        let out = canvas.toDataURL('image/jpeg', quality);
        while (out.length > PHOTO_MAX_CHARS && quality > 0.35) {
          quality -= 0.1;
          out = canvas.toDataURL('image/jpeg', quality);
        }
        resolve(out);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Seed a stage's form: saved in-progress data, else blanks, with a few sensible prefills
function prefill(stage, customer) {
  if (!stage) return {};
  const base = {};
  (stage.fields || []).forEach(f => { base[f.key] = f.type === 'checkbox' ? false : ''; });
  if (stage.key === 'advance') base.advanceAmount = customer.advanceReceivedAmount || customer.advanceAmount || '';
  if (stage.key === 'finalPayment') base.finalPaymentAmount = customer.finalAmount || customer.finalPayment || '';
  const saved = customer.workflow?.stages?.[stage.key] || {};
  return { ...base, ...saved };
}

const STATUS_ICON = { completed: 'check_circle', current: 'radio_button_checked', locked: 'lock' };
const STATUS_COLOR = { completed: '#10b981', current: '#7c3aed', locked: '#9ca3af' };

export default function WorkflowTab({ customer, canEdit }) {
  const { user, role } = useAuth();
  const { toast } = useToast();
  const isAdmin = hasAccess(role, 'admin');

  const view = getWorkflowView(customer);
  const current = view.find(s => s.status === 'current');
  const done = completedCount(customer);

  const [form, setForm] = useState(() => prefill(current, customer));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [openCompleted, setOpenCompleted] = useState(null);

  // Re-seed the form only when the active stage KEY changes (e.g. after completing
  // one). Keying on the derived stage — not workflow.currentStage — avoids wiping
  // in-progress keystrokes when the first "Save Progress" sets currentStage.
  const currentKey = current ? current.key : null;
  useEffect(() => {
    setForm(prefill(current, customer));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer.id, currentKey]);

  const setField = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const onPhoto = async (fieldKey, file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Please select an image file', 'er'); return; }
    setUploading(true);
    try { setField(fieldKey, await compressImage(file)); }
    catch { toast('Could not read the image', 'er'); }
    setUploading(false);
  };

  const persist = async (stagesData, currentStageSno, okMsg) => {
    setSaving(true);
    try {
      const wf = customer.workflow || {};
      await updateDocument('customers', customer.id, {
        workflow: { ...wf, stages: stagesData, currentStage: currentStageSno },
      });
      toast(okMsg);
    } catch (e) { toast(e.message || 'Save failed', 'er'); }
    setSaving(false);
  };

  const saveProgress = () => {
    if (!current) return;
    const wf = customer.workflow || {};
    const stagesData = { ...(wf.stages || {}), [current.key]: { ...form, status: 'in_progress', updatedAt: new Date().toISOString() } };
    persist(stagesData, wf.currentStage || current.sno, 'Progress saved');
  };

  const completeStage = () => {
    if (!current) return;
    if (!isStageComplete(current, form)) { toast('Fill all required fields to complete this stage', 'er'); return; }
    const wf = customer.workflow || {};
    const stagesData = {
      ...(wf.stages || {}),
      [current.key]: { ...form, status: 'completed', completedAt: new Date().toISOString(), completedBy: user?.displayName || user?.email || 'unknown' },
    };
    const next = WORKFLOW_STAGES.find(s => s.sno > current.sno);
    persist(stagesData, next ? next.sno : current.sno, `Stage "${current.title}" completed ✓`);
  };

  const reopenStage = (stage) => {
    if (!window.confirm(`Reopen "${stage.title}"?\nAll stages after it will be locked until re-completed.`)) return;
    const wf = customer.workflow || {};
    const stagesData = { ...(wf.stages || {}) };
    WORKFLOW_STAGES.filter(s => s.sno >= stage.sno && !s.auto).forEach(s => { delete stagesData[s.key]; });
    persist(stagesData, stage.sno, `"${stage.title}" reopened`);
  };

  const stageValid = current ? isStageComplete(current, form) : false;
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
          </div>
        )}
      </div>

      {/* Stepper */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {view.map(stage => {
          const color = STATUS_COLOR[stage.status];
          const isOpen = stage.status === 'current' || openCompleted === stage.key;
          return (
            <div key={stage.key} style={{
              border: `1.5px solid ${stage.status === 'current' ? color : 'var(--bor)'}`,
              borderRadius: 10, overflow: 'hidden',
              background: stage.status === 'locked' ? '#fafafa' : '#fff',
              opacity: stage.status === 'locked' ? 0.7 : 1,
            }}>
              {/* Row header */}
              <div
                onClick={() => { if (stage.status === 'completed') setOpenCompleted(openCompleted === stage.key ? null : stage.key); }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: stage.status === 'completed' ? 'pointer' : 'default' }}
              >
                <span className="material-icons-round" style={{ fontSize: 22, color }}>{STATUS_ICON[stage.status]}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: '.86rem', color: stage.status === 'locked' ? 'var(--muted)' : 'var(--fg)' }}>
                    {stage.sno}. {stage.title}
                  </div>
                  <div style={{ fontSize: '.74rem', color: 'var(--muted)', marginTop: 1 }}>{stage.detail}</div>
                </div>
                <span style={{ fontSize: '.68rem', fontWeight: 600, color, background: `${color}1a`, padding: '3px 8px', borderRadius: 10, whiteSpace: 'nowrap' }}>
                  {stage.team}
                </span>
              </div>

              {/* Completed — read-only summary */}
              {stage.status === 'completed' && isOpen && (
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
                      </div>
                      {canEdit && isAdmin && (
                        <button type="button" className="btn bsm bo" style={{ marginTop: 10, color: 'var(--err)', borderColor: 'rgba(231,76,60,.3)' }} onClick={() => reopenStage(stage)}>
                          <span className="material-icons-round" style={{ fontSize: 15 }}>lock_open</span> Reopen
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Current — editable form */}
              {stage.status === 'current' && (
                <div style={{ padding: '4px 14px 14px', borderTop: `1px solid ${color}33`, background: `${color}08` }}>
                  {!canEdit && <div style={{ fontSize: '.8rem', color: 'var(--muted)', paddingTop: 8 }}>You do not have permission to advance this workflow.</div>}
                  <div className="fr" style={{ flexWrap: 'wrap', paddingTop: 8 }}>
                    {(stage.fields || []).map(f => (
                      <Field key={f.key} field={f} values={form} onChange={setField} onPhoto={onPhoto} disabled={!canEdit || saving} uploading={uploading} />
                    ))}
                  </div>
                  {canEdit && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                      <button type="button" className="btn bp bsm" onClick={completeStage} disabled={saving || uploading || !stageValid}>
                        <span className="material-icons-round" style={{ fontSize: 16 }}>task_alt</span>
                        {saving ? 'Saving...' : 'Complete Stage & Unlock Next'}
                      </button>
                      <button type="button" className="btn bo bsm" onClick={saveProgress} disabled={saving || uploading}>Save Progress</button>
                      {!stageValid && <span style={{ fontSize: '.74rem', color: 'var(--muted)' }}>Fill all required fields to unlock the next stage.</span>}
                    </div>
                  )}
                </div>
              )}

              {/* Locked */}
              {stage.status === 'locked' && (
                <div style={{ padding: '0 14px 10px 46px', fontSize: '.74rem', color: 'var(--muted)' }}>
                  Locked — complete the previous stage first.
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- read-only summary of a completed field ----
function SummaryItem({ field, value }) {
  let display;
  if (field.type === 'checkbox') display = value ? 'Yes ✓' : 'No';
  else if (field.type === 'photo') display = value
    ? <img src={value} alt={field.label} style={{ maxWidth: 120, maxHeight: 90, borderRadius: 6, border: '1px solid var(--bor)', objectFit: 'cover' }} />
    : '-';
  else display = value || '-';
  return (
    <div className="di">
      <div className="dl">{field.label}</div>
      <div className="dv">{display}</div>
    </div>
  );
}

// ---- editable field for the current stage ----
function Field({ field, values, onChange, onPhoto, disabled, uploading }) {
  const val = values[field.key];
  const isRequired = field.required || (field.requiredIf && field.requiredIf(values));
  const ok = isFieldSatisfied(field, values);
  const label = (
    <label>
      {field.label}{isRequired && <span style={{ color: 'var(--err)' }}> *</span>}
      {field.mustEqual && val && !ok && <span style={{ color: 'var(--err)', fontSize: '.72rem' }}> (must be "{field.mustEqual}")</span>}
    </label>
  );
  const full = field.type === 'textarea' || field.type === 'photo';

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
      {field.type === 'checkbox' && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: disabled ? 'default' : 'pointer', fontSize: '.84rem', fontWeight: 600 }}>
          <input type="checkbox" checked={val === true} onChange={e => onChange(field.key, e.target.checked)} disabled={disabled} style={{ width: 16, height: 16 }} />
          {field.label}{isRequired && <span style={{ color: 'var(--err)' }}>*</span>}
        </label>
      )}
      {field.type === 'photo' && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {val
            ? <img src={val} alt={field.label} style={{ maxWidth: 120, maxHeight: 90, borderRadius: 6, border: '1px solid var(--bor)', objectFit: 'cover' }} />
            : <div style={{ width: 90, height: 68, borderRadius: 6, border: '1px dashed var(--bor)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}><span className="material-icons-round">image</span></div>}
          {!disabled && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <label className="btn bsm bo" style={{ cursor: 'pointer', margin: 0 }}>
                <span className="material-icons-round" style={{ fontSize: 15 }}>upload</span> {val ? 'Change' : 'Upload'}
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => onPhoto(field.key, e.target.files[0])} />
              </label>
              {val && <button type="button" className="btn bsm bo" style={{ color: 'var(--err)' }} onClick={() => onChange(field.key, '')}>Remove</button>}
              {uploading && <span style={{ fontSize: '.74rem', color: 'var(--muted)' }}>Processing…</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
