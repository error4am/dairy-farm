import { useEffect, useState } from 'react';
import { PageHeader } from '../../components/PageHeader';
import { Field } from '../../components/Field';
import { Icon } from '../../components/Icon';
import { api, ApiError } from '../../lib/api';
import { useMeta } from '../../lib/MetaContext';
import { useData } from '../../lib/DataContext';
import { useToast } from '../../lib/ToastContext';
import { CURRENCIES, MILK_UNITS } from '../../lib/constants';
import type { WeekStart } from '../../lib/types';

export function SettingsPage() {
  const meta = useMeta();
  const { refresh } = useData();
  const toast = useToast();

  const [name, setName] = useState(meta.farm.name);
  const [currency, setCurrency] = useState(meta.farm.currency);
  const [milkUnit, setMilkUnit] = useState(meta.farm.milk_unit);
  const [weekStart, setWeekStart] = useState<WeekStart>(meta.farm.week_start);
  const [gestationDays, setGestationDays] = useState(String(meta.farm.gestation_days));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(meta.farm.name);
    setCurrency(meta.farm.currency);
    setMilkUnit(meta.farm.milk_unit);
    setWeekStart(meta.farm.week_start);
    setGestationDays(String(meta.farm.gestation_days));
  }, [meta.farm.name, meta.farm.currency, meta.farm.milk_unit, meta.farm.week_start, meta.farm.gestation_days]);

  async function save() {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Farm name is required.';
    if (!currency.trim()) errs.currency = 'Currency is required.';
    const gestation = Number(gestationDays);
    if (!Number.isInteger(gestation) || gestation < 150 || gestation > 400) {
      errs.gestation_days = 'Gestation length must be between 150 and 400 days.';
    }
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    setBusy(true);
    try {
      await api.put('/settings', {
        name: name.trim(),
        currency: currency.trim().toUpperCase(),
        milk_unit: milkUnit,
        week_start: weekStart,
        gestation_days: gestation
      });
      toast.success('Settings saved.');
      refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.details) setErrors(err.details);
        toast.error(err.message);
      } else {
        toast.error('Could not save the settings.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Settings" subtitle="Farm information and preferences." />

      <div className="grid-2-equal">
        <div className="card">
          <div className="card-header">
            <div className="card-title">Farm Information</div>
          </div>
          <div className="card-body">
            <div className="form-grid">
              <Field label="Farm name" required error={errors.name} className="span-2" htmlFor="set-name">
                <input
                  id="set-name"
                  className={`input${errors.name ? ' invalid' : ''}`}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Al-Noor Dairy Farm"
                />
              </Field>

              <Field label="Currency" required error={errors.currency} htmlFor="set-currency" hint="e.g. PKR, INR, USD">
                <input
                  id="set-currency"
                  className={`input${errors.currency ? ' invalid' : ''}`}
                  value={currency}
                  list="currency-options"
                  maxLength={10}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                />
                <datalist id="currency-options">
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </Field>

              <Field label="Milk unit" required htmlFor="set-unit">
                <select id="set-unit" className="select" value={milkUnit} onChange={(e) => setMilkUnit(e.target.value)}>
                  {MILK_UNITS.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Week starts on" htmlFor="set-week">
                <select
                  id="set-week"
                  className="select"
                  value={weekStart}
                  onChange={(e) => setWeekStart(e.target.value as WeekStart)}
                >
                  <option value="monday">Monday</option>
                  <option value="sunday">Sunday</option>
                </select>
              </Field>

              <Field
                label="Gestation length (days)"
                required
                error={errors.gestation_days}
                hint="Used to estimate calving dates (cattle ≈ 283)"
                htmlFor="set-gestation"
              >
                <input
                  id="set-gestation"
                  type="number"
                  min="150"
                  max="400"
                  step="1"
                  className={`input${errors.gestation_days ? ' invalid' : ''}`}
                  value={gestationDays}
                  onChange={(e) => setGestationDays(e.target.value)}
                />
              </Field>

              <div className="span-2" style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
                  {busy ? 'Saving…' : 'Save Settings'}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-header">
              <div className="card-title">Data Backup</div>
            </div>
            <div className="card-body">
              <p style={{ color: 'var(--text-2)', marginBottom: 14 }}>
                Download a copy of the farm database. Keep it somewhere safe — you can restore by replacing the database
                file with this backup.
              </p>
              <a className="btn" href="/api/settings/backup">
                <Icon name="download" size={15} /> Download Backup
              </a>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title">About</div>
            </div>
            <div className="card-body">
              <div className="detail-grid">
                <div>
                  <div className="detail-label">Application</div>
                  <div className="detail-value">Dairy Farm Manager</div>
                </div>
                <div>
                  <div className="detail-label">Version</div>
                  <div className="detail-value">0.1.0 · Phase 2.3 (Employees)</div>
                </div>
                <div>
                  <div className="detail-label">Modules</div>
                  <div className="detail-value">Dashboard · Animals · Health · Breeding · Milk · Finances · Employees</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
