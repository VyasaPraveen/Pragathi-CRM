import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { DESIGNATIONS } from '../services/helpers';

// Map Firebase auth error codes to generic, non-enumerable messages
const authErrorMessage = (err) => {
  // Legacy Firebase-style codes (kept for safety)
  switch (err?.code || '') {
    case 'auth/invalid-email': return 'Please enter a valid email address.';
    case 'auth/user-disabled': return 'This account has been disabled. Please contact your administrator.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential': return 'Incorrect email or password.';
    case 'auth/too-many-requests': return 'Too many attempts. Please try again in a few minutes.';
    case 'auth/network-request-failed': return 'Network error. Please check your connection and try again.';
    case 'auth/email-already-in-use': return 'An account with this email already exists.';
    case 'auth/weak-password': return 'Password is too weak. Use at least 8 characters.';
    default: break;
  }
  // The API returns user-friendly messages (e.g. "Invalid email or password").
  if (err?.message) return err.message;
  return 'Something went wrong. Please try again.';
};

// Reusable password field with a show/hide toggle.
function PasswordField({ label, value, onChange, placeholder, autoComplete, onCapsLock }) {
  const [show, setShow] = useState(false);
  return (
    <div className="fg">
      <label>{label}</label>
      <div className="pw">
        <input
          type={show ? 'text' : 'password'}
          className="fi"
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          autoComplete={autoComplete}
          onKeyUp={onCapsLock}
          onKeyDown={onCapsLock}
          required
        />
        <button
          type="button"
          className="pw-toggle"
          onClick={() => setShow(s => !s)}
          aria-label={show ? 'Hide password' : 'Show password'}
          tabIndex={-1}
        >
          <span className="material-icons-round" style={{ fontSize: 20 }}>{show ? 'visibility_off' : 'visibility'}</span>
        </button>
      </div>
    </div>
  );
}

