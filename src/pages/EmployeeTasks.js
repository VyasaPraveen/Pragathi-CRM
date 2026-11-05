import React, { useState } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { addDocument, updateDocument, deleteDocument, createNotification, notifyAdmins } from '../services/firestore';
import { formatDate, formatDateTime, safeStr, priorityClass, hasAccess, todayStr } from '../services/helpers';
import { StatCard, StatusBadge, Modal, EmptyState , DateFilter } from '../components/SharedUI';
import { DATE_FILTER_ALL, applyDateFilter } from '../services/dateFilter';
import { assignableNames } from '../services/people';
import { hasModule } from '../services/permissions';
import { taskAssignees, assigneeFields, canEditTask, newAssignees, taskPeople, taskHasAssignee } from '../services/tasks';

const taskStatuses = ['Pending', 'In Progress', 'Completed', 'Overdue'];
const taskPriorities = ['High', 'Medium', 'Low'];
const taskCategories = ['Installation', 'Service', 'Follow-up', 'Documentation', 'Other'];
const PAGE_SIZE = 20;

// A task's day for the Day / Month filter: when it was assigned, else its due date.
const TASK_DATE_FIELDS = ['assignedDate', 'dueDate', 'createdAt'];

export default function EmployeeTasks() {
  const { employeeTasks, users } = useData();
  const { role, user } = useAuth();
  // Req 4 (4-Nov): the member list is the current accounts (the same names as
  // Leads → Assign To), not the old team directory. A name an existing task
  // carries that is no longer an account stays selectable.
  const filterNames = [...new Set([...assignableNames(users), ...employeeTasks.flatMap(t => taskAssignees(t))])];
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterAssignee, setFilterAssignee] = useState('all');
  const [modal, setModal] = useState(null);
  const [detailModal, setDetailModal] = useState(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [dateFilter, setDateFilter] = useState(DATE_FILTER_ALL);

  const pending = employeeTasks.filter(t => t.status === 'Pending').length;
  const inProgress = employeeTasks.filter(t => t.status === 'In Progress').length;
  const completed = employeeTasks.filter(t => t.status === 'Completed').length;
  const overdue = employeeTasks.filter(t => t.status === 'Overdue').length;

  let filtered = employeeTasks;
  if (filterStatus !== 'all') filtered = filtered.filter(t => t.status === filterStatus);
  if (filterAssignee !== 'all') filtered = filtered.filter(t => taskHasAssignee(t, filterAssignee));
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(t =>
      safeStr(t.title).toLowerCase().includes(q) ||
      taskAssignees(t).join(' ').toLowerCase().includes(q) ||
      safeStr(t.relatedCustomer).toLowerCase().includes(q)
    );
  }
  filtered = applyDateFilter(filtered, dateFilter, TASK_DATE_FIELDS);

  const displayed = filtered.slice(0, visibleCount);
  const hasMore = filtered.length > visibleCount;

  // Who is assigning the work — included in the notification so the employee
  // knows at a glance who gave them the task.
  const assignedByName = user?.displayName || user?.email || 'a team leader';

  const handleSave = async (data, id) => {
    try {
      // Req 6 (5-Nov): several assignees; `assignedTo` stays the first of them.
      const cleaned = { ...data, ...assigneeFields(data.assignees && data.assignees.length ? data.assignees : [data.assignedTo]) };
      const tell = (name, title, message, relatedId) => createNotification({ forUser: name, title, message, type: 'task', module: 'employeeTasks', relatedId });
      if (cleaned.status === 'Completed' && !cleaned.completedDate) {
        cleaned.completedDate = todayStr();
      }
      if (cleaned.status !== 'Completed') {
        cleaned.completedDate = '';
      }
      if (id) {
        const prevTask = employeeTasks.find(t => t.id === id);
        await updateDocument('employeeTasks', id, cleaned);
        toast('Task updated');
        // Everyone newly put on the task is told (Req 6.3).
        for (const name of newAssignees(prevTask, cleaned)) {
          tell(name, 'Task Assigned to You', `${assignedByName} assigned you the task "${cleaned.title}". Due: ${cleaned.dueDate || 'Not set'}${cleaned.priority ? ' · ' + cleaned.priority + ' priority' : ''}`, id);
        }
        // Notify admin when status changes (user updated their task)
        if (prevTask && cleaned.status !== prevTask.status) {
          notifyAdmins(users, { title: 'Task Status Updated', message: `Task "${cleaned.title}" changed to ${cleaned.status} by ${assignedByName}`, type: 'status_update', module: 'employeeTasks', relatedId: id });
          // Also notify every assignee about the status change (not the person who made it)
          for (const name of taskAssignees(cleaned)) {
            if (name !== assignedByName) tell(name, 'Task Status Changed', `The task "${cleaned.title}" changed to ${cleaned.status}`, id);
          }
        }
      } else {
        if (!cleaned.assignedDate) cleaned.assignedDate = todayStr();
        cleaned.assignedBy = assignedByName;
        const newId = await addDocument('employeeTasks', cleaned);
        toast('Task created');
        // Every assignee is told about the new task (Req 6.3)
        for (const name of taskAssignees(cleaned)) {
          tell(name, 'New Task Assigned', `${assignedByName} assigned you the task "${cleaned.title}". Due: ${cleaned.dueDate || 'Not set'}${cleaned.priority ? ' · ' + cleaned.priority + ' priority' : ''}`, newId);
        }
        // Notify admins about new task
        notifyAdmins(users, { title: 'New Task Created', message: `Task "${cleaned.title}" assigned to ${taskAssignees(cleaned).join(', ') || 'Unassigned'}`, type: 'task', module: 'employeeTasks', relatedId: newId });
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

  // Req 20 (4-Nov) / Req 1 (5-Nov): creating a task is its own switch in
  // Permission Management; its default is the coordinator floor this screen
  // always had, and the Owner's tick gives it to anyone.
  const canCreate = hasModule(user, role, 'new_task');
  // Req 6.5: the coordinator level, task creators, and the people a task is
  // assigned to may update it.
  const canEditT = (t) => canEditTask(t, user, role, canCreate);

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
        <div className="tl-r">
          <div className="chips">
            {['all', ...taskStatuses].map(s => <span key={s} className={`fc ${filterStatus === s ? 'act' : ''}`} onClick={() => setFilterStatus(s)}>{s === 'all' ? 'All' : s}</span>)}
          </div>
          <select className="fi" style={{ width: 'auto', padding: '7px 12px', fontSize: '.82rem' }} value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)}>
            <option value="all">All Members</option>
            {filterNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          {canCreate && <button className="btn bp bsm" onClick={() => setModal({ data: {} })}><span className="material-icons-round" style={{ fontSize: 18 }}>add</span> New Task</button>}
        </div>
      </div>
      <div style={{ marginBottom: 12 }}><DateFilter value={dateFilter} onChange={setDateFilter} records={employeeTasks} fields={TASK_DATE_FIELDS} /></div>

      <div className="card"><div className="cb" style={{ padding: 0 }}><div className="tw tw-m"><table><thead><tr>
        <th>Task</th><th>Assigned To</th><th>Assigned Date</th><th>Due Date</th><th>Priority</th><th>Category</th><th>Status</th><th>Actions</th>
      </tr></thead><tbody>
        {displayed.map(t => (
          <tr key={t.id}>
            <td className="m-h"><strong>{t.title}</strong>{t.relatedCustomer && <><br /><span style={{ fontSize: '.78rem', color: 'var(--muted)' }}>{t.relatedCustomer}</span></>}{t.description && <><br /><span style={{ fontSize: '.74rem', color: 'var(--muted)' }}>{t.description.slice(0, 60)}{t.description.length > 60 ? '...' : ''}</span></>}</td>
            <td data-l="Assigned To" style={{ fontSize: '.82rem' }}>{taskAssignees(t).length ? taskAssignees(t).join(', ') : <span style={{ color: 'var(--muted)' }}>Unassigned</span>}</td>
            <td data-l="Assigned" style={{ fontSize: '.82rem' }}>{formatDate(t.assignedDate)}</td>
            <td data-l="Due" style={{ fontSize: '.82rem' }}>{formatDate(t.dueDate)}</td>
            <td data-l="Priority"><span className={`st ${priorityClass(t.priority)}`}>{t.priority}</span></td>
            <td data-l="Category" style={{ fontSize: '.82rem' }}>{t.category || '-'}</td>
            <td data-l="Status"><StatusBadge status={t.status} /></td>
            <td className="m-a"><div style={{ display: 'flex', gap: 4 }}>
              <button className="btn bsm bo" onClick={() => setDetailModal(t)} title="View Details"><span className="material-icons-round" style={{ fontSize: 16 }}>visibility</span></button>
              {canEditT(t) && <button className="btn bsm bo" title="Edit" onClick={() => setModal({ data: t, id: t.id })}><span className="material-icons-round" style={{ fontSize: 16 }}>edit</span></button>}
              {hasAccess(role, 'admin') && <button className="btn bsm bo" title="Delete" onClick={() => handleDelete(t.id)} style={{ color: 'var(--err)', borderColor: 'rgba(231,76,60,.3)' }}><span className="material-icons-round" style={{ fontSize: 16 }}>delete</span></button>}
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

// Req 6.1 / 6.2: pick one or more people - a Team Leader, their members, anyone
// with an account. Each name shows the person's role; a Team Leader is marked.
function AssigneePicker({ value, onChange, users }) {
  const [q, setQ] = useState('');
  // The current accounts, with whoever this task already names kept on the list.
  const names = [...new Set([...value, ...assignableNames(users)])];
  const info = Object.fromEntries(taskPeople({ assignees: names }, users).map(p => [p.name, p]));
  const match = (n) => !q || n.toLowerCase().includes(q.toLowerCase()) || (info[n]?.roleLabel || '').toLowerCase().includes(q.toLowerCase());
  const toggle = (n) => onChange(value.includes(n) ? value.filter(x => x !== n) : [...value, n]);
  const tag = (p) => p ? (p.leader ? 'Team Leader' + (p.roleLabel && p.roleLabel !== 'Team Leader' ? ' · ' + p.roleLabel : '') : p.roleLabel) : '';
  return (
    <div className="fg" data-task="assignees">
      <label>Assign To (one or more)</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
        {value.map(n => (
          <span key={n} className="st st-b" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px' }}>
            {n}{info[n]?.leader ? <small style={{ fontWeight: 600 }}>· TL</small> : null}
            <button type="button" onClick={() => toggle(n)} title={`Remove ${n}`} aria-label={`Remove ${n}`} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, lineHeight: 1, color: 'inherit' }}><span className="material-icons-round" style={{ fontSize: 14 }}>close</span></button>
          </span>
        ))}
        {!value.length && <span style={{ fontSize: '.8rem', color: 'var(--muted)' }}>Nobody chosen yet</span>}
      </div>
      <input className="fi" value={q} onChange={e => setQ(e.target.value)} placeholder="Search a name or role…" style={{ marginBottom: 6 }} />
      <div style={{ maxHeight: 170, overflowY: 'auto', border: '1px solid var(--bor)', borderRadius: 8, padding: 4 }}>
        {names.filter(match).map(n => (
          <label key={n} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 6, cursor: 'pointer', fontSize: '.84rem', background: value.includes(n) ? 'rgba(99,102,241,.08)' : 'transparent' }}>
            <input type="checkbox" checked={value.includes(n)} onChange={() => toggle(n)} style={{ accentColor: 'var(--pri)' }} />
            <span style={{ flex: 1 }}>{n}</span>
            {tag(info[n]) && <span style={{ fontSize: '.7rem', color: info[n]?.leader ? 'var(--pri)' : 'var(--muted)', fontWeight: 600 }}>{tag(info[n])}</span>}
          </label>
        ))}
        {!names.filter(match).length && <div style={{ padding: 8, fontSize: '.8rem', color: 'var(--muted)' }}>No name matches.</div>}
      </div>
    </div>
  );
}

function TaskModal({ data, id, onSave, onClose }) {
  const { users } = useData();
  const [f, setF] = useState({
    title: data.title || '', description: data.description || '',
    assignees: taskAssignees(data), assignedTo: data.assignedTo || '', assignedDate: data.assignedDate || '',
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
          <AssigneePicker value={f.assignees} onChange={v => set('assignees', v)} users={users} />
          <div className="fr"><div className="fg"><label>Assigned Date</label><input type="date" className="fi" value={f.assignedDate} onChange={e => set('assignedDate', e.target.value)} /></div></div>
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
  const { users } = useData();
  const { toast } = useToast();
  const canEdit = canEditTask(task, user, role, hasModule(user, role, 'new_task'));
  const people = taskPeople(task, users);

  const [showUpdateForm, setShowUpdateForm] = useState(false);
  const [updateData, setUpdateData] = useState({ date: todayStr(), update: '' });

  const workUpdates = task.workUpdates || [];

  const handleAddWorkUpdate = async () => {
    if (!updateData.date || !updateData.update.trim()) { toast('Date and update text are required', 'er'); return; }
    try {
      const newEntry = { ...updateData, by: user?.email || 'unknown', at: new Date().toISOString() };
      const updated = [...workUpdates, newEntry];
      await updateDocument('employeeTasks', task.id, { workUpdates: updated });
      toast('Work update logged');
      setShowUpdateForm(false);
      setUpdateData({ date: todayStr(), update: '' });
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
          <div className="di" style={{ gridColumn: '1 / -1' }} data-task="people"><div className="dl">Assigned To</div><div className="dv">
            {people.length ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {people.map(p => (
                  <span key={p.name} className="st st-b" style={{ padding: '3px 9px', fontWeight: 600 }}>
                    {p.name}{p.leader ? ' · Team Leader' : p.roleLabel ? ' · ' + p.roleLabel : ''}{p.designation && !p.leader ? ` (${p.designation})` : ''}
                  </span>
                ))}
              </div>
            ) : 'Unassigned'}
          </div></div>
          {task.assignedBy && <div className="di"><div className="dl">Assigned By</div><div className="dv">{task.assignedBy}</div></div>}
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
              <button type="button" className="btn bsm bo" onClick={() => { setShowUpdateForm(false); setUpdateData({ date: todayStr(), update: '' }); }}>Cancel</button>
            </div>
          </div>
        )}

        {workUpdates.length > 0 ? (
          <div className="tw">
            <table>
              <thead><tr><th>Date</th><th>Work Done</th><th>Updated By</th></tr></thead>
              <tbody>
                {[...workUpdates].reverse().map((wu, i) => (
                  <tr key={`wu-${wu.date}-${i}`}>
                    <td style={{ fontSize: '.82rem', whiteSpace: 'nowrap' }}>{formatDate(wu.date)}</td>
                    <td style={{ fontSize: '.84rem' }}>{wu.update}</td>
                    <td style={{ fontSize: '.78rem', color: 'var(--muted)' }}>{wu.by}<br />{wu.at ? formatDateTime(wu.at) : ''}</td>
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
