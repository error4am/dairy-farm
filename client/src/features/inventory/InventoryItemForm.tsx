import { useEffect, useState } from 'react';
import { Modal } from '../../components/Modal';
import { Field } from '../../components/Field';
import { api, ApiError } from '../../lib/api';
import { useData } from '../../lib/DataContext';
import { useToast } from '../../lib/ToastContext';
import { todayStr } from '../../lib/format';
import { INVENTORY_CATEGORY_LABELS } from '../../lib/constants';
import type { InventoryCategory, InventoryItem } from '../../lib/types';

const UNIT_OPTIONS = ['kg', 'bag', 'bale', 'L', 'ton', 'maund', 'quintal'];

export function InventoryItemForm({
  open,
  onClose,
  initial
}: {
  open: boolean;
  onClose: () => void;
  initial?: InventoryItem | null;
}) {
  const { refresh } = useData();
  const toast = useToast();

  const [name, setName] = useState('');
  const [category, setCategory] = useState<InventoryCategory>('concentrate');
  const [unitChoice, setUnitChoice] = useState('kg');
  const [customUnit, setCustomUnit] = useState('');
  const [minimumStock, setMinimumStock] = useState('');
  const [openingStock, setOpeningStock] = useState('');
  const [active, setActive] = useState(true);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? '');
    setCategory(initial?.category ?? 'concentrate');
    if (initial && !UNIT_OPTIONS.includes(initial.unit)) {
      setUnitChoice('other');
      setCustomUnit(initial.unit);
    } else {
      setUnitChoice(initial?.unit ?? 'kg');
      setCustomUnit('');
    }
    setMinimumStock(initial?.minimum_stock != null ? String(initial.minimum_stock) : '');
    setOpeningStock('');
    setActive(initial ? initial.active === 1 : true);
    setNotes(initial?.notes ?? '');
    setErrors({});
  }, [open, initial]);

  async function save() {
    const errs: Record<string, string> = {};
    const unitValue = unitChoice === 'other' ? customUnit.trim() : unitChoice;
    if (!name.trim()) errs.name = 'Name is required.';
    if (!unitValue) errs.unit = 'Unit is required.';
    if (unitValue && !/^[A-Za-z][A-Za-z.\-/ ]*$/.test(unitValue)) {
      errs.unit = 'Unit must contain letters only (e.g. kg, bag, bale, L).';
    }
    const min = minimumStock.trim() === '' ? null : Number(minimumStock);
    if (min !== null && (!Number.isFinite(min) || min < 0)) {
      errs.minimum_stock = 'Minimum stock cannot be negative.';
    }
    const opening = openingStock.trim() === '' ? 0 : Number(openingStock);
    if (!Number.isFinite(opening) || opening < 0) {
      errs.opening_stock = 'Opening stock cannot be negative.';
    }
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    setBusy(true);
    try {
      const payload = {
        name: name.trim(),
        category,
        unit: unitValue,
        minimum_stock: min,
        active,
        notes: notes.trim() || null
      };
      let itemId: number;
      if (initial) {
        await api.put(`/inventory-items/${initial.id}`, payload);
        itemId = initial.id;
      } else {
        const created = await api.post<InventoryItem>('/inventory-items', payload);
        itemId = created.id;
      }

      if (opening > 0) {
        try {
          await api.post('/inventory-movements', {
            item_id: itemId,
            date: todayStr(),
            type: 'opening',
            quantity: opening,
            unit: unitValue
          });
          toast.success(initial ? 'Item updated with opening stock.' : 'Item added with opening stock.');
        } catch (moveErr) {
          toast.error(
            moveErr instanceof ApiError
              ? `Saved, but opening stock failed: ${moveErr.message}`
              : 'Saved, but opening stock could not be recorded.'
          );
        }
      } else {
        toast.success(initial ? 'Item updated.' : 'Item added.');
      }
      refresh();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.details) setErrors(err.details);
        toast.error(err.message);
      } else {
        toast.error('Could not save the item.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? `Edit ${initial.name}` : 'Add Inventory Item'}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : initial ? 'Save Changes' : 'Add Item'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Name" required error={errors.name} className="span-2" htmlFor="inv-name">
          <input
            id="inv-name"
            className={`input${errors.name ? ' invalid' : ''}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Wanda Silage"
            autoFocus
          />
        </Field>

        <Field label="Category" required error={errors.category} htmlFor="inv-category">
          <select
            id="inv-category"
            className="select"
            value={category}
            onChange={(e) => setCategory(e.target.value as InventoryCategory)}
          >
            {(Object.keys(INVENTORY_CATEGORY_LABELS) as InventoryCategory[]).map((c) => (
              <option key={c} value={c}>
                {INVENTORY_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Unit"
          required
          error={errors.unit}
          hint="All movements for this item must use this unit"
          htmlFor="inv-unit"
        >
          <select
            id="inv-unit"
            className={`select${errors.unit ? ' invalid' : ''}`}
            value={unitChoice}
            onChange={(e) => setUnitChoice(e.target.value)}
          >
            {UNIT_OPTIONS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
            <option value="other">Other…</option>
          </select>
          {unitChoice === 'other' ? (
            <input
              className={`input${errors.unit ? ' invalid' : ''}`}
              style={{ marginTop: 6 }}
              value={customUnit}
              onChange={(e) => setCustomUnit(e.target.value)}
              placeholder="e.g. maund"
              autoFocus
            />
          ) : null}
        </Field>

        <Field label="Status" error={errors.active} htmlFor="inv-active">
          <select
            id="inv-active"
            className="select"
            value={active ? 'active' : 'inactive'}
            onChange={(e) => setActive(e.target.value === 'active')}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </Field>
        <Field
          label="Minimum stock"
          error={errors.minimum_stock}
          hint="Low-stock warning level — not the current stock (optional)"
          htmlFor="inv-minimum"
        >
          <input
            id="inv-minimum"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            className={`input${errors.minimum_stock ? ' invalid' : ''}`}
            value={minimumStock}
            onChange={(e) => setMinimumStock(e.target.value)}
            placeholder="e.g. 2000"
          />
        </Field>

        {!initial || initial.movements_count === 0 ? (
          <Field
            label={`Opening stock (${unitChoice === 'other' ? customUnit.trim() || 'unit' : unitChoice})`}
            className="span-2"
            error={errors.opening_stock}
            hint="Starting quantity now on hand — recorded as an Opening Stock movement"
            htmlFor="inv-opening"
          >
            <input
              id="inv-opening"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              className={`input${errors.opening_stock ? ' invalid' : ''}`}
              value={openingStock}
              onChange={(e) => setOpeningStock(e.target.value)}
              placeholder="e.g. 2332"
            />
          </Field>
        ) : null}

        <Field label="Notes" className="span-2" error={errors.notes} htmlFor="inv-notes">
          <textarea
            id="inv-notes"
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
