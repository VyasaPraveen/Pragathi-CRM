import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DataProvider } from './context/DataContext';
import { ToastProvider, useToast } from './context/ToastContext';
import { Toast } from './components/SharedUI';
import AppLayout from './components/AppLayout';
import Login from './pages/Login';
import './styles/app.css';

function PendingApproval({ logout }) {
  return (
    <div className="auth">
      <div className="auth-box" style={{ textAlign: 'center' }}>
        <img src="/logo.png" alt="PPS" onError={e => e.target.style.display = 'none'} />
        <p className="asub">Solar Business Management CRM</p>
        <div style={{ margin: '24px 0' }}>
          <span className="material-icons-round" style={{ fontSize: 56, color: '#e8830c', display: 'block', marginBottom: 12 }}>hourglass_top</span>
          <h3 style={{ margin: '0 0 8px', fontSize: '1.1rem' }}>Account Pending Approval</h3>
          <p style={{ color: 'var(--muted)', fontSize: '.88rem', lineHeight: 1.5 }}>
            Your account has been created successfully. Please wait for an admin to approve your access.
          </p>
        </div>
        <button className="btn bp blk" onClick={logout} style={{ marginTop: 8 }}>
          <span className="material-icons-round" style={{ fontSize: 20 }}>logout</span> Sign Out
        </button>
        <p className="afoot">Pragathi Power Solutions &copy; {new Date().getFullYear()}</p>
      </div>
    </div>
  );
}

function AppContent() {
  const { user, approved, loading, logout } = useAuth();
  const { toasts } = useToast();

  if (loading) {
    return (
      <div id="LS">
        <img src="/logo.png" alt="PPS" onError={e => e.target.style.display = 'none'} />
        <div className="spin"></div>
        <p className="lt">Loading Pragathi Power CRM...</p>
      </div>
    );
  }

  return (
    <>
      {user ? (
        approved ? (
          <DataProvider>
            <AppLayout />
          </DataProvider>
        ) : (
          <PendingApproval logout={logout} />
        )
      ) : (
        <Login />
      )}
      <Toast toasts={toasts} />
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <AppContent />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
