import { NavLink } from 'react-router-dom';
import { Icon, type IconName } from '../components/Icon';
import { useMeta } from '../lib/MetaContext';

const NAV: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
  { to: '/animals', label: 'Animals', icon: 'tag' },
  { to: '/health', label: 'Health', icon: 'activity' },
  { to: '/milk', label: 'Milk Production', icon: 'droplet' },
  { to: '/finances', label: 'Finances', icon: 'dollar' },
  { to: '/settings', label: 'Settings', icon: 'settings' }
];

export function Sidebar({ open }: { open: boolean }) {
  const meta = useMeta();

  return (
    <aside className={`sidebar${open ? ' open' : ''}`}>
      <div className="brand">
        <div className="brand-mark">
          <Icon name="droplet" size={17} />
        </div>
        <div>
          <div className="brand-name">Dairy Manager</div>
          <div className="brand-sub">{meta.farm.name}</div>
        </div>
      </div>
      <nav className="nav">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            <Icon name={item.icon} size={17} />
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-foot">Phase 2.1 · Health module</div>
    </aside>
  );
}
