import React, { useState } from 'react';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { addDocument, updateDocument } from '../services/firestore';
import { formatDate, toNumber } from '../services/helpers';
import { StatusBadge, DetailItem, ProgressBar, Modal, EmptyState } from '../components/SharedUI';

export default function Installations() {
  const { installations } = useData();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);

  const handleSave = async (data, id) => {
    try {
      data.progress = toNumber(data.progress);
      data.floors = toNumber(data.floors);
      if (id) { await updateDocument('installations', id, data); toast('Installation updated'); }
      else { await addDocument('installations', data); toast('Installation added'); }
      setModal(null);
    } catch (e) { toast(e.message, 'er'); }
  };

  return (
    <>
      <div className="tl">
        <div className="sb-x"><span className="material-icons-round">search</span><input type="text" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} /></div>
        <button className="btn bp bsm" onClick={() => setModal({ data: {} })}><span className="material-icons-round" style={{ fontSize: 18 }}>add</span> Add Installation</button>
      </div>
      {installations.map(inst => {
        return (
          <div className="card" style={{ marginBottom: 16 }} key={inst.id}>
            <div className="ch">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="material-icons-round" style={{ color: 'var(--sec)' }}>solar_power</span>{inst.customerName}</h3>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontWeight: 700, color: 'var(--pri)' }}>{inst.progress}%</span>
                <button className="btn bsm bo" onClick={() => setModal({ data: inst, id: inst.id })}><span className="material-icons-round" style={{ fontSize: 16 }}>edit</span> Edit</button>
              </div>
            </div>
            <div className="cb">
              <div style={{ marginBottom: 18, height: 10 }}><ProgressBar value={inst.progress} /></div>
              <div className="dg">
                <DetailItem label="Phone" value={inst.phone} /><DetailItem label="Address" value={inst.address} />
                <DetailItem label="Roof Type" value={inst.roofType} /><DetailItem label="Floors" value={inst.floors} />
                <DetailItem label="Structure" value={inst.structureType} /><DetailItem label="Start Date" value={formatDate(inst.startDate)} />
                <DetailItem label="Total Days" value={inst.totalDays} /><DetailItem label="Team Size" value={inst.numPeople} />
                <DetailItem label="Team Leader" value={inst.teamLeader} />
                <DetailItem label="Material Dispatch" value={inst.materialDispatched === 'Yes' ? <span className="st st-g">Dispatched</span> : <span className="st st-o">Pending</span>} />
                <DetailItem label="Quality Inspection" value={<StatusBadge status={inst.qualityInspection || 'Pending'} />} />
                <DetailItem label="Guarantee Card" value={inst.guaranteeCard === 'Yes' ? <span className="st st-g">Issued</span> : <span className="st st-x">No</span>} />
              </div>
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--bor)' }}>
                <h4 style={{ fontSize: '.88rem', fontWeight: 700, marginBottom: 10 }}>DISCOM & Subsidy</h4>
                <div className="dg">
                  <DetailItem label="Feasibility" value={<StatusBadge status={inst.discomFeasibility || 'Pending'} />} />
                  <DetailItem label="Doc Submission" value={<StatusBadge status={inst.docSubmission || 'Pending'} />} />
                  <DetailItem label="Inspection" value={<StatusBadge status={inst.discomInspection || 'Pending'} />} />
                  <DetailItem label="Meter Change" value={<StatusBadge status={inst.meterChange || 'Pending'} />} />
                  <DetailItem label="Flagging" value={<StatusBadge status={inst.flaggingStatus || 'Pending'} />} />
                  <DetailItem label="Subsidy" value={<StatusBadge status={inst.subsidyStatus || 'Pending'} />} />
                </div>
              </div>
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--bor)' }}>
                <h4 style={{ fontSize: '.88rem', fontWeight: 700, marginBottom: 10 }}>Material Consumption</h4>
                <div className="dg">
                  <DetailItem label="AC Cable" value={`${inst.acCableQty || '-'} ${inst.acCableSize || ''}`} />
                  <DetailItem label="DC Cable" value={`${inst.dcCableQty || '-'} ${inst.dcCableSize || ''}`} />
                  <DetailItem label="Earth Cable" value={`${inst.earthCable || '-'} mtrs`} />
                  <DetailItem label="UPVC Pipes" value={`${inst.upvcPipes || '-'} pcs`} />
                </div>
              </div>
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--bor)' }}>
                <div className="dg">
                  <DetailItem label="1st Service" value={formatDate(inst.firstServiceDate)} />
                  <DetailItem label="Next Service" value={formatDate(inst.nextServiceDate)} />
                  <DetailItem label="Customer Reference" value={inst.customerReference === 'Yes' ? <span className="st st-g">Yes</span> : 'No'} />
                  {inst.referenceLeadName && <DetailItem label="Reference Lead" value={inst.referenceLeadName} />}
                </div>
              </div>
            </div>
          </div>
        );
      })}
      {!installations.length && <div className="card"><div className="cb"><EmptyState icon="solar_power" title="No installations" message="Add your first installation." /></div></div>}
      {modal && <InstallationModal data={modal.data} id={modal.id} onSave={handleSave} onClose={() => setModal(null)} />}
    </>
  );
}

