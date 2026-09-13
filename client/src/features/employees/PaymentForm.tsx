import { useEffect, useState } from 'react';
import { Modal } from '../../components/Modal';
import { Field } from '../../components/Field';
import { api, ApiError } from '../../lib/api';
import { useData } from '../../lib/DataContext';
import { useToast } from '../../lib/ToastContext';
import { useMeta } from '../../lib/MetaContext';
import { todayStr } from '../../lib/format';
import { PAYMENT_TYPE_LABELS } from '../../lib/constants';
import type { Employee, EmployeePayment, PaymentType } from '../../lib/types';

export function PaymentForm({
  open,
  onClose,
  initial,
  defaultEmployeeId,
  employees
}: {
  open: boolean;
  onClose: () => void;
  initial?: EmployeePayment | null;
  defaultEmployeeId?: number;
  employees: Employee[];
}) {
  const meta = useMeta();
  const { refresh } = useData();
  const toast = useToast();

  const [employeeId, setEmployeeId] = useState('');
  const [date, setDate] = useState(todayStr());
  const [type, setType] = useState<PaymentType>('salary');
  const [amount, setAmount] = useState('');
  const [amountTouched, setAmountTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEmployeeId(initial ? String(initial.employee_id) : defaultEmployeeId ? String(defaultEmployeeId) : '');
    setDate(initial?.date ?? todayStr());
    setType(initial?.type ?? 'salary');
    setAmount(initial ? String(initial.amount) : '');
    setAmountTouched(Boolean(initial));
    setDescription(initial?.description ?? '');
    setNotes(initial?.notes ?? '');
    setErrors({});
  }, [open, initial, defaultEmployeeId]);

  function maybePrefill(empId: string, paymentType: PaymentType) {
    if (amountTouched || initial) return;
    const employee = employees.find((e) => String(e.id) === empId);
    if (empId && paymentType === 'salary' && employee && employee.salary > 0) {
      setAmount(String(employee.salary));
    }
  }

  function onEmployeeChange(value: string) {
    setEmployeeId(value);
    maybePrefill(value, type);
  }

  function onTypeChange(value: PaymentType) {
    setType(value);
    maybePrefill(employeeId, value);
  }

  async function save() {
    const errs: Record<string, string> = {};
    if (!employeeId) errs.employee_id = 'Select an employee.';
    if (!date) errs.date = 'Date is required.';
    const amountValue = Number(amount);
    if (amount.trim() === '' || !Number.isFinite(amountValue) || amountValue <= 0) {
      errs.amount = 'Enter an amount greater than 0.';
    }
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    setBusy(true);
    try {
      const payload = {
        employee_id: Number(employeeId),
        date,
        type,
        amount: amountValue,
        description: description.trim() || null,
        notes: notes.trim() || null
      };
      if (initial) {
        await api.put(`/employee-payments/${initial.id}`, payload);
        toast.success('Payment updated.');
      } else {
        await api.post('/employee-payments', payload);
        toast.success('Payment recorded.');
      }
      refresh();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.details) setErrors(err.details);
        toast.error(err.message);
      } else {
        toast.error('Could not save the payment.');
      }
    } finally {
      setBusy(false);
    }
  }

  const sorted = [...employees].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? 'Edit Payment' : 'Record Payment'}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : initial ? 'Save Changes' : 'Record Payment'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Employee" required error={errors.employee_id} className="span-2" htmlFor="pay-employee">
          <select
            id="pay-employee"
            className={`select${errors.employee_id ? ' invalid' : ''}`}
            value={employeeId}
            onChange={(e) => onEmployeeChange(e.target.value)}
            autoFocus
          >
            <option value="">Select employee…</option>
            {sorted.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({e.employee_id}){e.status === 'inactive' ? ' — inactive' : ''}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Date" required error={errors.date} htmlFor="pay-date">
          <input
            id="pay-date"
            type="date"
            className={`input${errors.date ? ' invalid' : ''}`}
            value={date}
            max={todayStr()}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="Payment type" required error={errors.type} htmlFor="pay-type">
          <select
            id="pay-type"
            className="select"
            value={type}
            onChange={(e) => onTypeChange(e.target.value as PaymentType)}
          >
            {(Object.keys(PAYMENT_TYPE_LABELS) as PaymentType[]).map((t) => (
              <option key={t} value={t}>
                {PAYMENT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label={`Amount (${meta.farm.currency})`}
          required
          error={errors.amount}
          hint="Creates a linked Labor expense"
          htmlFor="pay-amount"
        >
          <input
            id="pay-amount"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            className={`input${errors.amount ? ' invalid' : ''}`}
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setAmountTouched(true);
            }}
            placeholder="0"
          />
        </Field>
        <Field label="Description" error={errors.description} htmlFor="pay-description" hint="Optional">
          <input
            id="pay-description"
            className="input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. September salary"
          />
        </Field>

        <Field label="Notes" className="span-2" error={errors.notes} htmlFor="pay-notes">
          <textarea
            id="pay-notes"
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
