import { useEffect, useState } from 'react';
import { Modal } from '../../components/Modal';
import { Field } from '../../components/Field';
import { api, ApiError } from '../../lib/api';
import { useData } from '../../lib/DataContext';
import { useToast } from '../../lib/ToastContext';
import { useMeta } from '../../lib/MetaContext';
import { todayStr } from '../../lib/format';
import type { Animal, Transaction, TxType } from '../../lib/types';

export function TransactionForm({
  open,
  onClose,
  initial,
  defaultType,
  animals
}: {
  open: boolean;
  onClose: () => void;
  initial?: Transaction | null;
  defaultType?: TxType;
  animals: Animal[];
}) {
  const meta = useMeta();
  const { refresh } = useData();
  const toast = useToast();

  const [type, setType] = useState<TxType>('income');
  const [date, setDate] = useState(todayStr());
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [animalId, setAnimalId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const t = initial?.type ?? defaultType ?? 'income';
    setType(t);
    setDate(initial?.date ?? todayStr());
    setCategory(initial?.category ?? meta.categories[t][0]?.value ?? '');
    setAmount(initial ? String(initial.amount) : '');
    setDescription(initial?.description ?? '');
    setAnimalId(initial?.animal_id ? String(initial.animal_id) : '');
    setErrors({});
  }, [open, initial, defaultType, meta]);

  const categories = meta.categories[type];

  function switchType(t: TxType) {
    setType(t);
    setCategory(meta.categories[t][0]?.value ?? '');
  }

  async function save() {
    const errs: Record<string, string> = {};
    if (!date) errs.date = 'Date is required.';
    if (!category) errs.category = 'Select a category.';
    const amt = Number(amount);
    if (amount.trim() === '' || !Number.isFinite(amt) || amt <= 0) errs.amount = 'Enter an amount greater than 0.';
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    setBusy(true);
    try {
      const payload = {
        date,
        type,
        category,
        amount: amt,
        description: description.trim() || null,
        animal_id: animalId ? Number(animalId) : null
      };
      if (initial) {
        await api.put(`/transactions/${initial.id}`, payload);
        toast.success('Transaction updated.');
      } else {
        await api.post('/transactions', payload);
        toast.success(type === 'income' ? 'Income added.' : 'Expense added.');
      }
      refresh();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.details) setErrors(err.details);
        toast.error(err.message);
      } else {
        toast.error('Could not save the transaction.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? 'Edit Transaction' : type === 'income' ? 'Add Income' : 'Add Expense'}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : initial ? 'Save Changes' : 'Save'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Type" required className="span-2">
          <div className="segmented">
            <button type="button" className={type === 'income' ? 'active' : ''} onClick={() => switchType('income')}>
              Income
            </button>
            <button type="button" className={type === 'expense' ? 'active' : ''} onClick={() => switchType('expense')}>
              Expense
            </button>
          </div>
        </Field>

        <Field label="Date" required error={errors.date} htmlFor="tx-date">
          <input
            id="tx-date"
            type="date"
            className={`input${errors.date ? ' invalid' : ''}`}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="Category" required error={errors.category} htmlFor="tx-category">
          <select
            id="tx-category"
            className={`select${errors.category ? ' invalid' : ''}`}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {categories.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label={`Amount (${meta.farm.currency})`} required error={errors.amount} htmlFor="tx-amount">
          <input
            id="tx-amount"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            placeholder="0"
            className={`input${errors.amount ? ' invalid' : ''}`}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Animal" error={errors.animal_id} htmlFor="tx-animal" hint="Optional">
          <select id="tx-animal" className="select" value={animalId} onChange={(e) => setAnimalId(e.target.value)}>
            <option value="">No animal</option>
            {animals.map((a) => (
              <option key={a.id} value={a.id}>
                #{a.tag_number}
                {a.name ? ` · ${a.name}` : ''}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Description" className="span-2" error={errors.description} htmlFor="tx-description">
          <input
            id="tx-description"
            className="input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Milk sold to dairy"
          />
        </Field>
      </div>
    </Modal>
  );
}
