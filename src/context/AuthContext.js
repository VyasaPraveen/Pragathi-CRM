import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiGet, apiPost, getToken, setToken, setMe, setUnauthorizedHandler } from '../services/api';

const AuthContext = createContext();
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState('staff');
  const [designation, setDesignation] = useState('');
  const [approved, setApproved] = useState(false);
  const [loading, setLoading] = useState(true);

  // Apply a user object (from login/signup/me) to context + the module holder.
  const applyUser = (u) => {
    setUser(u);
    setRole(u?.role || 'staff');
    setDesignation(u?.designation || u?.role || '');
    setApproved(u?.approved === true);
    setMe(u ? { id: u.id, email: u.email, displayName: u.displayName, role: u.role } : null);
  };

  const clear = () => {
    setToken('');
    applyUser(null);
    setApproved(false);
  };

  // On boot: if we have a token, fetch the current user.
  useEffect(() => {
    let cancelled = false;
    // Log out automatically if any authenticated request returns 401.
    setUnauthorizedHandler(() => clear());
    (async () => {
      if (!getToken()) { setLoading(false); return; }
      try {
        const res = await apiGet('/auth/me');
        if (!cancelled) applyUser(res.user);
      } catch (e) {
        if (!cancelled) clear(); // invalid/expired token
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const login = async (email, password) => {
    const res = await apiPost('/auth/login', { email, password }, { auth: false });
    setToken(res.token);
    applyUser(res.user);
    return res.user;
  };

  const signup = async (email, password, displayName, designation, phone) => {
    const res = await apiPost('/auth/signup', { email, password, displayName, designation, phone }, { auth: false });
    if (res.approved && res.token) {
      setToken(res.token);
      applyUser(res.user);
    }
    return { approved: !!res.approved };
  };

  const logout = () => { clear(); };

  // Self-service reset routes a request to the admins (no mail server in play).
  const resetPassword = async (email) => {
    await apiPost('/auth/request-reset', { email }, { auth: false });
  };

  return (
    <AuthContext.Provider value={{ user, role, designation, approved, loading, login, signup, logout, resetPassword }}>
      {children}
    </AuthContext.Provider>
  );
}
