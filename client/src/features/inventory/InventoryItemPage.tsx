import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { StatCard } from '../../components/StatCard';
import { DataTable, type Column } from '../../components/DataTable';
import { Pagination } from '../../components/Pagination';
import { Badge } from '../../components/Badge';
import { Icon } from '../../components/Icon';
import { EmptyState } from '../../components/EmptyState';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { InventoryItemForm } from './InventoryItemForm';
import { MovementForm } from './MovementForm';
import { api, ApiError } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useData } from '../../lib/DataContext';
import { useToast } from '../../lib/ToastContext';
import { useMeta } from '../../lib/MetaContext';
import { formatDate, formatMoney, formatQuantity } from '../../lib/format';
import { INVENTORY_CATEGORY_LABELS, MOVEMENT_TYPE_LABELS, MOVEMENT_TYPE_TONES } from '../../lib/constants';
import type { InventoryItem, InventoryItemProfile, InventoryMovement, InventoryMovementType, Paged } from '../../lib/types';

const LIMIT = 25;

function itemStatus(item: InventoryItem): { label: string; tone: 'green' | 'gray' | 'amber' | 'red' } {
  if (item.active === 0) return { label: 'Inactive', tone: 'gray' };
  if (item.current_stock <= 0) return { label: 'Out of Stock', tone: 'red' };
  if (item.minimum_stock !== null && item.current_stock <= item.minimum_stock) {
    return { label: 'Low Stock', tone: 'amber' };
  }
  return { label: 'OK', tone: 'green' };
}

function signedQuantity(movement: InventoryMovement): string {
  const sign = movement.quantity < 0 ? '−' : '+';
  return `${sign}${formatQuantity(Math.abs(movement.quantity), movement.unit)}`;
}

