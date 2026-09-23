import React from 'react';
import { statusClass, formatDate } from '../services/helpers';
import { searchNames } from '../services/people';

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

// A name picker you can type into. The list narrows as you type (partial and
// out-of-order letters both find a name), you pick with the mouse or the arrow
// keys, and — because the valid list can never cover every name a lead might
// need — whatever you type is accepted as-is when `allowFree` is set.
export function SearchSelect({
  value, onChange, options, placeholder = 'Search or select a name…',
  allowFree = true, groups, disabled, emptyText = 'No matching name',
}) {
  const [query, setQuery] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const boxRef = React.useRef(null);

  // Clicking anywhere else closes the list and drops a half-typed search.
  React.useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) { setOpen(false); setQuery(''); } };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  // The list narrows as you type. Filtering happens here rather than in the
  // caller so every picker in the app searches names the same way.
  const shown = React.useMemo(
    () => (open && query.trim() ? searchNames(options || [], query) : (options || [])),
    [options, query, open]);
  React.useEffect(() => { setActive(0); }, [query]);

  const choose = (name) => { onChange(name); setOpen(false); setQuery(''); };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(i => Math.min(i + 1, shown.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && shown[active]) choose(shown[active]);
      else if (allowFree && query.trim()) choose(query.trim());
    } else if (e.key === 'Escape') { setOpen(false); setQuery(''); }
  };

  // Which group heading, if any, sits above this row.
  const headingFor = (name, i) => {
    if (!groups) return null;
    const g = groups(name);
    return g && g !== groups(shown[i - 1]) ? g : null;
  };

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          className="fi" disabled={disabled}
          value={open ? query : (value || '')}
          placeholder={value ? value : placeholder}
          onFocus={() => { setOpen(true); setQuery(''); }}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onKeyDown={onKeyDown}
          autoComplete="off"
        />
        {value && !disabled && (
          <button type="button" className="btn bsm bo" title="Clear" onClick={() => onChange('')}
            style={{ padding: '6px 8px' }}>
            <span className="material-icons-round" style={{ fontSize: 16 }}>close</span>
          </button>
        )}
      </div>
      {open && !disabled && (
        <div style={{
          position: 'absolute', zIndex: 40, top: '100%', left: 0, right: 0, marginTop: 4,
          background: 'var(--card, #fff)', border: '1px solid var(--bor)', borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,.12)', maxHeight: 240, overflowY: 'auto',
        }}>
          {shown.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: '.82rem', color: 'var(--muted)' }}>
              {emptyText}{allowFree && query.trim() ? ' — press Enter to use "' + query.trim() + '"' : ''}
            </div>
          )}
          {shown.map((name, i) => {
            const heading = headingFor(name, i);
            return (
              <React.Fragment key={name}>
                {heading && (
                  <div style={{ padding: '6px 12px 2px', fontSize: '.7rem', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--muted)' }}>{heading}</div>
                )}
                <div
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={e => { e.preventDefault(); choose(name); }}
                  style={{
                    padding: '8px 12px', fontSize: '.86rem', cursor: 'pointer',
                    background: i === active ? 'rgba(26,58,122,.08)' : 'transparent',
                    fontWeight: name === value ? 700 : 400,
                  }}>
                  {name}
                </div>
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
