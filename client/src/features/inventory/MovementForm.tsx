import { useEffect, useRef, useState } from 'react';
import { Modal } from '../../components/Modal';
import { Field } from '../../components/Field';
import { api, ApiError } from '../../lib/api';
import { useData } from '../../lib/DataContext';
import { useToast } from '../../lib/ToastContext';
import { todayStr } from '../../lib/format';
import { MOVEMENT_TYPE_LABELS } from '../../lib/constants';
import type { AdjustmentDirection, InventoryItem, InventoryMovement, InventoryMovementType } from '../../lib/types';

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

export function MovementForm({
  open,
  onClose,
  initial,
  defaultItemId,
  items
}: {
  open: boolean;
  onClose: () => void;
  initial?: InventoryMovement | null;
  defaultItemId?: number;
  items: InventoryItem[];
}) {
  const { refresh } = useData();
  const toast = useToast();

  const [itemId, setItemId] = useState('');
  const [date, setDate] = useState(todayStr());
  const [type, setType] = useState<InventoryMovementType>('purchase');
  const [quantity, setQuantity] = useState('');
  const [direction, setDirection] = useState<AdjustmentDirection>('increase');
  const [unitCost, setUnitCost] = useState('');
  const [totalCost, setTotalCost] = useState('');
  const [totalTouched, setTotalTouched] = useState(false);
  const [supplier, setSupplier] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const quantityRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setItemId(initial ? String(initial.item_id) : defaultItemId ? String(defaultItemId) : '');
    setDate(initial?.date ?? todayStr());
    setType(initial?.type ?? 'purchase');
    setQuantity(initial ? String(Math.abs(initial.quantity)) : '');
    setDirection(initial && initial.quantity < 0 ? 'decrease' : 'increase');
    setUnitCost(initial?.unit_cost != null ? String(initial.unit_cost) : '');
    setTotalCost(initial?.total_cost != null ? String(initial.total_cost) : '');
    setTotalTouched(Boolean(initial?.total_cost != null));
    setSupplier(initial?.supplier ?? '');
    setNotes(initial?.notes ?? '');
    setErrors({});
  }, [open, initial, defaultItemId]);

  const selectedItem = items.find((i) => String(i.id) === itemId);
  const unit = selectedItem ? selectedItem.unit : '';
  const isPurchase = type === 'purchase';
  const isAdjustment = type === 'adjustment';

  function maybeRecalcTotal(nextQuantity: string, nextUnitCost: string) {
    if (totalTouched || !isPurchase) return;
    const q = Number(nextQuantity);
    const c = Number(nextUnitCost);
    if (Number.isFinite(q) && Number.isFinite(c) && nextUnitCost.trim() !== '') {
      setTotalCost(String(round2(q * c)));
    }
  }

  async function save(keepOpen: boolean) {
    const errs: Record<string, string> = {};
    if (!itemId) errs.item_id = 'Select an item.';
    if (!date) errs.date = 'Date is required.';
    const qty = Number(quantity);
    if (quantity.trim() === '' || !Number.isFinite(qty) || qty <= 0) {
      errs.quantity = 'Enter a quantity greater than 0.';
    }
    if (isAdjustment && !notes.trim()) errs.notes = 'A reason is required for adjustments.';
    if (isPurchase) {
      const uc = unitCost.trim() === '' ? null : Number(unitCost);
      const tc = totalCost.trim() === '' ? null : Number(totalCost);
      if (uc !== null && (!Number.isFinite(uc) || uc < 0)) errs.unit_cost = 'Unit cost cannot be negative.';
      if (tc !== null && (!Number.isFinite(tc) || tc < 0)) errs.total_cost = 'Total cost cannot be negative.';
    }
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        item_id: Number(itemId),
        date,
        type,
        quantity: qty,
        notes: notes.trim() || null
      };
      if (isAdjustment) payload.direction = direction;
      if (isPurchase) {
        payload.unit_cost = unitCost.trim() === '' ? null : Number(unitCost);
        payload.total_cost = totalCost.trim() === '' ? null : Number(totalCost);
        payload.supplier = supplier.trim() || null;
      }

      if (initial) {
        await api.put(`/inventory-movements/${initial.id}`, payload);
        toast.success('Movement updated.');
        refresh();
        onClose();
      } else {
        await api.post('/inventory-movements', payload);
        toast.success('Movement recorded.');
        refresh();
        if (keepOpen) {
          setQuantity('');
          setNotes('');
          setUnitCost('');
          setTotalCost('');
          setTotalTouched(false);
          setSupplier('');
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
        toast.error('Could not save the movement.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? 'Edit Stock Movement' : 'Record Stock Movement'}
      maxWidth={560}
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
      <div className="form-grid">
        <Field label="Item" required error={errors.item_id} className="span-2" htmlFor="mov-item">
          <select
            id="mov-item"
            className={`select${errors.item_id ? ' invalid' : ''}`}
            value={itemId}
            onChange={(e) => {
              setItemId(e.target.value);
              setErrors({});
            }}
            autoFocus
          >
            <option value="">Select item…</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} ({i.unit}){i.active === 0 ? ' — inactive' : ''}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Date" required error={errors.date} htmlFor="mov-date">
          <input
            id="mov-date"
            type="date"
            className={`input${errors.date ? ' invalid' : ''}`}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="Movement type" required error={errors.type} htmlFor="mov-type">
          <select
            id="mov-type"
            className="select"
            value={type}
            onChange={(e) => {
              setType(e.target.value as InventoryMovementType);
              setErrors({});
            }}
          >
            {(Object.keys(MOVEMENT_TYPE_LABELS) as InventoryMovementType[]).map((t) => (
              <option key={t} value={t}>
                {MOVEMENT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>

        {isAdjustment ? (
          <Field label="Direction" required error={errors.direction}>
            <div className="segmented">
              <button
                type="button"
                className={direction === 'increase' ? 'active' : ''}
                onClick={() => setDirection('increase')}
              >
                Increase (+)
              </button>
              <button
                type="button"
                className={direction === 'decrease' ? 'active' : ''}
                onClick={() => setDirection('decrease')}
              >
                Decrease (−)
              </button>
            </div>
          </Field>
        ) : null}

        <Field label="Quantity" required error={errors.quantity} htmlFor="mov-quantity" hint={unit ? `In ${unit}` : undefined}>
          <input
            id="mov-quantity"
            ref={quantityRef}
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            className={`input${errors.quantity ? ' invalid' : ''}`}
            value={quantity}
            onChange={(e) => {
              setQuantity(e.target.value);
              maybeRecalcTotal(e.target.value, unitCost);
            }}
            placeholder="0"
          />
        </Field>

        <Field label="Unit" htmlFor="mov-unit" hint="Set by the item">
          <input id="mov-unit" className="input" value={unit} readOnly disabled />
        </Field>

        {isPurchase ? (
          <>
            <Field label="Unit cost" error={errors.unit_cost} htmlFor="mov-unit-cost">
              <input
                id="mov-unit-cost"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                className={`input${errors.unit_cost ? ' invalid' : ''}`}
                value={unitCost}
                onChange={(e) => {
                  setUnitCost(e.target.value);
                  maybeRecalcTotal(quantity, e.target.value);
                }}
                placeholder="Optional"
              />
            </Field>
            <Field
              label="Total cost"
              error={errors.total_cost}
              hint="Creates a linked Feed expense"
              htmlFor="mov-total-cost"
            >
              <input
                id="mov-total-cost"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                className={`input${errors.total_cost ? ' invalid' : ''}`}
                value={totalCost}
                onChange={(e) => {
                  setTotalCost(e.target.value);
                  setTotalTouched(true);
                }}
                placeholder="Optional"
              />
            </Field>
            <Field label="Supplier" error={errors.supplier} className="span-2" htmlFor="mov-supplier">
              <input
                id="mov-supplier"
                className="input"
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                placeholder="Optional"
              />
            </Field>
          </>
        ) : null}

        <Field
          label="Notes"
          className="span-2"
          error={errors.notes}
          hint={isAdjustment ? 'Required: explain the correction' : undefined}
          htmlFor="mov-notes"
        >
          <textarea
            id="mov-notes"
            className={`textarea${errors.notes ? ' invalid' : ''}`}
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
