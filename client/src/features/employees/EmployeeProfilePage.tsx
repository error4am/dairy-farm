import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { StatCard } from '../../components/StatCard';
import { Badge } from '../../components/Badge';
import { Icon } from '../../components/Icon';
import { EmptyState } from '../../components/EmptyState';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmployeeForm } from './EmployeeForm';
import { PaymentForm } from './PaymentForm';
import { api, ApiError } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useData } from '../../lib/DataContext';
import { useToast } from '../../lib/ToastContext';
import { useMeta } from '../../lib/MetaContext';
import { formatDate, formatMoney } from '../../lib/format';
import {
  EMPLOYEE_STATUS_LABELS,
  EMPLOYEE_STATUS_TONES,
  PAYMENT_TYPE_LABELS,
  PAYMENT_TYPE_TONES,
  PAY_TYPE_LABELS
} from '../../lib/constants';
import type { EmployeePayment, EmployeeProfile } from '../../lib/types';

export function EmployeeProfilePage() {
  const { id } = useParams<{ id: string }>();
  const meta = useMeta();
  const { refresh } = useData();
  const toast = useToast();

  const { data, loading, error } = useApi<EmployeeProfile>(id ? `/employees/${id}/profile` : null);
  const [editing, setEditing] = useState(false);
  const [payment, setPayment] = useState<{ open: boolean; record: EmployeePayment | null }>({
    open: false,
    record: null
  });
  const [deleting, setDeleting] = useState<EmployeePayment | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <div className="spinner" />;

  if (error || !data) {
    return (
      <div className="card">
        <div className="card-body">
          <div className="error-box">{error ?? 'Employee not found.'}</div>
          <div style={{ marginTop: 14 }}>
            <Link to="/employees" className="btn">
              <Icon name="chevron-left" size={14} /> Back to Employees
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const e = data.employee;
  const currency = meta.farm.currency;

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.del(`/employee-payments/${deleting.id}`);
      toast.success('Payment deleted.');
      refresh();
      setDeleting(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not delete the payment.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div style={{ marginBottom: 10 }}>
        <Link to="/employees" className="btn btn-ghost btn-sm">
          <Icon name="chevron-left" size={14} /> All Employees
        </Link>
      </div>

      <PageHeader
        title={e.name}
        subtitle={`${e.employee_id}${e.role ? ' · ' + e.role : ''}${e.phone ? ' · ' + e.phone : ''}`}
        actions={
          <>
            <Badge tone={EMPLOYEE_STATUS_TONES[e.status]}>{EMPLOYEE_STATUS_LABELS[e.status]}</Badge>
            <button type="button" className="btn" onClick={() => setEditing(true)}>
              <Icon name="pencil" size={15} /> Edit
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setPayment({ open: true, record: null })}>
              <Icon name="dollar" size={15} /> Record Payment
            </button>
          </>
        }
      />

      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <StatCard label="Total Paid" value={formatMoney(data.finance.total_paid, currency)} hint={`${data.finance.payments_count} payments`} />
        <StatCard label="This Month" value={formatMoney(data.finance.this_month_paid, currency)} />
        <StatCard label="Total Advances" value={formatMoney(data.finance.total_advances, currency)} />
        <StatCard
          label="Outstanding Advances"
          value={formatMoney(data.finance.outstanding_advances, currency)}
          hint="No repayment tracking yet"
        />
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <div className="card-title">Basic Information</div>
        </div>
        <div className="card-body">
          <div className="detail-grid">
            <div>
              <div className="detail-label">Employee ID</div>
              <div className="detail-value">{e.employee_id}</div>
            </div>
            <div>
              <div className="detail-label">Role</div>
              <div className="detail-value">{e.role || '—'}</div>
            </div>
            <div>
              <div className="detail-label">Phone</div>
              <div className="detail-value">{e.phone || '—'}</div>
            </div>
            <div>
              <div className="detail-label">Joining Date</div>
              <div className="detail-value">{formatDate(e.joining_date)}</div>
            </div>
            <div>
              <div className="detail-label">Status</div>
              <div className="detail-value">
                <Badge tone={EMPLOYEE_STATUS_TONES[e.status]}>{EMPLOYEE_STATUS_LABELS[e.status]}</Badge>
              </div>
            </div>
            <div>
              <div className="detail-label">Pay Type</div>
              <div className="detail-value">{PAY_TYPE_LABELS[e.pay_type]}</div>
            </div>
            <div>
              <div className="detail-label">Current Salary / Wage</div>
              <div className="detail-value">
                {formatMoney(e.salary, currency)}
                {e.pay_type === 'daily' ? <span style={{ color: 'var(--text-3)' }}> /day</span> : null}
              </div>
            </div>
            <div>
              <div className="detail-label">Last Payment</div>
              <div className="detail-value">{data.finance.last_payment_date ? formatDate(data.finance.last_payment_date) : '—'}</div>
            </div>
          </div>
          {e.notes ? (
            <div style={{ marginTop: 16 }}>
              <div className="detail-label">Notes</div>
              <div className="detail-value" style={{ whiteSpace: 'pre-wrap', color: 'var(--text-2)' }}>
                {e.notes}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">Payment History</div>
          <button type="button" className="btn btn-sm" onClick={() => setPayment({ open: true, record: null })}>
            <Icon name="plus" size={14} /> Record Payment
          </button>
        </div>
        {data.recent_payments.length === 0 ? (
          <EmptyState
            title="No payments yet"
            message="Salary payments, advances and bonuses for this employee will appear here."
            action={
              <button type="button" className="btn" onClick={() => setPayment({ open: true, record: null })}>
                <Icon name="plus" size={15} /> Record Payment
              </button>
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Payment Type</th>
                  <th>Description</th>
                  <th className="num">Amount</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.recent_payments.map((p) => (
                  <tr key={p.id}>
                    <td>{formatDate(p.date)}</td>
                    <td>
                      <Badge tone={PAYMENT_TYPE_TONES[p.type]}>{PAYMENT_TYPE_LABELS[p.type]}</Badge>
                    </td>
                    <td style={{ color: 'var(--text-2)' }}>{p.description || '—'}</td>
                    <td className="num">
                      <strong>{formatMoney(p.amount, currency)}</strong>
                    </td>
                    <td className="num">
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon btn-sm"
                          title="Edit"
                          onClick={() => setPayment({ open: true, record: p })}
                        >
                          <Icon name="pencil" size={15} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon btn-sm"
                          title="Delete"
                          onClick={() => setDeleting(p)}
                        >
                          <Icon name="trash" size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <EmployeeForm open={editing} initial={e} onClose={() => setEditing(false)} />

      <PaymentForm
        open={payment.open}
        initial={payment.record}
        defaultEmployeeId={e.id}
        employees={[e]}
        onClose={() => setPayment({ open: false, record: null })}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="Delete payment?"
        message={
          deleting
            ? `This will permanently delete the ${PAYMENT_TYPE_LABELS[deleting.type]} of ${formatMoney(
                deleting.amount,
                currency
              )} on ${formatDate(deleting.date)}. The linked Labor expense will also be deleted.`
            : ''
        }
        busy={busy}
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}
