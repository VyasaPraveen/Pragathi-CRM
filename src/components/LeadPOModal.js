import React, { useState } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { addDocument } from '../services/firestore';
import { formatCurrency, toNumber, hasAccess, todayStr } from '../services/helpers';
import { DateInput } from './SharedUI';
import { poTerm } from '../services/poShare';
import { getOptions } from '../services/options';
import { sortBomItems } from '../services/bomOrder';
import { numberingSettings } from '../services/quotation';

// ============================================================================
// The purchase order form (Create PO / Edit PO) a lead's PO & BOM tab opens.
// Moved here from Leads.js unchanged (4-Nov, Req 12) so the Purchase Orders
// section's New PO can open the very same form; Leads keeps using it as before.
// ============================================================================

const EMPTY_BOM_ITEM = { materialName: '', make: '', quantity: '', actualQuantity: '', unit: 'Nos', specification: '', scopePragathi: false, scopeCustomer: false, rate: '', amount: 0 };

// Stable per-row keys so add/remove doesn't shuffle React DOM/focus (not persisted to Firestore)
let bomKeyCounter = 0;
const nextBomKey = () => 'bom_' + (bomKeyCounter++);

// The material catalogue, in the order of the official Bill of Materials sheet.
// The kW-specific inverter variants are kept at the end so nothing that could be
// picked before has been taken away.
const DEFAULT_BOM_MATERIALS = [
  { materialName: 'Solar PV Module', unit: 'Nos', make: 'Tata/Others' },
  { materialName: 'Grid Tie Inverter', unit: 'Nos', make: 'Tata/Others' },
  { materialName: 'Junction Box / ACDB', unit: 'Nos', make: '' },
  { materialName: 'Junction Box / DCDB', unit: 'Nos', make: '' },
  { materialName: 'Earthing Rods', unit: 'Nos', make: '' },
  { materialName: 'LA', unit: 'Nos', make: '' },
  { materialName: 'MC4 Connectors', unit: 'Nos', make: '' },
  { materialName: 'Earth Chemical Bags', unit: 'Nos', make: '' },
  { materialName: 'Earth Chambers', unit: 'Nos', make: '' },
  { materialName: 'DC Cable', unit: 'Mtrs', make: 'Polycab/Others' },
  { materialName: 'AC Cable', unit: 'Mtrs', make: 'Polycab/Others' },
  { materialName: 'Earthing Cable', unit: 'Mtrs', make: 'Polycab/Others' },
  { materialName: 'MMS -2/4 (PPS Standard)', unit: 'Nos', make: 'HOT DIP/Other' },
  { materialName: 'If Any Elevated MMS (Height)', unit: 'Nos', make: 'HOT DIP/Other' },
  { materialName: 'Additional AC Cable', unit: 'Mtrs', make: 'Polycab/Others' },
  { materialName: 'Additional DC Cable', unit: 'Mtrs', make: 'Polycab/Others' },
  { materialName: 'Additional Earth Cable', unit: 'Mtrs', make: 'Polycab/Others' },
  { materialName: 'UPVC Pipes & Fittings', unit: 'Mtrs', make: 'Finolex/Others' },
  { materialName: 'Civil Works', unit: 'Nos', make: 'Finolex/Others' },
  { materialName: 'Additional Relay', unit: 'Nos', make: '' },
  { materialName: 'DISCOM Charges', unit: 'Rs.', make: '' },
  { materialName: 'Ladder (Height)', unit: 'Nos', make: '' },
  { materialName: 'MCS - Cleaning System', unit: 'Nos', make: '' },
  { materialName: 'Additional Load', unit: '', make: '' },
  { materialName: 'Any Misc / Others', unit: '', make: '' },
  // kW-specific inverter variants (kept from the previous catalogue)
  { materialName: 'Grid Tie Inverter (1KW - 1 Ph)', unit: 'Nos', make: 'Tata/Others' },
  { materialName: 'Grid Tie Inverter (2KW - 1 Ph)', unit: 'Nos', make: 'Tata/Others' },
  { materialName: 'Grid Tie Inverter (3KW - 1 Ph)', unit: 'Nos', make: 'Tata/Others' },
  { materialName: 'Grid Tie Inverter (4KW - 1 Ph)', unit: 'Nos', make: 'Tata/Others' },
  { materialName: 'Grid Tie Inverter (5KW - 1 Ph)', unit: 'Nos', make: 'Tata/Others' },
  { materialName: 'Grid Tie Inverter (5KW - 3 Ph)', unit: 'Nos', make: 'Tata/Others' },
  { materialName: 'Grid Tie Inverter (6KW - 3 Ph)', unit: 'Nos', make: 'Tata/Others' },
  { materialName: 'Grid Tie Inverter (8KW - 3 Ph)', unit: 'Nos', make: 'Tata/Others' },
  { materialName: 'Grid Tie Inverter (10KW - 3 Ph)', unit: 'Nos', make: 'Tata/Others' },
  { materialName: 'Module Mounting Structure (2-4) Default Structure', unit: 'Nos', make: 'HOT DIP/Other' },
];

