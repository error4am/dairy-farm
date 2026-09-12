import { useEffect, useState } from 'react';
import { Modal } from '../../components/Modal';
import { Field } from '../../components/Field';
import { api, ApiError } from '../../lib/api';
import { useData } from '../../lib/DataContext';
import { useToast } from '../../lib/ToastContext';
import { ANIMAL_STATUS_LABELS, ANIMAL_TYPE_LABELS, GENDER_LABELS } from '../../lib/constants';
import type { Animal, AnimalStatus, AnimalType, Gender } from '../../lib/types';

export function AnimalForm({
  open,
  onClose,
  initial
}: {
  open: boolean;
  onClose: () => void;
  initial?: Animal | null;
}) {
  const { refresh } = useData();
  const toast = useToast();

  const [tagNumber, setTagNumber] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<AnimalType>('cow');
  const [breed, setBreed] = useState('');
  const [gender, setGender] = useState<Gender>('female');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [status, setStatus] = useState<AnimalStatus>('active');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTagNumber(initial?.tag_number ?? '');
    setName(initial?.name ?? '');
    setType(initial?.type ?? 'cow');
    setBreed(initial?.breed ?? '');
    setGender(initial?.gender ?? 'female');
    setDateOfBirth(initial?.date_of_birth ?? '');
    setPurchaseDate(initial?.purchase_date ?? '');
    setStatus(initial?.status ?? 'active');
    setNotes(initial?.notes ?? '');
    setErrors({});
  }, [open, initial]);

  async function save() {
    const errs: Record<string, string> = {};
    if (!tagNumber.trim()) errs.tag_number = 'Tag number is required.';
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    setBusy(true);
    try {
      const payload = {
        tag_number: tagNumber.trim(),
        name: name.trim() || null,
        type,
        breed: breed.trim() || null,
        gender,
        date_of_birth: dateOfBirth || null,
        purchase_date: purchaseDate || null,
        status,
        notes: notes.trim() || null
      };
      if (initial) {
        await api.put(`/animals/${initial.id}`, payload);
        toast.success('Animal updated.');
      } else {
        await api.post('/animals', payload);
        toast.success('Animal added.');
      }
      refresh();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.details) setErrors(err.details);
        toast.error(err.message);
      } else {
        toast.error('Could not save the animal.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? `Edit Animal #${initial.tag_number}` : 'Add Animal'}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : initial ? 'Save Changes' : 'Add Animal'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Tag number" required error={errors.tag_number} htmlFor="animal-tag">
          <input
            id="animal-tag"
            className={`input${errors.tag_number ? ' invalid' : ''}`}
            value={tagNumber}
            onChange={(e) => setTagNumber(e.target.value)}
            placeholder="e.g. 102"
            autoFocus
          />
        </Field>
        <Field label="Name / nickname" error={errors.name} htmlFor="animal-name">
          <input
            id="animal-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Optional"
          />
        </Field>

        <Field label="Type" required error={errors.type} htmlFor="animal-type">
          <select id="animal-type" className="select" value={type} onChange={(e) => setType(e.target.value as AnimalType)}>
            {(Object.keys(ANIMAL_TYPE_LABELS) as AnimalType[]).map((t) => (
              <option key={t} value={t}>
                {ANIMAL_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Breed" error={errors.breed} htmlFor="animal-breed">
          <input
            id="animal-breed"
            className="input"
            value={breed}
            onChange={(e) => setBreed(e.target.value)}
            placeholder="e.g. Holstein"
          />
        </Field>

        <Field label="Gender" required error={errors.gender} htmlFor="animal-gender">
          <select
            id="animal-gender"
            className="select"
            value={gender}
            onChange={(e) => setGender(e.target.value as Gender)}
          >
            {(Object.keys(GENDER_LABELS) as Gender[]).map((g) => (
              <option key={g} value={g}>
                {GENDER_LABELS[g]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Date of birth" error={errors.date_of_birth} htmlFor="animal-dob">
          <input
            id="animal-dob"
            type="date"
            className="input"
            value={dateOfBirth}
            onChange={(e) => setDateOfBirth(e.target.value)}
          />
        </Field>

        <Field label="Purchase date" error={errors.purchase_date} htmlFor="animal-purchase">
          <input
            id="animal-purchase"
            type="date"
            className="input"
            value={purchaseDate}
            onChange={(e) => setPurchaseDate(e.target.value)}
          />
        </Field>
        <Field label="Status" required error={errors.status} htmlFor="animal-status">
          <select
            id="animal-status"
            className="select"
            value={status}
            onChange={(e) => setStatus(e.target.value as AnimalStatus)}
          >
            {(Object.keys(ANIMAL_STATUS_LABELS) as AnimalStatus[]).map((s) => (
              <option key={s} value={s}>
                {ANIMAL_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Notes" className="span-2" error={errors.notes} htmlFor="animal-notes">
          <textarea
            id="animal-notes"
            className="textarea"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional"
          />
        </Field>
      </div>
    </Modal>
  );
}
