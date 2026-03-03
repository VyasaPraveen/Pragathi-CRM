import React, { useState } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { addDocument, updateDocument, deleteDocument } from '../services/firestore';
import { formatCurrency, formatDate, safeStr, toNumber, escapeHtml, hasAccess } from '../services/helpers';
import { StatusBadge, Modal, EmptyState } from '../components/SharedUI';

const poStatuses = ['Draft', 'Sent', 'Partial', 'Received', 'Cancelled'];
const PAGE_SIZE = 20;
const EMPTY_ITEM = { materialName: '', quantity: '', unit: 'Nos', specification: '', remarks: '', rate: '', amount: 0 };

const DEFAULT_BOM_MATERIALS = [
  'Solar Module 545W', 'Solar On Grid Inverter', 'ACDB (AC Distribution Box)',
  'DCDB (DC Distribution Box)', 'Earthing Kit', 'Lightning Arrestor',
  'SPD (Surge Protection Device)', 'DC Cable 4sqmm', 'DC Cable 6sqmm',
  'AC Cable 6sqmm', 'AC Cable 10sqmm', 'MC4 Connectors (Pairs)',
  'Cable Ties & Clamps', 'Module Mounting Structure (MMS)',
  'PVC Conduit Pipe 25mm', 'Roof Hooks / Clamps', 'Safety Signage Board',
  'Net Meter', 'Cable Tray', 'Junction Box', 'Lugs & Ferrules',
  'Cable Glands', 'Module Earth Wire 6sqmm'
];

