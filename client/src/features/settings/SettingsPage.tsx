import { useEffect, useState } from 'react';
import { PageHeader } from '../../components/PageHeader';
import { Field } from '../../components/Field';
import { Icon } from '../../components/Icon';
import { api, ApiError, API_BASE } from '../../lib/api';
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
  const [cowGestation, setCowGestation] = useState(String(meta.farm.cow_gestation_days));
  const [buffaloGestation, setBuffaloGestation] = useState(String(meta.farm.buffalo_gestation_days));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [breedingErrors, setBreedingErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [breedingBusy, setBreedingBusy] = useState(false);
  const [backingUp, setBackingUp] = useState(false);

  async function downloadBackup() {
    setBackingUp(true);
    try {
      const res = await fetch(API_BASE + '/api/settings/backup');
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error((body as { error?: string } | null)?.error || 'Backup failed.');
      }
      const blob = await res.blob();
      const disposition = res.headers.get('content-disposition') || '';
      const match = /filename="?([^";]+)"?/.exec(disposition);
      const filename = match ? match[1] : 'dairy-backup.db';

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      toast.success('Backup downloaded and verified.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Backup failed.');
    } finally {
      setBackingUp(false);
    }
  }

  useEffect(() => {
    setName(meta.farm.name);
    setCurrency(meta.farm.currency);
    setMilkUnit(meta.farm.milk_unit);
    setWeekStart(meta.farm.week_start);
  }, [meta.farm.name, meta.farm.currency, meta.farm.milk_unit, meta.farm.week_start]);

  useEffect(() => {
    setCowGestation(String(meta.farm.cow_gestation_days));
    setBuffaloGestation(String(meta.farm.buffalo_gestation_days));
  }, [meta.farm.cow_gestation_days, meta.farm.buffalo_gestation_days]);

  async function save() {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Farm name is required.';
    if (!currency.trim()) errs.currency = 'Currency is required.';
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
        week_start: weekStart
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

  async function saveBreeding() {
    const errs: Record<string, string> = {};
    const cow = Number(cowGestation);
    const buffalo = Number(buffaloGestation);
    if (!Number.isInteger(cow) || cow < 150 || cow > 400) {
      errs.cow_gestation_days = 'Cow gestation must be between 150 and 400 days.';
    }
    if (!Number.isInteger(buffalo) || buffalo < 150 || buffalo > 400) {
      errs.buffalo_gestation_days = 'Buffalo gestation must be between 150 and 400 days.';
    }
    if (Object.keys(errs).length > 0) {
      setBreedingErrors(errs);
      return;
    }

    setBreedingBusy(true);
    try {
      await api.put('/settings/breeding', {
        cow_gestation_days: cow,
        buffalo_gestation_days: buffalo
      });
      toast.success('Breeding settings saved.');
      refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.details) setBreedingErrors(err.details);
        toast.error(err.message);
      } else {
        toast.error('Could not save the breeding settings.');
      }
    } finally {
      setBreedingBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Settings" subtitle="Farm information and preferences." />

      <div className="grid-2-equal">
        <div className="stack">
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

                <div className="span-2" style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
                    {busy ? 'Saving…' : 'Save Settings'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title">Breeding Settings</div>
            </div>
            <div className="card-body">
              <div className="form-grid">
                <Field
                  label="Cow gestation (days)"
                  required
                  error={breedingErrors.cow_gestation_days}
                  hint="Used for expected calving estimates (default 283)"
                  htmlFor="set-cow-gestation"
                >
                  <input
                    id="set-cow-gestation"
                    type="number"
                    min="150"
                    max="400"
                    step="1"
                    className={`input${breedingErrors.cow_gestation_days ? ' invalid' : ''}`}
                    value={cowGestation}
                    onChange={(e) => setCowGestation(e.target.value)}
                  />
                </Field>

                <Field
                  label="Buffalo gestation (days)"
                  required
                  error={breedingErrors.buffalo_gestation_days}
                  hint="Used for expected calving estimates (default 310)"
                  htmlFor="set-buffalo-gestation"
                >
                  <input
                    id="set-buffalo-gestation"
                    type="number"
                    min="150"
                    max="400"
                    step="1"
                    className={`input${breedingErrors.buffalo_gestation_days ? ' invalid' : ''}`}
                    value={buffaloGestation}
                    onChange={(e) => setBuffaloGestation(e.target.value)}
                  />
                </Field>

                <div className="span-2" style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button type="button" className="btn btn-primary" onClick={saveBreeding} disabled={breedingBusy}>
                    {breedingBusy ? 'Saving…' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="stack">
          {meta.capabilities.backup && (
            <div className="card">
              <div className="card-header">
                <div className="card-title">Data Backup</div>
              </div>
              <div className="card-body">
                <p style={{ color: 'var(--text-2)', marginBottom: 14 }}>
                  A backup is created automatically once a day and kept on this computer. Download a copy of the farm
                  database to keep somewhere safe — you can restore it by replacing the database file with this backup.
                </p>
                <button type="button" className="btn" onClick={downloadBackup} disabled={backingUp}>
                  <Icon name="download" size={15} /> {backingUp ? 'Creating backup…' : 'Download Backup'}
                </button>
              </div>
            </div>
          )}

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
