import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../../components/PageHeader';
import { StatCard } from '../../components/StatCard';
import { DataTable, type Column } from '../../components/DataTable';
import { Pagination } from '../../components/Pagination';
import { Badge } from '../../components/Badge';
import { Icon } from '../../components/Icon';
import { EmptyState } from '../../components/EmptyState';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { SaleForm } from './SaleForm';
import { PriceForm } from './PriceForm';
import { api, ApiError } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useData } from '../../lib/DataContext';
import { useToast } from '../../lib/ToastContext';
import { useMeta } from '../../lib/MetaContext';
import { formatDate, formatMoney, formatQuantity, monthStartStr, todayStr, weekStartStr } from '../../lib/format';
import type { MilkPrice, MilkSale, MilkSaleSummary, Paged, WeekStart } from '../../lib/types';

type Preset = 'today' | 'week' | 'month' | 'all' | 'custom';

const LIMIT = 25;

function presetRange(p: Exclude<Preset, 'custom'>, weekStart: WeekStart): { from: string; to: string } {
  const today = todayStr();
  if (p === 'today') return { from: today, to: today };
  if (p === 'week') return { from: weekStartStr(weekStart), to: today };
  if (p === 'month') return { from: monthStartStr(), to: today };
  return { from: '', to: '' };
}