export default function Login() {
  const { login, signup, resetPassword } = useAuth();
  const [mode, setMode] = useState('login'); // 'login' | 'signup' | 'reset'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [designation, setDesignation] = useState('Executive');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    return () => { mounted.current = false; };
  }, []);

  const switchMode = (newMode) => {
    setMode(newMode);
    setError('');
    setSuccess('');
    setCapsLock(false);
  };

  const onCapsLock = (e) => {
    if (typeof e.getModifierState === 'function') setCapsLock(e.getModifierState('CapsLock'));
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      if (mounted.current) {
        setError(authErrorMessage(err));
        setLoading(false);
      }
    }
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) {
      setError('Password must be at least 8 characters with uppercase, lowercase, and a number');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (!name.trim() || name.trim().length < 2) {
      setError('Please enter your full name');
      return;
    }
    if (String(phone).replace(/\D/g, '').length < 10) {
      setError('Please enter a valid 10-digit mobile number');
      return;
    }

    setLoading(true);
    try {
      const result = await signup(email, password, name, designation, phone);
      if (mounted.current) {
        if (result.approved) {
          // Admin auto-approved — will auto-login
        } else {
          setSuccess('Account created! Please wait for admin approval before signing in.');
          setMode('login');
          setName('');
          setEmail('');
          setPassword('');
          setConfirmPassword('');
          setDesignation('Executive');
          setPhone('');
        }
        setLoading(false);
      }
    } catch (err) {
      if (mounted.current) {
        setError(authErrorMessage(err));
        setLoading(false);
      }
    }
  };

  const handleReset = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Please enter a valid email address.');
      return;
    }
    setLoading(true);
    try {
      await resetPassword(email);
    } catch (err) {
      // Reveal only non-enumerable errors; otherwise fall through to the generic success below.
      if (err?.code === 'auth/invalid-email' || err?.code === 'auth/network-request-failed' || err?.code === 'auth/too-many-requests') {
        if (mounted.current) { setError(authErrorMessage(err)); setLoading(false); }
        return;
      }
    }
    if (mounted.current) {
      // Reset is admin-handled (no mail server). Generic, non-enumerating copy.
      setSuccess('If an account exists for that email, your reset request has been sent to the administrator, who will set a new password for you.');
      setLoading(false);
    }
  };

  const heading = mode === 'login' ? 'Welcome back' : mode === 'signup' ? 'Create your account' : 'Reset your password';
  const subheading = mode === 'login'
    ? 'Sign in to continue to your dashboard.'
    : mode === 'signup'
      ? 'Register for access — an admin will approve your account.'
      : 'Enter your email and your reset request will be sent to an administrator.';

  return (
    <div className="lg">
      {/* Brand panel */}
      <aside className="lg-brand" aria-hidden="true">
        <span className="lg-glow lg-glow-1" />
        <span className="lg-glow lg-glow-2" />
        <div className="lg-brand-inner">
          <img src="/logo-full.png" alt="Pragathi Power Solutions" onError={e => e.target.style.display = 'none'} />
          <h1 className="lg-brand-title">Solar Business Management CRM</h1>
          <p className="lg-brand-sub">Everything your solar business needs — leads, installations, teams and revenue — in one place.</p>
          <ul className="lg-feats">
            <li><span className="material-icons-round">bolt</span> Track leads &amp; installations end to end</li>
            <li><span className="material-icons-round">groups</span> Manage teams, tasks &amp; workflows</li>
            <li><span className="material-icons-round">insights</span> Live reports, revenue &amp; reminders</li>
          </ul>
        </div>
        <p className="lg-brand-foot">Pragathi Power Solutions &copy; {new Date().getFullYear()}</p>
      </aside>

      {/* Form panel */}
      <main className="lg-main">
        <div className="lg-card">
          <img className="lg-logo-sm" src="/logo-full.png" alt="PPS" onError={e => e.target.style.display = 'none'} />
          <h2 className="lg-head">{heading}</h2>
          <p className="lg-subhead">{subheading}</p>

          {error && (
            <div className="aerr show" role="alert">
              <span className="material-icons-round" style={{ fontSize: 18 }}>error</span>
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="asucc" role="status">
              <span className="material-icons-round" style={{ fontSize: 18 }}>check_circle</span>
              <span>{success}</span>
            </div>
          )}

          {mode === 'login' && (
            <form onSubmit={handleLogin}>
              <div className="fg">
                <label>Email Address</label>
                <input type="email" className="fi" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@pragathipower.com" autoComplete="email" autoFocus required />
              </div>
              <PasswordField label="Password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter password" autoComplete="current-password" onCapsLock={onCapsLock} />
              {capsLock && (
                <p className="lg-caps"><span className="material-icons-round" style={{ fontSize: 15 }}>keyboard_capslock</span> Caps Lock is on</p>
              )}
              <div className="lg-row">
                <span />
                <button type="button" className="lg-link" onClick={() => switchMode('reset')}>Forgot password?</button>
              </div>
              <button type="submit" className="btn bp blk blg" disabled={loading} style={{ marginTop: 8 }}>
                {loading ? <><span className="ssm"></span> Signing in...</> : <><span className="material-icons-round" style={{ fontSize: 20 }}>login</span> Sign In</>}
              </button>
              <p className="lg-switch">
                Don't have an account?{' '}
                <button type="button" onClick={() => switchMode('signup')} className="lg-link">Sign Up</button>
              </p>
            </form>
          )}

          {mode === 'signup' && (
            <form onSubmit={handleSignup}>
              <div className="fg">
                <label>Full Name</label>
                <input type="text" className="fi" value={name} onChange={e => setName(e.target.value)} placeholder="Enter your full name" autoComplete="name" required />
              </div>
              <div className="fg">
                <label>Email Address</label>
                <input type="email" className="fi" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@pragathipower.com" autoComplete="email" required />
              </div>
              <div className="fg">
                <label>Phone Number</label>
                <input type="tel" className="fi" value={phone} onChange={e => setPhone(e.target.value)} placeholder="Enter your mobile number" autoComplete="tel" required />
                <small className="lg-hint">Used to verify your identity with the team</small>
              </div>
              <PasswordField label="Password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Min 8 chars, upper+lower+number" autoComplete="new-password" onCapsLock={onCapsLock} />
              <PasswordField label="Confirm Password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Re-enter password" autoComplete="new-password" onCapsLock={onCapsLock} />
              {capsLock && (
                <p className="lg-caps"><span className="material-icons-round" style={{ fontSize: 15 }}>keyboard_capslock</span> Caps Lock is on</p>
              )}
              <div className="fg">
                <label>Designation</label>
                <select className="fi" value={designation} onChange={e => setDesignation(e.target.value)}>
                  {DESIGNATIONS.filter(d => d.role !== 'admin' && d.role !== 'super_admin').map(d => (
                    <option key={d.label} value={d.label}>{d.label}</option>
                  ))}
                </select>
                <small className="lg-hint">Access will be granted after admin approval</small>
              </div>
              <button type="submit" className="btn bp blk blg" disabled={loading} style={{ marginTop: 8 }}>
                {loading ? <><span className="ssm"></span> Creating account...</> : <><span className="material-icons-round" style={{ fontSize: 20 }}>person_add</span> Sign Up</>}
              </button>
              <p className="lg-switch">
                Already have an account?{' '}
                <button type="button" onClick={() => switchMode('login')} className="lg-link">Sign In</button>
              </p>
            </form>
          )}

          {mode === 'reset' && (
            <form onSubmit={handleReset}>
              <div className="fg">
                <label>Email Address</label>
                <input type="email" className="fi" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@pragathipower.com" autoComplete="email" autoFocus required />
              </div>
              <button type="submit" className="btn bp blk blg" disabled={loading} style={{ marginTop: 8 }}>
                {loading ? <><span className="ssm"></span> Sending link...</> : <><span className="material-icons-round" style={{ fontSize: 20 }}>mail</span> Send Reset Link</>}
              </button>
              <p className="lg-switch">
                <button type="button" onClick={() => switchMode('login')} className="lg-link">
                  <span className="material-icons-round" style={{ fontSize: 16, verticalAlign: 'middle' }}>arrow_back</span> Back to Sign In
                </button>
              </p>
            </form>
          )}
        </div>
        <p className="lg-foot-sm">Pragathi Power Solutions &copy; {new Date().getFullYear()}</p>
      </main>
    </div>
  );
}
