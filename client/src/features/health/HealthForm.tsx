import { useEffect, useState } from 'react';
import { Modal } from '../../components/Modal';
import { Field } from '../../components/Field';
import { api, ApiError } from '../../lib/api';
import { useData } from '../../lib/DataContext';
import { useToast } from '../../lib/ToastContext';
import { useMeta } from '../../lib/MetaContext';
import { todayStr } from '../../lib/format';
import { HEALTH_TYPE_LABELS } from '../../lib/constants';
import type { Animal, HealthRecord, HealthType } from '../../lib/types';

export function HealthForm({
  open,
  onClose,
  initial,
  defaultAnimalId,
  animals
}: {
  open: boolean;
  onClose: () => void;
  initial?: HealthRecord | null;
  defaultAnimalId?: number;
  animals: Animal[];
}) {
  const meta = useMeta();
  const { refresh } = useData();
  const toast = useToast();

  const [animalId, setAnimalId] = useState('');
  const [date, setDate] = useState(todayStr());
  const [type, setType] = useState<HealthType>('checkup');
  const [condition, setCondition] = useState('');
  const [medicine, setMedicine] = useState('');
  const [dosage, setDosage] = useState('');
  const [vetName, setVetName] = useState('');
  const [withdrawalUntil, setWithdrawalUntil] = useState('');
  const [nextDueDate, setNextDueDate] = useState('');
  const [cost, setCost] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAnimalId(initial ? String(initial.animal_id) : defaultAnimalId ? String(defaultAnimalId) : '');
    setDate(initial?.date ?? todayStr());
    setType(initial?.type ?? 'checkup');
    setCondition(initial?.condition ?? '');
    setMedicine(initial?.medicine ?? '');
    setDosage(initial?.dosage ?? '');
    setVetName(initial?.vet_name ?? '');
    setWithdrawalUntil(initial?.withdrawal_until ?? '');
    setNextDueDate(initial?.next_due_date ?? '');
    setCost(initial?.cost != null ? String(initial.cost) : '');
    setNotes(initial?.notes ?? '');
    setErrors({});
  }, [open, initial, defaultAnimalId]);

  async function save() {
    const errs: Record<string, string> = {};
    if (!animalId) errs.animal_id = 'Select an animal.';
    if (!date) errs.date = 'Date is required.';
    const costValue = cost.trim() === '' ? null : Number(cost);
    if (costValue !== null && (!Number.isFinite(costValue) || costValue < 0)) {
      errs.cost = 'Cost must be zero or more.';
    }
    if (withdrawalUntil && withdrawalUntil < date) {
      errs.withdrawal_until = 'Withdrawal date cannot be before the record date.';
    }
    if (nextDueDate && nextDueDate < date) {
      errs.next_due_date = 'Next due date cannot be before the record date.';
    }
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    setBusy(true);
    try {
      const payload = {
        animal_id: Number(animalId),
        date,
        type,
        condition: condition.trim() || null,
        medicine: medicine.trim() || null,
        dosage: dosage.trim() || null,
        vet_name: vetName.trim() || null,
        withdrawal_until: withdrawalUntil || null,
        next_due_date: nextDueDate || null,
        cost: costValue,
        notes: notes.trim() || null
      };
      if (initial) {
        await api.put(`/health-records/${initial.id}`, payload);
        toast.success('Health record updated.');
      } else {
        await api.post('/health-records', payload);
        toast.success('Health record added.');
      }
      refresh();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.details) setErrors(err.details);
        toast.error(err.message);
      } else {
        toast.error('Could not save the health record.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? 'Edit Health Record' : 'Add Health Record'}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : initial ? 'Save Changes' : 'Add Record'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Animal" required error={errors.animal_id} className="span-2" htmlFor="health-animal">
          <select
            id="health-animal"
            className={`select${errors.animal_id ? ' invalid' : ''}`}
            value={animalId}
            onChange={(e) => setAnimalId(e.target.value)}
            autoFocus
          >
            <option value="">Select animal…</option>
            {animals.map((a) => (
              <option key={a.id} value={a.id}>
                #{a.tag_number}
                {a.name ? ` · ${a.name}` : ''}
                {a.status !== 'active' ? ` (${a.status})` : ''}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Date" required error={errors.date} htmlFor="health-date">
          <input
            id="health-date"
            type="date"
            className={`input${errors.date ? ' invalid' : ''}`}
            value={date}
            max={todayStr()}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="Type" required error={errors.type} htmlFor="health-type">
          <select
            id="health-type"
            className="select"
            value={type}
            onChange={(e) => setType(e.target.value as HealthType)}
          >
            {(Object.keys(HEALTH_TYPE_LABELS) as HealthType[]).map((t) => (
              <option key={t} value={t}>
                {HEALTH_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Condition / reason" className="span-2" error={errors.condition} htmlFor="health-condition">
          <input
            id="health-condition"
            className="input"
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
            placeholder="e.g. Mastitis, FMD vaccination, routine checkup"
          />
        </Field>

        <Field label="Medicine" error={errors.medicine} htmlFor="health-medicine">
          <input
            id="health-medicine"
            className="input"
            value={medicine}
            onChange={(e) => setMedicine(e.target.value)}
            placeholder="Optional"
          />
        </Field>
        <Field label="Dosage" error={errors.dosage} htmlFor="health-dosage">
          <input
            id="health-dosage"
            className="input"
            value={dosage}
            onChange={(e) => setDosage(e.target.value)}
            placeholder="Optional"
          />
        </Field>

        <Field label="Vet name" error={errors.vet_name} htmlFor="health-vet">
          <input
            id="health-vet"
            className="input"
            value={vetName}
            onChange={(e) => setVetName(e.target.value)}
            placeholder="Optional"
          />
        </Field>
        <Field
          label={`Cost (${meta.farm.currency})`}
          error={errors.cost}
          hint="Creates a Medicine expense"
          htmlFor="health-cost"
        >
          <input
            id="health-cost"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            className={`input${errors.cost ? ' invalid' : ''}`}
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder="0"
          />
        </Field>

        <Field
          label="Withdrawal until"
          error={errors.withdrawal_until}
          hint="Milk is blocked until this date"
          htmlFor="health-withdrawal"
        >
          <input
            id="health-withdrawal"
            type="date"
            className={`input${errors.withdrawal_until ? ' invalid' : ''}`}
            value={withdrawalUntil}
            onChange={(e) => setWithdrawalUntil(e.target.value)}
          />
        </Field>
        <Field label="Next due date" error={errors.next_due_date} hint="For vaccinations / boosters" htmlFor="health-next-due">
          <input
            id="health-next-due"
            type="date"
            className={`input${errors.next_due_date ? ' invalid' : ''}`}
            value={nextDueDate}
            onChange={(e) => setNextDueDate(e.target.value)}
          />
        </Field>

        <Field label="Notes" className="span-2" error={errors.notes} htmlFor="health-notes">
          <textarea
            id="health-notes"
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
