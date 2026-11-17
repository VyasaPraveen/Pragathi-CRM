import React, { useState, useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { hasAccess, moduleRoute } from '../services/helpers';
import { useData } from '../context/DataContext';
import { markNotificationsRead } from '../services/firestore';
import { notificationsForRoute } from '../services/badges';
import { hasModule } from '../services/permissions';
import { apiPost } from '../services/api';
import { registerPush } from '../services/push';
import { canInstall, onInstallChange, promptInstall, isStandalone, isIOS, installHint, installDismissed, dismissInstall, isOnline } from '../services/pwa';
import DueAlerts from './DueAlerts';

// Each page is its own file, loaded the first time it is opened, so the
// phone downloads only what it needs to show the first screen (the sidebar,
// the dashboard) and the rest as it goes. Dashboard stays in the main bundle
// because it is the first thing everyone sees.
import Dashboard from '../pages/Dashboard';
const Leads = lazy(() => import('../pages/Leads'));
const Customers = lazy(() => import('../pages/Customers'));
const Installations = lazy(() => import('../pages/Installations'));
const OngoingWork = lazy(() => import('../pages/OngoingWork'));
const Materials = lazy(() => import('../pages/Materials'));
const Revenue = lazy(() => import('../pages/Revenue'));
const Expenditure = lazy(() => import('../pages/Expenditure'));
const PaymentRequests = lazy(() => import('../pages/PaymentRequests'));
const Reports = lazy(() => import('../pages/Reports'));
const Team = lazy(() => import('../pages/Team'));
const Reminders = lazy(() => import('../pages/Reminders'));
const About = lazy(() => import('../pages/About'));
const Gallery = lazy(() => import('../pages/Gallery'));
const Settings = lazy(() => import('../pages/Settings'));
const TotalUsers = lazy(() => import('../pages/TotalUsers'));
const PurchaseOrders = lazy(() => import('../pages/PurchaseOrders'));
const Retailers = lazy(() => import('../pages/Retailers'));
const Influencers = lazy(() => import('../pages/Influencers'));
const EmployeeTasks = lazy(() => import('../pages/EmployeeTasks'));
const UserManagement = lazy(() => import('../pages/UserManagement'));
const ActivityLog = lazy(() => import('../pages/ActivityLog'));
const Leave = lazy(() => import('../pages/Leave'));
const Attendance = lazy(() => import('../pages/Attendance'));
const Tracking = lazy(() => import('../pages/Tracking'));
const MyReports = lazy(() => import('../pages/MyReports'));
const AssignedMaterials = lazy(() => import('../pages/AssignedMaterials'));

// Blocks a page when the role floor (`minRole`) or the user's own Admin-managed
// permission (`perm`) does not allow it — the same rules the sidebar uses, so a
// hidden page cannot be reached by typing its URL either.
function GuardedRoute({ minRole, perm, children }) {
  const { role, user } = useAuth();
  if (minRole && !hasAccess(role, minRole)) return <Navigate to="/" replace />;
  if (perm && !hasModule(user, role, perm)) return <Navigate to="/" replace />;
  return children;
}

// While a page's file is on its way.
function PageLoading() {
  return <div className="page-loading" role="status" aria-live="polite"><div className="spin" /><span>Loading…</span></div>;
}

// "Install Pragathi CRM on this phone" — shown until installed or dismissed
// for a week. Android/desktop browsers give a one-tap install; iPhone needs
// Share → Add to Home Screen, so it gets that hint instead.
function InstallBanner() {
  const [installable, setInstallable] = useState(canInstall);
  const [dismissed, setDismissed] = useState(installDismissed);
  useEffect(() => onInstallChange(setInstallable), []);
  const hint = installHint({ installable, standalone: isStandalone(), ios: isIOS(), dismissed });
  if (!hint) return null;
  const notNow = () => { dismissInstall(); setDismissed(true); };
  return (
    <div className="pwa-banner" role="region" aria-label="Install the app">
      <span className="material-icons-round" style={{ fontSize: 22 }}>install_mobile</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong>Install Pragathi CRM on this phone</strong>
        <div className="pwa-sub">{hint === 'ios' ? 'In Safari tap Share, then "Add to Home Screen".' : 'Opens full screen from your home screen, like an app.'}</div>
      </div>
      {hint === 'prompt' && <button className="btn bsm bp" onClick={() => promptInstall().then(r => { if (r === 'dismissed') notNow(); })}>Install</button>}
      <button className="btn bsm bo" onClick={notNow} aria-label="Not now">Not now</button>
    </div>
  );
}

// A temporary password handed out by an Admin has to be replaced before any
// work is done (Req 5.7, 30-Oct). The dialog cannot be dismissed.
function ForcedPasswordChange() {
  const { user, refresh } = useAuth();
  const { toast } = useToast();
  const [pwd, setPwd] = useState('');
  const [again, setAgain] = useState('');
  const [saving, setSaving] = useState(false);
  if (!user || !user.mustChangePassword) return null;
  const submit = async (e) => {
    e.preventDefault();
    if (pwd.length < 6) { toast('Use at least 6 characters', 'er'); return; }
    if (pwd !== again) { toast('The two passwords differ', 'er'); return; }
    setSaving(true);
    try {
      await apiPost('/auth/password', { newPassword: pwd });
      await refresh();
      toast('Password changed — welcome');
    } catch (err) { toast(err.message, 'er'); }
    finally { setSaving(false); }
  };
  return (
    <div className="mo" role="dialog" aria-modal="true" aria-label="Set your password">
      <div className="md" style={{ width: 440, maxWidth: '94vw' }}>
        <div className="mh"><h3>Set your own password</h3></div>
        <form onSubmit={submit}>
          <div className="mb">
            <p style={{ fontSize: '.86rem', marginTop: 0 }}>You signed in with a temporary password. Choose your own to continue.</p>
            <div className="fg"><label>New password</label><input type="password" className="fi" value={pwd} onChange={e => setPwd(e.target.value)} autoFocus autoComplete="new-password" /></div>
            <div className="fg"><label>Again</label><input type="password" className="fi" value={again} onChange={e => setAgain(e.target.value)} autoComplete="new-password" /></div>
          </div>
          <div className="mf"><button type="submit" className="btn bp" disabled={saving}>{saving ? 'Saving…' : 'Save password'}</button></div>
        </form>
      </div>
    </div>
  );
}

// "You are offline" — the data cannot be saved until the connection returns.
function OfflineBar() {
  const [online, setOnline] = useState(isOnline);
  useEffect(() => {
    const up = () => setOnline(true); const down = () => setOnline(false);
    window.addEventListener('online', up); window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  if (online) return null;
  return <div className="offline-bar" role="status"><span className="material-icons-round" style={{ fontSize: 18 }}>cloud_off</span> You are offline — you can read what was already loaded; changes will not save until the connection returns.</div>;
}

export default function AppLayout() {
  const [sbOpen, setSbOpen] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user } = useAuth();
  const { notifications } = useData();

  // A newer version of the app has taken over (deployed while this was open).
  useEffect(() => {
    const onUpdated = () => toast('Pragathi CRM was updated to the latest version — reload when convenient.');
    window.addEventListener('pps:updated', onUpdated);
    return () => window.removeEventListener('pps:updated', onUpdated);
  }, [toast]);

  // Req 7 (27-Oct): opening a section reads its notifications, so the
  // sidebar count for it goes to zero and stays there. Only this person's
  // unread notifications about this route are touched; each is written once.
  const marking = React.useRef(new Set());
  useEffect(() => {
    const due = notificationsForRoute(notifications, user, pathname, moduleRoute).filter(n => !marking.current.has(n.id));
    if (!due.length) return;
    due.forEach(n => marking.current.add(n.id));
    markNotificationsRead(due.map(n => n.id)).finally(() => due.forEach(n => marking.current.delete(n.id)));
  }, [pathname, notifications, user]);

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
        {/* Quotation approvals, sharing deadlines and follow-up reminders */}
        <DueAlerts />
        <OfflineBar />
        <ForcedPasswordChange />
        <div className="pc fin">
          <InstallBanner />
          <Suspense fallback={<PageLoading />}>
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
            <Route path="/settings" element={<GuardedRoute perm="settings"><Settings /></GuardedRoute>} />
            <Route path="/purchase-orders" element={<GuardedRoute perm="purchase_orders"><PurchaseOrders /></GuardedRoute>} />
            <Route path="/assigned-materials" element={<GuardedRoute perm="assigned_materials"><AssignedMaterials /></GuardedRoute>} />
            <Route path="/retailers" element={<GuardedRoute perm="retailers"><Retailers /></GuardedRoute>} />
            <Route path="/influencers" element={<GuardedRoute perm="influencers"><Influencers /></GuardedRoute>} />
            <Route path="/tasks" element={<GuardedRoute perm="tasks"><EmployeeTasks /></GuardedRoute>} />
            <Route path="/leave" element={<GuardedRoute perm="leave"><Leave /></GuardedRoute>} />
            <Route path="/attendance" element={<GuardedRoute perm="attendance"><Attendance /></GuardedRoute>} />
            <Route path="/tracking" element={<GuardedRoute perm="tracking"><Tracking /></GuardedRoute>} />
            <Route path="/my-reports" element={<GuardedRoute perm="my_reports"><MyReports /></GuardedRoute>} />
            <Route path="/users" element={<GuardedRoute minRole="super_admin"><TotalUsers /></GuardedRoute>} />
            <Route path="/user-management" element={<GuardedRoute minRole="admin"><UserManagement /></GuardedRoute>} />
            <Route path="/activity-log" element={<GuardedRoute minRole="operation_manager"><ActivityLog /></GuardedRoute>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
        </div>
      </div>
    </div>
  );
}
