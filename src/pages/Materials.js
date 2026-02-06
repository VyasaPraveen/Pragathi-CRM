import React, { useState } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { addDocument, updateDocument, deleteDocument } from '../services/firestore';
import { toNumber } from '../services/helpers';
import { Modal, EmptyState } from '../components/SharedUI';

// Q4 fix: added full CRUD (was read-only)
export default function Materials() {
  const { materials } = useData();
  const { role } = useAuth();
  const { toast } = useToast();
  const [modal, setModal] = useState(null);
  const canEdit = role === 'admin' || role === 'manager';

  const handleSave = async (data, id) => {
    try {
      const cleaned = { ...data, stock: toNumber(data.stock), dispatched: toNumber(data.dispatched), installed: toNumber(data.installed), balance: toNumber(data.balance) };
      if (id) { await updateDocument('materials', id, cleaned); toast('Material updated'); }
      else { await addDocument('materials', cleaned); toast('Material added'); }
      setModal(null);
    } catch (e) { toast(e.message, 'er'); }
  };

  const handleDelete = async (id) => {
    if (window.confirm('Delete this material?')) {
      try { await deleteDocument('materials', id); toast('Material deleted'); }
      catch (e) { toast(e.message, 'er'); }
    }
  };

  return (
    <>
      <div className="tl">
        <h3>Materials & Inventory</h3>
        {canEdit && <button className="btn bp bsm" onClick={() => setModal({ data: {} })}><span className="material-icons-round" style={{ fontSize: 18 }}>add</span> Add Material</button>}
      </div>
      <div className="card"><div className="cb" style={{ padding: 0 }}><div className="tw"><table><thead><tr><th>Material</th><th>Stock</th><th>Dispatched</th><th>Installed</th><th>Balance</th><th>Unit</th><th>Status</th>{canEdit && <th>Actions</th>}</tr></thead><tbody>
        {materials.map(m => (
          <tr key={m.id}>
            <td style={{ fontWeight: 600 }}>{m.name}</td><td>{m.stock}</td><td>{m.dispatched}</td><td>{m.installed}</td>
            <td style={{ fontWeight: 700 }}>{m.balance}</td><td>{m.unit}</td>
            <td>{m.balance < 10 ? <span className="st st-r">Low Stock</span> : m.balance < 30 ? <span className="st st-o">Medium</span> : <span className="st st-g">Good</span>}</td>
            {canEdit && <td><div style={{ display: 'flex', gap: 4 }}>
              <button className="btn bsm bo" onClick={() => setModal({ data: m, id: m.id })}><span className="material-icons-round" style={{ fontSize: 16 }}>edit</span></button>
              {role === 'admin' && <button className="btn bsm bo" onClick={() => handleDelete(m.id)} style={{ color: 'var(--err)', borderColor: 'rgba(231,76,60,.3)' }}><span className="material-icons-round" style={{ fontSize: 16 }}>delete</span></button>}
            </div></td>}
          </tr>
        ))}
        {!materials.length && <tr><td colSpan={canEdit ? 8 : 7}><EmptyState icon="inventory_2" title="No materials" message="Add materials to track inventory." /></td></tr>}
      </tbody></table></div></div></div>
      {modal && <MaterialModal data={modal.data} id={modal.id} onSave={handleSave} onClose={() => setModal(null)} />}
    </>
  );
}

function MaterialModal({ data, id, onSave, onClose }) {
  const [f, setF] = useState({
    name: data.name || '', stock: data.stock || 0, dispatched: data.dispatched || 0,
    installed: data.installed || 0, balance: data.balance || 0, unit: data.unit || 'pcs'
  });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  return (
    <Modal title={id ? 'Edit Material' : 'Add Material'} onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); onSave(f, id); }}>
        <div className="mb">
          <div className="fr"><div className="fg"><label>Material Name *</label><input className="fi" value={f.name} onChange={e => set('name', e.target.value)} required /></div><div className="fg"><label>Unit</label><input className="fi" value={f.unit} onChange={e => set('unit', e.target.value)} placeholder="pcs / mtrs / kg" /></div></div>
          <div className="fr"><div className="fg"><label>Stock</label><input type="number" className="fi" value={f.stock} onChange={e => set('stock', e.target.value)} /></div><div className="fg"><label>Dispatched</label><input type="number" className="fi" value={f.dispatched} onChange={e => set('dispatched', e.target.value)} /></div></div>
          <div className="fr"><div className="fg"><label>Installed</label><input type="number" className="fi" value={f.installed} onChange={e => set('installed', e.target.value)} /></div><div className="fg"><label>Balance</label><input type="number" className="fi" value={f.balance} onChange={e => set('balance', e.target.value)} /></div></div>
        </div>
        <div className="mf"><button type="button" className="btn bo" onClick={onClose}>Cancel</button><button type="submit" className="btn bp">{id ? 'Update' : 'Add'}</button></div>
      </form>
    </Modal>
  );
}
