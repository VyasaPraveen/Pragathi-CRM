import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { auth, db } from '../services/firebase';
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, getDocs, collection } from 'firebase/firestore';
import { getRoleFromDesignation } from '../services/helpers';

const AuthContext = createContext();
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState('staff');
  const [designation, setDesignation] = useState('');
  const [approved, setApproved] = useState(false);
  const [loading, setLoading] = useState(true);
  // Flag to prevent onAuthStateChanged from racing with signup
  const signingUp = useRef(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      // During signup, skip — signup() handles doc creation and state
      if (signingUp.current) return;

      setLoading(true);
      if (u) {
        try {
          const snap = await getDoc(doc(db, 'users', u.uid));
          if (snap.exists()) {
            const data = snap.data();
            setUser(u);
            setRole(data.role || 'staff');
            setDesignation(data.designation || data.role || '');
            setApproved(data.approved === true);
          } else {
            // Auth user exists but no Firestore doc (orphaned account)
            // Auto-create — check if first user for admin auto-grant
            const usersSnap = await getDocs(collection(db, 'users'));
            const isFirstUser = usersSnap.empty;
            const userData = {
              email: u.email,
              displayName: u.displayName || u.email.split('@')[0],
              role: isFirstUser ? 'super_admin' : 'staff',
              designation: isFirstUser ? 'Super Admin' : '',
              approved: isFirstUser,
              createdAt: new Date().toISOString()
            };
            await setDoc(doc(db, 'users', u.uid), userData);
            setUser(u);
            setRole(userData.role);
            setDesignation(userData.designation);
            setApproved(userData.approved);
          }
        } catch (err) {
          console.error('Auth state error:', err);
          setUser(u);
          setRole('staff');
          setDesignation('');
          setApproved(false);
        }
      } else {
        setUser(null);
        setRole('staff');
        setDesignation('');
        setApproved(false);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  const login = (email, password) => signInWithEmailAndPassword(auth, email, password);

  const signup = async (email, password, displayName, chosenDesignation) => {
    // Set flag so onAuthStateChanged skips during signup
    signingUp.current = true;

    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName });

      // Check if this is the first user (will become admin)
      const usersSnap = await getDocs(collection(db, 'users'));
      const isFirstUser = usersSnap.empty;

      const derivedRole = isFirstUser ? 'super_admin' : getRoleFromDesignation(chosenDesignation);
      const userData = {
        email,
        displayName,
        role: derivedRole,
        designation: isFirstUser ? 'Super Admin' : chosenDesignation,
        approved: isFirstUser,
        createdAt: new Date().toISOString()
      };

      await setDoc(doc(db, 'users', cred.user.uid), userData);

      if (isFirstUser) {
        // First user = admin, auto-approved — update state directly
        setUser(cred.user);
        setRole('super_admin');
        setDesignation(userData.designation);
        setApproved(true);
        setLoading(false);
      } else {
        // Non-first user — sign out, they need admin approval
        await signOut(auth);
        setUser(null);
        setRole('staff');
        setDesignation('');
        setApproved(false);
        setLoading(false);
      }

      return { approved: isFirstUser };
    } finally {
      signingUp.current = false;
    }
  };

  const logout = () => signOut(auth);

  return (
    <AuthContext.Provider value={{ user, role, designation, approved, loading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
