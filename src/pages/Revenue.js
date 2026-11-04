import React, { useMemo, useState } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { addDocument, updateDocument, deleteDocument } from '../services/firestore';
import { formatCurrency, formatDate, toNumber, hasAccess, todayStr, safeStr } from '../services/helpers';
import { StatCard, Modal, DateFilter, EmptyState } from '../components/SharedUI';
import { DATE_FILTER_ALL, applyDateFilter } from '../services/dateFilter';

const PAGE_SIZE = 20;
const REVENUE_DATE_FIELDS = ['date', 'createdAt'];

// ============================================================================
// Revenue — income and expenses. Req 17 (4-Nov): one list at a time (Income,
// Expenses, or both together), newest first, with a search box, a category
// filter, and the totals for what is on screen; the entry's details open on a
// tap. The records, the Add / Edit / Delete and the all-time cards are as before.
// ============================================================================
export default function Revenue() {
  const { income, expenses } = useData();
  const { role } = useAuth();
  const { toast } = useToast();
  const [modal, setModal] = useState(null);
  const [detail, setDetail] = useState(null);
  const [view, setView] = useState('income');          // 'income' | 'expenses' | 'all'
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [visible, setVisible] = useState(PAGE_SIZE);
  const canEdit = hasAccess(role, 'coordinator');
  // The Day / Month filter (R15) narrows the list; the all-time totals above stay.
  const [dateFilter, setDateFilter] = useState(DATE_FILTER_ALL);

  const tI = income.reduce((s, i) => s + toNumber(i.amount), 0);
  const tE = expenses.reduce((s, i) => s + toNumber(i.amount), 0);

  // Every entry with its kind, newest first.
  const entries = useMemo(() => {
    const tag = (list, kind) => list.map(e => ({ ...e, _kind: kind }));
    const all = [...tag(income, 'income'), ...tag(expenses, 'expenses')];
    return all.sort((a, b) => String(b.date || b.createdAt || '').localeCompare(String(a.date || a.createdAt || '')));
  }, [income, expenses]);

  const categories = useMemo(() => [...new Set(entries.filter(e => view === 'all' || e._kind === view).map(e => e.category).filter(Boolean))].sort(), [entries, view]);

  let shown = view === 'all' ? entries : entries.filter(e => e._kind === view);
  shown = applyDateFilter(shown, dateFilter, REVENUE_DATE_FIELDS);
  if (category !== 'all') shown = shown.filter(e => e.category === category);
  if (search) {
    const q = search.toLowerCase();
    shown = shown.filter(e => safeStr(e.desc).toLowerCase().includes(q) || safeStr(e.description).toLowerCase().includes(q) || safeStr(e.category).toLowerCase().includes(q) || safeStr(e.customer).toLowerCase().includes(q) || safeStr(e.vendor).toLowerCase().includes(q) || String(e.amount || '').includes(q));
  }
  const shownIncome = shown.filter(e => e._kind === 'income').reduce((s, e) => s + toNumber(e.amount), 0);
  const shownExpense = shown.filter(e => e._kind === 'expenses').reduce((s, e) => s + toNumber(e.amount), 0);

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
      try { await deleteDocument(type, id); toast('Entry deleted'); setDetail(null); }
      catch (e) { toast(e.message, 'er'); }
    }
  };

  const pick = (v) => { setView(v); setCategory('all'); setVisible(PAGE_SIZE); };
  const kindBadge = (k) => k === 'income'
    ? <span className="st st-g" style={{ padding: '2px 8px', fontSize: '.7rem' }}>Income</span>
    : <span className="st st-r" style={{ padding: '2px 8px', fontSize: '.7rem' }}>Expense</span>;

  return (
    <>
      {hasAccess(role, 'admin') && <div className="sg" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <StatCard color="gr" icon="trending_up" value={formatCurrency(tI)} label="Total Income" />
        <StatCard color="re" icon="trending_down" value={formatCurrency(tE)} label="Total Expenses" />
        <StatCard color="pu" icon="savings" value={formatCurrency(tI - tE)} label="Net Profit" />
      </div>}

      <div className="tl">
        <div className="sb-x"><span className="material-icons-round">search</span><input type="text" placeholder="Search by description, category, amount…" value={search} onChange={e => setSearch(e.target.value)} /></div>
        <div className="tl-r">
          <div className="chips" data-rev="view">
            <span className={`fc ${view === 'income' ? 'act' : ''}`} onClick={() => pick('income')}>Income ({income.length})</span>
            <span className={`fc ${view === 'expenses' ? 'act' : ''}`} onClick={() => pick('expenses')}>Expenses ({expenses.length})</span>
            <span className={`fc ${view === 'all' ? 'act' : ''}`} onClick={() => pick('all')}>All</span>
          </div>
          {categories.length > 0 && (
            <select className="fi" style={{ width: 'auto', padding: '6px 30px 6px 10px', fontSize: '.82rem' }} value={category} onChange={e => setCategory(e.target.value)}>
              <option value="all">All categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {canEdit && view !== 'expenses' && <button className="btn bp bsm" onClick={() => setModal({ type: 'income' })}><span className="material-icons-round" style={{ fontSize: 16 }}>add</span> Add Income</button>}
          {canEdit && view !== 'income' && <button className="btn bsm bo" onClick={() => setModal({ type: 'expenses' })} style={{ color: 'var(--err)', borderColor: 'rgba(231,76,60,.3)' }}><span className="material-icons-round" style={{ fontSize: 16 }}>add</span> Add Expense</button>}
        </div>
      </div>
      <div style={{ marginBottom: 12 }}><DateFilter value={dateFilter} onChange={setDateFilter} records={entries} fields={REVENUE_DATE_FIELDS} /></div>

      {/* What is on screen adds up to */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12, fontSize: '.84rem' }} data-rev="totals">
        <span style={{ color: 'var(--muted)' }}>{shown.length} entr{shown.length === 1 ? 'y' : 'ies'} shown</span>
        {view !== 'expenses' && <span>Income: <strong style={{ color: 'var(--ok)' }}>{formatCurrency(shownIncome)}</strong></span>}
        {view !== 'income' && <span>Expenses: <strong style={{ color: 'var(--err)' }}>{formatCurrency(shownExpense)}</strong></span>}
        {view === 'all' && <span>Net: <strong style={{ color: shownIncome - shownExpense >= 0 ? 'var(--ok)' : 'var(--err)' }}>{formatCurrency(shownIncome - shownExpense)}</strong></span>}
      </div>

      <div className="card">
        <div className="cb" style={{ padding: 0 }}><div className="tw tw-m"><table>
          <thead><tr><th>Date</th><th>Description</th>{view === 'all' && <th>Type</th>}<th>Category</th><th style={{ textAlign: 'right' }}>Amount</th><th>Actions</th></tr></thead>
          <tbody>
            {shown.slice(0, visible).map(e => (
              <tr key={e._kind + e.id} style={{ cursor: 'pointer' }} onClick={() => setDetail(e)}>
                <td data-l="Date" style={{ fontSize: '.82rem', whiteSpace: 'nowrap' }}>{formatDate(e.date) || formatDate(e.createdAt)}</td>
                <td className="m-h"><strong>{e.desc || e.description || '-'}</strong>{(e.customer || e.vendor) && <><br /><span style={{ fontSize: '.76rem', color: 'var(--muted)' }}>{e.customer || e.vendor}</span></>}</td>
                {view === 'all' && <td data-l="Type">{kindBadge(e._kind)}</td>}
                <td data-l="Category" style={{ fontSize: '.8rem', color: 'var(--muted)' }}>{e.category || '-'}</td>
                <td data-l="Amount" style={{ fontWeight: 700, color: e._kind === 'income' ? 'var(--ok)' : 'var(--err)', textAlign: 'right', whiteSpace: 'nowrap' }}>{e._kind === 'income' ? '+' : '−'}{formatCurrency(e.amount)}</td>
                <td className="m-a" onClick={ev => ev.stopPropagation()}><div style={{ display: 'flex', gap: 4 }}>
                  <button className="btn bsm bo" title="View details" onClick={() => setDetail(e)}><span className="material-icons-round" style={{ fontSize: 16 }}>visibility</span></button>
                  {canEdit && <button className="btn bsm bo" title="Edit" onClick={() => setModal({ type: e._kind, data: e, id: e.id })}><span className="material-icons-round" style={{ fontSize: 16 }}>edit</span></button>}
                  {hasAccess(role, 'admin') && <button className="btn bsm bo" title="Delete" onClick={() => handleDelete(e._kind, e.id)} style={{ color: 'var(--err)', borderColor: 'rgba(231,76,60,.3)' }}><span className="material-icons-round" style={{ fontSize: 16 }}>delete</span></button>}
                </div></td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={view === 'all' ? 6 : 5}><EmptyState icon="account_balance_wallet" title={view === 'income' ? 'No income entries' : view === 'expenses' ? 'No expense entries' : 'No entries'} message={entries.length ? 'Nothing matches the search, category or period chosen.' : 'Add the first entry with the button above.'} /></td></tr>}
          </tbody>
        </table></div>
        {shown.length > visible && <div style={{ textAlign: 'center', padding: 12 }}><button className="btn bsm bo" onClick={() => setVisible(c => c + PAGE_SIZE)}>Show More ({shown.length - visible} remaining)</button></div>}
        </div>
      </div>

      {detail && (
        <Modal title={detail._kind === 'income' ? 'Income entry' : 'Expense entry'} onClose={() => setDetail(null)} allowBackdropClose>
          <div className="mb">
            <div className="dg">
              <div className="di"><div className="dl">Type</div><div className="dv">{kindBadge(detail._kind)}</div></div>
              <div className="di"><div className="dl">Amount</div><div className="dv" style={{ fontWeight: 700, color: detail._kind === 'income' ? 'var(--ok)' : 'var(--err)' }}>{formatCurrency(detail.amount)}</div></div>
              <div className="di"><div className="dl">Date</div><div className="dv">{formatDate(detail.date) || '-'}</div></div>
              <div className="di"><div className="dl">Category</div><div className="dv">{detail.category || '-'}</div></div>
              <div className="di" style={{ gridColumn: '1 / -1' }}><div className="dl">Description</div><div className="dv">{detail.desc || detail.description || '-'}</div></div>
              {(detail.customer || detail.vendor) && <div className="di"><div className="dl">{detail.customer ? 'Customer' : 'Vendor'}</div><div className="dv">{detail.customer || detail.vendor}</div></div>}
              {detail.createdAt && <div className="di"><div className="dl">Recorded</div><div className="dv">{formatDate(detail.createdAt)}{detail.createdBy ? ' · ' + detail.createdBy : ''}</div></div>}
            </div>
          </div>
          <div className="mf">
            {hasAccess(role, 'admin') && <button className="btn bo" onClick={() => handleDelete(detail._kind, detail.id)} style={{ color: 'var(--err)', borderColor: 'rgba(231,76,60,.3)' }}>Delete</button>}
            {canEdit && <button className="btn bo" onClick={() => { setModal({ type: detail._kind, data: detail, id: detail.id }); setDetail(null); }}>Edit</button>}
            <button className="btn bp" onClick={() => setDetail(null)}>Close</button>
          </div>
        </Modal>
      )}
      {modal && <RevenueModal type={modal.type} data={modal.data} id={modal.id} onSave={handleSave} onClose={() => setModal(null)} />}
    </>
  );
}

function RevenueModal({ type, data, id, onSave, onClose }) {
  const [f, setF] = useState({
    desc: (data && data.desc) || '',
    amount: (data && data.amount) || '',
    date: (data && data.date) || todayStr(),
    category: (data && data.category) || ''
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try { await onSave(type, f, id); } finally { setSaving(false); }
  };
  return (
    <Modal title={`${id ? 'Edit' : 'Add'} ${type === 'income' ? 'Income' : 'Expense'}`} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="mb">
          <div className="fg"><label>Description *</label><input className="fi" value={f.desc} onChange={e => set('desc', e.target.value)} required /></div>
          <div className="fr"><div className="fg"><label>Amount *</label><input type="number" className="fi" value={f.amount} onChange={e => set('amount', e.target.value)} required /></div><div className="fg"><label>Date</label><input type="date" className="fi" value={f.date} onChange={e => set('date', e.target.value)} /></div></div>
          <div className="fg"><label>Category</label><input className="fi" value={f.category} onChange={e => set('category', e.target.value)} placeholder={type === 'income' ? 'Customer Payment' : 'Materials / Salaries'} /></div>
        </div>
        <div className="mf"><button type="button" className="btn bo" onClick={onClose}>Cancel</button><button type="submit" className="btn bp" disabled={saving}>{saving ? 'Saving...' : (id ? 'Update' : 'Add')}</button></div>
      </form>
    </Modal>
  );
}
