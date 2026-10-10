import React, { useMemo, useState } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { addDocument, updateDocument, deleteDocument } from '../services/firestore';
import { toNumber, hasAccess, formatDate, formatDateTime, todayStr } from '../services/helpers';
import { Modal, EmptyState, DateFilter, StatusBadge, SearchSelect, DateInput } from '../components/SharedUI';
import { DATE_FILTER_ALL, applyDateFilter } from '../services/dateFilter';
import {
  STOCK_TYPES, STOCK_STATUS, STOCK_DATE_FIELDS, isStockOpen,
  canEnterStock, canReviewStock, canApproveStock, canCorrectStockDirectly,
  stockStatusOf, qtyText, signedQty, materialSummary, pendingStockEntries, stockEntryActions, stockEntryState, stockTypeLabel,
  receivablePOs, poReceiptProgress,
} from '../services/stock';
import { submitStockReceipt, submitStockAdjustment, reviewStockEntry, approveStockEntry, newClientRef } from '../services/stockApi';

const MATERIAL_DATE_FIELDS = ['lastStockChangeAt', 'updatedAt', 'createdAt'];
const MATERIAL_CATEGORIES = ['Complete Kit', 'Inverter', 'Solar Panels', 'DC Cable', 'AC Cable', 'MMS Structure', 'Earthing', 'Protection (ACDB / DCDB / SPD)', 'Accessories', 'Other'];

