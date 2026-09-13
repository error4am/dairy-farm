import { useEffect, useState } from 'react';
import { Modal } from '../../components/Modal';
import { Field } from '../../components/Field';
import { api, ApiError } from '../../lib/api';
import { useData } from '../../lib/DataContext';
import { useToast } from '../../lib/ToastContext';
import { useMeta } from '../../lib/MetaContext';
import { addDaysStr, todayStr } from '../../lib/format';
import { CALVING_OUTCOME_LABELS, PREGNANCY_RESULT_LABELS, SERVICE_METHOD_LABELS } from '../../lib/constants';
import type {
  Animal,
  BreedingRecord,
  CalvingOutcome,
  PregnancyResult,
  ServiceMethod
} from '../../lib/types';

export function BreedingForm({
  open,
  onClose,
  initial,
  defaultAnimalId,
  animals
}: {
  open: boolean;
  onClose: () => void;
  initial?: BreedingRecord | null;
  defaultAnimalId?: number;
  animals: Animal[];
}) {
  const meta = useMeta();
  const { refresh } = useData();
  const toast = useToast();

  const [animalId, setAnimalId] = useState('');
  const [heatDate, setHeatDate] = useState('');
  const [serviceDate, setServiceDate] = useState('');
  const [method, setMethod] = useState('');
  const [sire, setSire] = useState('');
  const [checkDate, setCheckDate] = useState('');
  const [result, setResult] = useState<PregnancyResult>('pending');
  const [expected, setExpected] = useState('');
  const [estimated, setEstimated] = useState(false);
  const [expectedTouched, setExpectedTouched] = useState(false);
  const [actualDate, setActualDate] = useState('');
  const [outcome, setOutcome] = useState<CalvingOutcome>('pending');
  const [offspring, setOffspring] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAnimalId(initial ? String(initial.animal_id) : defaultAnimalId ? String(defaultAnimalId) : '');
    setHeatDate(initial?.heat_date ?? '');
    setServiceDate(initial?.service_date ?? '');
    setMethod(initial?.service_method ?? '');
    setSire(initial?.sire_info ?? '');
    setCheckDate(initial?.pregnancy_check_date ?? '');
    setResult(initial?.pregnancy_result ?? 'pending');
    setExpected(initial?.expected_calving_date ?? '');
    setEstimated(initial?.expected_calving_estimated === 1);
    setExpectedTouched(Boolean(initial?.expected_calving_date));
    setActualDate(initial?.actual_calving_date ?? '');
    setOutcome(initial?.calving_outcome ?? 'pending');
    setOffspring(initial?.offspring_count != null ? String(initial.offspring_count) : '');
    setNotes(initial?.notes ?? '');
    setErrors({});
  }, [open, initial, defaultAnimalId]);

  function applyEstimate(service: string) {
    if (!service) return;
    setExpected(addDaysStr(service, meta.farm.gestation_days));
    setEstimated(true);
    setExpectedTouched(false);
  }

  function onServiceChange(value: string) {
    setServiceDate(value);
    if (result === 'pregnant' && !expectedTouched) applyEstimate(value);
  }

  function onResultChange(value: PregnancyResult) {
    setResult(value);
    if (value !== 'pregnant') {
      setExpected('');
      setEstimated(false);
      setExpectedTouched(false);
    } else if (serviceDate && !expectedTouched) {
      applyEstimate(serviceDate);
    }
  }

  async function save() {
    const errs: Record<string, string> = {};
    if (!animalId) errs.animal_id = 'Select an animal.';
    if (!heatDate && !serviceDate) errs.heat_date = 'Enter a heat date or a service date.';
    if (heatDate && serviceDate && heatDate > serviceDate) errs.heat_date = 'Heat date cannot be after the service date.';
    if (serviceDate && !method) errs.service_method = 'Select a service method.';
    if (serviceDate && checkDate && checkDate < serviceDate) {
      errs.pregnancy_check_date = 'Pregnancy check cannot be before the service date.';
    }
    if (serviceDate && expected && expected <= serviceDate) {
      errs.expected_calving_date = 'Expected calving date must be after the service date.';
    }
    if (result === 'pregnant') {
      if (!checkDate) errs.pregnancy_check_date = 'Pregnancy check date is required for a confirmed pregnancy.';
      if (!expected) errs.expected_calving_date = 'Expected calving date is required for a confirmed pregnancy.';
    }
    if (actualDate && result !== 'pregnant') errs.actual_calving_date = 'Actual calving requires a confirmed pregnancy.';
    if (actualDate && outcome === 'pending') errs.calving_outcome = 'Select a calving outcome.';
    if (!actualDate && outcome !== 'pending') errs.calving_outcome = 'Calving outcome requires an actual calving date.';
    if (offspring.trim() !== '' && !actualDate) errs.offspring_count = 'Offspring count requires an actual calving date.';
    const offspringValue = offspring.trim() === '' ? null : Number(offspring);
    if (offspringValue !== null && (!Number.isInteger(offspringValue) || offspringValue < 0)) {
      errs.offspring_count = 'Enter a whole number of offspring.';
    }
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    setBusy(true);
    try {
      const payload = {
        animal_id: Number(animalId),
        heat_date: heatDate || null,
        service_date: serviceDate || null,
        service_method: method || null,
        sire_info: sire.trim() || null,
        pregnancy_check_date: checkDate || null,
        pregnancy_result: result,
        expected_calving_date: expected || null,
        expected_calving_estimated: estimated ? 1 : 0,
        actual_calving_date: actualDate || null,
        calving_outcome: outcome,
        offspring_count: offspringValue,
        notes: notes.trim() || null
      };
      if (initial) {
        await api.put(`/breeding-records/${initial.id}`, payload);
        toast.success('Breeding record updated.');
      } else {
        await api.post('/breeding-records', payload);
        toast.success('Breeding record added.');
      }
      refresh();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.details) setErrors(err.details);
        toast.error(err.message);
      } else {
        toast.error('Could not save the breeding record.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? 'Edit Breeding Record' : 'Add Breeding Record'}
      maxWidth={620}
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
        <Field label="Animal" required error={errors.animal_id} className="span-2" htmlFor="breed-animal">
          <select
            id="breed-animal"
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

        <Field label="Heat detected" error={errors.heat_date} htmlFor="breed-heat" hint="Optional if service date is known">
          <input
            id="breed-heat"
            type="date"
            className={`input${errors.heat_date ? ' invalid' : ''}`}
            value={heatDate}
            max={todayStr()}
            onChange={(e) => setHeatDate(e.target.value)}
          />
        </Field>
        <Field label="Service / insemination" error={errors.service_date} htmlFor="breed-service">
          <input
            id="breed-service"
            type="date"
            className={`input${errors.service_date ? ' invalid' : ''}`}
            value={serviceDate}
            max={todayStr()}
            onChange={(e) => onServiceChange(e.target.value)}
          />
        </Field>

        <Field label="Service method" error={errors.service_method} htmlFor="breed-method">
          <select
            id="breed-method"
            className={`select${errors.service_method ? ' invalid' : ''}`}
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            <option value="">Select method…</option>
            {(Object.keys(SERVICE_METHOD_LABELS) as ServiceMethod[]).map((m) => (
              <option key={m} value={m}>
                {SERVICE_METHOD_LABELS[m]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Sire / bull" error={errors.sire_info} htmlFor="breed-sire" hint="Optional">
          <input
            id="breed-sire"
            className="input"
            value={sire}
            onChange={(e) => setSire(e.target.value)}
            placeholder="e.g. Bull name or AI straw code"
          />
        </Field>

        <Field label="Pregnancy check date" error={errors.pregnancy_check_date} htmlFor="breed-check">
          <input
            id="breed-check"
            type="date"
            className={`input${errors.pregnancy_check_date ? ' invalid' : ''}`}
            value={checkDate}
            max={todayStr()}
            onChange={(e) => setCheckDate(e.target.value)}
          />
        </Field>
        <Field label="Pregnancy result" required error={errors.pregnancy_result} htmlFor="breed-result">
          <select
            id="breed-result"
            className="select"
            value={result}
            onChange={(e) => onResultChange(e.target.value as PregnancyResult)}
          >
            {(Object.keys(PREGNANCY_RESULT_LABELS) as PregnancyResult[]).map((r) => (
              <option key={r} value={r}>
                {PREGNANCY_RESULT_LABELS[r]}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Expected calving date"
          error={errors.expected_calving_date}
          hint={
            estimated
              ? `Estimated from service date + ${meta.farm.gestation_days} days — adjust if needed`
              : 'Required when pregnant; can be estimated'
          }
          htmlFor="breed-expected"
        >
          <input
            id="breed-expected"
            type="date"
            className={`input${errors.expected_calving_date ? ' invalid' : ''}`}
            value={expected}
            onChange={(e) => {
              setExpected(e.target.value);
              setEstimated(false);
              setExpectedTouched(true);
            }}
          />
        </Field>
        <Field label="Actual calving date" error={errors.actual_calving_date} htmlFor="breed-actual">
          <input
            id="breed-actual"
            type="date"
            className={`input${errors.actual_calving_date ? ' invalid' : ''}`}
            value={actualDate}
            max={todayStr()}
            onChange={(e) => setActualDate(e.target.value)}
          />
        </Field>

        <Field label="Calving outcome" error={errors.calving_outcome} htmlFor="breed-outcome">
          <select
            id="breed-outcome"
            className={`select${errors.calving_outcome ? ' invalid' : ''}`}
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as CalvingOutcome)}
          >
            {(Object.keys(CALVING_OUTCOME_LABELS) as CalvingOutcome[]).map((o) => (
              <option key={o} value={o}>
                {CALVING_OUTCOME_LABELS[o]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Number of offspring" error={errors.offspring_count} htmlFor="breed-offspring" hint="Optional">
          <input
            id="breed-offspring"
            type="number"
            min="0"
            step="1"
            className={`input${errors.offspring_count ? ' invalid' : ''}`}
            value={offspring}
            onChange={(e) => setOffspring(e.target.value)}
            placeholder="e.g. 1"
          />
        </Field>

        <Field label="Notes" className="span-2" error={errors.notes} htmlFor="breed-notes">
          <textarea
            id="breed-notes"
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
