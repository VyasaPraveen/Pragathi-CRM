import React, { useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { useAuth } from '../context/AuthContext';
import { hasAccess } from '../services/helpers';

import Dashboard from '../pages/Dashboard';
import Leads from '../pages/Leads';
import Customers from '../pages/Customers';
import Installations from '../pages/Installations';
import OngoingWork from '../pages/OngoingWork';
import Materials from '../pages/Materials';
import Revenue from '../pages/Revenue';
import Reports from '../pages/Reports';
import Team from '../pages/Team';
import Reminders from '../pages/Reminders';
import About from '../pages/About';
import Gallery from '../pages/Gallery';
import Settings from '../pages/Settings';
import PurchaseOrders from '../pages/PurchaseOrders';
import Retailers from '../pages/Retailers';
import Influencers from '../pages/Influencers';
import EmployeeTasks from '../pages/EmployeeTasks';
import UserManagement from '../pages/UserManagement';
import ActivityLog from '../pages/ActivityLog';

function GuardedRoute({ minRole, children }) {
  const { role } = useAuth();
  if (!hasAccess(role, minRole)) return <Navigate to="/" replace />;
  return children;
}

export default function AppLayout() {
  const [sbOpen, setSbOpen] = useState(false);

  return (
    <div className="app">
      <Sidebar open={sbOpen} onClose={() => setSbOpen(false)} />
      <div className="mc">
        <Topbar onMenuClick={() => setSbOpen(!sbOpen)} />
        <div className="pc fin">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/leads" element={<Leads />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/installations" element={<Installations />} />
            <Route path="/ongoing" element={<OngoingWork />} />
            <Route path="/materials" element={<Materials />} />
            <Route path="/revenue" element={<Revenue />} />
            <Route path="/reports" element={<GuardedRoute minRole="coordinator"><Reports /></GuardedRoute>} />
            <Route path="/team" element={<Team />} />
            <Route path="/reminders" element={<Reminders />} />
            <Route path="/about" element={<About />} />
            <Route path="/gallery" element={<Gallery />} />
            <Route path="/settings" element={<GuardedRoute minRole="coordinator"><Settings /></GuardedRoute>} />
            <Route path="/purchase-orders" element={<PurchaseOrders />} />
            <Route path="/retailers" element={<Retailers />} />
            <Route path="/influencers" element={<Influencers />} />
            <Route path="/tasks" element={<EmployeeTasks />} />
            <Route path="/user-management" element={<GuardedRoute minRole="admin"><UserManagement /></GuardedRoute>} />
            <Route path="/activity-log" element={<GuardedRoute minRole="admin"><ActivityLog /></GuardedRoute>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