export default function PurchaseOrders() {
  const { purchaseOrders, leadPOs, leads } = useData();
  const { role } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [modal, setModal] = useState(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [expanded, setExpanded] = useState(null);
  const [sourceFilter, setSourceFilter] = useState('all'); // 'all', 'standalone', 'lead'
  const canEdit = hasAccess(role, 'manager');

  // Merge both collections with a source tag
  const allPOs = [
    ...purchaseOrders.map(po => ({ ...po, _source: 'standalone' })),
    ...leadPOs.map(po => {
      const lead = leads.find(l => l.id === po.leadId);
      return { ...po, _source: 'lead', _leadName: lead ? lead.name : po.customerName || 'Unknown Lead' };
    })
  ].sort((a, b) => {
    const da = a.poDate || a.createdAt || '';
    const db2 = b.poDate || b.createdAt || '';
    return db2 > da ? 1 : da > db2 ? -1 : 0;
  });

  const allStatuses = [...new Set([...poStatuses, 'Unapproved', 'Recommended', 'Approved'])];

  let filtered = allPOs;
  if (sourceFilter === 'standalone') filtered = filtered.filter(po => po._source === 'standalone');
  if (sourceFilter === 'lead') filtered = filtered.filter(po => po._source === 'lead');
  if (filter !== 'all') filtered = filtered.filter(po => po.status === filter);
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(po =>
      safeStr(po.vendorName).toLowerCase().includes(q) ||
      safeStr(po.poNumber).toLowerCase().includes(q) ||
      safeStr(po.customerName).toLowerCase().includes(q) ||
      safeStr(po._leadName).toLowerCase().includes(q)
    );
  }

  const displayed = filtered.slice(0, visibleCount);
  const hasMore = filtered.length > visibleCount;

  const handleSave = async (data, id) => {
    try {
      const cleaned = { ...data, totalValue: toNumber(data.totalValue) };
      if (cleaned.items && Array.isArray(cleaned.items)) {
        cleaned.items = cleaned.items.map(it => ({
          materialName: it.materialName || '',
          quantity: toNumber(it.quantity),
          unit: it.unit || '',
          specification: it.specification || '',
          remarks: it.remarks || '',
          rate: toNumber(it.rate),
          amount: toNumber(it.quantity) * toNumber(it.rate)
        }));
        cleaned.totalValue = cleaned.items.reduce((sum, it) => sum + it.amount, 0);
      }
      if (id) { await updateDocument('purchaseOrders', id, cleaned); toast('Purchase order updated'); }
      else { await addDocument('purchaseOrders', cleaned); toast('Purchase order created'); }
      setModal(null);
    } catch (e) { toast(e.message, 'er'); }
  };

  const handleDelete = async (id) => {
    if (window.confirm('Delete this purchase order permanently?')) {
      try { await deleteDocument('purchaseOrders', id); toast('Purchase order deleted'); }
      catch (e) { toast(e.message, 'er'); }
    }
  };

  return (
    <>
      <div className="tl">
        <div className="sb-x"><span className="material-icons-round">search</span><input type="text" placeholder="Search POs..." value={search} onChange={e => setSearch(e.target.value)} /></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {['all', ...allStatuses].map(s => <span key={s} className={`fc ${filter === s ? 'act' : ''}`} onClick={() => setFilter(s)}>{s === 'all' ? 'All' : s}</span>)}
          </div>
          <select className="fi" value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} style={{ width: 'auto', padding: '4px 28px 4px 8px', fontSize: '.78rem' }}>
            <option value="all">All Sources</option>
            <option value="lead">From Leads</option>
            <option value="standalone">Standalone</option>
          </select>
          {canEdit && <button className="btn bp bsm" onClick={() => setModal({ data: {} })}><span className="material-icons-round" style={{ fontSize: 18 }}>add</span> New PO</button>}
        </div>
      </div>
      {/* Summary */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ fontSize: '.82rem', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <span className="material-icons-round" style={{ fontSize: 16 }}>receipt_long</span>
          Total: <strong style={{ color: 'var(--fg)' }}>{allPOs.length}</strong> POs
          ({leadPOs.length} from Leads, {purchaseOrders.length} Standalone)
        </div>
      </div>

      <div className="card"><div className="cb" style={{ padding: 0 }}><div className="tw"><table><thead><tr>
        <th>PO #</th><th>Customer / Vendor</th><th>Date</th><th>Items</th><th>Value</th><th>Source</th><th>Status</th><th>Actions</th>
      </tr></thead><tbody>
        {displayed.map(po => (
          <React.Fragment key={po._source + '-' + po.id}>
            <tr>
              <td style={{ fontWeight: 600 }}>{po.poNumber || '-'}</td>
              <td>
                <strong>{po._source === 'lead' ? (po.customerName || po._leadName) : po.vendorName}</strong>
                <br /><span style={{ fontSize: '.76rem', color: 'var(--muted)' }}>
                  {po._source === 'lead' ? ('Vendor: ' + (po.vendorName || '-')) : (po.vendorPhone || '')}
                </span>
              </td>
              <td style={{ fontSize: '.82rem' }}>{formatDate(po.poDate)}</td>
              <td>{(po.items || []).length}</td>
              <td style={{ fontWeight: 700 }}>{formatCurrency(po.agreedPrice || po.totalValue)}</td>
              <td>
                {po._source === 'lead' ? (
                  <span style={{ background: 'rgba(99,102,241,.1)', color: '#6366f1', padding: '2px 8px', borderRadius: 10, fontSize: '.72rem', fontWeight: 600 }}>Lead</span>
                ) : (
                  <span style={{ background: 'rgba(100,116,139,.1)', color: '#64748b', padding: '2px 8px', borderRadius: 10, fontSize: '.72rem', fontWeight: 600 }}>Standalone</span>
                )}
              </td>
              <td><StatusBadge status={po.status} /></td>
              <td><div style={{ display: 'flex', gap: 4 }}>
                <button className="btn bsm bo" onClick={() => setExpanded(expanded === (po._source + po.id) ? null : (po._source + po.id))}><span className="material-icons-round" style={{ fontSize: 16 }}>{expanded === (po._source + po.id) ? 'expand_less' : 'expand_more'}</span></button>
                <button className="btn bsm bo" onClick={() => po._source === 'standalone' ? printPO(po) : printPO(po)} title="Print"><span className="material-icons-round" style={{ fontSize: 16 }}>print</span></button>
                <button className="btn bsm bo" onClick={() => sharePOWhatsApp(po)} title="WhatsApp" style={{ color: '#25d366', borderColor: 'rgba(37,211,102,.3)' }}><span className="material-icons-round" style={{ fontSize: 16 }}>share</span></button>
                {canEdit && po._source === 'standalone' && <button className="btn bsm bo" onClick={() => setModal({ data: po, id: po.id })}><span className="material-icons-round" style={{ fontSize: 16 }}>edit</span></button>}
                {hasAccess(role, 'admin') && po._source === 'standalone' && <button className="btn bsm bo" onClick={() => handleDelete(po.id)} style={{ color: 'var(--err)', borderColor: 'rgba(231,76,60,.3)' }}><span className="material-icons-round" style={{ fontSize: 16 }}>delete</span></button>}
              </div></td>
            </tr>
            {expanded === (po._source + po.id) && (
              <tr><td colSpan="8" style={{ background: '#fafbfc', padding: '12px 24px' }}>
                {po._source === 'lead' && (
                  <div style={{ marginBottom: 10, fontSize: '.84rem', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    <span><strong>Customer:</strong> {po.customerName || '-'}</span>
                    <span><strong>Phone:</strong> {po.customerPhone || '-'}</span>
                    <span><strong>kW:</strong> {po.kwRequired || '-'}</span>
                    <span><strong>Address:</strong> {po.customerAddress || '-'}</span>
                  </div>
                )}
                {(po.items || []).length > 0 && (
                  <table style={{ width: '100%', marginBottom: 10 }}><thead><tr><th>#</th><th>Material</th><th>{po._source === 'lead' ? 'Make' : 'Specification'}</th><th>Qty</th><th>{po._source === 'lead' ? 'Model/Rating' : 'Unit'}</th>{po._source === 'standalone' && <><th>Rate</th><th>Amount</th></>}<th>Remarks</th></tr></thead><tbody>
                    {po.items.map((item, i) => (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        <td>{item.materialName}</td>
                        <td style={{ fontSize: '.82rem', color: 'var(--muted)' }}>{item.make || item.specification || '-'}</td>
                        <td>{item.quantity}</td>
                        <td>{po._source === 'lead' ? (item.specification || '-') : (item.unit || '-')}</td>
                        {po._source === 'standalone' && <><td>{formatCurrency(item.rate)}</td><td style={{ fontWeight: 600 }}>{formatCurrency(item.amount)}</td></>}
                        <td style={{ fontSize: '.82rem', color: 'var(--muted)' }}>{item.remarks || '-'}</td>
                      </tr>
                    ))}
                  </tbody></table>
                )}
                {po.paymentTerms && <p style={{ fontSize: '.84rem', color: 'var(--muted)' }}><strong>Payment Terms:</strong> {po.paymentTerms} {po.paymentDueDate && <>| Due: {formatDate(po.paymentDueDate)}</>}</p>}
                {po.notes && <p style={{ fontSize: '.84rem', color: 'var(--muted)', marginTop: 4 }}><strong>Notes:</strong> {po.notes}</p>}
              </td></tr>
            )}
          </React.Fragment>
        ))}
        {!filtered.length && <tr><td colSpan="8"><EmptyState icon="receipt_long" title="No purchase orders" message="Create a PO from Leads or use the New PO button." /></td></tr>}
      </tbody></table></div>
      {hasMore && <div style={{ textAlign: 'center', padding: 16 }}><button className="btn bsm bo" onClick={() => setVisibleCount(c => c + PAGE_SIZE)}>Show More ({filtered.length - visibleCount} remaining)</button></div>}
      </div></div>
      {modal && <POModal data={modal.data} id={modal.id} onSave={handleSave} onClose={() => setModal(null)} />}
    </>
  );
}

function POModal({ data, id, onSave, onClose }) {
  const { bomTemplates } = useData();
  const { role } = useAuth();
  const { toast } = useToast();
  const canManageTemplates = hasAccess(role, 'manager');

  const [f, setF] = useState({
    poNumber: data.poNumber || '', vendorName: data.vendorName || '',
    vendorPhone: data.vendorPhone || '', vendorEmail: data.vendorEmail || '',
    poDate: data.poDate || new Date().toISOString().slice(0, 10),
    expectedDeliveryDate: data.expectedDeliveryDate || '',
    status: data.status || 'Draft',
    paymentTerms: data.paymentTerms || '', paymentDueDate: data.paymentDueDate || '',
    notes: data.notes || ''
  });
  const [items, setItems] = useState(
    (data.items && data.items.length)
      ? data.items.map(it => ({ ...EMPTY_ITEM, ...it }))
      : [{ ...EMPTY_ITEM }]
  );
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

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
  const addItem = () => setItems(prev => [...prev, { ...EMPTY_ITEM }]);
  const removeItem = (idx) => setItems(prev => prev.filter((_, i) => i !== idx));
  const totalValue = items.reduce((s, it) => s + toNumber(it.amount), 0);

  /* Combined material suggestions: defaults + saved template materials */
  const allMaterials = [...new Set([
    ...DEFAULT_BOM_MATERIALS,
    ...bomTemplates.flatMap(t => (t.items || []).map(it => it.materialName).filter(Boolean))
  ])];

  /* Template operations */
  const loadTemplate = (templateId) => {
    const tpl = bomTemplates.find(t => t.id === templateId);
    if (!tpl || !tpl.items) return;
    if (items.some(it => it.materialName) && !window.confirm('This will replace current items. Continue?')) return;
    setItems(tpl.items.map(it => ({
      materialName: it.materialName || '',
      quantity: it.quantity || '',
      unit: it.unit || 'Nos',
      specification: it.specification || '',
      remarks: it.remarks || '',
      rate: '', amount: 0
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

  const deleteTemplate = async (tplId) => {
    if (!window.confirm('Delete this template permanently?')) return;
    try { await deleteDocument('bomTemplates', tplId); toast('Template deleted'); }
    catch (e) { toast(e.message, 'er'); }
  };

  return (
    <Modal title={id ? 'Edit Purchase Order' : 'New Purchase Order'} onClose={onClose} wide>
      <form onSubmit={e => { e.preventDefault(); onSave({ ...f, items, totalValue }, id); }}>
        <div className="mb">
          <div className="fr"><div className="fg"><label>PO Number</label><input className="fi" value={f.poNumber} onChange={e => set('poNumber', e.target.value)} placeholder="Auto or manual" /></div><div className="fg"><label>PO Date *</label><input type="date" className="fi" value={f.poDate} onChange={e => set('poDate', e.target.value)} required /></div></div>
          <div className="fr"><div className="fg"><label>Vendor Name *</label><input className="fi" value={f.vendorName} onChange={e => set('vendorName', e.target.value)} required /></div><div className="fg"><label>Vendor Phone</label><input className="fi" value={f.vendorPhone} onChange={e => set('vendorPhone', e.target.value)} /></div></div>
          <div className="fr"><div className="fg"><label>Vendor Email</label><input type="email" className="fi" value={f.vendorEmail} onChange={e => set('vendorEmail', e.target.value)} /></div><div className="fg"><label>Expected Delivery</label><input type="date" className="fi" value={f.expectedDeliveryDate} onChange={e => set('expectedDeliveryDate', e.target.value)} /></div></div>

          {/* BOM Section */}
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

            {/* Template chips for quick delete */}
            {canManageTemplates && bomTemplates.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                {bomTemplates.map(t => (
                  <span key={t.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(26,58,122,.06)', padding: '3px 10px', borderRadius: 12, fontSize: '.76rem', color: 'var(--muted)' }}>
                    {t.name}
                    {hasAccess(role, 'admin') && <span className="material-icons-round" style={{ fontSize: 14, cursor: 'pointer', color: 'var(--err)' }} onClick={() => deleteTemplate(t.id)}>close</span>}
                  </span>
                ))}
              </div>
            )}

            {/* BOM Items */}
            {items.map((item, i) => (
              <div key={i} style={{ border: '1px solid var(--bor)', borderRadius: 8, padding: '8px 10px', marginBottom: 8, background: '#fafbfc' }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
                  <div className="fg" style={{ flex: 3, marginBottom: 0 }}>{i === 0 && <label>Material</label>}<input className="fi" value={item.materialName} onChange={e => setItem(i, 'materialName', e.target.value)} list="bom-materials" placeholder="Material name" /></div>
                  <div className="fg" style={{ flex: 1, marginBottom: 0 }}>{i === 0 && <label>Qty</label>}<input type="number" className="fi" value={item.quantity} onChange={e => setItem(i, 'quantity', e.target.value)} /></div>
                  <div className="fg" style={{ flex: 0.8, marginBottom: 0 }}>{i === 0 && <label>Unit</label>}<input className="fi" value={item.unit} onChange={e => setItem(i, 'unit', e.target.value)} placeholder="Nos" /></div>
                  <div className="fg" style={{ flex: 1, marginBottom: 0 }}>{i === 0 && <label>Rate</label>}<input type="number" className="fi" value={item.rate} onChange={e => setItem(i, 'rate', e.target.value)} /></div>
                  <div className="fg" style={{ flex: 1, marginBottom: 0 }}>{i === 0 && <label>Amount</label>}<input className="fi" value={formatCurrency(toNumber(item.quantity) * toNumber(item.rate))} disabled /></div>
                  {items.length > 1 && <button type="button" className="btn bsm bo" onClick={() => removeItem(i)} style={{ color: 'var(--err)', marginBottom: 0 }}><span className="material-icons-round" style={{ fontSize: 16 }}>close</span></button>}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <div className="fg" style={{ flex: 1, marginBottom: 0 }}>{i === 0 && <label style={{ fontSize: '.76rem' }}>Specification</label>}<input className="fi" style={{ fontSize: '.85rem' }} value={item.specification} onChange={e => setItem(i, 'specification', e.target.value)} placeholder="Model / Rating" /></div>
                  <div className="fg" style={{ flex: 1, marginBottom: 0 }}>{i === 0 && <label style={{ fontSize: '.76rem' }}>Remarks</label>}<input className="fi" style={{ fontSize: '.85rem' }} value={item.remarks} onChange={e => setItem(i, 'remarks', e.target.value)} placeholder="Remarks" /></div>
                </div>
              </div>
            ))}
            <button type="button" className="btn bsm bo" onClick={addItem} style={{ marginTop: 6 }}><span className="material-icons-round" style={{ fontSize: 16 }}>add</span> Add Item</button>
            <datalist id="bom-materials">{allMaterials.map(m => <option key={m} value={m} />)}</datalist>
            <div style={{ textAlign: 'right', fontWeight: 700, fontSize: '1rem', marginTop: 10 }}>Total: {formatCurrency(totalValue)}</div>
          </div>

          <div className="fr"><div className="fg"><label>Status</label><select className="fi" value={f.status} onChange={e => set('status', e.target.value)}>{poStatuses.map(s => <option key={s}>{s}</option>)}</select></div><div className="fg"><label>Payment Terms</label><input className="fi" value={f.paymentTerms} onChange={e => set('paymentTerms', e.target.value)} /></div></div>
          <div className="fg"><label>Payment Due Date</label><input type="date" className="fi" value={f.paymentDueDate} onChange={e => set('paymentDueDate', e.target.value)} /></div>
          <div className="fg"><label>Notes</label><textarea className="fi" value={f.notes} onChange={e => set('notes', e.target.value)} rows="3" /></div>
        </div>
        <div className="mf"><button type="button" className="btn bo" onClick={onClose}>Cancel</button><button type="submit" className="btn bp">{id ? 'Update' : 'Create'} PO</button></div>
      </form>
    </Modal>
  );
}

/* ============ PRINT PO ============ */
function printPO(po) {
  const e = escapeHtml;
  const w = window.open('', '_blank');
  if (!w) { alert('Popup blocked — please allow popups to print the PO.'); return; }
  w.document.write(`<html><head><title>PO - ${e(po.poNumber) || 'Purchase Order'}</title>
<style>body{font-family:Arial,sans-serif;padding:40px;line-height:1.7;font-size:13px;color:#333}.hd{text-align:center;margin-bottom:30px}.hd h1{font-size:20px;margin:0;color:#1a3a7a}.hd p{margin:2px 0;color:#666;font-size:12px}.meta{display:flex;justify-content:space-between;margin-bottom:15px;font-size:13px}table{width:100%;border-collapse:collapse;margin:20px 0}th,td{border:1px solid #ddd;padding:8px;text-align:left;font-size:13px}th{background:#f5f5f5;font-weight:600}.sec{margin:15px 0}.footer{margin-top:30px;font-size:11px;color:#999;text-align:center}@media print{body{padding:20px}}</style>
</head><body>
<div class="hd"><h1>PRAGATHI POWER SOLUTIONS</h1><p>Solar Energy Solutions | Tirupati</p></div>
<div class="meta"><div><strong>PO Number:</strong> ${e(po.poNumber) || '-'}</div><div><strong>Date:</strong> ${e(po.poDate) || '-'}</div><div><strong>Status:</strong> ${e(po.status) || '-'}</div></div>
<div class="sec"><strong>Vendor:</strong> ${e(po.vendorName) || '-'}${po.vendorPhone ? ' | Phone: ' + e(po.vendorPhone) : ''}${po.vendorEmail ? ' | Email: ' + e(po.vendorEmail) : ''}</div>
${po.expectedDeliveryDate ? '<div class="sec"><strong>Expected Delivery:</strong> ' + e(po.expectedDeliveryDate) + '</div>' : ''}
${(po.items || []).length > 0 ? `<table><thead><tr><th>#</th><th>Material</th><th>Specification</th><th>Qty</th><th>Unit</th><th>Rate (₹)</th><th>Amount (₹)</th><th>Remarks</th></tr></thead><tbody>
${po.items.map((item, i) => '<tr><td>' + (i + 1) + '</td><td>' + e(item.materialName) + '</td><td>' + (e(item.specification) || '-') + '</td><td>' + item.quantity + '</td><td>' + (e(item.unit) || '-') + '</td><td>' + Number(item.rate).toLocaleString('en-IN') + '</td><td>' + Number(item.amount).toLocaleString('en-IN') + '</td><td>' + (e(item.remarks) || '-') + '</td></tr>').join('')}
<tr style="font-weight:700"><td colspan="6" style="text-align:right">Total</td><td>₹${Number(po.totalValue || 0).toLocaleString('en-IN')}</td><td></td></tr>
</tbody></table>` : '<p style="color:#999">No items.</p>'}
${po.paymentTerms ? '<div class="sec"><strong>Payment Terms:</strong> ' + e(po.paymentTerms) + (po.paymentDueDate ? ' | Due: ' + e(po.paymentDueDate) : '') + '</div>' : ''}
${po.notes ? '<div class="sec"><strong>Notes:</strong> ' + e(po.notes) + '</div>' : ''}
<div class="footer">Pragathi Power Solutions — Printed on ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
</body></html>`);
  w.document.close();
  w.print();
}

/* ============ WHATSAPP SHARE PO ============ */
function sharePOWhatsApp(po) {
  const items = (po.items || []).map((item, i) =>
    (i + 1) + '. ' + item.materialName + (item.specification ? ' (' + item.specification + ')' : '') + ' - Qty: ' + item.quantity + (item.unit ? ' ' + item.unit : '') + ' - ₹' + Number(item.amount).toLocaleString('en-IN')
  ).join('\n');

  const msg = '*PURCHASE ORDER - ' + (po.poNumber || 'N/A') + '*\n\n' +
    'Date: ' + (po.poDate || '-') + '\n' +
    'Vendor: ' + (po.vendorName || '-') + '\n' +
    (po.expectedDeliveryDate ? 'Expected Delivery: ' + po.expectedDeliveryDate + '\n' : '') +
    'Status: ' + (po.status || '-') + '\n\n' +
    '*BOM Items:*\n' + items + '\n\n' +
    '*Total: ₹' + Number(po.totalValue || 0).toLocaleString('en-IN') + '*' +
    (po.paymentTerms ? '\n\nPayment: ' + po.paymentTerms : '') +
    (po.paymentDueDate ? '\nDue: ' + po.paymentDueDate : '') +
    (po.notes ? '\n\nNotes: ' + po.notes : '') +
    '\n\n_Pragathi Power Solutions_';

  let url;
  if (po.vendorPhone) {
    const phone = po.vendorPhone.replace(/\D/g, '');
    url = 'https://wa.me/' + (phone.length === 10 ? '91' + phone : phone) + '?text=' + encodeURIComponent(msg);
  } else {
    url = 'https://wa.me/?text=' + encodeURIComponent(msg);
  }
  const win = window.open(url, '_blank');
  if (!win) alert('Popup blocked — please allow popups for WhatsApp sharing.');
}
