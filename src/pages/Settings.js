import React from 'react';
import { useAuth } from '../context/AuthContext';

// S1 fix: removed demo role switcher — role is now server-authoritative only
// S2 fix: removed Firebase config display from UI
export default function Settings() {
  const { user, role } = useAuth();

  return (
    <>
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="ch"><h3>Account</h3></div>
        <div className="cb">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div><span style={{ fontSize: '.76rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Email</span><span style={{ fontSize: '.95rem', fontWeight: 500 }}>{user?.email || '-'}</span></div>
            <div><span style={{ fontSize: '.76rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Role</span><span style={{ fontSize: '.95rem', fontWeight: 500, textTransform: 'capitalize' }}>{role}</span></div>
            <div><span style={{ fontSize: '.76rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Display Name</span><span style={{ fontSize: '.95rem', fontWeight: 500 }}>{user?.displayName || 'Not set'}</span></div>
            <div><span style={{ fontSize: '.76rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Project</span><span style={{ fontSize: '.95rem', fontWeight: 500 }}>pps-crm-new</span></div>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="ch"><h3>Deployment</h3></div>
        <div className="cb">
          <p style={{ fontSize: '.88rem', color: 'var(--muted)', lineHeight: 1.6 }}>
            To deploy updates, run <code style={{ background: 'var(--bg)', padding: '2px 6px', borderRadius: 4 }}>npm run build</code> followed by <code style={{ background: 'var(--bg)', padding: '2px 6px', borderRadius: 4 }}>firebase deploy</code> from the project root.
          </p>
        </div>
      </div>
    </>
  );
}
