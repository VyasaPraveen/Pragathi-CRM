import React, { useState } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { addDocument, updateDocument, deleteDocument } from '../services/firestore';
import { Modal, EmptyState } from '../components/SharedUI';

// Q4 fix: added full CRUD via URL input (was read-only with placeholder boxes)
export default function Gallery() {
  const { gallery } = useData();
  const { role } = useAuth();
  const { toast } = useToast();
  const [modal, setModal] = useState(null);
  const canEdit = role === 'admin' || role === 'manager';

  const handleSave = async (data, id) => {
    try {
      if (id) { await updateDocument('gallery', id, data); toast('Photo updated'); }
      else { await addDocument('gallery', data); toast('Photo added'); }
      setModal(null);
    } catch (e) { toast(e.message, 'er'); }
  };

  const handleDelete = async (id) => {
    if (window.confirm('Remove this photo?')) {
      try { await deleteDocument('gallery', id); toast('Photo removed'); }
      catch (e) { toast(e.message, 'er'); }
    }
  };

  return (
    <>
      <div className="tl">
        <h3>Installation Gallery</h3>
        {canEdit && <button className="btn bp bsm" onClick={() => setModal({ data: {} })}><span className="material-icons-round" style={{ fontSize: 18 }}>add</span> Add Photo</button>}
      </div>
      <div className="card">
        <div className="cb">
          {gallery.length ? (
            <div className="gg">
              {gallery.map(g => (
                <div className="gi" key={g.id} style={{ position: 'relative' }}>
                  <img src={g.url} alt={g.caption || ''} />
                  {g.caption && <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,.6)', color: '#fff', padding: '6px 10px', fontSize: '.78rem' }}>{g.caption}</div>}
                  {canEdit && <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', gap: 4 }}>
                    <button className="btn bsm" onClick={() => setModal({ data: g, id: g.id })} style={{ background: 'rgba(0,0,0,.5)', color: '#fff', borderRadius: '50%', width: 28, height: 28, padding: 0 }}><span className="material-icons-round" style={{ fontSize: 14 }}>edit</span></button>
                    <button className="btn bsm" onClick={() => handleDelete(g.id)} style={{ background: 'rgba(231,76,60,.8)', color: '#fff', borderRadius: '50%', width: 28, height: 28, padding: 0 }}><span className="material-icons-round" style={{ fontSize: 14 }}>delete</span></button>
                  </div>}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon="photo_library" title="No photos yet" message={canEdit ? 'Add photos by providing image URLs.' : 'No installation photos available.'} />
          )}
        </div>
      </div>
      {modal && <GalleryModal data={modal.data} id={modal.id} onSave={handleSave} onClose={() => setModal(null)} />}
    </>
  );
}

function GalleryModal({ data, id, onSave, onClose }) {
  const [f, setF] = useState({ url: data.url || '', caption: data.caption || '' });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  return (
    <Modal title={id ? 'Edit Photo' : 'Add Photo'} onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); onSave(f, id); }}>
        <div className="mb">
          <div className="fg"><label>Image URL *</label><input className="fi" type="url" value={f.url} onChange={e => set('url', e.target.value)} placeholder="https://..." required /></div>
          <div className="fg"><label>Caption</label><input className="fi" value={f.caption} onChange={e => set('caption', e.target.value)} placeholder="Brief description" /></div>
          {f.url && <div style={{ marginTop: 10, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--bor)' }}><img src={f.url} alt="Preview" style={{ width: '100%', maxHeight: 200, objectFit: 'cover' }} onError={e => e.target.style.display = 'none'} /></div>}
        </div>
        <div className="mf"><button type="button" className="btn bo" onClick={onClose}>Cancel</button><button type="submit" className="btn bp">{id ? 'Update' : 'Add'}</button></div>
      </form>
    </Modal>
  );
}
