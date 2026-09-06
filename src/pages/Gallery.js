import React, { useState } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { addDocument, updateDocument, deleteDocument } from '../services/firestore';
import { apiUpload } from '../services/api';
import { Modal, EmptyState } from '../components/SharedUI';
import { hasAccess, isSafeUrl } from '../services/helpers';

// Gallery now supports direct device upload (single or multiple photos) via the
// /upload endpoint, with an optional image-URL fallback for advanced users.
export default function Gallery() {
  const { gallery } = useData();
  const { role } = useAuth();
  const { toast } = useToast();
  const [modal, setModal] = useState(null);
  const canEdit = hasAccess(role, 'coordinator');

  // items: array of { url, caption }. On edit we get exactly one; on add, one per photo.
  const handleSave = async (items, id) => {
    try {
      if (id) {
        await updateDocument('gallery', id, items[0]);
        toast('Photo updated');
      } else {
        for (const it of items) await addDocument('gallery', it);
        toast(items.length > 1 ? `${items.length} photos added` : 'Photo added');
      }
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
        {canEdit && <button className="btn bp bsm" onClick={() => setModal({ data: {} })}><span className="material-icons-round" style={{ fontSize: 18 }}>add_a_photo</span> Add Photos</button>}
      </div>
      <div className="card">
        <div className="cb">
          {gallery.length ? (
            <div className="gg">
              {gallery.map(g => (
                <div className="gi" key={g.id} style={{ position: 'relative' }}>
                  {isSafeUrl(g.url) && <img src={g.url} alt={g.caption || ''} />}
                  {g.caption && <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,.6)', color: '#fff', padding: '6px 10px', fontSize: '.78rem' }}>{g.caption}</div>}
                  {canEdit && <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', gap: 4 }}>
                    <button className="btn bsm" onClick={() => setModal({ data: g, id: g.id })} style={{ background: 'rgba(0,0,0,.5)', color: '#fff', borderRadius: '50%', width: 28, height: 28, padding: 0 }}><span className="material-icons-round" style={{ fontSize: 14 }}>edit</span></button>
                    <button className="btn bsm" onClick={() => handleDelete(g.id)} style={{ background: 'rgba(231,76,60,.8)', color: '#fff', borderRadius: '50%', width: 28, height: 28, padding: 0 }}><span className="material-icons-round" style={{ fontSize: 14 }}>delete</span></button>
                  </div>}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon="photo_library" title="No photos yet" message={canEdit ? 'Tap “Add Photos” to upload directly from your device.' : 'No installation photos available.'} />
          )}
        </div>
      </div>
      {modal && <GalleryModal data={modal.data} id={modal.id} onSave={handleSave} onClose={() => setModal(null)} />}
    </>
  );
}

function GalleryModal({ data, id, onSave, onClose }) {
  const [caption, setCaption] = useState(data.caption || '');
  const [url, setUrl] = useState(data.url || '');      // optional URL fallback / existing photo
  const [picked, setPicked] = useState([]);            // [{ file, preview }]
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const onPick = (e) => {
    setError('');
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const tooBig = files.find(f => f.size > 10 * 1024 * 1024);
    if (tooBig) { setError(`“${tooBig.name}” is larger than 10 MB.`); return; }
    // When editing an existing photo we only replace with a single image.
    const list = id ? files.slice(0, 1) : files;
    setPicked(list.map(file => ({ file, preview: URL.createObjectURL(file) })));
    // Note: a picked device photo takes precedence at submit; we keep any existing
    // URL so that removing the pick (in edit mode) falls back to the original image.
  };

  const removePicked = (i) => setPicked(p => {
    const next = [...p];
    URL.revokeObjectURL(next[i].preview);
    next.splice(i, 1);
    return next;
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!picked.length && !url) { setError('Choose a photo from your device or paste an image URL.'); return; }
    if (!picked.length && url && !isSafeUrl(url)) { setError('Only https:// image URLs are allowed.'); return; }

    try {
      setUploading(true);
      let items = [];
      if (picked.length) {
        for (const p of picked) {
          const res = await apiUpload(p.file, 'gallery');
          items.push({ url: res.url, caption });
        }
      } else {
        items = [{ url, caption }];
      }
      await onSave(items, id);
    } catch (err) {
      setError(err.message || 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal title={id ? 'Edit Photo' : 'Add Photos'} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="mb">
          {/* Device upload — primary path */}
          <div className="fg">
            <label>{id ? 'Replace photo' : 'Photos'}</label>
            <label className="btn bo" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <span className="material-icons-round" style={{ fontSize: 18 }}>photo_camera</span>
              {id ? 'Choose a photo' : 'Choose photo(s)'}
              <input type="file" accept="image/*" multiple={!id} onChange={onPick} style={{ display: 'none' }} />
            </label>
            <small className="lg-hint" style={{ display: 'block', marginTop: 6 }}>JPG, PNG, WEBP or GIF · up to 10 MB each</small>
          </div>

          {/* Selected-device previews */}
          {picked.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              {picked.map((p, i) => (
                <div key={i} style={{ position: 'relative', width: 88, height: 88, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--bor)' }}>
                  <img src={p.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  <button type="button" onClick={() => removePicked(i)} style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(231,76,60,.9)', color: '#fff', border: 'none', borderRadius: '50%', width: 20, height: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span className="material-icons-round" style={{ fontSize: 13 }}>close</span></button>
                </div>
              ))}
            </div>
          )}

          {/* Existing photo preview (edit mode, no new pick) */}
          {!picked.length && url && isSafeUrl(url) && (
            <div style={{ marginBottom: 10, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--bor)' }}>
              <img src={url} alt="Current" style={{ width: '100%', maxHeight: 200, objectFit: 'cover' }} onError={e => e.target.style.display = 'none'} />
            </div>
          )}

          <div className="fg">
            <label>Caption{picked.length > 1 ? ' (applied to all)' : ''}</label>
            <input className="fi" value={caption} onChange={e => setCaption(e.target.value)} placeholder="Brief description" />
          </div>

          {/* Optional URL fallback */}
          {!picked.length && (
            <div className="fg">
              <label>Or paste image URL (optional)</label>
              <input className="fi" type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..." />
            </div>
          )}

          {error && <p style={{ color: 'var(--err)', fontSize: '.82rem', marginTop: 6 }}>{error}</p>}
        </div>
        <div className="mf">
          <button type="button" className="btn bo" onClick={onClose} disabled={uploading}>Cancel</button>
          <button type="submit" className="btn bp" disabled={uploading}>
            {uploading ? <><span className="ssm"></span> Uploading…</> : (id ? 'Update' : 'Add')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
