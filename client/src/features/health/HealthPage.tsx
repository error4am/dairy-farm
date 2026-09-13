import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { StatCard } from '../../components/StatCard';
import { DataTable, type Column } from '../../components/DataTable';
import { Pagination } from '../../components/Pagination';
import { Badge } from '../../components/Badge';
import { Icon } from '../../components/Icon';
import { EmptyState } from '../../components/EmptyState';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { HealthForm } from './HealthForm';
import { api, ApiError } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useData } from '../../lib/DataContext';
import { useToast } from '../../lib/ToastContext';
import { useMeta } from '../../lib/MetaContext';
import { formatDate, formatMoney } from '../../lib/format';
import { HEALTH_TYPE_LABELS, HEALTH_TYPE_TONES } from '../../lib/constants';
import type { Animal, HealthRecord, HealthSummary, HealthType, Paged } from '../../lib/types';

type Preset = 'today' | 'week' | 'month' | 'all' | 'custom';

const LIMIT = 25;

export function HealthPage() {
  const meta = useMeta();
  const { refresh } = useData();
  const toast = useToast();

  const [preset, setPreset] = useState<Preset>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [type, setType] = useState('');
  const [animalId, setAnimalId] = useState('');
  const [search, setSearch] = useState('');
  const [dueSoon, setDueSoon] = useState(false);
  const [withdrawalActive, setWithdrawalActive] = useState(false);
  const [offset, setOffset] = useState(0);

  const [form, setForm] = useState<{ open: boolean; record: HealthRecord | null }>({ open: false, record: null });
  const [deleting, setDeleting] = useState<HealthRecord | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: animals } = useApi<Animal[]>('/animals?sort=tag_number&dir=asc');

  const listPath = useMemo(() => {
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    if (type) q.set('type', type);
    if (animalId) q.set('animal_id', animalId);
    if (search) q.set('search', search);
    if (dueSoon) q.set('due', 'soon');
    if (withdrawalActive) q.set('withdrawal', 'active');
    q.set('limit', String(LIMIT));
    q.set('offset', String(offset));
    return `/health-records?${q.toString()}`;
  }, [from, to, type, animalId, search, dueSoon, withdrawalActive, offset]);

  const { data, loading, error } = useApi<Paged<HealthRecord>>(listPath);
  const { data: summary } = useApi<HealthSummary>('/health-records/summary');

  useEffect(() => {
    setOffset(0);
  }, [from, to, type, animalId, search, dueSoon, withdrawalActive]);

  function applyPreset(p: Exclude<Preset, 'custom'>) {
    setPreset(p);
    const today = new Date();
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (p === 'today') {
      setFrom(fmt(today));
      setTo(fmt(today));
    } else if (p === 'week') {
      const start = new Date(today);
      const offsetDays = meta.farm.week_start === 'sunday' ? start.getDay() : (start.getDay() + 6) % 7;
      start.setDate(start.getDate() - offsetDays);
      setFrom(fmt(start));
      setTo(fmt(today));
    } else if (p === 'month') {
      setFrom(fmt(new Date(today.getFullYear(), today.getMonth(), 1)));
      setTo(fmt(today));
    } else {
      setFrom('');
      setTo('');
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.del(`/health-records/${deleting.id}`);
      toast.success('Health record deleted.');
      refresh();
      setDeleting(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not delete the health record.');
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<HealthRecord>[] = [
    { key: 'date', header: 'Date', render: (r) => formatDate(r.date), width: '115px' },
    {
      key: 'animal',
      header: 'Animal',
      render: (r) => (
        <Link to={`/animals/${r.animal_id}`}>
          #{r.animal_tag}
          {r.animal_name ? <span style={{ color: 'var(--text-3)' }}> · {r.animal_name}</span> : null}
        </Link>
      )
    },
    {
      key: 'type',
      header: 'Type',
      width: '110px',
      render: (r) => <Badge tone={HEALTH_TYPE_TONES[r.type]}>{HEALTH_TYPE_LABELS[r.type]}</Badge>
    },
    { key: 'condition', header: 'Condition', render: (r) => r.condition || <span style={{ color: 'var(--text-3)' }}>—</span> },
    {
      key: 'medicine',
      header: 'Medicine',
      render: (r) =>
        r.medicine ? (
          <span>
            {r.medicine}
            {r.dosage ? <span style={{ color: 'var(--text-3)' }}> · {r.dosage}</span> : null}
          </span>
        ) : (
          <span style={{ color: 'var(--text-3)' }}>—</span>
        )
    },
    {
      key: 'vet',
      header: 'Vet',
      render: (r) => r.vet_name || <span style={{ color: 'var(--text-3)' }}>—</span>
    },
    {
      key: 'withdrawal',
      header: 'Withdrawal Until',
      render: (r) =>
        r.withdrawal_until ? (
          <Badge tone="amber">{formatDate(r.withdrawal_until)}</Badge>
        ) : (
          <span style={{ color: 'var(--text-3)' }}>—</span>
        )
    },
    {
      key: 'next_due',
      header: 'Next Due',
      render: (r) =>
        r.next_due_date ? (
          <Badge tone="blue">{formatDate(r.next_due_date)}</Badge>
        ) : (
          <span style={{ color: 'var(--text-3)' }}>—</span>
        )
    },
    {
      key: 'cost',
      header: 'Cost',
      align: 'right',
      render: (r) =>
        r.cost != null ? <strong>{formatMoney(r.cost, meta.farm.currency)}</strong> : <span style={{ color: 'var(--text-3)' }}>—</span>
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      width: '90px',
      render: (r) => (
        <div className="row-actions">
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm"
            title="Edit"
            onClick={() => setForm({ open: true, record: r })}
          >
            <Icon name="pencil" size={15} />
          </button>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Delete" onClick={() => setDeleting(r)}>
            <Icon name="trash" size={15} />
          </button>
        </div>
      )
    }
  ];

  return (
    <>
      <PageHeader
        title="Health"
        subtitle="Vaccinations, treatments and veterinary records."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setForm({ open: true, record: null })}>
            <Icon name="plus" size={15} /> Add Health Record
          </button>
        }
      />

      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <StatCard label="Events This Month" value={summary ? summary.events_this_month : '—'} />
        <StatCard
          label="Due Soon (30 days)"
          value={summary ? summary.due_soon_count : '—'}
          hint={summary && summary.due_soon[0] ? `Next: #${summary.due_soon[0].tag_number} on ${formatDate(summary.due_soon[0].next_due_date)}` : undefined}
          onClick={() => {
            setDueSoon(true);
            setWithdrawalActive(false);
          }}
        />
        <StatCard
          label="Under Withdrawal"
          value={summary ? summary.withdrawal_count : '—'}
          hint={
            summary && summary.withdrawals[0]
              ? `#${summary.withdrawals[0].tag_number} until ${formatDate(summary.withdrawals[0].withdrawal_until)}`
              : 'No milk restrictions'
          }
          onClick={() => {
            setWithdrawalActive(true);
            setDueSoon(false);
          }}
        />
      </div>

      <div className="toolbar">
        <div className="segmented">
          {(['today', 'week', 'month', 'all'] as const).map((p) => (
            <button key={p} type="button" className={preset === p ? 'active' : ''} onClick={() => applyPreset(p)}>
              {p === 'today' ? 'Today' : p === 'week' ? 'This Week' : p === 'month' ? 'This Month' : 'All Time'}
            </button>
          ))}
        </div>
        <input
          type="date"
          className="input"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setPreset('custom');
          }}
          aria-label="From date"
        />
        <input
          type="date"
          className="input"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setPreset('custom');
          }}
          aria-label="To date"
        />
        <select className="select" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
          <option value="">All types</option>
          {(Object.keys(HEALTH_TYPE_LABELS) as HealthType[]).map((t) => (
            <option key={t} value={t}>
              {HEALTH_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <select className="select" value={animalId} onChange={(e) => setAnimalId(e.target.value)} aria-label="Animal">
          <option value="">All animals</option>
          {(animals ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              #{a.tag_number}
              {a.name ? ` · ${a.name}` : ''}
            </option>
          ))}
        </select>
        <input
          type="search"
          className="input search"
          placeholder="Search condition, medicine, vet…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          type="button"
          className={`btn${dueSoon ? ' btn-primary' : ''}`}
          onClick={() => {
            setDueSoon((v) => !v);
            setWithdrawalActive(false);
          }}
          title="Show records with a due date in the next 30 days"
        >
          Due Soon
        </button>
        <button
          type="button"
          className={`btn${withdrawalActive ? ' btn-primary' : ''}`}
          onClick={() => {
            setWithdrawalActive((v) => !v);
            setDueSoon(false);
          }}
          title="Show animals whose milk is still under withdrawal"
        >
          Withdrawal
        </button>
      </div>

      <div className="card">
        {error ? (
          <div className="card-body">
            <div className="error-box">{error}</div>
          </div>
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={data?.items ?? []}
              rowKey={(r) => r.id}
              loading={loading}
              empty={
                withdrawalActive ? (
                  <EmptyState
                    title="No active withdrawals"
                    message="No animals are under withdrawal right now. Milk recording is unrestricted."
                  />
                ) : from || to || type || animalId || search || dueSoon ? (
                  <EmptyState title="No matching health records" message="Try changing the filters or date range." />
                ) : (
                  <EmptyState
                    title="No health records yet"
                    message="Record vaccinations, treatments and vet visits to build each animal's health history."
                    action={
                      <button type="button" className="btn btn-primary" onClick={() => setForm({ open: true, record: null })}>
                        <Icon name="plus" size={15} /> Add Health Record
                      </button>
                    }
                  />
                )
              }
            />
            {data && data.total > 0 ? (
              <Pagination total={data.total} limit={data.limit} offset={data.offset} onChange={setOffset} />
            ) : null}
          </>
        )}
      </div>

      <HealthForm
        open={form.open}
        initial={form.record}
        animals={animals ?? []}
        onClose={() => setForm({ open: false, record: null })}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="Delete health record?"
        message={
          deleting
            ? `This will permanently delete the ${HEALTH_TYPE_LABELS[deleting.type]} record for animal #${
                deleting.animal_tag
              } on ${formatDate(deleting.date)}.${
                deleting.cost != null ? ' The linked Medicine expense will also be deleted.' : ''
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
