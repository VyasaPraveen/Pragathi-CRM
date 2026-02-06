import React from 'react';
import { useData } from '../context/DataContext';

export default function About() {
  const { customers, installations, team } = useData();
  return (
    <>
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="cb" style={{ textAlign: 'center', padding: 40 }}>
          <img src="/logo.jpg" alt="PPS" style={{ height: 64, marginBottom: 14 }} onError={e => e.target.style.display = 'none'} />
          <h2 style={{ fontSize: '1.5rem', color: 'var(--pri)', marginBottom: 6 }}>Pragathi Power Solutions</h2>
          <p style={{ color: 'var(--sec)', fontWeight: 600, fontSize: '1rem', marginBottom: 6 }}>Power from the Sun... To Power Every One</p>
          <p style={{ color: 'var(--muted)', fontSize: '.88rem' }}>Since 2012 | Tirupati, Andhra Pradesh</p>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <div className="card"><div className="ch"><h3>Vision & Mission</h3></div><div className="cb">
          <p style={{ fontSize: '.9rem', lineHeight: 1.7 }}><strong>Vision:</strong> To be the leading solar energy provider in Andhra Pradesh.<br /><br /><strong>Mission:</strong> Deliver high-quality, affordable solar power solutions with exceptional service.</p>
        </div></div>
        <div className="card"><div className="ch"><h3>Quick Stats</h3></div><div className="cb">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {[
              { val: customers.length + '+', label: 'Happy Clients', bg: 'rgba(26,58,122,.04)', color: 'var(--pri)' },
              { val: installations.length + '+', label: 'Installations', bg: 'rgba(232,131,12,.06)', color: 'var(--sec)' },
              { val: '10+', label: 'Years', bg: 'rgba(0,184,148,.06)', color: 'var(--ok)' },
              { val: team.length + '+', label: 'Team', bg: 'rgba(142,68,173,.06)', color: '#8e44ad' }
            ].map((s, i) => (
              <div key={i} style={{ textAlign: 'center', padding: 14, background: s.bg, borderRadius: 'var(--rs)' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: s.color }}>{s.val}</div>
                <div style={{ fontSize: '.8rem', color: 'var(--muted)' }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div></div>
      </div>
    </>
  );
}
