import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { hasAccess } from '../services/helpers';
import { hasModule } from '../services/permissions';
import { registerPush } from '../services/push';

import Dashboard from '../pages/Dashboard';
import Leads from '../pages/Leads';
import Customers from '../pages/Customers';
import Installations from '../pages/Installations';
import OngoingWork from '../pages/OngoingWork';
import Materials from '../pages/Materials';
import Revenue from '../pages/Revenue';
import Expenditure from '../pages/Expenditure';
import PaymentRequests from '../pages/PaymentRequests';
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
import Leave from '../pages/Leave';
import Attendance from '../pages/Attendance';
import Tracking from '../pages/Tracking';
import MyReports from '../pages/MyReports';

// Blocks a page when the role floor (`minRole`) or the user's own Admin-managed
// permission (`perm`) does not allow it — the same rules the sidebar uses, so a
// hidden page cannot be reached by typing its URL either.
function GuardedRoute({ minRole, perm, children }) {
  const { role, user } = useAuth();
  if (minRole && !hasAccess(role, minRole)) return <Navigate to="/" replace />;
  if (perm && !hasModule(user, role, perm)) return <Navigate to="/" replace />;
  return children;
}

export default function AppLayout() {
  const [sbOpen, setSbOpen] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  // When a tapped push cannot navigate this tab itself, the service worker asks
  // the app to route instead. Only in-app paths are accepted.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;
    const onMessage = (e) => {
      const link = e.data && e.data.type === 'pps:navigate' ? e.data.link : null;
      if (typeof link === 'string' && link.startsWith('/') && !link.startsWith('//')) navigate(link);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [navigate]);

  // Register this device for web push once the authenticated shell mounts.
  // No-op until FCM is configured (VAPID key set), so it's safe pre-launch.
  useEffect(() => {
    registerPush((title, body) => toast(`${title}${body ? ' — ' + body : ''}`));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="app">
      <Sidebar open={sbOpen} onClose={() => setSbOpen(false)} />
      <div className="mc">
        <Topbar onMenuClick={() => setSbOpen(!sbOpen)} />
        <div className="pc fin">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/leads" element={<GuardedRoute perm="leads"><Leads /></GuardedRoute>} />
            <Route path="/customers" element={<GuardedRoute perm="customers"><Customers /></GuardedRoute>} />
            <Route path="/installations" element={<GuardedRoute perm="installations"><Installations /></GuardedRoute>} />
            <Route path="/ongoing" element={<GuardedRoute perm="ongoing_work"><OngoingWork /></GuardedRoute>} />
            <Route path="/materials" element={<GuardedRoute perm="materials"><Materials /></GuardedRoute>} />
            <Route path="/revenue" element={<GuardedRoute perm="revenue"><Revenue /></GuardedRoute>} />
            <Route path="/expenditure" element={<GuardedRoute perm="expenditure"><Expenditure /></GuardedRoute>} />
            <Route path="/reports" element={<GuardedRoute minRole="coordinator" perm="reports"><Reports /></GuardedRoute>} />
            <Route path="/payment-requests" element={<GuardedRoute perm="payment_requests"><PaymentRequests /></GuardedRoute>} />
            <Route path="/team" element={<GuardedRoute perm="team"><Team /></GuardedRoute>} />
            <Route path="/reminders" element={<GuardedRoute perm="reminders"><Reminders /></GuardedRoute>} />
            <Route path="/about" element={<GuardedRoute perm="about"><About /></GuardedRoute>} />
            <Route path="/gallery" element={<GuardedRoute perm="gallery"><Gallery /></GuardedRoute>} />
            <Route path="/settings" element={<GuardedRoute minRole="coordinator"><Settings /></GuardedRoute>} />
            <Route path="/purchase-orders" element={<GuardedRoute perm="purchase_orders"><PurchaseOrders /></GuardedRoute>} />
            <Route path="/retailers" element={<GuardedRoute perm="retailers"><Retailers /></GuardedRoute>} />
            <Route path="/influencers" element={<GuardedRoute perm="influencers"><Influencers /></GuardedRoute>} />
            <Route path="/tasks" element={<GuardedRoute perm="tasks"><EmployeeTasks /></GuardedRoute>} />
            <Route path="/leave" element={<GuardedRoute perm="leave"><Leave /></GuardedRoute>} />
            <Route path="/attendance" element={<GuardedRoute perm="attendance"><Attendance /></GuardedRoute>} />
            <Route path="/tracking" element={<GuardedRoute perm="tracking"><Tracking /></GuardedRoute>} />
            <Route path="/my-reports" element={<GuardedRoute perm="my_reports"><MyReports /></GuardedRoute>} />
            <Route path="/user-management" element={<GuardedRoute minRole="admin"><UserManagement /></GuardedRoute>} />
            <Route path="/activity-log" element={<GuardedRoute minRole="admin"><ActivityLog /></GuardedRoute>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
