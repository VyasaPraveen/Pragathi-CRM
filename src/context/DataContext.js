import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { listenCollection } from '../services/firestore';
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
    const unsubs = [
      listenCollection('leads', (d) => d && setLeads(d)),
      listenCollection('customers', (d) => d && setCustomers(d)),
      listenCollection('installations', (d) => d && setInstallations(d)),
      listenCollection('team', (d) => d && setTeam(d), 'name', 'asc'),
      listenCollection('materials', (d) => d && setMaterials(d)),
      listenCollection('ongoingWork', (d) => d && setOngoingWork(d)),
      listenCollection('income', (d) => d && setIncome(d), 'date', 'desc'),
      listenCollection('expenses', (d) => d && setExpenses(d), 'date', 'desc'),
      listenCollection('reminders', (d) => d && setReminders(d)),
      listenCollection('gallery', (d) => d && setGallery(d)),
      listenCollection('purchaseOrders', (d) => d && setPurchaseOrders(d)),
      listenCollection('retailers', (d) => d && setRetailers(d)),
      listenCollection('influencers', (d) => d && setInfluencers(d)),
      listenCollection('employeeTasks', (d) => d && setEmployeeTasks(d)),
      listenCollection('leadPOs', (d) => d && setLeadPOs(d)),
      listenCollection('expenditures', (d) => d && setExpenditures(d)),
      listenCollection('bomTemplates', (d) => d && setBomTemplates(d)),
      listenCollection('activityLog', (d) => d && setActivityLog(d)),
      listenCollection('notifications', (d) => d && setNotifications(d)),
      listenCollection('users', (d) => d && setUsers(d)),
      listenCollection('leaveRequests', (d) => d && setLeaveRequests(d)),
      listenCollection('attendance', (d) => d && setAttendance(d)),
      listenCollection('tracking', (d) => d && setTracking(d)),
    ];

    // App-wide settings (workflow gating toggle, etc.) — poll + focus refresh.
    let settingsStopped = false, sTimer = null;
    const pollSettings = async () => {
      try { const s = await apiGet('/settings'); if (!settingsStopped) setSettings(s || {}); }
      catch { /* ignore */ }
      finally { if (!settingsStopped) sTimer = setTimeout(pollSettings, 30000); }
    };
    const onFocus = () => { if (!settingsStopped) pollSettings(); };
    window.addEventListener('focus', onFocus);
    pollSettings();

    return () => {
      unsubs.forEach(u => u());
      settingsStopped = true;
      if (sTimer) clearTimeout(sTimer);
      window.removeEventListener('focus', onFocus);
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
