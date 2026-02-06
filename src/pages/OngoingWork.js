import React, { useState } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { addDocument, updateDocument, deleteDocument } from '../services/firestore';
import { formatDate, toNumber } from '../services/helpers';
import { StatusBadge, ProgressBar, Modal, EmptyState } from '../components/SharedUI';

const statuses = ['In Progress', 'Pending', 'Completed', 'Delayed'];

// Q4 fix: added full CRUD (was read-only)
export default function OngoingWork() {
  const { ongoingWork } = useData();
  const { role } = useAuth();
  const { toast } = useToast();
  const [modal, setModal] = useState(null);

  const handleSave = async (data, id) => {
    try {
      const cleaned = { ...data, progress: toNumber(data.progress) };
      if (id) { await updateDocument('ongoingWork', id, cleaned); toast('Project updated'); }
      else { await addDocument('ongoingWork', cleaned); toast('Project added'); }
      setModal(null);
    } catch (e) { toast(e.message, 'er'); }
  };

  const handleDelete = async (id) => {
    if (window.confirm('Delete this project?')) {
      try { await deleteDocument('ongoingWork', id); toast('Project deleted'); }
      catch (e) { toast(e.message, 'er'); }
    }
  };

  return (
    <>
      <div className="tl">
        <h3>Ongoing Work</h3>
        <button className="btn bp bsm" onClick={() => setModal({ data: {} })}><span className="material-icons-round" style={{ fontSize: 18 }}>add</span> Add Project</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 16 }}>
        {ongoingWork.map(w => (
          <div className="card" key={w.id}>
            <div className="ch">
              <h3 style={{ fontSize: '.95rem' }}>{w.projectName}</h3>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <StatusBadge status={w.status} />
                <button className="btn bsm bo" onClick={() => setModal({ data: w, id: w.id })}><span className="material-icons-round" style={{ fontSize: 16 }}>edit</span></button>
                {role === 'admin' && <button className="btn bsm bo" onClick={() => handleDelete(w.id)} style={{ color: 'var(--err)', borderColor: 'rgba(231,76,60,.3)' }}><span className="material-icons-round" style={{ fontSize: 16 }}>delete</span></button>}
              </div>
            </div>
            <div className="cb">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}><span style={{ fontSize: '.82rem', color: 'var(--muted)' }}>Progress</span><span style={{ fontWeight: 700, color: 'var(--pri)' }}>{w.progress}%</span></div>
              <div style={{ marginBottom: 16 }}><ProgressBar value={w.progress} /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: '.82rem' }}>
                <div><span style={{ color: 'var(--muted)' }}>Start:</span> {formatDate(w.startDate)}</div>
                <div><span style={{ color: 'var(--muted)' }}>Install:</span> {formatDate(w.installDate)}</div>
                <div><span style={{ color: 'var(--muted)' }}>QC:</span> {w.qualityDate ? formatDate(w.qualityDate) : 'Pending'}</div>
                <div><span style={{ color: 'var(--muted)' }}>Warranty:</span> {w.warrantyDate ? formatDate(w.warrantyDate) : 'Pending'}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
      {!ongoingWork.length && <div className="card"><div className="cb"><EmptyState icon="construction" title="No ongoing projects" message="Add a new project to get started." /></div></div>}
      {modal && <WorkModal data={modal.data} id={modal.id} onSave={handleSave} onClose={() => setModal(null)} />}
    </>
  );
}

function WorkModal({ data, id, onSave, onClose }) {
  const [f, setF] = useState({
    projectName: data.projectName || '', status: data.status || 'In Progress', progress: data.progress || 0,
    startDate: data.startDate || '', installDate: data.installDate || '',
    qualityDate: data.qualityDate || '', warrantyDate: data.warrantyDate || ''
  });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  return (
    <Modal title={id ? 'Edit Project' : 'Add Project'} onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); onSave(f, id); }}>
        <div className="mb">
          <div className="fg"><label>Project Name *</label><input className="fi" value={f.projectName} onChange={e => set('projectName', e.target.value)} required /></div>
          <div className="fr"><div className="fg"><label>Status</label><select className="fi" value={f.status} onChange={e => set('status', e.target.value)}>{statuses.map(s => <option key={s}>{s}</option>)}</select></div><div className="fg"><label>Progress %</label><input type="number" className="fi" value={f.progress} min="0" max="100" onChange={e => set('progress', e.target.value)} /></div></div>
          <div className="fr"><div className="fg"><label>Start Date</label><input type="date" className="fi" value={f.startDate} onChange={e => set('startDate', e.target.value)} /></div><div className="fg"><label>Install Date</label><input type="date" className="fi" value={f.installDate} onChange={e => set('installDate', e.target.value)} /></div></div>
          <div className="fr"><div className="fg"><label>QC Date</label><input type="date" className="fi" value={f.qualityDate} onChange={e => set('qualityDate', e.target.value)} /></div><div className="fg"><label>Warranty Date</label><input type="date" className="fi" value={f.warrantyDate} onChange={e => set('warrantyDate', e.target.value)} /></div></div>
        </div>
        <div className="mf"><button type="button" className="btn bo" onClick={onClose}>Cancel</button><button type="submit" className="btn bp">{id ? 'Update' : 'Add'}</button></div>
      </form>
    </Modal>
  );
}
