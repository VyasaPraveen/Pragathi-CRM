import React, { useState } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { addDocument, updateDocument, createNotification } from '../services/firestore';
import { apiUpload } from '../services/api';
import { formatDate, toNumber, safeStr, isSafeUrl } from '../services/helpers';
import { StatusBadge, DetailItem, ProgressBar, Modal, EmptyState, SearchSelect, DateFilter } from '../components/SharedUI';
import { DATE_FILTER_ALL, applyDateFilter } from '../services/dateFilter';
import { findCustomerByPhone, findCustomerByName, customerPickerOptions, applyCustomerToForm } from '../services/installations';
import {
  canManageInstallations, canEditInstallation, INSTALLATION_TEAM_SIZES,
  installationTeamMembers, installationTeamChanges, normalizeRole,
} from '../services/permissions';
import { directoryPeople } from '../services/people';

const PAGE_SIZE = 10;
// An installation's day for the Day / Month filter: its start date, else when it was recorded.
const INSTALLATION_DATE_FIELDS = ['startDate', 'createdAt'];

export default function Installations() {
  const { installations, users } = useData();
  const { role, user } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [dateFilter, setDateFilter] = useState(DATE_FILTER_ALL);
  // R6.3 (8-Oct): adding is a manager-level job, plus whoever an Admin has
  // granted it to (P. Ganesh). Editing is that, or being the installation's
  // own Team Leader — decided per card below.
  const canAdd = canManageInstallations(user, role);
  const meName = user?.displayName || user?.email || '';

  let filtered = installations;
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(i =>
      safeStr(i.customerName).toLowerCase().includes(q) ||
      safeStr(i.phone).includes(q) ||
      safeStr(i.address).toLowerCase().includes(q) ||
      safeStr(i.teamLeader).toLowerCase().includes(q) ||
      (Array.isArray(i.teamMembers) && i.teamMembers.some(m => safeStr(m).toLowerCase().includes(q)))
    );
  }
  filtered = applyDateFilter(filtered, dateFilter, INSTALLATION_DATE_FIELDS);
  const displayed = filtered.slice(0, visibleCount);
  const hasMore = filtered.length > visibleCount;

  // R6.4: the Team Leader and every member newly put on the installation are
  // told. Someone already on it is not told again on every edit.
  const tellTeam = (inst, prev, id) => {
    const { leaderChanged, newLeader, newMembers } = installationTeamChanges(prev, inst);
    const where = [inst.customerName, inst.address].filter(Boolean).join(', ');
    const crew = `Team Leader: ${inst.teamLeader || '-'}${(inst.teamMembers || []).length ? ' · Members: ' + inst.teamMembers.join(', ') : ''}`;
    const seen = new Set();
    const tell = (name, title, roleText) => {
      const key = String(name || '').trim();
      if (!key || seen.has(key.toLowerCase()) || key === meName) return;
      seen.add(key.toLowerCase());
      createNotification({
        forUser: key, title,
        message: `${meName} put you on the installation for "${where}" as ${roleText}${inst.startDate ? ' · starts ' + formatDate(inst.startDate) : ''}. ${crew}.`,
        type: 'task', module: 'installations', relatedId: id,
      });
    };
    if (leaderChanged) tell(newLeader, 'Installation Team Leader', 'the Team Leader');
    newMembers.forEach(m => tell(m, 'Installation Team Assignment', 'a team member'));
  };

  const handleSave = async (data, id) => {
    try {
      data.progress = Math.min(100, Math.max(0, toNumber(data.progress)));
      data.floors = toNumber(data.floors);
      data.teamMembers = installationTeamMembers(data.teamMembers, data.numPeople, data.teamLeader);
      const prev = id ? installations.find(i => i.id === id) : null;
      if (id) { await updateDocument('installations', id, data); toast('Installation updated'); tellTeam(data, prev, id); }
      else { const newId = await addDocument('installations', data); toast('Installation added'); tellTeam(data, null, newId); }
      setModal(null);
    } catch (e) { toast(e.message, 'er'); }
  };

  return (
    <>
      <div className="tl">
        <div className="sb-x"><span className="material-icons-round">search</span><input type="text" placeholder="Search installations..." value={search} onChange={e => setSearch(e.target.value)} /></div>
        {canAdd && <button className="btn bp bsm" onClick={() => setModal({ data: {} })}><span className="material-icons-round" style={{ fontSize: 18 }}>add</span> Add Installation</button>}
      </div>
      <div style={{ marginBottom: 12 }}><DateFilter value={dateFilter} onChange={setDateFilter} records={installations} fields={INSTALLATION_DATE_FIELDS} /></div>
      {displayed.map(inst => {
        const mayEdit = canEditInstallation(inst, user, role);
        return (
          <div className="card" style={{ marginBottom: 16 }} key={inst.id}>
            <div className="ch">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="material-icons-round" style={{ color: 'var(--sec)' }}>solar_power</span>{inst.customerName}</h3>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontWeight: 700, color: 'var(--pri)' }}>{inst.progress}%</span>
                {mayEdit && <button className="btn bsm bo" onClick={() => setModal({ data: inst, id: inst.id })}><span className="material-icons-round" style={{ fontSize: 16 }}>edit</span> Edit</button>}
              </div>
            </div>
            <div className="cb">
              <div style={{ marginBottom: 18, height: 10 }}><ProgressBar value={inst.progress} /></div>
              <div className="dg">
                <DetailItem label="Phone" value={inst.phone} /><DetailItem label="Address" value={inst.address} />
                <DetailItem label="Site Visit" value={inst.siteVisitStatus === 'Visited' ? <span className="st st-g">Visited</span> : <span className="st st-x">Not Visited</span>} />
                <DetailItem label="Roof Type" value={inst.roofType} /><DetailItem label="Floors" value={inst.floors} />
                <DetailItem label="Structure" value={inst.structureType} /><DetailItem label="Start Date" value={formatDate(inst.startDate)} />
                <DetailItem label="Total Days" value={inst.totalDays} /><DetailItem label="Team Size" value={inst.numPeople} />
                <DetailItem label="Team Leader" value={inst.teamLeader} />
                {Array.isArray(inst.teamMembers) && inst.teamMembers.length > 0 && <DetailItem label="Team Members" value={inst.teamMembers.join(', ')} />}
                <DetailItem label="Material Dispatch" value={inst.materialDispatched === 'Yes' ? <span className="st st-g">Dispatched</span> : <span className="st st-o">Pending</span>} />
                <DetailItem label="Quality Inspection" value={<StatusBadge status={inst.qualityInspection || 'Pending'} />} />
                <DetailItem label="Guarantee Card" value={inst.guaranteeCard === 'Yes' ? <span className="st st-g">Issued</span> : <span className="st st-x">No</span>} />
              </div>
              {/* R5 (8-Oct): the DISCOM & Subsidy block that sat here is gone.
                  Those stages are now tracked in BCO Operations on the lead. */}
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--bor)' }}>
                <h4 style={{ fontSize: '.88rem', fontWeight: 700, marginBottom: 10 }}>Material Consumption</h4>
                <div className="dg">
                  <DetailItem label="AC Cable" value={`${inst.acCableQty || '-'} mtrs ${inst.acCableSize ? '(' + inst.acCableSize + ' mm)' : ''}`} />
                  <DetailItem label="DC Cable" value={`${inst.dcCableQty || '-'} mtrs ${inst.dcCableSize ? '(' + inst.dcCableSize + ' mm)' : ''}`} />
                  <DetailItem label="Earth Cable" value={`${inst.earthCable || '-'} mtrs ${inst.earthCableSize ? '(' + inst.earthCableSize + ' mm)' : ''}`} />
                  <DetailItem label="UPVC Pipes" value={`${inst.upvcPipes || '-'} pcs ${inst.upvcPipeSize ? '(' + inst.upvcPipeSize + ' mm)' : ''}`} />
                </div>
              </div>
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--bor)' }}>
                <div className="dg">
                  <DetailItem label="1st Service" value={formatDate(inst.firstServiceDate)} />
                  <DetailItem label="Next Service" value={formatDate(inst.nextServiceDate)} />
                  <DetailItem label="Customer Reference" value={inst.customerReference === 'Yes' ? <span className="st st-g">Yes</span> : 'No'} />
                  {inst.referenceLeadName && <DetailItem label="Reference Lead" value={inst.referenceLeadName} />}
                  {inst.referencePhoneNumber && <DetailItem label="Reference Phone" value={inst.referencePhoneNumber} />}
                  <DetailItem label="Consumption Report" value={isSafeUrl(inst.consumptionReportUrl)
                    ? <a href={inst.consumptionReportUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--pri)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <span className="material-icons-round" style={{ fontSize: 16 }}>description</span>{inst.consumptionReportName || 'Open document'}
                      </a>
                    : 'Not uploaded'} />
                </div>
                {/* A hand sketch saved before 8-Oct is still shown; the form no longer asks for one. */}
                {inst.handSketch && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: '.76rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 6 }}>Hand Sketch</div>
                    <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--bor)', maxWidth: 300 }}>
                      <img src={inst.handSketch} alt="Hand Sketch" style={{ width: '100%', objectFit: 'contain' }} onError={e => { e.target.style.display = 'none'; }} />
                    </div>
                  </div>
                )}
                {inst.installationReport && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: '.76rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 6 }}>Installation Report</div>
                    <div style={{ fontSize: '.88rem', lineHeight: 1.6, background: '#fafbfc', padding: 12, borderRadius: 8, border: '1px solid var(--bor)', whiteSpace: 'pre-wrap' }}>{inst.installationReport}</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
      {hasMore && <div style={{ textAlign: 'center', padding: 16 }}><button className="btn bsm bo" onClick={() => setVisibleCount(c => c + PAGE_SIZE)}>Show More ({filtered.length - visibleCount} remaining)</button></div>}
      {!filtered.length && <div className="card"><div className="cb"><EmptyState icon="solar_power" title="No installations" message={search ? 'No installations match your search.' : (canAdd ? 'Add your first installation.' : 'No installations yet.')} /></div></div>}
      {modal && <InstallationModal data={modal.data} id={modal.id} users={users} onSave={handleSave} onClose={() => setModal(null)} />}
    </>
  );
}

