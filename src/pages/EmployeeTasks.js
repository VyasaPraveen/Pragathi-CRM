import React, { useState } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { addDocument, updateDocument, deleteDocument } from '../services/firestore';
import { formatDate, safeStr, priorityClass } from '../services/helpers';
import { StatCard, StatusBadge, Modal, EmptyState } from '../components/SharedUI';

const taskStatuses = ['Pending', 'In Progress', 'Completed', 'Overdue'];
const taskPriorities = ['High', 'Medium', 'Low'];
const taskCategories = ['Installation', 'Service', 'Follow-up', 'Documentation', 'Other'];
const PAGE_SIZE = 20;

export default function EmployeeTasks() {
  const { employeeTasks, team } = useData();
  const { role } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterAssignee, setFilterAssignee] = useState('all');
  const [modal, setModal] = useState(null);
  const [detailModal, setDetailModal] = useState(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const pending = employeeTasks.filter(t => t.status === 'Pending').length;
  const inProgress = employeeTasks.filter(t => t.status === 'In Progress').length;
  const completed = employeeTasks.filter(t => t.status === 'Completed').length;
  const overdue = employeeTasks.filter(t => t.status === 'Overdue').length;

  let filtered = employeeTasks;
  if (filterStatus !== 'all') filtered = filtered.filter(t => t.status === filterStatus);
  if (filterAssignee !== 'all') filtered = filtered.filter(t => t.assignedTo === filterAssignee);
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(t =>
      safeStr(t.title).toLowerCase().includes(q) ||
      safeStr(t.assignedTo).toLowerCase().includes(q) ||
      safeStr(t.relatedCustomer).toLowerCase().includes(q)
    );
  }

  const displayed = filtered.slice(0, visibleCount);
  const hasMore = filtered.length > visibleCount;

  const handleSave = async (data, id) => {
    try {
      const cleaned = { ...data };
      if (cleaned.status === 'Completed' && !cleaned.completedDate) {
        cleaned.completedDate = new Date().toISOString().slice(0, 10);
      }
      if (cleaned.status !== 'Completed') {
        cleaned.completedDate = '';
      }
      if (id) { await updateDocument('employeeTasks', id, cleaned); toast('Task updated'); }
      else {
        if (!cleaned.assignedDate) cleaned.assignedDate = new Date().toISOString().slice(0, 10);
        await addDocument('employeeTasks', cleaned); toast('Task created');
      }
      setModal(null);
    } catch (e) { toast(e.message, 'er'); }
  };

  const handleDelete = async (id) => {
    if (window.confirm('Delete this task permanently?')) {
      try { await deleteDocument('employeeTasks', id); toast('Task deleted'); }
      catch (e) { toast(e.message, 'er'); }
    }
  };

  const canEdit = role === 'admin' || role === 'manager';

  return (
    <>
      <div className="sg">
        <StatCard color="or" icon="pending_actions" value={pending} label="Pending" />
        <StatCard color="bl" icon="autorenew" value={inProgress} label="In Progress" />
        <StatCard color="gr" icon="task_alt" value={completed} label="Completed" />
        <StatCard color="re" icon="running_with_errors" value={overdue} label="Overdue" />
      </div>

      <div className="tl">
        <div className="sb-x"><span className="material-icons-round">search</span><input type="text" placeholder="Search tasks..." value={search} onChange={e => setSearch(e.target.value)} /></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {['all', ...taskStatuses].map(s => <span key={s} className={`fc ${filterStatus === s ? 'act' : ''}`} onClick={() => setFilterStatus(s)}>{s === 'all' ? 'All' : s}</span>)}
          </div>
          <select className="fi" style={{ width: 'auto', padding: '7px 12px', fontSize: '.82rem' }} value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)}>
            <option value="all">All Members</option>
            {team.filter(t => t.status === 'Active').map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
          </select>
          {canEdit && <button className="btn bp bsm" onClick={() => setModal({ data: {} })}><span className="material-icons-round" style={{ fontSize: 18 }}>add</span> New Task</button>}
        </div>
      </div>

      <div className="card"><div className="cb" style={{ padding: 0 }}><div className="tw"><table><thead><tr>
        <th>Task</th><th>Assigned To</th><th>Assigned Date</th><th>Due Date</th><th>Priority</th><th>Category</th><th>Status</th><th>Actions</th>
      </tr></thead><tbody>
        {displayed.map(t => (
          <tr key={t.id}>
            <td><strong>{t.title}</strong>{t.relatedCustomer && <><br /><span style={{ fontSize: '.78rem', color: 'var(--muted)' }}>{t.relatedCustomer}</span></>}{t.description && <><br /><span style={{ fontSize: '.74rem', color: 'var(--muted)' }}>{t.description.slice(0, 60)}{t.description.length > 60 ? '...' : ''}</span></>}</td>
            <td style={{ fontSize: '.82rem' }}>{t.assignedTo || <span style={{ color: 'var(--muted)' }}>Unassigned</span>}</td>
            <td style={{ fontSize: '.82rem' }}>{formatDate(t.assignedDate)}</td>
            <td style={{ fontSize: '.82rem' }}>{formatDate(t.dueDate)}</td>
            <td><span className={`st ${priorityClass(t.priority)}`}>{t.priority}</span></td>
            <td style={{ fontSize: '.82rem' }}>{t.category || '-'}</td>
            <td><StatusBadge status={t.status} /></td>
            <td><div style={{ display: 'flex', gap: 4 }}>
              <button className="btn bsm bo" onClick={() => setDetailModal(t)} title="View Details"><span className="material-icons-round" style={{ fontSize: 16 }}>visibility</span></button>
              {canEdit && <button className="btn bsm bo" onClick={() => setModal({ data: t, id: t.id })}><span className="material-icons-round" style={{ fontSize: 16 }}>edit</span></button>}
              {role === 'admin' && <button className="btn bsm bo" onClick={() => handleDelete(t.id)} style={{ color: 'var(--err)', borderColor: 'rgba(231,76,60,.3)' }}><span className="material-icons-round" style={{ fontSize: 16 }}>delete</span></button>}
            </div></td>
          </tr>
        ))}
        {!filtered.length && <tr><td colSpan="8"><EmptyState icon="task_alt" title="No tasks" message="Create a task to get started." /></td></tr>}
      </tbody></table></div>
      {hasMore && <div style={{ textAlign: 'center', padding: 16 }}><button className="btn bsm bo" onClick={() => setVisibleCount(c => c + PAGE_SIZE)}>Show More ({filtered.length - visibleCount} remaining)</button></div>}
      </div></div>
      {modal && <TaskModal data={modal.data} id={modal.id} onSave={handleSave} onClose={() => setModal(null)} />}
      {detailModal && <TaskDetailModal task={detailModal} onClose={() => setDetailModal(null)} onEdit={(t) => { setDetailModal(null); setModal({ data: t, id: t.id }); }} />}
    </>
  );
}