// ============================================================================
// Materials & Inventory.
//
// The summary table is the one that was always here (Material, Stock,
// Dispatched, Installed, Balance, Unit, Status) with the quantity still
// awaiting approval beside it. What changed (10-Oct) is how the figures move:
// nobody types a stock figure any more. The warehouse records a receipt, the
// Operation Manager reviews it, the Owner approves it and the server adds it
// — once. A count that disagrees with the book figure is a discrepancy report
// that goes the same way. Stock comes out only on a PO's final dispatch. Every
// one of those is a line in the ledger shown under each material.
// ============================================================================
export default function Materials() {
  const { materials, stockTransactions, purchaseOrders, leadPOs, leads } = useData();
  const { role, user } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState('materials');
  const [modal, setModal] = useState(null);        // { kind: 'material'|'receipt'|'adjustment'|'detail'|'decide', ... }
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState(DATE_FILTER_ALL);

  const canAdd = hasAccess(role, 'manager');       // Add / edit a material's name, unit, category — as before
  const mayEnter = canEnterStock(role);
  const mayReview = canReviewStock(role);
  const mayApprove = canApproveStock(role);
  const pending = useMemo(() => pendingStockEntries(stockTransactions), [stockTransactions]);
  const myPending = pending.filter(t => { const a = stockEntryActions(t, user, role); return a.forward || a.approve || a.reject; });

  // The Day / Month filter (R15): a material belongs to the day its stock last moved.
  const shown = useMemo(() => {
    let list = applyDateFilter(materials, dateFilter, MATERIAL_DATE_FIELDS);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(m => String(m.name || '').toLowerCase().includes(q) || String(m.category || '').toLowerCase().includes(q));
    return [...list].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }, [materials, dateFilter, search]);

  const summaries = useMemo(() => {
    const map = {};
    materials.forEach(m => { map[m.id] = materialSummary(m, stockTransactions); });
    return map;
  }, [materials, stockTransactions]);

  const saveMaterial = async (data, id) => {
    try {
      const cleaned = { name: data.name.trim(), unit: data.unit.trim() || 'pcs', category: data.category || '' };
      // The installed figure is informational (not part of the balance) and
      // stays the Owner's to set; the stock figures are never sent from here.
      if (id && mayApprove) cleaned.installed = toNumber(data.installed);
      if (id) { await updateDocument('materials', id, cleaned); toast('Material updated'); }
      else {
        // Only the Owner may open a material with stock already in hand; for
        // everyone else it starts at zero and is filled by a receipt.
        const opening = mayApprove ? toNumber(data.openingStock) : 0;
        await addDocument('materials', { ...cleaned, stock: opening, balance: opening, openingStock: opening, dispatched: 0, installed: 0 });
        toast(opening > 0 ? 'Material added with its opening stock' : 'Material added — record a stock receipt to bring stock in');
      }
      setModal(null);
    } catch (e) { toast(e.message, 'er'); }
  };

  const handleDelete = async (m) => {
    if ((summaries[m.id] || {}).lines?.length) { toast('This material has stock transactions and cannot be deleted. Correct its figures with a stock correction instead.', 'er'); return; }
    if (window.confirm(`Delete the material "${m.name}"?`)) {
      try { await deleteDocument('materials', m.id); toast('Material deleted'); }
      catch (e) { toast(e.message, 'er'); }
    }
  };

  const tabButton = (key, label, icon, count) => (
    <button key={key} onClick={() => setTab(key)} className={`btn bsm ${tab === key ? 'bp' : 'bo'}`} style={{ borderRadius: 20 }}>
      <span className="material-icons-round" style={{ fontSize: 16 }}>{icon}</span> {label}
      {count ? <span style={{ marginLeft: 6, background: tab === key ? 'rgba(255,255,255,.3)' : '#fdecea', color: tab === key ? '#fff' : '#c0392b', borderRadius: 10, padding: '0 7px', fontSize: '.7rem', fontWeight: 700 }}>{count}</span> : null}
    </button>
  );

  return (
    <>
      <div className="tl">
        <h3>Materials & Inventory</h3>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {mayEnter && <button className="btn bp bsm" onClick={() => setModal({ kind: 'receipt' })} title="Record material that has arrived — it goes to the Operation Manager and the Owner for approval"><span className="material-icons-round" style={{ fontSize: 18 }}>move_to_inbox</span> Receive Stock</button>}
          {mayEnter && <button className="btn bo bsm" onClick={() => setModal({ kind: 'adjustment' })} title={mayApprove ? 'Correct a stock figure, with the reason on record' : 'Report a physical count that differs from the book figure'}><span className="material-icons-round" style={{ fontSize: 18 }}>rule</span> {mayApprove ? 'Correct Stock' : 'Report Discrepancy'}</button>}
          {canAdd && <button className="btn bo bsm" onClick={() => setModal({ kind: 'material', data: {} })}><span className="material-icons-round" style={{ fontSize: 18 }}>add</span> Add Material</button>}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        {tabButton('materials', 'Materials', 'inventory_2')}
        {(mayReview || mayApprove || mayEnter) && tabButton('approvals', 'Approvals', 'fact_check', myPending.length)}
        {tabButton('ledger', 'Stock History', 'receipt_long')}
        <span style={{ flex: 1 }} />
        <DateFilter value={dateFilter} onChange={setDateFilter} records={tab === 'materials' ? materials : stockTransactions} fields={tab === 'materials' ? MATERIAL_DATE_FIELDS : STOCK_DATE_FIELDS} compact />
      </div>

      {tab === 'materials' && (
        <>
          <div className="sb-x" style={{ marginBottom: 10 }}><span className="material-icons-round">search</span><input type="text" placeholder="Search materials..." value={search} onChange={e => setSearch(e.target.value)} /></div>
          <div className="card"><div className="cb" style={{ padding: 0 }}><div className="tw"><table><thead><tr>
            <th>Material</th><th>Stock</th><th>Dispatched</th><th>Installed</th><th>Balance</th><th>Pending</th><th>Unit</th><th>Status</th><th>Actions</th>
          </tr></thead><tbody>
            {shown.map(m => {
              const s = summaries[m.id] || materialSummary(m, []);
              return (
                <tr key={m.id}>
                  <td style={{ fontWeight: 600 }}>
                    <button className="btn bsm bo" style={{ border: 'none', padding: 0, fontWeight: 600, color: 'var(--dark)' }} onClick={() => setModal({ kind: 'detail', id: m.id })} title="Open the stock history">{m.name}</button>
                    {m.category ? <div style={{ fontSize: '.72rem', color: 'var(--muted)', fontWeight: 400 }}>{m.category}</div> : null}
                  </td>
                  <td>{m.stock}</td><td>{m.dispatched}</td><td>{m.installed}</td>
                  <td style={{ fontWeight: 700 }}>{m.balance}</td>
                  <td>{s.pendingReceiptQty || s.pendingAdjustmentCount
                    ? <span style={{ color: '#d68910', fontSize: '.8rem' }} title="Awaiting approval — not yet in the balance">
                        {s.pendingReceiptQty ? `+${qtyText(s.pendingReceiptQty)} receipt` : ''}{s.pendingReceiptQty && s.pendingAdjustmentCount ? ', ' : ''}{s.pendingAdjustmentCount ? `${s.pendingAdjustmentCount} correction${s.pendingAdjustmentCount > 1 ? 's' : ''}` : ''}
                      </span>
                    : <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                  <td>{m.unit}</td>
                  <td><StatusBadge status={stockStatusOf(m.balance)} /></td>
                  <td><div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn bsm bo" onClick={() => setModal({ kind: 'detail', id: m.id })} title="Stock history"><span className="material-icons-round" style={{ fontSize: 16 }}>history</span></button>
                    {mayEnter && <button className="btn bsm bo" onClick={() => setModal({ kind: 'receipt', materialId: m.id })} title="Receive stock of this material"><span className="material-icons-round" style={{ fontSize: 16 }}>move_to_inbox</span></button>}
                    {canAdd && <button className="btn bsm bo" onClick={() => setModal({ kind: 'material', data: m, id: m.id })} title="Edit the name, unit or category"><span className="material-icons-round" style={{ fontSize: 16 }}>edit</span></button>}
                    {hasAccess(role, 'admin') && <button className="btn bsm bo" onClick={() => handleDelete(m)} style={{ color: 'var(--err)', borderColor: 'rgba(231,76,60,.3)' }} title="Delete (only a material with no stock history)"><span className="material-icons-round" style={{ fontSize: 16 }}>delete</span></button>}
                  </div></td>
                </tr>
              );
            })}
            {!shown.length && <tr><td colSpan={9}><EmptyState icon="inventory_2" title="No materials" message={materials.length ? 'No materials match the search or the chosen period.' : 'Add materials to track inventory.'} /></td></tr>}
          </tbody></table></div></div></div>
        </>
      )}

      {tab === 'approvals' && (
        <ApprovalsPanel entries={pending} user={user} role={role} onDecide={(t, action) => setModal({ kind: 'decide', id: t.id, action })} />
      )}

      {tab === 'ledger' && <LedgerTable txns={applyDateFilter(stockTransactions, dateFilter, STOCK_DATE_FIELDS)} showMaterial />}

      {modal && modal.kind === 'material' && <MaterialModal data={modal.data} id={modal.id} owner={mayApprove} onSave={saveMaterial} onClose={() => setModal(null)} />}
      {modal && modal.kind === 'receipt' && <ReceiptModal materials={materials} initialMaterialId={modal.materialId} pos={receivablePOs(purchaseOrders, leadPOs, leads)} txns={stockTransactions} onClose={() => setModal(null)} />}
      {modal && modal.kind === 'adjustment' && <AdjustmentModal materials={materials} initialMaterialId={modal.materialId} direct={canCorrectStockDirectly(role)} onClose={() => setModal(null)} />}
      {modal && modal.kind === 'detail' && (() => {
        const m = materials.find(x => x.id === modal.id);
        return m ? <MaterialDetailModal material={m} txns={stockTransactions} onReceive={mayEnter ? () => setModal({ kind: 'receipt', materialId: m.id }) : null} onClose={() => setModal(null)} /> : null;
      })()}
      {modal && modal.kind === 'decide' && (() => {
        const t = stockTransactions.find(x => x.id === modal.id);
        return t ? <DecideModal entry={t} action={modal.action} role={role} onClose={() => setModal(null)} /> : null;
      })()}
    </>
  );
}

// ── Add / edit a material: the name, unit and category; the figures are the ledger's ──
function MaterialModal({ data, id, owner, onSave, onClose }) {
  const [f, setF] = useState({ name: data.name || '', unit: data.unit || 'pcs', category: data.category || '', openingStock: '', installed: data.installed ?? 0 });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  return (
    <Modal title={id ? 'Edit Material' : 'Add Material'} onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); onSave(f, id); }}>
        <div className="mb">
          <div className="fr">
            <div className="fg"><label>Material Name *</label><input className="fi" value={f.name} onChange={e => set('name', e.target.value)} required placeholder="e.g. AC Cable 4 sq mm" /></div>
            <div className="fg"><label>Unit</label><input className="fi" value={f.unit} onChange={e => set('unit', e.target.value)} placeholder="pcs / mtrs / kg" /></div>
          </div>
          <div className="fr">
            <div className="fg"><label>Category</label>
              <select className="fi" value={f.category} onChange={e => set('category', e.target.value)}>
                <option value="">— none —</option>
                {MATERIAL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            {!id && owner && <div className="fg"><label>Opening Stock (Owner)</label><input type="number" min="0" step="any" className="fi" value={f.openingStock} onChange={e => set('openingStock', e.target.value)} placeholder="0" /></div>}
            {id && owner && <div className="fg"><label>Installed (Owner)</label><input type="number" min="0" step="any" className="fi" value={f.installed} onChange={e => set('installed', e.target.value)} /></div>}
          </div>
          {id ? (
            <p style={{ fontSize: '.78rem', color: 'var(--muted)', margin: 0 }}>
              Stock: <strong>{data.stock}</strong> · Dispatched: <strong>{data.dispatched}</strong> · Balance: <strong>{data.balance}</strong>. These figures change only through a stock receipt, a dispatch or a {owner ? 'stock correction' : 'discrepancy report approved by the Owner'} — not here.
            </p>
          ) : (
            <p style={{ fontSize: '.78rem', color: 'var(--muted)', margin: 0 }}>
              {owner ? 'An opening stock is recorded as the first line of this material\'s history. Leave it blank to start at zero.' : 'A new material starts at zero. Record a stock receipt to bring stock in; it is added once the Owner approves it.'}
            </p>
          )}
        </div>
        <div className="mf"><button type="button" className="btn bo" onClick={onClose}>Cancel</button><button type="submit" className="btn bp">{id ? 'Update' : 'Add'}</button></div>
      </form>
    </Modal>
  );
}

