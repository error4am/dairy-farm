import { useEffect, useState } from 'react';
import { Modal } from '../../components/Modal';
import { Field } from '../../components/Field';
import { api, ApiError } from '../../lib/api';
import { useData } from '../../lib/DataContext';
import { useToast } from '../../lib/ToastContext';
import { useMeta } from '../../lib/MetaContext';
import { EMPLOYEE_STATUS_LABELS, PAY_TYPE_LABELS } from '../../lib/constants';
import type { Employee, EmployeeStatus, PayType } from '../../lib/types';

export function EmployeeForm({
  open,
  onClose,
  initial
}: {
  open: boolean;
  onClose: () => void;
  initial?: Employee | null;
}) {
  const meta = useMeta();
  const { refresh } = useData();
  const toast = useToast();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('');
  const [joiningDate, setJoiningDate] = useState('');
  const [status, setStatus] = useState<EmployeeStatus>('active');
  const [payType, setPayType] = useState<PayType>('monthly');
  const [salary, setSalary] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? '');
    setPhone(initial?.phone ?? '');
    setRole(initial?.role ?? '');
    setJoiningDate(initial?.joining_date ?? '');
    setStatus(initial?.status ?? 'active');
    setPayType(initial?.pay_type ?? 'monthly');
    setSalary(initial ? String(initial.salary) : '');
    setNotes(initial?.notes ?? '');
    setErrors({});
  }, [open, initial]);

  async function save() {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Full name is required.';
    const salaryValue = Number(salary);
    if (salary.trim() === '' || !Number.isFinite(salaryValue) || salaryValue < 0) {
      errs.salary = 'Enter a salary of zero or more.';
    }
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    setBusy(true);
    try {
      const payload = {
        name: name.trim(),
        phone: phone.trim() || null,
        role: role.trim() || null,
        joining_date: joiningDate || null,
        status,
        pay_type: payType,
        salary: salaryValue,
        notes: notes.trim() || null
      };
      if (initial) {
        await api.put(`/employees/${initial.id}`, payload);
        toast.success('Employee updated.');
      } else {
        await api.post('/employees', payload);
        toast.success('Employee added.');
      }
      refresh();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.details) setErrors(err.details);
        toast.error(err.message);
      } else {
        toast.error('Could not save the employee.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? `Edit Employee · ${initial.employee_id}` : 'Add Employee'}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : initial ? 'Save Changes' : 'Add Employee'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Full name" required error={errors.name} className="span-2" htmlFor="emp-name">
          <input
            id="emp-name"
            className={`input${errors.name ? ' invalid' : ''}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Ali Khan"
            autoFocus
          />
        </Field>

        <Field label="Phone" error={errors.phone} htmlFor="emp-phone" hint="Optional">
          <input
            id="emp-phone"
            className="input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="e.g. 0300-1234567"
          />
        </Field>
        <Field label="Role / job" error={errors.role} htmlFor="emp-role" hint="e.g. Milker, Feeder, Guard">
          <input
            id="emp-role"
            className="input"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="Optional"
          />
        </Field>

        <Field label="Joining date" error={errors.joining_date} htmlFor="emp-joining">
          <input
            id="emp-joining"
            type="date"
            className="input"
            value={joiningDate}
            onChange={(e) => setJoiningDate(e.target.value)}
          />
        </Field>
        <Field label="Status" required error={errors.status} htmlFor="emp-status">
          <select
            id="emp-status"
            className="select"
            value={status}
            onChange={(e) => setStatus(e.target.value as EmployeeStatus)}
          >
            {(Object.keys(EMPLOYEE_STATUS_LABELS) as EmployeeStatus[]).map((s) => (
              <option key={s} value={s}>
                {EMPLOYEE_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Pay type" required error={errors.pay_type} htmlFor="emp-paytype">
          <select
            id="emp-paytype"
            className="select"
            value={payType}
            onChange={(e) => setPayType(e.target.value as PayType)}
          >
            {(Object.keys(PAY_TYPE_LABELS) as PayType[]).map((p) => (
              <option key={p} value={p}>
                {PAY_TYPE_LABELS[p]}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={`Salary / wage (${meta.farm.currency})`}
          required
          error={errors.salary}
          hint="Current agreed amount — only applies to future payments"
          htmlFor="emp-salary"
        >
          <input
            id="emp-salary"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            className={`input${errors.salary ? ' invalid' : ''}`}
            value={salary}
            onChange={(e) => setSalary(e.target.value)}
            placeholder="e.g. 35000"
          />
        </Field>

        <Field label="Notes" className="span-2" error={errors.notes} htmlFor="emp-notes">
          <textarea
            id="emp-notes"
            className="textarea"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional"
          />
        </Field>
      </div>
    </Modal>
  );
}
