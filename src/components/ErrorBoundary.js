import React from 'react';
import { setToken } from '../services/api';

// Global error boundary. Without this, any uncaught render error blanks the whole
// screen (users reported this as a "Data Error" screen). Here we catch it, show a
// friendly recoverable message, and surface the actual error text so the exact
// trigger can be identified and fixed.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Log for support/diagnosis (visible in the browser console).
    console.error('App error boundary caught:', error, info?.componentStack);
  }

  handleReload = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  handleSignOut = () => {
    try { setToken(''); } catch { /* ignore */ }
    window.location.href = '/';
  };

  render() {
    if (!this.state.error) return this.props.children;

    const msg = this.state.error?.message || 'An unexpected error occurred.';
    return (
      <div className="auth">
        <div className="auth-box" style={{ textAlign: 'center' }}>
          <img src="/logo.png" alt="PPS" onError={e => e.target.style.display = 'none'} />
          <p className="asub">Solar Business Management CRM</p>
          <div style={{ margin: '20px 0' }}>
            <span className="material-icons-round" style={{ fontSize: 52, color: 'var(--err)', display: 'block', marginBottom: 12 }}>error_outline</span>
            <h3 style={{ margin: '0 0 8px', fontSize: '1.1rem' }}>Something went wrong</h3>
            <p style={{ color: 'var(--muted)', fontSize: '.88rem', lineHeight: 1.5 }}>
              The screen hit an unexpected error. You can reload to continue — your data is safe.
            </p>
            <div style={{
              marginTop: 14, padding: '10px 12px', background: 'rgba(231,76,60,.06)',
              border: '1px solid rgba(231,76,60,.2)', borderRadius: 8, fontSize: '.78rem',
              color: 'var(--err)', wordBreak: 'break-word', textAlign: 'left', maxHeight: 120, overflow: 'auto'
            }}>
              {msg}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn bp" onClick={this.handleReload}>
              <span className="material-icons-round" style={{ fontSize: 20 }}>refresh</span> Reload
            </button>
            <button className="btn bo" onClick={this.handleSignOut}>
              <span className="material-icons-round" style={{ fontSize: 20 }}>logout</span> Sign Out
            </button>
          </div>
          <p className="afoot">Pragathi Power Solutions &copy; {new Date().getFullYear()}</p>
        </div>
      </div>
    );
  }
}
