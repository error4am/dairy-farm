import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { StatCard } from '../../components/StatCard';
import { Icon } from '../../components/Icon';
import { EmptyState } from '../../components/EmptyState';
import { AnimalForm } from '../animals/AnimalForm';
import { MilkForm } from '../milk/MilkForm';
import { TransactionForm } from '../finances/TransactionForm';
import { useApi } from '../../lib/useApi';
import { useMeta } from '../../lib/MetaContext';
import { formatMoney, formatQuantity, formatRelative, trimNumber } from '../../lib/format';
import type { Animal, Dashboard } from '../../lib/types';

type QuickAction = 'animal' | 'milk' | 'income' | 'expense' | null;

export function DashboardPage() {
  const meta = useMeta();
  const [quick, setQuick] = useState<QuickAction>(null);
  const { data, loading, error } = useApi<Dashboard>('/dashboard');
  const { data: animals } = useApi<Animal[]>('/animals?sort=tag_number&dir=asc');

  if (loading && !data) return <div className="spinner" />;

  if (error || !data) {
    return (
      <div className="card">
        <div className="card-body">
          <div className="error-box">{error ?? 'Could not load the dashboard.'}</div>
        </div>
      </div>
    );
  }

  const m = data.metrics;
  const currency = data.farm.currency;
  const maxMilk = Math.max(...data.milk_last_7_days.map((d) => d.total), 1);

  return (
    <>
      <PageHeader title="Dashboard" subtitle={`Overview for ${data.farm.name}`} />

      <div className="quick-actions" style={{ marginBottom: 16 }}>
        <button type="button" className="quick-action" onClick={() => setQuick('animal')}>
          <Icon name="tag" size={17} /> Add Animal
        </button>
        <button type="button" className="quick-action" onClick={() => setQuick('milk')}>
          <Icon name="droplet" size={17} /> Record Milk
        </button>
        <button type="button" className="quick-action" onClick={() => setQuick('income')}>
          <Icon name="dollar" size={17} /> Add Income
        </button>
        <button type="button" className="quick-action" onClick={() => setQuick('expense')}>
          <Icon name="dollar" size={17} /> Add Expense
        </button>
      </div>

      <div className="dashboard-primary">
        <StatCard label="Active Animals" value={m.active_animals} />
        <StatCard
          label="Milk Today"
          value={formatQuantity(m.milk_today, m.unit)}
          hint={`Morning ${trimNumber(m.milk_today_morning)} · Evening ${trimNumber(m.milk_today_evening)} ${m.unit}`}
        />
        <StatCard label="Milk This Week" value={formatQuantity(m.milk_week, m.unit)} />
        <StatCard label="Total Revenue" value={formatMoney(m.revenue_all_time, currency)} hint="All time" />
        <StatCard label="Total Expenses" value={formatMoney(m.expenses_all_time, currency)} hint="All time" />
        <StatCard
          label="Net Profit"
          value={formatMoney(m.net_all_time, currency)}
          tone={m.net_all_time >= 0 ? 'positive' : 'negative'}
          hint="All time"
        />
      </div>

      <div className="dashboard-secondary">
        <StatCard label="Under Withdrawal" value={m.health.withdrawal_count} to="/health?filter=withdrawal" />
        <StatCard label="Vaccinations Due (30 days)" value={m.health.due_soon_count} to="/health?filter=due" />
        <StatCard label="Health Events (Month)" value={m.health.events_this_month} />
        <StatCard label="Pregnant" value={m.breeding.currently_pregnant} to="/breeding?filter=pregnant" />
        <StatCard label="Calving Soon (30 days)" value={m.breeding.calving_soon} to="/breeding?filter=calving" />
        <StatCard label="Pending Checks" value={m.breeding.pending_checks} to="/breeding?filter=pending" />
        <StatCard label="Active Employees" value={m.employees.active_count} to="/employees" />
        <StatCard label="Labor Cost (Month)" value={formatMoney(m.employees.labor_cost_this_month, currency)} />
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <div className="card-title">Recent Activity</div>
          </div>
          {data.recent_activity.length === 0 ? (
            <EmptyState
              title="No activity yet"
              message="Add animals, record milk or add transactions to see activity here."
            />
          ) : (
            <div className="card-body" style={{ paddingTop: 4, paddingBottom: 8 }}>
              <div className="activity">
                {data.recent_activity.map((item) => (
                  <div className="activity-item" key={`${item.kind}-${item.id}`}>
                    <div className={`activity-dot ${item.tone}`} />
                    <div className="activity-main">
                      <div className="activity-title">{item.title}</div>
                      <div className="activity-sub">{item.subtitle}</div>
                    </div>
                    <div className="activity-time">{formatRelative(item.at)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title">Milk — Last 7 Days</div>
            <Link to="/milk" style={{ fontSize: 12.5 }}>
              View all
            </Link>
          </div>
          <div className="card-body">
            <div className="chart-bars">
              {data.milk_last_7_days.map((d) => (
                <div className="chart-bar-col" key={d.date}>
                  <span className="chart-value">{trimNumber(d.total)}</span>
                  <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                    <div
                      className={`chart-bar${d.date === data.today ? ' today' : ''}`}
                      style={{ height: `${Math.round((d.total / maxMilk) * 100)}%` }}
                    />
                  </div>
                  <span className="chart-label">
                    {new Intl.DateTimeFormat('en-GB', { weekday: 'short' }).format(new Date(d.date + 'T00:00:00'))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <AnimalForm open={quick === 'animal'} onClose={() => setQuick(null)} />
      <MilkForm
        open={quick === 'milk'}
        onClose={() => setQuick(null)}
        animals={animals ?? []}
        defaultUnit={meta.farm.milk_unit}
      />
      <TransactionForm
        open={quick === 'income' || quick === 'expense'}
        onClose={() => setQuick(null)}
        defaultType={quick === 'expense' ? 'expense' : 'income'}
        animals={animals ?? []}
      />
    </>
  );
}
