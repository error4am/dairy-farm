import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { api } from '../lib/api';
import { useData } from '../lib/DataContext';
import { formatRelative } from '../lib/format';
import type { Alert } from '../lib/types';

const ACTIVE_LIMIT = 20;

function alertLink(alert: Alert): string {
  if (alert.source_type === 'breeding') return '/breeding';
  if (alert.source_type === 'health') return '/health';
  return `/inventory/${alert.source_id}`;
}

export function AlertsBell() {
  const { version } = useData();
  const navigate = useNavigate();
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const loadCount = useCallback(async () => {
    try {
      const data = await api.get<{ count: number }>('/alerts/unread-count');
      setUnreadCount(data.count);
    } catch {
      /* keep the last known count */
    }
  }, []);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ items: Alert[] }>(`/alerts?status=active&limit=${ACTIVE_LIMIT}`);
      setItems(data.items);
      await loadCount();
    } catch {
      /* panel retries on the next open */
    } finally {
      setLoading(false);
    }
  }, [loadCount]);

  useEffect(() => {
    loadCount();
  }, [version, loadCount]);

  useEffect(() => {
    if (open) loadList();
  }, [open, version, loadList]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const markRead = useCallback(
    async (alert: Alert) => {
      if (alert.status !== 'unread') return;
      try {
        const updated = await api.post<Alert>(`/alerts/${alert.id}/read`, {});
        setItems((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
        await loadCount();
      } catch {
        /* unread count refreshes on the next load */
      }
    },
    [loadCount]
  );

  const dismiss = useCallback(
    async (alert: Alert) => {
      try {
        const updated = await api.post<Alert>(`/alerts/${alert.id}/resolve`, {});
        setItems((prev) => prev.filter((row) => row.id !== updated.id));
        await loadCount();
      } catch {
        /* the row stays until the next load */
      }
    },
    [loadCount]
  );

  const openAlert = useCallback(
    (alert: Alert) => {
      setOpen(false);
      markRead(alert);
      navigate(alertLink(alert));
    },
    [markRead, navigate]
  );

  const badge = unreadCount > 9 ? '9+' : String(unreadCount);

  return (
    <div className="alerts-bell" ref={rootRef}>
      <button
        type="button"
        className="btn btn-ghost btn-icon alerts-toggle"
        aria-label={unreadCount > 0 ? `Alerts (${unreadCount} unread)` : 'Alerts'}
        aria-expanded={open}
        title="Alerts"
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="bell" size={17} />
        {unreadCount > 0 ? <span className="alerts-badge">{badge}</span> : null}
      </button>
      {open ? (
        <div className="alerts-panel" role="dialog" aria-label="Alerts">
          <div className="alerts-head">
            <span>Alerts</span>
            {unreadCount > 0 ? <span className="badge badge-red">{badge} new</span> : null}
          </div>
          {loading && items.length === 0 ? (
            <div className="alerts-empty">Loading…</div>
          ) : items.length === 0 ? (
            <div className="alerts-empty">
              <Icon name="check" size={20} />
              <span>No active alerts right now.</span>
            </div>
          ) : (
            <ul className="alerts-list">
              {items.map((alert) => (
                <li key={alert.id} className={`alert-row${alert.status === 'unread' ? '' : ' is-read'}`}>
                  <button type="button" className="alert-row-open" onClick={() => openAlert(alert)}>
                    <span className={`alert-dot alert-dot-${alert.severity}`} />
                    <span className="alert-row-body">
                      <span className="alert-row-title">{alert.title}</span>
                      <span className="alert-row-msg">{alert.message}</span>
                      <span className="alert-row-time">{formatRelative(alert.created_at)}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon alert-dismiss"
                    title="Dismiss alert"
                    aria-label={`Dismiss alert: ${alert.title}`}
                    onClick={() => dismiss(alert)}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
