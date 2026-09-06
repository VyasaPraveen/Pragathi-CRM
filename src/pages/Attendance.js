import React, { useState, useMemo } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { addDocument, deleteDocument } from '../services/firestore';
import { apiUpload } from '../services/api';
import { formatDate, safeStr, hasAccess, isSafeUrl } from '../services/helpers';
import { Modal, EmptyState } from '../components/SharedUI';

const PAGE_SIZE = 30;
const today = () => new Date().toISOString().slice(0, 10);

export default function Attendance() {
  const { attendance } = useData();
  const { user, role } = useAuth();
  const { toast } = useToast();
  const [modal, setModal] = useState(false);
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const myEmail = user?.email || '';
  const myName = user?.displayName || '';
  const canSeeAll = hasAccess(role, 'manager'); // managers/admin/owner see the whole team
  const admin = hasAccess(role, 'admin');

  let visible = canSeeAll ? attendance : attendance.filter(a => a.employeeEmail === myEmail || a.employeeName === myName);
  if (search) {
    const q = search.toLowerCase();
    visible = visible.filter(a => safeStr(a.employeeName).toLowerCase().includes(q) || safeStr(a.type).toLowerCase().includes(q) || safeStr(a.date).includes(q));
  }
  visible = [...visible].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  const myToday = useMemo(() =>
    attendance.filter(a => (a.employeeEmail === myEmail) && a.date === today()).sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0)),
    [attendance, myEmail]);
  // Suggest the next action: first mark = Check In, then Check Out.
  const suggestedType = myToday.some(a => a.type === 'Check In') && !myToday.some(a => a.type === 'Check Out') ? 'Check Out' : 'Check In';

  const displayed = visible.slice(0, visibleCount);
  const hasMore = visible.length > visibleCount;

  const handleSave = async (rec) => {
    try {
      await addDocument('attendance', {
        ...rec,
        employeeName: myName || myEmail,
        employeeEmail: myEmail,
        date: today(),
        time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      });
      toast(`${rec.type} marked`);
      setModal(false);
    } catch (e) { toast(e.message, 'er'); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this attendance record?')) return;
    try { await deleteDocument('attendance', id); toast('Record deleted'); }
    catch (e) { toast(e.message, 'er'); }
  };

  return (
    <>
      <div className="tl">
        <div className="sb-x"><span className="material-icons-round">search</span><input type="text" placeholder="Search attendance..." value={search} onChange={e => setSearch(e.target.value)} /></div>
        <button className="btn bp bsm" onClick={() => setModal(true)}><span className="material-icons-round" style={{ fontSize: 18 }}>where_to_vote</span> Mark Attendance</button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}><div className="cb" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span className="material-icons-round" style={{ fontSize: 22, color: 'var(--pri)' }}>today</span>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontWeight: 700 }}>Today — {formatDate(today())}</div>
          <div style={{ fontSize: '.82rem', color: 'var(--muted)' }}>
            {myToday.length ? myToday.map(a => `${a.type} ${a.time}`).join('  ·  ') : 'Not marked yet'}
          </div>
        </div>
        <span style={{ fontSize: '.78rem', color: 'var(--muted)' }}>Next: <strong>{suggestedType}</strong></span>
      </div></div>

      <div className="card"><div className="cb" style={{ padding: 0 }}><div className="tw"><table><thead><tr>
        <th>Employee</th><th>Date</th><th>Time</th><th>Type</th><th>Location</th><th>Photo</th>{admin && <th style={{ textAlign: 'right' }}>Actions</th>}
      </tr></thead><tbody>
        {displayed.map(a => (
          <tr key={a.id}>
            <td><strong>{a.employeeName || '-'}</strong></td>
            <td style={{ fontSize: '.8rem', whiteSpace: 'nowrap' }}>{formatDate(a.date)}</td>
            <td style={{ fontSize: '.82rem' }}>{a.time || '-'}</td>
            <td><span className="st" style={{ background: a.type === 'Check In' ? 'rgba(0,184,148,.12)' : 'rgba(232,131,12,.12)', color: a.type === 'Check In' ? '#00a381' : '#d68910' }}>{a.type}</span></td>
            <td style={{ fontSize: '.8rem' }}>
              {a.lat && a.lng
                ? <a href={a.mapLink || `https://www.google.com/maps?q=${a.lat},${a.lng}`} target="_blank" rel="noreferrer" style={{ color: 'var(--pri)', display: 'inline-flex', alignItems: 'center', gap: 3 }}><span className="material-icons-round" style={{ fontSize: 15 }}>place</span> View{a.accuracy ? ` (±${Math.round(a.accuracy)}m)` : ''}</a>
                : '-'}
            </td>
            <td>{isSafeUrl(a.photoUrl) ? <a href={a.photoUrl} target="_blank" rel="noreferrer"><img src={a.photoUrl} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--bor)' }} /></a> : '-'}</td>
            {admin && <td style={{ textAlign: 'right' }}><button className="btn bsm bo" onClick={() => handleDelete(a.id)} title="Delete" style={{ padding: '4px 8px', color: 'var(--err)', borderColor: 'rgba(231,76,60,.3)' }}><span className="material-icons-round" style={{ fontSize: 15 }}>delete</span></button></td>}
          </tr>
        ))}
        {!visible.length && <tr><td colSpan={admin ? 7 : 6}><EmptyState icon="location_off" title="No attendance yet" message="Mark attendance with your live location and a photo." /></td></tr>}
      </tbody></table></div>
      {hasMore && <div style={{ textAlign: 'center', padding: 16 }}><button className="btn bsm bo" onClick={() => setVisibleCount(c => c + PAGE_SIZE)}>Show More ({visible.length - visibleCount} remaining)</button></div>}
      </div></div>

      {modal && <MarkModal suggestedType={suggestedType} onSave={handleSave} onClose={() => setModal(false)} />}
    </>
  );
}

