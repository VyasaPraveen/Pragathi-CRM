import React, { useState } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { addDocument, updateDocument, deleteDocument } from '../services/firestore';
import { formatCurrency, formatDate, toNumber, hasAccess } from '../services/helpers';
import { StatCard, Modal } from '../components/SharedUI';

const PAGE_SIZE = 20;

export default function Revenue() {
  const { income, expenses } = useData();
  const { role } = useAuth();
  const { toast } = useToast();
  const [modal, setModal] = useState(null);
  const [incomeVisible, setIncomeVisible] = useState(PAGE_SIZE);
  const [expenseVisible, setExpenseVisible] = useState(PAGE_SIZE);
  const canEdit = hasAccess(role, 'coordinator');

  const tI = income.reduce((s, i) => s + toNumber(i.amount), 0);
  const tE = expenses.reduce((s, i) => s + toNumber(i.amount), 0);

  const handleSave = async (type, data, id) => {
    try {
      // D3 fix: validate amount before saving
      const amount = toNumber(data.amount);
      if (amount <= 0) { toast('Amount must be greater than zero', 'er'); return; }
      if (id) {
        await updateDocument(type, id, { ...data, amount });
        toast((type === 'income' ? 'Income' : 'Expense') + ' updated');
      } else {
        await addDocument(type, { ...data, amount });
        toast((type === 'income' ? 'Income' : 'Expense') + ' added');
      }
      setModal(null);
    } catch (e) { toast(e.message, 'er'); }
  };

  const handleDelete = async (type, id) => {
    if (window.confirm('Delete this entry permanently?')) {
      try { await deleteDocument(type, id); toast('Entry deleted'); }
      catch (e) { toast(e.message, 'er'); }
    }
  };

  return (
    <>
      {hasAccess(role, 'admin') && <div className="sg" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <StatCard color="gr" icon="trending_up" value={formatCurrency(tI)} label="Total Income" />
        <StatCard color="re" icon="trending_down" value={formatCurrency(tE)} label="Total Expenses" />
        <StatCard color="pu" icon="savings" value={formatCurrency(tI - tE)} label="Net Profit" />
      </div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <div className="card">
          <div className="ch"><h3 style={{ color: 'var(--ok)' }}>Income</h3>{canEdit && <button className="btn bsm bs" onClick={() => setModal({ type: 'income' })}><span className="material-icons-round" style={{ fontSize: 16 }}>add</span> Add</button>}</div>
          <div className="cb" style={{ padding: 0 }}><table><thead><tr><th>Description</th><th>Amount</th><th>Date</th>{canEdit && <th>Actions</th>}</tr></thead><tbody>
            {income.slice(0, incomeVisible).map(i => <tr key={i.id}>
              <td>{i.desc}{i.category && <><br /><span style={{ fontSize: '.76rem', color: 'var(--muted)' }}>{i.category}</span></>}</td>
              <td style={{ fontWeight: 600, color: 'var(--ok)' }}>{formatCurrency(i.amount)}</td>
              <td style={{ fontSize: '.82rem' }}>{formatDate(i.date)}</td>
              {canEdit && <td><div style={{ display: 'flex', gap: 4 }}>
                <button className="btn bsm bo" onClick={() => setModal({ type: 'income', data: i, id: i.id })}><span className="material-icons-round" style={{ fontSize: 16 }}>edit</span></button>
                {hasAccess(role, 'admin') && <button className="btn bsm bo" onClick={() => handleDelete('income', i.id)} style={{ color: 'var(--err)', borderColor: 'rgba(231,76,60,.3)' }}><span className="material-icons-round" style={{ fontSize: 16 }}>delete</span></button>}
              </div></td>}
            </tr>)}
          </tbody></table>
          {income.length > incomeVisible && <div style={{ textAlign: 'center', padding: 12 }}><button className="btn bsm bo" onClick={() => setIncomeVisible(c => c + PAGE_SIZE)}>Show More</button></div>}
          </div>
        </div>
        <div className="card">
          <div className="ch"><h3 style={{ color: 'var(--err)' }}>Expenses</h3>{canEdit && <button className="btn bsm bs" onClick={() => setModal({ type: 'expenses' })}><span className="material-icons-round" style={{ fontSize: 16 }}>add</span> Add</button>}</div>
          <div className="cb" style={{ padding: 0 }}><table><thead><tr><th>Description</th><th>Amount</th><th>Date</th>{canEdit && <th>Actions</th>}</tr></thead><tbody>
            {expenses.slice(0, expenseVisible).map(i => <tr key={i.id}>
              <td>{i.desc}{i.category && <><br /><span style={{ fontSize: '.76rem', color: 'var(--muted)' }}>{i.category}</span></>}</td>
              <td style={{ fontWeight: 600, color: 'var(--err)' }}>{formatCurrency(i.amount)}</td>
              <td style={{ fontSize: '.82rem' }}>{formatDate(i.date)}</td>
              {canEdit && <td><div style={{ display: 'flex', gap: 4 }}>
                <button className="btn bsm bo" onClick={() => setModal({ type: 'expenses', data: i, id: i.id })}><span className="material-icons-round" style={{ fontSize: 16 }}>edit</span></button>
                {hasAccess(role, 'admin') && <button className="btn bsm bo" onClick={() => handleDelete('expenses', i.id)} style={{ color: 'var(--err)', borderColor: 'rgba(231,76,60,.3)' }}><span className="material-icons-round" style={{ fontSize: 16 }}>delete</span></button>}
              </div></td>}
            </tr>)}
          </tbody></table>
          {expenses.length > expenseVisible && <div style={{ textAlign: 'center', padding: 12 }}><button className="btn bsm bo" onClick={() => setExpenseVisible(c => c + PAGE_SIZE)}>Show More</button></div>}
          </div>
        </div>
      </div>
      {modal && <RevenueModal type={modal.type} data={modal.data} id={modal.id} onSave={handleSave} onClose={() => setModal(null)} />}
    </>
  );
}

function RevenueModal({ type, data, id, onSave, onClose }) {
  const [f, setF] = useState({
    desc: (data && data.desc) || '',
    amount: (data && data.amount) || '',
    date: (data && data.date) || new Date().toISOString().slice(0, 10),
    category: (data && data.category) || ''
  });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  return (
    <Modal title={`${id ? 'Edit' : 'Add'} ${type === 'income' ? 'Income' : 'Expense'}`} onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); onSave(type, f, id); }}>
        <div className="mb">
          <div className="fg"><label>Description *</label><input className="fi" value={f.desc} onChange={e => set('desc', e.target.value)} required /></div>
          <div className="fr"><div className="fg"><label>Amount *</label><input type="number" className="fi" value={f.amount} onChange={e => set('amount', e.target.value)} required /></div><div className="fg"><label>Date</label><input type="date" className="fi" value={f.date} onChange={e => set('date', e.target.value)} /></div></div>
          <div className="fg"><label>Category</label><input className="fi" value={f.category} onChange={e => set('category', e.target.value)} placeholder={type === 'income' ? 'Customer Payment' : 'Materials / Salaries'} /></div>
        </div>
        <div className="mf"><button type="button" className="btn bo" onClick={onClose}>Cancel</button><button type="submit" className="btn bp">{id ? 'Update' : 'Add'}</button></div>
      </form>
    </Modal>
  );
}
