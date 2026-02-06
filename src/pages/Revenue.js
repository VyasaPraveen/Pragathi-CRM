import React, { useState } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { addDocument } from '../services/firestore';
import { formatCurrency, formatDate, toNumber } from '../services/helpers';
import { StatCard, Modal } from '../components/SharedUI';

const PAGE_SIZE = 20;

export default function Revenue() {
  const { income, expenses } = useData();
  const { role } = useAuth();
  const { toast } = useToast();
  const [modal, setModal] = useState(null);
  const [incomeVisible, setIncomeVisible] = useState(PAGE_SIZE);
  const [expenseVisible, setExpenseVisible] = useState(PAGE_SIZE);

  const tI = income.reduce((s, i) => s + toNumber(i.amount), 0);
  const tE = expenses.reduce((s, i) => s + toNumber(i.amount), 0);

  const handleSave = async (type, data) => {
    try {
      // D3 fix: validate amount before saving
      const amount = toNumber(data.amount);
      if (amount <= 0) { toast('Amount must be greater than zero', 'er'); return; }
      await addDocument(type, { ...data, amount });
      toast((type === 'income' ? 'Income' : 'Expense') + ' added');
      setModal(null);
    } catch (e) { toast(e.message, 'er'); }
  };

  return (
    <>
      {role === 'admin' && <div className="sg" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <StatCard color="gr" icon="trending_up" value={formatCurrency(tI)} label="Total Income" />
        <StatCard color="re" icon="trending_down" value={formatCurrency(tE)} label="Total Expenses" />
        <StatCard color="pu" icon="savings" value={formatCurrency(tI - tE)} label="Net Profit" />
      </div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <div className="card">
          <div className="ch"><h3 style={{ color: 'var(--ok)' }}>Income</h3><button className="btn bsm bs" onClick={() => setModal('income')}><span className="material-icons-round" style={{ fontSize: 16 }}>add</span> Add</button></div>
          <div className="cb" style={{ padding: 0 }}><table><thead><tr><th>Description</th><th>Amount</th><th>Date</th></tr></thead><tbody>
            {income.slice(0, incomeVisible).map(i => <tr key={i.id}><td>{i.desc}</td><td style={{ fontWeight: 600, color: 'var(--ok)' }}>{formatCurrency(i.amount)}</td><td style={{ fontSize: '.82rem' }}>{formatDate(i.date)}</td></tr>)}
          </tbody></table>
          {income.length > incomeVisible && <div style={{ textAlign: 'center', padding: 12 }}><button className="btn bsm bo" onClick={() => setIncomeVisible(c => c + PAGE_SIZE)}>Show More</button></div>}
          </div>
        </div>
        <div className="card">
          <div className="ch"><h3 style={{ color: 'var(--err)' }}>Expenses</h3><button className="btn bsm bs" onClick={() => setModal('expenses')}><span className="material-icons-round" style={{ fontSize: 16 }}>add</span> Add</button></div>
          <div className="cb" style={{ padding: 0 }}><table><thead><tr><th>Description</th><th>Amount</th><th>Date</th></tr></thead><tbody>
            {expenses.slice(0, expenseVisible).map(i => <tr key={i.id}><td>{i.desc}</td><td style={{ fontWeight: 600, color: 'var(--err)' }}>{formatCurrency(i.amount)}</td><td style={{ fontSize: '.82rem' }}>{formatDate(i.date)}</td></tr>)}
          </tbody></table>
          {expenses.length > expenseVisible && <div style={{ textAlign: 'center', padding: 12 }}><button className="btn bsm bo" onClick={() => setExpenseVisible(c => c + PAGE_SIZE)}>Show More</button></div>}
          </div>
        </div>
      </div>
      {modal && <RevenueModal type={modal} onSave={handleSave} onClose={() => setModal(null)} />}
    </>
  );
}

function RevenueModal({ type, onSave, onClose }) {
  const [f, setF] = useState({ desc: '', amount: '', date: new Date().toISOString().slice(0, 10), category: '' });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  return (
    <Modal title={`Add ${type === 'income' ? 'Income' : 'Expense'}`} onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); onSave(type, f); }}>
        <div className="mb">
          <div className="fg"><label>Description *</label><input className="fi" value={f.desc} onChange={e => set('desc', e.target.value)} required /></div>
          <div className="fr"><div className="fg"><label>Amount *</label><input type="number" className="fi" value={f.amount} onChange={e => set('amount', e.target.value)} required /></div><div className="fg"><label>Date</label><input type="date" className="fi" value={f.date} onChange={e => set('date', e.target.value)} /></div></div>
          <div className="fg"><label>Category</label><input className="fi" value={f.category} onChange={e => set('category', e.target.value)} placeholder={type === 'income' ? 'Customer Payment' : 'Materials / Salaries'} /></div>
        </div>
        <div className="mf"><button type="button" className="btn bo" onClick={onClose}>Cancel</button><button type="submit" className="btn bp">Add</button></div>
      </form>
    </Modal>
  );
}