export function MilkSalesPage() {
  const meta = useMeta();
  const { refresh } = useData();
  const toast = useToast();

  const [preset, setPreset] = useState<Preset>('month');
  const [from, setFrom] = useState(monthStartStr());
  const [to, setTo] = useState(todayStr());
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);

  const [saleModal, setSaleModal] = useState<{ mode: 'create' } | { mode: 'edit'; sale: MilkSale } | null>(null);
  const [priceModal, setPriceModal] = useState<{ mode: 'create' } | { mode: 'edit'; price: MilkPrice } | null>(null);
  const [deletingSale, setDeletingSale] = useState<MilkSale | null>(null);
  const [deletingPrice, setDeletingPrice] = useState<MilkPrice | null>(null);
  const [busy, setBusy] = useState(false);

  const listPath = useMemo(() => {
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    if (search) q.set('search', search);
    q.set('limit', String(LIMIT));
    q.set('offset', String(offset));
    return `/milk-sales?${q.toString()}`;
  }, [from, to, search, offset]);

  const summaryPath = useMemo(() => {
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    return `/milk-sales/summary?${q.toString()}`;
  }, [from, to]);

  const { data, loading, error } = useApi<Paged<MilkSale>>(listPath);
  const { data: summary } = useApi<MilkSaleSummary>(summaryPath);
  const { data: prices, error: pricesError } = useApi<MilkPrice[]>('/milk-prices');

  useEffect(() => {
    setOffset(0);
  }, [from, to, search]);

  function applyPreset(p: Exclude<Preset, 'custom'>) {
    setPreset(p);
    const r = presetRange(p, meta.farm.week_start);
    setFrom(r.from);
    setTo(r.to);
  }

  async function confirmDeleteSale() {
    if (!deletingSale) return;
    setBusy(true);
    try {
      await api.del(`/milk-sales/${deletingSale.id}`);
      toast.success('Milk sale deleted.');
      refresh();
      setDeletingSale(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not delete the sale.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeletePrice() {
    if (!deletingPrice) return;
    setBusy(true);
    try {
      await api.del(`/milk-prices/${deletingPrice.id}`);
      toast.success('Milk price deleted.');
      refresh();
      setDeletingPrice(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not delete the price.');
    } finally {
      setBusy(false);
    }
  }

  const currency = meta.farm.currency;
  const unit = summary?.unit ?? meta.farm.milk_unit;

  const saleColumns: Column<MilkSale>[] = [
    { key: 'date', header: 'Date', render: (s) => formatDate(s.date), width: '130px' },
    {
      key: 'litres',
      header: 'Litres',
      align: 'right',
      render: (s) => <strong>{formatQuantity(s.litres, unit)}</strong>
    },
    {
      key: 'price',
      header: 'Price',
      align: 'right',
      render: (s) => `${formatMoney(s.price_per_litre, currency)} / ${unit}`
    },
    {
      key: 'revenue',
      header: 'Revenue',
      align: 'right',
      render: (s) => (
        <strong style={{ color: 'var(--accent)' }}>{formatMoney(s.revenue, currency)}</strong>
      )
    },
    {
      key: 'notes',
      header: 'Notes',
      render: (s) => <span style={{ color: 'var(--text-3)' }}>{s.notes || '—'}</span>
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      width: '90px',
      render: (s) => (
        <div className="row-actions">
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm"
            title="Edit"
            onClick={() => setSaleModal({ mode: 'edit', sale: s })}
          >
            <Icon name="pencil" size={15} />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm"
            title="Delete"
            onClick={() => setDeletingSale(s)}
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
      )
    }
  ];

  const priceColumns: Column<MilkPrice>[] = [
    {
      key: 'effective_date',
      header: 'Effective from',
      render: (p) => (
        <>
          {formatDate(p.effective_date)}
          {p.effective_date > todayStr() ? (
            <>
              {' '}
              <Badge tone="blue">Scheduled</Badge>
            </>
          ) : null}
        </>
      )
    },
    {
      key: 'price_per_litre',
      header: 'Price',
      align: 'right',
      render: (p) => <strong>{formatMoney(p.price_per_litre, currency)} / {unit}</strong>
    },
    {
      key: 'created_at',
      header: 'Added',
      render: (p) => <span style={{ color: 'var(--text-3)' }}>{formatDate(p.created_at.slice(0, 10))}</span>
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      width: '90px',
      render: (p) => (
        <div className="row-actions">
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm"
            title="Edit"
            onClick={() => setPriceModal({ mode: 'edit', price: p })}
          >
            <Icon name="pencil" size={15} />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm"
            title="Delete"
            onClick={() => setDeletingPrice(p)}
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
      )
    }
  ];

  return (
    <>
      <PageHeader
        title="Milk Sales"
        subtitle="Record sold milk with the price that applied on the sale date."
        actions={
          <>
            <button type="button" className="btn" onClick={() => setPriceModal({ mode: 'create' })}>
              <Icon name="plus" size={15} /> Add Price
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setSaleModal({ mode: 'create' })}>
              <Icon name="plus" size={15} /> Record Sale
            </button>
          </>
        }
      />

      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <StatCard
          label="Current Price"
          value={summary && summary.current_price !== null ? `${formatMoney(summary.current_price, currency)} / ${unit}` : '—'}
          hint="Price applied to sales dated today"
        />
        <StatCard
          label="Sold Today"
          value={summary ? formatQuantity(summary.today.sold, unit) : '—'}
          hint={summary ? formatMoney(summary.today.revenue, currency) : undefined}
        />
        <StatCard
          label="Sold This Month"
          value={summary ? formatQuantity(summary.month.sold, unit) : '—'}
          hint={summary ? `Revenue ${formatMoney(summary.month.revenue, currency)}` : undefined}
        />
        <StatCard
          label="Unsold / Remaining"
          value={summary ? formatQuantity(summary.range.remaining, unit) : '—'}
          tone={summary && summary.range.remaining < 0 ? 'negative' : undefined}
          hint={
            summary
              ? `Produced ${formatQuantity(summary.range.produced, unit)} · Sold ${formatQuantity(
                  summary.range.sold,
                  unit
                )} in range`
              : undefined
          }
        />
      </div>

      <div className="period-note">
        {preset === 'all' || (!from && !to)
          ? 'Selected period: all time'
          : `Selected period: ${formatDate(from)} – ${formatDate(to)}`}
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
        <input
          type="search"
          className="input search grow"
          placeholder="Search notes…"
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
              columns={saleColumns}
              rows={data?.items ?? []}
              rowKey={(s) => s.id}
              loading={loading}
              empty={
                from || to || search ? (
                  <EmptyState title="No matching sales" message="Try changing the date range or filters." />
                ) : (
                  <EmptyState
                    title="No milk sales yet"
                    message="Add a price, then record the milk you sold."
                    action={
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => setSaleModal({ mode: 'create' })}
                      >
                        <Icon name="plus" size={15} /> Record Sale
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

      <div className="card" style={{ marginTop: 20 }}>
        <div className="card-header">
          <div className="card-title">Price History</div>
          <button type="button" className="btn btn-sm" onClick={() => setPriceModal({ mode: 'create' })}>
            <Icon name="plus" size={14} /> Add Price
          </button>
        </div>
        {pricesError ? (
          <div className="card-body">
            <div className="error-box">{pricesError}</div>
          </div>
        ) : (
          <DataTable
            columns={priceColumns}
            rows={prices ?? []}
            rowKey={(p) => p.id}
            loading={prices === null && !pricesError}
            empty={
              <EmptyState
                title="No prices yet"
                message="Set the price per litre so sales can be recorded with the right rate."
                action={
                  <button type="button" className="btn btn-primary" onClick={() => setPriceModal({ mode: 'create' })}>
                    <Icon name="plus" size={15} /> Add Price
                  </button>
                }
              />
            }
          />
        )}
      </div>

      <SaleForm
        open={saleModal !== null}
        onClose={() => setSaleModal(null)}
        initial={saleModal?.mode === 'edit' ? saleModal.sale : null}
      />

      <PriceForm
        open={priceModal !== null}
        onClose={() => setPriceModal(null)}
        initial={priceModal?.mode === 'edit' ? priceModal.price : null}
      />

      <ConfirmDialog
        open={deletingSale !== null}
        title="Delete milk sale?"
        message={
          deletingSale
            ? `This will permanently delete the sale of ${formatQuantity(deletingSale.litres, unit)} for ${formatMoney(
                deletingSale.revenue,
                currency
              )} on ${formatDate(deletingSale.date)}, along with its linked Finance income.`
            : ''
        }
        busy={busy}
        onConfirm={confirmDeleteSale}
        onClose={() => setDeletingSale(null)}
      />

      <ConfirmDialog
        open={deletingPrice !== null}
        title="Delete milk price?"
        message={
          deletingPrice
            ? `This will remove the price of ${formatMoney(
                deletingPrice.price_per_litre,
                currency
              )} / ${unit} effective from ${formatDate(deletingPrice.effective_date)}. Existing sales keep the price they were recorded with.`
            : ''
        }
        busy={busy}
        onConfirm={confirmDeletePrice}
        onClose={() => setDeletingPrice(null)}
      />
    </>
  );
}
