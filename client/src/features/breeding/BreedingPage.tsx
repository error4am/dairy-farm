import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { StatCard } from '../../components/StatCard';
import { DataTable, type Column } from '../../components/DataTable';
import { Pagination } from '../../components/Pagination';
import { Badge } from '../../components/Badge';
import { Icon } from '../../components/Icon';
import { EmptyState } from '../../components/EmptyState';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Modal } from '../../components/Modal';
import { BreedingForm } from './BreedingForm';
import { api, ApiError } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useData } from '../../lib/DataContext';
import { useToast } from '../../lib/ToastContext';
import { useMeta } from '../../lib/MetaContext';
import { formatDate } from '../../lib/format';
import {
  CALVING_OUTCOME_LABELS,
  CALVING_OUTCOME_TONES,
  PREGNANCY_RESULT_LABELS,
  PREGNANCY_RESULT_TONES,
  SERVICE_METHOD_LABELS
} from '../../lib/constants';
import type { Animal, BreedingRecord, BreedingSummary, Paged, PregnancyResult, ServiceMethod } from '../../lib/types';

type Preset = 'today' | 'week' | 'month' | 'all' | 'custom';

const LIMIT = 25;

function fmt(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function BreedingPage() {
  const meta = useMeta();
  const { refresh } = useData();
  const toast = useToast();

  const [preset, setPreset] = useState<Preset>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [animalId, setAnimalId] = useState('');
  const [searchParams] = useSearchParams();
  const [result, setResult] = useState(() => (searchParams.get('filter') === 'pregnant' ? 'pregnant' : ''));
  const [method, setMethod] = useState('');
  const [dueSoon, setDueSoon] = useState(() => searchParams.get('filter') === 'calving');
  const [pendingChecks, setPendingChecks] = useState(() => searchParams.get('filter') === 'pending');
  const [offset, setOffset] = useState(0);

  const [form, setForm] = useState<{ open: boolean; record: BreedingRecord | null }>({ open: false, record: null });
  const [viewing, setViewing] = useState<BreedingRecord | null>(null);
  const [deleting, setDeleting] = useState<BreedingRecord | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: animals } = useApi<Animal[]>('/animals?sort=tag_number&dir=asc');

  const listPath = useMemo(() => {
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    if (animalId) q.set('animal_id', animalId);
    if (result) q.set('pregnancy_result', result);
    if (method) q.set('service_method', method);
    if (dueSoon) q.set('due', 'soon');
    if (pendingChecks) q.set('pending_checks', '1');
    q.set('limit', String(LIMIT));
    q.set('offset', String(offset));
    return `/breeding-records?${q.toString()}`;
  }, [from, to, animalId, result, method, dueSoon, pendingChecks, offset]);

  const { data, loading, error } = useApi<Paged<BreedingRecord>>(listPath);
  const { data: summary } = useApi<BreedingSummary>('/breeding-records/summary');

  useEffect(() => {
    setOffset(0);
  }, [from, to, animalId, result, method, dueSoon, pendingChecks]);

  function applyPreset(p: Exclude<Preset, 'custom'>) {
    setPreset(p);
    const today = new Date();
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
      await api.del(`/breeding-records/${deleting.id}`);
      toast.success('Breeding record deleted.');
      refresh();
      setDeleting(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not delete the breeding record.');
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<BreedingRecord>[] = [
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
      key: 'heat',
      header: 'Heat Date',
      render: (r) => (r.heat_date ? formatDate(r.heat_date) : <span style={{ color: 'var(--text-3)' }}>—</span>)
    },
    {
      key: 'service',
      header: 'Service Date',
      render: (r) => (r.service_date ? formatDate(r.service_date) : <span style={{ color: 'var(--text-3)' }}>—</span>)
    },
    {
      key: 'method',
      header: 'Method',
      render: (r) =>
        r.service_method ? (
          SERVICE_METHOD_LABELS[r.service_method as ServiceMethod]
        ) : (
          <span style={{ color: 'var(--text-3)' }}>—</span>
        )
    },
    {
      key: 'pregnancy',
      header: 'Pregnancy',
      render: (r) => (
        <Badge tone={PREGNANCY_RESULT_TONES[r.pregnancy_result]}>{PREGNANCY_RESULT_LABELS[r.pregnancy_result]}</Badge>
      )
    },
    {
      key: 'expected',
      header: 'Expected Calving',
      render: (r) =>
        r.expected_calving_date ? (
          <span>
            {formatDate(r.expected_calving_date)}
            {r.expected_calving_estimated === 1 ? (
              <span style={{ color: 'var(--text-3)', fontSize: 11.5 }}> est.</span>
            ) : null}
          </span>
        ) : (
          <span style={{ color: 'var(--text-3)' }}>—</span>
        )
    },
    {
      key: 'actual',
      header: 'Actual Calving',
      render: (r) => (r.actual_calving_date ? formatDate(r.actual_calving_date) : <span style={{ color: 'var(--text-3)' }}>—</span>)
    },
    {
      key: 'outcome',
      header: 'Outcome',
      render: (r) => <Badge tone={CALVING_OUTCOME_TONES[r.calving_outcome]}>{CALVING_OUTCOME_LABELS[r.calving_outcome]}</Badge>
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      width: '120px',
      render: (r) => (
        <div className="row-actions">
          <button type="button" className="btn btn-ghost btn-icon btn-sm" title="View" onClick={() => setViewing(r)}>
            <Icon name="eye" size={15} />
          </button>
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

  const detail = (label: string, value: ReactNode) => (
    <div>
      <div className="detail-label">{label}</div>
      <div className="detail-value">{value ?? '—'}</div>
    </div>
  );

  return (
    <>
      <PageHeader
        title="Breeding"
        subtitle="Heat, service, pregnancy and calving records."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setForm({ open: true, record: null })}>
            <Icon name="plus" size={15} /> Add Breeding Record
          </button>
        }
      />

      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <StatCard
          label="Currently Pregnant"
          value={summary ? summary.currently_pregnant_count : '—'}
          hint={
            summary && summary.currently_pregnant[0]
              ? `#${summary.currently_pregnant[0].animal_tag} due ${formatDate(summary.currently_pregnant[0].expected_calving_date)}`
              : 'No confirmed pregnancies'
          }
          onClick={() => {
            setResult('pregnant');
            setDueSoon(false);
            setPendingChecks(false);
          }}
        />
        <StatCard
          label="Calving Soon (30 days)"
          value={summary ? summary.calving_soon_count : '—'}
          hint={
            summary && summary.calving_soon[0]
              ? `#${summary.calving_soon[0].animal_tag} on ${formatDate(summary.calving_soon[0].expected_calving_date)}`
              : 'Nothing due in 30 days'
          }
          onClick={() => {
            setDueSoon(true);
            setPendingChecks(false);
            setResult('');
          }}
        />
        <StatCard
          label="Pending Checks"
          value={summary ? summary.pending_checks_count : '—'}
          hint="Serviced, awaiting pregnancy result"
          onClick={() => {
            setPendingChecks(true);
            setDueSoon(false);
            setResult('');
          }}
        />
        <StatCard label="Events This Month" value={summary ? summary.events_this_month : '—'} />
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
        <select
          className="select"
          value={result}
          onChange={(e) => setResult(e.target.value)}
          aria-label="Pregnancy result"
        >
          <option value="">All pregnancy statuses</option>
          {(Object.keys(PREGNANCY_RESULT_LABELS) as PregnancyResult[]).map((r) => (
            <option key={r} value={r}>
              {PREGNANCY_RESULT_LABELS[r]}
            </option>
          ))}
        </select>
        <select className="select" value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Service method">
          <option value="">All methods</option>
          {(Object.keys(SERVICE_METHOD_LABELS) as ServiceMethod[]).map((m) => (
            <option key={m} value={m}>
              {SERVICE_METHOD_LABELS[m]}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={`btn${dueSoon ? ' btn-primary' : ''}`}
          onClick={() => {
            setDueSoon((v) => !v);
            setPendingChecks(false);
          }}
          title="Show pregnancies expected to calve within 30 days"
        >
          Due Soon
        </button>
        <button
          type="button"
          className={`btn${pendingChecks ? ' btn-primary' : ''}`}
          onClick={() => {
            setPendingChecks((v) => !v);
            setDueSoon(false);
          }}
          title="Show serviced animals awaiting a pregnancy result"
        >
          Pending Checks
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
                dueSoon ? (
                  <EmptyState title="No upcoming calvings" message="No confirmed pregnancy is expected to calve within 30 days." />
                ) : pendingChecks ? (
                  <EmptyState title="No pending checks" message="Every serviced animal has a pregnancy result recorded." />
                ) : from || to || animalId || result || method ? (
                  <EmptyState title="No matching breeding records" message="Try changing the filters or date range." />
                ) : (
                  <EmptyState
                    title="No breeding records yet"
                    message="Record heat, service and pregnancy checks to track each animal's reproductive cycle."
                    action={
                      <button type="button" className="btn btn-primary" onClick={() => setForm({ open: true, record: null })}>
                        <Icon name="plus" size={15} /> Add Breeding Record
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

      <BreedingForm
        open={form.open}
        initial={form.record}
        animals={animals ?? []}
        onClose={() => setForm({ open: false, record: null })}
      />

      <Modal open={viewing !== null} onClose={() => setViewing(null)} title={viewing ? `Breeding — #${viewing.animal_tag}` : ''}>
        {viewing ? (
          <div className="detail-grid">
            {detail('Animal', `#${viewing.animal_tag}${viewing.animal_name ? ' · ' + viewing.animal_name : ''}`)}
            {detail('Heat Date', formatDate(viewing.heat_date))}
            {detail('Service Date', formatDate(viewing.service_date))}
            {detail('Service Method', viewing.service_method ? SERVICE_METHOD_LABELS[viewing.service_method] : '—')}
            {detail('Sire / Bull', viewing.sire_info || '—')}
            {detail('Pregnancy Check', formatDate(viewing.pregnancy_check_date))}
            {
              detail(
                'Pregnancy Result',
                <Badge tone={PREGNANCY_RESULT_TONES[viewing.pregnancy_result]}>
                  {PREGNANCY_RESULT_LABELS[viewing.pregnancy_result]}
                </Badge>
              )
            }
            {
              detail(
                'Expected Calving',
                viewing.expected_calving_date
                  ? `${formatDate(viewing.expected_calving_date)}${viewing.expected_calving_estimated === 1 ? ' (estimated)' : ''}`
                  : '—'
              )
            }
            {detail('Actual Calving', formatDate(viewing.actual_calving_date))}
            {
              detail(
                'Calving Outcome',
                <Badge tone={CALVING_OUTCOME_TONES[viewing.calving_outcome]}>
                  {CALVING_OUTCOME_LABELS[viewing.calving_outcome]}
                </Badge>
              )
            }
            {detail('Offspring', viewing.offspring_count != null ? viewing.offspring_count : '—')}
            {detail('Notes', viewing.notes || '—')}
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete breeding record?"
        message={
          deleting
            ? `This will permanently delete the breeding record for animal #${deleting.animal_tag} (service ${
                deleting.service_date ? formatDate(deleting.service_date) : 'not recorded'
              }). This cannot be undone.`
            : ''
        }
        busy={busy}
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}
