import { useEffect, useState } from 'react';
import { Modal } from '../../components/Modal';
import { Field } from '../../components/Field';
import { api, ApiError } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useData } from '../../lib/DataContext';
import { useToast } from '../../lib/ToastContext';
import { useMeta } from '../../lib/MetaContext';
import { formatMoney, todayStr } from '../../lib/format';
import type { MilkSale } from '../../lib/types';

interface ApplicablePrice {
  date: string;
  price_per_litre: number | null;
}

export function SaleForm({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: MilkSale | null }) {
  const meta = useMeta();
  const { refresh } = useData();
  const toast = useToast();

  const [date, setDate] = useState(todayStr());
  const [litres, setLitres] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDate(initial?.date ?? todayStr());
    setLitres(initial ? String(initial.litres) : '');
    setNotes(initial?.notes ?? '');
    setErrors({});
  }, [open, initial]);

  const { data: applicable } = useApi<ApplicablePrice>(open ? `/milk-prices/applicable?date=${date}` : null);

  const keepsStoredPrice = Boolean(initial && date === initial.date);
  const price = keepsStoredPrice && initial ? initial.price_per_litre : (applicable?.price_per_litre ?? null);
  const qty = Number(litres);
  const hasQty = litres.trim() !== '' && Number.isFinite(qty) && qty > 0;
  const revenue = hasQty && price !== null ? Math.round(qty * price * 100) / 100 : null;
  const unit = meta.farm.milk_unit;

  async function save() {
    const errs: Record<string, string> = {};
    if (!date) errs.date = 'Date is required.';
    if (!hasQty) errs.litres = 'Enter litres greater than 0.';
    if (price === null) errs.date = 'No price is set for this date. Add a price first.';
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    setBusy(true);
    try {
      const payload = { date, litres: qty, notes: notes.trim() || null };
      if (initial) {
        await api.put(`/milk-sales/${initial.id}`, payload);
        toast.success('Milk sale updated.');
      } else {
        await api.post('/milk-sales', payload);
        toast.success('Milk sale recorded.');
      }
      refresh();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.details) setErrors(err.details);
        toast.error(err.message);
      } else {
        toast.error('Could not save the sale.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? 'Edit Milk Sale' : 'Record Milk Sale'}
      maxWidth={520}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : initial ? 'Save Changes' : 'Save Sale'}
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
        <Field label="Date" required error={errors.date} htmlFor="sale-date">
          <input
            id="sale-date"
            type="date"
            className={`input${errors.date ? ' invalid' : ''}`}
            value={date}
            max={todayStr()}
            onChange={(e) => setDate(e.target.value)}
            autoFocus
          />
        </Field>

        <Field
          label={`Litres (${unit})`}
          required
          error={errors.litres}
          htmlFor="sale-litres"
        >
          <input
            id="sale-litres"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.1"
            placeholder="e.g. 380"
            className={`input${errors.litres ? ' invalid' : ''}`}
            value={litres}
            onChange={(e) => setLitres(e.target.value)}
          />
        </Field>

        <Field
          label="Price (from price history)"
          htmlFor="sale-price"
          hint={price !== null ? 'Set in Price History — not editable here.' : undefined}
        >
          <input
            id="sale-price"
            className="input"
            value={price !== null ? `${formatMoney(price, meta.farm.currency)} / ${unit}` : 'No price for this date'}
            readOnly
          />
        </Field>

        <Field label="Revenue (preview)" htmlFor="sale-revenue">
          <input
            id="sale-revenue"
            className="input"
            value={revenue !== null ? formatMoney(revenue, meta.farm.currency) : '—'}
            readOnly
          />
        </Field>

        <Field label="Notes" className="span-2" htmlFor="sale-notes">
          <textarea
            id="sale-notes"
            className="textarea"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional — buyer, vehicle, reference…"
          />
        </Field>
      </div>
    </Modal>
  );
}
