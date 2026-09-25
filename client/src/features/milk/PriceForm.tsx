import { useEffect, useState } from 'react';
import { Modal } from '../../components/Modal';
import { Field } from '../../components/Field';
import { api, ApiError } from '../../lib/api';
import { useData } from '../../lib/DataContext';
import { useToast } from '../../lib/ToastContext';
import { useMeta } from '../../lib/MetaContext';
import { todayStr } from '../../lib/format';
import type { MilkPrice } from '../../lib/types';

export function PriceForm({
  open,
  onClose,
  initial
}: {
  open: boolean;
  onClose: () => void;
  initial?: MilkPrice | null;
}) {
  const meta = useMeta();
  const { refresh } = useData();
  const toast = useToast();

  const [effectiveDate, setEffectiveDate] = useState(todayStr());
  const [price, setPrice] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEffectiveDate(initial?.effective_date ?? todayStr());
    setPrice(initial ? String(initial.price_per_litre) : '');
    setErrors({});
  }, [open, initial]);

  const unit = meta.farm.milk_unit;

  async function save() {
    const errs: Record<string, string> = {};
    if (!effectiveDate) errs.effective_date = 'Effective date is required.';
    const value = Number(price);
    if (price.trim() === '' || !Number.isFinite(value) || value <= 0) {
      errs.price_per_litre = 'Enter a price greater than 0.';
    }
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    setBusy(true);
    try {
      const payload = { effective_date: effectiveDate, price_per_litre: value };
      if (initial) {
        await api.put(`/milk-prices/${initial.id}`, payload);
        toast.success('Milk price updated.');
      } else {
        await api.post('/milk-prices', payload);
        toast.success('Milk price added.');
      }
      refresh();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.details) setErrors(err.details);
        toast.error(err.message);
      } else {
        toast.error('Could not save the price.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? 'Edit Milk Price' : 'Add Milk Price'}
      maxWidth={480}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : initial ? 'Save Changes' : 'Add Price'}
          </button>
        </>
      }
    >
      <div
        className="form-grid"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) {
            e.preventDefault();
            void save();
          }
        }}
      >
        <Field label="Effective from" required error={errors.effective_date} htmlFor="price-date">
          <input
            id="price-date"
            type="date"
            className={`input${errors.effective_date ? ' invalid' : ''}`}
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
            autoFocus
          />
        </Field>

        <Field
          label={`Price per ${unit}`}
          required
          error={errors.price_per_litre}
          htmlFor="price-value"
          hint="Sales on or after this date use this price."
        >
          <input
            id="price-value"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            placeholder="e.g. 220"
            className={`input${errors.price_per_litre ? ' invalid' : ''}`}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}