function TaskModal({ data, id, onSave, onClose }) {
  const { team } = useData();
  const [f, setF] = useState({
    title: data.title || '', description: data.description || '',
    assignedTo: data.assignedTo || '', assignedDate: data.assignedDate || '',
    dueDate: data.dueDate || '',
    priority: data.priority || 'Medium', status: data.status || 'Pending',
    category: data.category || 'Other', relatedCustomer: data.relatedCustomer || '',
    notes: data.notes || '', remarks: data.remarks || '',
    completedDate: data.completedDate || '',
    workUpdates: data.workUpdates || []
  });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  return (
    <Modal title={id ? 'Edit Task' : 'New Task'} onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); onSave(f, id); }}>
        <div className="mb">
          <div className="fg"><label>Title *</label><input className="fi" value={f.title} onChange={e => set('title', e.target.value)} required /></div>
          <div className="fg"><label>Description</label><textarea className="fi" value={f.description} onChange={e => set('description', e.target.value)} rows="3" /></div>
          <div className="fr"><div className="fg"><label>Assigned To</label><select className="fi" value={f.assignedTo} onChange={e => set('assignedTo', e.target.value)}><option value="">-- Unassigned --</option>{team.filter(t => t.status === 'Active').map(t => <option key={t.id} value={t.name}>{t.name} ({t.role})</option>)}</select></div><div className="fg"><label>Assigned Date</label><input type="date" className="fi" value={f.assignedDate} onChange={e => set('assignedDate', e.target.value)} /></div></div>
          <div className="fr"><div className="fg"><label>Due Date *</label><input type="date" className="fi" value={f.dueDate} onChange={e => set('dueDate', e.target.value)} required /></div><div className="fg"><label>Related Customer</label><input className="fi" value={f.relatedCustomer} onChange={e => set('relatedCustomer', e.target.value)} placeholder="Optional" /></div></div>
          <div className="fr3"><div className="fg"><label>Priority</label><select className="fi" value={f.priority} onChange={e => set('priority', e.target.value)}>{taskPriorities.map(p => <option key={p}>{p}</option>)}</select></div><div className="fg"><label>Category</label><select className="fi" value={f.category} onChange={e => set('category', e.target.value)}>{taskCategories.map(c => <option key={c}>{c}</option>)}</select></div><div className="fg"><label>Status</label><select className="fi" value={f.status} onChange={e => set('status', e.target.value)}>{taskStatuses.map(s => <option key={s}>{s}</option>)}</select></div></div>
          <div className="fg"><label>Remarks</label><textarea className="fi" value={f.remarks} onChange={e => set('remarks', e.target.value)} rows="2" placeholder="Admin/Manager remarks" /></div>
          <div className="fg"><label>Notes / Comments</label><textarea className="fi" value={f.notes} onChange={e => set('notes', e.target.value)} rows="2" /></div>
          {f.status === 'Completed' && <div className="fg"><label>Completed Date</label><input type="date" className="fi" value={f.completedDate} onChange={e => set('completedDate', e.target.value)} /></div>}
        </div>
        <div className="mf"><button type="button" className="btn bo" onClick={onClose}>Cancel</button><button type="submit" className="btn bp">{id ? 'Update' : 'Create'} Task</button></div>
      </form>
    </Modal>
  );
}

