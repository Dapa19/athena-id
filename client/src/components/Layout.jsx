import { useState } from 'react';
import { Activity, Building2, CalendarClock, ChevronDown, CircleDollarSign, ContactRound, LayoutDashboard, LogOut, Megaphone, Sparkles, Users } from 'lucide-react';

const items = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'campaigns', label: 'Campaigns', icon: Megaphone },
  { id: 'leads', label: 'Leads', icon: ContactRound },
  { id: 'follow-ups', label: 'Follow-ups', icon: CalendarClock },
  { id: 'transactions', label: 'Transactions', icon: CircleDollarSign }
];
const manageItems = [
  { id: 'branches', label: 'Branches', icon: Building2 },
  { id: 'settings', label: 'Team & settings', icon: Users, adminOnly: true }
];

export function Layout({ user, route, navigate, onLogout, children }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const current = route.split('/')[0];
  const navItem = (item) => (
    <a key={item.id} href={`#${item.id}`} className={`nav-link${current === item.id ? ' active' : ''}`} aria-current={current === item.id ? 'page' : undefined} onClick={(event) => { event.preventDefault(); navigate(item.id); }}>
      <item.icon size={18} strokeWidth={1.9} /><span>{item.label}</span>
    </a>
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand-lockup" href="#overview" onClick={(event) => { event.preventDefault(); navigate('overview'); }}>
          <span className="brand-mark"><Sparkles size={18} /></span><span>Athena<span className="brand-dot">.</span>id</span>
        </a>
        <div className="workspace-label"><span className="workspace-symbol">{user.organizationName?.slice(0, 1) || 'A'}</span><span><strong>{user.organizationName}</strong><small>{user.demoMode ? 'Demo workspace' : 'Clinic workspace'}</small></span></div>
        <div className="nav-label">Workspace</div>
        <nav className="primary-nav" aria-label="Primary navigation">{items.map(navItem)}</nav>
        <div className="nav-label nav-label-management">Manage</div>
        <nav className="primary-nav" aria-label="Management navigation">{manageItems.filter((item) => !item.adminOnly || user.role === 'owner_admin').map(navItem)}</nav>
        <div className="sidebar-bottom">
          {user.demoMode && <div className="demo-notice"><Activity size={16} /><span>Synthetic demo data</span></div>}
          <div className="user-menu-wrap">
            <button className="user-menu" type="button" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
              <span className="user-avatar">{user.displayName?.slice(0, 1) || user.email.slice(0, 1).toUpperCase()}</span>
              <span className="user-copy"><strong>{user.displayName}</strong><small>{user.role.replace('_', ' ')}</small></span>
              <ChevronDown size={15} />
            </button>
            {menuOpen && <div className="user-popover"><button onClick={onLogout}><LogOut size={16} /> Sign out</button></div>}
          </div>
        </div>
      </aside>
      <div className="mobile-nav">
        <a className="brand-lockup" href="#overview" onClick={(event) => { event.preventDefault(); navigate('overview'); }}>
          <span className="brand-mark"><Sparkles size={18} /></span><span>Athena<span className="brand-dot">.</span>id</span>
        </a>
        <label className="mobile-select-label"><span className="sr-only">Navigate workspace</span>
          <select value={current} onChange={(event) => navigate(event.target.value)}>
            {[...items, ...manageItems.filter((item) => !item.adminOnly || user.role === 'owner_admin')].map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <button className="icon-button" type="button" aria-label="Sign out" onClick={onLogout}><LogOut size={18} /></button>
      </div>
      <main className="main-area">
        <header className="topbar">
          <div className="topbar-context"><div className="breadcrumb">{user.organizationName} <span>/</span> <strong>{route.split('/')[0].replace('-', ' ')}</strong></div><div className="topbar-meta">Growth analytics <span className="topbar-divider" /> Asia/Jakarta</div></div>
          <div className="topbar-user"><span className="topbar-role">{user.role === 'owner_admin' ? 'Owner / Admin' : user.role[0].toUpperCase() + user.role.slice(1)}</span><span className="user-avatar topbar-avatar">{user.displayName?.slice(0, 1) || user.email.slice(0, 1).toUpperCase()}</span></div>
        </header>
        <div className="page-container">{children}</div>
      </main>
    </div>
  );
}
