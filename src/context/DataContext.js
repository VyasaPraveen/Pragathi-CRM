import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { listenCollection } from '../services/firestore';

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

  useEffect(() => {
    if (!user) return;
    // P1 note: all collections are loaded eagerly for realtime sync.
    // For datasets exceeding ~1000 records, consider route-based lazy subscriptions.
    const unsubs = [
      listenCollection('leads', (d) => d && setLeads(d)),
      listenCollection('customers', (d) => d && setCustomers(d)),
      listenCollection('installations', (d) => d && setInstallations(d)),
      listenCollection('team', (d) => d && setTeam(d)),
      listenCollection('materials', (d) => d && setMaterials(d)),
      listenCollection('ongoingWork', (d) => d && setOngoingWork(d)),
      listenCollection('income', (d) => d && setIncome(d), 'date', 'desc'),
      listenCollection('expenses', (d) => d && setExpenses(d), 'date', 'desc'),
      listenCollection('reminders', (d) => d && setReminders(d)),
      listenCollection('gallery', (d) => d && setGallery(d)),
    ];
    return () => unsubs.forEach(u => u());
  }, [user]);

  return (
    <DataContext.Provider value={{
      leads, customers, installations, team, materials,
      ongoingWork, income, expenses, reminders, gallery
    }}>
      {children}
    </DataContext.Provider>
  );
}
