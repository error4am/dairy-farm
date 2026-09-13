import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { DataTable, type Column } from '../../components/DataTable';
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
import { EMPLOYEE_STATUS_LABELS, EMPLOYEE_STATUS_TONES, PAY_TYPE_LABELS } from '../../lib/constants';
import type { Employee, EmployeeSummary } from '../../lib/types';

export function EmployeesPage() {
  const meta = useMeta();
  const { refresh } = useData();
  const toast = useToast();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [role, setRole] = useState('');

  const [form, setForm] = useState<{ open: boolean; employee: Employee | null }>({ open: false, employee: null });
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [deleting, setDeleting] = useState<Employee | null>(null);
  const [busy, setBusy] = useState(false);

  const path = useMemo(() => {
    const q = new URLSearchParams();
    if (search) q.set('search', search);
    if (status) q.set('status', status);
    if (role) q.set('role', role);
    q.set('sort', 'name');
    q.set('dir', 'asc');
    return `/employees?${q.toString()}`;
  }, [search, status, role]);

  const { data: employees, loading, error } = useApi<Employee[]>(path);
  const { data: summary } = useApi<EmployeeSummary>('/employees/summary');
  const { data: allEmployees } = useApi<Employee[]>(paymentOpen ? '/employees?sort=name&dir=asc' : null);

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.del(`/employees/${deleting.id}`);
      toast.success('Employee deleted.');
      refresh();
      setDeleting(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not delete the employee.');
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<Employee>[] = [
    {
      key: 'employee',
      header: 'Employee',
      render: (e) => (
        <Link to={`/employees/${e.id}`}>
          <strong>{e.name}</strong>
          <span style={{ color: 'var(--text-3)' }}> · {e.employee_id}</span>
        </Link>
      )
    },
    {
      key: 'role',
      header: 'Role',
      render: (e) => e.role || <span style={{ color: 'var(--text-3)' }}>—</span>
    },
    { key: 'pay_type', header: 'Pay Type', render: (e) => PAY_TYPE_LABELS[e.pay_type] },
    {
      key: 'salary',
      header: 'Salary / Wage',
      align: 'right',
      render: (e) => (
        <strong>
          {formatMoney(e.salary, meta.farm.currency)}
          {e.pay_type === 'daily' ? <span style={{ color: 'var(--text-3)', fontWeight: 400 }}> /day</span> : null}
        </strong>
      )
    },
    {
      key: 'status',
      header: 'Status',
      render: (e) => <Badge tone={EMPLOYEE_STATUS_TONES[e.status]}>{EMPLOYEE_STATUS_LABELS[e.status]}</Badge>
    },
    {
      key: 'joined',
      header: 'Joined',
      render: (e) => (e.joining_date ? formatDate(e.joining_date) : <span style={{ color: 'var(--text-3)' }}>—</span>)
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      width: '120px',
      render: (e) => (
        <div className="row-actions">
          <Link to={`/employees/${e.id}`} className="btn btn-ghost btn-icon btn-sm" title="View profile">
            <Icon name="eye" size={15} />
          </Link>
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm"
            title="Edit"
            onClick={() => setForm({ open: true, employee: e })}
          >
            <Icon name="pencil" size={15} />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm"
            title={e.payments_count ? 'Has payment history — mark inactive instead' : 'Delete'}
            disabled={Boolean(e.payments_count)}
            onClick={() => setDeleting(e)}
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
        title="Employees"
        subtitle={
          summary
            ? `${summary.active_count} active · ${summary.inactive_count} inactive`
            : 'Manage your farm workers and labor payments.'
        }
        actions={
          <>
            <button type="button" className="btn" onClick={() => setPaymentOpen(true)}>
              <Icon name="dollar" size={15} /> Record Payment
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setForm({ open: true, employee: null })}>
              <Icon name="plus" size={15} /> Add Employee
            </button>
          </>
        }
      />

      <div className="toolbar">
        <input
          type="search"
          className="input search"
          placeholder="Search name, ID, phone, role…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <select className="select" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
          <option value="">All roles</option>
          {(summary?.roles ?? []).map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
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
            rows={employees ?? []}
            rowKey={(e) => e.id}
            loading={loading}
            empty={
              search || status || role ? (
                <EmptyState title="No matching employees" message="Try changing the search or filters." />
              ) : (
                <EmptyState
                  title="No employees yet"
                  message="Add your farm workers to track wages, advances and labor costs."
                  action={
                    <button type="button" className="btn btn-primary" onClick={() => setForm({ open: true, employee: null })}>
                      <Icon name="plus" size={15} /> Add Employee
                    </button>
                  }
                />
              )
            }
          />
        )}
      </div>

      <EmployeeForm
        open={form.open}
        initial={form.employee}
        onClose={() => setForm({ open: false, employee: null })}
      />

      <PaymentForm
        open={paymentOpen}
        employees={allEmployees ?? []}
        onClose={() => setPaymentOpen(false)}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="Delete employee?"
        message={
          deleting
            ? `This will permanently delete ${deleting.name} (${deleting.employee_id}). Employees with payment records cannot be deleted — mark them Inactive instead.`
            : ''
        }
        busy={busy}
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}
