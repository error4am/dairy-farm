import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { StatCard } from '../../components/StatCard';
import { Badge } from '../../components/Badge';
import { Icon } from '../../components/Icon';
import { EmptyState } from '../../components/EmptyState';
import { AnimalForm } from './AnimalForm';
import { HealthForm } from '../health/HealthForm';
import { useApi } from '../../lib/useApi';
import { useMeta } from '../../lib/MetaContext';
import {
  ANIMAL_STATUS_LABELS,
  ANIMAL_TYPE_LABELS,
  GENDER_LABELS,
  HEALTH_TYPE_LABELS,
  HEALTH_TYPE_TONES,
  SESSION_LABELS,
  STATUS_TONES
} from '../../lib/constants';
import { formatAge, formatDate, formatMoney, formatQuantity } from '../../lib/format';
import type { Animal, AnimalProfile } from '../../lib/types';

export function AnimalProfilePage() {
  const { id } = useParams<{ id: string }>();
  const meta = useMeta();
  const [editing, setEditing] = useState(false);
  const [healthOpen, setHealthOpen] = useState(false);
  const { data, loading, error } = useApi<AnimalProfile>(id ? `/animals/${id}/profile` : null);
  const { data: animals } = useApi<Animal[]>('/animals?sort=tag_number&dir=asc');

  if (loading) return <div className="spinner" />;

  if (error || !data) {
    return (
      <div className="card">
        <div className="card-body">
          <div className="error-box">{error ?? 'Animal not found.'}</div>
          <div style={{ marginTop: 14 }}>
            <Link to="/animals" className="btn">
              <Icon name="chevron-left" size={14} /> Back to Animals
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const a = data.animal;
  const currency = meta.farm.currency;
  const unit = meta.farm.milk_unit;

  return (
    <>
      <div style={{ marginBottom: 10 }}>
        <Link to="/animals" className="btn btn-ghost btn-sm">
          <Icon name="chevron-left" size={14} /> All Animals
        </Link>
      </div>

      <PageHeader
        title={`#${a.tag_number}${a.name ? ' · ' + a.name : ''}`}
        subtitle={`${ANIMAL_TYPE_LABELS[a.type]}${a.breed ? ' · ' + a.breed : ''} · ${GENDER_LABELS[a.gender]}`}
        actions={
          <>
            <Badge tone={STATUS_TONES[a.status]}>{ANIMAL_STATUS_LABELS[a.status]}</Badge>
            {a.withdrawal_until ? <Badge tone="amber">Withdrawal until {formatDate(a.withdrawal_until)}</Badge> : null}
            <button type="button" className="btn" onClick={() => setEditing(true)}>
              <Icon name="pencil" size={15} /> Edit Animal
            </button>
          </>
        }
      />

      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <StatCard label="Total Milk" value={formatQuantity(data.milk.total, unit)} hint={`${data.milk.records} records`} />
        <StatCard label="This Month" value={formatQuantity(data.milk.this_month, unit)} />
        <StatCard
          label="Morning / Evening"
          value={`${formatQuantity(data.milk.morning, unit)} / ${formatQuantity(data.milk.evening, unit)}`}
        />
        <StatCard
          label="Last Milking"
          value={data.milk.last_milk_date ? formatDate(data.milk.last_milk_date) : '—'}
        />
      </div>

      <div className="grid-2" style={{ marginBottom: 20 }}>
        <div className="card">
          <div className="card-header">
            <div className="card-title">Basic Information</div>
          </div>
          <div className="card-body">
            <div className="detail-grid">
              <div>
                <div className="detail-label">Tag Number</div>
                <div className="detail-value">#{a.tag_number}</div>
              </div>
              <div>
                <div className="detail-label">Name</div>
                <div className="detail-value">{a.name || '—'}</div>
              </div>
              <div>
                <div className="detail-label">Type</div>
                <div className="detail-value">{ANIMAL_TYPE_LABELS[a.type]}</div>
              </div>
              <div>
                <div className="detail-label">Breed</div>
                <div className="detail-value">{a.breed || '—'}</div>
              </div>
              <div>
                <div className="detail-label">Gender</div>
                <div className="detail-value">{GENDER_LABELS[a.gender]}</div>
              </div>
              <div>
                <div className="detail-label">Date of Birth</div>
                <div className="detail-value">
                  {formatDate(a.date_of_birth)}
                  {a.date_of_birth ? <span style={{ color: 'var(--text-3)' }}> · {formatAge(a.date_of_birth)}</span> : null}
                </div>
              </div>
              <div>
                <div className="detail-label">Purchase Date</div>
                <div className="detail-value">{formatDate(a.purchase_date)}</div>
              </div>
              <div>
                <div className="detail-label">Status</div>
                <div className="detail-value">
                  <Badge tone={STATUS_TONES[a.status]}>{ANIMAL_STATUS_LABELS[a.status]}</Badge>
                </div>
              </div>
              <div>
                <div className="detail-label">Added</div>
                <div className="detail-value">{formatDate(a.created_at)}</div>
              </div>
              <div>
                <div className="detail-label">Last Updated</div>
                <div className="detail-value">{formatDate(a.updated_at)}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-header">
              <div className="card-title">Notes</div>
            </div>
            <div className="card-body">
              {a.notes ? (
                <p style={{ whiteSpace: 'pre-wrap', color: 'var(--text-2)' }}>{a.notes}</p>
              ) : (
                <span style={{ color: 'var(--text-3)' }}>No notes recorded.</span>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title">Financial Summary</div>
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Linked transactions</span>
            </div>
            <div className="card-body">
              <div className="detail-grid">
                <div>
                  <div className="detail-label">Income</div>
                  <div className="detail-value" style={{ color: 'var(--accent)' }}>
                    {formatMoney(data.finance.income, currency)}
                  </div>
                </div>
                <div>
                  <div className="detail-label">Expenses</div>
                  <div className="detail-value" style={{ color: 'var(--danger)' }}>
                    {formatMoney(data.finance.expenses, currency)}
                  </div>
                </div>
                <div>
                  <div className="detail-label">Net</div>
                  <div className="detail-value">{formatMoney(data.finance.net, currency)}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <div className="card-title">Health History</div>
          <button type="button" className="btn btn-sm" onClick={() => setHealthOpen(true)}>
            <Icon name="plus" size={14} /> Add Health Event
          </button>
        </div>
        {data.recent_health.length === 0 ? (
          <EmptyState
            title="No health records"
            message="Vaccinations, treatments and vet visits for this animal will appear here."
            action={
              <button type="button" className="btn" onClick={() => setHealthOpen(true)}>
                <Icon name="plus" size={15} /> Add Health Event
              </button>
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Condition</th>
                  <th>Medicine</th>
                  <th>Withdrawal Until</th>
                  <th>Next Due</th>
                  <th className="num">Cost</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_health.map((r) => (
                  <tr key={r.id}>
                    <td>{formatDate(r.date)}</td>
                    <td>
                      <Badge tone={HEALTH_TYPE_TONES[r.type]}>{HEALTH_TYPE_LABELS[r.type]}</Badge>
                    </td>
                    <td>{r.condition || <span style={{ color: 'var(--text-3)' }}>—</span>}</td>
                    <td>
                      {r.medicine ? (
                        <span>
                          {r.medicine}
                          {r.dosage ? <span style={{ color: 'var(--text-3)' }}> · {r.dosage}</span> : null}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-3)' }}>—</span>
                      )}
                    </td>
                    <td>
                      {r.withdrawal_until ? (
                        <Badge tone="amber">{formatDate(r.withdrawal_until)}</Badge>
                      ) : (
                        <span style={{ color: 'var(--text-3)' }}>—</span>
                      )}
                    </td>
                    <td>
                      {r.next_due_date ? (
                        <Badge tone="blue">{formatDate(r.next_due_date)}</Badge>
                      ) : (
                        <span style={{ color: 'var(--text-3)' }}>—</span>
                      )}
                    </td>
                    <td className="num">
                      {r.cost != null ? (
                        <strong>{formatMoney(r.cost, currency)}</strong>
                      ) : (
                        <span style={{ color: 'var(--text-3)' }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid-2-equal">
        <div className="card">
          <div className="card-header">
            <div className="card-title">Recent Milk Records</div>
            <Link to="/milk" style={{ fontSize: 12.5 }}>
              View all
            </Link>
          </div>
          {data.recent_milk.length === 0 ? (
            <EmptyState title="No milk records" message="Milk records for this animal will appear here." />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Session</th>
                    <th className="num">Quantity</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent_milk.map((r) => (
                    <tr key={r.id}>
                      <td>{formatDate(r.date)}</td>
                      <td>
                        <Badge tone={r.session === 'morning' ? 'blue' : 'amber'}>{SESSION_LABELS[r.session]}</Badge>
                      </td>
                      <td className="num">
                        <strong>{formatQuantity(r.quantity, r.unit)}</strong>
                      </td>
                      <td style={{ color: 'var(--text-3)' }}>{r.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title">Recent Transactions</div>
            <Link to="/finances" style={{ fontSize: 12.5 }}>
              View all
            </Link>
          </div>
          {data.recent_transactions.length === 0 ? (
            <EmptyState title="No transactions" message="Transactions linked to this animal will appear here." />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Description</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent_transactions.map((t) => (
                    <tr key={t.id}>
                      <td>{formatDate(t.date)}</td>
                      <td>
                        <Badge tone={t.type === 'income' ? 'green' : 'red'}>
                          {t.type === 'income' ? 'Income' : 'Expense'}
                        </Badge>
                      </td>
                      <td style={{ color: 'var(--text-2)' }}>{t.description || '—'}</td>
                      <td className="num">
                        <strong>{formatMoney(t.amount, currency)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {data.monthly_milk.length > 0 ? (
        <div className="card" style={{ marginTop: 20 }}>
          <div className="card-header">
            <div className="card-title">Monthly Production</div>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Last {data.monthly_milk.length} months</span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.monthly_milk.map((m) => (
                  <tr key={m.month}>
                    <td>
                      {new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(
                        new Date(m.month + '-01T00:00:00')
                      )}
                    </td>
                    <td className="num">
                      <strong>{formatQuantity(m.total, unit)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <AnimalForm open={editing} initial={a} onClose={() => setEditing(false)} />

      <HealthForm
        open={healthOpen}
        defaultAnimalId={a.id}
        animals={animals ?? []}
        onClose={() => setHealthOpen(false)}
      />
    </>
  );
}