export function InventoryItemPage() {
  const { id } = useParams<{ id: string }>();
  const meta = useMeta();
  const { refresh } = useData();
  const toast = useToast();

  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);

  const [editing, setEditing] = useState(false);
  const [movementForm, setMovementForm] = useState<{ open: boolean; movement: InventoryMovement | null }>({
    open: false,
    movement: null
  });
  const [deleting, setDeleting] = useState<InventoryMovement | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: profile, loading, error } = useApi<InventoryItemProfile>(
    id ? `/inventory-items/${id}/profile` : null
  );
  const { data: items } = useApi<InventoryItem[]>('/inventory-items');

  const movementsPath = useMemo(() => {
    const q = new URLSearchParams();
    if (id) q.set('item_id', id);
    if (type) q.set('type', type);
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    q.set('limit', String(LIMIT));
    q.set('offset', String(offset));
    return `/inventory-movements?${q.toString()}`;
  }, [id, type, from, to, offset]);

  const { data: movements, loading: movementsLoading } = useApi<Paged<InventoryMovement>>(movementsPath);

  useEffect(() => {
    setOffset(0);
  }, [type, from, to]);

  if (loading) return <div className="spinner" />;

  if (error || !profile) {
    return (
      <div className="card">
        <div className="card-body">
          <div className="error-box">{error ?? 'Inventory item not found.'}</div>
          <div style={{ marginTop: 14 }}>
            <Link to="/inventory" className="btn">
              <Icon name="chevron-left" size={14} /> Back to Inventory
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const item = profile.item;
  const stock = profile.stock;
  const status = itemStatus(item);

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.del(`/inventory-movements/${deleting.id}`);
      toast.success('Movement deleted.');
      refresh();
      setDeleting(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not delete the movement.');
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<InventoryMovement>[] = [
    { key: 'date', header: 'Date', render: (m) => formatDate(m.date), width: '115px' },
    {
      key: 'type',
      header: 'Type',
      width: '140px',
      render: (m) => <Badge tone={MOVEMENT_TYPE_TONES[m.type]}>{MOVEMENT_TYPE_LABELS[m.type]}</Badge>
    },
    {
      key: 'quantity',
      header: 'Quantity',
      align: 'right',
      render: (m) => (
        <strong style={{ color: m.quantity < 0 ? 'var(--danger)' : 'var(--accent)' }}>{signedQuantity(m)}</strong>
      )
    },
    {
      key: 'unit_cost',
      header: 'Unit Cost',
      align: 'right',
      render: (m) =>
        m.unit_cost != null ? (
          formatMoney(m.unit_cost, meta.farm.currency)
        ) : (
          <span style={{ color: 'var(--text-3)' }}>—</span>
        )
    },
    {
      key: 'total_cost',
      header: 'Total Cost',
      align: 'right',
      render: (m) =>
        m.total_cost != null ? (
          <strong>{formatMoney(m.total_cost, meta.farm.currency)}</strong>
        ) : (
          <span style={{ color: 'var(--text-3)' }}>—</span>
        )
    },
    {
      key: 'supplier',
      header: 'Supplier',
      render: (m) => m.supplier || <span style={{ color: 'var(--text-3)' }}>—</span>
    },
    {
      key: 'notes',
      header: 'Notes',
      render: (m) => <span style={{ color: 'var(--text-3)' }}>{m.notes || '—'}</span>
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      width: '90px',
      render: (m) => (
        <div className="row-actions">
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm"
            title="Edit"
            onClick={() => setMovementForm({ open: true, movement: m })}
          >
            <Icon name="pencil" size={15} />
          </button>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Delete" onClick={() => setDeleting(m)}>
            <Icon name="trash" size={15} />
          </button>
        </div>
      )
    }
  ];

  return (
    <>
      <div style={{ marginBottom: 10 }}>
        <Link to="/inventory" className="btn btn-ghost btn-sm">
          <Icon name="chevron-left" size={14} /> All Inventory
        </Link>
      </div>

      <PageHeader
        title={item.name}
        subtitle={`${INVENTORY_CATEGORY_LABELS[item.category]} · ${item.unit}`}
        actions={
          <>
            <Badge tone={status.tone}>{status.label}</Badge>
            <button type="button" className="btn" onClick={() => setEditing(true)}>
              <Icon name="pencil" size={15} /> Edit Item
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setMovementForm({ open: true, movement: null })}>
              <Icon name="repeat" size={15} /> Record Movement
            </button>
          </>
        }
      />

      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <StatCard label="Current Stock" value={formatQuantity(stock.current, item.unit)} hint={`${stock.movements_count} movements`} />
        <StatCard
          label="Minimum Stock"
          value={item.minimum_stock !== null ? formatQuantity(item.minimum_stock, item.unit) : '—'}
          hint={item.minimum_stock !== null ? 'Low-stock threshold' : 'Not set'}
        />
        <StatCard label="Purchased" value={formatQuantity(stock.purchased, item.unit)} />
        <StatCard label="Consumed" value={formatQuantity(stock.consumed, item.unit)} />
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <div className="card-title">Stock Breakdown</div>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Derived from all movements</span>
        </div>
        <div className="card-body">
          <div className="detail-grid">
            <div>
              <div className="detail-label">Opening Stock</div>
              <div className="detail-value">{formatQuantity(stock.opening, item.unit)}</div>
            </div>
            <div>
              <div className="detail-label">Purchased</div>
              <div className="detail-value">{formatQuantity(stock.purchased, item.unit)}</div>
            </div>
            <div>
              <div className="detail-label">Consumed</div>
              <div className="detail-value">{formatQuantity(stock.consumed, item.unit)}</div>
            </div>
            <div>
              <div className="detail-label">Wasted</div>
              <div className="detail-value">{formatQuantity(stock.wasted, item.unit)}</div>
            </div>
            <div>
              <div className="detail-label">Adjustments</div>
              <div className="detail-value">
                {stock.adjusted > 0 ? '+' : ''}
                {formatQuantity(stock.adjusted, item.unit)}
              </div>
            </div>
            <div>
              <div className="detail-label">Last Movement</div>
              <div className="detail-value">{stock.last_movement_date ? formatDate(stock.last_movement_date) : '—'}</div>
            </div>
          </div>
          {item.notes ? (
            <div style={{ marginTop: 16 }}>
              <div className="detail-label">Notes</div>
              <div className="detail-value" style={{ whiteSpace: 'pre-wrap', color: 'var(--text-2)' }}>
                {item.notes}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="toolbar">
        <select className="select" value={type} onChange={(e) => setType(e.target.value)} aria-label="Movement type">
          <option value="">All movement types</option>
          {(Object.keys(MOVEMENT_TYPE_LABELS) as InventoryMovementType[]).map((t) => (
            <option key={t} value={t}>
              {MOVEMENT_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
        <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">Movement History</div>
        </div>
        <DataTable
          columns={columns}
          rows={movements?.items ?? []}
          rowKey={(m) => m.id}
          loading={movementsLoading}
          empty={
            type || from || to ? (
              <EmptyState title="No matching movements" message="Try changing the filters or date range." />
            ) : (
              <EmptyState
                title="No movements yet"
                message="Record opening stock or a purchase to start the ledger."
                action={
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setMovementForm({ open: true, movement: null })}
                  >
                    <Icon name="repeat" size={15} /> Record Movement
                  </button>
                }
              />
            )
          }
        />
        {movements && movements.total > 0 ? (
          <Pagination total={movements.total} limit={movements.limit} offset={movements.offset} onChange={setOffset} />
        ) : null}
      </div>

      <InventoryItemForm open={editing} initial={item} onClose={() => setEditing(false)} />

      <MovementForm
        open={movementForm.open}
        initial={movementForm.movement}
        defaultItemId={item.id}
        items={items ?? []}
        onClose={() => setMovementForm({ open: false, movement: null })}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="Delete stock movement?"
        message={
          deleting
            ? `This will permanently delete the ${MOVEMENT_TYPE_LABELS[deleting.type]} of ${formatQuantity(
                Math.abs(deleting.quantity),
                deleting.unit
              )} on ${formatDate(deleting.date)}.${
                deleting.transaction_id ? ' The linked Feed expense will also be deleted.' : ''
              }`
            : ''
        }
        busy={busy}
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}
