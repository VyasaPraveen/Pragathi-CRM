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
                <DetailItem label="Site Visit" value={inst.siteVisitStatus === 'Visited' ? <span className="st st-g">Visited</span> : <span className="st st-x">Not Visited</span>} />
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
                  <DetailItem label="Feasibility" value={<><StatusBadge status={inst.discomFeasibility || 'Pending'} />{inst.discomFeasibilityDate && <span style={{ fontSize: '.76rem', color: 'var(--muted)', marginLeft: 6 }}>{formatDate(inst.discomFeasibilityDate)}</span>}</>} />
                  <DetailItem label="Doc Submission" value={<><StatusBadge status={inst.docSubmission || 'Pending'} />{inst.docSubmissionDate && <span style={{ fontSize: '.76rem', color: 'var(--muted)', marginLeft: 6 }}>{formatDate(inst.docSubmissionDate)}</span>}</>} />
                  <DetailItem label="Inspection" value={<><StatusBadge status={inst.discomInspection || 'Pending'} />{inst.discomInspectionDate && <span style={{ fontSize: '.76rem', color: 'var(--muted)', marginLeft: 6 }}>{formatDate(inst.discomInspectionDate)}</span>}</>} />
                  <DetailItem label="Meter Change" value={<><StatusBadge status={inst.meterChange || 'Pending'} />{inst.meterChangeDate && <span style={{ fontSize: '.76rem', color: 'var(--muted)', marginLeft: 6 }}>{formatDate(inst.meterChangeDate)}</span>}</>} />
                  <DetailItem label="Flagging" value={<><StatusBadge status={inst.flaggingStatus || 'Pending'} />{inst.flaggingDate && <span style={{ fontSize: '.76rem', color: 'var(--muted)', marginLeft: 6 }}>{formatDate(inst.flaggingDate)}</span>}</>} />
                  <DetailItem label="Subsidy" value={<><StatusBadge status={inst.subsidyStatus || 'Pending'} />{inst.subsidyDate && <span style={{ fontSize: '.76rem', color: 'var(--muted)', marginLeft: 6 }}>{formatDate(inst.subsidyDate)}</span>}</>} />
                </div>
              </div>
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
                </div>
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
      {!installations.length && <div className="card"><div className="cb"><EmptyState icon="solar_power" title="No installations" message="Add your first installation." /></div></div>}
      {modal && <InstallationModal data={modal.data} id={modal.id} onSave={handleSave} onClose={() => setModal(null)} />}
    </>
  );
}

