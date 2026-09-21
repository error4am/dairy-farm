import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { StatCard } from '../../components/StatCard';
import { DataTable, type Column } from '../../components/DataTable';
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
import type { InventoryCategory, InventoryItem, InventoryMovement, InventorySummary, Paged } from '../../lib/types';

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

export function InventoryPage() {
  const { refresh } = useData();
  const toast = useToast();
  const meta = useMeta();
  const [searchParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState(() => searchParams.get('status') || '');

  const [itemForm, setItemForm] = useState<{ open: boolean; item: InventoryItem | null }>({ open: false, item: null });
  const [movementForm, setMovementForm] = useState<{ open: boolean; movement: InventoryMovement | null }>({
    open: false,
    movement: null
  });
  const [deletingItem, setDeletingItem] = useState<InventoryItem | null>(null);
  const [deletingMovement, setDeletingMovement] = useState<InventoryMovement | null>(null);
  const [busy, setBusy] = useState(false);

  const itemsPath = useMemo(() => {
    const q = new URLSearchParams();
    if (search) q.set('search', search);
    if (category) q.set('category', category);
    if (status) q.set('status', status);
    return `/inventory-items?${q.toString()}`;
  }, [search, category, status]);

  const { data: items, loading, error } = useApi<InventoryItem[]>(itemsPath);
  const { data: summary } = useApi<InventorySummary>('/inventory-items/summary');
  const { data: movements } = useApi<Paged<InventoryMovement>>('/inventory-movements?limit=10');

  async function confirmDeleteItem() {
    if (!deletingItem) return;
    setBusy(true);
    try {
      await api.del(`/inventory-items/${deletingItem.id}`);
      toast.success('Item deleted.');
      refresh();
      setDeletingItem(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not delete the item.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteMovement() {
    if (!deletingMovement) return;
    setBusy(true);
    try {
      await api.del(`/inventory-movements/${deletingMovement.id}`);
      toast.success('Movement deleted.');
      refresh();
      setDeletingMovement(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not delete the movement.');
    } finally {
      setBusy(false);
    }
  }

  const itemColumns: Column<InventoryItem>[] = [
    {
      key: 'name',
      header: 'Item',
      render: (i) => (
        <Link to={`/inventory/${i.id}`}>
          <strong>{i.name}</strong>
        </Link>
      )
    },
    { key: 'category', header: 'Category', render: (i) => INVENTORY_CATEGORY_LABELS[i.category] },
    {
      key: 'current',
      header: 'Current Stock',
      align: 'right',
      render: (i) => <strong>{formatQuantity(i.current_stock, i.unit)}</strong>
    },
    {
      key: 'minimum',
      header: 'Minimum',
      align: 'right',
      render: (i) =>
        i.minimum_stock !== null ? (
          formatQuantity(i.minimum_stock, i.unit)
        ) : (
          <span style={{ color: 'var(--text-3)' }}>—</span>
        )
    },
    {
      key: 'status',
      header: 'Status',
      render: (i) => {
        const s = itemStatus(i);
        return <Badge tone={s.tone}>{s.label}</Badge>;
      }
    },
    {
      key: 'last',
      header: 'Last Movement',
      render: (i) =>
        i.last_movement_date ? formatDate(i.last_movement_date) : <span style={{ color: 'var(--text-3)' }}>—</span>
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      width: '120px',
      render: (i) => (
        <div className="row-actions">
          <Link to={`/inventory/${i.id}`} className="btn btn-ghost btn-icon btn-sm" title="View item">
            <Icon name="eye" size={15} />
          </Link>
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm"
            title="Edit"
            onClick={() => setItemForm({ open: true, item: i })}
          >
            <Icon name="pencil" size={15} />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm"
            title={i.movements_count > 0 ? 'Has stock movements — mark inactive instead' : 'Delete'}
            disabled={i.movements_count > 0}
            onClick={() => setDeletingItem(i)}
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
      )
    }
  ];

  const movementColumns: Column<InventoryMovement>[] = [
    { key: 'date', header: 'Date', render: (m) => formatDate(m.date), width: '115px' },
    {
      key: 'item',
      header: 'Item',
      render: (m) => (
        <Link to={`/inventory/${m.item_id}`}>
          {m.item_name}
          <span style={{ color: 'var(--text-3)' }}> · {m.item_unit}</span>
        </Link>
      )
    },
    {
      key: 'type',
      header: 'Type',
      width: '130px',
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
      key: 'cost',
      header: 'Cost',
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
          <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Delete" onClick={() => setDeletingMovement(m)}>
            <Icon name="trash" size={15} />
          </button>
        </div>
      )
    }
  ];

  return (
    <>
      <PageHeader
        title="Inventory"
        subtitle="Track feed, fodder and supply stock from movement history."
        actions={
          <>
            <button type="button" className="btn" onClick={() => setMovementForm({ open: true, movement: null })}>
              <Icon name="repeat" size={15} /> Record Movement
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setItemForm({ open: true, item: null })}>
              <Icon name="plus" size={15} /> Add Item
            </button>
          </>
        }
      />

      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <StatCard label="Active Items" value={summary ? summary.active_count : '—'} />
        <StatCard
          label="Low Stock"
          value={summary ? summary.low_stock_count : '—'}
          hint="At or below minimum"
          onClick={() => setStatus('low')}
        />
        <StatCard
          label="Out of Stock"
          value={summary ? summary.out_of_stock_count : '—'}
          hint="Zero or negative stock"
          onClick={() => setStatus('out')}
        />
      </div>

      <div className="toolbar">
        <input
          type="search"
          className="input search grow"
          placeholder="Search items…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {(Object.keys(INVENTORY_CATEGORY_LABELS) as InventoryCategory[]).map((c) => (
            <option key={c} value={c}>
              {INVENTORY_CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="low">Low stock</option>
          <option value="out">Out of stock</option>
        </select>
      </div>

      <div className="card">
        {error ? (
          <div className="card-body">
            <div className="error-box">{error}</div>
          </div>
        ) : (
          <DataTable
            columns={itemColumns}
            rows={items ?? []}
            rowKey={(i) => i.id}
            loading={loading}
            empty={
              search || category || status ? (
                <EmptyState title="No matching items" message="Try changing the search or filters." />
              ) : (
                <EmptyState
                  title="No inventory items yet"
                  message="Add feed, fodder or supplies to start tracking stock."
                  action={
                    <button type="button" className="btn btn-primary" onClick={() => setItemForm({ open: true, item: null })}>
                      <Icon name="plus" size={15} /> Add Item
                    </button>
                  }
                />
              )
            }
          />
        )}
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <div className="card-header">
          <div className="card-title">Recent Movements</div>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Latest 10</span>
        </div>
        <DataTable
          columns={movementColumns}
          rows={movements?.items ?? []}
          rowKey={(m) => m.id}
          empty={<EmptyState title="No stock movements yet" message="Record opening stock or a purchase to get started." />}
        />
      </div>

      <InventoryItemForm
        open={itemForm.open}
        initial={itemForm.item}
        onClose={() => setItemForm({ open: false, item: null })}
      />

      <MovementForm
        open={movementForm.open}
        initial={movementForm.movement}
        items={items ?? []}
        onClose={() => setMovementForm({ open: false, movement: null })}
      />

      <ConfirmDialog
        open={deletingItem !== null}
        title="Delete inventory item?"
        message={
          deletingItem
            ? `This will permanently delete ${deletingItem.name}. Items with stock movements cannot be deleted — mark them inactive instead.`
            : ''
        }
        busy={busy}
        onConfirm={confirmDeleteItem}
        onClose={() => setDeletingItem(null)}
      />

      <ConfirmDialog
        open={deletingMovement !== null}
        title="Delete stock movement?"
        message={
          deletingMovement
            ? `This will permanently delete the ${MOVEMENT_TYPE_LABELS[deletingMovement.type]} of ${formatQuantity(
                Math.abs(deletingMovement.quantity),
                deletingMovement.unit
              )} for ${deletingMovement.item_name} on ${formatDate(deletingMovement.date)}.${
                deletingMovement.transaction_id ? ' The linked Feed expense will also be deleted.' : ''
              }`
            : ''
        }
        busy={busy}
        onConfirm={confirmDeleteMovement}
        onClose={() => setDeletingMovement(null)}
      />
    </>
  );
}
