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
import { MilkForm } from './MilkForm';
import { api, ApiError } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useData } from '../../lib/DataContext';
import { useToast } from '../../lib/ToastContext';
import { useMeta } from '../../lib/MetaContext';
import { formatDate, formatQuantity, monthStartStr, todayStr, weekStartStr } from '../../lib/format';
import { formatCount } from '../../lib/plural.js';
import { SESSION_LABELS } from '../../lib/constants';
import type { Animal, MilkRecord, MilkSummary, Paged, Session, WeekStart } from '../../lib/types';

type Preset = 'today' | 'week' | 'month' | 'all' | 'custom';

const LIMIT = 25;

function presetRange(p: Exclude<Preset, 'custom'>, weekStart: WeekStart): { from: string; to: string } {
  const today = todayStr();
  if (p === 'today') return { from: today, to: today };
  if (p === 'week') return { from: weekStartStr(weekStart), to: today };
  if (p === 'month') return { from: monthStartStr(), to: today };
  return { from: '', to: '' };
}

export function MilkPage() {
  const meta = useMeta();
  const { refresh } = useData();
  const toast = useToast();

  const [preset, setPreset] = useState<Preset>('month');
  const [from, setFrom] = useState(monthStartStr());
  const [to, setTo] = useState(todayStr());
  const [animalId, setAnimalId] = useState('');
  const [session, setSession] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);

  const [modal, setModal] = useState<{ mode: 'create' } | { mode: 'edit'; record: MilkRecord } | null>(null);
  const [deleting, setDeleting] = useState<MilkRecord | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: animals } = useApi<Animal[]>('/animals?sort=tag_number&dir=asc');

  const listPath = useMemo(() => {
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    if (animalId) q.set('animal_id', animalId);
    if (session) q.set('session', session);
    if (search) q.set('search', search);
    q.set('limit', String(LIMIT));
    q.set('offset', String(offset));
    return `/milk-records?${q.toString()}`;
  }, [from, to, animalId, session, search, offset]);

  const summaryPath = useMemo(() => {
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    if (animalId) q.set('animal_id', animalId);
    if (session) q.set('session', session);
    return `/milk-records/summary?${q.toString()}`;
  }, [from, to, animalId, session]);

  const { data, loading, error } = useApi<Paged<MilkRecord>>(listPath);
  const { data: summary } = useApi<MilkSummary>(summaryPath);

  useEffect(() => {
    setOffset(0);
  }, [from, to, animalId, session, search]);

  function applyPreset(p: Exclude<Preset, 'custom'>) {
    setPreset(p);
    const r = presetRange(p, meta.farm.week_start);
    setFrom(r.from);
    setTo(r.to);
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.del(`/milk-records/${deleting.id}`);
      toast.success('Milk record deleted.');
      refresh();
      setDeleting(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not delete the record.');
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<MilkRecord>[] = [
    { key: 'date', header: 'Date', render: (r) => formatDate(r.date), width: '130px' },
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
      key: 'session',
      header: 'Session',
      width: '110px',
      render: (r) => (
        <Badge tone={r.session === 'morning' ? 'blue' : 'amber'}>{SESSION_LABELS[r.session as Session]}</Badge>
      )
    },
    {
      key: 'quantity',
      header: 'Quantity',
      align: 'right',
      render: (r) => <strong>{formatQuantity(r.quantity, r.unit)}</strong>
    },
    {
      key: 'notes',
      header: 'Notes',
      render: (r) => <span style={{ color: 'var(--text-3)' }}>{r.notes || '—'}</span>
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
            onClick={() => setModal({ mode: 'edit', record: r })}
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

  const animalName = (id: number) => {
    const a = animals?.find((x) => x.id === id);
    return a ? `#${a.tag_number}${a.name ? ' · ' + a.name : ''}` : `#${id}`;
  };

  return (
    <>
      <PageHeader
        title="Milk Production"
        subtitle="Record and review daily milk production."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setModal({ mode: 'create' })}>
            <Icon name="plus" size={15} /> Record Milk
          </button>
        }
      />

      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <StatCard
          label="Today"
          value={summary ? formatQuantity(summary.today.total, summary.unit) : '—'}
          hint={
            summary
              ? `Morning ${formatQuantity(summary.today.morning, summary.unit)} · Evening ${formatQuantity(
                  summary.today.evening,
                  summary.unit
                )}`
              : undefined
          }
        />
        <StatCard label="This Week" value={summary ? formatQuantity(summary.week, summary.unit) : '—'} />
        <StatCard label="This Month" value={summary ? formatQuantity(summary.month, summary.unit) : '—'} />
        <StatCard
          label="Selected Range"
          value={summary ? formatQuantity(summary.range.total, summary.unit) : '—'}
          hint={
            summary
              ? `${formatCount(summary.range.records, 'record')} · Morning ${formatQuantity(
                  summary.range.morning,
                  summary.unit
                )} · Evening ${formatQuantity(summary.range.evening, summary.unit)}`
              : undefined
          }
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
        <select className="select" value={animalId} onChange={(e) => setAnimalId(e.target.value)} aria-label="Animal">
          <option value="">All animals</option>
          {(animals ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              #{a.tag_number}
              {a.name ? ` · ${a.name}` : ''}
            </option>
          ))}
        </select>
        <select className="select" value={session} onChange={(e) => setSession(e.target.value)} aria-label="Session">
          <option value="">All sessions</option>
          <option value="morning">Morning</option>
          <option value="evening">Evening</option>
        </select>
        <input
          type="search"
          className="input search grow"
          placeholder="Search animal…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
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
                from || to || animalId || session || search ? (
                  <EmptyState title="No matching records" message="Try changing the date range or filters." />
                ) : (
                  <EmptyState
                    title="No milk records yet"
                    message="Record the first milking session to start tracking production."
                    action={
                      <button type="button" className="btn btn-primary" onClick={() => setModal({ mode: 'create' })}>
                        <Icon name="plus" size={15} /> Record Milk
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

      {summary && (summary.by_animal.length > 0 || summary.by_day.length > 0) ? (
        <div className="grid-2-equal" style={{ marginTop: 20 }}>
          <div className="card">
            <div className="card-header">
              <div className="card-title">Production by Animal</div>
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Selected range</span>
            </div>
            {summary.by_animal.length === 0 ? (
              <EmptyState title="No data" message="No production in the selected range." />
            ) : (
              <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Animal</th>
                      <th className="num">Morning</th>
                      <th className="num">Evening</th>
                      <th className="num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.by_animal.map((a) => (
                      <tr key={a.animal_id}>
                        <td>
                          <Link to={`/animals/${a.animal_id}`}>#{a.tag_number}</Link>
                          {a.name ? <span style={{ color: 'var(--text-3)' }}> · {a.name}</span> : null}
                        </td>
                        <td className="num">{formatQuantity(a.morning, summary.unit)}</td>
                        <td className="num">{formatQuantity(a.evening, summary.unit)}</td>
                        <td className="num">
                          <strong>{formatQuantity(a.total, summary.unit)}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title">Daily Totals</div>
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Selected range</span>
            </div>
            {summary.by_day.length === 0 ? (
              <EmptyState title="No data" message="No production in the selected range." />
            ) : (
              <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th className="num">Morning</th>
                      <th className="num">Evening</th>
                      <th className="num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.by_day.map((d) => (
                      <tr key={d.date}>
                        <td>{formatDate(d.date)}</td>
                        <td className="num">{formatQuantity(d.morning, summary.unit)}</td>
                        <td className="num">{formatQuantity(d.evening, summary.unit)}</td>
                        <td className="num">
                          <strong>{formatQuantity(d.total, summary.unit)}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}

      <MilkForm
        open={modal !== null}
        onClose={() => setModal(null)}
        initial={modal?.mode === 'edit' ? modal.record : null}
        animals={animals ?? []}
        defaultUnit={meta.farm.milk_unit}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="Delete milk record?"
        message={
          deleting
            ? `This will permanently delete the ${SESSION_LABELS[deleting.session as Session]} record of ${formatQuantity(
                deleting.quantity,
                deleting.unit
              )} for animal ${animalName(deleting.animal_id)} on ${formatDate(deleting.date)}.`
            : ''
        }
        busy={busy}
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}