function InstallationModal({ data, id, onSave, onClose }) {
  const d = data;
  const [f, setF] = useState({
    customerName: d.customerName || '', phone: d.phone || '', address: d.address || '',
    roofType: d.roofType || 'RCC', floors: d.floors || 1, structureType: d.structureType || 'Flat',
    startDate: d.startDate || '', totalDays: d.totalDays || '', teamLeader: d.teamLeader || '',
    numPeople: d.numPeople || '', materialDispatched: d.materialDispatched || 'No', progress: d.progress || 0,
    qualityInspection: d.qualityInspection || 'Pending', guaranteeCard: d.guaranteeCard || 'No',
    customerReference: d.customerReference || 'No',
    discomFeasibility: d.discomFeasibility || 'Pending', docSubmission: d.docSubmission || 'Pending',
    discomInspection: d.discomInspection || 'Pending', meterChange: d.meterChange || 'Pending',
    flaggingStatus: d.flaggingStatus || 'Pending', subsidyStatus: d.subsidyStatus || 'Not Applied',
    firstServiceDate: d.firstServiceDate || '', nextServiceDate: d.nextServiceDate || ''
  });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  return (
    <Modal title={id ? 'Edit Installation' : 'New Installation'} onClose={onClose} wide>
      <form onSubmit={e => { e.preventDefault(); onSave(f, id); }}>
        <div className="mb">
          <div className="fr"><div className="fg"><label>Customer Name *</label><input className="fi" value={f.customerName} onChange={e => set('customerName', e.target.value)} required /></div><div className="fg"><label>Phone</label><input className="fi" value={f.phone} onChange={e => set('phone', e.target.value)} /></div></div>
          <div className="fg"><label>Address</label><input className="fi" value={f.address} onChange={e => set('address', e.target.value)} /></div>
          <div className="fr3"><div className="fg"><label>Roof Type</label><select className="fi" value={f.roofType} onChange={e => set('roofType', e.target.value)}><option>RCC</option><option>Sheet</option><option>Tile</option></select></div><div className="fg"><label>Floors</label><input type="number" className="fi" value={f.floors} onChange={e => set('floors', e.target.value)} /></div><div className="fg"><label>Structure</label><select className="fi" value={f.structureType} onChange={e => set('structureType', e.target.value)}><option>Flat</option><option>Sloped</option></select></div></div>
          <div className="fr3"><div className="fg"><label>Start Date</label><input type="date" className="fi" value={f.startDate} onChange={e => set('startDate', e.target.value)} /></div><div className="fg"><label>Total Days</label><input type="number" className="fi" value={f.totalDays} onChange={e => set('totalDays', e.target.value)} /></div><div className="fg"><label>Team Leader</label><input className="fi" value={f.teamLeader} onChange={e => set('teamLeader', e.target.value)} /></div></div>
          <div className="fr3"><div className="fg"><label>Team Size</label><input type="number" className="fi" value={f.numPeople} onChange={e => set('numPeople', e.target.value)} /></div><div className="fg"><label>Material Dispatched</label><select className="fi" value={f.materialDispatched} onChange={e => set('materialDispatched', e.target.value)}><option>No</option><option>Yes</option></select></div><div className="fg"><label>Progress %</label><input type="number" className="fi" value={f.progress} min="0" max="100" onChange={e => set('progress', e.target.value)} /></div></div>
          <div style={{ borderTop: '1px solid var(--bor)', margin: '14px 0', paddingTop: 14 }}><label style={{ fontWeight: 700, fontSize: '.88rem' }}>DISCOM & Subsidy</label>
            <div className="fr3" style={{ marginTop: 10 }}>
              {['discomFeasibility', 'docSubmission', 'discomInspection'].map(k => (
                <div className="fg" key={k}><label>{k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}</label><select className="fi" value={f[k]} onChange={e => set(k, e.target.value)}><option>Pending</option><option>Done</option><option>Approved</option></select></div>
              ))}
            </div>
            <div className="fr3"><div className="fg"><label>Meter Change</label><select className="fi" value={f.meterChange} onChange={e => set('meterChange', e.target.value)}><option>Pending</option><option>Done</option></select></div><div className="fg"><label>Flagging</label><select className="fi" value={f.flaggingStatus} onChange={e => set('flaggingStatus', e.target.value)}><option>Pending</option><option>Done</option></select></div><div className="fg"><label>Subsidy</label><select className="fi" value={f.subsidyStatus} onChange={e => set('subsidyStatus', e.target.value)}><option>Not Applied</option><option>Pending</option><option>Approved</option><option>Released</option></select></div></div>
          </div>
          <div className="fr"><div className="fg"><label>1st Service Date</label><input type="date" className="fi" value={f.firstServiceDate} onChange={e => set('firstServiceDate', e.target.value)} /></div><div className="fg"><label>Next Service</label><input type="date" className="fi" value={f.nextServiceDate} onChange={e => set('nextServiceDate', e.target.value)} /></div></div>
        </div>
        <div className="mf"><button type="button" className="btn bo" onClick={onClose}>Cancel</button><button type="submit" className="btn bp">{id ? 'Update' : 'Add'}</button></div>
      </form>
    </Modal>
  );
}
