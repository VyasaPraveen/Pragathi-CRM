import React, { useMemo, useState } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { formatDate, formatDateTime } from '../services/helpers';
import { EmptyState, DateFilter } from '../components/SharedUI';
import { DATE_FILTER_ALL, applyDateFilter } from '../services/dateFilter';
import { dispatchedItemNames } from '../services/permissions';
import { assignedMaterialsFor, dispatchStage, dispatchStageLabel, deliveryDone, handoverDone } from '../services/dispatchFlow';
import DispatchPanel from '../components/DispatchPanel';

const ASSIGNED_DATE_FIELDS = ['dispatchAssignedAt', 'approvalDate', 'createdAt'];

// ============================================================================
// Assigned Materials (Req 3.6, 15-Oct).
//
// The material a person has been handed for a purchase order, in one place:
// what was assigned, by whom and when, which PO and customer it is for, and
// where it stands. Opening a row shows the same dispatch panel the PO carries
// everywhere else, so the two handovers — "Handover Received" from the
// warehouse and "Delivery Confirmed" at the customer's location — are done
// here. The Operation Manager, the warehouse and the authorities see every
// assignment; everyone else sees their own.
// ============================================================================
export default function AssignedMaterials() {
  const { leadPOs, leads } = useData();
  const { user, role } = useAuth();
  const [open, setOpen] = useState('');
  const [filter, setFilter] = useState('open');       // 'open' | 'done' | 'all'
  const [dateFilter, setDateFilter] = useState(DATE_FILTER_ALL);

  const mine = useMemo(() => assignedMaterialsFor(leadPOs, user, role)
    .sort((a, b) => String(b.dispatchAssignedAt || '').localeCompare(String(a.dispatchAssignedAt || ''))), [leadPOs, user, role]);
  const shown = applyDateFilter(mine.filter(po => filter === 'all' ? true : filter === 'done' ? deliveryDone(po) : !deliveryDone(po)), dateFilter, ASSIGNED_DATE_FIELDS);
  const openCount = mine.filter(po => !deliveryDone(po)).length;
  const leadOf = (po) => leads.find(l => l.id === po.leadId) || null;

  const chip = (key, label, n) => (
    <span className={`fc ${filter === key ? 'act' : ''}`} onClick={() => setFilter(key)}>{label}{n != null ? ` (${n})` : ''}</span>
  );

  return (
    <>
      <div className="tl">
        <h3>Assigned Materials</h3>
        <DateFilter value={dateFilter} onChange={setDateFilter} records={mine} fields={ASSIGNED_DATE_FIELDS} compact />
      </div>
      <div className="chips" style={{ marginBottom: 12 }}>
        {chip('open', 'To deliver', openCount)}
        {chip('done', 'Delivered', mine.length - openCount)}
        {chip('all', 'All', mine.length)}
      </div>

      {!shown.length && (
        <div className="card"><div className="cb">
          <EmptyState icon="assignment_turned_in" title={mine.length ? 'Nothing in this view' : 'No materials assigned to you'}
            message={mine.length ? 'Change the filter or the period above.' : 'When the Operation Manager assigns you the material for a purchase order it appears here, with the items to check and deliver.'} />
        </div></div>
      )}

      <div style={{ display: 'grid', gap: 10 }}>
        {shown.map(po => {
          const lead = leadOf(po);
          const items = dispatchedItemNames(po);
          const stage = dispatchStage(po);
          const tone = stage === 'closed' || stage === 'delivered' ? '#1e8449' : stage === 'received' ? '#2980b9' : '#d68910';
          const key = po.id;
          return (
            <div key={key} className="card" style={{ borderLeft: `4px solid ${tone}` }}>
              <div className="cb" style={{ padding: '12px 14px' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="material-icons-round" style={{ color: tone }}>{deliveryDone(po) ? 'task_alt' : handoverDone(po) ? 'local_shipping' : 'inventory'}</span>
                  <strong>PO {po.poNumber || '-'}</strong>
                  <span style={{ fontSize: '.84rem' }}>{(lead && lead.name) || po.customerName || ''}{po.customerAddress || (lead && lead.address) ? <span style={{ color: 'var(--muted)' }}> · {po.customerAddress || lead.address}</span> : null}</span>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: '.74rem', fontWeight: 700, color: tone, border: `1px solid ${tone}`, borderRadius: 10, padding: '1px 8px' }}>{dispatchStageLabel(po)}</span>
                </div>
                <div className="dg" style={{ marginTop: 10 }}>
                  <div className="di"><div className="dl">Assigned to</div><div className="dv">{po.dispatchAssignedTo}</div></div>
                  <div className="di"><div className="dl">Assigned by</div><div className="dv">{po.dispatchAssignedBy || '-'} <span style={{ color: 'var(--muted)', fontSize: '.8rem' }}>on {formatDateTime(po.dispatchAssignedAt)}</span></div></div>
                  <div className="di" style={{ gridColumn: '1 / -1' }}><div className="dl">Materials ({items.length})</div><div className="dv" style={{ fontSize: '.86rem' }}>{items.join(', ') || '-'}</div></div>
                  {po.dispatchAssignNote && <div className="di" style={{ gridColumn: '1 / -1' }}><div className="dl">Note from the Operation Manager</div><div className="dv">{po.dispatchAssignNote}</div></div>}
                  {po.dispatchReceivedAt && <div className="di"><div className="dl">Handover received</div><div className="dv" style={{ fontSize: '.86rem' }}>{po.dispatchReceivedBy} · {formatDateTime(po.dispatchReceivedAt)}</div></div>}
                  {po.deliveredAt && <div className="di"><div className="dl">Delivered</div><div className="dv" style={{ fontSize: '.86rem' }}>{po.deliveredBy} · {formatDateTime(po.deliveredAt)}{po.deliveryLocation ? ` · ${po.deliveryLocation}` : ''}</div></div>}
                  {po.approvalDate && <div className="di"><div className="dl">PO approved</div><div className="dv" style={{ fontSize: '.86rem' }}>{formatDate(po.approvalDate)}</div></div>}
                </div>
                <button className="btn bsm bo" style={{ marginTop: 6 }} onClick={() => setOpen(open === key ? '' : key)}>
                  <span className="material-icons-round" style={{ fontSize: 16 }}>{open === key ? 'expand_less' : 'expand_more'}</span>
                  {open === key ? 'Hide the items' : deliveryDone(po) ? 'View the items and history' : handoverDone(po) ? 'Open — confirm the delivery' : 'Open — confirm the handover'}
                </button>
                {open === key && <DispatchPanel po={po} lead={lead} />}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
