import React, { useState, useMemo, useEffect } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { addDocument, deleteDocument, createNotification } from '../services/firestore';
import { apiUpload } from '../services/api';
import { formatDate, safeStr, hasAccess, isSafeUrl, compressImage } from '../services/helpers';
import { Modal, EmptyState } from '../components/SharedUI';

const PAGE_SIZE = 30;
const today = () => new Date().toISOString().slice(0, 10);

// Marking attendance sends the phone to the camera app, and a low-memory phone
// can reload the page while that happens — which used to throw the employee back
// to the list and lose the location and photo they had already captured. The
// half-finished mark is kept here so the flow picks up exactly where it left off.
const DRAFT_KEY = 'pps_attendance_draft';
// localStorage, not sessionStorage: Android frees memory by killing the whole
// tab while the camera app is in front, and sessionStorage dies with it — which
// is exactly the case this draft exists for. Only kept for the current day.
const readDraft = () => {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    const d = raw ? JSON.parse(raw) : null;
    // A draft is only valid for the day it was started on.
    return d && d.date === today() ? d : null;
  } catch { return null; }
};
const writeDraft = (d) => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...d, date: today() })); } catch { /* private mode */ } };
const clearDraft = () => {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
  try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
};

export default function Attendance() {
  const { attendance, users } = useData();
  const { user, role } = useAuth();
  const { toast } = useToast();
  const [modal, setModal] = useState(false);
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [view, setView] = useState('mine');   // 'mine' = My Attendance
  const [month, setMonth] = useState(today().slice(0, 7));

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

  // A mark that was interrupted (phone reloaded the page while the camera was
  // open) reopens itself so the employee can finish it instead of starting over.
  useEffect(() => {
    if (readDraft()) setModal(true);
  }, []);

  // My Attendance — every mark of mine, folded into one row per day with the
  // first check-in, the last check-out and the hours between them.
  const myDays = useMemo(() => {
    const mine = attendance.filter(a => (a.employeeEmail && a.employeeEmail === myEmail) ||
      (!a.employeeEmail && a.employeeName === myName));
    const byDate = new Map();
    mine.forEach(a => {
      if (!a.date) return;
      const d = byDate.get(a.date) || { date: a.date, marks: [] };
      d.marks.push(a);
      byDate.set(a.date, d);
    });
    return [...byDate.values()].map(d => {
      const ordered = [...d.marks].sort((x, y) => new Date(x.createdAt || 0) - new Date(y.createdAt || 0));
      const inMark = ordered.find(m => m.type === 'Check In') || null;
      const outMark = [...ordered].reverse().find(m => m.type === 'Check Out') || null;
      let hours = null;
      if (inMark?.createdAt && outMark?.createdAt) {
        const diff = new Date(outMark.createdAt) - new Date(inMark.createdAt);
        if (diff > 0) hours = Math.round((diff / 3600000) * 100) / 100;
      }
      return { ...d, in: inMark, out: outMark, hours, present: !!inMark };
    }).sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [attendance, myEmail, myName]);

  const monthDays = myDays.filter(d => String(d.date).startsWith(month));
  const mySummary = useMemo(() => {
    const worked = monthDays.filter(d => d.hours != null);
    const totalHours = worked.reduce((s, d) => s + d.hours, 0);
    return {
      present: monthDays.filter(d => d.present).length,
      incomplete: monthDays.filter(d => d.present && !d.out).length,
      totalHours: Math.round(totalHours * 10) / 10,
      avgHours: worked.length ? Math.round((totalHours / worked.length) * 10) / 10 : 0,
    };
  }, [monthDays]);

  // The months the employee actually has marks in, newest first.
  const myMonths = useMemo(() => {
    const set = new Set(myDays.map(d => String(d.date).slice(0, 7)));
    set.add(today().slice(0, 7));
    return [...set].sort().reverse();
  }, [myDays]);

  // Attendance counts — these come straight off the live attendance list, so they
  // update on their own the moment a mark is saved.
  const counts = useMemo(() => {
    const d = today();
    const month = d.slice(0, 7);
    const todays = attendance.filter(a => a.date === d);
    const mine = attendance.filter(a => a.employeeEmail === myEmail);
    return {
      presentToday: new Set(todays.filter(a => a.type === 'Check In').map(a => a.employeeEmail || a.employeeName)).size,
      marksToday: todays.length,
      myMonth: new Set(mine.filter(a => a.type === 'Check In' && String(a.date || '').startsWith(month)).map(a => a.date)).size,
      myTotal: mine.filter(a => a.type === 'Check In').length,
    };
  }, [attendance, myEmail]);

  // Tell the Sales Manager and the other concerned members, with the photo and
  // the map link, so they can open the record straight from the notification.
  const notifyConcerned = (rec, who) => {
    const targets = (users || []).filter(u => ['sales_manager', 'admin', 'super_admin', 'management', 'operation_manager'].includes(u.role));
    const seen = new Set();
    targets.forEach(u => {
      const key = u.displayName || u.email;
      if (!key || seen.has(key) || key === who) return;
      seen.add(key);
      createNotification({
        forUser: key,
        title: `Attendance — ${rec.type}: ${who}`,
        message: `${who} marked ${rec.type} at ${rec.time} on ${formatDate(rec.date)}${rec.accuracy ? ` (±${Math.round(rec.accuracy)}m)` : ''}. Photo and location are on the Attendance screen.`,
        type: 'status_update', module: 'attendance', relatedId: rec.id || '',
      });
    });
  };

  const handleSave = async (rec) => {
    try {
      const full = {
        ...rec,
        employeeName: myName || myEmail,
        employeeEmail: myEmail,
        date: today(),
        time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      };
      const newId = await addDocument('attendance', full);
      clearDraft();
      notifyConcerned({ ...full, id: newId }, myName || myEmail);
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

      {/* My Attendance is the default view; managers can switch to the whole team. */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {[['mine', 'My Attendance'], ['all', canSeeAll ? 'Staff Attendance' : 'My Records']].map(([k, label]) => (
          <span key={k} className={`fc ${view === k ? 'act' : ''}`} onClick={() => setView(k)}>{label}</span>
        ))}
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

      {/* Attendance counts — refresh automatically as marks come in */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 16 }}>
        {[
          canSeeAll ? ['Present Today', counts.presentToday, 'groups', '#27ae60'] : null,
          canSeeAll ? ['Marks Today', counts.marksToday, 'fact_check', 'var(--pri)'] : null,
          ['My Days This Month', counts.myMonth, 'calendar_month', '#6c5ce7'],
          ['My Total Check-Ins', counts.myTotal, 'how_to_reg', '#e8830c'],
        ].filter(Boolean).map(([label, val, icon, color]) => (
          <div className="card" key={label}><div className="cb" style={{ textAlign: 'center', padding: '14px 10px' }}>
            <span className="material-icons-round" style={{ fontSize: 26, color, display: 'block', marginBottom: 4 }}>{icon}</span>
            <div style={{ fontSize: '1.15rem', fontWeight: 700 }}>{val}</div>
            <div style={{ fontSize: '.74rem', color: 'var(--muted)' }}>{label}</div>
          </div></div>
        ))}
      </div>

      {view === 'mine' && (
        <div className="card" style={{ marginBottom: 16 }}><div className="cb">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <strong style={{ fontSize: '.95rem' }}>My Attendance</strong>
            <select className="fi" style={{ width: 'auto', padding: '6px 10px' }} value={month} onChange={e => setMonth(e.target.value)}>
              {myMonths.map(m => <option key={m} value={m}>{new Date(m + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10, marginBottom: 14 }}>
            {[
              ['Days Present', mySummary.present, '#27ae60'],
              ['Total Hours', mySummary.totalHours, 'var(--pri)'],
              ['Avg Hours / Day', mySummary.avgHours, '#6c5ce7'],
              ['Days Without Check-Out', mySummary.incomplete, mySummary.incomplete ? '#e67e22' : 'var(--muted)'],
            ].map(([label, val, color]) => (
              <div key={label} style={{ border: '1px solid var(--bor)', borderRadius: 10, padding: '10px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: '1.15rem', fontWeight: 700, color }}>{val}</div>
                <div style={{ fontSize: '.72rem', color: 'var(--muted)' }}>{label}</div>
              </div>
            ))}
          </div>
          {monthDays.length ? (
            <div className="tw"><table><thead><tr>
              <th>Date</th><th>Check In</th><th>Check Out</th><th>Hours</th><th>Location</th><th>Photo</th>
            </tr></thead><tbody>
              {monthDays.map(d => (
                <tr key={d.date}>
                  <td style={{ whiteSpace: 'nowrap', fontSize: '.82rem' }}>{formatDate(d.date)}</td>
                  <td style={{ fontSize: '.82rem' }}>{d.in?.time || '-'}</td>
                  <td style={{ fontSize: '.82rem' }}>{d.out?.time || <span style={{ color: '#e67e22' }}>Not marked</span>}</td>
                  <td style={{ fontSize: '.82rem', fontWeight: 600 }}>{d.hours != null ? d.hours + ' h' : '-'}</td>
                  <td style={{ fontSize: '.8rem' }}>
                    {d.in?.lat && d.in?.lng
                      ? <a href={d.in.mapLink || `https://www.google.com/maps?q=${d.in.lat},${d.in.lng}`} target="_blank" rel="noreferrer" style={{ color: 'var(--pri)' }}>View</a>
                      : '-'}
                  </td>
                  <td>{isSafeUrl(d.in?.photoUrl) ? <a href={d.in.photoUrl} target="_blank" rel="noreferrer"><img src={d.in.photoUrl} alt="" style={{ width: 34, height: 34, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--bor)' }} /></a> : '-'}</td>
                </tr>
              ))}
            </tbody></table></div>
          ) : (
            <EmptyState icon="event_busy" title="No attendance this month" message="Marks you make will appear here with the hours worked." />
          )}
        </div></div>
      )}

      {view === 'all' && (
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
      )}

      {modal && <MarkModal suggestedType={suggestedType} onSave={handleSave} onClose={() => { clearDraft(); setModal(false); }} />}
    </>
  );
}

function MarkModal({ suggestedType, onSave, onClose }) {
  const { toast } = useToast();
  const draft = readDraft();
  const [type, setType] = useState(draft?.type || suggestedType);
  const [loc, setLoc] = useState(draft?.loc || null);      // { lat, lng, accuracy }
  const [locStatus, setLocStatus] = useState('');
  const [locating, setLocating] = useState(false);
  const [photo, setPhoto] = useState(null);                // { file, preview }
  const [photoUrl, setPhotoUrl] = useState(draft?.photoUrl || '');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
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

  // Ask for the location as soon as the screen opens, so it is already captured
  // by the time the employee takes the photo — no separate step to forget.
  useEffect(() => {
    if (!loc) captureLocation();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the half-finished mark so a reload during the camera does not lose it.
  useEffect(() => { writeDraft({ type, loc, photoUrl }); }, [type, loc, photoUrl]);

  const onPickPhoto = async (e) => {
    const file = (e.target.files || [])[0];
    if (!file) return;
    setPhoto({ file, preview: URL.createObjectURL(file) });
    setUploadError('');
    try {
      setUploading(true);
      // A phone photo is far bigger than this needs to be; sending it whole is
      // slow on mobile data and is rejected outright above 10 MB.
      const small = await compressImage(file);
      if (small.size > 10 * 1024 * 1024) {
        throw new Error('Photo is too large even after compression. Take the photo at a lower resolution.');
      }
      let res;
      try {
        res = await apiUpload(small, 'attendance');
      } catch (first) {
        // One retry — a dropped connection as the camera closes is common.
        res = await apiUpload(small, 'attendance');
      }
      setPhotoUrl(res.url);
      // The camera can take a while; if location was refused or timed out
      // earlier, try again now so the record is never saved without it.
      if (!loc) captureLocation();
    } catch (err) {
      const msg = err.message || 'Photo upload failed';
      setUploadError(msg);
      toast(msg, 'er');
      // The picked photo stays on screen so "Retry upload" can use it without
      // sending the employee back to the camera.
    }
    finally { setUploading(false); }
  };

  // Retry the upload of the photo already taken, without re-opening the camera.
  const retryUpload = async () => {
    if (!photo?.file || uploading) return;
    setUploadError('');
    try {
      setUploading(true);
      const small = await compressImage(photo.file);
      const res = await apiUpload(small, 'attendance');
      setPhotoUrl(res.url);
      if (!loc) captureLocation();
    } catch (err) {
      const msg = err.message || 'Photo upload failed';
      setUploadError(msg); toast(msg, 'er');
    } finally { setUploading(false); }
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
            <label>1. Location (captured automatically) {loc && <span style={{ color: 'var(--ok)' }}>✓</span>}</label>
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
            {uploadError && !uploading && (
              <div style={{ marginTop: 6 }}>
                <small style={{ color: 'var(--err)', display: 'block', marginBottom: 4 }}>{uploadError}</small>
                {photo?.file && (
                  <button type="button" className="btn bsm bo" onClick={retryUpload}>
                    <span className="material-icons-round" style={{ fontSize: 16 }}>refresh</span> Retry upload
                  </button>
                )}
              </div>
            )}
            {(photo || (photoUrl && isSafeUrl(photoUrl))) && (
              <div style={{ marginTop: 8 }}>
                <img src={photo ? photo.preview : photoUrl} alt="Attendance" style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--bor)' }} />
                {!photo && <div style={{ fontSize: '.76rem', color: 'var(--ok)', marginTop: 4 }}>Photo restored — carry on where you left off.</div>}
              </div>
            )}
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