// ── The warehouse records a receipt ─────────────────────────────────────────
function ReceiptModal({ materials, initialMaterialId, pos, txns, onClose }) {
  const { toast } = useToast();
  const initial = materials.find(m => m.id === initialMaterialId);
  const [f, setF] = useState({ materialName: initial ? initial.name : '', quantity: '', receiptDate: todayStr(), poLabel: '', poItemIndex: '', supplier: '', remarks: '' });
  const [clientRef] = useState(newClientRef);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  const material = materials.find(m => m.name === f.materialName) || null;
  const po = pos.find(p => p.label === f.poLabel) || null;
  const progress = po ? poReceiptProgress({ id: po.id, items: po.items }, txns) : [];
  const line = po && f.poItemIndex !== '' ? progress[Number(f.poItemIndex)] : null;

  // Choosing a PO line that names a material picks that material too.
  const choosePo = (label) => {
    const p = pos.find(x => x.label === label) || null;
    setF(prev => ({ ...prev, poLabel: label, poItemIndex: '', supplier: p && p.source === 'standalone' ? (p.party || prev.supplier) : prev.supplier }));
  };
  const chooseLine = (idx) => {
    set('poItemIndex', idx);
    if (idx === '' || !po) return;
    const it = po.items[Number(idx)];
    if (!it) return;
    const match = materials.find(m => String(m.name || '').toLowerCase() === String(it.materialName || '').toLowerCase());
    if (match && !f.materialName) set('materialName', match.name);
    const left = progress[Number(idx)];
    if (left && !f.quantity && left.remaining > 0) set('quantity', String(left.remaining));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!material) { toast('Choose the material that was received', 'er'); return; }
    if (toNumber(f.quantity) <= 0) { toast('Enter the quantity received', 'er'); return; }
    if (po && f.poItemIndex === '') { toast('Choose which line of the purchase order this receipt is against', 'er'); return; }
    setBusy(true);
    try {
      const res = await submitStockReceipt({
        clientRef, materialId: material.id, quantity: toNumber(f.quantity), receiptDate: f.receiptDate,
        poId: po ? po.id : '', poSource: po ? po.source : '', poItemIndex: po ? Number(f.poItemIndex) : null,
        supplier: f.supplier.trim(), remarks: f.remarks.trim(),
      });
      toast(`Receipt ${res.reference || ''} submitted — the Operation Manager has been notified. The stock is added once the Owner approves it.`);
      onClose();
    } catch (err) { toast(err.message, 'er'); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Receive Stock" onClose={onClose} wide>
      <form onSubmit={submit}>
        <div className="mb">
          <div className="fr">
            <div className="fg" style={{ flex: 2 }}><label>Material *</label>
              <SearchSelect value={f.materialName} onChange={v => set('materialName', v)} options={materials.map(m => m.name).filter(Boolean).sort()} allowFree={false} placeholder="Search the material…" />
              {material && <div style={{ fontSize: '.74rem', color: 'var(--muted)', marginTop: 3 }}>Available now: <strong>{qtyText(material.balance, material.unit)}</strong> · Stock {qtyText(material.stock, material.unit)} · Dispatched {qtyText(material.dispatched, material.unit)}</div>}
            </div>
            <div className="fg"><label>Quantity Received * {material ? `(${material.unit})` : ''}</label><input type="number" min="0" step="any" className="fi" value={f.quantity} onChange={e => set('quantity', e.target.value)} required /></div>
            <div className="fg"><label>Receipt Date *</label><DateInput value={f.receiptDate} onChange={e => set('receiptDate', e.target.value)} max={todayStr()} required /></div>
          </div>
          <div className="fr">
            <div className="fg" style={{ flex: 2 }}><label>Against Purchase Order (optional)</label>
              <SearchSelect value={f.poLabel} onChange={choosePo} options={pos.map(p => p.label)} allowFree={false} placeholder="Search by PO number, vendor or customer…" emptyText="No purchase order with items" />
            </div>
            {po && (
              <div className="fg" style={{ flex: 2 }}><label>PO Line *</label>
                <select className="fi" value={f.poItemIndex} onChange={e => chooseLine(e.target.value)} required>
                  <option value="">Choose the item…</option>
                  {progress.map(l => <option key={l.index} value={l.index}>{l.name} — ordered {qtyText(l.ordered, l.unit)}, received {qtyText(l.approved, l.unit)}{l.pending ? `, awaiting approval ${qtyText(l.pending, l.unit)}` : ''}, remaining {qtyText(l.remaining, l.unit)}</option>)}
                </select>
              </div>
            )}
          </div>
          {line && (
            <div style={{ fontSize: '.78rem', background: line.remaining <= 0 ? '#fdecea' : '#f6f8fa', border: '1px solid var(--bor)', borderRadius: 8, padding: '8px 10px', marginBottom: 10 }}>
              <strong>{line.name}</strong> on PO {po.poNumber}: ordered <strong>{qtyText(line.ordered, line.unit)}</strong>, received so far <strong>{qtyText(line.approved, line.unit)}</strong>{line.pending ? <>, awaiting approval <strong>{qtyText(line.pending, line.unit)}</strong></> : null}, remaining <strong>{qtyText(line.remaining, line.unit)}</strong>.
              {toNumber(f.quantity) > line.remaining + 1e-9 && <div style={{ color: '#c0392b', marginTop: 4 }}>This receipt is more than the line still has to come. Only an Admin or the Owner can record an excess, with the reason in the remarks.</div>}
            </div>
          )}
          <div className="fr">
            <div className="fg"><label>Supplier (optional)</label><input className="fi" value={f.supplier} onChange={e => set('supplier', e.target.value)} placeholder="Vendor / transporter" /></div>
            <div className="fg" style={{ flex: 2 }}><label>Remarks</label><input className="fi" value={f.remarks} onChange={e => set('remarks', e.target.value)} placeholder="Invoice no., condition, anything the reviewer should know" /></div>
          </div>
          <p style={{ fontSize: '.76rem', color: 'var(--muted)', margin: 0 }}>The receipt is submitted for review. It is not added to the available stock until the Operation Manager forwards it and the Owner approves it; until then it shows as "Pending".</p>
        </div>
        <div className="mf"><button type="button" className="btn bo" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="btn bp" disabled={busy}><span className="material-icons-round" style={{ fontSize: 16 }}>send</span> Submit for Approval</button></div>
      </form>
    </Modal>
  );
}

