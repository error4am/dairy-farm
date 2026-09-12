import { useEffect, useRef, useState } from 'react';
import { Modal } from '../../components/Modal';
import { Field } from '../../components/Field';
import { api, ApiError } from '../../lib/api';
import { useData } from '../../lib/DataContext';
import { useToast } from '../../lib/ToastContext';
import { todayStr, formatDate } from '../../lib/format';
import { SESSION_LABELS } from '../../lib/constants';
import type { Animal, MilkRecord, Session } from '../../lib/types';

function autoSession(): Session {
  return new Date().getHours() < 12 ? 'morning' : 'evening';
}

export function MilkForm({
  open,
  onClose,
  initial,
  animals,
  defaultUnit
}: {
  open: boolean;
  onClose: () => void;
  initial?: MilkRecord | null;
  animals: Animal[];
  defaultUnit: string;
}) {
  const { refresh } = useData();
  const toast = useToast();
  const [date, setDate] = useState(todayStr());
  const [animalId, setAnimalId] = useState('');
  const [session, setSession] = useState<Session>(autoSession());
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState(defaultUnit);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const quantityRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setDate(initial?.date ?? todayStr());
    setAnimalId(initial ? String(initial.animal_id) : '');
    setSession(initial?.session ?? autoSession());
    setQuantity(initial ? String(initial.quantity) : '');
    setUnit(initial?.unit ?? defaultUnit);
    setNotes(initial?.notes ?? '');
    setErrors({});
  }, [open, initial, defaultUnit]);

  const options = animals.filter((a) => a.status === 'active' || a.id === initial?.animal_id);
  const isWithdrawn = (a: Animal) => Boolean(a.withdrawal_until && a.withdrawal_until >= date);

  async function save(keepOpen: boolean) {
    const errs: Record<string, string> = {};
    if (!animalId) errs.animal_id = 'Select an animal.';
    if (!date) errs.date = 'Date is required.';
    const qty = Number(quantity);
    if (quantity.trim() === '' || !Number.isFinite(qty) || qty <= 0) {
      errs.quantity = 'Enter a quantity greater than 0.';
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
        session,
        quantity: qty,
        unit,
        notes: notes.trim() || null
      };
      if (initial) {
        await api.put(`/milk-records/${initial.id}`, payload);
        toast.success('Milk record updated.');
        refresh();
        onClose();
      } else {
        await api.post('/milk-records', payload);
        toast.success('Milk recorded.');
        refresh();
        if (keepOpen) {
          setQuantity('');
          setNotes('');
          setErrors({});
          quantityRef.current?.focus();
        } else {
          onClose();
        }
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.details) setErrors(err.details);
        toast.error(err.message);
      } else {
        toast.error('Could not save the record.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? 'Edit Milk Record' : 'Record Milk'}
      maxWidth={520}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          {!initial ? (
            <button type="button" className="btn" onClick={() => save(true)} disabled={busy}>
              Save & add another
            </button>
          ) : null}
          <button type="button" className="btn btn-primary" onClick={() => save(false)} disabled={busy}>
            {busy ? 'Saving…' : initial ? 'Save Changes' : 'Save'}
          </button>
        </>
      }
    >
      <div
        className="form-grid"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) {
            e.preventDefault();
            void save(false);
          }
        }}
      >
        <Field label="Animal" required error={errors.animal_id} className="span-2" htmlFor="milk-animal">
          <select
            id="milk-animal"
            className={`select${errors.animal_id ? ' invalid' : ''}`}
            value={animalId}
            onChange={(e) => {
              setAnimalId(e.target.value);
              if (e.target.value) quantityRef.current?.focus();
            }}
            autoFocus
          >
            <option value="">Select animal…</option>
            {options.map((a) => (
              <option key={a.id} value={a.id} disabled={isWithdrawn(a) && a.id !== initial?.animal_id}>
                #{a.tag_number}
                {a.name ? ` · ${a.name}` : ''}
                {isWithdrawn(a) ? ` — withdrawal until ${formatDate(a.withdrawal_until)}` : ''}
                {a.status !== 'active' ? ` (${a.status})` : ''}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Date" required error={errors.date} htmlFor="milk-date">
          <input
            id="milk-date"
            type="date"
            className={`input${errors.date ? ' invalid' : ''}`}
            value={date}
            max={todayStr()}
            onChange={(e) => {
              const newDate = e.target.value;
              setDate(newDate);
              const selected = animals.find((a) => String(a.id) === animalId);
              if (
                selected &&
                selected.id !== initial?.animal_id &&
                selected.withdrawal_until &&
                selected.withdrawal_until >= newDate
              ) {
                setAnimalId('');
              }
            }}
          />
        </Field>

        <Field label="Session" required htmlFor="milk-session">
          <select
            id="milk-session"
            className="select"
            value={session}
            onChange={(e) => setSession(e.target.value as Session)}
          >
            {(['morning', 'evening'] as Session[]).map((s) => (
              <option key={s} value={s}>
                {SESSION_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Quantity" required error={errors.quantity} htmlFor="milk-quantity">
          <input
            id="milk-quantity"
            ref={quantityRef}
            type="number"
            inputMode="decimal"
            min="0"
            step="0.1"
            placeholder="e.g. 12.5"
            className={`input${errors.quantity ? ' invalid' : ''}`}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </Field>

        <Field label="Unit" htmlFor="milk-unit">
          <select id="milk-unit" className="select" value={unit} onChange={(e) => setUnit(e.target.value)}>
            <option value="L">Liters (L)</option>
            <option value="kg">Kilograms (kg)</option>
            <option value="gal">Gallons (gal)</option>
          </select>
        </Field>

        <Field label="Notes" className="span-2" htmlFor="milk-notes">
          <textarea
            id="milk-notes"
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
