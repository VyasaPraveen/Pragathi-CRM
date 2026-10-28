import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

const ToastContext = createContext();
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const toast = useCallback((message, type = 'ok') => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);

  // Code without a hook (the WhatsApp helpers) reaches the toasts this way.
  useEffect(() => {
    window.__ppsToast = toast;
    return () => { if (window.__ppsToast === toast) delete window.__ppsToast; };
  }, [toast]);

  return (
    <ToastContext.Provider value={{ toasts, toast }}>
      {children}
    </ToastContext.Provider>
  );
}
