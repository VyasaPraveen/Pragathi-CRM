import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DataProvider } from './context/DataContext';
import { ToastProvider, useToast } from './context/ToastContext';
import { Toast } from './components/SharedUI';
import AppLayout from './components/AppLayout';
import Login from './pages/Login';
import './styles/app.css';

function AppContent() {
  const { user, loading } = useAuth();
  const { toasts } = useToast();

  if (loading) {
    return (
      <div id="LS">
        <img src="/logo.jpg" alt="PPS" onError={e => e.target.style.display = 'none'} />
        <div className="spin"></div>
        <p className="lt">Loading Pragathi Power CRM...</p>
      </div>
    );
  }

  return (
    <>
      {user ? (
        <DataProvider>
          <AppLayout />
        </DataProvider>
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
