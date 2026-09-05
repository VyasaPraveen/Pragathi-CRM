import React from 'react';
import { statusClass, formatDate } from '../services/helpers';

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

// Bug fix: modals no longer close on an accidental backdrop click (which lost
// all typed data). Closing is done via the ✕ button or Cancel. Pass
// allowBackdropClose to opt back in for lightweight view-only modals.
export function Modal({ title, onClose, wide, allowBackdropClose = false, children }) {
  const onBackdrop = (e) => {
    if (allowBackdropClose && e.target === e.currentTarget) onClose();
  };
  return (
    <div className="mo" onClick={onBackdrop}>
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

// Native date picker + a Date-Month-Year (DD-MM-YYYY) readout so the selected
// date is always shown unambiguously regardless of the browser's locale format.
export function DateInput({ value, onChange, required, min, max, style }) {
  return (
    <>
      <input
        type="date"
        className="fi"
        value={value || ''}
        onChange={onChange}
        required={required}
        min={min}
        max={max}
        style={style}
      />
      {value && (
        <span style={{ fontSize: '.72rem', color: 'var(--muted)', marginTop: 3, display: 'block' }}>
          {formatDate(value)}
        </span>
      )}
    </>
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
