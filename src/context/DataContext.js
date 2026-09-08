import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { sortDocs } from '../services/firestore';
import { apiGet } from '../services/api';

const DataContext = createContext();
export const useData = () => useContext(DataContext);

export function DataProvider({ children }) {
  const { user } = useAuth();
  const [leads, setLeads] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [installations, setInstallations] = useState([]);
  const [team, setTeam] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [ongoingWork, setOngoingWork] = useState([]);
  const [income, setIncome] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [gallery, setGallery] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [retailers, setRetailers] = useState([]);
  const [influencers, setInfluencers] = useState([]);
  const [employeeTasks, setEmployeeTasks] = useState([]);
  const [leadPOs, setLeadPOs] = useState([]);
  const [expenditures, setExpenditures] = useState([]);
  const [bomTemplates, setBomTemplates] = useState([]);
  const [activityLog, setActivityLog] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [users, setUsers] = useState([]);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [tracking, setTracking] = useState([]);
  const [settings, setSettings] = useState({});

  useEffect(() => {
    if (!user) return;

    // All document collections are fetched in ONE batched request (one DB
    // connection) instead of one request per collection — this keeps the app
    // well under the host's per-user MySQL connection limit even with several
    // tabs/users open. `users` (directory) and `settings` are separate routes.
    // [name, setter, orderByField, dir] — omit sort → createdAt desc (batch default).
    const cfg = [
      ['leads', setLeads], ['customers', setCustomers], ['installations', setInstallations],
      ['team', setTeam, 'name', 'asc'], ['materials', setMaterials], ['ongoingWork', setOngoingWork],
      ['income', setIncome, 'date', 'desc'], ['expenses', setExpenses, 'date', 'desc'],
      ['reminders', setReminders], ['gallery', setGallery], ['purchaseOrders', setPurchaseOrders],
      ['retailers', setRetailers], ['influencers', setInfluencers], ['employeeTasks', setEmployeeTasks],
      ['leadPOs', setLeadPOs], ['expenditures', setExpenditures], ['bomTemplates', setBomTemplates],
      ['activityLog', setActivityLog], ['notifications', setNotifications],
      ['leaveRequests', setLeaveRequests], ['attendance', setAttendance], ['tracking', setTracking],
    ];
    const names = cfg.map(c => c[0]).join(',');

    let stopped = false;
    let pollTimer = null;
    let refreshTimer = null;

    const distribute = (batch) => {
      cfg.forEach(([name, setter, ob, dir]) => {
        const docs = Array.isArray(batch?.[name]) ? batch[name] : [];
        setter(sortDocs(docs, ob || 'createdAt', dir || 'desc'));
      });
    };

    const fetchAll = async () => {
      try {
        // Batch + directory run concurrently (2 connections); settings follows.
        const [batch, dir] = await Promise.all([
          apiGet('/batch?names=' + encodeURIComponent(names)),
          apiGet('/auth/directory').catch(() => null),
        ]);
        if (stopped) return;
        distribute(batch || {});
        if (dir && Array.isArray(dir.users)) setUsers(dir.users);
      } catch { /* transient (e.g. DB busy) — the next tick retries */ }
      try {
        const s = await apiGet('/settings');
        if (!stopped) setSettings(s || {});
      } catch { /* ignore */ }
    };

    const tick = async () => {
      await fetchAll();
      if (!stopped) pollTimer = setTimeout(tick, 15000);
    };

    // Refetch on window focus and after any local write (pps:refresh), coalescing
    // rapid bursts into a single batched fetch.
    const onFocus = () => { if (!stopped) fetchAll(); };
    const onRefresh = () => {
      if (stopped) return;
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(fetchAll, 300);
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('pps:refresh', onRefresh);
    tick();

    return () => {
      stopped = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (refreshTimer) clearTimeout(refreshTimer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pps:refresh', onRefresh);
    };
  }, [user]);

  return (
    <DataContext.Provider value={{
      leads, customers, installations, team, materials,
      ongoingWork, income, expenses, reminders, gallery,
      purchaseOrders, retailers, influencers, employeeTasks, leadPOs, expenditures, bomTemplates, activityLog, notifications, users,
      leaveRequests, attendance, tracking, settings
    }}>
      {children}
    </DataContext.Provider>
  );
}
