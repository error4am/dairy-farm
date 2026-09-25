import { Icon } from '../components/Icon';
import { useMeta } from '../lib/MetaContext';
import { useAuth } from '../lib/AuthContext';

export function Topbar({ onMenu, onRecordMilk }: { onMenu: () => void; onRecordMilk: () => void }) {
  const meta = useMeta();
  const auth = useAuth();
  const today = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(new Date());

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button type="button" className="btn btn-ghost btn-icon mobile-menu-btn" onClick={onMenu} aria-label="Open menu">
          <Icon name="menu" size={18} />
        </button>
        <span className="topbar-farm">{meta.farm.name}</span>
      </div>
      <div className="topbar-right">
        <span className="topbar-date">{today}</span>
        <button type="button" className="btn btn-primary btn-sm" onClick={onRecordMilk}>
          <Icon name="plus" size={15} /> Record Milk
        </button>
        {auth.authEnabled ? (
          <div className="topbar-user">
            <span className="topbar-user-name">{auth.user?.name ?? ''}</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => auth.logout()}
              title="Sign out"
            >
              Logout
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
