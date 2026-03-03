import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { DESIGNATIONS } from '../services/helpers';

export default function Login() {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState('login'); // 'login' or 'signup'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [designation, setDesignation] = useState('Admin Assistant');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    return () => { mounted.current = false; };
  }, []);

  const switchMode = (newMode) => {
    setMode(newMode);
    setError('');
    setSuccess('');
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      if (mounted.current) {
        setError(err.message.replace('Firebase: ', ''));
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
          setDesignation('Admin Assistant');
          setPhone('');
        }
        setLoading(false);
      }
    } catch (err) {
      if (mounted.current) {
        setError(err.message.replace('Firebase: ', ''));
        setLoading(false);
      }
    }
  };

  return (
    <div className="auth">
      <div className="auth-box">
        <img src="/logo.png" alt="PPS" onError={e => e.target.style.display = 'none'} />
        <p className="asub">Solar Business Management CRM</p>

        {error && (
          <div className="aerr show">
            <span className="material-icons-round" style={{ fontSize: 18 }}>error</span>
            <span>{error}</span>
          </div>
        )}
        {success && (
          <div style={{ background: 'rgba(39,174,96,.08)', border: '1px solid rgba(39,174,96,.2)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: '.84rem', color: '#27ae60', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="material-icons-round" style={{ fontSize: 18 }}>check_circle</span>
            <span>{success}</span>
          </div>
        )}

        {mode === 'login' ? (
          <form onSubmit={handleLogin}>
            <div className="fg">
              <label>Email Address</label>
              <input type="email" className="fi" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@pragathipower.com" required />
            </div>
            <div className="fg">
              <label>Password</label>
              <input type="password" className="fi" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter password" required />
            </div>
            <button type="submit" className="btn bp blk blg" disabled={loading} style={{ marginTop: 8 }}>
              {loading ? <><span className="ssm"></span> Signing in...</> : <><span className="material-icons-round" style={{ fontSize: 20 }}>login</span> Sign In</>}
            </button>
            <p style={{ textAlign: 'center', marginTop: 16, fontSize: '.88rem', color: 'var(--muted)' }}>
              Don't have an account?{' '}
              <button type="button" onClick={() => switchMode('signup')} style={{ background: 'none', border: 'none', color: 'var(--pri)', fontWeight: 600, cursor: 'pointer', fontSize: '.88rem', padding: 0 }}>
                Sign Up
              </button>
            </p>
          </form>
        ) : (
          <form onSubmit={handleSignup}>
            <div className="fg">
              <label>Full Name</label>
              <input type="text" className="fi" value={name} onChange={e => setName(e.target.value)} placeholder="Enter your full name" required />
            </div>
            <div className="fg">
              <label>Email Address</label>
              <input type="email" className="fi" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@pragathipower.com" required />
            </div>
            <div className="fg">
              <label>Phone Number</label>
              <input type="tel" className="fi" value={phone} onChange={e => setPhone(e.target.value)} placeholder="Enter your mobile number" required />
              <small style={{ color: 'var(--muted)', fontSize: '.78rem', marginTop: 4, display: 'block' }}>Used to verify your identity with the team</small>
            </div>
            <div className="fg">
              <label>Password</label>
              <input type="password" className="fi" value={password} onChange={e => setPassword(e.target.value)} placeholder="Min 8 chars, upper+lower+number" required />
            </div>
            <div className="fg">
              <label>Confirm Password</label>
              <input type="password" className="fi" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Re-enter password" required />
            </div>
            <div className="fg">
              <label>Designation</label>
              <select className="fi" value={designation} onChange={e => setDesignation(e.target.value)}>
                {DESIGNATIONS.filter(d => d.role !== 'admin').map(d => (
                  <option key={d.label} value={d.label}>{d.label}</option>
                ))}
              </select>
              <small style={{ color: 'var(--muted)', fontSize: '.78rem', marginTop: 4, display: 'block' }}>Access will be granted after admin approval</small>
            </div>
            <button type="submit" className="btn bp blk blg" disabled={loading} style={{ marginTop: 8 }}>
              {loading ? <><span className="ssm"></span> Creating account...</> : <><span className="material-icons-round" style={{ fontSize: 20 }}>person_add</span> Sign Up</>}
            </button>
            <p style={{ textAlign: 'center', marginTop: 16, fontSize: '.88rem', color: 'var(--muted)' }}>
              Already have an account?{' '}
              <button type="button" onClick={() => switchMode('login')} style={{ background: 'none', border: 'none', color: 'var(--pri)', fontWeight: 600, cursor: 'pointer', fontSize: '.88rem', padding: 0 }}>
                Sign In
              </button>
            </p>
          </form>
        )}

        <p className="afoot">Pragathi Power Solutions &copy; {new Date().getFullYear()}</p>
      </div>
    </div>
  );
}
