import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { DataTable, type Column } from '../../components/DataTable';
import { Badge } from '../../components/Badge';
import { Icon } from '../../components/Icon';
import { EmptyState } from '../../components/EmptyState';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { AnimalForm } from './AnimalForm';
import { api, ApiError } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useData } from '../../lib/DataContext';
import { useToast } from '../../lib/ToastContext';
import { useMeta } from '../../lib/MetaContext';
import { ANIMAL_STATUS_LABELS, ANIMAL_TYPE_LABELS, GENDER_LABELS, STATUS_TONES } from '../../lib/constants';
import { formatDate, formatQuantity } from '../../lib/format';
import type { Animal } from '../../lib/types';

export function AnimalsPage() {
  const { refresh } = useData();
  const toast = useToast();
  const meta = useMeta();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [sort, setSort] = useState('created_at');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');

  const [form, setForm] = useState<{ open: boolean; animal: Animal | null }>({ open: false, animal: null });
  const [deleting, setDeleting] = useState<Animal | null>(null);
  const [busy, setBusy] = useState(false);

  const path = useMemo(() => {
    const q = new URLSearchParams();
    if (search) q.set('search', search);
    if (status) q.set('status', status);
    if (type) q.set('type', type);
    q.set('sort', sort);
    q.set('dir', dir);
    return `/animals?${q.toString()}`;
  }, [search, status, type, sort, dir]);

  const { data: animals, loading, error } = useApi<Animal[]>(path);

  function onSort(key: string) {
    if (sort === key) {
      setDir(dir === 'asc' ? 'desc' : 'asc');
    } else {
      setSort(key);
      setDir('asc');
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.del(`/animals/${deleting.id}`);
      toast.success('Animal deleted.');
      refresh();
      setDeleting(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not delete the animal.');
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<Animal>[] = [
    {
      key: 'tag',
      header: 'Tag',
      sortKey: 'tag_number',
      width: '110px',
      render: (a) => (
        <Link to={`/animals/${a.id}`}>
          <strong>#{a.tag_number}</strong>
        </Link>
      )
    },
    {
      key: 'name',
      header: 'Name',
      sortKey: 'name',
      render: (a) => a.name || <span style={{ color: 'var(--text-3)' }}>—</span>
    },
    { key: 'type', header: 'Type', sortKey: 'type', render: (a) => ANIMAL_TYPE_LABELS[a.type] },
    {
      key: 'breed',
      header: 'Breed',
      render: (a) => a.breed || <span style={{ color: 'var(--text-3)' }}>—</span>
    },
    { key: 'gender', header: 'Gender', render: (a) => GENDER_LABELS[a.gender] },
    {
      key: 'status',
      header: 'Status',
      sortKey: 'status',
      render: (a) => <Badge tone={STATUS_TONES[a.status]}>{ANIMAL_STATUS_LABELS[a.status]}</Badge>
    },
    {
      key: 'total_milk',
      header: 'Total Milk',
      sortKey: 'total_milk',
      align: 'right',
      render: (a) => <strong>{formatQuantity(a.total_milk ?? 0, meta.farm.milk_unit)}</strong>
    },
    {
      key: 'last_milk',
      header: 'Last Milking',
      sortKey: 'last_milk_date',
      render: (a) => (a.last_milk_date ? formatDate(a.last_milk_date) : <span style={{ color: 'var(--text-3)' }}>—</span>)
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      width: '120px',
      render: (a) => (
        <div className="row-actions">
          <Link to={`/animals/${a.id}`} className="btn btn-ghost btn-icon btn-sm" title="View profile">
            <Icon name="eye" size={15} />
          </Link>
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm"
            title="Edit"
            onClick={() => setForm({ open: true, animal: a })}
          >
            <Icon name="pencil" size={15} />
          </button>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Delete" onClick={() => setDeleting(a)}>
            <Icon name="trash" size={15} />
          </button>
        </div>
      )
    }
  ];

  return (
    <>
      <PageHeader
        title="Animals"
        subtitle="Manage the animals on your farm."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setForm({ open: true, animal: null })}>
            <Icon name="plus" size={15} /> Add Animal
          </button>
        }
      />

      <div className="toolbar">
        <input
          type="search"
          className="input search"
          placeholder="Search tag, name, breed…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="sold">Sold</option>
          <option value="deceased">Deceased</option>
        </select>
        <select className="select" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
          <option value="">All types</option>
          <option value="cow">Cow</option>
          <option value="buffalo">Buffalo</option>
          <option value="other">Other</option>
        </select>
      </div>

      <div className="card">
        {error ? (
          <div className="card-body">
            <div className="error-box">{error}</div>
          </div>
        ) : (
          <DataTable
            columns={columns}
            rows={animals ?? []}
            rowKey={(a) => a.id}
            loading={loading}
            sort={sort}
            dir={dir}
            onSort={onSort}
            empty={
              search || status || type ? (
                <EmptyState title="No matching animals" message="Try changing the search or filters." />
              ) : (
                <EmptyState
                  title="No animals yet"
                  message="Add your first animal to start tracking production and finances."
                  action={
                    <button type="button" className="btn btn-primary" onClick={() => setForm({ open: true, animal: null })}>
                      <Icon name="plus" size={15} /> Add Animal
                    </button>
                  }
                />
              )
            }
          />
        )}
      </div>

      <AnimalForm open={form.open} initial={form.animal} onClose={() => setForm({ open: false, animal: null })} />

      <ConfirmDialog
        open={deleting !== null}
        title="Delete animal?"
        message={
          deleting
            ? `This will permanently delete animal #${deleting.tag_number}${
                deleting.name ? ` (${deleting.name})` : ''
              }. Animals with milk or financial records cannot be deleted — mark them as Sold or Deceased instead.`
            : ''
        }
        busy={busy}
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}
