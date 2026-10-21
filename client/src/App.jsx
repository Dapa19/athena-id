import { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import { api } from './lib/api.js';
import { Layout } from './components/Layout.jsx';
import { LoadingState } from './components/UI.jsx';
import { LoginPage } from './pages/LoginPage.jsx';
import { OverviewPage } from './pages/OverviewPage.jsx';
import { CampaignsPage } from './pages/CampaignsPage.jsx';
import { LeadsPage } from './pages/LeadsPage.jsx';
import { FollowUpsPage } from './pages/FollowUpsPage.jsx';
import { TransactionsPage } from './pages/TransactionsPage.jsx';
import { BranchesPage } from './pages/BranchesPage.jsx';
import { SettingsPage } from './pages/SettingsPage.jsx';
import { ImportPage } from './pages/ImportPage.jsx';
import { NotFoundPage } from './pages/NotFoundPage.jsx';

function currentRoute() {
  return window.location.hash.replace(/^#\/?/, '') || 'overview';
}

export function App() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [route, setRoute] = useState(currentRoute);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    const updateRoute = () => setRoute(currentRoute());
    window.addEventListener('hashchange', updateRoute);
    if (!window.location.hash) window.location.hash = 'overview';
    api('/api/auth/me').then((result) => setUser(result.user)).catch(() => setUser(null)).finally(() => setAuthChecked(true));
    return () => window.removeEventListener('hashchange', updateRoute);
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function navigate(destination) {
    window.location.hash = destination;
  }

  async function logout() {
    try { await api('/api/auth/logout', { method: 'POST', json: {} }); } catch { /* Expired sessions are already signed out. */ }
    setUser(null);
    navigate('overview');
  }

  if (!authChecked) return <div className="app-loading"><LoadingState label="Opening your workspace…" /></div>;
  if (!user) return <LoginPage onLogin={(nextUser) => { setUser(nextUser); navigate('overview'); }} />;

  const shared = { user, navigate, onUserUpdate: (changes) => setUser((current) => ({ ...current, ...changes })), notify: (message, tone = 'success') => setToast({ message, tone }) };
  const routeRoot = route.split('/')[0];
  let page;
  if (routeRoot === 'overview') page = <OverviewPage {...shared} />;
  else if (routeRoot === 'campaigns') page = <CampaignsPage {...shared} selectedId={route.split('/')[1] || null} />;
  else if (routeRoot === 'leads') page = <LeadsPage {...shared} selectedId={route.split('/')[1] || null} />;
  else if (routeRoot === 'follow-ups') page = <FollowUpsPage {...shared} />;
  else if (routeRoot === 'transactions') page = <TransactionsPage {...shared} />;
  else if (routeRoot === 'branches') page = <BranchesPage {...shared} />;
  else if (routeRoot === 'settings') page = user.role === 'owner_admin' ? <SettingsPage {...shared} /> : <OverviewPage {...shared} />;
  else if (routeRoot === 'import') page = <ImportPage {...shared} type={route.split('/')[1] || 'leads'} />;
  else page = <NotFoundPage {...shared} />;

  return (
    <Layout user={user} route={route} navigate={navigate} onLogout={logout}>
      {page}
      {toast && <div className={`toast toast-${toast.tone}`} role="status"><Check size={17} /><span>{toast.message}</span><button className="toast-close" aria-label="Dismiss notification" onClick={() => setToast(null)}><X size={16} /></button></div>}
    </Layout>
  );
}