/* ============ TASK DETAIL MODAL WITH WORK UPDATES ============ */
function TaskDetailModal({ task, onClose, onEdit }) {
  const { role, user } = useAuth();
  const { toast } = useToast();
  const canEdit = role === 'admin' || role === 'manager';

  const [showUpdateForm, setShowUpdateForm] = useState(false);
  const [updateData, setUpdateData] = useState({ date: new Date().toISOString().slice(0, 10), update: '' });

  const workUpdates = task.workUpdates || [];

  const handleAddWorkUpdate = async () => {
    if (!updateData.date || !updateData.update.trim()) { toast('Date and update text are required', 'er'); return; }
    try {
      const newEntry = { ...updateData, by: user?.email || 'unknown', at: new Date().toISOString() };
      const updated = [...workUpdates, newEntry];
      await updateDocument('employeeTasks', task.id, { workUpdates: updated });
      toast('Work update logged');
      setShowUpdateForm(false);
      setUpdateData({ date: new Date().toISOString().slice(0, 10), update: '' });
    } catch (e) { toast(e.message, 'er'); }
  };

  return (
    <Modal title="Task Details" onClose={onClose} wide>
      {/* Task Info */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{task.title}</h3>
          <div style={{ display: 'flex', gap: 6 }}>
            <StatusBadge status={task.status} />
            <span className={`st ${priorityClass(task.priority)}`}>{task.priority}</span>
          </div>
        </div>
        {task.description && <p style={{ fontSize: '.88rem', color: 'var(--muted)', marginBottom: 12 }}>{task.description}</p>}

        <div className="dg" style={{ gap: 8, marginBottom: 16 }}>
          <div className="di"><div className="dl">Assigned To</div><div className="dv">{task.assignedTo || 'Unassigned'}</div></div>
          <div className="di"><div className="dl">Assigned Date</div><div className="dv">{formatDate(task.assignedDate) || '-'}</div></div>
          <div className="di"><div className="dl">Due Date</div><div className="dv">{formatDate(task.dueDate) || '-'}</div></div>
          <div className="di"><div className="dl">Category</div><div className="dv">{task.category || '-'}</div></div>
          {task.relatedCustomer && <div className="di"><div className="dl">Related Customer</div><div className="dv">{task.relatedCustomer}</div></div>}
          {task.completedDate && <div className="di"><div className="dl">Completed Date</div><div className="dv">{formatDate(task.completedDate)}</div></div>}
          {task.remarks && <div className="di"><div className="dl">Remarks</div><div className="dv">{task.remarks}</div></div>}
          {task.notes && <div className="di"><div className="dl">Notes</div><div className="dv">{task.notes}</div></div>}
        </div>

        {canEdit && <button className="btn bsm bo" onClick={() => onEdit(task)}><span className="material-icons-round" style={{ fontSize: 16 }}>edit</span> Edit Task</button>}
      </div>

      {/* Daily Work Updates Section */}
      <div style={{ borderTop: '1px solid var(--bor)', paddingTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h4 style={{ margin: 0, fontSize: '1rem' }}>Daily Work Updates</h4>
          {!showUpdateForm && <button className="btn bsm bp" onClick={() => setShowUpdateForm(true)}><span className="material-icons-round" style={{ fontSize: 16 }}>add</span> Log Update</button>}
        </div>

        {showUpdateForm && (
          <div style={{ border: '1px solid var(--bor)', borderRadius: 10, padding: 14, marginBottom: 14, background: '#fafbfc' }}>
            <div className="fr">
              <div className="fg"><label>Date *</label><input type="date" className="fi" value={updateData.date} onChange={e => setUpdateData(p => ({ ...p, date: e.target.value }))} /></div>
              <div className="fg" style={{ flex: 2 }}><label>Work Done *</label><input className="fi" value={updateData.update} onChange={e => setUpdateData(p => ({ ...p, update: e.target.value }))} placeholder="Describe today's progress..." /></div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="button" className="btn bsm bp" onClick={handleAddWorkUpdate}>Save Update</button>
              <button type="button" className="btn bsm bo" onClick={() => { setShowUpdateForm(false); setUpdateData({ date: new Date().toISOString().slice(0, 10), update: '' }); }}>Cancel</button>
            </div>
          </div>
        )}

        {workUpdates.length > 0 ? (
          <div className="tw">
            <table>
              <thead><tr><th>Date</th><th>Work Done</th><th>Updated By</th></tr></thead>
              <tbody>
                {[...workUpdates].reverse().map((wu, i) => (
                  <tr key={i}>
                    <td style={{ fontSize: '.82rem', whiteSpace: 'nowrap' }}>{formatDate(wu.date)}</td>
                    <td style={{ fontSize: '.84rem' }}>{wu.update}</td>
                    <td style={{ fontSize: '.78rem', color: 'var(--muted)' }}>{wu.by}<br />{wu.at ? new Date(wu.at).toLocaleString() : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="update" title="No work updates yet" message="Use 'Log Update' to record daily progress." />
        )}
      </div>
    </Modal>
  );
}
