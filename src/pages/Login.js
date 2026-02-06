import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // B3 fix: track mounted state to prevent setState after unmount
  const mounted = useRef(true);

  useEffect(() => {
    return () => { mounted.current = false; };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      // On success, component unmounts — don't call setLoading
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
        <img src="/logo.jpg" alt="PPS" onError={e => e.target.style.display = 'none'} />
        <p className="asub">Solar Business Management CRM</p>
        {error && (
          <div className="aerr show">
            <span className="material-icons-round" style={{ fontSize: 18 }}>error</span>
            <span>{error}</span>
          </div>
        )}
        <form onSubmit={handleSubmit}>
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
        </form>
        <p className="afoot">Pragathi Power Solutions &copy; {new Date().getFullYear()}</p>
      </div>
    </div>
  );
}
