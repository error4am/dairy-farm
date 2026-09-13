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
import { TransactionForm } from './TransactionForm';
import { api, ApiError } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useData } from '../../lib/DataContext';
import { useToast } from '../../lib/ToastContext';
import { useMeta } from '../../lib/MetaContext';
import { formatDate, formatMoney, monthStartStr, todayStr, weekStartStr } from '../../lib/format';
import { PAYMENT_TYPE_LABELS } from '../../lib/constants';
import type { Animal, FinanceSummary, Paged, Transaction, TxType, WeekStart } from '../../lib/types';

type Preset = 'today' | 'week' | 'month' | 'all' | 'custom';

const LIMIT = 25;

function presetRange(p: Exclude<Preset, 'custom'>, weekStart: WeekStart): { from: string; to: string } {
  const today = todayStr();
  if (p === 'today') return { from: today, to: today };
  if (p === 'week') return { from: weekStartStr(weekStart), to: today };
  if (p === 'month') return { from: monthStartStr(), to: today };
  return { from: '', to: '' };
}

export function FinancesPage() {
  const meta = useMeta();
  const { refresh } = useData();
  const toast = useToast();

  const [preset, setPreset] = useState<Preset>('month');
  const [from, setFrom] = useState(monthStartStr());
  const [to, setTo] = useState(todayStr());
  const [type, setType] = useState('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);

  const [form, setForm] = useState<{ open: boolean; transaction: Transaction | null; defaultType?: TxType }>({
    open: false,
    transaction: null
  });
  const [deleting, setDeleting] = useState<Transaction | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: animals } = useApi<Animal[]>('/animals?sort=tag_number&dir=asc');

  const listPath = useMemo(() => {
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    if (type) q.set('type', type);
    if (category) q.set('category', category);
    if (search) q.set('search', search);
    q.set('limit', String(LIMIT));
    q.set('offset', String(offset));
    return `/transactions?${q.toString()}`;
  }, [from, to, type, category, search, offset]);

  const summaryPath = useMemo(() => {
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    return `/transactions/summary?${q.toString()}`;
  }, [from, to]);

  const { data, loading, error } = useApi<Paged<Transaction>>(listPath);
  const { data: summary } = useApi<FinanceSummary>(summaryPath);

  useEffect(() => {
    setOffset(0);
  }, [from, to, type, category, search]);

  function applyPreset(p: Exclude<Preset, 'custom'>) {
    setPreset(p);
    const r = presetRange(p, meta.farm.week_start);
    setFrom(r.from);
    setTo(r.to);
  }

  function categoryLabel(t: TxType, value: string) {
    const found = meta.categories[t].find((c) => c.value === value);
    return found ? found.label : value;
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.del(`/transactions/${deleting.id}`);
      toast.success('Transaction deleted.');
      refresh();
      setDeleting(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not delete the transaction.');
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<Transaction>[] = [
    { key: 'date', header: 'Date', render: (t) => formatDate(t.date), width: '120px' },
    {
      key: 'type',
      header: 'Type',
      width: '100px',
      render: (t) => <Badge tone={t.type === 'income' ? 'green' : 'red'}>{t.type === 'income' ? 'Income' : 'Expense'}</Badge>
    },
    { key: 'category', header: 'Category', render: (t) => categoryLabel(t.type, t.category) },
    {
      key: 'description',
      header: 'Description',
      render: (t) => <span style={{ color: 'var(--text-2)' }}>{t.description || '—'}</span>
    },
    {
      key: 'animal',
      header: 'Animal',
      render: (t) =>
        t.animal_id ? (
          <Link to={`/animals/${t.animal_id}`}>
            #{t.animal_tag}
            {t.animal_name ? <span style={{ color: 'var(--text-3)' }}> · {t.animal_name}</span> : null}
          </Link>
        ) : (
          <span style={{ color: 'var(--text-3)' }}>—</span>
        )
    },
    {
      key: 'employee',
      header: 'Employee',
      render: (t) =>
        t.employee_id ? (
          <Link to={`/employees/${t.employee_id}`}>
            {t.employee_name}
            {t.payment_type ? (
              <span style={{ color: 'var(--text-3)' }}> · {PAYMENT_TYPE_LABELS[t.payment_type]}</span>
            ) : null}
          </Link>
        ) : (
          <span style={{ color: 'var(--text-3)' }}>—</span>
        )
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      render: (t) => (
        <strong style={{ color: t.type === 'income' ? 'var(--accent)' : 'var(--danger)' }}>
          {t.type === 'income' ? '+' : '−'}
          {formatMoney(t.amount, meta.farm.currency)}
        </strong>
      )
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      width: '90px',
      render: (t) => {
        if (t.employee_id) {
          return (
            <div className="row-actions">
              <Link
                to={`/employees/${t.employee_id}`}
                className="btn btn-ghost btn-icon btn-sm"
                title="Linked to an employee payment — edit it from the employee profile"
              >
                <Icon name="pencil" size={15} />
              </Link>
            </div>
          );
        }
        if (t.health_record_id) {
          return (
            <div className="row-actions">
              <Link
                to="/health"
                className="btn btn-ghost btn-icon btn-sm"
                title="Linked to a health record — edit it from the Health module"
              >
                <Icon name="pencil" size={15} />
              </Link>
            </div>
          );
        }
        return (
          <div className="row-actions">
            <button
              type="button"
              className="btn btn-ghost btn-icon btn-sm"
              title="Edit"
              onClick={() => setForm({ open: true, transaction: t })}
            >
              <Icon name="pencil" size={15} />
            </button>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Delete" onClick={() => setDeleting(t)}>
              <Icon name="trash" size={15} />
            </button>
          </div>
        );
      }
    }
  ];

  const currency = meta.farm.currency;

  return (
    <>
      <PageHeader
        title="Finances"
        subtitle="Track income and expenses."
        actions={
          <>
            <button type="button" className="btn" onClick={() => setForm({ open: true, transaction: null, defaultType: 'expense' })}>
              <Icon name="plus" size={15} /> Add Expense
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setForm({ open: true, transaction: null, defaultType: 'income' })}>
              <Icon name="plus" size={15} /> Add Income
            </button>
          </>
        }
      />

      <div className="period-note">
        {preset === 'all' || (!from && !to)
          ? 'Selected period: all time'
          : `Selected period: ${formatDate(from)} – ${formatDate(to)}`}
      </div>

      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <StatCard
          label="Income"
          value={summary ? formatMoney(summary.range.income, currency) : '—'}
          hint={summary ? `All time: ${formatMoney(summary.all_time.income, currency)}` : undefined}
        />
        <StatCard
          label="Expenses"
          value={summary ? formatMoney(summary.range.expenses, currency) : '—'}
          hint={summary ? `All time: ${formatMoney(summary.all_time.expenses, currency)}` : undefined}
        />
        <StatCard
          label="Net Profit"
          value={summary ? formatMoney(summary.range.net, currency) : '—'}
          tone={summary ? (summary.range.net >= 0 ? 'positive' : 'negative') : undefined}
          hint={summary ? `All time: ${formatMoney(summary.all_time.net, currency)}` : undefined}
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
        <select
          className="select"
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setCategory('');
          }}
          aria-label="Type"
        >
          <option value="">All types</option>
          <option value="income">Income</option>
          <option value="expense">Expense</option>
        </select>
        <select className="select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {(type ? meta.categories[type as TxType] : [...meta.categories.income, ...meta.categories.expense]).map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <input
          type="search"
          className="input search"
          placeholder="Search description, animal, employee…"
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
              rowKey={(t) => t.id}
              loading={loading}
              empty={
                from || to || type || category || search ? (
                  <EmptyState title="No matching transactions" message="Try changing the date range or filters." />
                ) : (
                  <EmptyState
                    title="No transactions yet"
                    message="Add income or expenses to track your farm's profitability."
                    action={
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => setForm({ open: true, transaction: null, defaultType: 'income' })}
                      >
                        <Icon name="plus" size={15} /> Add Income
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

      {summary && summary.by_category.length > 0 ? (
        <div className="card" style={{ marginTop: 20 }}>
          <div className="card-header">
            <div className="card-title">By Category</div>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Selected range</span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Category</th>
                  <th className="num">Transactions</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {summary.by_category.map((c) => (
                  <tr key={c.type + ':' + c.category}>
                    <td>
                      <Badge tone={c.type === 'income' ? 'green' : 'red'}>{c.type === 'income' ? 'Income' : 'Expense'}</Badge>
                    </td>
                    <td>{categoryLabel(c.type, c.category)}</td>
                    <td className="num">{c.count}</td>
                    <td className="num">
                      <strong>{formatMoney(c.amount, currency)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <TransactionForm
        open={form.open}
        initial={form.transaction}
        defaultType={form.defaultType}
        animals={animals ?? []}
        onClose={() => setForm({ open: false, transaction: null })}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="Delete transaction?"
        message={
          deleting
            ? `This will permanently delete the ${deleting.type} of ${formatMoney(deleting.amount, currency)} on ${formatDate(
                deleting.date
              )}${deleting.description ? ` ("${deleting.description}")` : ''}.`
            : ''
        }
        busy={busy}
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}