function InstallationModal({ data, id, onSave, onClose }) {
  const d = data;
  const [f, setF] = useState({
    customerName: d.customerName || '', phone: d.phone || '', address: d.address || '',
    siteVisitStatus: d.siteVisitStatus || 'Not Visited',
    roofType: d.roofType || 'RCC', floors: d.floors || 1, structureType: d.structureType || 'Flat',
    startDate: d.startDate || '', totalDays: d.totalDays || '', teamLeader: d.teamLeader || '',
    numPeople: d.numPeople || '', materialDispatched: d.materialDispatched || 'No', progress: d.progress || 0,
    qualityInspection: d.qualityInspection || 'Pending', guaranteeCard: d.guaranteeCard || 'No',
    customerReference: d.customerReference || 'No',
    discomFeasibility: d.discomFeasibility || 'Pending', docSubmission: d.docSubmission || 'Pending',
    discomInspection: d.discomInspection || 'Pending', meterChange: d.meterChange || 'Pending',
    flaggingStatus: d.flaggingStatus || 'Pending', subsidyStatus: d.subsidyStatus || 'Not Applied',
    firstServiceDate: d.firstServiceDate || '', nextServiceDate: d.nextServiceDate || '',
    // Phase 2: Reference fields
    referenceLeadName: d.referenceLeadName || '',
    referencePhoneNumber: d.referencePhoneNumber || '',
    // Phase 2: Material consumption (qty + size)
    acCableQty: d.acCableQty || '', acCableSize: d.acCableSize || '',
    dcCableQty: d.dcCableQty || '', dcCableSize: d.dcCableSize || '',
    earthCable: d.earthCable || '', earthCableSize: d.earthCableSize || '',
    upvcPipes: d.upvcPipes || '', upvcPipeSize: d.upvcPipeSize || '',
    // Phase 2: Documents
    handSketch: d.handSketch || '',
    installationReport: d.installationReport || '',
    // Phase 2: Compliance date tracking
    discomFeasibilityDate: d.discomFeasibilityDate || '',
    docSubmissionDate: d.docSubmissionDate || '',
    discomInspectionDate: d.discomInspectionDate || '',
    meterChangeDate: d.meterChangeDate || '',
    flaggingDate: d.flaggingDate || '',
    subsidyDate: d.subsidyDate || ''
  });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  return (
    <Modal title={id ? 'Edit Installation' : 'New Installation'} onClose={onClose} wide>
      <form onSubmit={e => { e.preventDefault(); onSave(f, id); }}>
        <div className="mb">
          <div className="fr"><div className="fg"><label>Customer Name *</label><input className="fi" value={f.customerName} onChange={e => set('customerName', e.target.value)} required /></div><div className="fg"><label>Phone</label><input className="fi" value={f.phone} onChange={e => set('phone', e.target.value)} /></div></div>
          <div className="fr"><div className="fg"><label>Address</label><input className="fi" value={f.address} onChange={e => set('address', e.target.value)} /></div><div className="fg"><label>Site Visit Status</label><select className="fi" value={f.siteVisitStatus} onChange={e => set('siteVisitStatus', e.target.value)}><option>Not Visited</option><option>Visited</option></select></div></div>
          <div className="fr3"><div className="fg"><label>Roof Type</label><select className="fi" value={f.roofType} onChange={e => set('roofType', e.target.value)}><option>RCC</option><option>Sheet</option><option>Tile</option></select></div><div className="fg"><label>Floors</label><input type="number" className="fi" value={f.floors} onChange={e => set('floors', e.target.value)} /></div><div className="fg"><label>Structure</label><select className="fi" value={f.structureType} onChange={e => set('structureType', e.target.value)}><option>Flat</option><option>Sloped</option></select></div></div>
          <div className="fr3"><div className="fg"><label>Start Date</label><input type="date" className="fi" value={f.startDate} onChange={e => set('startDate', e.target.value)} /></div><div className="fg"><label>Total Days</label><input type="number" className="fi" value={f.totalDays} onChange={e => set('totalDays', e.target.value)} /></div><div className="fg"><label>Team Leader</label><input className="fi" value={f.teamLeader} onChange={e => set('teamLeader', e.target.value)} /></div></div>
          <div className="fr3"><div className="fg"><label>Team Size</label><input type="number" className="fi" value={f.numPeople} onChange={e => set('numPeople', e.target.value)} /></div><div className="fg"><label>Material Dispatched</label><select className="fi" value={f.materialDispatched} onChange={e => set('materialDispatched', e.target.value)}><option>No</option><option>Yes</option></select></div><div className="fg"><label>Progress %</label><input type="number" className="fi" value={f.progress} min="0" max="100" onChange={e => set('progress', e.target.value)} /></div></div>

          {/* Quality & Guarantee */}
          <div className="fr"><div className="fg"><label>Quality Inspection</label><select className="fi" value={f.qualityInspection} onChange={e => set('qualityInspection', e.target.value)}><option>Pending</option><option>Done</option><option>Approved</option></select></div><div className="fg"><label>Guarantee Card</label><select className="fi" value={f.guaranteeCard} onChange={e => set('guaranteeCard', e.target.value)}><option>No</option><option>Yes</option></select></div></div>

          {/* DISCOM & Subsidy with Date Tracking */}
          <div style={{ borderTop: '1px solid var(--bor)', margin: '14px 0', paddingTop: 14 }}><label style={{ fontWeight: 700, fontSize: '.88rem' }}>DISCOM & Subsidy</label>
            <div className="fr" style={{ marginTop: 10 }}>
              <div className="fg"><label>Feasibility Status</label><select className="fi" value={f.discomFeasibility} onChange={e => set('discomFeasibility', e.target.value)}><option>Pending</option><option>Done</option><option>Approved</option></select></div>
              <div className="fg"><label>Feasibility Date</label><input type="date" className="fi" value={f.discomFeasibilityDate} onChange={e => set('discomFeasibilityDate', e.target.value)} /></div>
            </div>
            <div className="fr">
              <div className="fg"><label>Doc Submission</label><select className="fi" value={f.docSubmission} onChange={e => set('docSubmission', e.target.value)}><option>Pending</option><option>Done</option><option>Approved</option></select></div>
              <div className="fg"><label>Submission Date</label><input type="date" className="fi" value={f.docSubmissionDate} onChange={e => set('docSubmissionDate', e.target.value)} /></div>
            </div>
            <div className="fr">
              <div className="fg"><label>Inspection</label><select className="fi" value={f.discomInspection} onChange={e => set('discomInspection', e.target.value)}><option>Pending</option><option>Done</option><option>Approved</option></select></div>
              <div className="fg"><label>Inspection Date</label><input type="date" className="fi" value={f.discomInspectionDate} onChange={e => set('discomInspectionDate', e.target.value)} /></div>
            </div>
            <div className="fr">
              <div className="fg"><label>Meter Change</label><select className="fi" value={f.meterChange} onChange={e => set('meterChange', e.target.value)}><option>Pending</option><option>Done</option></select></div>
              <div className="fg"><label>Meter Change Date</label><input type="date" className="fi" value={f.meterChangeDate} onChange={e => set('meterChangeDate', e.target.value)} /></div>
            </div>
            <div className="fr">
              <div className="fg"><label>Flagging</label><select className="fi" value={f.flaggingStatus} onChange={e => set('flaggingStatus', e.target.value)}><option>Pending</option><option>Done</option></select></div>
              <div className="fg"><label>Flagging Date</label><input type="date" className="fi" value={f.flaggingDate} onChange={e => set('flaggingDate', e.target.value)} /></div>
            </div>
            <div className="fr">
              <div className="fg"><label>Subsidy</label><select className="fi" value={f.subsidyStatus} onChange={e => set('subsidyStatus', e.target.value)}><option>Not Applied</option><option>Pending</option><option>Approved</option><option>Released</option></select></div>
              <div className="fg"><label>Subsidy Date</label><input type="date" className="fi" value={f.subsidyDate} onChange={e => set('subsidyDate', e.target.value)} /></div>
            </div>
          </div>

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

          {/* Documents */}
          <div style={{ borderTop: '1px solid var(--bor)', margin: '14px 0', paddingTop: 14 }}><label style={{ fontWeight: 700, fontSize: '.88rem' }}>Documents</label>
            <div className="fg" style={{ marginTop: 10 }}><label>Hand Sketch URL (with Signature)</label><input className="fi" type="url" value={f.handSketch} onChange={e => set('handSketch', e.target.value)} placeholder="https://..." /></div>
            {f.handSketch && (
              <div style={{ marginBottom: 10, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--bor)' }}>
                <img src={f.handSketch} alt="Hand Sketch" style={{ width: '100%', maxHeight: 200, objectFit: 'contain' }} onError={e => { e.target.style.display = 'none'; }} />
              </div>
            )}
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
        <div className="mf"><button type="button" className="btn bo" onClick={onClose}>Cancel</button><button type="submit" className="btn bp">{id ? 'Update' : 'Add'}</button></div>
      </form>
    </Modal>
  );
}