// Roles that lead a crew on site, offered first in the Team Leader picker.
const LEADER_ROLES = ['team_leader', 'technical_manager', 'operation_manager'];

function InstallationModal({ data, id, users, onSave, onClose }) {
  const d = data;
  const { toast } = useToast();
  // R3 (8-Oct): the customer is picked from the Customers section, which
  // carries the name and phone over from the lead. The leads are read only
  // for the site details a customer record does not hold. Nothing on this
  // form writes back to either.
  const { customers, leads } = useData();
  const [matched, setMatched] = useState(null);
  const pickerOptions = React.useMemo(() => customerPickerOptions(customers, leads), [customers, leads]);
  // R6.4: the Team Leader and the members come from the people with logins.
  const people = React.useMemo(() => directoryPeople(users), [users]);
  const leaderNames = React.useMemo(() => {
    const leaders = people.filter(p => LEADER_ROLES.includes(normalizeRole(p.role))).map(p => p.name);
    const rest = people.filter(p => !LEADER_ROLES.includes(normalizeRole(p.role))).map(p => p.name);
    const list = [...leaders, ...rest];
    // Whoever is already named stays on the list even if their account has gone.
    if (d.teamLeader && !list.some(n => n.toLowerCase() === String(d.teamLeader).toLowerCase())) list.unshift(d.teamLeader);
    return list;
  }, [people, d.teamLeader]);
  const leaderSet = React.useMemo(() => new Set(people.filter(p => LEADER_ROLES.includes(normalizeRole(p.role))).map(p => p.name)), [people]);
  const leaderGroup = (n) => (leaderSet.has(n) ? 'Team Leaders' : 'Everyone else');
  const [uploading, setUploading] = useState(false);
  const [f, setF] = useState({
    leadId: d.leadId || '', customerId: d.customerId || '',
    customerName: d.customerName || '', phone: d.phone || '', address: d.address || '',
    siteVisitStatus: d.siteVisitStatus || 'Not Visited',
    roofType: d.roofType || 'RCC', floors: d.floors || 1, structureType: d.structureType || 'Flat',
    startDate: d.startDate || '', totalDays: d.totalDays || '', teamLeader: d.teamLeader || '',
    numPeople: d.numPeople || '', teamMembers: Array.isArray(d.teamMembers) ? d.teamMembers : [],
    materialDispatched: d.materialDispatched || 'No', progress: d.progress || 0,
    qualityInspection: d.qualityInspection || 'Pending', guaranteeCard: d.guaranteeCard || 'No',
    customerReference: d.customerReference || 'No',
    firstServiceDate: d.firstServiceDate || '', nextServiceDate: d.nextServiceDate || '',
    // Phase 2: Reference fields
    referenceLeadName: d.referenceLeadName || '',
    referencePhoneNumber: d.referencePhoneNumber || '',
    // Phase 2: Material consumption (qty + size)
    acCableQty: d.acCableQty || '', acCableSize: d.acCableSize || '',
    dcCableQty: d.dcCableQty || '', dcCableSize: d.dcCableSize || '',
    earthCable: d.earthCable || '', earthCableSize: d.earthCableSize || '',
    upvcPipes: d.upvcPipes || '', upvcPipeSize: d.upvcPipeSize || '',
    // R5 (8-Oct): the Consumption Report document replaces the hand-sketch URL.
    consumptionReportUrl: d.consumptionReportUrl || '',
    consumptionReportName: d.consumptionReportName || '',
    installationReport: d.installationReport || '',
    // The DISCOM & Subsidy fields and their dates are no longer on this form
    // (R5). Values already saved on a record are left exactly as they are.
  });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  // Bring a customer's details (and their lead's site details) onto the form.
  // Fields neither holds are left as they are.
  const applyCustomer = (customer) => {
    if (!customer) return;
    setF(p => applyCustomerToForm(p, customer, leads));
    setMatched(customer);
  };
  // Typing a known phone number or an exact customer name finds the customer
  // by itself; the picker is for everyone else.
  const matchPhone = (v) => { set('phone', v); const c = findCustomerByPhone(customers, v); if (c && c.id !== f.customerId) applyCustomer(c); };
  const matchName = (v) => { set('customerName', v); const c = findCustomerByName(customers, v); if (c && c.id !== f.customerId) applyCustomer(c); };

  // The member slots follow the team size; a member can be anyone with a
  // login other than the leader, and nobody twice.
  const teamSize = Math.max(0, Math.min(toNumber(f.numPeople), 20));
  const memberOptions = (slot) => {
    const taken = new Set([f.teamLeader, ...f.teamMembers.filter((_, i) => i !== slot)].map(n => String(n || '').toLowerCase()));
    return people.map(p => p.name).filter(n => !taken.has(n.toLowerCase()));
  };
  const setMember = (slot, name) => setF(p => {
    const next = [...(p.teamMembers || [])];
    while (next.length <= slot) next.push('');
    next[slot] = name || '';
    return { ...p, teamMembers: next };
  });

  const onPickReport = async (e) => {
    const file = (e.target.files || [])[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast('That file is over 10 MB — please attach a smaller one.', 'er'); return; }
    setUploading(true);
    try {
      const res = await apiUpload(file, 'installations');
      setF(p => ({ ...p, consumptionReportUrl: res.url, consumptionReportName: file.name }));
      toast('Consumption report attached');
    } catch (err) { toast(err.message || 'Upload failed', 'er'); }
    finally { setUploading(false); }
  };

  return (
    <Modal title={id ? 'Edit Installation' : 'New Installation'} onClose={onClose} wide>
      <form onSubmit={e => { e.preventDefault(); onSave(f, id); }}>
        <div className="mb">
          {/* From the Customers section: pick the customer and their details
              fill in below. One way only — nothing is written back. */}
          <div className="fg">
            <label>Customer <span style={{ fontSize: '.74rem', color: 'var(--muted)', fontWeight: 400 }}>from the Customers section — pick one to fill the details below</span></label>
            <SearchSelect value="" options={[...pickerOptions.keys()]} allowFree={false}
              placeholder={pickerOptions.size ? 'Search a customer by name or phone…' : 'No customers on file yet'}
              emptyText="No matching customer" onChange={label => applyCustomer(pickerOptions.get(label))} />
            {matched && (
              <small style={{ display: 'block', marginTop: 4, color: 'var(--ok)' }}>
                <span className="material-icons-round" style={{ fontSize: 14, verticalAlign: '-2px' }}>link</span>{' '}
                Details taken from customer <strong>{matched.name}</strong>{matched.phone ? ` (${matched.phone})` : ''}. The customer and lead records are not changed by anything entered here.
              </small>
            )}
          </div>
          <div className="fr"><div className="fg"><label>Customer Name *</label><input className="fi" value={f.customerName} onChange={e => matchName(e.target.value)} required /></div><div className="fg"><label>Phone</label><input className="fi" value={f.phone} onChange={e => matchPhone(e.target.value)} /></div></div>
          <div className="fr"><div className="fg"><label>Address</label><input className="fi" value={f.address} onChange={e => set('address', e.target.value)} /></div><div className="fg"><label>Site Visit Status</label><select className="fi" value={f.siteVisitStatus} onChange={e => set('siteVisitStatus', e.target.value)}><option>Not Visited</option><option>Visited</option></select></div></div>
          <div className="fr3"><div className="fg"><label>Roof Type</label><select className="fi" value={f.roofType} onChange={e => set('roofType', e.target.value)}><option>RCC</option><option>Sheet</option><option>Tile</option></select></div><div className="fg"><label>Floors</label><input type="number" className="fi" value={f.floors} onChange={e => set('floors', e.target.value)} /></div><div className="fg"><label>Structure</label><select className="fi" value={f.structureType} onChange={e => set('structureType', e.target.value)}><option>Flat</option><option>Sloped</option></select></div></div>
          <div className="fr"><div className="fg"><label>Start Date</label><input type="date" className="fi" value={f.startDate} onChange={e => set('startDate', e.target.value)} /></div><div className="fg"><label>Total Days</label><input type="number" className="fi" value={f.totalDays} onChange={e => set('totalDays', e.target.value)} /></div></div>

          {/* R6.4 (8-Oct): the team. The leader is chosen from the system's
              people, the size sets how many member slots appear, and everyone
              chosen is notified when the installation is saved. */}
          <div style={{ borderTop: '1px solid var(--bor)', margin: '14px 0', paddingTop: 14 }}><label style={{ fontWeight: 700, fontSize: '.88rem' }}>Installation Team</label>
            <div className="fr" style={{ marginTop: 10 }}>
              <div className="fg"><label>Team Leader</label>
                <SearchSelect value={f.teamLeader} onChange={v => set('teamLeader', v)} options={leaderNames} allowFree={false} groups={leaderGroup} placeholder="Select the Team Leader…" />
              </div>
              <div className="fg"><label>Team Size</label>
                <select className="fi" value={f.numPeople} onChange={e => set('numPeople', e.target.value)}>
                  <option value="">-- Select --</option>
                  {INSTALLATION_TEAM_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
                  {/* A size typed on an older record that is not in the list stays selectable. */}
                  {f.numPeople && !INSTALLATION_TEAM_SIZES.includes(toNumber(f.numPeople)) && <option value={f.numPeople}>{f.numPeople}</option>}
                </select>
              </div>
            </div>
            {teamSize > 0 && (
              <div className="fr" style={{ flexWrap: 'wrap' }}>
                {Array.from({ length: teamSize }, (_, i) => (
                  <div className="fg" key={i} style={{ minWidth: 200 }}><label>Team Member {i + 1}</label>
                    <SearchSelect value={f.teamMembers[i] || ''} onChange={v => setMember(i, v)} options={memberOptions(i)} allowFree={false} placeholder="Select a member…" />
                  </div>
                ))}
              </div>
            )}
            <small style={{ color: 'var(--muted)', fontSize: '.76rem' }}>The Team Leader and each member are notified when this is saved. Members can see the assignment but cannot edit the installation; the Team Leader can.</small>
          </div>

          <div className="fr"><div className="fg"><label>Material Dispatched</label><select className="fi" value={f.materialDispatched} onChange={e => set('materialDispatched', e.target.value)}><option>No</option><option>Yes</option></select></div><div className="fg"><label>Progress %</label><input type="number" className="fi" value={f.progress} min="0" max="100" onChange={e => set('progress', e.target.value)} /></div></div>

          {/* Quality & Guarantee */}
          <div className="fr"><div className="fg"><label>Quality Inspection</label><select className="fi" value={f.qualityInspection} onChange={e => set('qualityInspection', e.target.value)}><option>Pending</option><option>Done</option><option>Approved</option></select></div><div className="fg"><label>Guarantee Card</label><select className="fi" value={f.guaranteeCard} onChange={e => set('guaranteeCard', e.target.value)}><option>No</option><option>Yes</option></select></div></div>

          {/* Material Consumption */}
          <div style={{ borderTop: '1px solid var(--bor)', margin: '14px 0', paddingTop: 14 }}><label style={{ fontWeight: 700, fontSize: '.88rem' }}>Material Consumption</label>
            <div className="fr" style={{ marginTop: 10 }}>
              <div className="fg"><label>AC Cable Qty (mtrs)</label><input type="number" className="fi" value={f.acCableQty} onChange={e => set('acCableQty', e.target.value)} /></div>
              <div className="fg"><label>AC Cable Size (mm)</label><input className="fi" value={f.acCableSize} onChange={e => set('acCableSize', e.target.value)} placeholder="e.g. 4mm" /></div>
            </div>
            <div className="fr">
              <div className="fg"><label>DC Cable Qty (mtrs)</label><input type="number" className="fi" value={f.dcCableQty} onChange={e => set('dcCableQty', e.target.value)} /></div>
              <div className="fg"><label>DC Cable Size (mm)</label><input className="fi" value={f.dcCableSize} onChange={e => set('dcCableSize', e.target.value)} placeholder="e.g. 6mm" /></div>
            </div>
            <div className="fr">
              <div className="fg"><label>Earth Cable (mtrs)</label><input type="number" className="fi" value={f.earthCable} onChange={e => set('earthCable', e.target.value)} /></div>
              <div className="fg"><label>Earth Cable Size (mm)</label><input className="fi" value={f.earthCableSize} onChange={e => set('earthCableSize', e.target.value)} placeholder="e.g. 4mm" /></div>
            </div>
            <div className="fr">
              <div className="fg"><label>UPVC Pipes (pcs)</label><input type="number" className="fi" value={f.upvcPipes} onChange={e => set('upvcPipes', e.target.value)} /></div>
              <div className="fg"><label>UPVC Pipe Size (mm)</label><input className="fi" value={f.upvcPipeSize} onChange={e => set('upvcPipeSize', e.target.value)} placeholder="e.g. 25mm" /></div>
            </div>
          </div>

          {/* Service Dates */}
          <div className="fr"><div className="fg"><label>1st Service Date</label><input type="date" className="fi" value={f.firstServiceDate} onChange={e => set('firstServiceDate', e.target.value)} /></div><div className="fg"><label>Next Service</label><input type="date" className="fi" value={f.nextServiceDate} onChange={e => set('nextServiceDate', e.target.value)} /></div></div>

          {/* R5 (8-Oct): the Consumption Report document, uploaded like any other
              document, in place of the hand-sketch URL fields. */}
          <div style={{ borderTop: '1px solid var(--bor)', margin: '14px 0', paddingTop: 14 }}><label style={{ fontWeight: 700, fontSize: '.88rem' }}>Consumption Report Document</label>
            <div className="fg" style={{ marginTop: 10 }}>
              <label className="btn bo" style={{ display: 'inline-flex', gap: 6, cursor: uploading ? 'wait' : 'pointer' }}>
                <span className="material-icons-round" style={{ fontSize: 18 }}>upload_file</span>
                {uploading ? 'Uploading…' : (f.consumptionReportUrl ? 'Replace document' : 'Upload document')}
                <input type="file" accept="application/pdf,image/*,.doc,.docx" onChange={onPickReport} disabled={uploading} style={{ display: 'none' }} />
              </label>
              {isSafeUrl(f.consumptionReportUrl) && (
                <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, fontSize: '.84rem' }}>
                  <span className="material-icons-round" style={{ fontSize: 18, color: 'var(--ok)' }}>task</span>
                  <a href={f.consumptionReportUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--pri)' }}>{f.consumptionReportName || 'Open the attached document'}</a>
                  <button type="button" className="btn bsm bo" onClick={() => setF(p => ({ ...p, consumptionReportUrl: '', consumptionReportName: '' }))} title="Remove" style={{ padding: '3px 8px', color: 'var(--err)', borderColor: 'rgba(231,76,60,.3)' }}>
                    <span className="material-icons-round" style={{ fontSize: 15 }}>close</span>
                  </button>
                </div>
              )}
              <small style={{ color: 'var(--muted)', fontSize: '.76rem', display: 'block', marginTop: 6 }}>PDF, image or Word document, up to 10 MB.</small>
            </div>
            <div className="fg"><label>Installation Report / Notes</label><textarea className="fi" value={f.installationReport} onChange={e => set('installationReport', e.target.value)} rows="3" placeholder="Enter installation report details..." /></div>
          </div>

          {/* Customer Reference */}
          <div style={{ borderTop: '1px solid var(--bor)', margin: '14px 0', paddingTop: 14 }}><label style={{ fontWeight: 700, fontSize: '.88rem' }}>Customer Reference</label>
            <div className="fg" style={{ marginTop: 10 }}><label>Has Reference?</label><select className="fi" value={f.customerReference} onChange={e => set('customerReference', e.target.value)}><option>No</option><option>Yes</option></select></div>
            {f.customerReference === 'Yes' && (
              <div className="fr">
                <div className="fg"><label>Reference Lead Name</label><input className="fi" value={f.referenceLeadName} onChange={e => set('referenceLeadName', e.target.value)} /></div>
                <div className="fg"><label>Reference Phone Number</label><input className="fi" value={f.referencePhoneNumber} onChange={e => set('referencePhoneNumber', e.target.value)} /></div>
              </div>
            )}
          </div>
        </div>
        <div className="mf"><button type="button" className="btn bo" onClick={onClose}>Cancel</button><button type="submit" className="btn bp" disabled={uploading}>{id ? 'Update' : 'Add'}</button></div>
      </form>
    </Modal>
  );
}
