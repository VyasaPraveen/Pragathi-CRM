import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { formatDate } from '../services/helpers';
import { can, ACTIONS, canSeeLead } from '../services/permissions';
import {
  QT_STATUS, APPROVAL_HOURS, SHARE_DAYS, ACCEPT_DAYS, FOLLOWUP_REMIND_DAYS,
  quotationRef, quotationDue, daysUntil,
} from '../services/quotation';

// The popup only nags about something once. It comes back when the list of
// outstanding items actually changes, not on every page change.
const SEEN_KEY = 'pps_due_alerts_seen';
const readSeen = () => { try { return sessionStorage.getItem(SEEN_KEY) || ''; } catch { return ''; } };
const writeSeen = (sig) => { try { sessionStorage.setItem(SEEN_KEY, sig); } catch { /* ignore */ } };

const hoursLeft = (at) => at ? Math.round(((new Date(at) - new Date()) / 3600000) * 10) / 10 : null;

/* The reminders the 19-Sep workflow calls for, gathered in one place:
   a quotation waiting for approval, an approved quotation still to be shared,
   a customer whose 3 days are running out, and a follow-up date 2 days away. */
export default function DueAlerts() {
  const { quotations, leads, users, team } = useData();
  const { user, role } = useAuth();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);

  const myEmail = String(user?.email || '').toLowerCase();
  const myName = String(user?.displayName || '').toLowerCase();
  const isApprover = can(role, ACTIONS.QUOTATION_APPROVE);

  const mine = (v) => {
    const s = String(v || '').toLowerCase();
    return !!s && (s === myEmail || s === myName);
  };

  const items = useMemo(() => {
    if (!user) return [];
    const out = [];
    const leadById = new Map((leads || []).map(l => [l.id, l]));

    (quotations || []).forEach(q => {
      const lead = leadById.get(q.leadId);
      // Only ever talk to someone about a lead they are allowed to see.
      if (lead && !canSeeLead(lead, user, role, users, team)) return;
      const concerned = mine(q.executiveName) || mine(q.executiveEmail) ||
        (lead && (mine(lead.assignedTo) || mine(lead.salesExecutive)));
      const due = quotationDue(q);
      const left = hoursLeft(due?.at);

      if (q.status === QT_STATUS.PENDING && isApprover) {
        out.push({
          id: 'appr-' + q.id, icon: 'gavel', tone: left != null && left < 0 ? 'late' : 'warn',
          title: `Approve ${quotationRef(q)} — ${q.customerName || q.leadName || 'lead'}`,
          detail: left == null ? `Approval is due within ${APPROVAL_HOURS} hours.`
            : left < 0 ? `Overdue by ${Math.abs(left)} h — any ONE of Admin / Operation Manager / Management / Owner can approve.`
              : `${left} h left of the ${APPROVAL_HOURS}-hour approval window.`,
          to: '/leads',
        });
      }
      if (q.status === QT_STATUS.APPROVED && (concerned || isApprover)) {
        out.push({
          id: 'share-' + q.id, icon: 'send', tone: left != null && left < 0 ? 'late' : 'info',
          title: `Share ${quotationRef(q)} with ${q.customerName || 'the customer'}`,
          detail: left != null && left < 0
            ? `The ${SHARE_DAYS}-day window to share the approved quotation has passed.`
            : `Approved — share it with the customer by ${formatDate(due?.at)}.`,
          to: '/leads',
        });
      }
      if (q.status === QT_STATUS.SHARED && (concerned || isApprover)) {
        out.push({
          id: 'resp-' + q.id, icon: 'hourglass_bottom', tone: left != null && left < 0 ? 'late' : 'info',
          title: `${q.customerName || 'Customer'} — response due on ${quotationRef(q)}`,
          detail: left != null && left < 0
            ? `The customer's ${ACCEPT_DAYS} days are up. Record whether they accepted, or capture the reason and the next follow-up date.`
            : `Accept-by ${formatDate(due?.at)} (${ACCEPT_DAYS} days from sharing).`,
          to: '/leads',
        });
      }
    });

    // Follow-up reminders — 2 days before the date that was agreed.
    (leads || []).forEach(l => {
      if (!l.nextFollowUpDate || l.status === 'Converted') return;
      if (!canSeeLead(l, user, role, users, team)) return;
      const concerned = mine(l.assignedTo) || mine(l.salesExecutive);
      if (!concerned && !isApprover) return;
      const d = daysUntil(l.nextFollowUpDate);
      if (d == null || d > FOLLOWUP_REMIND_DAYS) return;
      out.push({
        id: 'fup-' + l.id, icon: 'event_repeat', tone: d < 0 ? 'late' : 'warn',
        title: `Follow-up ${d < 0 ? `overdue by ${-d} day${d === -1 ? '' : 's'}` : d === 0 ? 'today' : `in ${d} day${d === 1 ? '' : 's'}`} — ${l.name}`,
        detail: `${formatDate(l.nextFollowUpDate)}${l.notAcceptedReason ? ' · ' + l.notAcceptedReason : ''}${l.phone ? ' · ' + l.phone : ''}`,
        to: '/leads',
      });
    });

    // Most urgent first.
    const rank = { late: 0, warn: 1, info: 2 };
    return out.sort((a, b) => (rank[a.tone] ?? 3) - (rank[b.tone] ?? 3));
  }, [quotations, leads, users, team, user, role, isApprover]); // eslint-disable-line react-hooks/exhaustive-deps

  const signature = items.map(i => i.id).join('|');

  // A new outstanding item brings the popup back.
  useEffect(() => {
    if (signature && signature !== readSeen()) setDismissed(false);
  }, [signature]);

  if (!items.length || dismissed) return null;

  const close = () => { writeSeen(signature); setDismissed(true); };
  const tones = {
    late: { bg: 'rgba(231,76,60,.08)', bd: 'rgba(231,76,60,.3)', fg: '#c0392b' },
    warn: { bg: 'rgba(243,156,18,.08)', bd: 'rgba(243,156,18,.3)', fg: '#d68910' },
    info: { bg: 'rgba(26,58,122,.05)', bd: 'var(--bor)', fg: 'var(--dark)' },
  };

  return (
    <div className="mo" onClick={e => { if (e.target === e.currentTarget) close(); }}>
      <div className="md" style={{ width: 560, maxWidth: '94vw' }}>
        <div className="mh">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="material-icons-round" style={{ fontSize: 20, color: 'var(--pri)' }}>notifications_active</span>
            Needs your attention ({items.length})
          </h3>
          <button className="mx" onClick={close}><span className="material-icons-round">close</span></button>
        </div>
        <div className="mb" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {items.slice(0, 15).map(it => {
            const t = tones[it.tone] || tones.info;
            return (
              <button key={it.id} type="button"
                onClick={() => { close(); navigate(it.to); }}
                style={{
                  display: 'flex', gap: 10, alignItems: 'flex-start', width: '100%', textAlign: 'left',
                  background: t.bg, border: `1px solid ${t.bd}`, borderRadius: 10,
                  padding: '10px 12px', marginBottom: 8, cursor: 'pointer',
                }}>
                <span className="material-icons-round" style={{ fontSize: 19, color: t.fg, marginTop: 1 }}>{it.icon}</span>
                <span>
                  <span style={{ display: 'block', fontWeight: 600, fontSize: '.86rem', color: t.fg }}>{it.title}</span>
                  <span style={{ display: 'block', fontSize: '.79rem', color: 'var(--muted)', marginTop: 2 }}>{it.detail}</span>
                </span>
              </button>
            );
          })}
          {items.length > 15 && <p style={{ fontSize: '.8rem', color: 'var(--muted)', margin: 0 }}>…and {items.length - 15} more.</p>}
        </div>
        <div className="mf"><button className="btn bp" onClick={close}>Got it</button></div>
      </div>
    </div>
  );
}