/* ============ LEAD PO CREATE/EDIT MODAL (NEW) ============ */
export default function LeadPOModal({ lead, po, poId, existingPOs, onSave, onClose }) {
  const { bomTemplates, settings } = useData();
  const { role } = useAuth();
  const { toast } = useToast();
  const canManageTemplates = hasAccess(role, 'manager');
  // Req 13 (4-Nov): the next number follows the Owner's starting number
  // (Settings → Numbering); the Owner alone may overtype it.
  const isOwner = role === 'super_admin';
  const autoNumber = poId ? po.poNumber : generatePONumber(existingPOs, numberingSettings(settings).poStart);
  // Req 18 (4-Nov): the Owner's material list and order (Settings → Manage
  // Options → BOM Materials) is the catalogue and the order of the printed sheet.
  const ownerOrder = getOptions(settings, 'bomMaterials');

  const [f, setF] = useState({
    poNumber: po.poNumber || autoNumber,
    poDate: po.poDate || todayStr(),
    // Printed on the quotation and on the Bill of Materials. Pre-filled from the
    // lead where we already know it, and editable here.
    referredBy: po.referredBy || lead.referredByName || '',
    sourceOfLead: po.sourceOfLead || lead.leadReference || '',
    amount: po.amount || '',
    uscNo: po.uscNo || lead.customerServiceNumber || '',
    leadId: lead.id,
    leadName: lead.name,
    customerName: po.customerName || lead.name || '',
    customerPhone: po.customerPhone || lead.phone || '',
    customerAddress: po.customerAddress || lead.address || '',
    kwRequired: po.kwRequired || lead.kwRequired || '',
    // "System of __ kW with __ Phase of __ kW Inverter", as the reference PO
    // words it. The phase follows the system size until somebody sets it:
    // above 5 kW the connection is three-phase.
    systemKw: po.systemKw || String(po.kwRequired || lead.kwRequired || '').replace(/[^0-9.]/g, ''),
    phase: po.phase || (toNumber(String(po.kwRequired || lead.kwRequired || '').replace(/[^0-9.]/g, '')) > 5 ? '3' : '1'),
    inverterKw: po.inverterKw || '',
    // Req 17 — a new purchase order is raised by Pragathi; the supplier is
    // chosen per order, so the field no longer opens on a supplier's name.
    vendorName: po.vendorName || 'Pragathi Power Solutions',
    moduleCount: po.moduleCount || '',
    inverterDetails: po.inverterDetails || '',
    plantLocation: po.plantLocation || lead.address || '',
    referenceNumber: po.referenceNumber || '',
    companyScope: poTerm(po, 'companyScope'),
    customerScope: poTerm(po, 'customerScope'),
    paymentTerms: poTerm(po, 'paymentTerms'),
    // Printed in the Payment Details block on the PO, beside the bank account.
    advancePayment: po.advancePayment || '',
    secondPayment: po.secondPayment || '',
    thirdPayment: po.thirdPayment || '',
    finalPayment: po.finalPayment || '',
    paymentRemarks: po.paymentRemarks || '',
    warrantyTerms: poTerm(po, 'warrantyTerms'),
    deliveryTerms: poTerm(po, 'deliveryTerms'),
    installationTerms: poTerm(po, 'installationTerms'),
    agreedPrice: po.agreedPrice || '',
    discomCharges: po.discomCharges || '',
    civilWork: po.civilWork || '',
    upvcPipes: po.upvcPipes || '',
    additionalRelay: po.additionalRelay || '',
    elevatedStructure: po.elevatedStructure || '',
    additionalBom: po.additionalBom || '',
    otherCharges: po.otherCharges || '',
    handSketch: po.handSketch || '',
    sketchWithSignature: po.sketchWithSignature || '',
    status: po.status || 'Unapproved',
    notes: po.notes || ''
  });
  // Only the materials actually chosen are rows — they are picked from the list
  // below instead of scrolling through every material one by one.
  const [items, setItems] = useState(
    (po.items && po.items.length)
      ? po.items.map(it => ({ ...EMPTY_BOM_ITEM, ...it, _key: nextBomKey() }))
      : []
  );
  const [matSearch, setMatSearch] = useState('');
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const [poSaving, setPoSaving] = useState(false);

  const setItem = (idx, key, val) => {
    setItems(prev => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], [key]: val };
      if (key === 'quantity' || key === 'rate') {
        copy[idx].amount = toNumber(copy[idx].quantity) * toNumber(copy[idx].rate);
      }
      return copy;
    });
  };
  const addItem = () => setItems(prev => [...prev, { ...EMPTY_BOM_ITEM, _key: nextBomKey() }]);
  const removeItem = (idx) => setItems(prev => prev.filter((_, i) => i !== idx));
  const totalValue = items.reduce((s, it) => s + toNumber(it.amount), 0);

  // Tick a material to add it to the BOM, untick to take it out again. A row
  // that already has figures in it asks first, so nothing is lost by a mis-tap.
  const isPicked = (name) => items.some(it => it.materialName === name);
  const toggleMaterial = (m) => {
    const existing = items.find(it => it.materialName === m.materialName);
    if (existing) {
      const hasData = toNumber(existing.quantity) > 0 || toNumber(existing.rate) > 0 || existing.specification;
      if (hasData && !window.confirm(`Remove "${m.materialName}" and the details entered for it?`)) return;
      setItems(prev => prev.filter(it => it.materialName !== m.materialName));
    } else {
      // Dropped into its place on the printed sheet, not onto the end of the
      // list — the BOM is read by serial number, so a material picked last
      // still has to appear where the sheet expects it.
      setItems(prev => sortBomItems([...prev, { ...EMPTY_BOM_ITEM, ...m, _key: nextBomKey() }], undefined, ownerOrder));
    }
  };
  const pickAllStandard = () => {
    setItems(prev => {
      const have = new Set(prev.map(it => it.materialName));
      return sortBomItems([...prev, ...materialCatalogue
        .filter(m => !have.has(m.materialName))
        .map(m => ({ ...EMPTY_BOM_ITEM, ...m, _key: nextBomKey() }))], undefined, ownerOrder);
    });
  };
  const clearPicked = () => {
    if (items.length && !window.confirm('Remove all selected materials?')) return;
    setItems([]);
  };
  // The catalogue is the Owner's list, line by line in the Owner's order; a
  // material the standard sheet knows brings its unit and make along. Anything
  // on the standard sheet the Owner has not listed follows at the end, so no
  // material anyone could pick before has gone away.
  const materialCatalogue = (() => {
    const squash = (n) => String(n || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const std = new Map(DEFAULT_BOM_MATERIALS.map(m => [squash(m.materialName), m]));
    const listed = new Set();
    const out = ownerOrder.map(n => { listed.add(squash(n)); const s = std.get(squash(n)); return s ? { ...s, materialName: n } : { materialName: n, unit: 'Nos', make: '' }; });
    return [...out, ...DEFAULT_BOM_MATERIALS.filter(m => !listed.has(squash(m.materialName)))];
  })();
  const visibleMaterials = materialCatalogue.filter(m =>
    !matSearch || m.materialName.toLowerCase().includes(matSearch.toLowerCase()));
  const extraChargesTotal = toNumber(f.discomCharges) + toNumber(f.civilWork) + toNumber(f.upvcPipes) + toNumber(f.additionalRelay) + toNumber(f.elevatedStructure) + toNumber(f.additionalBom) + toNumber(f.otherCharges);
  const autoScope = 'Supply and installation of ' + (f.kwRequired || '___') + ' Solar PV On-Grid System as per BOM.';

  /* Combined material suggestions: defaults + saved template materials */
  const allMaterials = [...new Set([
    ...materialCatalogue.map(m => m.materialName),
    ...bomTemplates.flatMap(t => (t.items || []).map(it => it.materialName).filter(Boolean))
  ])];

  /* Template operations */
  const loadTemplate = (templateId) => {
    const tpl = bomTemplates.find(t => t.id === templateId);
    if (!tpl || !tpl.items) return;
    if (items.some(it => it.materialName) && !window.confirm('This will replace current items. Continue?')) return;
    setItems(sortBomItems(tpl.items, undefined, ownerOrder).map(it => ({
      materialName: it.materialName || '',
      quantity: it.quantity || '',
      unit: it.unit || 'Nos',
      specification: it.specification || '',
      remarks: it.remarks || '',
      rate: '', amount: 0, _key: nextBomKey()
    })));
    toast('Template "' + tpl.name + '" loaded');
  };

  const saveAsTemplate = async () => {
    const validItems = items.filter(it => it.materialName);
    if (!validItems.length) { toast('Add at least one material first', 'er'); return; }
    const name = window.prompt('Enter a name for this BOM template:');
    if (!name || !name.trim()) return;
    try {
      await addDocument('bomTemplates', {
        name: name.trim(),
        items: validItems.map(it => ({
          materialName: it.materialName || '',
          quantity: toNumber(it.quantity),
          unit: it.unit || '',
          specification: it.specification || '',
          remarks: it.remarks || ''
        }))
      });
      toast('BOM template saved');
    } catch (e) { toast(e.message, 'er'); }
  };

  return (
    <div className="mo" style={{ zIndex: 1001 }}>
      <div className="md" style={{ width: '740px', maxWidth: '96vw' }}>
        <div className="mh">
          <h3>{poId ? 'Edit Purchase Order' : 'Create Purchase Order'}</h3>
          <button className="mx" onClick={onClose}><span className="material-icons-round">close</span></button>
        </div>
        <form onSubmit={async e => {
          e.preventDefault();
          if (poSaving) return;
          const cleaned = {
            ...f,
            companyScope: f.companyScope || autoScope,
            // The Owner's order at the time of saving travels with the PO, so the
            // printed sheet (drawn on the server) lists the materials the same way.
            bomOrder: ownerOrder,
            items: sortBomItems(items.filter(it => it.materialName || it.quantity), undefined, ownerOrder).map(it => ({
              materialName: it.materialName || '',
              make: it.make || '',
              quantity: toNumber(it.quantity),
              unit: it.unit || '',
              specification: it.specification || '',
              scopePragathi: !!it.scopePragathi,
              scopeCustomer: !!it.scopeCustomer,
              actualQuantity: it.actualQuantity === '' || it.actualQuantity == null ? '' : toNumber(it.actualQuantity),
              rate: toNumber(it.rate),
              amount: toNumber(it.quantity) * toNumber(it.rate)
            })),
            totalValue,
            amount: toNumber(f.amount),
            discomCharges: toNumber(f.discomCharges),
            civilWork: toNumber(f.civilWork),
            upvcPipes: toNumber(f.upvcPipes),
            additionalRelay: toNumber(f.additionalRelay),
            elevatedStructure: toNumber(f.elevatedStructure),
            additionalBom: toNumber(f.additionalBom),
            otherCharges: toNumber(f.otherCharges),
            extraChargesTotal,
            agreedPrice: toNumber(f.agreedPrice) || totalValue
          };
          setPoSaving(true);
          try { await onSave(cleaned, poId); }
          finally { setPoSaving(false); }
        }}>
          <div className="mb" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            <div className="fr">
              <div className="fg"><label>PO Number{isOwner && <span style={{ fontSize: '.72rem', color: 'var(--muted)', fontWeight: 400 }}> (Owner may edit)</span>}</label>
                <input className="fi" value={f.poNumber} readOnly={!isOwner} onChange={e => set('poNumber', e.target.value)} style={isOwner ? {} : { background: '#f0f4f8' }} title={isOwner ? 'The next number follows Settings → Numbering; correct it here if needed' : 'Only the Owner can change the number'} /></div>
              <div className="fg"><label>PO Date *</label><DateInput value={f.poDate} onChange={e => set('poDate', e.target.value)} required /></div>
            </div>
            <div style={{ fontWeight: 700, fontSize: '.86rem', color: 'var(--pri)', margin: '14px 0 8px', paddingBottom: 4, borderBottom: '1px solid var(--bor)' }}>Customer Details</div>
            <div className="fr">
              <div className="fg"><label>Customer Name</label><input className="fi" value={f.customerName} onChange={e => set('customerName', e.target.value)} /></div>
              <div className="fg"><label>Mobile Number</label><input className="fi" value={f.customerPhone} onChange={e => set('customerPhone', e.target.value)} placeholder="10-digit mobile" /></div>
            </div>
            <div className="fr">
              <div className="fg"><label>Service Number</label><input className="fi" value={f.uscNo} onChange={e => set('uscNo', e.target.value)} placeholder="Electrical service / USC number" /></div>
              <div className="fg"><label>Plant Location / Building</label><input className="fi" value={f.plantLocation} onChange={e => set('plantLocation', e.target.value)} placeholder="Residential Building / location" /></div>
            </div>
            <div className="fg"><label>Address</label><input className="fi" value={f.customerAddress} onChange={e => set('customerAddress', e.target.value)} /></div>
            <div style={{ fontSize: '.74rem', color: 'var(--muted)', marginTop: -4 }}>
              These four print on the purchase order exactly as entered here. They are filled in from the lead, and can be corrected.
            </div>

            <div style={{ fontWeight: 700, fontSize: '.86rem', color: 'var(--pri)', margin: '14px 0 8px', paddingBottom: 4, borderBottom: '1px solid var(--bor)' }}>System</div>
            {/* The PO reads "System of __ kW with __ Phase of __ kW Inverter". */}
            <div className="fr3">
              <div className="fg"><label>System Size (kW)</label><input className="fi" value={f.systemKw} onChange={e => set('systemKw', e.target.value)} placeholder="e.g. 5" /></div>
              <div className="fg"><label>Phase</label><select className="fi" value={f.phase} onChange={e => set('phase', e.target.value)}><option value="1">1 Phase</option><option value="3">3 Phase</option></select></div>
              <div className="fg"><label>Inverter (kW)</label><input className="fi" value={f.inverterKw} onChange={e => set('inverterKw', e.target.value)} placeholder={f.systemKw || 'e.g. 5'} /></div>
            </div>
            <div style={{ fontSize: '.74rem', color: 'var(--muted)', marginTop: -4 }}>
              Prints as: <strong>System of {f.systemKw || '____'} kW with {f.phase || '____'} Phase of {f.inverterKw || f.systemKw || '____'} kW Inverter</strong>
            </div>
            <div className="fr3">
              <div className="fg"><label>kW Required</label><input className="fi" value={f.kwRequired} onChange={e => set('kwRequired', e.target.value)} placeholder="e.g. 3kW" /></div>
              <div className="fg"><label>No. of Modules</label><input className="fi" value={f.moduleCount} onChange={e => set('moduleCount', e.target.value)} placeholder="e.g. 6" /></div>
              <div className="fg"><label>Inverter Details</label><input className="fi" value={f.inverterDetails} onChange={e => set('inverterDetails', e.target.value)} placeholder="e.g. 3KW 1-Ph" /></div>
            </div>
            <div className="fr">
              <div className="fg"><label>Vendor</label><input className="fi" value={f.vendorName} onChange={e => set('vendorName', e.target.value)} /></div>
              <div className="fg"><label>Reference Number</label><input className="fi" value={f.referenceNumber} onChange={e => set('referenceNumber', e.target.value)} placeholder="Quote/Ref No." /></div>
            </div>

            {/* Details that also print on the quotation and the Bill of Materials */}
            <div className="fr">
              <div className="fg"><label>Referred By</label><input className="fi" value={f.referredBy} onChange={e => set('referredBy', e.target.value)} placeholder="Who referred this customer" /></div>
              <div className="fg"><label>Source of Lead</label><input className="fi" value={f.sourceOfLead} onChange={e => set('sourceOfLead', e.target.value)} list="lead-sources" placeholder="e.g. Referral, Website" /></div>
            </div>
            <div className="fg"><label>Amount (₹)</label><input type="number" className="fi" value={f.amount} onChange={e => set('amount', e.target.value)} placeholder={totalValue ? String(totalValue) : '0'} /></div>

            <div style={{ fontWeight: 700, fontSize: '.86rem', color: 'var(--pri)', margin: '14px 0 8px', paddingBottom: 4, borderBottom: '1px solid var(--bor)' }}>Payment Details</div>
            {/* These print in the Payment Details block on the PO, opposite the
                company's bank account. The reference sheet rules three blanks
                per line, so each takes amount / date / mode as free text. */}
            <div className="fr">
              <div className="fg"><label>Advance</label><input className="fi" value={f.advancePayment} onChange={e => set('advancePayment', e.target.value)} placeholder="amount / date / mode" /></div>
              <div className="fg"><label>2nd Payment</label><input className="fi" value={f.secondPayment} onChange={e => set('secondPayment', e.target.value)} placeholder="amount / date / mode" /></div>
            </div>
            <div className="fr">
              {/* Req 9 (4-Nov): the 3rd Payment, as the 2nd — amount / date / mode. */}
              <div className="fg"><label>3rd Payment</label><input className="fi" value={f.thirdPayment} onChange={e => set('thirdPayment', e.target.value)} placeholder="amount / date / mode" /></div>
              <div className="fg"><label>Final Payment</label><input className="fi" value={f.finalPayment} onChange={e => set('finalPayment', e.target.value)} placeholder="amount / date / mode" /></div>
            </div>
            <div className="fg"><label>Any Remarks</label><input className="fi" value={f.paymentRemarks} onChange={e => set('paymentRemarks', e.target.value)} placeholder="Anything the accounts team should know" /></div>
            <div style={{ fontSize: '.74rem', color: 'var(--muted)', marginTop: -4 }}>
              Left blank, each prints as a ruled line to be filled in by hand — as on the reference purchase order.
            </div>
            <datalist id="lead-sources">{getOptions(settings, 'leadReference').map(r => <option key={r} value={r} />)}</datalist>

            {/* BOM Section with Templates */}
            <div style={{ borderTop: '1px solid var(--bor)', margin: '14px 0', paddingTop: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                <label style={{ fontWeight: 700, fontSize: '.9rem' }}>Bill of Materials (BOM)</label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  {bomTemplates.length > 0 && (
                    <select className="fi" style={{ width: 'auto', padding: '6px 30px 6px 10px', fontSize: '.82rem' }} defaultValue="" onChange={e => { if (e.target.value) loadTemplate(e.target.value); e.target.value = ''; }}>
                      <option value="">Load Template...</option>
                      {bomTemplates.map(t => <option key={t.id} value={t.id}>{t.name} ({(t.items || []).length} items)</option>)}
                    </select>
                  )}
                  {canManageTemplates && (
                    <button type="button" className="btn bsm bo" onClick={saveAsTemplate} title="Save current items as reusable template">
                      <span className="material-icons-round" style={{ fontSize: 16 }}>bookmark_add</span> Save Template
                    </button>
                  )}
                </div>
              </div>

              {/* Pick the materials needed — every material in one place */}
              <div style={{ border: '1px solid var(--bor)', borderRadius: 8, padding: 10, marginBottom: 12, background: '#fafbfc' }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                  <input className="fi" style={{ flex: 1, minWidth: 160, padding: '6px 10px', fontSize: '.84rem' }} value={matSearch} onChange={e => setMatSearch(e.target.value)} placeholder="Search materials..." />
                  <button type="button" className="btn bsm bo" onClick={pickAllStandard}>Select All</button>
                  <button type="button" className="btn bsm bo" onClick={clearPicked}>Clear</button>
                  <span style={{ fontSize: '.78rem', color: 'var(--muted)' }}>{items.length} selected</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(210px,1fr))', gap: 4, maxHeight: 190, overflowY: 'auto' }}>
                  {visibleMaterials.map(m => {
                    const on = isPicked(m.materialName);
                    return (
                      <label key={m.materialName} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 6, cursor: 'pointer', fontSize: '.82rem', border: '1px solid ' + (on ? 'var(--pri)' : 'var(--bor)'), background: on ? 'rgba(39,174,96,.07)' : '#fff' }}>
                        <input type="checkbox" checked={on} onChange={() => toggleMaterial(m)} style={{ accentColor: 'var(--pri)' }} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.materialName}>{m.materialName}</span>
                      </label>
                    );
                  })}
                  {!visibleMaterials.length && <span style={{ fontSize: '.82rem', color: 'var(--muted)', padding: 6 }}>No material matches "{matSearch}".</span>}
                </div>
              </div>

              {/* Fill the details for the selected materials, right here */}
              {items.length > 0 && (
                <div className="tw" style={{ border: '1px solid var(--bor)', borderRadius: 8 }}>
                  <table style={{ fontSize: '.8rem' }}>
                    <thead><tr>
                      <th style={{ minWidth: 150 }}>Material</th>
                      <th style={{ width: 62 }}>UOM</th>
                      <th style={{ width: 110 }}>Make</th>
                      <th style={{ width: 110 }}>Model / Rating</th>
                      <th style={{ width: 74 }}>Qty (Est.)</th>
                      <th style={{ width: 74 }}>Actuals</th>
                      <th style={{ width: 120 }}>Rate</th>
                      <th style={{ width: 96 }}>Amount</th>
                      <th style={{ width: 62, textAlign: 'center' }}>Pragathi</th>
                      <th style={{ width: 66, textAlign: 'center' }}>Customer</th>
                      <th style={{ width: 34 }}></th>
                    </tr></thead>
                    <tbody>
                      {items.map((item, i) => (
                        <tr key={item._key || i}>
                          <td><input className="fi" style={{ padding: '4px 6px', fontSize: '.8rem' }} value={item.materialName} onChange={e => setItem(i, 'materialName', e.target.value)} list="bom-materials" /></td>
                          <td><input className="fi" style={{ padding: '4px 6px', fontSize: '.8rem' }} value={item.unit} onChange={e => setItem(i, 'unit', e.target.value)} placeholder="Nos" /></td>
                          <td><input className="fi" style={{ padding: '4px 6px', fontSize: '.8rem' }} value={item.make} onChange={e => setItem(i, 'make', e.target.value)} /></td>
                          <td><input className="fi" style={{ padding: '4px 6px', fontSize: '.8rem' }} value={item.specification} onChange={e => setItem(i, 'specification', e.target.value)} /></td>
                          <td><input type="number" className="fi" style={{ padding: '4px 6px', fontSize: '.8rem' }} value={item.quantity} onChange={e => setItem(i, 'quantity', e.target.value)} /></td>
                          <td><input type="number" className="fi" style={{ padding: '4px 6px', fontSize: '.8rem' }} value={item.actualQuantity} onChange={e => setItem(i, 'actualQuantity', e.target.value)} /></td>
                          <td><input type="number" className="fi" style={{ padding: '4px 6px', fontSize: '.8rem' }} value={item.rate} onChange={e => setItem(i, 'rate', e.target.value)} /></td>
                          <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{formatCurrency(toNumber(item.quantity) * toNumber(item.rate))}</td>
                          <td style={{ textAlign: 'center' }}><input type="checkbox" checked={!!item.scopePragathi} onChange={e => setItem(i, 'scopePragathi', e.target.checked)} /></td>
                          <td style={{ textAlign: 'center' }}><input type="checkbox" checked={!!item.scopeCustomer} onChange={e => setItem(i, 'scopeCustomer', e.target.checked)} /></td>
                          <td><button type="button" className="btn bsm bo" onClick={() => removeItem(i)} title="Remove" style={{ padding: '2px 6px', color: 'var(--err)' }}><span className="material-icons-round" style={{ fontSize: 15 }}>close</span></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {!items.length && <p style={{ fontSize: '.82rem', color: 'var(--muted)', margin: '4px 2px' }}>Tick the materials above to add them to this Bill of Materials.</p>}
              <button type="button" className="btn bsm bo" onClick={addItem} style={{ marginTop: 8 }}>
                <span className="material-icons-round" style={{ fontSize: 16 }}>add</span> Add custom material
              </button>
              <datalist id="bom-materials">{allMaterials.map(m => <option key={m} value={m} />)}</datalist>
              <div style={{ textAlign: 'right', fontWeight: 700, fontSize: '1rem', marginTop: 10 }}>Total: {formatCurrency(totalValue)}</div>
            </div>

            {/* Extra Charges Section */}
            <div style={{ borderTop: '1px solid var(--bor)', margin: '14px 0', paddingTop: 14 }}>
              <label style={{ fontWeight: 700, fontSize: '.9rem', marginBottom: 10, display: 'block' }}>Extra Charges</label>
              <div className="fr3">
                <div className="fg"><label>Discom Charges</label><input type="number" className="fi" value={f.discomCharges} onChange={e => set('discomCharges', e.target.value)} placeholder="0" /></div>
                <div className="fg"><label>Civil Work</label><input type="number" className="fi" value={f.civilWork} onChange={e => set('civilWork', e.target.value)} placeholder="0" /></div>
                <div className="fg"><label>UPVC Pipes</label><input type="number" className="fi" value={f.upvcPipes} onChange={e => set('upvcPipes', e.target.value)} placeholder="0" /></div>
              </div>
              <div className="fr3">
                <div className="fg"><label>Additional Relay</label><input type="number" className="fi" value={f.additionalRelay} onChange={e => set('additionalRelay', e.target.value)} placeholder="0" /></div>
                <div className="fg"><label>Elevated Structure</label><input type="number" className="fi" value={f.elevatedStructure} onChange={e => set('elevatedStructure', e.target.value)} placeholder="0" /></div>
                <div className="fg"><label>Additional BOM</label><input type="number" className="fi" value={f.additionalBom} onChange={e => set('additionalBom', e.target.value)} placeholder="0" /></div>
              </div>
              <div className="fr">
                <div className="fg"><label>Others</label><input type="number" className="fi" value={f.otherCharges} onChange={e => set('otherCharges', e.target.value)} placeholder="0" /></div>
                <div className="fg"><label>Extra Charges Total</label><input className="fi" value={extraChargesTotal > 0 ? formatCurrency(extraChargesTotal) : '₹0'} disabled style={{ fontWeight: 700, background: '#f0f4f8' }} /></div>
              </div>
            </div>

            <div className="fg"><label>Price After Subsidy (₹)</label><input type="number" className="fi" value={f.agreedPrice} onChange={e => set('agreedPrice', e.target.value)} placeholder={totalValue.toString()} /></div>

            {/* Terms & Scope */}
            <div style={{ borderTop: '1px solid var(--bor)', margin: '14px 0', paddingTop: 14 }}>
              <label style={{ fontWeight: 700, fontSize: '.9rem', marginBottom: 10, display: 'block' }}>Terms & Scope</label>
              <div className="fg"><label>Company Scope</label><input className="fi" value={f.companyScope} onChange={e => set('companyScope', e.target.value)} placeholder={autoScope} /></div>
              <div className="fg"><label>Customer Scope</label><input className="fi" value={f.customerScope} onChange={e => set('customerScope', e.target.value)} /></div>
              <div className="fr">
                <div className="fg"><label>Payment Terms</label><input className="fi" value={f.paymentTerms} onChange={e => set('paymentTerms', e.target.value)} /></div>
                <div className="fg"><label>Warranty</label><input className="fi" value={f.warrantyTerms} onChange={e => set('warrantyTerms', e.target.value)} /></div>
              </div>
              <div className="fr">
                <div className="fg"><label>Delivery Lead Time</label><input className="fi" value={f.deliveryTerms} onChange={e => set('deliveryTerms', e.target.value)} /></div>
                <div className="fg"><label>Installation</label><input className="fi" value={f.installationTerms} onChange={e => set('installationTerms', e.target.value)} /></div>
              </div>
            </div>

            {/* Sketches */}
            <div style={{ borderTop: '1px solid var(--bor)', margin: '14px 0', paddingTop: 14 }}>
              <label style={{ fontWeight: 700, fontSize: '.9rem', marginBottom: 10, display: 'block' }}>Sketches</label>
              <div className="fr">
                <div className="fg"><label>Hand Sketch URL</label><input className="fi" type="url" value={f.handSketch} onChange={e => set('handSketch', e.target.value)} placeholder="https://..." /></div>
                <div className="fg"><label>Sketch with Signature URL</label><input className="fi" type="url" value={f.sketchWithSignature} onChange={e => set('sketchWithSignature', e.target.value)} placeholder="https://..." /></div>
              </div>
              {(f.handSketch || f.sketchWithSignature) && (
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {f.handSketch && <div style={{ flex: 1, minWidth: 200, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--bor)' }}><img src={f.handSketch} alt="Hand Sketch" style={{ width: '100%', maxHeight: 150, objectFit: 'contain' }} onError={e => { e.target.style.display = 'none'; }} /></div>}
                  {f.sketchWithSignature && <div style={{ flex: 1, minWidth: 200, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--bor)' }}><img src={f.sketchWithSignature} alt="Signed Sketch" style={{ width: '100%', maxHeight: 150, objectFit: 'contain' }} onError={e => { e.target.style.display = 'none'; }} /></div>}
                </div>
              )}
            </div>

            <div className="fg"><label>Notes</label><textarea className="fi" value={f.notes} onChange={e => set('notes', e.target.value)} rows="2" /></div>
          </div>
          <div className="mf">
            <button type="button" className="btn bo" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn bp" disabled={poSaving}>{poSaving ? 'Saving...' : ((poId ? 'Update' : 'Create') + ' PO')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ============ UTILITY FUNCTIONS ============ */

// The next PO number: one more than the highest on file, or than the Owner's
// starting number (Settings → Numbering, Req 13), whichever is higher.
export function generatePONumber(existingPOs, startFrom = 0) {
  const now = new Date();
  const dateStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  const allNums = (existingPOs || []).map(p => {
    const match = (p.poNumber || '').match(/PO-PPSPO-(\d+)/);
    return match ? parseInt(match[1]) : 0;
  });
  const maxNum = Math.max(allNums.length > 0 ? Math.max(...allNums) : 0, toNumber(startFrom));
  return 'PO-PPSPO-' + String(maxNum + 1).padStart(4, '0') + '/' + dateStr;
}
