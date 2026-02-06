import React from 'react';
import { statusClass } from '../services/helpers';

export function StatusBadge({ status }) {
  return <span className={`st ${statusClass(status)}`}>{status || 'N/A'}</span>;
}

export function StatCard({ color, icon, value, label }) {
  return (
    <div className={`sc ${color}`}>
      <div className="si"><span className="material-icons-round">{icon}</span></div>
      <div className="sv"><h4>{value}</h4><p>{label}</p></div>
    </div>
  );
}

export function DetailItem({ label, value }) {
  return (
    <div className="di">
      <div className="dl">{label}</div>
      <div className="dv">{value || '-'}</div>
    </div>
  );
}

export function ProgressBar({ value, color }) {
  const c = color || (value >= 80 ? 'gr' : value >= 40 ? 'or' : 'bl');
  return (
    <div className="pb">
      <div className={`pf ${c}`} style={{ width: `${value}%` }}></div>
    </div>
  );
}

export function EmptyState({ icon, title, message, children }) {
  return (
    <div className="es">
      <span className="material-icons-round">{icon}</span>
      <h4>{title}</h4>
      <p>{message}</p>
      {children}
    </div>
  );
}

// B7 fix: removed unused 'name' prop
export function Modal({ title, onClose, wide, children }) {
  return (
    <div className="mo" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="md" style={wide ? { width: '680px' } : {}}>
        <div className="mh">
          <h3>{title}</h3>
          <button className="mx" onClick={onClose}>
            <span className="material-icons-round">close</span>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Toast({ toasts }) {
  if (!toasts.length) return null;
  return (
    <div className="tc">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.type}`}>
          <span className="material-icons-round" style={{ fontSize: 18 }}>
            {t.type === 'ok' ? 'check_circle' : t.type === 'er' ? 'error' : 'warning'}
          </span>
          {t.message}
        </div>
      ))}
    </div>
  );
}
