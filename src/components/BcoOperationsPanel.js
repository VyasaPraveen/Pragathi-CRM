import React, { useState } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { addDocument, updateDocument } from '../services/firestore';
import { apiUpload } from '../services/api';
import { formatDate, isSafeUrl } from '../services/helpers';
import {
  BCO_STAGES, emptyBcoOps, stageData, stageDone, stageUnlocked, stageWaitsFor,
  stageCloseIssue, bcoProgress, canEditBco,
} from '../services/bco';

const nowIso = () => new Date().toISOString();

// ============================================================================
// BCO Operations — the seven stages, as a tab on the lead.
//
// Each stage is a card. Locked cards say what they are waiting for. An open
// card can be edited by the BCO and the authorities: answer, note, documents;
// "Update This" saves and keeps it open, "Close This" saves and marks it done,
// which opens the next. A closed card shows what was recorded, with "Edit" to
// reopen it. The rules for what may be closed live in services/bco.js.
// ============================================================================
export default function BcoOperationsPanel({ lead }) {
  const { bcoOps } = useData();
  const { role, user } = useAuth();
  const { toast } = useToast();
  const meName = user?.displayName || user?.email || '';

  const ops = (bcoOps || []).find(o => o.leadId === lead.id) || null;
  const mayEdit = canEditBco(role);
  const [editing, setEditing] = useState('');          // the stage key being edited
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const progress = bcoProgress(ops);

  const startEdit = (stage) => {
    const d = stageData(ops, stage.key);
    setDraft({
      answer: d.answer || '',
      note: d.note || '',
      docs: Array.isArray(d.docs) ? d.docs : [],
      // Stage 1's named slots, each with an optional file and an optional
      // typed value (the Mail ID is usually typed, not scanned).
      slots: stage.kind === 'docs'
        ? stage.docs.map(label => (d.slots || []).find(s => s.label === label) || { label, url: '', name: '', text: '' })
        : [],
    });
    setEditing(stage.key);
  };

  // Persist one stage. The record is created on the first save.
  const persist = async (stage, data, closing) => {
    setBusy(true);
    try {
      const prev = stageData(ops, stage.key);
      const next = {
        ...prev, ...data,
        done: closing ? true : !!prev.done && !data.reopen,
        updatedAt: nowIso(), updatedBy: meName,
        ...(closing ? { closedAt: nowIso(), closedBy: meName } : {}),
      };
      delete next.reopen;
      const stages = { ...((ops && ops.stages) || {}), [stage.key]: next };
      if (ops) await updateDocument('bcoOps', ops.id, { stages, leadName: lead.name || ops.leadName || '' });
      else await addDocument('bcoOps', { ...emptyBcoOps(lead), stages });
      toast(closing ? `Stage ${stage.no} closed` : `Stage ${stage.no} updated`);
      setEditing('');
    } catch (e) { toast(e.message, 'er'); }
    finally { setBusy(false); }
  };

  const update = (stage) => persist(stage, draftToData(draft), false);
  const close = (stage) => {
    const issue = stageCloseIssue(stage, draft);
    if (issue) { toast(issue, 'er'); return; }
    persist(stage, draftToData(draft), true);
  };
  const reopen = (stage) => {
    if (!window.confirm(`Reopen Stage ${stage.no} – ${stage.title}? Stages after it stay as they are.`)) return;
    persist(stage, { reopen: true, done: false }, false);
  };

  const upload = async (file, onUrl) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast('That file is over 10 MB', 'er'); return; }
    setBusy(true);
    try {
      const up = await apiUpload(file, 'bco');
      onUrl(up.url, file.name);
      toast('Document attached');
    } catch (e) { toast(e.message, 'er'); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: '.95rem' }}>
          <span className="material-icons-round" style={{ fontSize: 18, verticalAlign: '-4px', marginRight: 6, color: 'var(--pri)' }}>fact_check</span>
          BCO Operations
        </strong>
        <span style={{ fontSize: '.8rem', color: 'var(--muted)' }}>{progress.done} of {progress.total} stages closed</span>
        <div style={{ flex: 1, minWidth: 120, height: 6, background: 'var(--bor)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ width: `${(progress.done / progress.total) * 100}%`, height: '100%', background: 'var(--pri)' }} />
        </div>
        {!mayEdit && <span style={{ fontSize: '.74rem', color: 'var(--muted)' }}>view only</span>}
      </div>

      {BCO_STAGES.map(stage => {
        const d = stageData(ops, stage.key);
        const done = stageDone(ops, stage.key);
        const open = stageUnlocked(ops, stage.key);
        const isEditing = editing === stage.key;
        const border = done ? 'rgba(39,174,96,.4)' : open ? 'rgba(26,58,122,.3)' : 'var(--bor)';
        return (
          <div key={stage.key} style={{ border: `1px solid ${border}`, borderRadius: 10, padding: '10px 12px', marginBottom: 10, background: open ? '#fff' : '#f7f8fa', opacity: open ? 1 : 0.75 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className="material-icons-round" style={{ fontSize: 18, color: done ? '#1e8449' : open ? 'var(--pri)' : 'var(--muted)' }}>
                {done ? 'check_circle' : open ? 'radio_button_unchecked' : 'lock'}
              </span>
              <strong style={{ fontSize: '.86rem' }}>Stage {stage.no} – {stage.title}</strong>
              {done && <span style={{ fontSize: '.72rem', color: '#1e8449' }}>closed by {d.closedBy || '-'} on {formatDate(d.closedAt)}</span>}
              {!done && !open && <span style={{ fontSize: '.72rem', color: 'var(--muted)' }}>opens after {stageWaitsFor(stage.key)}</span>}
              {!done && open && d.updatedAt && <span style={{ fontSize: '.72rem', color: 'var(--muted)' }}>updated by {d.updatedBy || '-'} on {formatDate(d.updatedAt)}</span>}
              <span style={{ flex: 1 }} />
              {mayEdit && open && !isEditing && (
                <button className="btn bsm bo" disabled={busy} onClick={() => startEdit(stage)}>
                  <span className="material-icons-round" style={{ fontSize: 15 }}>edit</span> {done ? 'Edit' : 'Update'}
                </button>
              )}
              {mayEdit && done && !isEditing && (
                <button className="btn bsm bo" disabled={busy} onClick={() => reopen(stage)} title="Reopen this stage">
                  <span className="material-icons-round" style={{ fontSize: 15 }}>undo</span>
                </button>
              )}
            </div>

            {/* What is on record, when not editing. */}
            {!isEditing && open && (
              <div style={{ marginTop: 6, fontSize: '.8rem' }}>
                {stage.kind === 'docs' && <SlotList slots={d.slots || []} labels={stage.docs} />}
                {(stage.kind === 'yesno' || stage.kind === 'redeem') && (
                  <div>Answer: <strong style={{ color: d.answer === 'NO' || d.answer === 'Not Redeemed' ? '#c0392b' : d.answer ? '#1e8449' : 'var(--muted)' }}>{d.answer || 'not yet given'}</strong></div>
                )}
                {d.note && <div style={{ marginTop: 3 }}><span className="material-icons-round" style={{ fontSize: 13, verticalAlign: '-2px', color: 'var(--muted)' }}>sticky_note_2</span> {d.note}</div>}
                <DocList docs={d.docs || []} />
                {!d.answer && !d.note && !(d.docs || []).length && !(d.slots || []).some(s => s.url || s.text) && (
                  <span style={{ color: 'var(--muted)' }}>Nothing recorded yet.</span>
                )}
              </div>
            )}

            {/* The editor. */}
            {isEditing && (
              <div style={{ marginTop: 10, borderTop: '1px solid var(--bor)', paddingTop: 10 }}>
                {stage.kind === 'docs' && (
                  <div>
                    {draft.slots.map((s, i) => (
                      <div key={s.label} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6, fontSize: '.8rem' }}>
                        <span style={{ minWidth: 90, fontWeight: 600 }}>{s.label}</span>
                        <input className="fi" style={{ flex: 1, minWidth: 140, padding: '4px 6px', fontSize: '.78rem' }} value={s.text}
                          placeholder={s.label === 'Mail ID' ? 'email address' : 'number / reference (optional)'}
                          onChange={e => setDraft(p => ({ ...p, slots: p.slots.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) }))} />
                        <label className="btn bsm bo" style={{ cursor: 'pointer', margin: 0 }}>
                          <span className="material-icons-round" style={{ fontSize: 15 }}>upload</span> {s.url ? 'Replace' : 'Upload'}
                          <input type="file" style={{ display: 'none' }} disabled={busy}
                            onChange={e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; upload(f, (url, name) => setDraft(p => ({ ...p, slots: p.slots.map((x, j) => (j === i ? { ...x, url, name } : x)) }))); }} />
                        </label>
                        {s.url && <a href={s.url} target="_blank" rel="noreferrer" style={{ color: 'var(--pri)' }}>{s.name || 'open'}</a>}
                        {s.url
                          ? <span style={{ color: '#1e8449', fontSize: '.72rem' }}>uploaded</span>
                          : <span style={{ color: 'var(--muted)', fontSize: '.72rem' }}>not uploaded</span>}
                      </div>
                    ))}
                  </div>
                )}
                {stage.kind === 'yesno' && (
                  <div style={{ display: 'flex', gap: 14, marginBottom: 8, fontSize: '.84rem' }}>
                    {['YES', 'NO'].map(a => (
                      <label key={a} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                        <input type="radio" name={`ans-${stage.key}`} checked={draft.answer === a} onChange={() => setDraft(p => ({ ...p, answer: a }))} /> {a}
                      </label>
                    ))}
                  </div>
                )}
                {stage.kind === 'redeem' && (
                  <div style={{ display: 'flex', gap: 14, marginBottom: 8, fontSize: '.84rem' }}>
                    {stage.answers.map(a => (
                      <label key={a} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                        <input type="radio" name={`ans-${stage.key}`} checked={draft.answer === a} onChange={() => setDraft(p => ({ ...p, answer: a }))} /> {a}
                      </label>
                    ))}
                  </div>
                )}
                <div className="fg">
                  <label>Note{draft.answer === 'NO' ? ' * (the reason)' : ''}</label>
                  <textarea className="fi" rows="2" value={draft.note} onChange={e => setDraft(p => ({ ...p, note: e.target.value }))}
                    placeholder={draft.answer === 'NO' ? 'Why is this NO?' : 'Anything worth recording (optional)'} />
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                  <label className="btn bsm bo" style={{ cursor: 'pointer', margin: 0 }}>
                    <span className="material-icons-round" style={{ fontSize: 15 }}>attach_file</span> Add document
                    <input type="file" style={{ display: 'none' }} disabled={busy}
                      onChange={e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; upload(f, (url, name) => setDraft(p => ({ ...p, docs: [...p.docs, { url, name, at: nowIso(), by: meName }] }))); }} />
                  </label>
                  <span style={{ fontSize: '.72rem', color: 'var(--muted)' }}>Documents are optional — a stage can be closed without them.</span>
                </div>
                <DocList docs={draft.docs} onRemove={i => setDraft(p => ({ ...p, docs: p.docs.filter((x, j) => j !== i) }))} />
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button className="btn bsm bo" disabled={busy} onClick={() => setEditing('')}>Cancel</button>
                  <button className="btn bsm bo" disabled={busy} onClick={() => update(stage)} title="Save and keep this stage open">
                    <span className="material-icons-round" style={{ fontSize: 15 }}>save</span> Update This
                  </button>
                  <button className="btn bsm bp" disabled={busy} onClick={() => close(stage)} title="Save and mark this stage complete">
                    <span className="material-icons-round" style={{ fontSize: 15 }}>task_alt</span> Close This
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      <div style={{ fontSize: '.74rem', color: 'var(--muted)' }}>
        Stages open in order. Stage 7 (Subsidy) opens together with Stage 5 as soon as Stage 4 is closed, and does not wait for Stages 5 or 6.
      </div>
    </div>
  );
}

function draftToData(draft) {
  return {
    answer: draft.answer || '',
    note: draft.note || '',
    docs: draft.docs || [],
    slots: draft.slots || [],
  };
}

function SlotList({ slots, labels }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 6 }}>
      {labels.map(label => {
        const s = (slots || []).find(x => x.label === label) || {};
        const has = !!(s.url || s.text);
        return (
          <div key={label} style={{ border: '1px solid var(--bor)', borderRadius: 6, padding: '4px 8px' }}>
            <div style={{ fontWeight: 600 }}>{label}
              <span style={{ marginLeft: 6, fontSize: '.7rem', color: has ? '#1e8449' : 'var(--muted)' }}>{has ? 'available' : 'not yet'}</span>
            </div>
            {s.text && <div style={{ fontSize: '.76rem', color: 'var(--dark)' }}>{s.text}</div>}
            {isSafeUrl(s.url) && <a href={s.url} target="_blank" rel="noreferrer" style={{ fontSize: '.76rem', color: 'var(--pri)' }}>{s.name || 'open document'}</a>}
          </div>
        );
      })}
    </div>
  );
}

function DocList({ docs, onRemove }) {
  if (!docs || !docs.length) return null;
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
      {docs.map((doc, i) => (
        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid var(--bor)', borderRadius: 12, padding: '2px 8px', fontSize: '.76rem' }}>
          <span className="material-icons-round" style={{ fontSize: 14, color: 'var(--muted)' }}>description</span>
          {isSafeUrl(doc.url) ? <a href={doc.url} target="_blank" rel="noreferrer" style={{ color: 'var(--pri)' }}>{doc.name || 'document'}</a> : (doc.name || 'document')}
          {onRemove && <span className="material-icons-round" style={{ fontSize: 14, cursor: 'pointer', color: 'var(--err)' }} onClick={() => onRemove(i)}>close</span>}
        </span>
      ))}
    </div>
  );
}
