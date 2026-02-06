import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useData } from '../context/DataContext';

const titles = {
  '/': 'Dashboard', '/leads': 'Lead Management', '/customers': 'Customers',
  '/installations': 'Installations', '/ongoing': 'Ongoing Work', '/materials': 'Materials & Inventory',
  '/revenue': 'Revenue', '/reports': 'Reports', '/team': 'Team Management',
  '/reminders': 'Reminders', '/about': 'About PPS', '/gallery': 'Gallery', '/settings': 'Settings'
};

export default function Topbar({ onMenuClick }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { reminders } = useData();
  const pending = reminders.filter(r => r.status === 'Pending').length;

  return (
    <header className="tb">
      <div className="tb-l">
        <span className="material-icons-round mt" onClick={onMenuClick}>menu</span>
        <h1 className="pt">{titles[pathname] || 'Dashboard'}</h1>
      </div>
      <div className="tb-r">
        <button className="tbtn" onClick={() => navigate('/reminders')} title="Notifications">
          <span className="material-icons-round">notifications</span>
          {pending > 0 && <span className="dot"></span>}
        </button>
        <button className="tbtn" onClick={() => navigate('/settings')} title="Settings">
          <span className="material-icons-round">settings</span>
        </button>
      </div>
    </header>
  );
}