// ── A discrepancy report — or, for the Owner, a correction applied at once ──
function AdjustmentModal({ materials, initialMaterialId, direct, onClose }) {
  const { toast } = useToast();
  const initial = materials.find(m => m.id === initialMaterialId);
  const [f, setF] = useState({ materialName: initial ? initial.name : '', counted: '', reason: '', applyNow: direct });
  const [clientRef] = useState(newClientRef);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const material = materials.find(m => m.name === f.materialName) || null;
  const delta = material && f.counted !== '' ? Math.round((toNumber(f.counted) - toNumber(material.balance)) * 1000) / 1000 : null;

  const submit = async (e) => {
    e.preventDefault();
    if (!material) { toast('Choose the material', 'er'); return; }
    if (f.counted === '') { toast('Enter the quantity physically counted', 'er'); return; }
    if (!f.reason.trim()) { toast('A reason is required for every stock correction', 'er'); return; }
    if (delta === 0) { toast('The counted quantity matches the book figure — nothing to correct', 'er'); return; }
    if (f.applyNow && !window.confirm(`Correct ${material.name} from ${qtyText(material.balance, material.unit)} to ${qtyText(f.counted, material.unit)} now?`)) return;
    setBusy(true);
    try {
      const res = await submitStockAdjustment({ clientRef, materialId: material.id, countedQuantity: toNumber(f.counted), reason: f.reason.trim(), direct: !!f.applyNow });
      toast(f.applyNow ? `Stock corrected (ref ${res.reference || ''})` : `Discrepancy ${res.reference || ''} reported — the Operation Manager and the Owner have been notified`);
      onClose();
    } catch (err) { toast(err.message, 'er'); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={direct ? 'Correct Stock' : 'Report a Stock Discrepancy'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="mb">
          <div className="fg"><label>Material *</label>
            <SearchSelect value={f.materialName} onChange={v => set('materialName', v)} options={materials.map(m => m.name).filter(Boolean).sort()} allowFree={false} placeholder="Search the material…" />
          </div>
          <div className="fr">
            <div className="fg"><label>Book Balance</label><input className="fi" value={material ? qtyText(material.balance, material.unit) : ''} readOnly disabled /></div>
            <div className="fg"><label>Physically Counted * {material ? `(${material.unit})` : ''}</label><input type="number" min="0" step="any" className="fi" value={f.counted} onChange={e => set('counted', e.target.value)} required /></div>
          </div>
          {delta !== null && delta !== 0 && <p style={{ fontSize: '.8rem', margin: '0 0 10px', color: delta < 0 ? '#c0392b' : '#1e8449' }}>Difference: <strong>{signedQty(delta, material.unit)}</strong> — the balance becomes {qtyText(f.counted, material.unit)} once approved.</p>}
          <div className="fg"><label>Reason *</label><textarea className="fi" rows={2} value={f.reason} onChange={e => set('reason', e.target.value)} required placeholder="e.g. physical verification on 10-10-2026 found 37; one damaged in transit" /></div>
          {direct && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '.82rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={!!f.applyNow} onChange={e => set('applyNow', e.target.checked)} /> Apply now as the Owner's correction (otherwise it goes through the Operation Manager's review first)
            </label>
          )}
          {!f.applyNow && <p style={{ fontSize: '.76rem', color: 'var(--muted)', margin: '8px 0 0' }}>The stock figure is not changed by this report. The Operation Manager reviews it and the Owner approves or rejects the correction; every step is recorded.</p>}
        </div>
        <div className="mf"><button type="button" className="btn bo" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="btn bp" disabled={busy}>{f.applyNow ? 'Correct Stock' : 'Submit Report'}</button></div>
      </form>
    </Modal>
  );
}

// ── Where the entries waiting on somebody are decided ───────────────────────
function ApprovalsPanel({ entries, user, role, onDecide }) {
  if (!entries.length) return <div className="card"><div className="cb"><EmptyState icon="fact_check" title="Nothing awaiting approval" message="Receipts and discrepancy reports appear here until the Owner decides them." /></div></div>;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {entries.map(t => {
        const a = stockEntryActions(t, user, role);
        const isAdj = t.type === STOCK_TYPES.ADJUSTMENT;
        return (
          <div key={t.id} className="card" style={{ borderLeft: `4px solid ${t.status === STOCK_STATUS.FORWARDED ? '#2980b9' : '#d68910'}` }}>
            <div className="cb" style={{ padding: '12px 14px' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="material-icons-round" style={{ color: isAdj ? '#8e44ad' : '#1e8449' }}>{isAdj ? 'rule' : 'move_to_inbox'}</span>
                <strong>{stockTypeLabel(t.type)} — {t.materialName}</strong>
                <StatusBadge status={t.status} />
                <span style={{ fontSize: '.74rem', color: 'var(--muted)' }}>Ref {t.reference}</span>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: '.74rem', color: 'var(--muted)' }}>Submitted {formatDateTime(t.submittedAt)}</span>
              </div>
              <div className="dg" style={{ marginTop: 10 }}>
                {isAdj ? (
                  <>
                    <Item label="Book figure when counted" value={qtyText(t.balanceAtSubmission, t.unit)} />
                    <Item label="Physically counted" value={qtyText(t.countedQuantity, t.unit)} />
                    <Item label="Difference" value={<span style={{ color: toNumber(t.quantity) < 0 ? '#c0392b' : '#1e8449', fontWeight: 700 }}>{signedQty(t.quantity, t.unit)}</span>} />
                    <Item label="Reason" value={t.reason} />
                  </>
                ) : (
                  <>
                    <Item label="Quantity received" value={<strong>{qtyText(t.quantity, t.unit)}</strong>} />
                    <Item label="Receipt date" value={formatDate(t.receiptDate)} />
                    <Item label="Available stock when submitted" value={qtyText(t.balanceAtSubmission, t.unit)} />
                    <Item label="Balance after approval" value={qtyText(toNumber(t.balanceAtSubmission) + toNumber(t.quantity), t.unit)} />
                    <Item label="Purchase order" value={t.poNumber ? `${t.poNumber}${t.poItemName ? ' — ' + t.poItemName : ''}${t.poOrderedQty ? ` (ordered ${qtyText(t.poOrderedQty, t.unit)})` : ''}${t.overReceipt ? ' · EXCEEDS the PO line' : ''}` : 'None'} />
                    <Item label="Supplier" value={t.supplier} />
                    <Item label="Remarks" value={t.remarks} />
                  </>
                )}
                <Item label="Entered by" value={t.submittedBy} />
                {t.reviewedBy && <Item label="Reviewed by" value={`${t.reviewedBy} on ${formatDateTime(t.reviewedAt)}${t.reviewNote ? ' — ' + t.reviewNote : ''}`} />}
              </div>
              <div style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: 6 }}>{stockEntryState(t)}</div>
              {(a.forward || a.approve || a.reject) && (
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  {a.approve && <button className="btn bsm bp" style={{ background: '#1e8449' }} onClick={() => onDecide(t, 'approve')} title="Owner: apply this to the stock"><span className="material-icons-round" style={{ fontSize: 16 }}>verified</span> Approve &amp; Update Stock</button>}
                  {a.forward && <button className="btn bsm bp" onClick={() => onDecide(t, 'forward')} title="Send to the Owner for final approval"><span className="material-icons-round" style={{ fontSize: 16 }}>forward</span> Forward to Owner</button>}
                  {a.reject && <button className="btn bsm bo" style={{ color: 'var(--err)', borderColor: 'rgba(231,76,60,.3)' }} onClick={() => onDecide(t, 'reject')}><span className="material-icons-round" style={{ fontSize: 16 }}>block</span> Reject</button>}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Item({ label, value }) {
  return <div className="di"><div className="dl">{label}</div><div className="dv">{value || '-'}</div></div>;
}

// Forward / approve / reject, with a note (compulsory on a rejection).
function DecideModal({ entry, action, role, onClose }) {
  const { toast } = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const titles = { approve: 'Approve & Update Stock', forward: 'Forward to the Owner', reject: 'Reject this Entry' };
  const after = entry.type === STOCK_TYPES.ADJUSTMENT ? toNumber(entry.countedQuantity) : toNumber(entry.balanceAtSubmission) + toNumber(entry.quantity);
  const go = async () => {
    if (action === 'reject' && !note.trim()) { toast('Give the reason for rejecting it', 'er'); return; }
    setBusy(true);
    try {
      if (action === 'forward') { await reviewStockEntry(entry.id, 'forward', note.trim()); toast('Forwarded to the Owner — they have been notified'); }
      else if (action === 'approve') { await approveStockEntry(entry.id, 'approve', note.trim()); toast('Approved — the stock has been updated'); }
      // A rejection by the Owner goes through the approval route; by the
      // Operation Manager through the review route.
      else if (canApproveStock(role)) { await approveStockEntry(entry.id, 'reject', note.trim()); toast('Rejected — the person who entered it has been notified'); }
      else { await reviewStockEntry(entry.id, 'reject', note.trim()); toast('Rejected — the person who entered it has been notified'); }
      onClose();
    } catch (e) { toast(e.message, 'er'); }
    finally { setBusy(false); }
  };
  return (
    <Modal title={titles[action] || 'Decide'} onClose={onClose}>
      <div className="mb">
        <p style={{ fontSize: '.84rem', margin: '0 0 10px' }}>
          <strong>{stockTypeLabel(entry.type)}</strong> of <strong>{entry.type === STOCK_TYPES.ADJUSTMENT ? signedQty(entry.quantity, entry.unit) : qtyText(entry.quantity, entry.unit)}</strong> of <strong>{entry.materialName}</strong>, ref {entry.reference}, entered by {entry.submittedBy}.
          {action === 'approve' && <> The balance goes from <strong>{qtyText(entry.balanceAtSubmission, entry.unit)}</strong> to <strong>{qtyText(after, entry.unit)}</strong> (the server applies it to the figure as it stands now).</>}
        </p>
        <div className="fg"><label>{action === 'reject' ? 'Reason for rejection *' : 'Note (optional)'}</label><textarea className="fi" rows={2} value={note} onChange={e => setNote(e.target.value)} autoFocus /></div>
      </div>
      <div className="mf">
        <button type="button" className="btn bo" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={`btn ${action === 'reject' ? 'bo' : 'bp'}`} style={action === 'reject' ? { color: 'var(--err)', borderColor: 'rgba(231,76,60,.3)' } : action === 'approve' ? { background: '#1e8449' } : {}} onClick={go} disabled={busy}>{titles[action]}</button>
      </div>
    </Modal>
  );
}

// ── One material's figures and every line behind them ──────────────────────
function MaterialDetailModal({ material, txns, onReceive, onClose }) {
  const [dateFilter, setDateFilter] = useState(DATE_FILTER_ALL);
  const s = materialSummary(material, txns);
  const lines = applyDateFilter(s.lines, dateFilter, STOCK_DATE_FIELDS);
  const Card = ({ label, value, tone }) => (
    <div style={{ border: '1px solid var(--bor)', borderRadius: 10, padding: '8px 10px', minWidth: 120, flex: 1 }}>
      <div style={{ fontSize: '.7rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.03em' }}>{label}</div>
      <div style={{ fontSize: '1.05rem', fontWeight: 700, color: tone || 'var(--dark)' }}>{value}</div>
    </div>
  );
  return (
    <Modal title={`${material.name} — Stock History`} onClose={onClose} wide allowBackdropClose>
      <div className="mb">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <Card label="Available" value={qtyText(s.balance, material.unit)} tone={s.status === 'Low Stock' ? '#c0392b' : s.status === 'Medium' ? '#d68910' : '#1e8449'} />
          <Card label="Opening" value={qtyText(s.opening, material.unit)} />
          <Card label="Total Received" value={qtyText(s.received, material.unit)} />
          <Card label="Total Dispatched" value={qtyText(s.dispatched, material.unit)} />
          <Card label="Installed" value={qtyText(s.installed, material.unit)} />
          <Card label="Corrections" value={`${s.approvedAdjustmentCount} (${signedQty(s.adjusted, material.unit)})`} />
          <Card label="Pending Receipts" value={s.pendingReceiptCount ? `${s.pendingReceiptCount} · +${qtyText(s.pendingReceiptQty, material.unit)}` : 'None'} tone={s.pendingReceiptCount ? '#d68910' : undefined} />
          <Card label="Pending Corrections" value={s.pendingAdjustmentCount || 'None'} tone={s.pendingAdjustmentCount ? '#d68910' : undefined} />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
          <StatusBadge status={s.status} />
          <span style={{ fontSize: '.76rem', color: 'var(--muted)' }}>Stock {qtyText(s.stock, material.unit)}{material.category ? ` · ${material.category}` : ''}{material.lastStockChangeAt ? ` · last movement ${formatDateTime(material.lastStockChangeAt)} by ${material.lastStockChangeBy || '-'}` : ''}</span>
          <span style={{ flex: 1 }} />
          <DateFilter value={dateFilter} onChange={setDateFilter} records={s.lines} fields={STOCK_DATE_FIELDS} compact />
          {onReceive && <button className="btn bsm bp" onClick={onReceive}><span className="material-icons-round" style={{ fontSize: 16 }}>move_to_inbox</span> Receive</button>}
        </div>
        <LedgerTable txns={lines} />
      </div>
    </Modal>
  );
}

// The ledger as a table — every receipt, correction, dispatch and opening
// figure with who, when and what it did to the balance.
function LedgerTable({ txns, showMaterial }) {
  const sorted = [...(txns || [])].sort((a, b) => String(b.submittedAt || b.createdAt || '').localeCompare(String(a.submittedAt || a.createdAt || '')));
  const when = (t) => t.type === STOCK_TYPES.RECEIPT ? formatDate(t.receiptDate) : t.type === STOCK_TYPES.DISPATCH ? formatDate(t.dispatchDate) : formatDate(t.submittedAt);
  const refText = (t) => {
    const parts = [];
    if (t.poNumber) parts.push(`PO ${t.poNumber}${t.poItemName ? ' · ' + t.poItemName : ''}`);
    if (t.customerName) parts.push(t.customerName);
    if (t.destination && !t.customerName) parts.push(t.destination);
    if (t.supplier) parts.push(t.supplier);
    return parts.join(' — ');
  };
  const who = (t) => {
    if (t.type === STOCK_TYPES.DISPATCH) return `${t.confirmedBy || '-'}${t.assignedTo ? ` (assigned ${t.assignedTo})` : ''}`;
    const chain = [t.submittedBy, t.reviewedBy && `reviewed ${t.reviewedBy}`, t.approvedBy && `approved ${t.approvedBy}`, t.rejectedBy && `rejected ${t.rejectedBy}`].filter(Boolean);
    return chain.join(' → ');
  };
  return (
    <div className="card"><div className="cb" style={{ padding: 0 }}><div className="tw"><table style={{ fontSize: '.8rem' }}><thead><tr>
      <th>Date</th>{showMaterial && <th>Material</th>}<th>Type</th><th>Qty</th><th>Balance</th><th>Status</th><th>By</th><th>Reference</th><th>Remarks</th>
    </tr></thead><tbody>
      {sorted.map(t => (
        <tr key={t.id} style={{ opacity: t.status === STOCK_STATUS.REJECTED ? .6 : 1 }}>
          <td style={{ whiteSpace: 'nowrap' }}>{when(t)}<div style={{ fontSize: '.7rem', color: 'var(--muted)' }}>logged {formatDateTime(t.submittedAt)}</div></td>
          {showMaterial && <td style={{ fontWeight: 600 }}>{t.materialName}</td>}
          <td>{stockTypeLabel(t.type)}</td>
          <td style={{ fontWeight: 700, color: t.type === STOCK_TYPES.DISPATCH ? '#c0392b' : toNumber(t.quantity) < 0 ? '#c0392b' : '#1e8449', whiteSpace: 'nowrap' }}>
            {t.type === STOCK_TYPES.DISPATCH ? `−${qtyText(t.quantity, t.unit)}` : signedQty(t.quantity, t.unit)}
          </td>
          <td style={{ whiteSpace: 'nowrap' }}>{t.appliedAt ? `${qtyText(t.previousBalance, '')} → ${qtyText(t.newBalance, '')}` : isStockOpen(t) ? <span style={{ color: '#d68910' }}>not yet applied</span> : '—'}</td>
          <td><StatusBadge status={t.status} /></td>
          <td style={{ fontSize: '.74rem' }}>{who(t)}</td>
          <td style={{ fontSize: '.74rem' }}><div>{t.reference}</div><div style={{ color: 'var(--muted)' }}>{refText(t)}</div></td>
          <td style={{ fontSize: '.74rem', color: 'var(--muted)' }}>{t.type === STOCK_TYPES.ADJUSTMENT ? t.reason : t.remarks}{t.rejectReason ? <div style={{ color: '#c0392b' }}>Rejected: {t.rejectReason}</div> : null}</td>
        </tr>
      ))}
      {!sorted.length && <tr><td colSpan={showMaterial ? 9 : 8}><EmptyState icon="receipt_long" title="No stock movements" message="Receipts, corrections and dispatches appear here as they are recorded." /></td></tr>}
    </tbody></table></div></div></div>
  );
}
