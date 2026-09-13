ALTER TABLE farms ADD COLUMN gestation_days INTEGER NOT NULL DEFAULT 283;

CREATE TABLE IF NOT EXISTS breeding_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  animal_id INTEGER NOT NULL REFERENCES animals(id) ON DELETE RESTRICT,
  heat_date TEXT,
  service_date TEXT,
  service_method TEXT CHECK (service_method IN ('natural', 'artificial_insemination', 'other')),
  sire_info TEXT,
  pregnancy_check_date TEXT,
  pregnancy_result TEXT NOT NULL DEFAULT 'pending' CHECK (pregnancy_result IN ('pending', 'pregnant', 'not_pregnant')),
  expected_calving_date TEXT,
  expected_calving_estimated INTEGER NOT NULL DEFAULT 0 CHECK (expected_calving_estimated IN (0, 1)),
  actual_calving_date TEXT,
  calving_outcome TEXT NOT NULL DEFAULT 'pending' CHECK (calving_outcome IN ('pending', 'successful', 'complication', 'aborted', 'other')),
  offspring_count INTEGER CHECK (offspring_count IS NULL OR offspring_count >= 0),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_breeding_farm_service ON breeding_records(farm_id, service_date);
CREATE INDEX IF NOT EXISTS idx_breeding_animal_service ON breeding_records(animal_id, service_date);
CREATE INDEX IF NOT EXISTS idx_breeding_farm_result ON breeding_records(farm_id, pregnancy_result);
CREATE INDEX IF NOT EXISTS idx_breeding_farm_expected ON breeding_records(farm_id, expected_calving_date);
CREATE INDEX IF NOT EXISTS idx_breeding_farm_actual ON breeding_records(farm_id, actual_calving_date);