function MarkModal({ suggestedType, onSave, onClose }) {
  const { toast } = useToast();
  const [type, setType] = useState(suggestedType);
  const [loc, setLoc] = useState(null);      // { lat, lng, accuracy }
  const [locStatus, setLocStatus] = useState('');
  const [locating, setLocating] = useState(false);
  const [photo, setPhoto] = useState(null);  // { file, preview }
  const [photoUrl, setPhotoUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const captureLocation = () => {
    if (!('geolocation' in navigator)) { setLocStatus('Location is not supported on this device.'); return; }
    setLocating(true); setLocStatus('Getting your location…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        setLoc({ lat: +latitude.toFixed(6), lng: +longitude.toFixed(6), accuracy });
        setLocStatus(`Location captured (±${Math.round(accuracy)}m)`);
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        setLocStatus(err.code === 1 ? 'Location permission denied — please allow location access.' : 'Could not get location. Try again outdoors.');
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  };

  const onPickPhoto = async (e) => {
    const file = (e.target.files || [])[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast('Photo is larger than 10 MB', 'er'); return; }
    setPhoto({ file, preview: URL.createObjectURL(file) });
    try {
      setUploading(true);
      const res = await apiUpload(file, 'attendance');
      setPhotoUrl(res.url);
    } catch (err) { toast(err.message || 'Photo upload failed', 'er'); setPhoto(null); }
    finally { setUploading(false); }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!loc) { toast('Capture your location first', 'er'); return; }
    if (!photoUrl) { toast('Capture a photo first', 'er'); return; }
    setSaving(true);
    try {
      await onSave({ type, lat: loc.lat, lng: loc.lng, accuracy: loc.accuracy, mapLink: `https://www.google.com/maps?q=${loc.lat},${loc.lng}`, photoUrl });
    } finally { setSaving(false); }
  };

  const ready = loc && photoUrl && !uploading;

  return (
    <Modal title="Mark Attendance" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="mb">
          <div className="fg"><label>Type</label>
            <select className="fi" value={type} onChange={e => setType(e.target.value)}>
              <option>Check In</option><option>Check Out</option>
            </select>
          </div>

          {/* Step 1 — GPS (mandatory) */}
          <div className="fg">
            <label>1. Location {loc && <span style={{ color: 'var(--ok)' }}>✓</span>}</label>
            <button type="button" className="btn bo" onClick={captureLocation} disabled={locating} style={{ display: 'inline-flex', gap: 6 }}>
              <span className="material-icons-round" style={{ fontSize: 18 }}>my_location</span>{locating ? 'Locating…' : (loc ? 'Re-capture location' : 'Capture location')}
            </button>
            {locStatus && <small className="lg-hint" style={{ color: loc ? 'var(--ok)' : 'var(--muted)' }}>{locStatus}</small>}
            {loc && <div style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: 4 }}>Lat {loc.lat}, Lng {loc.lng}</div>}
          </div>

          {/* Step 2 — Photo (mandatory) */}
          <div className="fg">
            <label>2. Photo {photoUrl && <span style={{ color: 'var(--ok)' }}>✓</span>}</label>
            <label className="btn bo" style={{ display: 'inline-flex', gap: 6, cursor: 'pointer' }}>
              <span className="material-icons-round" style={{ fontSize: 18 }}>photo_camera</span>{photo ? 'Retake photo' : 'Capture photo'}
              <input type="file" accept="image/*" capture="environment" onChange={onPickPhoto} style={{ display: 'none' }} />
            </label>
            {uploading && <small className="lg-hint">Uploading photo…</small>}
            {photo && <div style={{ marginTop: 8 }}><img src={photo.preview} alt="Attendance" style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--bor)' }} /></div>}
          </div>

          {!ready && <p style={{ fontSize: '.8rem', color: 'var(--muted)' }}>Both live location and a photo are required to mark attendance.</p>}
        </div>
        <div className="mf">
          <button type="button" className="btn bo" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn bp" disabled={!ready || saving}>{saving ? 'Saving…' : `Mark ${type}`}</button>
        </div>
      </form>
    </Modal>
  );
}
